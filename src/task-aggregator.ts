/**
 * TaskAggregator — collects vault tasks by heading-defined mode,
 * formats them as markdown lines, and injects them under matching
 * headings in a target file.
 *
 * Used by the mobile markdown view where ## Today / ## Overdue / etc.
 * headings act as view selectors.
 */

import type { App, TFile } from "obsidian";
import type { ParsedTask, TaskRow } from "./types";
import { getFileTasks, getMonday, getSunday } from "./task-utils";

/* ─── Plugin reference ─── */
// We use `any` here to avoid complex type-matching with the plugin class
type AggregatorPluginRef = any;

/* ─── Mode mapping ─── */

export const HEADING_MODES: Record<string, string> = {
  today: "today",
  overdue: "overdue",
  "carry over": "overdue",
  carryover: "overdue",
  soon: "soon",
  "up next": "soon",
  "due week": "dueweek",
  dueweek: "dueweek",
  "this week": "dueweek",
  weekly: "weekly",
  "this week plan": "weekly",
};

export function resolveHeadingMode(heading: string): string | null {
  const key = heading.toLowerCase().trim();
  return HEADING_MODES[key] || null;
}

/* ─── Aggregation ─── */

export async function collectTasks(
  mode: string,
  app: App,
  plugin: AggregatorPluginRef,
  sourcePath?: string | null,
): Promise<TaskRow[]> {
  const tasks: TaskRow[] = [];
  const today = refDate(sourcePath);
  const refDt = new Date(today + "T00:00:00");
  const eow = new Date(refDt);
  eow.setDate(eow.getDate() + ((7 - eow.getDay()) % 7));
  const eowStr = eow.toISOString().split("T")[0];
  const mon = getMonday(today);
  const sun = getSunday(today);

  // ── TaskIndex fast path for date-filtered modes ──
  const idx = plugin.taskIndex;
  if (idx?.initialized && ["today", "overdue", "dueweek", "weekly"].includes(mode)) {
    const query: { dateFrom?: string; dateTo?: string } = {};
    if (mode === "today") { query.dateFrom = today; query.dateTo = today; }
    else if (mode === "overdue") {
      query.dateTo = new Date(refDt.getTime() - 86400000).toISOString().split("T")[0];
    }
    else if (mode === "dueweek") { query.dateFrom = today; query.dateTo = eowStr; }
    else if (mode === "weekly") { query.dateFrom = mon; query.dateTo = sun; }

    const idxTasks = idx.getTasks({ ...query, includeCompleted: false });
    for (const parsed of idxTasks) {
      if (!parsed.file) continue;
      const project = plugin.projectEngine ? await plugin.projectEngine.resolve(parsed.file.path) : null;
      tasks.push(buildTaskRow(parsed, parsed.file, project));
    }
    return tasks;
  }

  // ── Full vault scan fallback ──
  for (const file of app.vault.getMarkdownFiles()) {
    const fileTasks = await getFileTasks(file, app, plugin.taskCache);
    for (const parsed of fileTasks) {
      if (parsed.status === "x" || parsed.status === "-" || parsed.status === "X") continue;
      if (mode === "today" && parsed.taskDate !== today) continue;
      if (mode === "overdue" && (!parsed.taskDate || parsed.taskDate >= today)) continue;
      if (mode === "dueweek" && (!parsed.taskDate || parsed.taskDate < today || parsed.taskDate > eowStr)) continue;
      if (mode === "weekly" && (!parsed.taskDate || parsed.taskDate < mon || parsed.taskDate > sun)) continue;
      if (mode === "soon" && !(parsed.isSoon || (parsed.taskDate && parsed.taskDate > today))) continue;

      const project = plugin.projectEngine ? await plugin.projectEngine.resolve(file.path) : null;
      tasks.push(buildTaskRow(parsed, file, project));
    }
  }

  // Default sort: by date then priority
  tasks.sort((a, b) => {
    const da = a.taskDate || "9999";
    const db = b.taskDate || "9999";
    if (da !== db) return da.localeCompare(db);
    const pa = priorityWeight(a.priority);
    const pb = priorityWeight(b.priority);
    return pa - pb;
  });

  return tasks;
}

function refDate(sourcePath?: string | null): string {
  if (sourcePath) {
    const dateMatch = sourcePath.match(/(\d{4}-\d{2}-\d{2})\.md$/);
    if (dateMatch) return dateMatch[1];
  }
  return new Date().toISOString().split("T")[0];
}

function priorityWeight(p: string | null | undefined): number {
  if (p === "high") return 0;
  if (p === "medium") return 1;
  if (p === "low") return 2;
  return 3;
}

function buildTaskRow(
  parsed: ParsedTask,
  file: TFile,
  project: { name: string; path?: string; source?: string } | null,
): TaskRow {
  return {
    file,
    line: parsed.line,
    rawLine: parsed.rawLine || "",
    time: parsed.time || "",
    taskDate: parsed.taskDate || "",
    rawText: parsed.rawText || "",
    cleanText: parsed.cleanText || "",
    status: parsed.status || " ",
    priority: parsed.priority || null,
    bucket: parsed.bucket || null,
    durationMinutes: parsed.durationMinutes || 0,
    project: project?.name || null,
    projectPath: project?.path || null,
    projectSource: null,
    sprint: parsed.sprint || null,
    isSoon: !!parsed.isSoon,
    indent: parsed.indent || 0,
    sortIndex: parsed.sortIndex || 0,
  };
}

/* ─── Markdown formatting ─── */

export function formatTaskLine(task: TaskRow): string {
  const parts: string[] = [];

  // Checkbox
  const checked = task.status === "x" || task.status === "X";
  parts.push(checked ? "- [x]" : "- [ ]");

  // Task text (clean — no time prefix, no directives)
  const text = task.cleanText || task.rawText || "";
  parts.push(text);

  // Time
  if (task.time) parts.push(task.time);

  // Duration
  if (task.durationMinutes > 0) {
    parts.push(
      "@" + (task.durationMinutes < 60
        ? task.durationMinutes + "m"
        : task.durationMinutes / 60 + "h"),
    );
  }

  // Bucket
  if (task.bucket) parts.push("@b:" + task.bucket);

  // Date (for non-today/overdue modes, include the date)
  if (task.taskDate) parts.push("@" + task.taskDate);

  return parts.join(" ");
}

/* ─── File injection ─── */

/**
 * Inject task lines under a matching heading in the target file.
 * Existing task lines under the heading are replaced. Non-task content
 * (blank lines, subheadings, non-task text) is left untouched.
 */
export async function injectSection(
  app: App,
  file: TFile,
  heading: string,
  tasks: TaskRow[],
): Promise<void> {
  const content = await app.vault.read(file);
  const lines = content.split("\n");

  // Find the heading line
  const headingRegex = /^(#{1,6})\s+(.+)$/;
  let headingIdx = -1;
  let headingLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRegex);
    if (m && m[2].trim().toLowerCase() === heading.toLowerCase().trim()) {
      headingIdx = i;
      headingLevel = m[1].length;
      break;
    }
  }

  if (headingIdx < 0) return; // Heading not found — skip

  // Find the end of this section (next heading of same or higher level)
  let sectionEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(headingRegex);
    if (m && m[1].length <= headingLevel) {
      sectionEnd = i;
      break;
    }
  }

  // Collect existing lines after heading: keep non-task content, skip task lines
  const keepLines: string[] = [];
  let inSection = false;
  for (let i = headingIdx + 1; i < sectionEnd; i++) {
    const line = lines[i];
    const isTask = /^\s*[-*+]\s+\[[ xX\-]\]/.test(line);
    if (isTask) {
      if (!inSection) inSection = true;
      continue; // Skip task lines — we replace all of them
    }
    keepLines.push(line);
  }

  // Build new section: heading + kept non-task lines + injected task lines
  const newSection: string[] = [];
  newSection.push(lines[headingIdx]); // Keep original heading line
  newSection.push(...keepLines);

  // Add injected task lines
  if (tasks.length > 0) {
    for (const task of tasks) {
      newSection.push(formatTaskLine(task));
    }
  } else {
    newSection.push(
      "*No tasks*",
    );
  }

  // Reconstruct file
  const before = lines.slice(0, headingIdx);
  const after = lines.slice(sectionEnd);
  const result = [...before, ...newSection, ...after].join("\n");

  await app.vault.modify(file, result);
}

/**
 * Refresh all recognized heading sections in the file.
 * Processes headings bottom-up so section injection doesn't shift
 * the indices of headings yet to be processed.
 */
export async function refreshAll(
  app: App,
  file: TFile,
  plugin: AggregatorPluginRef,
  sourcePath?: string | null,
): Promise<void> {
  const content = await app.vault.read(file);
  const headingRegex = /^(#{1,6})\s+(.+)$/;
  const allLines = content.split("\n");

  // Collect headings with their positions
  const headings: { index: number; text: string; mode: string }[] = [];
  for (let i = 0; i < allLines.length; i++) {
    const m = allLines[i].match(headingRegex);
    if (!m) continue;
    const mode = resolveHeadingMode(m[2]);
    if (mode) {
      headings.push({ index: i, text: m[2].trim(), mode });
    }
  }

  // Process bottom-up so section replacements don't shift later headings
  for (let h = headings.length - 1; h >= 0; h--) {
    const { text, mode } = headings[h];
    const tasks = await collectTasks(mode, app, plugin, sourcePath);
    await injectSection(app, file, text, tasks);
  }
}
