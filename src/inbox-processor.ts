import { Modal } from "obsidian";
import type { App, TFile } from "obsidian";
import { parseDate } from "./date-parser";
import type { FlowtimeSettings } from "./types";

// ── Plugin reference (avoids circular import) ──

interface FlowtimePluginRef {
  settings: FlowtimeSettings;
  notify: (msg: string, isError?: boolean) => void;
  _ensureInbox: () => Promise<void>;
  templateEngine: {
    createProject: (
      name: string,
      opts: { scaffoldTasks: boolean; scaffoldWiki: boolean },
    ) => Promise<{ notePath: string; tasksPath: string; wikiPath: string }>;
  };
  projectEngine: {
    getAllProjects: () => Promise<Array<{ name: string; path: string }>>;
  };
}

// ── Shared shapes ──

interface LineEntry {
  index: number;
  text: string;
}

// ── InboxItem class ──

export class InboxItem {
  text: string;
  index: number;

  constructor(text: string, index: number) {
    this.text = text;
    this.index = index;
  }

  setText(text: string): void {
    this.text = text;
  }
}

// ── Parsing ──

interface ParseInboxResult {
  items: InboxItem[];
  headings: LineEntry[];
}

/**
 * Parse inbox file content into processable items.
 *
 * Everything from the first `#` heading through the first block of
 * non-blank, non-heading description text (and the blank line that
 * follows it) is treated as the **header** and excluded from processing.
 *
 * This keeps the auto-created template instructions ("Capture tasks...",
 * "Process them...") from being treated as items.
 */
export function parseInbox(content: string): ParseInboxResult {
  const lines = content.split("\n");
  const items: InboxItem[] = [];
  const headings: LineEntry[] = [];

  // ── Find where content starts ──
  // State machine: skip the heading block (first # + desc lines + trailing blank)
  let contentStart = 0;
  let state: "before_heading" | "after_heading" | "in_description" =
    "before_heading";

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (state === "before_heading") {
      headings.push({ index: i, text: lines[i] });
      if (trimmed.startsWith("#")) state = "after_heading";
      // blank or text before heading → stay before_heading
      continue;
    }

    if (state === "after_heading") {
      if (trimmed === "") {
        headings.push({ index: i, text: lines[i] });
        // stay — more blanks after heading
      } else if (trimmed.startsWith("#")) {
        // Second heading → content starts here (no desc block)
        contentStart = i;
        break;
      } else {
        // First non-blank after heading — could be description or content
        headings.push({ index: i, text: lines[i] });
        state = "in_description";
      }
      continue;
    }

    if (state === "in_description") {
      if (trimmed === "") {
        // Blank line ends the description block → header complete
        headings.push({ index: i, text: lines[i] });
        contentStart = i + 1;
        break;
      } else if (trimmed.startsWith("#")) {
        // Next heading — content starts here
        contentStart = i;
        break;
      } else {
        // More description lines
        headings.push({ index: i, text: lines[i] });
      }
    }
  }

  // ── Process content lines ──
  for (let i = contentStart; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      headings.push({ index: i, text: raw });
      continue;
    }

    items.push(new InboxItem(raw, i));
  }

  return { items, headings };
}

// ── Reconstruct ──

/**
 * Reconstruct the inbox file after processing.
 * Processed items are removed; remaining items keep their original order.
 * Headings and blank lines are preserved at their original positions.
 *
 * @param items — items that were NOT processed
 * @param headings — all lines that are heads or desc (preserved in write-back)
 */
export function reconstructInbox(
  items: LineEntry[],
  headings: LineEntry[],
): string {
  // Merge headings and items back in order of their original index
  const all = [...headings, ...items].sort((a, b) => a.index - b.index);
  return (
    all
      .map((entry) => entry.text)
      .join("\n")
      .trimEnd() + "\n"
  );
}

// ── Tag detection ──

interface DetectedTags {
  date: string;
  duration: number;
  bucket: string;
  project: string;
  priority: string;
  snoozeDate: string;
  recurrence: string;
  isTaskLine: boolean;
}

/**
 * Extract metadata from a raw inbox line for pre-filling the processing form.
 * Parses @date, @duration, @b:bucket, @p:project, #project/Name, @snooze,
 * @high/@med/@low
 */
export function detectTags(text: string): DetectedTags {
  const remaining = text;

  // Date: @YYYY-MM-DD or natural date keyword
  let date = "";
  const dateMatch = remaining.match(/@(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    date = dateMatch[1];
  } else {
    // Try natural date keywords
    const naturalMatch = remaining.match(
      /@(today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next-week|next-monday)\b/i,
    );
    if (naturalMatch) {
      date = parseDate(naturalMatch[1]) || "";
    }
  }

  // Duration: @Nh or @Nm
  let duration = 0;
  const durMatch = remaining.match(/@(\d+(?:\.\d+)?)([hm])/);
  if (durMatch) {
    const val = parseFloat(durMatch[1]);
    duration = durMatch[2] === "h" ? Math.round(val * 60) : Math.round(val);
  }

  // Bucket: @b:name or @bucket:name
  let bucket = "";
  const bucketMatch = remaining.match(/@(?:bucket|b):([^\s]+)/);
  if (bucketMatch) bucket = bucketMatch[1];

  // Project: @p:Name
  let project = "";
  const pMatch = remaining.match(/@p:([^\s]+)/);
  if (pMatch) project = pMatch[1];

  // Priority
  let priority = "";
  if (remaining.match(/🟥/) || remaining.match(/@high\b/)) priority = "🟥";
  else if (remaining.match(/🟨/) || remaining.match(/@med\b/)) priority = "🟨";
  else if (remaining.match(/🟩/) || remaining.match(/@low\b/)) priority = "🟩";

  // Snooze: @snooze YYYY-MM-DD
  let snoozeDate = "";
  const snoozeMatch = remaining.match(/@snooze\s+(\d{4}-\d{2}-\d{2})/);
  if (snoozeMatch) snoozeDate = snoozeMatch[1];

  // Recurrence: 🔁 every <period>
  let recurrence = "";
  const recMatch = remaining.match(
    /🔁\s*every\s+(\d*\s*(?:day|days|week|weeks|month|months))/,
  );
  if (recMatch) recurrence = "🔁 every " + recMatch[1];

  // Already a task line?
  const isTaskLine = /^\s*[-*+]\s*\[[^\]]*\]/.test(remaining);

  return {
    date,
    duration,
    bucket,
    project,
    priority,
    snoozeDate,
    recurrence,
    isTaskLine,
  };
}

// ── Clean description ──

/**
 * Clean a line of all known directives, returning just the description text.
 */
export function cleanDescription(text: string): string {
  return text
    .replace(/^\s*[-*+]\s*\[[^\]]*\]\s*/, "") // checkbox prefix
    .replace(/@\d{4}-\d{2}-\d{2}/g, "")
    .replace(
      /@(today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next-week|next-monday)\b/gi,
      "",
    )
    .replace(/@\d+(?:\.\d+)?[hm]/g, "")
    .replace(/@(?:bucket|b):[^\s]+/g, "")
    .replace(/@p:[^\s]+/g, "")
    .replace(/@(?:high|med|low|soon|snooze)\b/gi, "")
    .replace(/@snooze\s+\d{4}-\d{2}-\d{2}/g, "")
    .replace(/[🟥🟨🟩]/gu, "")
    .replace(/🔁\s*every\s+\d*\s*(?:day|days|week|weeks|month|months)/g, "")
    .replace(/#\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Build task line ──

interface BuildTaskLineOpts {
  date?: string;
  durationMinutes?: number;
  bucket?: string;
  project?: string;
  priority?: string;
  recurrence?: string;
}

/**
 * Build a Flowtime task line from its components.
 */
export function buildTaskLine(
  description: string,
  opts: BuildTaskLineOpts = {},
): string {
  const parts = ["- [ ]", description];

  if (opts.priority) parts.push(opts.priority);
  if (opts.date) parts.push("@" + opts.date);
  if (opts.durationMinutes && opts.durationMinutes > 0) {
    const durStr =
      opts.durationMinutes < 60
        ? opts.durationMinutes + "m"
        : opts.durationMinutes / 60 + "h";
    parts.push("@" + durStr);
  }
  if (opts.bucket) parts.push("@b:" + opts.bucket);
  if (opts.project) parts.push("@p:" + opts.project);
  if (opts.recurrence) parts.push(opts.recurrence);

  return parts.join(" ") + "\n";
}

// ── Snooze check ──

/**
 * Check if a snoozed line should appear for processing.
 * Lines with @snooze YYYY-MM-DD where the date has not yet arrived are hidden.
 */
export function isSnoozed(text: string): boolean {
  const match = text.match(/@snooze\s+(\d{4}-\d{2}-\d{2})/);
  if (!match) return false;
  const snoozeDate = new Date(match[1] + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return snoozeDate > today;
}

// ── Ref types for dynamic form field containers ──

interface TaskFieldRefs {
  dateInput: HTMLInputElement;
  durSelect: HTMLSelectElement;
  bucketSelect: HTMLSelectElement;
  projInput: HTMLInputElement;
  prioSelect: HTMLSelectElement;
  recSelect: HTMLSelectElement;
}

interface ProjectFieldRefs {
  nameInput: HTMLInputElement;
  tasksCheck: HTMLInputElement;
  wikiCheck: HTMLInputElement;
}

interface WikiFieldRefs {
  projInput: HTMLInputElement;
  sectionInput: HTMLInputElement;
}

interface SnoozeFieldRefs {
  snoozeInput: HTMLInputElement;
}

// ── ProcessInboxModal ──

/**
 * ProcessInboxModal — walks through inbox items one at a time.
 * User picks an action (Task / Project / Wiki / Discard / Snooze)
 * and fills in conditional fields.
 */
export class ProcessInboxModal extends Modal {
  plugin: FlowtimePluginRef;
  items: InboxItem[] = [];
  allItems: InboxItem[] = [];
  currentIndex: number = 0;
  processedCount: number = 0;
  skippedCount: number = 0;
  snoozedCount: number = 0;
  _processedIds: Set<string> = new Set();
  headings: LineEntry[] = [];
  originalContent: string = "";
  file!: TFile;

  constructor(app: App, plugin: FlowtimePluginRef) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this._loadInbox();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  async _loadInbox(): Promise<void> {
    const path = this.plugin.settings.inboxPath || "Inbox.md";
    try {
      if (!(await this.app.vault.adapter.exists(path))) {
        this.contentEl.empty();
        this.contentEl.createEl("h2", { text: "\u{1F4E5} Inbox Not Found" });
        this.contentEl.createEl("p", {
          text: "No inbox file found at " + path + ". Create one?",
        });
        const btnRow = this.contentEl.createEl("div", {
          cls: "flowtime-btn-row",
        });
        btnRow
          .createEl("button", { text: "Cancel", cls: "flowtime-btn-cancel" })
          .addEventListener("click", () => this.close());
        btnRow
          .createEl("button", {
            text: "Create Inbox",
            cls: "flowtime-btn-submit",
          })
          .addEventListener("click", async () => {
            await this.plugin._ensureInbox();
            this.plugin.notify(
              "\u{1F4E5} Inbox created. Add some items and try again.",
            );
            this.close();
          });
        return;
      }

      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) {
        this.plugin.notify("Inbox file not accessible", true);
        this.close();
        return;
      }
      this.file = file as TFile;
      const content = await this.app.vault.read(this.file);
      const { items, headings } = parseInbox(content);
      this.headings = headings;
      this.originalContent = content;

      // Keep ALL items for write-back; filter snoozed for display
      this.allItems = items;
      this.snoozedCount = items.filter((item) => isSnoozed(item.text)).length;
      this.items = items.filter((item) => !isSnoozed(item.text));
      this.currentIndex = 0;

      if (this.items.length === 0) {
        this._showEmpty();
        return;
      }

      this._renderItem();
    } catch (e) {
      this.plugin.notify("Error loading inbox: " + (e as Error).message, true);
      this.close();
    }
  }

  _showEmpty(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "\u{1F4E5} Inbox" });
    const snoozeMsg =
      this.snoozedCount > 0
        ? ` (${this.snoozedCount} snoozed — will reappear on their snooze date)`
        : "";
    this.contentEl.createEl("p", {
      text: "Inbox is empty!" + snoozeMsg + " Capture some tasks first.",
    });
    const btnRow = this.contentEl.createEl("div", { cls: "flowtime-btn-row" });
    btnRow
      .createEl("button", { text: "Close", cls: "flowtime-btn-submit" })
      .addEventListener("click", () => this.close());
  }

  _renderItem(): void {
    const { contentEl } = this;
    contentEl.empty();

    const item = this.items[this.currentIndex];
    const total = this.items.length;
    const tags = detectTags(item.text);

    // ── Header ──
    contentEl.createEl("h2", { text: "\u{1F4E5} Process Inbox" });
    contentEl.createEl("p", {
      text: `${this.currentIndex + 1} of ${total}`,
      cls: "flowtime-inbox-progress",
    });

    // ── Editable text ──
    contentEl.createEl("label", { text: "Item", cls: "flowtime-label" });
    const textInput = contentEl.createEl("textarea", {
      cls: "flowtime-input flowtime-inbox-text",
    });
    // Truncate very long lines for display only
    const displayText = (cleanDescription(item.text) || item.text).slice(
      0,
      500,
    );
    textInput.value = displayText;
    textInput.style.width = "100%";
    textInput.style.minHeight = "50px";
    textInput.focus();

    // ── Action dropdown ──
    contentEl.createEl("label", { text: "Action", cls: "flowtime-label" });
    const actionSelect = contentEl.createEl("select", {
      cls: "flowtime-select",
    });
    const actions = [
      { value: "task", text: "\u{2705} Task" },
      { value: "project", text: "\u{1F4C1} Project" },
      { value: "wiki", text: "\u{1F4D6} Wiki" },
      { value: "discard", text: "\u{1F5D1} Discard" },
      { value: "snooze", text: "\u{23F0} Snooze" },
    ];
    for (const a of actions) {
      actionSelect.createEl("option", { value: a.value, text: a.text });
    }
    actionSelect.value = tags.isTaskLine ? "task" : "task";

    // ── Conditional fields container ──
    const fieldsContainer = contentEl.createEl("div", {
      cls: "flowtime-inbox-fields",
    });

    const rebuildFields = (): void => {
      fieldsContainer.empty();
      const action = actionSelect.value;

      if (action === "task") {
        this._buildTaskFields(fieldsContainer, tags);
      } else if (action === "project") {
        this._buildProjectFields(fieldsContainer, tags);
      } else if (action === "wiki") {
        this._buildWikiFields(fieldsContainer, tags);
      } else if (action === "snooze") {
        this._buildSnoozeFields(fieldsContainer, tags);
      }
    };

    actionSelect.addEventListener("change", rebuildFields);
    rebuildFields();

    // ── Buttons ──
    const btnRow = contentEl.createEl("div", { cls: "flowtime-btn-row" });
    const skipBtn = btnRow.createEl("button", {
      text: "Skip",
      cls: "flowtime-btn-cancel",
    });
    const processBtn = btnRow.createEl("button", {
      text: "Process",
      cls: "flowtime-btn-submit",
    });
    const doneBtn = btnRow.createEl("button", {
      text: "Done",
      cls: "flowtime-btn-cancel",
    });

    skipBtn.addEventListener("click", () => {
      this.skippedCount++;
      this.currentIndex++;
      if (this.currentIndex >= this.items.length) {
        this._finish();
      } else {
        this._renderItem();
      }
    });

    processBtn.addEventListener("click", async () => {
      const description = textInput.value.trim();
      if (!description) {
        this.plugin.notify("Description cannot be empty", true);
        return;
      }

      const action = actionSelect.value;
      // Capture original text BEFORE editing — used for write-back matching
      const originalText = item.text;
      item.setText(description);

      try {
        const result = await this._processItem(
          item,
          action,
          fieldsContainer,
        );

        if (result && result.keepInFile) {
          // Snoozed — update in allItems, remove from display, don't mark processed
          const idx = this.allItems.findIndex((a) => a.index === item.index);
          if (idx >= 0) {
            this.allItems[idx] = item; // updated item with @snooze tag
          }
          this.items.splice(this.currentIndex, 1);
        } else {
          this.processedCount++;
          // Mark original text as processed (removed from file)
          this._processedIds.add(item.index + ":" + originalText);
          this.items.splice(this.currentIndex, 1); // remove processed item
        }
        // Don't increment currentIndex — next item slides into place
        if (this.currentIndex >= this.items.length) {
          this._finish();
        } else {
          this._renderItem();
        }
      } catch (e) {
        this.plugin.notify("Error: " + (e as Error).message, true);
      }
    });

    doneBtn.addEventListener("click", () => {
      this._finish();
    });

    // Enter to process, Escape to skip
    textInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        processBtn.click();
      } else if (e.key === "Escape") {
        skipBtn.click();
      }
    });

    textInput.focus();
  }

  _buildTaskFields(container: HTMLElement, tags: DetectedTags): void {
    container.createEl("h4", { text: "Task Options" });

    // Date
    container.createEl("label", { text: "Date", cls: "flowtime-label" });
    const dateRow = container.createEl("div", { cls: "flowtime-row" });
    const dateInput = dateRow.createEl("input", {
      type: "text",
      placeholder: "today, tomorrow, YYYY-MM-DD",
      value: tags.date || "today",
      cls: "flowtime-input",
    }) as HTMLInputElement;
    const datePreview = dateRow.createEl("span", {
      text: "",
      cls: "flowtime-date-preview",
    });
    const updateDatePreview = (): void => {
      const parsed = parseDate(dateInput.value);
      datePreview.setText(parsed ? "\u2192 @" + parsed : "\u2192 ?");
      datePreview.toggleClass("flowtime-date-invalid", !parsed);
    };
    dateInput.addEventListener("input", updateDatePreview);
    updateDatePreview();

    // Duration
    container.createEl("label", { text: "Duration", cls: "flowtime-label" });
    const durSelect = container.createEl("select", {
      cls: "flowtime-select",
    }) as HTMLSelectElement;
    const durations = [
      0, 10, 15, 20, 25, 30, 45, 60, 90, 120, 150, 180, 210, 240,
    ];
    for (const d of durations) {
      durSelect.createEl("option", {
        text: d === 0 ? "None" : d < 60 ? d + "m" : d / 60 + "h",
        value: String(d),
      });
    }
    // Pre-fill from detected or default
    const prefillDur =
      tags.duration || this.plugin.settings.inboxDefaultDuration || 0;
    durSelect.value = String(prefillDur);

    // Bucket
    container.createEl("label", { text: "Bucket", cls: "flowtime-label" });
    const bucketSelect = container.createEl("select", {
      cls: "flowtime-select",
    }) as HTMLSelectElement;
    const buckets = this.plugin.settings.buckets || [];
    bucketSelect.createEl("option", { text: "None", value: "" });
    for (const b of buckets) {
      bucketSelect.createEl("option", { text: b.name, value: b.id });
    }
    bucketSelect.value =
      tags.bucket || this.plugin.settings.inboxDefaultBucket || "";

    // Project
    container.createEl("label", { text: "Project", cls: "flowtime-label" });
    const projInput = container.createEl("input", {
      type: "text",
      placeholder: "Project name",
      value: tags.project || "",
      cls: "flowtime-input",
    }) as HTMLInputElement;

    // Priority
    container.createEl("label", { text: "Priority", cls: "flowtime-label" });
    const prioSelect = container.createEl("select", {
      cls: "flowtime-select",
    }) as HTMLSelectElement;
    const priorities = [
      { value: "", text: "None" },
      { value: "\uD83D\uDFE5", text: "\uD83D\uDFE5 High" },
      { value: "\uD83D\uDFE8", text: "\uD83D\uDFE8 Medium" },
      { value: "\uD83D\uDFE9", text: "\uD83D\uDFE9 Low" },
    ];
    for (const p of priorities) {
      prioSelect.createEl("option", { value: p.value, text: p.text });
    }
    prioSelect.value = tags.priority || "";

    // Recurrence
    container.createEl("label", { text: "Recurrence", cls: "flowtime-label" });
    const recSelect = container.createEl("select", {
      cls: "flowtime-select",
    }) as HTMLSelectElement;
    const recurrences = [
      { value: "", text: "None" },
      { value: "every day", text: "Daily" },
      { value: "every week", text: "Weekly" },
      { value: "every 2 weeks", text: "Biweekly" },
      { value: "every month", text: "Monthly" },
    ];
    for (const r of recurrences) {
      recSelect.createEl("option", { value: r.value, text: r.text });
    }
    if (tags.recurrence)
      recSelect.value = tags.recurrence.replace("\uD83D\uDD01 every ", "");

    // Store refs for _processItem
    (container as any)._taskRefs = {
      dateInput,
      durSelect,
      bucketSelect,
      projInput,
      prioSelect,
      recSelect,
    } as TaskFieldRefs;
  }

  _buildProjectFields(container: HTMLElement, tags: DetectedTags): void {
    container.createEl("h4", { text: "Project Options" });

    container.createEl("label", {
      text: "Project name",
      cls: "flowtime-label",
    });
    const nameInput = container.createEl("input", {
      type: "text",
      placeholder: "Project name",
      value: cleanDescription(tags.project) || "",
      cls: "flowtime-input",
    }) as HTMLInputElement;

    // Scaffold toggles
    const tasksCb = container.createEl("label", { cls: "flowtime-label" });
    const tasksCheck = tasksCb.createEl("input", {
      type: "checkbox",
    }) as HTMLInputElement;
    tasksCheck.checked = true;
    tasksCheck.style.marginRight = "6px";
    tasksCb.append(" Create Tasks.md");

    const wikiCb = container.createEl("label", { cls: "flowtime-label" });
    const wikiCheck = wikiCb.createEl("input", {
      type: "checkbox",
    }) as HTMLInputElement;
    wikiCheck.checked = true;
    wikiCheck.style.marginRight = "6px";
    wikiCb.append(" Create Wiki.md");

    (container as any)._projectRefs = {
      nameInput,
      tasksCheck,
      wikiCheck,
    } as ProjectFieldRefs;
  }

  _buildWikiFields(container: HTMLElement, tags: DetectedTags): void {
    container.createEl("h4", { text: "Wiki Options" });

    container.createEl("label", { text: "Project", cls: "flowtime-label" });
    const projInput = container.createEl("input", {
      type: "text",
      placeholder: "Project name to append to",
      value: tags.project || "",
      cls: "flowtime-input",
    }) as HTMLInputElement;

    container.createEl("label", {
      text: "Section (optional)",
      cls: "flowtime-label",
    });
    const sectionInput = container.createEl("input", {
      type: "text",
      placeholder: "e.g. Ideas, Notes, Reference",
      cls: "flowtime-input",
    }) as HTMLInputElement;

    (container as any)._wikiRefs = { projInput, sectionInput } as WikiFieldRefs;
  }

  _buildSnoozeFields(container: HTMLElement, tags: DetectedTags): void {
    container.createEl("h4", { text: "Snooze Until" });

    container.createEl("label", { text: "Date", cls: "flowtime-label" });
    const snoozeInput = container.createEl("input", {
      type: "text",
      placeholder: "tomorrow, monday, YYYY-MM-DD",
      value: tags.snoozeDate || "tomorrow",
      cls: "flowtime-input",
    }) as HTMLInputElement;

    (container as any)._snoozeRefs = { snoozeInput } as SnoozeFieldRefs;
  }

  async _processItem(
    item: InboxItem,
    action: string,
    fieldsContainer: HTMLElement,
  ): Promise<{ keepInFile?: boolean }> {
    const description = item.text;

    switch (action) {
      case "task": {
        const refs = (fieldsContainer as any)._taskRefs as TaskFieldRefs;
        const date = parseDate(refs.dateInput.value) || "";
        const dur = parseInt(refs.durSelect.value, 10) || 0;
        const bucket = refs.bucketSelect.value;
        const project = refs.projInput.value.trim();
        const priority = refs.prioSelect.value;
        const recVal = refs.recSelect.value;
        const recurrence = recVal ? "\uD83D\uDD01 every " + recVal : "";

        const line = buildTaskLine(description, {
          date,
          durationMinutes: dur,
          bucket,
          project,
          priority,
          recurrence,
        });

        await this._appendToTarget(line);
        break;
      }

      case "project": {
        const refs = (fieldsContainer as any)._projectRefs as ProjectFieldRefs;
        let name = refs.nameInput.value.trim();
        if (!name) name = description;

        // Scaffold via template engine
        const result = await this.plugin.templateEngine.createProject(name, {
          scaffoldTasks: refs.tasksCheck.checked,
          scaffoldWiki: refs.wikiCheck.checked,
        });

        // Add the original description as the first task in Tasks.md
        if (result.tasksPath) {
          const tasksFile = this.app.vault.getAbstractFileByPath(
            result.tasksPath,
          );
          if (tasksFile) {
            const taskLine = buildTaskLine(description, { date: "today" });
            const content = await this.app.vault.read(tasksFile as TFile);
            await this.app.vault.modify(
              tasksFile as TFile,
              content.trimEnd() + "\n" + taskLine,
            );
          }
        }

        this.plugin.notify(`\u{1F4C1} Project created: ${name}`);
        break;
      }

      case "wiki": {
        const refs = (fieldsContainer as any)._wikiRefs as WikiFieldRefs;
        const projectName = refs.projInput.value.trim();
        if (!projectName) {
          this.plugin.notify(
            "Project name is required for wiki action",
            true,
          );
          return {};
        }

        const section = refs.sectionInput.value.trim() || "From Inbox";
        const date = new Date().toISOString().split("T")[0];
        const wikiLine = `- ${date}: ${description}\n`;

        // Find the project wiki file
        const projects = await this.plugin.projectEngine.getAllProjects();
        const match = projects.find(
          (p) => p.name.toLowerCase() === projectName.toLowerCase(),
        );

        if (projects.length === 0) {
          this.plugin.notify(
            "No projects exist yet. Create a project first.",
            true,
          );
          return {};
        }

        if (match) {
          // Derive wiki path from project path
          // match.path is e.g. "ProjectA/ProjectA.md"
          const folder = match.path.substring(
            0,
            match.path.lastIndexOf("/"),
          );
          const wikiPath = folder + "/" + match.name + " Wiki.md";
          let wikiFile = this.app.vault.getAbstractFileByPath(wikiPath);

          if (wikiFile) {
            let content = await this.app.vault.read(wikiFile as TFile);
            const sectionHeader = `## \u{1F4E5} ${section}`;
            if (content.includes(sectionHeader)) {
              // Append after the section header
              content = content.replace(
                sectionHeader,
                sectionHeader + "\n" + wikiLine.trimEnd(),
              );
            } else {
              content =
                content.trimEnd() +
                "\n\n" +
                sectionHeader +
                "\n" +
                wikiLine;
            }
            await this.app.vault.modify(wikiFile as TFile, content);
          } else {
            // Create wiki file if it doesn't exist
            const wikiContent = `# ${match.name} — Wiki\n\n## \u{1F4E5} ${section}\n${wikiLine}`;
            wikiFile = await this.app.vault.create(wikiPath, wikiContent);
          }
          this.plugin.notify(`\u{1F4D6} Added to ${match.name} Wiki`);
        } else {
          this.plugin.notify(
            `Project "${projectName}" not found. Available projects: ${projects.map((p) => p.name).join(", ")}`,
            true,
          );
          return {};
        }
        break;
      }

      case "discard":
        // Item is removed from the list — nothing else to do
        break;

      case "snooze": {
        const refs = (fieldsContainer as any)
          ._snoozeRefs as SnoozeFieldRefs;
        const snoozeDate = parseDate(refs.snoozeInput.value);
        if (!snoozeDate) {
          this.plugin.notify("Invalid snooze date", true);
          return { keepInFile: true };
        }
        // Replace item text with snooze tag added — stays in file
        const clean = cleanDescription(description);
        item.setText(clean + " @snooze " + snoozeDate);
        return { keepInFile: true };
      }
    }

    return {};
  }

  async _appendToTarget(line: string): Promise<void> {
    const target = this.plugin.settings.quickEntryTargetFile;
    let targetFile: TFile | null = null;

    if (target === "daily-note") {
      // Resolve daily note by path instead of scanning all files
      const today = new Date().toISOString().split("T")[0];
      const dnConfigPath = this.app.vault.configDir + "/daily-notes.json";
      try {
        const adapter = this.app.vault.adapter;
        let folder = "";
        if (await adapter.exists(dnConfigPath)) {
          const config = JSON.parse(await adapter.read(dnConfigPath)) as {
            folder?: string;
          };
          folder = config.folder || "";
        }
        const dailyPath = folder
          ? folder + "/" + today + ".md"
          : today + ".md";
        targetFile = this.app.vault.getAbstractFileByPath(
          dailyPath,
        ) as TFile | null;
        if (!targetFile) {
          targetFile = (await this.app.vault.create(
            dailyPath,
            "# " + today + "\n\n",
          )) as unknown as TFile;
        }
      } catch (_) {
        // ignore
      }
    } else if (target === "active-file") {
      targetFile = this.app.workspace.getActiveFile();
    } else if (target === "project-file") {
      // Parse project from line, find its folder note
      const projectMatch = line.match(/@p:([^\s]+)/);
      if (projectMatch) {
        const projects = await this.plugin.projectEngine.getAllProjects();
        const match = projects.find(
          (p) => p.name.toLowerCase() === projectMatch[1].toLowerCase(),
        );
        if (match && match.path) {
          targetFile = this.app.vault.getAbstractFileByPath(
            match.path,
          ) as TFile | null;
        }
      }
      if (!targetFile) targetFile = this.app.workspace.getActiveFile();
    }

    if (!targetFile) {
      // Fall back to the inbox file itself
      targetFile = this.file;
    }

    const content = await this.app.vault.read(targetFile);
    await this.app.vault.modify(targetFile, content.trimEnd() + "\n" + line);
  }

  async _finish(): Promise<void> {
    // Re-read the file to handle concurrent external edits
    try {
      const freshContent = await this.app.vault.read(this.file);
      const { items: freshItems, headings: freshHeadings } =
        parseInbox(freshContent);

      // Remove processed items by their original index+text signature
      const remainingItems = freshItems.filter((fresh) => {
        const key = fresh.index + ":" + fresh.text;
        const wasProcessed = this._processedIds.has(key);
        return !wasProcessed;
      });

      const newContent = reconstructInbox(remainingItems, freshHeadings);
      await this.app.vault.modify(this.file, newContent);
    } catch (e) {
      this.plugin.notify(
        "Error saving inbox: " + (e as Error).message,
        true,
      );
    }

    const msg = ["\u{1F4E5} Inbox processed"];
    if (this.processedCount > 0) msg.push(`${this.processedCount} processed`);
    if (this.skippedCount > 0) msg.push(`${this.skippedCount} skipped`);
    // Count remaining non-processed items still in the file (allItems minus processedIds)
    const remaining = this.allItems.filter(
      (item) => !this._processedIds.has(item.index + ":" + item.text),
    ).length;
    if (remaining > 0) msg.push(`${remaining} remaining in inbox`);

    this.plugin.notify(msg.join(" — "));
    this.close();
  }
}
