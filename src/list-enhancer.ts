/**
 * v1.3.0: ListEnhancer — enhances markdown notes with interactive task features
 * when the note has `type: flowtime-list` in its frontmatter.
 *
 * The note itself IS the task list. The plugin:
 * - Detects task lines (- [ ]) in the rendered preview
 * - Adds drag handles, interactive checkboxes, inline timers
 * - Makes ### headings into drop zones for date/status changes
 * - Persists all changes back to the source markdown file
 */

import type { App, TFile, Vault } from "obsidian";
import type { FlowtimeSettings } from "./types";
import { parseTaskLine, parseRecurrence, isRecurrenceDue } from "./task-parser";
import { toggleCheck, updateDate } from "./task-utils";

interface FlowtimePluginRef {
  app: App;
  settings: FlowtimeSettings;
  notify: (msg: string, isError?: boolean) => void;
  statusTimer?: {
    start(taskName: string, totalSeconds: number): void;
    stop(): void;
    pause(): void;
  };
}

interface NoteSection {
  heading: string | null;
  level: number;
  tasks: NoteTask[];
  startLine?: number;
}

interface NoteTask {
  line: number;
  indent: number;
  checked: boolean;
  text: string;
  raw: string;
}

/** Parsed heading text → drop action */
interface HeadingAction {
  type: "date" | "soon" | "none";
  date?: string;
}

export class ListEnhancer {
  private app: App;
  private plugin: FlowtimePluginRef;
  private _active: boolean = false;
  private _currentPath: string | null = null;
  private _currentFile: TFile | null = null;
  private _dispose: (() => void) | null = null;
  private _observer: MutationObserver | null = null;
  private _observeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(app: App, plugin: FlowtimePluginRef) {
    this.app = app;
    this.plugin = plugin;
  }

  async check(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return this.deactivate();

    if (this._currentPath === file.path && this._active) return;

    const cache = this.app.metadataCache.getCache(file.path);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    const isListNote = fm?.type === "flowtime-list";

    if (isListNote) {
      await this.activate(file);
    } else if (this._active) {
      this.deactivate();
    }
  }

  async activate(file: TFile): Promise<void> {
    this.deactivate();
    this._active = true;
    this._currentPath = file.path;
    this._currentFile = file;
    setTimeout(() => this._enhance(), 500);
  }

  deactivate(): void {
    if (this._dispose) {
      this._dispose();
      this._dispose = null;
    }
    this._cleanupDOM();
    this._active = false;
    this._currentPath = null;
    this._currentFile = null;
  }

  /* ─── Document Parser ─── */

  _parseNote(content: string): NoteSection[] {
    const lines = content.split("\n");
    const sections: NoteSection[] = [];
    let currentSection: NoteSection = { heading: null, level: 0, tasks: [] };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        if (currentSection.tasks.length > 0 || currentSection.heading) {
          sections.push(currentSection);
        }
        currentSection = {
          heading: headingMatch[2].trim(),
          level: headingMatch[1].length,
          tasks: [],
          startLine: i,
        };
        continue;
      }
      const taskMatch = line.match(/^(\s*)[-*+]\s+\[([ xX\-])\]\s+(.*)$/);
      if (taskMatch) {
        currentSection.tasks.push({
          line: i,
          indent: taskMatch[1].length,
          checked: taskMatch[2] !== " ",
          text: taskMatch[3],
          raw: line,
        });
      }
    }

    if (currentSection.tasks.length > 0 || currentSection.heading) {
      sections.push(currentSection);
    }
    return sections;
  }

  /* ─── Heading Drop Zone Logic ─── */

  /**
   * Parse a heading text to determine the drop action.
   * Returns { type: "date"|"soon"|"none", date?: YYYY-MM-DD }
   */
  _parseHeadingAction(headingText: string): HeadingAction {
    const h = headingText.toLowerCase().trim();

    if (h === "today") return { type: "date", date: new Date().toISOString().split("T")[0] };

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (h === "tomorrow") return { type: "date", date: tomorrow.toISOString().split("T")[0] };

    if (h === "overdue" || h === "overdue") {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return { type: "date", date: yesterday.toISOString().split("T")[0] };
    }

    if (h === "soon") return { type: "soon" };

    if (h === "next week") {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return { type: "date", date: d.toISOString().split("T")[0] };
    }

    // YYYY-MM-DD pattern
    const dateMatch = h.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (dateMatch) {
      return { type: "date", date: dateMatch[1] };
    }

    return { type: "none" };
  }

  /* ─── DOM Enhancement ─── */

  _enhance(): void {
    this._cleanupDOM();
    const view = this.app.workspace.activeEditor as { previewEl?: HTMLElement } | null;

    const container =
      view?.previewEl || document.querySelector(".markdown-source-view") as HTMLElement | null;

    if (!container) {
      setTimeout(() => this._enhance(), 300);
      return;
    }

    const selector = ".task-list-item:not(.ft-list-enhanced), .HyperMD-task-line:not(.ft-list-enhanced)";
    const taskEls = container.querySelectorAll(selector);
    if (taskEls.length === 0) {
      setTimeout(() => this._enhance(), 500);
      return;
    }

    // Parse the note to map line numbers to DOM elements
    this._taskLineMap = new Map<HTMLElement, number>();
    if (this._currentFile) {
      // Read the file content and match task lines to DOM order
      this.app.vault.read(this._currentFile).then((content) => {
        const lines = content.split("\n");
        const taskLineNumbers: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(/^\s*[-*+]\s+\[[ xX\-]\]/)) {
            taskLineNumbers.push(i);
          }
        }
        // Match DOM task elements to line numbers by order
        let idx = 0;
        for (const el of taskEls) {
          if (idx < taskLineNumbers.length) {
            this._taskLineMap.set(el as HTMLElement, taskLineNumbers[idx]);
            idx++;
          }
        }
      }).catch(() => { /* fine */ });
    }

    for (const el of taskEls) {
      this._enhanceTaskLine(el as HTMLElement);
    }

    // Enhance headings as drop zones
    this._enhanceHeadingDropZones(container);

    this._setupDragDrop(container);

    if (!this._observer) {
      this._observer = new MutationObserver(() => {
        clearTimeout(this._observeTimer);
        this._observeTimer = setTimeout(() => this._enhance(), 500);
      });
      this._observer.observe(container, { childList: true, subtree: true });
    }
  }

  private _taskLineMap: Map<HTMLElement, number> = new Map();

  /** Add drag handle, checkbox click, and inline timer to a task line element */
  _enhanceTaskLine(el: HTMLElement): void {
    if (el.classList.contains("ft-list-enhanced")) return;
    el.classList.add("ft-list-enhanced");

    const isPreview = el.classList.contains("task-list-item");
    const insertPoint = isPreview
      ? el.firstChild
      : (el.querySelector(".cm-formatting-task")?.nextSibling || el.firstChild);

    // ── Drag handle ──
    const handle = document.createElement("span");
    handle.textContent = "\u283F"; // ⠿ braille drag indicator
    handle.className = "ft-list-drag ft-enhance-drag";
    handle.setAttribute("title", "Drag to reorder or drop on heading");
    el.insertBefore(handle, insertPoint);

    if (!isPreview) {
      handle.style.position = "absolute";
      handle.style.left = "0";
      handle.style.top = "0";
      handle.style.zIndex = "1";
      el.style.position = "relative";
      el.style.paddingLeft = "22px";
    }

    // ── Checkbox click handler ──
    const checkboxEl = el.querySelector(isPreview
      ? 'input[type="checkbox"]'
      : '.cm-formatting-task') as HTMLElement | null;

    if (checkboxEl && this._currentFile) {
      el.addEventListener("click", async (e: MouseEvent) => {
        // Only handle clicks on the checkbox area
        const target = e.target as HTMLElement;
        const isCheckClick = isPreview
          ? target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox"
          : target.classList.contains("cm-formatting-task");

        if (!isCheckClick) return;

        const lineNum = this._taskLineMap.get(el);
        if (lineNum == null) return;

        try {
          const content = await this.app.vault.read(this._currentFile!);
          const lines = content.split("\n");
          const line = lines[lineNum];
          if (!line) return;

          const isChecked = line.match(/\[x\]/i);
          const newLine = isChecked
            ? line.replace(/\[x\]/i, "[ ]")
            : line.replace(/\[ \]/, "[x]");

          lines[lineNum] = newLine;
          await this.app.vault.modify(this._currentFile!, lines.join("\n"));

          // Handle recurrence: if completed, generate next instance
          if (!isChecked) {
            await this._handleRecurrence(lineNum, line);
          }
        } catch (e) {
          console.warn("Flowtime ListEnhancer: toggle error:", (e as Error).message);
        }
      });
    }

    // ── Inline timer button ──
    const timerBtn = document.createElement("span");
    timerBtn.textContent = "\u23F1"; // ⏱
    timerBtn.className = "ft-enhance-timer";
    timerBtn.setAttribute("title", "Start timer");
    timerBtn.style.cursor = "pointer";
    timerBtn.style.marginLeft = "6px";
    timerBtn.style.fontSize = "0.85em";
    timerBtn.style.opacity = "0.5";

    let timerActive = false;
    const taskText = (el.textContent || "").replace(/^\s*[-*+]\s*\[[ xX\-]\]\s*/, "").trim();

    timerBtn.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      if (!this.plugin.statusTimer) return;

      if (timerActive) {
        this.plugin.statusTimer.stop();
        timerActive = false;
        timerBtn.textContent = "\u23F1";
        timerBtn.style.opacity = "0.5";
      } else {
        // Try to extract duration from task text
        const durMatch = taskText.match(/@(\d+(?:\.\d+)?)([hm])/);
        const seconds = durMatch
          ? (durMatch[2] === "h" ? parseFloat(durMatch[1]) * 3600 : parseFloat(durMatch[1]) * 60)
          : 1500; // default 25 min
        this.plugin.statusTimer.start(taskText, Math.round(seconds));
        timerActive = true;
        timerBtn.textContent = "\u23F8";
        timerBtn.style.opacity = "1";
      }
    });

    el.appendChild(timerBtn);
  }

  /**
   * Handle recurrence: when a recurring task is completed,
   * generate the next instance by updating the date directive.
   */
  private async _handleRecurrence(lineNum: number, line: string): Promise<void> {
    if (!this._currentFile) return;
    const recurrence = parseRecurrence(line);
    if (!recurrence) return;

    const today = new Date().toISOString().split("T")[0];
    if (!isRecurrenceDue(recurrence, today, { workdays: this.plugin.settings.workdays })) return;

    // Generate next instance: update the date to the next due date
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    let nextDate: string | null = null;
    for (let i = 1; i <= 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const ds = d.toISOString().split("T")[0];
      if (isRecurrenceDue(recurrence, ds, { workdays: this.plugin.settings.workdays })) {
        nextDate = ds;
        break;
      }
    }

    if (nextDate) {
      const content = await this.app.vault.read(this._currentFile);
      const lines = content.split("\n");
      let nl = lines[lineNum];
      if (nl) {
        nl = nl.replace(/\[x\]/i, "[ ]");
        nl = nl.replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/u, "@" + nextDate);
        if (!nl.match(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/u)) {
          nl = nl.replace(/(\]\s*)/, "$1@" + nextDate + " ");
        }
        lines[lineNum] = nl;
        await this.app.vault.modify(this._currentFile, lines.join("\n"));
      }
    }
  }

  /** Add drop zone highlighting to h1-h6 headings in the document */
  _enhanceHeadingDropZones(container: HTMLElement): void {
    const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6");
    for (const h of headings) {
      if ((h as HTMLElement).dataset.ftDropZone) continue;
      const hel = h as HTMLElement;
      hel.dataset.ftDropZone = "true";

      const action = this._parseHeadingAction(hel.textContent || "");
      if (action.type === "none") continue;

      // Add subtle indicator that this heading is a drop zone
      hel.style.transition = "background 0.2s, outline 0.2s";
    }
  }

  /* ─── Cleanup ─── */

  _cleanupDOM(): void {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    document.querySelectorAll(".ft-list-enhanced").forEach((el) => {
      el.classList.remove("ft-list-enhanced");
      // Remove added elements
      el.querySelectorAll(".ft-enhance-drag, .ft-enhance-timer").forEach((c) => c.remove());
    });
    document.querySelectorAll("[data-ft-drop-zone]").forEach((el) => {
      delete (el as HTMLElement).dataset.ftDropZone;
    });
  }

  /* ─── Drag & Drop with Heading Zones ─── */

  _setupDragDrop(container: HTMLElement): void {
    let dragState: {
      el: HTMLElement;
      startX: number;
      startY: number;
    } | null = null;
    let moveFrame: number | null = null;

    // ── mousedown on drag handle starts drag ──
    container.addEventListener("mousedown", (e: MouseEvent) => {
      const handle = (e.target as HTMLElement).closest(".ft-enhance-drag");
      if (!handle) return;
      const row = handle.closest(".ft-list-enhanced") as HTMLElement | null;
      if (!row) return;

      e.preventDefault();
      this._clearDragIndicators(container);
      row.classList.add("ft-list-dragging");

      dragState = { el: row, startX: e.clientX, startY: e.clientY };
    });

    // ── mousemove: highlight drop target ──
    document.addEventListener("mousemove", (e: MouseEvent) => {
      if (!dragState) return;
      if (moveFrame) return;
      moveFrame = requestAnimationFrame(() => {
        moveFrame = null;
        if (!dragState) return;

        this._clearDragIndicators(container);
        dragState.el.classList.add("ft-list-dragging");

        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (!target) return;

        // Check for task row
        const targetRow = target.closest(".ft-list-enhanced") as HTMLElement | null;
        if (targetRow && targetRow !== dragState.el) {
          const rect = targetRow.getBoundingClientRect();
          if (e.clientY < rect.top + rect.height / 2) {
            targetRow.classList.add("ft-list-drop-before");
          } else {
            targetRow.classList.add("ft-list-drop-after");
          }
          return;
        }

        // Check for heading
        const heading = target.closest("h1, h2, h3, h4, h5, h6") as HTMLElement | null;
        if (heading && heading.dataset.ftDropZone) {
          heading.classList.add("ft-list-heading-active");
        }
      });
    });

    // ── mouseup: execute drop ──
    document.addEventListener("mouseup", async (e: MouseEvent) => {
      if (!dragState) return;

      const target = document.elementFromPoint(e.clientX, e.clientY);
      const action = this._executeDrop(container, dragState.el, target as HTMLElement | null);

      this._clearDragIndicators(container);
      dragState = null;

      if (action === "heading") {
        // Heading drop was handled — schedule re-enhance after file changes propagate
        setTimeout(() => this._enhance(), 800);
      }
    });
  }

  /** Clear all drag visual indicators */
  _clearDragIndicators(container: HTMLElement): void {
    container.querySelectorAll(
      ".ft-list-dragging, .ft-list-drop-before, .ft-list-drop-after, .ft-list-heading-active",
    ).forEach((el) => {
      el.classList.remove(
        "ft-list-dragging", "ft-list-drop-before", "ft-list-drop-after", "ft-list-heading-active",
      );
    });
  }

  /** Execute a drop action. Returns "reorder" | "heading" | "none" */
  _executeDrop(container: HTMLElement, sourceEl: HTMLElement, targetEl: HTMLElement | null): string {
    if (!targetEl || !this._currentFile) return "none";

    // ── Drop on heading → change date/status ──
    const heading = targetEl.closest("h1, h2, h3, h4, h5, h6") as HTMLElement | null;
    if (heading && heading.dataset.ftDropZone) {
      const action = this._parseHeadingAction(heading.textContent || "");
      if (action.type === "none") return "none";

      const lineNum = this._taskLineMap.get(sourceEl);
      if (lineNum == null) return "none";

      void this._applyHeadingDrop(lineNum, action);
      return "heading";
    }

    // ── Drop on another task row → reorder ──
    const targetRow = targetEl.closest(".ft-list-enhanced") as HTMLElement | null;
    if (targetRow && targetRow !== sourceEl) {
      const srcLine = this._taskLineMap.get(sourceEl);
      const tgtLine = this._taskLineMap.get(targetRow);
      if (srcLine != null && tgtLine != null) {
        void this._reorderTasks(srcLine, tgtLine, targetRow.classList.contains("ft-list-drop-after"));
      }
      return "reorder";
    }

    return "none";
  }

  /** Apply a heading drop: change the task's date or add @soon */
  private async _applyHeadingDrop(lineNum: number, action: HeadingAction): Promise<void> {
    if (!this._currentFile) return;
    try {
      const content = await this.app.vault.read(this._currentFile);
      const lines = content.split("\n");
      let line = lines[lineNum];
      if (!line) return;

      if (action.type === "soon") {
        // Remove any date, add @soon
        line = line.replace(/\s*[@⏳📅]\s*\d{4}-\d{2}-\d{2}/u, "");
        if (!line.match(/@soon\b/)) {
          line += " @soon";
        }
        lines[lineNum] = line;
        await this.app.vault.modify(this._currentFile, lines.join("\n"));
        this.plugin.notify?.("\u25CC Task sent to Soon");
      } else if (action.type === "date" && action.date) {
        // Set or update date
        const re = /[@⏳📅]\s*\d{4}-\d{2}-\d{2}/u;
        line = re.test(line)
          ? line.replace(re, "@" + action.date)
          : line.replace(/^(\s*[-*+]\s*\[[^\]]*\]\s*)(.*)$/, "$1$2 @" + action.date);
        // Remove @soon if present
        line = line.replace(/@soon\b\s*/gi, "");
        lines[lineNum] = line;
        await this.app.vault.modify(this._currentFile, lines.join("\n"));
        this.plugin.notify?.("\u{1F4C5} Task date: " + action.date);
      }
    } catch (e) {
      console.warn("Flowtime ListEnhancer: drop error:", (e as Error).message);
    }
  }

  /** Reorder two tasks by swapping their lines */
  private async _reorderTasks(srcLine: number, tgtLine: number, after: boolean): Promise<void> {
    if (!this._currentFile) return;
    try {
      const content = await this.app.vault.read(this._currentFile);
      const lines = content.split("\n");
      const src = lines[srcLine];
      const destIdx = after ? tgtLine + 1 : tgtLine;
      lines.splice(srcLine, 1);
      lines.splice(destIdx, 0, src);
      await this.app.vault.modify(this._currentFile, lines.join("\n"));
      this.plugin.notify?.("\u283F Task reordered");
    } catch (e) {
      console.warn("Flowtime ListEnhancer: reorder error:", (e as Error).message);
    }
  }
}
