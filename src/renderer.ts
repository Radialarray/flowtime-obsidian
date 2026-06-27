/**
 * FlowtimeRenderer — MarkdownRenderChild subclass that renders task tables and list views.
 * Handles loading tasks from vault, sorting, grouping, filtering, timer management,
 * and all rendering modes (today, overdue, dueweek, weekly, soon, project, budget, sessions, sprints).
 */

import { MarkdownRenderChild } from "obsidian";
import type { App, TFile } from "obsidian";
import {
  parseRecurrence,
  formatDuration,
  formatTimer,
  buildTaskTree,
  flattenTree,
} from "./task-parser";
import { renderProgressBar, formatHours } from "./budget-state";
import { evaluateFilter } from "./filter-engine";
import {
  DUR_OPTS,
  START_H,
  START_END,
  timeOpts,
  parseStored,
  calcEnd,
  getMonday,
  getSunday,
  priorityWeight,
  getFileTasks,
  toggleCheck,
  updateDate,
  parseDurStr,
  fmtDateShort,
} from "./task-utils";
import type {
  TaskRow,
  ColumnDef,
  SortConfig,
  GroupConfig,
  DisplayItem,
  TreeNode,
  TimerState,
  FilterConfig,
  FilterOp,
  FlowtimeSettings,
  RenderMode,
  ViewMode,
  ParsedTask,
  ProjectResult,
  SessionEntry,
} from "./types";

/* ─── Plugin reference type ─── */

interface FlowtimePluginRef {
  settings: FlowtimeSettings;
  notify: (msg: string, isError?: boolean) => void;
  isMobile?: boolean;
  taskCache?: {
    get(path: string): { parsedTasks: Omit<ParsedTask, "file">[] } | null;
    set(path: string, tasks: Omit<ParsedTask, "file">[]): void;
    invalid(path: string): void;
  };
  statusTimer?: {
    start(taskName: string, remainingSeconds: number): void;
    stop(): void;
    pause(): void;
    toggle(): void;
    getState?(): {
      taskName: string;
      remaining: number;
      total: number;
      isRunning: boolean;
    } | null;
    currentTimer?: {
      taskName: string;
      remaining: number;
      total: number;
      interval: ReturnType<typeof setInterval> | null;
    };
  };
  _activeRowTimer?: TimerState & { taskName?: string } | null;
  _activeRowTimerStop?: (() => void) | null;
  _scheduleCacheSave?: () => void;
  projectEngine?: {
    resolve(filePath: string): Promise<ProjectResult>;
    resolveFromTag(text: string, prefix: string): string | null;
  };
  sessionStore?: {
    writeSession(session: SessionEntry): Promise<void>;
    writeCompletion(completion: {
      date: string;
      bucket: string;
      taskText: string;
      completedAt: string;
    }): Promise<void>;
    query(opts: Record<string, unknown>): Promise<Record<string, unknown>[]>;
    getDailyTotals(opts: {
      dateFrom: string;
      dateTo: string;
    }): Promise<Record<string, unknown>[]>;
    getWeeklyTotals(): Promise<Record<string, unknown>[]>;
  };
  renderers: FlowtimeRenderer[];
  taskIndex?: {
    initialized: boolean;
    totalTasks: number;
    getTasks(query: { date?: string; dateFrom?: string; dateTo?: string; project?: string; bucket?: string; includeCompleted?: boolean }): ParsedTask[];
    getDailyDurationTotal(dateStr: string): number;
  };
}

/* ─── Column definitions ─── */

const COLUMNS: ColumnDef[] = [
  { id: "time",     label: "Time",    sortField: "time",    width: "22%",   compactOnly: false, compactSkip: true,  defaultHide: false },
  { id: "check",    label: "\u2713",       sortField: "status",  width: "36px",  compactOnly: false, compactSkip: false, defaultHide: false },
  { id: "priority", label: "!",       sortField: "priority",width: "28px",  compactOnly: false, compactSkip: false, defaultHide: true },
  { id: "soon",     label: "~",       sortField: "soon",    width: "36px",  compactOnly: false, compactSkip: false, defaultHide: true },
  { id: "task",     label: "Task",    sortField: "text",    width: "35%",   compactOnly: false, compactSkip: false, defaultHide: false },
  { id: "project",  label: "Project", sortField: "project", width: "auto",  compactOnly: false, compactSkip: false, defaultHide: false },
  { id: "bucket",   label: "Bucket",  sortField: "bucket",  width: "auto",  compactOnly: false, compactSkip: false, defaultHide: false },
  { id: "sprint",   label: "Sprint",  sortField: "sprint",  width: "auto",  compactOnly: false, compactSkip: false, defaultHide: true },
  { id: "source",   label: "Source",  sortField: "source",  width: "auto",  compactOnly: false, compactSkip: false, defaultHide: false },
  { id: "date",     label: "Date",    sortField: "date",    width: "85px",  compactOnly: false, compactSkip: false, defaultHide: false },
  { id: "actions",  label: " ",       sortField: null,      width: "90px",  compactOnly: true,  compactSkip: false, defaultHide: false },
  { id: "timer",    label: " ",       sortField: null,      width: "22%",   compactOnly: false, compactSkip: true,  defaultHide: false },
];

/* ─── Renderer class ─── */

class FlowtimeRenderer extends MarkdownRenderChild {
  app: App;
  plugin: FlowtimePluginRef | null;
  mode: RenderMode;
  projectEngine: FlowtimePluginRef["projectEngine"];
  sourcePath: string | null;
  tasks: TaskRow[];
  rowData: Array<{ task: TaskRow; si: HTMLInputElement | null; ds: HTMLInputElement | null }>;
  startOpts: string[];
  _columnVisibility: Record<string, boolean> | null;
  _activeFilter: FilterConfig | null;
  _sortConfig: SortConfig[];
  _sortMode: string | null;
  _groupConfig: GroupConfig;
  _collapsed: Set<string>;
  _displayItems: DisplayItem[];
  _viewMode: ViewMode;
  _budgetDailyCap: number;
  _budgetDailyCapUsed: number;
  bucketTotals: Record<string, number>;
  _resyncDone: boolean;
  _closePopups: ((ev: MouseEvent) => void) | null;

  constructor(
    app: App,
    containerEl: HTMLElement,
    mode: RenderMode,
    projectEngine: FlowtimePluginRef["projectEngine"],
    sourcePath: string,
  ) {
    super(containerEl);
    this.app = app;
    this.plugin = null;
    this.mode = mode || "today";
    this.projectEngine = projectEngine || undefined;
    this.sourcePath = sourcePath || null;
    this.tasks = [];
    this.rowData = [];
    this.startOpts = [];
    this._columnVisibility = null;
    this._activeFilter = null;
    this._sortConfig = [];
    this._sortMode = null;
    this._groupConfig = { primary: null, secondary: null };
    this._collapsed = new Set();
    this._displayItems = [];
    this._viewMode = "table";
    this._budgetDailyCap = 0;
    this._budgetDailyCapUsed = 0;
    this.bucketTotals = {};
    this._resyncDone = false;
    this._closePopups = null;
  }

  /** Get active document for popout window compatibility */
  private get _doc(): Document {
    return this.containerEl?.ownerDocument ?? activeDocument;
  }

  override onload(): void {
    this.containerEl.addClass("ft-mt-6");

    // Mobile (Platform.isMobile): show link to markdown view instead of custom UI
    if (this.plugin?.isMobile) {
      const wrap = this.containerEl.createEl("div", { cls: "ft-empty-state" });
      wrap.createEl("p", { text: "\u{1F4F1} Mobile view", cls: "flowtime-empty ft-empty-text" });
      const btn = wrap.createEl("button", {
        text: "\u{1F4DD} Open as Markdown",
        cls: "ft-empty-btn",
      });
      btn.addEventListener("click", () => {
        const mobileFile = this.app.vault.getAbstractFileByPath("today-mobile.md");
        if (mobileFile) {
          void this.app.workspace.openLinkText("today-mobile", "", false);
        } else {
          this.plugin?.notify?.("today-mobile.md not found. Create it with type: flowtime-mobile frontmatter.", true);
        }
      });
      return;
    }

    // Narrow screen (<600px): force list view. Table view is incompatible.
    const isNarrow = typeof window !== "undefined" && window.innerWidth < 600;
    this._viewMode = isNarrow
      ? "list"
      : this.plugin?.settings?.defaultView === "list" ? "list" : "table";

    // Show loading shimmer
    if (isNarrow) {
      for (let i = 0; i < 3; i++) {
        this.containerEl.createEl("div", { cls: "ft-loading" });
      }
    }

    void (async (): Promise<void> => {
      try {
        await this.loadTasks();
        this.renderTable();
      } catch (e) {
        this.containerEl.empty();
        this.containerEl.createEl("p", {
          text: "\u26a0\ufe0f Error: " + (e as Error).message,
          cls: "flowtime-empty",
        });
        console.error("TP error:", e);
      }
    })();
  }

  /* ─── helpers ─── */

  _timeOpts(h1: number, h2: number): string[] { return timeOpts(h1, h2); }
  _parseStored(t: string): { start: string; dur: number } { return parseStored(t); }
  _calcEnd(s: string, d: number): string { return calcEnd(s, d); }
  _getMonday(d: string): string { return getMonday(d); }
  _getSunday(d: string): string { return getSunday(d); }

  _computeBucketTotals(): Record<string, number> {
    const totals: Record<string, number> = {};
    const ref = this._refDate();
    const mon = this._getMonday(ref);
    const sun = this._getSunday(ref);
    for (const task of this.tasks) {
      if (!task.bucket) continue;
      if (task.taskDate && task.taskDate >= mon && task.taskDate <= sun) {
        totals[task.bucket] =
          (totals[task.bucket] || 0) + (task.durationMinutes || 0);
      }
    }
    return totals;
  }

  _isFileInScope(filePath: string): boolean {
    if (filePath.startsWith(this.app.vault.configDir) || filePath.startsWith(".git")) return false;
    const root = this.plugin?.settings?.projectsRoot || "";
    if (!root) return true;
    const inboxPath = (this.plugin?.settings?.inboxPath || "Inbox.md").replace(/^\.\//, "");
    if (filePath === inboxPath || filePath.endsWith("/" + inboxPath)) return true;
    const normalizedRoot = root.endsWith("/") ? root : root + "/";
    return filePath.startsWith(normalizedRoot);
  }

  async _computeDailyTotal(): Promise<number> {
    const today = this._refDate();
    // Use taskIndex if available (fast path)
    if (this.plugin?.taskIndex?.initialized) {
      return this.plugin.taskIndex.getDailyDurationTotal(today) / 60;
    }
    // Fallback: full scan
    let total = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this._isFileInScope(file.path)) continue;
      const fileTasks = await this._getFileTasks(file);
      for (const parsed of fileTasks) {
        if (parsed.taskDate === today && parsed.durationMinutes) {
          total += parsed.durationMinutes;
        }
      }
    }
    return total / 60;
  }

  _beep(): void {
    if (this.plugin?.settings?.timerSound === false) return;
    try {
      for (const [freq, delay] of [[880, 0] as const, [660, 0.2] as const]) {
        const ctx = new AudioContext();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.3, ctx.currentTime + delay);
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + 0.6);
        o.start(ctx.currentTime + delay);
      }
    } catch (_) { /* Audio not available */ }
  }

  _priorityWeight(p: string | null | undefined): number { return priorityWeight(p); }

  _sort(): void {
    if (this.tasks.some((t) => t.sortIndex == null)) {
      this.tasks.sort((a, b) => {
        const pa = priorityWeight(a.priority);
        const pb = priorityWeight(b.priority);
        if (pa !== pb) return pb - pa;
        if (!a.time && !b.time) return 0;
        if (!a.time) return 1;
        if (!b.time) return -1;
        const tc = a.time.localeCompare(b.time);
        if (tc !== 0) return tc;
        const da = a.taskDate || "";
        const db = b.taskDate || "";
        return da.localeCompare(db);
      });
      let idx = 1000;
      for (const t of this.tasks) {
        if (t.sortIndex == null) { t.sortIndex = idx; idx += 1000; }
      }
    }
    this.tasks.sort((a, b) => {
      const pa = priorityWeight(a.priority);
      const pb = priorityWeight(b.priority);
      if (pa !== pb) return pb - pa;
      const ia = a.sortIndex || 0;
      const ib = b.sortIndex || 0;
      return ia - ib;
    });
  }

  _applySort(): void {
    if (!this._sortConfig || this._sortConfig.length === 0) { this._sort(); return; }
    this.tasks.sort((a, b) => {
      for (const sc of this._sortConfig) {
        const va = this._getSortValue(a, sc.field);
        const vb = this._getSortValue(b, sc.field);
        let cmp;
        if (typeof va === "string" && typeof vb === "string") { cmp = va.localeCompare(vb); }
        else if (typeof va === "number" && typeof vb === "number") { cmp = va - vb; }
        else { cmp = String(va || "").localeCompare(String(vb || "")); }
        if (cmp !== 0) return sc.direction === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  }

  _getSortValue(task: TaskRow, field: string): string | number {
    switch (field) {
      case "time": return task.time || "";
      case "status": return task.status || "";
      case "text": return task.cleanText || "";
      case "project": return task.project || "";
      case "bucket": return task.bucket || "";
      case "sprint": return task.sprint || "";
      case "source": return task.file?.basename || "";
      case "date": return task.taskDate || "";
      case "priority": return priorityWeight(task.priority);
      case "soon": return task.isSoon ? 1 : 0;
      default: return "";
    }
  }

  _sprintName(id: string | null | undefined): string {
    if (!id) return "";
    const sprints = this.plugin?.settings?.sprints || [];
    const def = sprints.find((s) => s.id === id);
    return def?.name || id;
  }

  _getGroupValue(task: TaskRow, field: string): string {
    switch (field) {
      case "bucket": return task.bucket || "Unassigned";
      case "project": return task.project || "Other";
      case "sprint": return this._sprintName(task.sprint) || "No sprint";
      case "date": return task.taskDate || "No date";
      case "status": return task.status?.trim() ? "Done" : "Open";
      default: return "Other";
    }
  }

  _fmtDate(dateStr: string | null | undefined): string {
    return fmtDateShort(dateStr);
  }

  _isCompactMode(): boolean {
    return this.mode === "overdue" || this.mode === "dueweek" || this.mode === "weekly";
  }

  _visibleColCount(isCompact: boolean): number {
    const v = this._columnVisibility || {};
    let count = 0;
    for (const col of COLUMNS) {
      if (col.compactOnly && !isCompact) continue;
      if (col.compactSkip && isCompact) continue;
      if (v[col.id] === false) continue;
      if (col.defaultHide && !v[col.id]) continue;
      count++;
    }
    return count || 1;
  }

  async _getFileTasks(file: TFile): Promise<ParsedTask[]> {
    return getFileTasks(file, this.app, this.plugin?.taskCache);
  }

  /* ─── load ─── */

  _refDate(): string {
    if (this.sourcePath) {
      const dateMatch = this.sourcePath.match(/(\d{4}-\d{2}-\d{2})\.md$/);
      if (dateMatch) return dateMatch[1];
    }
    return new Date().toISOString().split("T")[0];
  }



  async loadTasks(): Promise<void> {
    if (this.mode === "sessions") { this.tasks = []; return; }

    if (this.mode === "sprints") {
      this.tasks = [];
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!this._isFileInScope(file.path)) continue;
        const fileTasks = await this._getFileTasks(file);
        for (const parsed of fileTasks) {
          if (!parsed.sprint) continue;
          const project = this.projectEngine ? await this.projectEngine.resolve(file.path) : null;
          this.tasks.push({
            file, line: parsed.line, rawLine: parsed.rawLine, time: parsed.time,
            taskDate: parsed.taskDate, rawText: parsed.rawText, cleanText: parsed.cleanText,
            status: parsed.status, priority: parsed.priority, bucket: parsed.bucket,
            durationMinutes: parsed.durationMinutes, project: project?.name || null,
            isSoon: parsed.isSoon, sprint: parsed.sprint, indent: parsed.indent,
            sortIndex: parsed.sortIndex,
          });
        }
      }
      return;
    }

    const today = this._refDate();
    const refDt = new Date(today + "T00:00:00");
    const eow = new Date(refDt);
    eow.setDate(eow.getDate() + ((7 - eow.getDay()) % 7));
    const eowStr = eow.toISOString().split("T")[0];
    const mon = this._getMonday(today);
    const sun = this._getSunday(today);

    let targetProject: string | null = null;
    if (this.mode === "project") {
      if (this.sourcePath && this.projectEngine) {
        const sp = await this.projectEngine.resolve(this.sourcePath);
        targetProject = sp?.name || null;
      }
      if (!targetProject) { this.tasks = []; return; }
    }

    if (this.mode === "budget") {
      this._budgetDailyCap = this.plugin?.settings?.dailyCap || 12;
      this._budgetDailyCapUsed = await this._computeDailyTotal();
      const weeklyTotals: Record<string, number> = {};
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!this._isFileInScope(file.path)) continue;
        const fileTasks = await this._getFileTasks(file);
        for (const parsed of fileTasks) {
          if (!parsed.bucket) continue;
          if (parsed.taskDate && parsed.taskDate >= mon && parsed.taskDate <= sun) {
            weeklyTotals[parsed.bucket] = (weeklyTotals[parsed.bucket] || 0) + (parsed.durationMinutes || 0);
          }
        }
      }
      this.tasks = [];
      const buckets = this.plugin?.settings?.buckets || [];
      for (const b of buckets) {
        this.tasks.push({
          file: null, line: 0, rawLine: "", time: "", taskDate: "",
          durationMinutes: weeklyTotals[b.id] || 0, rawText: "", cleanText: b.name,
          status: " ", priority: null, bucket: b.id, project: null, _bucketDef: b,
        });
      }
      return;
    }

    if (this.mode === "soon") {
      this.tasks = [];
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!this._isFileInScope(file.path)) continue;
        const fileTasks = await this._getFileTasks(file);
        for (const parsed of fileTasks) {
          if (parsed.status === "x" || parsed.status === "-" || parsed.status === "X") continue;
          if (!(parsed.isSoon || (parsed.taskDate && parsed.taskDate > today))) continue;
          const { taskDate, rawText, time, status, priority, cleanText, bucket, durationMinutes, projectTag } = parsed;
          const project = this.projectEngine ? await this.projectEngine.resolve(file.path) : null;
          let projName: string | null = project?.name || null;
          const projPath = project?.path || null;
          let projSource: string | null = project?.source || null;
          if (!projName && this.projectEngine) {
            if (projectTag) { projName = projectTag; projSource = "tag"; }
            if (!projName && rawText) {
              const tp = this.plugin?.settings?.tagPrefix || "project/";
              const tj = this.projectEngine.resolveFromTag(rawText, tp);
              if (tj) { projName = tj; projSource = "tag"; }
            }
          }
          this.tasks.push({
            file, line: parsed.line, rawLine: parsed.rawLine, time, taskDate, rawText, cleanText,
            status, priority, bucket, durationMinutes, project: projName,
            projectPath: projPath, projectSource: projSource, isSoon: true,
            sprint: parsed.sprint, indent: parsed.indent, sortIndex: parsed.sortIndex,
          });
        }
      }
      if (this._activeFilter) this.tasks = this.tasks.filter((t) => evaluateFilter(this._activeFilter, t));
      if (this._sortConfig?.length > 0) this._applySort(); else this._sort();
      return;
    }

    this.tasks = [];

    // v1.4.0: TaskIndex fast path — avoid full vault scan for date-filtered modes
    const idx = this.plugin?.taskIndex;
    if (idx?.initialized && (this.mode === "today" || this.mode === "overdue" || this.mode === "dueweek" || this.mode === "weekly")) {
      const query: { dateFrom?: string; dateTo?: string } = {};
      if (this.mode === "today") { query.dateFrom = today; query.dateTo = today; }
      else if (this.mode === "overdue") { query.dateTo = new Date(new Date(today).getTime() - 86400000).toISOString().split("T")[0]; }
      else if (this.mode === "dueweek") { query.dateFrom = today; query.dateTo = eowStr; }
      else if (this.mode === "weekly") { query.dateFrom = mon; query.dateTo = sun; }

      const idxTasks = idx.getTasks({ ...query, includeCompleted: false });
      for (const parsed of idxTasks) {
        if (!parsed.file) continue;
        const project = this.projectEngine ? await this.projectEngine.resolve(parsed.file.path) : null;
        let projName: string | null = project?.name || null;
        const projPath = project?.path || null;
        let projSource: string | null = project?.source || null;
        if (!projName && this.projectEngine && parsed.projectTag) {
          projName = parsed.projectTag; projSource = "tag";
        }
        this.tasks.push({
          file: parsed.file, line: parsed.line, rawLine: parsed.rawLine,
          time: parsed.time, taskDate: parsed.taskDate, rawText: parsed.rawText,
          cleanText: parsed.cleanText, status: parsed.status, priority: parsed.priority,
          bucket: parsed.bucket, durationMinutes: parsed.durationMinutes,
          project: projName, projectPath: projPath, projectSource: projSource,
          sprint: parsed.sprint, indent: parsed.indent, sortIndex: parsed.sortIndex,
        });
      }
      // Apply filter + sort
      if (this._activeFilter) this.tasks = this.tasks.filter((t) => evaluateFilter(this._activeFilter, t));
      if (this._sortConfig?.length > 0) this._applySort(); else this._sort();
      return;
    }

    // Fallback: full vault scan
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this._isFileInScope(file.path)) continue;
      const fileTasks = await this._getFileTasks(file);
      for (const parsed of fileTasks) {
        if (parsed.status === "x" || parsed.status === "-" || parsed.status === "X") continue;
        const { taskDate, rawText, time, status, priority, cleanText, bucket, durationMinutes, projectTag } = parsed;
        if (this.mode === "today") { if (taskDate !== today) continue; }
        if (this.mode === "overdue") { if (!taskDate || taskDate >= today) continue; }
        if (this.mode === "dueweek") { if (!taskDate || taskDate < today || taskDate > eowStr) continue; }
        if (this.mode === "weekly") { if (!taskDate || taskDate < mon || taskDate > sun) continue; }
        const project = this.projectEngine ? await this.projectEngine.resolve(file.path) : null;
        let projName: string | null = project?.name || null;
        const projPath = project?.path || null;
        let projSource: string | null = project?.source || null;
        if (!projName && this.projectEngine) {
          if (projectTag) { projName = projectTag; projSource = "tag"; }
        }
        if (this.mode === "project") { if (projName !== targetProject) continue; }
        this.tasks.push({
          file, line: parsed.line, rawLine: parsed.rawLine, time, taskDate, rawText, cleanText,
          status, priority, bucket, durationMinutes, project: projName,
          projectPath: projPath, projectSource: projSource,
          sprint: parsed.sprint, indent: parsed.indent, sortIndex: parsed.sortIndex,
        });
      }
    }

    if (this._activeFilter) { this.tasks = this.tasks.filter((t) => evaluateFilter(this._activeFilter, t)); }
    if (this.mode === "weekly" && this._groupConfig && !this._groupConfig.primary) {
      this._groupConfig = { primary: "project", secondary: null };
    }
    if (this._sortConfig && this._sortConfig.length > 0) { this._applySort(); }
    else if (this.mode === "weekly") {
      this.tasks.sort((a, b) => {
        const pa = a.project || ""; const pb = b.project || "";
        if (pa !== pb) return pa.localeCompare(pb);
        const da = a.taskDate || ""; const db = b.taskDate || "";
        return da.localeCompare(db);
      });
    } else { this._sort(); }
    this.plugin?._scheduleCacheSave?.();
  }

  /* ─── render ─── */

  renderTable(): void {
    this.containerEl.empty();
    this.rowData = [];
    // Sync view mode from global settings (cross-renderer consistency)
    if (this.plugin?.settings?.defaultView && !this.plugin.isMobile) {
      this._viewMode = this.plugin.settings.defaultView;
    }
    if (!this._columnVisibility) {
      // Mobile/narrow: show only essential columns (check, task, date)
      const isNarrow = typeof window !== "undefined" && window.innerWidth < 600;
      this._columnVisibility = {
        check: true, task: true, priority: false, soon: false,
        project: false, bucket: false, source: false, date: true,
        actions: !isNarrow, time: !isNarrow, timer: !isNarrow,
        sprint: false,
      };
    }
    if (this.mode === "today") { this._columnVisibility.actions = false; }
    if (this.mode === "sessions") { void this._renderSessionHistory(); return; }
    if (this.mode === "budget") { this._renderBudgetView(); return; }
    if (this.mode === "sprints") { this._renderSprintOverview(); return; }
    if (this.tasks.length === 0) {
      const msgs: Record<string, string> = {
        overdue: "\ud83c\udf89 No overdue tasks!",
        dueweek: "\ud83c\udf89 No tasks due this week!",
        weekly: "\ud83c\udf89 No tasks scheduled this week!",
        soon: "\ud83d\udcc5 No tasks tagged with @soon. Add @soon to backlog items.",
        project: "\ud83d\udcc5 No tasks for this project.",
        today: "\ud83d\udcc5 No tasks scheduled for today.",
      };
      const emptyEl = this.containerEl.createEl("div", { cls: "ft-empty-state" });
      emptyEl.createEl("p", { text: msgs[this.mode] || msgs.today, cls: "flowtime-empty ft-empty-text" });
      const btnRow = emptyEl.createEl("div", { cls: "ft-empty-actions" });
      const addBtn = btnRow.createEl("button", { text: "\u2795 Add a task", cls: "ft-empty-btn" });
      addBtn.addEventListener("click", async () => {
        const mod = await import("./quick-entry");
        new mod.QuickEntryModal(this.app, this.plugin as any).open();
      });
      return;
    }
    this.startOpts = this._timeOpts(START_H, START_END);
    const od = this.mode === "overdue", dw = this.mode === "dueweek", wk = this.mode === "weekly", _pj = this.mode === "project";
    const isCompact = od || dw || wk;
    const headings: Record<string, string> = {
      today: "\ud83d\udca1 Times and durations auto-save to source files",
      overdue: "\ud83d\udccb Tasks past their scheduled date \u2014 reassign or backlog",
      dueweek: "\u26a0\ufe0f Tasks due this week \u2014 schedule or defer",
      weekly: "\ud83d\udcca This week's tasks grouped by project",
      soon: "\u25cc Up next \u2014 @soon backlog items surfaced for attention",
      project: "\ud83d\udcc1 Tasks for this project",
    };
    const heading = headings[this.mode];
    const tdy = this._refDate();
    const bar = this.containerEl.createEl("div", { cls: "ft-topbar" });
    if (heading) { bar.createEl("div", { text: heading, cls: "ft-heading-row" }); }
    const toolbar = bar.createEl("div", { cls: "ft-toolbar-row" });


    if (isCompact) {
      const mkBtn = (text: string, cls: string, fn: () => void | Promise<void>): HTMLButtonElement => {
        const b = toolbar.createEl("button", { text, cls }); b.addEventListener("click", fn); return b;
      };
      mkBtn("\ud83d\udcc5 Assign All to Today", "ft-bulk-btn", async () => {
        for (const t of this.tasks) await this.updateDate(t, tdy);
        await this._refreshSiblings(); this.tasks = []; this.renderTable(); this.plugin?.notify?.("\u2705 All assigned to today");
      });
      if (od) {
        mkBtn("\u21a9\ufe0f Backlog All", "ft-bulk-btn", async () => {
          for (const t of this.tasks) await this.updateDate(t, "");
          await this._refreshSiblings(); this.tasks = []; this.renderTable(); this.plugin?.notify?.("\u21a9\ufe0f All sent to backlog");
        });
      }
    }

    const colBtn = toolbar.createEl("button", { text: "\u2630 Columns", cls: "ft-col-btn" });
    const colDD = this._doc.createElement("div"); colDD.className = "ft-col-dd";
    const dropdownLabels: Record<string, string> = {
      time: "Time", check: "\u2713", priority: "Prio", soon: "Soon", task: "Task",
      project: "Project", bucket: "Bucket", sprint: "Sprint", source: "Source", date: "Date", actions: "Actions", timer: "\u23f1",
    };
    const colDefs = COLUMNS.map((c) => ({ id: c.id, label: dropdownLabels[c.id] }));

    for (const def of colDefs) {
      if (isCompact && (def.id === "time" || def.id === "timer")) continue;
      if (!isCompact && def.id === "actions") continue;
      const item = colDD.createEl("label", { cls: "ft-col-dd-item" });
      const cb = item.createEl("input", { type: "checkbox" });
      cb.checked = this._columnVisibility![def.id] !== false;
      item.createEl("span", { text: " " + def.label });
      cb.addEventListener("change", () => { this._columnVisibility![def.id] = cb.checked; this.renderTable(); });
    }

    const toggleDD = (): void => {
      const r = colBtn.getBoundingClientRect();
      colDD.setCssStyles({
        left: Math.max(4, Math.min(r.left, window.innerWidth - colDD.offsetWidth - 8)) + "px",
        top: Math.min(r.bottom + 4, window.innerHeight - colDD.offsetHeight - 8) + "px",
      });
      colDD.classList.toggle("ft-col-dd-open"); this._doc.body.appendChild(colDD);
    };
    colBtn.addEventListener("click", (e: MouseEvent) => { e.stopPropagation(); toggleDD(); });
    const closeDD = (e: MouseEvent): void => {
      if (!colDD.contains(e.target as Node) && e.target !== colBtn) {
        colDD.classList.remove("ft-col-dd-open");
        if (colDD.parentNode) colDD.parentNode.removeChild(colDD);
      }
    };
    this._doc.addEventListener("click", closeDD, true);

    const viewBtn = toolbar.createEl("button", { text: this._viewMode === "list" ? "\u229e Table" : "\u2630 List", cls: "ft-view-btn" });
    viewBtn.addEventListener("click", () => {
      this._viewMode = this._viewMode === "list" ? "table" : "list";
      // Persist globally and sync all renderers
      if (this.plugin?.settings) {
        this.plugin.settings.defaultView = this._viewMode;
      }
      void this._refreshSiblings();
      this.renderTable();
    });

    const filterBtn = toolbar.createEl("button", { text: "\ud83d\udd0d Filter", cls: "ft-filter-btn" });
    if (this._activeFilter) { filterBtn.addClass("ft-filter-active-btn"); } else { filterBtn.removeClass("ft-filter-active-btn"); }
    const filterPanel = this._doc.createElement("div"); filterPanel.className = "ft-filter-panel";

    const buildFilterUI = (): void => {
      filterPanel.empty();
      const row = filterPanel.createEl("div", { cls: "ft-filter-row" });
      const fieldSel = row.createEl("select", { cls: "ft-filter-field" });
      const fieldOpts = [
        { id: "bucket", label: "Bucket" }, { id: "project", label: "Project" },
        { id: "sprint", label: "Sprint" }, { id: "date", label: "Date" },
        { id: "text", label: "Task Text" }, { id: "duration", label: "Duration" },
        { id: "status", label: "Status" }, { id: "priority", label: "Priority" },
      ];
      for (const f of fieldOpts) { fieldSel.createEl("option", { text: f.label, value: f.id }); }
      const opSel = row.createEl("select", { cls: "ft-filter-op" });
      const opOpts = [
        { id: "eq", label: "is" }, { id: "neq", label: "is not" }, { id: "contains", label: "contains" },
        { id: "gt", label: ">" }, { id: "gte", label: "\u2265" }, { id: "lt", label: "<" }, { id: "lte", label: "\u2264" },
        { id: "exists", label: "exists" }, { id: "not_exists", label: "does not exist" },
      ];
      for (const o of opOpts) { opSel.createEl("option", { text: o.label, value: o.id }); }
      const valInput = row.createEl("input", { type: "text", placeholder: "Value", cls: "ft-filter-val" });
      const applyBtn = row.createEl("button", { text: "Apply", cls: "ft-filter-apply" });
      const clearBtn = row.createEl("button", { text: "\u2715 Clear", cls: "ft-filter-clear" });
      if (this._activeFilter) {
        filterPanel.createEl("div", { text: "Active filter: " + JSON.stringify(this._activeFilter), cls: "ft-filter-active" });
      }
      applyBtn.addEventListener("click", async () => {
        const field = fieldSel.value; const op = opSel.value as FilterOp; const val = valInput.value.trim();
        if (op === "exists" || op === "not_exists") { this._activeFilter = { field, op } as FilterConfig; }
        else if (val) {
          const numericFields = ["duration"];
          const parsedVal = numericFields.includes(field) ? (isNaN(Number(val)) ? val : Number(val)) : val;
          this._activeFilter = { field, op, value: op === "contains" ? val : parsedVal } as FilterConfig;
        } else { return; }
        await this.loadTasks(); this.renderTable(); closePanel();
      });
      clearBtn.addEventListener("click", async () => { this._activeFilter = null; await this.loadTasks(); this.renderTable(); closePanel(); });
    };

    const toggleFilterPanel = (): void => {
      if (filterPanel.classList.contains("ft-filter-open")) { closePanel(); }
      else {
        const r = filterBtn.getBoundingClientRect();
        filterPanel.setCssStyles({
          left: Math.max(4, Math.min(r.left, window.innerWidth - 300)) + "px",
          top: Math.min(r.bottom + 4, window.innerHeight - 200) + "px",
        });
        buildFilterUI(); filterPanel.classList.add("ft-filter-open"); this._doc.body.appendChild(filterPanel);
      }
    };
    const closePanel = (): void => { filterPanel.classList.remove("ft-filter-open"); if (filterPanel.parentNode) filterPanel.parentNode.removeChild(filterPanel); };
    const closeFilterPanelOnOutside = (e: MouseEvent): void => { if (!filterPanel.contains(e.target as Node) && e.target !== filterBtn) closePanel(); };
    this._doc.addEventListener("click", closeFilterPanelOnOutside, true);
    filterBtn.addEventListener("click", (e: MouseEvent) => { e.stopPropagation(); toggleFilterPanel(); });

    if (!this._groupConfig) this._groupConfig = { primary: null, secondary: null };
    const groupLabel = toolbar.createEl("span", { text: "Group:", cls: "ft-group-label" });
    const groupSel = toolbar.createEl("select", { cls: "ft-group-select" });
    groupSel.createEl("option", { text: "None", value: "" }); groupSel.createEl("option", { text: "Bucket", value: "bucket" });
    groupSel.createEl("option", { text: "Project", value: "project" }); groupSel.createEl("option", { text: "Sprint", value: "sprint" });
    groupSel.createEl("option", { text: "Date", value: "date" }); groupSel.createEl("option", { text: "Status", value: "status" });
    if (this._groupConfig.primary) groupSel.value = this._groupConfig.primary;
    const subLabel = toolbar.createEl("span", { text: "then:", cls: "ft-group-label" });
    const subSel = toolbar.createEl("select", { cls: "ft-group-select" });
    subSel.createEl("option", { text: "None", value: "" }); subSel.createEl("option", { text: "Bucket", value: "bucket" });
    subSel.createEl("option", { text: "Project", value: "project" }); subSel.createEl("option", { text: "Sprint", value: "sprint" });
    subSel.createEl("option", { text: "Date", value: "date" }); subSel.createEl("option", { text: "Status", value: "status" });
    if (this._groupConfig.secondary) subSel.value = this._groupConfig.secondary;
    const applyGroup = (): void => { this._groupConfig!.primary = groupSel.value || null; this._groupConfig!.secondary = subSel.value || null; this.renderTable(); };
    groupSel.addEventListener("change", applyGroup); subSel.addEventListener("change", applyGroup);

    if (this._displayItems.length > 0 || this.tasks.length > 0) {
      toolbar.createEl("span", { text: "|", cls: "ft-group-label ft-toolbar-collapsible" });
      const expandBtn = toolbar.createEl("button", { text: "\u25c0 Expand", cls: "ft-filter-btn ft-toolbar-collapsible" });
      expandBtn.addEventListener("click", () => { this._collapsed.clear(); this.renderTable(); });
      const collapseBtn = toolbar.createEl("button", { text: "\u25b6 Collapse", cls: "ft-filter-btn ft-toolbar-collapsible" });
      collapseBtn.addEventListener("click", () => { for (const item of this._displayItems) { if (item.hasChildren) this._collapsed.add(item.taskId); } this.renderTable(); });
    }

    // Responsive: mark secondary toolbar items as collapsible on small screens
    colBtn.addClass("ft-toolbar-collapsible");
    filterBtn.addClass("ft-toolbar-collapsible");
    groupLabel.addClass("ft-toolbar-collapsible");
    groupSel.addClass("ft-toolbar-collapsible");
    subLabel.addClass("ft-toolbar-collapsible");
    subSel.addClass("ft-toolbar-collapsible");

    // Add "More" toggle button (visible only on mobile)
    const moreBtn = toolbar.createEl("button", { text: "\u22ef", cls: "ft-toolbar-more-btn", attr: { title: "More options" } });
    moreBtn.addEventListener("click", () => { toolbar.classList.toggle("ft-toolbar-expanded"); });

    if (this._viewMode === "list") {
      this._renderListView(tdy);
      if (this.mode === "today" && this.plugin?.settings?.dailyCap) { this._renderDailyCap(); }
      return;
    }

    const tableWrap = this.containerEl.createEl("div", { cls: "ft-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "flowtime-table ft-table" });
    const hr = table.createEl("thead").createEl("tr");

    const sortByColumn = (field: string) => async (_e: MouseEvent): Promise<void> => {
      if (_e.shiftKey) {
        const existing = this._sortConfig.findIndex((s) => s.field === field);
        if (existing >= 0) { this._sortConfig.splice(existing, 1); }
        else { this._sortConfig.push({ field, direction: "asc" }); }
      } else {
        if (this._sortConfig.length === 1 && this._sortConfig[0].field === field) {
          this._sortConfig[0].direction = this._sortConfig[0].direction === "asc" ? "desc" : "asc";
        } else { this._sortConfig = [{ field, direction: "asc" }]; }
      }
      this._sortMode = "custom";
      await this.loadTasks();
      this.renderTable();
    };

    const sortIndicator = (field: string): string => {
      const s = this._sortConfig.find((s) => s.field === field);
      if (!s) return ""; return s.direction === "asc" ? "\u25b2" : "\u25bc";
    };

    const makeSortableHeader = (label: string, field: string | null, cls: string, width: string): HTMLTableHeaderCellElement => {
      const th = hr.createEl("th", { cls }); th.classList.add("ft-sortable");
      if (width) th.setCssProps({ "--ft-col-width": width }); th.createEl("span", { text: label });
      if (field) { th.createEl("span", { cls: "ft-sort-indicator", text: sortIndicator(field) }); th.addEventListener("click", sortByColumn(field)); }
      return th;
    };
    const makeHeader = (cls: string, width: string): HTMLTableHeaderCellElement => {
      const th = hr.createEl("th", { cls }); if (width) th.setCssProps({ "--ft-col-width": width }); return th;
    };

    for (const col of COLUMNS) {
      if (col.compactOnly && !isCompact) continue;
      if (col.compactSkip && isCompact) continue;
      if (this._columnVisibility![col.id] === false) continue;
      if (col.defaultHide && !this._columnVisibility![col.id]) continue;
      const label = (col.id === 'date' && dw) ? 'Due' : col.label;
      if (col.sortField) { makeSortableHeader(label, col.sortField, `col-${col.id}`, col.width); }
      else { makeHeader(`col-${col.id}`, col.width); }
    }
    const tbody = table.createEl("tbody");
    this.bucketTotals = this._computeBucketTotals();
    this.buildRows(tbody);
    this._renderDailyCap();
  }


  _renderBudgetView(): void {
    this.containerEl.empty();
    this.containerEl.createEl("h3", { text: "Budget Overview", cls: "ft-budget-title" });
    if (this._budgetDailyCap > 0) {
      const capSection = this.containerEl.createEl("div", { cls: "ft-budget-section" });
      capSection.createEl("div", { text: "Daily Budget", cls: "ft-budget-section-title" });
      const capRow = capSection.createEl("div", { cls: "ft-budget-row" });
      const bar = renderProgressBar(this._budgetDailyCapUsed, this._budgetDailyCap, undefined, capSection);
      bar.addClass("ft-min-w-250"); capRow.appendChild(bar);
    }
    const section = this.containerEl.createEl("div", { cls: "ft-budget-section" });
    section.createEl("div", { text: "Weekly Bucket Budgets", cls: "ft-budget-section-title" });
    const sorted = [...this.tasks].sort((a, b) => (a._bucketDef?.sortOrder || 0) - (b._bucketDef?.sortOrder || 0));
    for (const task of sorted) {
      const def = task._bucketDef; if (!def) continue;
      const row = section.createEl("div", { cls: "ft-budget-row" });
      const info = row.createEl("div", { cls: "ft-budget-info" });
      const swatch = info.createEl("span", { cls: "ft-bucket-swatch" }); swatch.setCssProps({ "background-color": def.color });
      info.createEl("span", { text: def.name, cls: "ft-budget-name" });
      const usedHours = task.durationMinutes / 60;
      const bar = renderProgressBar(usedHours, def.weeklyLimit, undefined, row);
      bar.addClass("ft-min-w-200"); row.appendChild(bar);
    }
    if (sorted.length === 0) { section.createEl("p", { text: "No buckets configured. Add buckets in Settings.", cls: "ft-budget-empty" }); }
  }

  _renderSprintOverview(): void {
    this.containerEl.empty();
    const sprints = this.plugin?.settings?.sprints || [];
    if (sprints.length === 0) { this.containerEl.createEl("p", { text: "No sprints configured. Add sprints in Settings.", cls: "ft-budget-empty" }); return; }
    const sprintTasks: Record<string, TaskRow[]> = {};
    for (const task of this.tasks) { if (task.sprint) { if (!sprintTasks[task.sprint]) sprintTasks[task.sprint] = []; sprintTasks[task.sprint].push(task); } }
    for (const def of sprints) {
      const tasks = sprintTasks[def.id] || [];
      const card = this.containerEl.createEl("div", { cls: "ft-budget-section" });
      const header = card.createEl("div", { cls: "ft-budget-section-title ft-sprint-card-header" });
      const nameEl = header.createEl("span", { text: def.name, cls: "ft-sprint-name" });
      if (def.color) { nameEl.setCssProps({ "border-left": "3px solid " + def.color }); nameEl.addClass("ft-pl-8"); }
      if (def.goal) { card.createEl("div", { text: def.goal, cls: "ft-sprint-goal" }); }
      if (def.start || def.end) { card.createEl("div", { text: `${def.start || "?"} \u2192 ${def.end || "?"}`, cls: "ft-sprint-dates" }); }
      if (tasks.length > 0) {
        const done = tasks.filter((t) => t.status === "x" || t.status === "X").length;
        const total = tasks.length;
        const taskRow = card.createEl("div", { cls: "ft-budget-row" });
        taskRow.createEl("span", { text: `Tasks: ${done}/${total}`, cls: "ft-sprint-stat" });
        const taskBar = renderProgressBar(done, total, `${Math.round((done / total) * 100)}%`, card); taskBar.addClass("ft-min-w-200"); taskRow.appendChild(taskBar);
        const totalMinutes = tasks.reduce((sum, t) => sum + (t.durationMinutes || 0), 0);
        const doneMinutes = tasks.filter((t) => t.status === "x" || t.status === "X").reduce((sum, t) => sum + (t.durationMinutes || 0), 0);
        if (totalMinutes > 0) {
          const timeRow = card.createEl("div", { cls: "ft-budget-row" });
          timeRow.createEl("span", { text: `Time: ${formatHours(doneMinutes / 60)}h / ${formatHours(totalMinutes / 60)}h`, cls: "ft-sprint-stat" });
          const timeBar = renderProgressBar(doneMinutes, totalMinutes, `${Math.round((doneMinutes / totalMinutes) * 100)}%`, card); timeBar.addClass("ft-min-w-200"); timeRow.appendChild(timeBar);
        }
      } else { card.createEl("p", { text: "No tasks tagged with @sprint:" + def.id, cls: "ft-sprint-empty" }); }
    }
  }

  _renderDailyCap(): void {
    if (this.mode !== "today" || !this.plugin?.settings?.dailyCap) return;
    const dailyCap = this.plugin.settings.dailyCap;
    const refTdy = this._refDate();
    const totalToday = this.tasks.reduce((sum, t) => { if (t.taskDate === refTdy) return sum + (t.durationMinutes || 0); return sum; }, 0) / 60;
    const capRow = this.containerEl.createEl("div", { cls: "ft-daily-cap" });
    capRow.createEl("span", { text: "Daily Budget: ", cls: "ft-cap-label" });
    const bar = renderProgressBar(totalToday, dailyCap, undefined, capRow);
    bar.addClass("ft-min-w-200"); capRow.appendChild(bar);
  }

  _renderListView(tdy: string): void {
    const listWrap = this.containerEl.createEl("div", { cls: "ft-list-wrap", attr: { "data-mode": this.mode } });
    for (const task of this.tasks) { this._renderListRow(listWrap, { task, depth: 0 } as unknown as DisplayItem, tdy); }
    this._setupListDragDrop(listWrap);
  }

  _renderListRow(container: HTMLElement, item: DisplayItem | TaskRow, _tdy: string): HTMLDivElement {
    const task = (item as DisplayItem).task || (item as TaskRow);
    const _depth = (item as DisplayItem).depth !== undefined ? (item as DisplayItem).depth : 0;
    const _hasChildren = !!(item as DisplayItem).hasChildren;
    const _collapsed = !!(item as DisplayItem).collapsed;
    const tid = (item as DisplayItem).taskId || "";
    const { start, dur } = this._parseStored(task.time);
    const row = container.createEl("div", { cls: "ft-list-row", attr: { "data-task-id": tid || "", "data-source-path": task.file?.path || "", "data-line": String(task.line || 0) } });
    row.createEl("span", { text: "\u283f", cls: "ft-list-drag", attr: { title: "Drag to reorder or drop on a heading" } });
    const checkCell = row.createEl("span", { cls: "ft-list-check" });
    const cb = checkCell.createEl("input", { type: "checkbox" });
    cb.checked = !!(task.status && task.status.trim());
    cb.addEventListener("change", async () => {
      await toggleCheck(this.app.vault, task); task.status = cb.checked ? "x" : " ";
      this.plugin?.notify?.(cb.checked ? "\u2705 Task completed" : "\u21a9\ufe0f Task reopened");
    });
    const textSpan = row.createEl("span", { text: task.cleanText || task.rawText || "", cls: "ft-list-text" });
    textSpan.addEventListener("click", (e: MouseEvent) => { e.stopPropagation(); this._showFloatingEditor(task, textSpan); });
    const timeCell = row.createEl("span", { cls: "ft-list-time-cell" });
    const timeEl = timeCell.createEl("span", { cls: "ft-list-time" });
    if (start) {
      timeEl.setText(dur && dur > 0 ? start + " \u2192 " + this._calcEnd(start, dur) : start);
    } else {
      timeEl.setText("\u2014");
    }
    timeEl.addEventListener("click", (e: MouseEvent) => { e.stopPropagation(); this._showFloatingEditor(task, timeEl); });


    const timerCell = row.createEl("span", { cls: "ft-list-timer-cell" });
    this._buildInlineTimer(timerCell, task, dur, true);

    // ── Swipe actions (touch only) ──
    let swipeStartX = 0;
    let swipeDeltaX = 0;
    let swiping = false;
    const SWIPE_THRESHOLD = 80;

    row.addEventListener("touchstart", (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      swipeStartX = e.touches[0].clientX;
      swipeDeltaX = 0;
      swiping = true;
    }, { passive: true });

    row.addEventListener("touchmove", (e: TouchEvent) => {
      if (!swiping || e.touches.length !== 1) return;
      swipeDeltaX = e.touches[0].clientX - swipeStartX;
      row.setCssProps({ transform: `translateX(${swipeDeltaX}px)`, transition: "none" });
    }, { passive: true });

    row.addEventListener("touchend", async () => {
      if (!swiping) return;
      swiping = false;
      row.setCssProps({ transition: "transform 200ms ease-out" });
      if (swipeDeltaX > SWIPE_THRESHOLD) {
        // Swipe right → complete
        row.setCssProps({ transform: "translateX(100%)" });
        row.addClass("ft-op-0");
        window.setTimeout(async () => {
          await toggleCheck(this.app.vault, task);
          task.status = "x";
          this.plugin?.notify?.("\u2705 Task completed");
          await this.loadTasks();
          this.renderTable();
        }, 200);
        return;
      } else if (swipeDeltaX < -SWIPE_THRESHOLD) {
        // Swipe left → reschedule to tomorrow
        row.setCssProps({ transform: "translateX(-100%)" });
        row.addClass("ft-op-0");
        window.setTimeout(async () => {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr = tomorrow.toISOString().split("T")[0];
          await this.updateDate(task, tomorrowStr);
          this.plugin?.notify?.("\u{1F4C5} Rescheduled to tomorrow");
          await this.loadTasks();
          this.renderTable();
        }, 200);
        return;
      }
      // Reset position
      row.setCssProps({ transform: "" });
    });

    return row;
  }

  /**
   * Unified floating editor for both table and list views.
   * Click opens editor (NOT source file). Source link button top-right.
   */
  _showFloatingEditor(task: TaskRow, anchorEl: HTMLElement): void {
    this._doc.querySelectorAll(".ft-floating-editor,.ft-list-popover,.ft-detail-popup").forEach((e) => e.remove());

    const popup = this._doc.createElement("div");
    popup.className = "ft-floating-editor";

    // ── Header: heading + source link button ──
    const header = popup.createEl("div", { cls: "ft-fe-header" });
    header.createEl("span", { text: "Edit Task", cls: "ft-fe-heading" });
    if (task.file) {
      const srcBtn = header.createEl("button", {
        text: "\u{1F517}",
        cls: "ft-fe-source-btn",
        attr: { title: "Open source: " + (task.file.basename || "") + " line " + (task.line + 1) },
      });
      srcBtn.addEventListener("click", () => {
        popup.remove();
        void this.app.workspace.openLinkText(task.file!.path, "", true, { line: task.line + 1 } as any);
      });
    }

    // ── Task text (editable) ──
    const textRow = popup.createEl("div", { cls: "ft-fe-row" });
    textRow.createEl("label", { text: "Task", cls: "ft-fe-label" });
    const textInput = textRow.createEl("input", {
      type: "text", value: task.cleanText, cls: "ft-fe-input ft-fe-text ft-w-full",
    });

    // ── Date ──
    const dateRow = popup.createEl("div", { cls: "ft-fe-row" });
    dateRow.createEl("label", { text: "Date", cls: "ft-fe-label" });
    const dateInput = dateRow.createEl("input", {
      type: "date", value: task.taskDate || "", cls: "ft-fe-input",
    });

    // ── Start Time ──
    const startTimeRow = popup.createEl("div", { cls: "ft-fe-row" });
    startTimeRow.createEl("label", { text: "Start", cls: "ft-fe-label" });
    const { start: curStart } = this._parseStored(task.time);
    const startInput = startTimeRow.createEl("input", {
      type: "text", value: curStart || "", placeholder: "09:00",
      cls: "ft-fe-input",
    });

    // ── Duration ──
    const durRow = popup.createEl("div", { cls: "ft-fe-row" });
    durRow.createEl("label", { text: "Duration", cls: "ft-fe-label" });
    const durSelect = durRow.createEl("select", { cls: "ft-fe-select" });
    for (const d of [0, 10, 15, 20, 25, 30, 45, 60, 90, 120, 150, 180, 210, 240]) {
      const opt = durSelect.createEl("option", {
        text: d === 0 ? "None" : d < 60 ? d + "m" : d / 60 + "h", value: String(d),
      });
      if (task.durationMinutes === d) opt.selected = true;
    }

    // ── Bucket ──
    const bucketRow = popup.createEl("div", { cls: "ft-fe-row" });
    bucketRow.createEl("label", { text: "Bucket", cls: "ft-fe-label" });
    const bucketSel = bucketRow.createEl("select", { cls: "ft-fe-select" });
    bucketSel.createEl("option", { text: "None", value: "" });
    for (const b of (this.plugin?.settings?.buckets || [])) {
      const opt = bucketSel.createEl("option", { text: b.name, value: b.id });
      if (b.id === task.bucket) opt.selected = true;
    }

    // ── Project (read-only) ──
    const projRow = popup.createEl("div", { cls: "ft-fe-row" });
    projRow.createEl("label", { text: "Project", cls: "ft-fe-label" });
    if (task.project) {
      const pl = projRow.createEl("a", { text: task.project, cls: "ft-fe-link" });
      pl.addEventListener("click", () => { popup.remove(); void this.app.workspace.openLinkText(task.projectPath || task.project || "", "", true); });
    } else { projRow.createEl("span", { text: "\u2014", cls: "ft-fe-value" }); }

    // ── Buttons ──
    const btnRow = popup.createEl("div", { cls: "ft-fe-btn-row" });
    btnRow.createEl("button", { text: "Cancel", cls: "ft-fe-cancel" }).addEventListener("click", () => popup.remove());
    const saveBtn = btnRow.createEl("button", { text: "Save", cls: "ft-fe-save" });

    const doSave = async (): Promise<void> => {
      if (!task.file) { popup.remove(); return; }
      let changed = false;

      // Text
      const newText = textInput.value.trim();
      if (newText && newText !== task.cleanText) {
        try {
          const content = await this.app.vault.read(task.file);
          const lines = content.split("\n");
          const ln = lines[task.line];
          if (ln) {
            const m = ln.match(/^(\s*[-*+]\s*\[[^\]]*\]\s*)(.*)$/);
            if (m) {
              const dirs = m[2].match(/@\S+/g)?.join(" ") || "";
              const tp = m[2].match(/^\d{1,2}:\d{2}(\s*[\u2014\-\u2013]\s*\d{1,2}:\d{2})?/)?.[0] || "";
              lines[task.line] = m[1] + (tp ? tp + " " : "") + newText + (dirs ? " " + dirs : "");
              await this.app.vault.modify(task.file, lines.join("\n"));
              task.cleanText = newText; changed = true;
            }
          }
        } catch (e) { this.plugin?.notify?.("\u274C Text: " + (e as Error).message, true); }
      }

      // Date
      const nd = dateInput.value;
      if (nd && nd !== task.taskDate) {
        await updateDate(this.app.vault, task, nd); task.taskDate = nd; changed = true;
      }

      // Duration
      const dur = parseInt(durSelect.value, 10);
      if (dur !== task.durationMinutes) {
        try {
          const content = await this.app.vault.read(task.file);
          const lines = content.split("\n");
          const ln = lines[task.line];
          if (ln) {
            let nl = ln.replace(/@\d+(?:\.\d+)?[hm]/g, "");
            if (dur > 0) nl = nl.trimEnd() + " @" + (dur < 60 ? dur + "m" : dur / 60 + "h");
            lines[task.line] = nl;
            await this.app.vault.modify(task.file, lines.join("\n"));
            task.durationMinutes = dur; changed = true;
          }
        } catch (e) { this.plugin?.notify?.("\u274C Duration: " + (e as Error).message, true); }
      }

      // Start Time
      const ns = startInput.value.trim();
      if (ns && ns !== curStart) {
        try {
          const content = await this.app.vault.read(task.file);
          const lines = content.split("\n");
          const ln = lines[task.line];
          if (ln) {
            const m2 = ln.match(/^(\s*[-*+]\s*\[[^\]]*\]\s*)(.*)$/);
            if (m2) {
              const rest = m2[2].replace(/^\d{1,2}:\d{2}(\s*[\u2014\-\u2013]\s*\d{1,2}:\d{2})?\s*/, "");
              lines[task.line] = m2[1] + ns + " " + rest;
              await this.app.vault.modify(task.file, lines.join("\n"));
              changed = true;
            }
          }
        } catch (e) { this.plugin?.notify?.("\u274C Start: " + (e as Error).message, true); }
      }

      // Bucket
      const bk = bucketSel.value;
      if (bk !== (task.bucket || "")) {
        try {
          const content = await this.app.vault.read(task.file);
          const lines = content.split("\n");
          const ln = lines[task.line];
          if (ln) {
            lines[task.line] = bk
              ? (ln.match(/@(?:bucket|b):[^\s]+/) ? ln.replace(/@(?:bucket|b):[^\s]+/g, `@b:${bk}`) : ln.trimEnd() + ` @b:${bk}`)
              : ln.replace(/@(?:bucket|b):[^\s]+\s*/g, "");
            await this.app.vault.modify(task.file, lines.join("\n"));
            task.bucket = bk || null; changed = true;
          }
        } catch (e) { this.plugin?.notify?.("\u274C Bucket: " + (e as Error).message, true); }
      }

      if (changed) {
        this.plugin?.notify?.("\u2705 Updated");
        // Update in-place to avoid full reload — cache invalidates the file
        if (this.plugin?.taskCache && task.file) this.plugin.taskCache.invalid(task.file.path);
        this.renderTable();
      }
      popup.remove();
    };

    saveBtn.addEventListener("click", doSave);
    textInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSave(); }
    });

    const rect = anchorEl.getBoundingClientRect();
    const popupW = Math.min(360, window.innerWidth - 16);
    // Position: prefer below anchor, flip above if not enough room
    const spaceBelow = window.innerHeight - rect.bottom;
    const estimateH = 300; // estimated editor height
    const popupTop = spaceBelow >= estimateH || spaceBelow > rect.top
      ? Math.min(rect.bottom + 4, window.innerHeight - estimateH) + "px"
      : Math.max(4, rect.top - estimateH - 4) + "px";
    popup.setCssStyles({
      left: Math.max(4, Math.min(rect.left, window.innerWidth - popupW - 8)) + "px",
      top: popupTop,
      maxWidth: popupW + "px",
      maxHeight: (window.innerHeight - 16) + "px",
      overflowY: "auto",
    });

    const closeOutside = (e: MouseEvent): void => {
      if (popup.contains(e.target as Node)) return;
      this._doc.removeEventListener("click", closeOutside, true);
      popup.remove();
    };
    window.setTimeout(() => this._doc.addEventListener("click", closeOutside, true), 200);
    this._doc.body.appendChild(popup);
    textInput.focus(); textInput.select();
  }

  _setupListDragDrop(listWrap: HTMLDivElement): void {
    let dragState: { path: string; line: number; row: HTMLDivElement; startX: number; startY: number } | null = null;
    let rowToIndex: Map<HTMLDivElement, number> | null = null;
    const dragRoot = this.containerEl;
    const buildRowMap = (): void => {
      const map = new Map<HTMLDivElement, number>();
      dragRoot.querySelectorAll<HTMLDivElement>(".ft-list-row").forEach((row) => {
        const path = row.dataset.sourcePath;
        const line = parseInt(row.dataset.line || "0", 10);
        const idx = this.tasks.findIndex((t) => t.file?.path === path && t.line === line);
        if (idx >= 0) map.set(row, idx);
      });
      rowToIndex = map;
    };
    const clearIndicators = (): void => {
      dragRoot.querySelectorAll<HTMLElement>(".ft-list-drop-target,.ft-list-dragging,.ft-list-drop-before,.ft-list-drop-after,.ft-list-heading-active").forEach((el) => {
        el.classList.remove("ft-list-drop-target", "ft-list-dragging", "ft-list-drop-before", "ft-list-drop-after", "ft-list-heading-active");
      });
    };
    listWrap.addEventListener("mousedown", (e: MouseEvent) => {
      const handle = (e.target as HTMLElement).closest(".ft-list-drag"); if (!handle) return;
      const row = (handle as HTMLElement).closest(".ft-list-row") as HTMLDivElement | null; if (!row) return;
      e.preventDefault(); buildRowMap(); clearIndicators();
      dragState = { path: row.dataset.sourcePath || "", line: parseInt(row.dataset.line || "0", 10), row, startX: e.clientX, startY: e.clientY };
      row.classList.add("ft-list-dragging");
    });
    let moveFrame: number | null = null;
    this._doc.addEventListener("mousemove", (e: MouseEvent) => {
      if (!dragState || moveFrame) return;
      moveFrame = window.requestAnimationFrame(() => {
        moveFrame = null; const ds = dragState; if (!ds) return;
        // Batch all DOM reads first
        const el = this._doc.elementFromPoint(e.clientX, e.clientY);
        // Then batch all DOM writes together
        clearIndicators(); ds.row.classList.add("ft-list-dragging");
        if (!el) return;
        const targetRow = (el as HTMLElement).closest(".ft-list-row") as HTMLDivElement | null;
        if (targetRow && targetRow !== ds.row) {
          const rect = targetRow.getBoundingClientRect();
          targetRow.classList.add(e.clientY < rect.top + rect.height / 2 ? "ft-list-drop-before" : "ft-list-drop-after"); return;
        }
        const heading = (el as HTMLElement).closest("h1, h2, h3, h4, h5, h6");
        if (heading && !heading.closest(".ft-list-wrap")) { heading.classList.add("ft-list-heading-active"); }
      });
    });
    this._doc.addEventListener("mouseup", async (e: MouseEvent) => {
      if (!dragState) return;
      const el = this._doc.elementFromPoint(e.clientX, e.clientY); clearIndicators();
      const srcIdx = rowToIndex?.get(dragState.row) ?? -1;
      if (srcIdx < 0) { dragState = null; return; }
      const targetRow = (el as HTMLElement | null)?.closest(".ft-list-row") as HTMLDivElement | null;
      if (targetRow && targetRow !== dragState.row) {
        const tgtIdx = rowToIndex?.get(targetRow) ?? -1;
        if (tgtIdx >= 0 && tgtIdx !== srcIdx) {
          const srcTask = this.tasks[srcIdx]; const targetTask = this.tasks[tgtIdx];
          const rect = targetRow.getBoundingClientRect();
          let beforeTask: TaskRow | null, afterTask: TaskRow | null;
          if (e.clientY < rect.top + rect.height / 2) { beforeTask = tgtIdx > 0 ? this.tasks[tgtIdx - 1] : null; afterTask = targetTask; }
          else { beforeTask = targetTask; afterTask = tgtIdx < this.tasks.length - 1 ? this.tasks[tgtIdx + 1] : null; }
          const bi = beforeTask?.sortIndex ?? 0; const ai = afterTask?.sortIndex ?? (beforeTask ? bi + 2000 : 1000);
          const newIdx = Math.round((bi + ai) / 2);
          let newTime = "";
          if (beforeTask?.time && afterTask?.time) { newTime = this._midpointTime(beforeTask.time, afterTask.time); }
          else if (afterTask?.time) { newTime = afterTask.time; } else if (beforeTask?.time) { newTime = beforeTask.time; }
          await this._setTaskIndex(srcTask, newIdx); srcTask.sortIndex = newIdx;
          const timeStr = await this._setTaskTime(srcTask, newTime, srcTask.durationMinutes);
          if (timeStr) srcTask.time = timeStr;
          this._sortConfig = []; this._sortMode = null; this._sort(); this.renderTable();
          buildRowMap();
          this.plugin?.notify?.("\u{1F504} Time updated"); dragState = null; return;
        }
      }
      const heading = (el as HTMLElement | null)?.closest("h1, h2, h3, h4, h5, h6");
      if (heading) {
        heading.classList.remove("ft-list-heading-active"); const srcTask = this.tasks[srcIdx];
        if (srcTask) {
          const text = heading.textContent?.trim().toLowerCase() || "";
          if (text === "today") { await this.updateDate(srcTask, this._refDate()); this.plugin?.notify?.("\u{1F4C5} Moved to today"); }
          else if (text === "tomorrow") { await this.updateDate(srcTask, new Date(Date.now() + 864e5).toISOString().split("T")[0]); this.plugin?.notify?.("\u{1F4C5} Moved to tomorrow"); }
          else if (text === "overdue" || text === "carry over") { await this.updateDate(srcTask, new Date(Date.now() - 864e5).toISOString().split("T")[0]); this.plugin?.notify?.("\u{1F4C5} Moved to overdue"); }
          else if (text === "soon" || text === "up next") { await this.updateDate(srcTask, ""); this.plugin?.notify?.("\u25cc Back to @soon"); }
          else if (text === "next week") { await this.updateDate(srcTask, new Date(Date.now() + 7 * 864e5).toISOString().split("T")[0]); this.plugin?.notify?.("\u{1F4C5} Moved to next week"); }
          else { const dateMatch = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (dateMatch) { await this.updateDate(srcTask, text); this.plugin?.notify?.("\u{1F4C5} Date set to " + text); } }
        }
      }
      dragState = null;
    });
  }


  _toMin(s: string): number { if (!s) return 0; const start = s.split(/[\u2014\-\u2013]/)[0].trim(); const p = start.split(":").map(Number); return p[0] * 60 + (p[1] || 0); }
  _fromMin(m: number): string { const h = Math.min(Math.floor(m / 60), 23); const min = Math.max(0, m % 60); return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0"); }
  _offsetTime(time: string, minutes: number): string { if (!time) return ""; return this._fromMin(this._toMin(time) + minutes); }
  _midpointTime(t1: string, t2: string): string { const m1 = this._toMin(t1); const m2 = this._toMin(t2); if (m2 <= m1) return this._fromMin(m1 + 15); return this._fromMin(Math.round((m1 + m2) / 2 / 5) * 5); }

  async _setTaskIndex(task: TaskRow, newIdx: number): Promise<void> {
    if (!task.file) return;
    try {
      const lines = (await this.app.vault.read(task.file)).split("\n"); const line = lines[task.line]; if (!line) return;
      const m = line.match(/^(\s*[-*+]\s*\[[^\]]*\]\s*)(.*)$/); if (!m) return;
      let rest = m[2].replace(/@i:[\d.]+/g, "").trim();
      const timePrefix = rest.match(/^\d{1,2}:\d{2}(?:[\u2014\-\u2013]\d{1,2}:\d{2})?\s*/);
      if (timePrefix) { const prefix = timePrefix[0]; const after = rest.slice(prefix.length); rest = prefix + `@i:${newIdx} ` + after; }
      else { rest = `@i:${newIdx} ` + rest; }
      lines[task.line] = m[1] + rest.trim(); await this.app.vault.modify(task.file, lines.join("\n"));
    } catch (e) { console.warn("Flowtime: Could not update task index:", e); }
  }

  async _setTaskTime(task: TaskRow, newTime: string, durationMinutes: number): Promise<string> {
    if (!task.file) return "";
    try {
      const lines = (await this.app.vault.read(task.file)).split("\n"); const line = lines[task.line]; if (!line) return "";
      const m = line.match(/^(\s*[-*+]\s*\[[^\]]*\]\s*)(.*)$/); if (!m) return "";
      const rest = m[2].replace(/^\d{1,2}:\d{2}(?:\s*[\u2014\-\u2013]\s*\d{1,2}:\d{2})?\s*/, "").trim();
      let timeStr = "";
      if (newTime) { timeStr = durationMinutes > 0 ? newTime + "\u2014" + this._calcEnd(newTime, durationMinutes) : newTime; }
      lines[task.line] = m[1] + (timeStr ? timeStr + " " : "") + rest;
      await this.app.vault.modify(task.file, lines.join("\n")); task.time = timeStr; return timeStr;
    } catch (e) { console.warn("Flowtime: Could not update task time:", e); return ""; }
  }

  buildRows(tbody: HTMLTableSectionElement): void {
    tbody.empty(); this.rowData = []; this._resyncDone = false;
    this._doc.querySelectorAll(".ft-date-popup,.ft-detail-popup").forEach((e) => e.remove());
    if (this._closePopups) { this._doc.removeEventListener("click", this._closePopups, true); this._closePopups = null; }
    const tdy = this._refDate();
    const od = this.mode === "overdue", _dw = this.mode === "dueweek", wk = this.mode === "weekly", pj = this.mode === "project";
    const isCompact = od || _dw || wk;
    const { primary, secondary } = this._groupConfig || {};
    if (primary) {
      const groups: Record<string, Record<string, TaskRow[]>> = {};
      for (const task of this.tasks) {
        const key = this._getGroupValue(task, primary); const subKey = secondary ? this._getGroupValue(task, secondary) : "__all__";
        if (!groups[key]) groups[key] = {}; if (!groups[key][subKey]) groups[key][subKey] = []; groups[key][subKey].push(task);
      }
      const keys = Object.keys(groups).sort();
      for (const key of keys) {
        const gr = tbody.createEl("tr", { cls: "ft-project-group" });
        gr.createEl("td", { text: key || "Other", attr: { colspan: String(this._visibleColCount(isCompact)) } });
        const subGroups = groups[key]; const subKeys = Object.keys(subGroups).sort();
        for (const subKey of subKeys) {
          if (secondary) { const sr = tbody.createEl("tr", { cls: "ft-subgroup-header" }); sr.createEl("td", { text: "  " + (subKey || "Other"), attr: { colspan: String(this._visibleColCount(isCompact)) } }); }
          for (const t of subGroups[subKey]) { this._renderTaskRow(tbody, { task: t, depth: 0 } as unknown as DisplayItem, tdy, od, _dw, wk, pj, isCompact); }
        }
      }
    } else {
      const emptyChildren: TaskRow[] = [];
      this._displayItems = this.tasks.map((t) => ({ task: t, depth: 0, hasChildren: false, collapsed: false, taskId: "", childrenTasks: emptyChildren, childrenCount: 0 }));
      for (const item of this._displayItems) { this._renderTaskRow(tbody, item, tdy, od, _dw, wk, pj, isCompact); }
    }
  }


  _buildDisplayTree(tasks: TaskRow[]): DisplayItem[] {
    if (!tasks || tasks.length === 0) return [];
    const byFile: Record<string, TaskRow[]> = {};
    for (const task of tasks) { const key = task.file?.path || "_orphan"; if (!byFile[key]) byFile[key] = []; byFile[key].push(task); }
    const allRoots: TreeNode[] = [];
    for (const fileTasks of Object.values(byFile)) { const roots = buildTaskTree(fileTasks as unknown as Pick<ParsedTask, "indent">[]); allRoots.push(...roots); }
    return flattenTree(allRoots, this._collapsed);
  }

  _renderTaskRow(tbody: HTMLTableSectionElement, item: DisplayItem | TaskRow, tdy: string, od: boolean, _dw: boolean, wk: boolean, pj: boolean, isCompact: boolean): void {
    const task = (item as DisplayItem).task || (item as TaskRow);
    const depth = (item as DisplayItem).depth !== undefined ? (item as DisplayItem).depth : 0;
    const hasChildren = !!(item as DisplayItem).hasChildren; const collapsed = !!(item as DisplayItem).collapsed;
    const tid = (item as DisplayItem).taskId || ""; const childrenTasks = (item as DisplayItem).childrenTasks || [];
    const { start, dur } = this._parseStored(task.time); const row = tbody.createEl("tr");
    let si: HTMLInputElement | null = null, ds: HTMLInputElement | null = null;

    if (!isCompact && this._columnVisibility!.time !== false) {
      const tc = row.createEl("td"); const timeRow = tc.createEl("div", { cls: "ft-time-row" });
      const startId = "ft-time-list-" + (this.rowData.length || 0) + Math.random().toString(36).slice(2, 6);
      const startGroup = timeRow.createEl("div", { cls: "ft-time-group" });
      si = startGroup.createEl("input", { type: "text", value: start || "", placeholder: "09:00", cls: "ft-start-input", attr: { list: startId } });
      const startList = startGroup.createEl("datalist", { attr: { id: startId } });
      for (const t of this.startOpts) { startList.createEl("option", { attr: { value: t } }); }
      const durId = "ft-dur-list-" + (this.rowData.length || 0) + Math.random().toString(36).slice(2, 6);
      const durGroup = timeRow.createEl("div", { cls: "ft-time-group" });
      ds = durGroup.createEl("input", { type: "text", value: dur ? formatDuration(dur) : "", placeholder: "30m", cls: "ft-dur-input", attr: { list: durId } });
      const durList = durGroup.createEl("datalist", { attr: { id: durId } });
      for (const d of DUR_OPTS) { durList.createEl("option", { attr: { value: formatDuration(d) } }); }
      const ps = timeRow.createEl("span", { text: "", cls: "ft-preview" });
      const up = (): void => { const s = si!.value; const d = parseDurStr(ds!.value); ps.setText(s && d > 0 ? "\u2192 " + this._calcEnd(s, d) : ""); };
      const debounceSave = (() => { let timer: ReturnType<typeof setTimeout>; return (): void => { if (timer) window.clearTimeout(timer); timer = window.setTimeout(() => this._autoSaveTime(task, si!, ds!), 300); }; })();
      si.addEventListener("input", () => { up(); debounceSave(); }); ds.addEventListener("input", () => { up(); debounceSave(); }); up();
    }

    if (this._columnVisibility!.check !== false) this._buildCheckCell(row, task);
    if (this._columnVisibility!.priority !== false && this._columnVisibility!.priority) {
      const pc = row.createEl("td", { cls: "ft-priority-cell", attr: { style: "text-align:center" } });
      if (task.priority) { pc.createEl("span", { text: task.priority, cls: "ft-priority-badge" }); }
    }
    if (this._columnVisibility!.soon !== false && this._columnVisibility!.soon) {
      const sc = row.createEl("td", { cls: "ft-soon-cell", attr: { style: "text-align:center" } });
      if (task.isSoon) { sc.createEl("span", { text: "\u25cc", cls: "ft-soon-badge" }); }
    }
    if (this._columnVisibility!.task !== false) this._buildTaskCell(row, task, depth, hasChildren, collapsed, tid, childrenTasks);

    if (this._columnVisibility!.project !== false) {
      const pc = row.createEl("td", { cls: "ft-project-cell" });
      if (task.project) {
        const plink = pc.createEl("a", { text: task.project, cls: "ft-project-link" });
        if (task.projectPath) { plink.addEventListener("click", () => void this.app.workspace.openLinkText(task.projectPath!, "", true)); }
      } else { pc.createEl("span", { text: "\u2014", cls: "ft-project-none" }); }
    }

    if (this._columnVisibility!.bucket !== false) {
      const bc = row.createEl("td", { cls: "ft-bucket-cell" });
      if (task.bucket) {
        const buckets = this.plugin?.settings?.buckets || []; const bucketDef = buckets.find((b) => b.id === task.bucket);
        if (bucketDef) {
          bc.createEl("div", { text: bucketDef.name, cls: "ft-bucket-label" });
          if (bucketDef.weeklyLimit > 0) {
            const used = (this.bucketTotals?.[task.bucket] || 0) / 60;
            const bar = renderProgressBar(used, bucketDef.weeklyLimit, undefined, bc);
            bar.addClass("ft-min-w-100"); bc.appendChild(bar);
          } else { bc.createEl("div", { text: "no limit", cls: "ft-bucket-nolimit" }); }
        } else { bc.createEl("span", { text: task.bucket, cls: "ft-bucket-missing" }); }
      } else { bc.createEl("span", { text: "\u2014", cls: "ft-bucket-none" }); }
    }

    if (this._columnVisibility!.sprint !== false && this._columnVisibility!.sprint) {
      const spc = row.createEl("td", { cls: "ft-bucket-cell" });
      if (task.sprint) {
        const badge = spc.createEl("span", { text: this._sprintName(task.sprint), cls: "ft-sprint-badge" });
        const sprints = this.plugin?.settings?.sprints || []; const def = sprints.find((s) => s.id === task.sprint);
        if (def?.color) { badge.setCssProps({ "border-left-color": def.color }); }
      } else { spc.createEl("span", { text: "\u2014", cls: "ft-bucket-none" }); }
    }

    if (this._columnVisibility!.source !== false) {
      const sc = row.createEl("td", { cls: "ft-source" });
      const lnk = sc.createEl("a", { text: task.file?.basename || "\u2014", cls: "ft-source-link" });
      if (task.file) { lnk.addEventListener("click", () => void this.app.workspace.openLinkText(task.file!.path, "", true, { line: task.line + 1 } as any)); }
    }

    if (this._columnVisibility!.date !== false) {
      const dc = row.createEl("td", { cls: "ft-date-cell" }); const dw = dc.createEl("div", { cls: "ft-date-wrap" });
      const hasDate = !!task.taskDate;
      const ds2 = dw.createEl("span", { text: hasDate ? this._fmtDate(task.taskDate) : "+", cls: "ft-date-badge" + (hasDate ? "" : " ft-date-none") });
      const dp = this._doc.createElement("div"); dp.className = "ft-date-popup";
      const dpi = dp.createEl("input", { type: "date", value: task.taskDate || "", cls: "ft-dp-input" });
      const mkDpBtn = (txt: string, cls: string): HTMLButtonElement => dp.createEl("button", { text: txt, cls });
      const bTdy = mkDpBtn("Today", "ft-dp-btn"), bTmw = mkDpBtn("Tomorrow", "ft-dp-btn"), bNw = mkDpBtn("Next Week", "ft-dp-btn"), bBkl = mkDpBtn("\u21a9\ufe0f Backlog", "ft-dp-btn");
      const fmt = (d: Date): string => d.toISOString().split("T")[0];
      if (!this._closePopups) {
        this._closePopups = (ev: MouseEvent): void => {
          this._doc.querySelectorAll(".ft-date-popup.ft-dp-open").forEach((p) => {
            if (p.contains(ev.target as Node) || ((p as HTMLDivElement & { _badge?: HTMLElement })._badge?.contains(ev.target as Node))) return;
            p.classList.remove("ft-dp-open"); if (p.parentNode) p.parentNode.removeChild(p);
          });
        };
        this._doc.addEventListener("click", this._closePopups, true);
      }
      (dp as HTMLDivElement & { _badge?: HTMLElement })._badge = ds2;
      const op = (): void => { const r = dw.getBoundingClientRect(); dp.setCssStyles({ left: Math.max(4, Math.min(r.left, window.innerWidth - 190)) + "px", top: Math.min(r.bottom + 4, window.innerHeight - 250) + "px" }); this._doc.body.appendChild(dp); window.requestAnimationFrame(() => { if (dp.parentNode) dp.classList.add("ft-dp-open"); }); };
      const cp = (): void => { dp.classList.remove("ft-dp-open"); window.setTimeout(() => { if (dp.parentNode) dp.parentNode.removeChild(dp); }, 150); };
      ds2.addEventListener("click", (e: MouseEvent) => { e.stopPropagation(); dp.classList.contains("ft-dp-open") ? cp() : op(); });
      const ap = async (nd: string): Promise<void> => {
        cp();
        try {
          await this.updateDate(task, nd); task.taskDate = nd;
          if (nd && nd === tdy) { ds2.setText(this._fmtDate(nd)); ds2.removeClass("ft-date-none"); await this._refreshSiblings(); }
          else { row.remove(); this.tasks = this.tasks.filter((t) => t !== task); this.rowData = this.rowData.filter((r) => r.task !== task); if (!this.tasks.length) this.renderTable(); if (nd && nd !== tdy) await this._refreshSiblings(); }
        } catch (e) { this.plugin?.notify?.("\u274c " + (e as Error).message, true); }
      };
      dpi.addEventListener("change", () => ap(dpi.value)); bTdy.addEventListener("click", () => ap(fmt(new Date()))); bTmw.addEventListener("click", () => ap(fmt(new Date(Date.now() + 864e5)))); bNw.addEventListener("click", () => ap(fmt(new Date(Date.now() + 7 * 864e5)))); bBkl.addEventListener("click", () => ap(""));
    }


    if (isCompact && this._columnVisibility!.actions !== false) {
      const ac = row.createEl("td", { cls: "ft-actions-cell" }); const aw = ac.createEl("div", { cls: "ft-actions-wrap" });
      const abTdy = aw.createEl("button", { text: "\ud83d\udcc5 Today", cls: "ft-act-btn" });
      abTdy.addEventListener("click", async () => { await this.updateDate(task, tdy); await this._refreshSiblings(); row.remove(); this.tasks = this.tasks.filter((t) => t !== task); if (!this.tasks.length) this.renderTable(); });
      if (od) { const abBkl = aw.createEl("button", { text: "\u21a9\ufe0f Backlog", cls: "ft-act-btn" }); abBkl.addEventListener("click", async () => { await this.updateDate(task, ""); await this._refreshSiblings(); row.remove(); this.tasks = this.tasks.filter((t) => t !== task); if (!this.tasks.length) this.renderTable(); }); }
    } else if (!isCompact && this._columnVisibility!.timer !== false) {
      const tmr = row.createEl("td", { cls: "ft-timer-cell" });
      const { update } = this._buildInlineTimer(tmr, task, dur, false);
      if (ds) {
        ds.addEventListener("change", () => {
          const dm = parseInt(ds.value, 10);
          update(dm && dm > 0 ? dm : 0);
        });
      }
    }
    if (!isCompact) this.rowData.push({ task, si, ds });
  }

  /**
   * Shared inline timer — same DOM + logic for table and list views.
   * Returns an { update(durMinutes): void } handle so callers can rebind
   * duration when the input changes.
   */
  _buildInlineTimer(
    container: HTMLElement,
    task: TaskRow,
    durMinutes: number,
    isInline: boolean,
  ): { update: (durMin: number) => void } {
    const dur = durMinutes;
    const taskName = task.cleanText || task.rawText || "";
    const row = container.createEl("div", {
      cls: "ft-timer-row" + (isInline ? " ft-timer-inline" : ""),
    });
    const pb = row.createEl("button", { text: "\u25b6", cls: "ft-timer-play" });
    const tmrBar = row.createEl("div", { cls: "ft-timer-progress ft-state-normal" });
    const tmrFill = tmrBar.createEl("div", { cls: "ft-timer-progress-fill" });
    const disp = row.createEl("span", { text: formatTimer(dur * 60), cls: "ft-timer-display" });
    const rb = row.createEl("button", { text: "\u21ba", cls: "ft-timer-reset" });

    const ts: TimerState = { remaining: dur * 60, total: dur * 60, interval: null, running: false };

    const ud = (): void => {
      disp.setText(formatTimer(ts.remaining));
      disp.toggleClass("ft-timer-expired", ts.remaining <= 0);
      const pct = ts.total > 0 ? ((ts.total - ts.remaining) / ts.total) * 100 : 0;
      tmrFill.setCssProps({ width: Math.min(pct, 100) + "%" });
      tmrBar.className =
        "ft-timer-progress ft-state-" +
        (pct >= 100 ? "over" : pct >= 80 ? "warning" : "normal");
    };

    const stp = (): void => {
      if (this.plugin) this.plugin._activeRowTimerStop = null;
      if (ts.interval) { window.clearInterval(ts.interval); ts.interval = null; }
      ts.running = false;
      pb.setText("\u25b6");
      if (this.plugin?.statusTimer?.stop) this.plugin.statusTimer.stop();
    };

    const startTimer = (): void => {
      if (ts.remaining <= 0) return;
      ts.running = true;
      pb.setText("\u23f8");
      ts.interval = window.setInterval(() => {
        ts.remaining--;
        ud();
        if (ts.remaining <= 0) {
          stp();
          ts.remaining = 0;
          ud();
          disp.addClass("ft-timer-expired");
          this.plugin?.notify?.("\u23f0 Time's up! " + taskName);
          if (this.plugin?.settings?.timerSound !== false) this._beep?.();
          if (this.plugin?.statusTimer?.stop) this.plugin.statusTimer.stop();
          if (this.plugin?.sessionStore) {
            const now = new Date();
            void this.plugin.sessionStore.writeSession({
              startTime: new Date(now.getTime() - ts.total * 1000).toISOString(),
              endTime: now.toISOString(),
              durationMinutes: Math.round(ts.total / 60),
              bucket: task.bucket || "",
              taskText: taskName,
              notes: "",
            });
          }
        }
      }, 1000);
      if (this.plugin?.statusTimer?.start) {
        this.plugin.statusTimer.start(taskName, ts.remaining);
      }
      if (this.plugin) this.plugin._activeRowTimerStop = stp;
    };

    const pauseTimer = (): void => {
      if (ts.interval) { window.clearInterval(ts.interval); ts.interval = null; }
      ts.running = false;
      pb.setText("\u25b6");
      if (this.plugin?.statusTimer?.pause) this.plugin.statusTimer.pause();
    };

    pb.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      const dm = ts.total / 60;
      if (!dm || dm <= 0) return;
      if (ts.running) {
        pauseTimer();
      } else {
        if (ts.remaining <= 0) { ts.remaining = dm * 60; ts.total = dm * 60; ud(); }
        startTimer();
      }
    });

    rb.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      stp();
      const dm = ts.total / 60;
      ts.remaining = dm && dm > 0 ? dm * 60 : 0;
      ts.total = ts.remaining;
      ud();
    });

    const update = (newDurMin: number): void => {
      const isActive = ts.running || this.plugin?.statusTimer?.currentTimer?.taskName === taskName;
      if (isActive) stp();
      ts.remaining = newDurMin > 0 ? newDurMin * 60 : 0;
      ts.total = ts.remaining;
      ud();
    };

    return { update };
  }

  _buildTaskCell(row: HTMLTableRowElement, task: TaskRow, depth: number, hasChildren: boolean, collapsed: boolean, tid: string, childrenTasks: TaskRow[]): void {
    const tc = row.createEl("td", { cls: "ft-task-cell" });
    if (depth > 0) { tc.setCssProps({ "padding-left": depth * 18 + 8 + "px" }); }
    if (hasChildren) {
      const toggle = tc.createEl("span", { text: collapsed ? "\u25b6" : "\u25bc", cls: "ft-tree-toggle" });
      toggle.addEventListener("click", (e: MouseEvent) => { e.stopPropagation(); if (this._collapsed.has(tid)) this._collapsed.delete(tid); else this._collapsed.add(tid); this.renderTable(); });
    }
    if (task.priority) { tc.createEl("span", { text: task.priority, cls: "ft-priority" }); }
    const textEl = tc.createEl("span", { text: task.cleanText, cls: "ft-task-text" });
    if (task.status === "x" || task.status === "X") { row.addClass("ft-task-done"); textEl.addClass("ft-task-done-text"); }
    if (hasChildren && childrenTasks && childrenTasks.length > 0) {
      const done = childrenTasks.filter((c) => c.status === "x" || c.status === "X").length; const total = childrenTasks.length;
      const bar = tc.createEl("span", { cls: "ft-sub-progress", text: ` [${done}/${total}]` }); bar.title = `${done} of ${total} subtasks done (${Math.round((done / total) * 100)}%)`;
    }
    textEl.addEventListener("click", (e: MouseEvent) => { e.stopPropagation(); this._showFloatingEditor(task, textEl); });
  }

  _buildCheckCell(row: HTMLTableRowElement, task: TaskRow): void {
    const cc = row.createEl("td", { cls: "ft-check-cell" }); const done = task.status === "x" || task.status === "X";
    const chk = cc.createEl("span", { cls: "ft-checkbox" + (done ? " ft-checked" : "") });
    chk.addEventListener("click", async (e: MouseEvent) => { e.stopPropagation(); chk.classList.toggle("ft-checked"); await this.toggleTaskComplete(task); });
  }

  async _autoSaveTime(task: TaskRow, si: HTMLInputElement, ds: HTMLInputElement): Promise<void> {
    const s = si?.value; const d = ds ? parseDurStr(ds.value) : 0; if (!s || !d || d <= 0) return;
    const nt = s + "\u2014" + this._calcEnd(s, d); if (nt === task.time) return;
    try { await this.saveTime(task, nt); task.time = nt; } catch (_) { /* silent */ }
  }

  async saveTime(task: TaskRow, time: string): Promise<void> {
    const lines = (await this.app.vault.read(task.file!)).split("\n"); const m = lines[task.line].match(/^(\s*[-*+]\s*\[[^\]]*\]\s*)(.*)$/); if (!m) throw Error("Could not parse task line");
    const rest = m[2].replace(/^\d{1,2}:\d{2}(\s*[\u2014\-\u2013]\s*\d{1,2}:\d{2})?\s*/, "");
    lines[task.line] = m[1] + (time ? time + " " : "") + rest; await this.app.vault.modify(task.file!, lines.join("\n"));
  }

  async updateDate(task: TaskRow, nd: string): Promise<void> {
    const lines = (await this.app.vault.read(task.file!)).split("\n"); const line = lines[task.line]; if (!line) return;
    if (nd) {
      const re = /[@\u23f3\ud83d\udcc5]\s*\d{4}-\d{2}-\d{2}/u;
      lines[task.line] = re.test(line) ? line.replace(re, "@" + nd) : line.replace(/^(\s*[-*+]\s*\[[^\]]*\]\s*)(.*)$/, (_, p, r) => p + r + " @" + nd);
    } else { lines[task.line] = line.replace(/\s*[@\u23f3\ud83d\udcc5]\s*\d{4}-\d{2}-\d{2}/u, ""); }
    await this.app.vault.modify(task.file!, lines.join("\n"));
  }

  async _refreshSiblings(): Promise<void> { if (!this.plugin) return; for (const r of this.plugin.renderers) { if (r === this) continue; await r.loadTasks(); r.renderTable(); } }

  async _renderSessionHistory(): Promise<void> {
    this.containerEl.empty();
    if (!this.plugin?.sessionStore) { this.containerEl.createEl("p", { text: "Session store not available.", cls: "flowtime-empty" }); return; }
    const buckets = this.plugin.settings.buckets || [];
    const filterBar = this.containerEl.createEl("div", { cls: "ft-sesh-filter-bar" });
    filterBar.createEl("label", { text: "Bucket: ", cls: "ft-sesh-filter-label" });
    const bucketFilter = filterBar.createEl("select", { cls: "ft-sesh-filter" }); bucketFilter.createEl("option", { text: "All", value: "" });
    for (const b of buckets) { bucketFilter.createEl("option", { text: b.name, value: b.id }); }
    filterBar.createEl("label", { text: "Type: ", cls: "ft-sesh-filter-label" });
    const typeFilter = filterBar.createEl("select", { cls: "ft-sesh-filter" });
    for (const [val, label] of [["", "All"] as [string, string], ["session", "Sessions"] as [string, string], ["completion", "Completions"] as [string, string]]) { typeFilter.createEl("option", { text: label, value: val }); }
    filterBar.createEl("label", { text: "Show: ", cls: "ft-sesh-filter-label" });
    const limitFilter = filterBar.createEl("select", { cls: "ft-sesh-filter" });
    for (const n of [20, 50, 100, 500]) { const opt = limitFilter.createEl("option", { text: String(n), value: String(n) }); if (n === 50) opt.selected = true; }
    const summaryEl = this.containerEl.createEl("div", { cls: "ft-sesh-summary" });
    const todayStr = new Date().toISOString().split("T")[0];
    const todayTotals = await this.plugin.sessionStore.getDailyTotals({ dateFrom: todayStr, dateTo: todayStr });
    if (todayTotals.length > 0) {
      const section = summaryEl.createEl("div", { cls: "ft-sesh-analytics-section" }); section.createEl("div", { text: "\ud83d\udcca Today", cls: "ft-sesh-analytics-title" });
      for (const t of todayTotals) {
        const row = section.createEl("div", { cls: "ft-sesh-analytics-row" });
        const bDef = buckets.find((b) => b.id === (t as Record<string, string>).bucket);
        if (bDef) { const swatch = row.createEl("span", { cls: "ft-bucket-swatch" }); swatch.setCssProps({ "background-color": bDef.color }); row.createEl("span", { text: bDef.name, cls: "ft-sesh-analytics-name" }); }
        else { row.createEl("span", { text: (t as Record<string, string>).bucket || "unassigned", cls: "ft-sesh-analytics-name" }); }
        row.createEl("span", { text: `${Math.round((t as Record<string, number>).total_minutes)}m (${((t as Record<string, number>).total_minutes / 60).toFixed(1)}h)`, cls: "ft-sesh-analytics-value" });
      }
    }
    const weeklyTotals = await this.plugin.sessionStore.getWeeklyTotals();
    if (weeklyTotals.length > 0) {
      const section = summaryEl.createEl("div", { cls: "ft-sesh-analytics-section" }); section.createEl("div", { text: "\ud83d\udcc5 This Week", cls: "ft-sesh-analytics-title" });
      const currentWeekStart = (weeklyTotals[0] as Record<string, string>)?.weekStart;
      if (currentWeekStart) {
        const thisWeek = weeklyTotals.filter((w) => (w as Record<string, string>).weekStart === currentWeekStart);
        for (const w of thisWeek) {
          const row = section.createEl("div", { cls: "ft-sesh-analytics-row" });
          const bDef = buckets.find((b) => b.id === (w as Record<string, string>).bucket);
          if (bDef) {
            const swatch = row.createEl("span", { cls: "ft-bucket-swatch" }); swatch.setCssProps({ "background-color": bDef.color }); row.createEl("span", { text: bDef.name, cls: "ft-sesh-analytics-name" });
            const usedHours = (w as Record<string, number>).total_minutes / 60;
            row.createEl("span", { text: bDef.weeklyLimit > 0 ? `${usedHours.toFixed(1)}h / ${bDef.weeklyLimit}h` : `${usedHours.toFixed(1)}h`, cls: "ft-sesh-analytics-value" });
          } else { row.createEl("span", { text: (w as Record<string, string>).bucket || "unassigned", cls: "ft-sesh-analytics-name" }); row.createEl("span", { text: `${((w as Record<string, number>).total_minutes / 60).toFixed(1)}h`, cls: "ft-sesh-analytics-value" }); }
        }
      }
    }


    const completions = await this.plugin.sessionStore.query({ types: ["completion"], limit: 5 });
    if (completions.length > 0) {
      const section = summaryEl.createEl("div", { cls: "ft-sesh-analytics-section" }); section.createEl("div", { text: "\u2705 Recent Completions", cls: "ft-sesh-analytics-title" });
      for (const c of completions) { const row = section.createEl("div", { cls: "ft-sesh-analytics-row" }); row.createEl("span", { text: `\u2611 ${(c as Record<string, string>).task_text || "\u2014"}`, cls: "ft-sesh-analytics-name" }); row.createEl("span", { text: (c as Record<string, string>).date, cls: "ft-sesh-analytics-value ft-sesh-faint" }); }
    }
    summaryEl.createEl("hr", { cls: "ft-sesh-divider" });
    const resultsEl = this.containerEl.createEl("div", { cls: "ft-sesh-results" });
    const loadResults = async (): Promise<void> => {
      resultsEl.empty();
      const opts: Record<string, unknown> = { limit: parseInt(limitFilter.value, 10) };
      if (bucketFilter.value) opts.bucket = bucketFilter.value; if (typeFilter.value) opts.types = [typeFilter.value];
      const records = await this.plugin!.sessionStore!.query(opts);
      if (records.length === 0) { resultsEl.createEl("p", { text: "No sessions yet. Start a timer to see records here.", cls: "ft-sesh-empty" }); return; }
      const table = resultsEl.createEl("table", { cls: "ft-sesh-table ft-table" });
      const thead = table.createEl("thead").createEl("tr"); thead.createEl("th", { text: "Type" }); thead.createEl("th", { text: "Date" }); thead.createEl("th", { text: "Time" }); thead.createEl("th", { text: "Duration" }); thead.createEl("th", { text: "Bucket" }); thead.createEl("th", { text: "Task / Note" });
      const tbody = table.createEl("tbody");
      for (const rec of records) {
        const row = tbody.createEl("tr");
        const typeCell = row.createEl("td"); typeCell.createEl("span", { text: (rec as Record<string, string>).type === "session" ? "\u23f1" : "\u2611", cls: "ft-sesh-type-icon" });
        row.createEl("td", { text: (rec as Record<string, string>).date, cls: "ft-sesh-date" });
        const timeCell = row.createEl("td", { cls: "ft-sesh-time" });
        if ((rec as Record<string, string>).type === "session" && (rec as Record<string, string>).start_time && (rec as Record<string, string>).end_time) { const fmt = (iso: string) => iso.split("T")[1]?.slice(0, 5) || ""; timeCell.setText(`${fmt((rec as Record<string, string>).start_time)}\u2014${fmt((rec as Record<string, string>).end_time)}`); }
        else if ((rec as Record<string, string>).completed_at) { timeCell.setText((rec as Record<string, string>).completed_at.split("T")[1]?.slice(0, 5) || ""); }
        row.createEl("td", { text: (rec as Record<string, number>).duration_minutes ? `${(rec as Record<string, number>).duration_minutes}m` : "\u2014", cls: "ft-sesh-dur" });
        const bucketCell = row.createEl("td", { cls: "ft-sesh-bucket" });
        if ((rec as Record<string, string>).bucket) {
          const bDef = buckets.find((b) => b.id === (rec as Record<string, string>).bucket);
          if (bDef) { const badge = bucketCell.createEl("span", { text: bDef.name, cls: "ft-sesh-badge" }); badge.setCssProps({ "border-left-color": bDef.color }); }
          else { bucketCell.createEl("span", { text: (rec as Record<string, string>).bucket, cls: "ft-sesh-badge-unknown" }); }
        } else { bucketCell.createEl("span", { text: "\u2014", cls: "ft-sesh-faint" }); }
        row.createEl("td", { text: (rec as Record<string, string>).task_text || (rec as Record<string, string>).notes || "\u2014", cls: "ft-sesh-task" });
      }
    };
    bucketFilter.addEventListener("change", loadResults); typeFilter.addEventListener("change", loadResults); limitFilter.addEventListener("change", loadResults);
    await loadResults();
  }

  async toggleTaskComplete(task: TaskRow): Promise<void> {
    const wasCompleted = task.status === "x"; await toggleCheck(this.app.vault, task);
    if (!wasCompleted) {
      const content = await this.app.vault.read(task.file!); const newLine = content.split("\n")[task.line];
      await this._handleRecurrence(task, newLine);
      if (this.plugin?.sessionStore) { await this.plugin.sessionStore.writeCompletion({ date: task.taskDate || new Date().toISOString().split("T")[0], bucket: task.bucket || "", taskText: task.cleanText, completedAt: new Date().toISOString() }); }
    }
    const tbody = this.containerEl.querySelector("tbody"); if (tbody) this.buildRows(tbody as HTMLTableSectionElement);
    await this._refreshSiblings();
  }

  async _handleRecurrence(task: TaskRow, completedLine: string): Promise<void> {
    const rec = parseRecurrence(completedLine); if (!rec) return;
    const baseDate = task.taskDate ? new Date(task.taskDate + "T00:00:00") : new Date();
    const next = new Date(baseDate);
    const interval = (rec as unknown as { interval: number }).interval || 1;
    switch ((rec as unknown as { unit: string }).unit) {
      case "day": next.setDate(next.getDate() + interval); break;
      case "week": next.setDate(next.getDate() + interval * 7); break;
      case "month": next.setMonth(next.getMonth() + interval); break;
    }
    const nextDate = next.toISOString().split("T")[0];
    const newTaskLine = completedLine.replace(/\[x\]/i, "[ ]").replace(/[@\u23f3\ud83d\udcc5]\s*\d{4}-\d{2}-\d{2}/u, "@" + nextDate);
    const content = await this.app.vault.read(task.file!); const lines = content.split("\n");
    lines.splice(task.line + 1, 0, newTaskLine); await this.app.vault.modify(task.file!, lines.join("\n"));
  }
}

export { FlowtimeRenderer };
