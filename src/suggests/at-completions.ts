/**
 * EditorSuggest subclasses for Flowtime completions.
 * - AddTaskSuggest: /add-task slash command
 * - AtCompletionsSuggest: @-completions (macros + directives)
 */

import { EditorSuggest, TFile } from "obsidian";
import type { App, Editor, EditorPosition } from "obsidian";
import type { BucketDef, FlowtimeSettings } from "../types";
import { QuickEntryModal } from "../quick-entry";

// ── Suggestion types ──

interface AddTaskSuggestion {
  label: string;
  description: string;
}

interface AtCompletionSuggestion {
  label: string;
  description: string;
  insert?: string;
  type?: string;
}

// ── Plugin reference (avoids circular import) ──

interface FlowtimePluginRef {
  app: App;
  settings: FlowtimeSettings;
  notify: (message: string, isError?: boolean) => void;
  projectEngine: {
    getAllProjects(): Promise<Array<{ name: string; path: string }>>;
    resolve(filePath: string): Promise<{ name: string | null; path: string | null; source: string | null }>;
  };
}

// ── Classes ──

export class AddTaskSuggest extends EditorSuggest<AddTaskSuggestion> {
  plugin: FlowtimePluginRef;

  constructor(app: App, plugin: FlowtimePluginRef) {
    super(app);
    this.plugin = plugin;
  }

  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null,
  ): { start: EditorPosition; end: EditorPosition; query: string } | null {
    const line = editor.getLine(cursor.line);
    const before = line.slice(0, cursor.ch);
    const match = before.match(/\/add-task\s*$/);
    if (match) {
      return {
        start: { line: cursor.line, ch: cursor.ch - match[0].length },
        end: cursor,
        query: "",
      };
    }
    return null;
  }

  getSuggestions(
    _context: { query: string; editor: Editor; file: TFile; start: EditorPosition; end: EditorPosition },
  ): AddTaskSuggestion[] {
    return [{ label: "Add a task", description: "Open the quick entry modal" }];
  }

  renderSuggestion(suggestion: AddTaskSuggestion, el: HTMLElement): void {
    el.createEl("div", { text: suggestion.label });
    el.createEl("small", { text: suggestion.description });
  }

  selectSuggestion(
    _suggestion: AddTaskSuggestion,
    _event: KeyboardEvent | MouseEvent,
  ): void {
    if (this.context) {
      const editor = this.context.editor;
      const { start, end } = this.context;
      editor.replaceRange("", start, end);
    }
    new QuickEntryModal(this.app, this.plugin).open();
  }
}

/**
 * Unified @-completions.
 *
 * Two modes based on context:
 *
 * COMMAND MODE — @ is first non-whitespace on line → show task macros
 *   @td  → - [ ]  @today
 *   @tm  → - [ ]  @tomorrow
 *   @rec → - [ ]  🔁 every day @today
 *   @weekly → `flowtime-weekly` block
 *
 * DIRECTIVE MODE — @ inside a task line → show dates, durations, buckets, projects
 *   @today, @b:deep-work, @p:Website, @30m, @due:tomorrow
 */
export class AtCompletionsSuggest extends EditorSuggest<AtCompletionSuggestion> {
  limit = 30;
  plugin: FlowtimePluginRef;

  constructor(app: App, plugin: FlowtimePluginRef) {
    super(app);
    this.plugin = plugin;
  }

  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null,
  ): { start: EditorPosition; end: EditorPosition; query: string } | null {
    const line = editor.getLine(cursor.line);
    const before = line.slice(0, cursor.ch);
    const atIndex = before.lastIndexOf("@");
    if (atIndex < 0) return null;

    const textAfterAt = before.slice(atIndex + 1);
    if (textAfterAt.includes(" ")) return null;

    const lineLead = line.slice(0, atIndex);
    const isCommandMode =
      lineLead.trim() === "" && !line.match(/^\s*[-*+]\s*\[[^\]]*\]/);

    return {
      start: isCommandMode
        ? { line: cursor.line, ch: 0 }
        : { line: cursor.line, ch: atIndex },
      end: cursor,
      query: textAfterAt,
    };
  }

  async getSuggestions(
    context: { query: string; editor: Editor; file: TFile; start: EditorPosition; end: EditorPosition },
  ): Promise<AtCompletionSuggestion[]> {
    const q = context.query.toLowerCase();
    const isCommandMode = context.start != null && context.start.ch === 0;

    if (isCommandMode) {
      const macros: AtCompletionSuggestion[] = [
        { label: "@inbox", insert: "- [ ]  @today ", description: "Inbox task with today date" },
        { label: "@td", insert: "- [ ]  @today ", description: "Today task skeleton" },
        { label: "@tm", insert: "- [ ]  @tomorrow ", description: "Tomorrow task skeleton" },
        { label: "@tk", insert: "- [ ]  ", description: "Task skeleton (no date)" },
        { label: "@now", insert: "- [ ]  @today @15m ", description: "Quick 15m task now" },
        { label: "@1h", insert: "- [ ]  @today @1h ", description: "Quick 1h task today" },
        { label: "@rec", insert: "- [ ]  \u{1F501} every day @today ", description: "Recurring daily task" },
        { label: "@rep", insert: "- [ ]  \u{1F501} every week @monday ", description: "Recurring weekly task" },
        { label: "@today", insert: "```flowtime-today\n```", description: "Today tasks code block" },
        { label: "@overdue", insert: "```flowtime-overdue\n```", description: "Overdue tasks code block" },
        { label: "@soon", insert: "```flowtime-soon\n```", description: "Up next tasks code block" },
        {
          label: "@today-note",
          insert: "```flowtime-today\n```\n\n## \u{1F504} Carry Over\n```flowtime-overdue\n```\n\n## \u25CC Up Next\n```flowtime-soon\n```",
          description: "Today note (3-section block)",
        },
        { label: "@weekly", insert: "```flowtime-weekly\n```", description: "Weekly view code block" },
        { label: "@budget", insert: "```flowtime-buckets\n```", description: "Budget overview code block" },
        { label: "@sessions", insert: "```flowtime-sessions\n```", description: "Session history code block" },
        { label: "@proj", insert: "```flowtime-project\n```", description: "Project tasks code block" },
        { label: "@dueweek", insert: "```flowtime-dueweek\n```", description: "Due this week code block" },
        { label: "@weekplan", insert: "```flowtime-weekplan\n```", description: "Week plan code block" },
      ];
      return macros
        .filter((m) => m.label.slice(1).includes(q))
        .map((m) => ({ ...m, type: "macro" }));
    }

    // ── DIRECTIVE MODE ──
    const suggestions: AtCompletionSuggestion[] = [];

    const dates = [
      { label: "today", description: "Current date" },
      { label: "tomorrow", description: "Next day" },
      { label: "yesterday", description: "Previous day" },
      { label: "monday", description: "Next Monday" },
      { label: "tuesday", description: "Next Tuesday" },
      { label: "wednesday", description: "Next Wednesday" },
      { label: "thursday", description: "Next Thursday" },
      { label: "friday", description: "Next Friday" },
      { label: "saturday", description: "Next Saturday" },
      { label: "sunday", description: "Next Sunday" },
      { label: "next-week", description: "7 days from now" },
      { label: "next-monday", description: "Monday after next" },
    ];
    const durations = [
      { label: "15m", description: "15 minutes" },
      { label: "30m", description: "30 minutes" },
      { label: "45m", description: "45 minutes" },
      { label: "1h", description: "1 hour" },
      { label: "1.5h", description: "1 hour 30 minutes" },
      { label: "2h", description: "2 hours" },
      { label: "3h", description: "3 hours" },
    ];
    const buckets = (this.plugin?.settings?.buckets || []).map((b: BucketDef) => ({
      label: "b:" + b.id,
      description: b.name,
    }));
    const dueDates = [
      { label: "due:today", description: "Due today" },
      { label: "due:tomorrow", description: "Due tomorrow" },
    ];
    const inboxAction = [{ label: "inbox", description: "Capture line to inbox" }];
    const statusTags = [
      { label: "soon", description: "Up next / backlog item" },
      { label: "high", description: "\u{1F7E5} High priority" },
      { label: "med", description: "\u{1F7E8} Medium priority" },
      { label: "low", description: "\u{1F7E9} Low priority" },
    ];

    let projects: Array<{ label: string; description: string }> = [];
    try {
      if (this.plugin?.projectEngine) {
        const projList = await this.plugin.projectEngine.getAllProjects();
        projects = projList.map((p) => ({ label: "p:" + p.name, description: "Project" }));
      }
    } catch (_) { /* ignore */ }

    if (q.startsWith("b:") || q.startsWith("bucket:")) {
      const bucketQ = q.replace(/^(b:|bucket:)/, "");
      for (const b of buckets) {
        if (b.label.toLowerCase().includes(bucketQ) || b.description.toLowerCase().includes(bucketQ))
          suggestions.push({ label: "@" + b.label, description: b.description, type: "bucket" });
      }
    } else if (q.startsWith("due:")) {
      const dueQ = q.slice(4);
      for (const d of dueDates) {
        if (d.label.toLowerCase().includes(dueQ))
          suggestions.push({ label: "@" + d.label, description: d.description, type: "due" });
      }
    } else if (q.startsWith("p:")) {
      const pQ = q.slice(2);
      for (const p of projects) {
        if (p.label.toLowerCase().includes(pQ) || p.description.toLowerCase().includes(pQ))
          suggestions.push({ label: "@" + p.label, description: p.description, type: "project" });
      }
    } else {
      for (const i of inboxAction)
        if (i.label.toLowerCase().includes(q))
          suggestions.push({ label: "@" + i.label, description: i.description, type: "status" });
      for (const d of dates)
        if (d.label.toLowerCase().includes(q))
          suggestions.push({ label: "@" + d.label, description: d.description, type: "date" });
      for (const d of durations)
        if (d.label.toLowerCase().includes(q))
          suggestions.push({ label: "@" + d.label, description: d.description, type: "duration" });
      for (const b of buckets)
        if (b.label.toLowerCase().includes(q) || b.description.toLowerCase().includes(q))
          suggestions.push({ label: "@" + b.label, description: b.description, type: "bucket" });
      for (const d of dueDates)
        if (d.label.toLowerCase().includes(q))
          suggestions.push({ label: "@" + d.label, description: d.description, type: "due" });
      for (const p of projects)
        if (p.label.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
          suggestions.push({ label: "@" + p.label, description: p.description, type: "project" });
      for (const s of statusTags)
        if (s.label.toLowerCase().includes(q))
          suggestions.push({ label: "@" + s.label, description: s.description, type: "status" });
    }

    return suggestions.slice(0, 14);
  }

  renderSuggestion(suggestion: AtCompletionSuggestion, el: HTMLElement): void {
    const icons: Record<string, string> = {
      date: "\u{1F4C5}", duration: "\u23F1", bucket: "\u{1F4CA}",
      due: "\u23F0", project: "\u{1F4C1}", macro: "\u26A1", status: "\u{1F3F7}",
    };
    const icon = icons[suggestion.type || ""] || "\u2022";
    if (suggestion.type === "macro") {
      el.createEl("span", { text: icon + " " + suggestion.label, cls: "ft-at-completion-label" });
      el.createEl("small", {
        text: "  \u2192 " + (suggestion.insert || "").replace(/\n/g, "\u21B5 "),
        cls: "ft-at-completion-desc",
      });
    } else {
      el.createEl("span", { text: icon + " " + suggestion.label, cls: "ft-at-completion-label" });
      el.createEl("small", { text: "  " + suggestion.description, cls: "ft-at-completion-desc" });
    }
  }

  selectSuggestion(suggestion: AtCompletionSuggestion, _event: KeyboardEvent | MouseEvent): void {
    if (!this.context) return;
    const editor = this.context.editor;
    const { start, end } = this.context;

    if (suggestion.label === "@inbox") {
      const line = editor.getLine(start.line);
      const beforeText = line.slice(0, start.ch).trim();
      if (!beforeText) {
        this.plugin.notify("\u{1F4E5} Nothing to capture \u2014 type task text before @inbox", true);
        return;
      }
      let inboxLine = beforeText;
      if (!inboxLine.startsWith("- [ ]") && !inboxLine.startsWith("- [x]")) {
        inboxLine = "- [ ] " + inboxLine;
      }
      editor.replaceRange("", { line: start.line, ch: 0 }, end);
      void this._appendToInbox(inboxLine);
      return;
    }

    if (suggestion.type === "project" && suggestion.label.startsWith("@p:")) {
      const line = editor.getLine(start.line);
      const beforeText = line.slice(0, start.ch).trim();
      if (!beforeText) {
        this.plugin.notify("\u{1F4C1} Nothing to capture \u2014 type task text before @p:", true);
        return;
      }
      let taskLine = beforeText;
      if (!taskLine.startsWith("- [ ]") && !taskLine.startsWith("- [x]")) {
        taskLine = "- [ ] " + taskLine;
      }
      editor.replaceRange("", { line: start.line, ch: 0 }, end);
      void this._appendToProject(taskLine, suggestion.label.slice(3));
      return;
    }

    if (suggestion.type === "macro") {
      editor.replaceRange(suggestion.insert!, start, end);
    } else {
      editor.replaceRange(suggestion.label + " ", start, end);
    }
  }

  private async _appendToInbox(line: string): Promise<void> {
    const path = this.plugin.settings.inboxPath || "Inbox.md";
    try {
      const app = this.plugin.app;
      const exists = await app.vault.adapter.exists(path);
      if (!exists) {
        await app.vault.create(
          path,
          "# \u{1F4E5} Inbox\n\nCapture tasks, ideas, and notes here. One line per item.\nProcess them with **Flowtime: Process Inbox**.\n",
        );
      }
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return;
      const content = await app.vault.read(file);
      await app.vault.modify(file, content.trimEnd() + "\n" + line.trimEnd() + "\n");
      this.plugin.notify("\u{1F4E5} Added to inbox");
    } catch (e) {
      console.warn("Flowtime: failed to append to inbox:", (e as Error).message);
    }
  }

  private async _appendToProject(line: string, projectName: string): Promise<void> {
    try {
      const projects = await this.plugin.projectEngine.getAllProjects();
      const match = projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase());
      if (!match) {
        this.plugin.notify("\u{1F4C1} Project '" + projectName + "' not found", true);
        return;
      }
      const folder = match.path.substring(0, match.path.lastIndexOf("/"));
      const tasksPath = folder + "/" + match.name + " Tasks.md";
      const app = this.plugin.app;
      let tasksFile = app.vault.getAbstractFileByPath(tasksPath);
      if (!tasksFile) {
        tasksFile = app.vault.getAbstractFileByPath(match.path);
      }
      if (!(tasksFile instanceof TFile)) return;
      const content = await app.vault.read(tasksFile);
      await app.vault.modify(tasksFile, content.trimEnd() + "\n" + line.trimEnd() + "\n");
      this.plugin.notify("\u{1F4C1} Added to " + match.name);
    } catch (e) {
      console.warn("Flowtime: failed to append to project:", (e as Error).message);
    }
  }
}
