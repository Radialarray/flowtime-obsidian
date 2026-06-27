import { Modal, TFile } from "obsidian";
import type { App } from "obsidian";
import { parseDate } from "./date-parser";
import type { FlowtimeSettings } from "./types";
import { activeDoc } from "./task-utils";

interface FlowtimePluginRef {
  settings: FlowtimeSettings;
  notify: (msg: string, isError?: boolean) => void;
  projectEngine?: {
    getAllProjects(): Promise<Array<{ name: string; path: string }>>;
    resolve(filePath: string): Promise<{ name: string | null; path: string | null; source: string | null }>;
  };
}

export class QuickEntryModal extends Modal {
  plugin: FlowtimePluginRef;

  constructor(app: App, plugin: FlowtimePluginRef) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("flowtime-quick-entry");

    contentEl.createEl("h2", { text: "Add Task" });

    // ── Task text ──
    contentEl.createEl("label", { text: "Task", cls: "flowtime-label" });
    const taskInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "What needs to be done?",
      cls: "flowtime-input",
    });
    taskInput.focus();

    // ── Date ──
    contentEl.createEl("label", { text: "Date", cls: "flowtime-label" });
    const dateRow = contentEl.createEl("div", { cls: "flowtime-row" });
    const dateInput = dateRow.createEl("input", {
      type: "text",
      placeholder: "today, tomorrow, next monday, 2026-06-24",
      value: "today",
      cls: "flowtime-input",
    });
    const datePreview = dateRow.createEl("span", {
      text: "\u2192 @" + (parseDate("today") || "\u2014"),
      cls: "flowtime-date-preview",
    });

    // ── Live preview container ──
    const preview = contentEl.createEl("div", { cls: "flowtime-preview" });
    preview.createEl("div", { text: "Preview:", cls: "flowtime-label" });
    const previewCode = preview.createEl("code", { cls: "flowtime-preview-code" });

    // ── Project ──
    contentEl.createEl("label", { text: "Project", cls: "flowtime-label" });
    const projInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "Type or select a project",
      cls: "flowtime-input",
    });

    const projDD = activeDoc(this.app).createElement("div");
    projDD.className = "flowtime-proj-dd";
    let allProjects: Array<{ name: string; path: string }> = [];

    const openDD = (): void => {
      const r = projInput.getBoundingClientRect();
      projDD.setCssStyles({
        left: Math.max(4, Math.min(r.left, window.innerWidth - r.width - 8)) + "px",
        top: Math.min(r.bottom + 4, window.innerHeight - 220) + "px",
        width: r.width + "px",
        display: "block",
      });
      activeDoc(this.app).body.appendChild(projDD);
      populateDD(projInput.value);
    };

    const closeDD = (): void => {
      projDD.setCssProps({ display: "none" });
      if (projDD.parentNode) projDD.parentNode.removeChild(projDD);
    };

    const populateDD = (query: string): void => {
      projDD.empty();
      const q = query.toLowerCase().trim();
      const matches = q
        ? allProjects.filter((p) => p.name.toLowerCase().includes(q))
        : allProjects;
      for (const proj of matches.slice(0, 8)) {
        const item = projDD.createEl("button", { text: proj.name, cls: "flowtime-proj-dd-item" });
        item.addEventListener("click", () => {
          projInput.value = proj.name;
          closeDD();
          updateLivePreview();
        });
      }
      if (matches.length === 0) {
        projDD.createEl("div", { text: "No projects found", cls: "flowtime-proj-dd-empty" });
      }
    };

    projInput.addEventListener("focus", () => openDD());
    projInput.addEventListener("input", () => {
      if (!projDD.parentNode) openDD();
      else populateDD(projInput.value);
      updateLivePreview();
    });
    projInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDD();
    });
    projInput.addEventListener("blur", () => {
      window.setTimeout(closeDD, 150);
    });

    // Load projects + auto-detect (deferred — defined after updateLivePreview)

    // ── Duration ──
    contentEl.createEl("label", { text: "Duration", cls: "flowtime-label" });
    const durSelect = contentEl.createEl("select", { cls: "flowtime-select" });
    const durations = [0, 10, 15, 20, 25, 30, 45, 60, 90, 120, 150, 180, 210, 240];
    for (const d of durations) {
      durSelect.createEl("option", {
        text: d === 0 ? "None" : d < 60 ? d + "m" : d / 60 + "h",
        value: String(d),
      });
    }

    // ── Bucket ──
    contentEl.createEl("label", { text: "Bucket", cls: "flowtime-label" });
    const bucketSelect = contentEl.createEl("select", { cls: "flowtime-select" });
    const buckets = this.plugin.settings.buckets || [];
    bucketSelect.createEl("option", { text: "None", value: "" });
    for (const b of buckets) {
      bucketSelect.createEl("option", { text: b.name, value: b.id, attr: { "data-color": b.color } });
    }

    // ── Parent task dropdown for subtask hierarchy ──
    contentEl.createEl("label", { text: "Subtask of", cls: "flowtime-label" });
    const parentSelect = contentEl.createEl("select", { cls: "flowtime-select" });
    parentSelect.createEl("option", { text: "None (top-level)", value: "" });

    const activeFile = this.app.workspace.getActiveFile();

    void (async (): Promise<void> => {
      let target: TFile | null = activeFile;
      const targetSetting = this.plugin.settings.quickEntryTargetFile;

      if (targetSetting === "daily-note") {
        const today = new Date().toISOString().split("T")[0];
        const allFiles = this.app.vault.getMarkdownFiles();
        const dailyFile = allFiles.find((f: TFile) => f.basename === today);
        if (dailyFile) target = dailyFile;
      } else if (targetSetting === "inbox") {
        const inbox = this.app.vault.getAbstractFileByPath(
          this.plugin.settings.inboxPath || "Inbox.md",
        );
        if (inbox instanceof TFile) target = inbox;
      }

      if (!target) return;

      try {
        const content = await this.app.vault.read(target);
        const lines = content.split("\n");
        const { parseTaskLine } = await import("./task-parser");

        const candidates: ReturnType<typeof parseTaskLine>[] = [];
        for (let i = 0; i < lines.length; i++) {
          const parsed = parseTaskLine(lines[i], target, i);
          if (parsed && parsed.indent === 0 && parsed.status !== "x") {
            candidates.push(parsed);
          }
        }

        const currentVal = parentSelect.value;
        parentSelect.empty();
        parentSelect.createEl("option", { text: "None (top-level)", value: "" });
        for (const c of candidates.slice(0, 20)) {
          if (!c) continue;
          const opt = parentSelect.createEl("option", {
            text: c.cleanText.slice(0, 60),
            value: String(c.line),
          });
          if (currentVal && String(c.line) === currentVal) {
            opt.selected = true;
          }
        }
      } catch (_) { /* fine */ }
    })();

    // ── Live preview ──
    const updateLivePreview = (): void => {
      const date = parseDate(dateInput.value);
      const project = projInput.value.trim();
      const task = taskInput.value.trim();
      let line = "- [ ] " + (task || "task description");
      if (project) line += " #" + this.plugin.settings.tagPrefix + project;
      if (date) line += " @" + date;
      const dur = parseInt(durSelect.value, 10);
      if (dur && dur > 0) {
        const durStr = dur < 60 ? dur + "m" : dur / 60 + "h";
        line += " @" + durStr;
      }
      const bucket = bucketSelect.value;
      if (bucket) line += " @b:" + bucket;
      const parentLine = parentSelect ? parentSelect.value : "";
      if (parentLine) line = "  " + line;
      previewCode.setText(line);
    };

    dateInput.addEventListener("input", () => {
      const parsed = parseDate(dateInput.value);
      datePreview.setText(parsed ? "\u2192 @" + parsed : "\u2192 ?");
      datePreview.toggleClass("flowtime-date-invalid", !parsed);
      updateLivePreview();
    });

    taskInput.addEventListener("input", updateLivePreview);
    projInput.addEventListener("input", updateLivePreview);
    durSelect.addEventListener("change", updateLivePreview);
    bucketSelect.addEventListener("change", updateLivePreview);
    parentSelect.addEventListener("change", updateLivePreview);
    updateLivePreview();

    // ── Async project auto-detection ──
    if (this.plugin.projectEngine) {
      void (async () => {
        allProjects = await this.plugin.projectEngine!.getAllProjects();
        if (activeFile) {
          try {
            const result = await this.plugin.projectEngine!.resolve(activeFile.path);
            if (result?.name && !projInput.value) {
              projInput.value = result.name;
              updateLivePreview();
            }
          } catch (_) { /* fine */ }
        }
      })();
    }

    // ── Buttons ──
    const btnRow = contentEl.createEl("div", { cls: "flowtime-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: "Cancel", cls: "flowtime-btn-cancel" });
    const submitBtn = btnRow.createEl("button", { text: "Add Task", cls: "flowtime-btn-submit" });

    cancelBtn.addEventListener("click", () => this.close());

    const doSubmit = async (): Promise<void> => {
      const task = taskInput.value.trim();
      if (!task) {
        this.plugin.notify("Task description is required", true);
        return;
      }

      const date = parseDate(dateInput.value);
      const project = projInput.value.trim();
      const parentIndent = parentSelect.value ? "  " : "";
      let line = parentIndent + "- [ ] " + task;
      if (project) line += " #" + this.plugin.settings.tagPrefix + project;
      if (date) line += " @" + date;
      const dur = parseInt(durSelect.value, 10);
      if (dur && dur > 0) {
        const durStr = dur < 60 ? dur + "m" : dur / 60 + "h";
        line += " @" + durStr;
      }
      const bucket = bucketSelect.value;
      if (bucket) line += " @b:" + bucket;

      let targetFile: TFile | null = activeFile;
      const target = this.plugin.settings.quickEntryTargetFile;

      if (target === "daily-note") {
        const today = new Date().toISOString().split("T")[0];
        targetFile = activeFile;
        const dnConfigPath = this.app.vault.configDir + "/daily-notes.json";
        try {
          const adapter = this.app.vault.adapter;
          const folder = (await adapter.exists(dnConfigPath))
            ? (JSON.parse(await adapter.read(dnConfigPath)) as { folder?: string }).folder || ""
            : "";
          const path = folder ? folder + "/" + today + ".md" : today + ".md";
          const resolved = this.app.vault.getAbstractFileByPath(path);
          if (resolved instanceof TFile) targetFile = resolved;
        } catch (_) { /* fine */ }
      } else if (target === "project-file" && project) {
        const engine = this.plugin.projectEngine as unknown as { cache?: Map<string, { path: string | null }> } | undefined;
        const cached = activeFile && engine?.cache?.get?.(activeFile.path);
        if (cached?.path) {
          const f = this.app.vault.getAbstractFileByPath(cached.path);
          if (f instanceof TFile) targetFile = f;
        }
      } else if (target === "inbox") {
        const inboxPath = this.plugin.settings.inboxPath || "Inbox.md";
        const f = this.app.vault.getAbstractFileByPath(inboxPath);
        if (f instanceof TFile) {
          targetFile = f;
        } else {
          this.plugin.notify("Inbox not found. Run Flowtime: Process Inbox to create it.", true);
          return;
        }
      }

      if (!targetFile) {
        this.plugin.notify("No target file found...", true);
        return;
      }

      try {
        const content = await this.app.vault.read(targetFile);
        const newContent = content.trimEnd() + "\n" + line + "\n";
        await this.app.vault.modify(targetFile, newContent);
        this.plugin.notify("\u2705 Task added: " + task);
        this.close();
      } catch (e) {
        this.plugin.notify("\u274C Failed to add task: " + (e as Error).message, true);
      }
    };

    submitBtn.addEventListener("click", doSubmit);
    taskInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSubmit(); }
    });
    dateInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSubmit(); }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
