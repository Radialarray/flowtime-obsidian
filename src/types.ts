// ═══════════════════════════════════════════════════════════════════
// Shared types for Flowtime plugin
// ═══════════════════════════════════════════════════════════════════

import type { TFile } from "obsidian";

// ── Task shapes ──

/** Output of parseTaskLine — raw parsed data from a markdown task line */
export interface ParsedTask {
  file?: TFile;
  line: number;
  rawLine: string;
  time: string;
  taskDate: string;
  durationMinutes: number;
  rawText: string;
  cleanText: string;
  status: string;
  priority: string | null;
  bucket: string | null;
  projectTag: string | null;
  isSoon: boolean;
  indent: number;
  sprint: string | null;
  sortIndex: number | null;
}

/** How a task is stored in the renderer's task list (extends ParsedTask with resolved fields) */
export interface TaskRow {
  file: TFile | null;
  line: number;
  rawLine: string;
  time: string;
  taskDate: string;
  rawText: string;
  cleanText: string;
  status: string;
  priority: string | null;
  bucket: string | null;
  durationMinutes: number;
  project: string | null;
  projectPath?: string | null;
  projectSource?: string | null;
  isSoon?: boolean;
  sprint?: string | null;
  indent?: number;
  sortIndex?: number | null;
  // Budget mode: synthetic tasks built from bucket definitions
  _bucketDef?: BucketDef;
}

// ── Settings ──

export interface BucketDef {
  id: string;
  name: string;
  color: string;
  weeklyLimit: number;
  sortOrder: number;
}

export interface SprintDef {
  id: string;
  name: string;
  start: string;
  end: string;
  goal: string;
  color: string;
}

export interface SavedView {
  // Placeholder for future view persistence feature
  [key: string]: unknown;
}

export interface FlowtimeSettings {
  // Project Detection
  projectFrontmatterKey: string;
  projectFrontmatterValue: string;
  projectNameKey: string;
  fallbackToFolderName: boolean;
  tagPrefix: string;
  projectsRoot: string;

  // Quick Entry
  quickEntryTargetFile: string;

  // Buckets
  buckets: BucketDef[];
  bucketPrefix: string;
  dailyCap: number;

  // Display
  defaultView: "table" | "list";
  dateFormat: string;
  statusBarTimer: boolean;
  contentWidthPreset: "s" | "m" | "l" | "xl";

  // Notifications
  timerSound: boolean;
  noticeDuration: number;
  quietMode: boolean;
  tabHistoryEnabled: boolean;

  // Templates
  dailyTemplate: string;
  weeklyTemplate: string;
  projectTemplate: string;

  // Inbox
  inboxPath: string;
  inboxDefaultDuration: number;
  inboxDefaultBucket: string;
  inboxDefaultProject: string;

  // Today Note
  todayNotePath: string;

  // Saved Views
  savedViews: Record<string, SavedView>;

  // Sprints
  sprints: SprintDef[];

  // Pomodoro
  pomodoroEnabled: boolean;
  pomodoroSessionMinutes: number;
  pomodoroBreakMinutes: number;
  pomodoroLongBreakMinutes: number;
  pomodoroSessionsBeforeLongBreak: number;

  // Routines
  routinesFolder: string;
  vacationMode: boolean;
  autoGenerateOnStartup: boolean;
  autoGenerateOnOpenDaily: boolean;
  workdays: number[];
  weekStartDay: number;
  hideCompletedRoutines: boolean;

  // Migration
  contentWidth?: number;
  routinesFolderMigrated?: boolean;
  _taskCache?: unknown;
}

// ── Recurrence ──

export type RecurrenceType =
  | "daily"
  | "workday"
  | "weekly"
  | "monthly"
  | "interval"
  | "custom-days"
  | "nth-weekday"
  | "month-date";

export interface Recurrence {
  type: RecurrenceType;
  every?: number;
  unit?: string;
  days?: number[];
  nth?: number;
  weekday?: number;
  monthDay?: number;
}

// ── Cache ──

export interface CacheEntry {
  parsedTasks: Omit<ParsedTask, "file">[];
  mtime: number;
  size: number;
}

export interface DateIndexEntry {
  filePath: string;
  task: Omit<ParsedTask, "file">;
}

// ── Filter Engine ──

export type FilterOp = "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte" | "exists" | "not_exists";

export interface FilterLeaf {
  field: string;
  op: FilterOp;
  value?: string | number;
}

export interface FilterCompound {
  op: "and" | "or" | "not";
  filters?: FilterConfig[];
  filter?: FilterConfig;
}

export type FilterConfig = FilterLeaf | FilterCompound;

// ── Renderer: Column definitions ──

export interface ColumnDef {
  id: string;
  label: string;
  sortField: string | null;
  width: string;
  compactOnly: boolean;
  compactSkip: boolean;
  defaultHide: boolean;
}

// ── Renderer: Sort & Group ──

export interface SortConfig {
  field: string;
  direction: "asc" | "desc";
}

export interface GroupConfig {
  primary: string | null;
  secondary: string | null;
}

// ── Renderer: Tree structure ──

export interface TreeNode {
  task: TaskRow;
  children: TreeNode[];
  depth: number;
}

export interface DisplayItem {
  task: TaskRow;
  depth: number;
  hasChildren: boolean;
  childrenCount: number;
  childrenTasks: TaskRow[];
  collapsed: boolean;
  taskId: string;
}

// ── Timer ──

export interface TimerState {
  remaining: number;
  total: number;
  interval: ReturnType<typeof setInterval> | null;
  running: boolean;
}

/** Reference to a specific task in the vault */
export interface TimerTaskRef {
  filePath: string;
  line: number;
  taskText: string;
  bucket?: string;
}

/** Pomodoro configuration */
export interface PomodoroConfig {
  enabled: boolean;
  sessionMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLongBreak: number;
}

/** Pomodoro runtime state (tracked per active timer) */
export interface PomodoroRuntime {
  totalSessions: number;
  completedSessions: number;
  sessionMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLongBreak: number;
  onBreak: boolean;
  breakRemaining: number;
}

/** Full global timer state — the single source of truth */
export interface GlobalTimerState {
  taskRef: TimerTaskRef | null;
  bucket: string | null;
  remaining: number;
  total: number;
  isRunning: boolean;
  startedAt: string | null;
  pomodoro: PomodoroRuntime | null;
}

// ── Session ──

export interface SessionEntry {
  startTime: string;
  endTime: string;
  durationMinutes: number;
  bucket: string;
  taskText: string;
  notes: string;
  sprint?: string;
}

// ── Projects ──

export interface ProjectResult {
  name: string | null;
  path: string | null;
  source: "frontmatter" | "folder" | null;
}

export interface FrontmatterResult {
  found: boolean;
  name: string | null;
}

// ── Renderer view modes ──

export type ViewMode = "table" | "list";

export type RenderMode =
  | "today"
  | "overdue"
  | "dueweek"
  | "weekly"
  | "soon"
  | "project"
  | "budget"
  | "sessions"
  | "sprints";
