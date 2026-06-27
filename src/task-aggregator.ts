/**
 * TaskAggregator — collects vault tasks by heading-defined mode,
 * formats them as markdown lines, and injects them under matching
 * headings in a target file.
 *
 * Used by the mobile markdown view where ## Today / ## Overdue / etc.
 * headings act as view selectors.
 */

import type { App, TFile } from "obsidian";
import type { TaskRow } from "./types";

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

/** Empty state messages — match FlowtimeRenderer's msgs */
const EMPTY_MSGS: Record<string, string> = {
  today: "\u{1F4C5} No tasks scheduled for today.",
  overdue: "\u{1F389} No overdue tasks!",
  dueweek: "\u{1F389} No tasks due this week!",
  weekly: "\u{1F389} No tasks this week!",
  soon: "\u{1F4C5} No tasks tagged with @soon.",
};

export function resolveHeadingMode(heading: string): string | null {
  const key = heading.toLowerCase().trim();
  return HEADING_MODES[key] || null;
}

/* ─── Markdown formatting ─── */

export function formatTaskLine(task: TaskRow, checked: boolean = false): string {
  const parts: string[] = [];

  // Checkbox
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

  // Project
  if (task.project) parts.push("@p:" + task.project);

  // Source link: hidden directive for parsing + visible link
  if (task.file) {
    const srcPath = task.file.path;
    const srcLine = task.line + 1; // 1-indexed for display
    const uri = "obsidian://open?file=" + encodeURIComponent(srcPath) + "&line=" + srcLine;
    parts.push("[📄 " + srcPath + ":" + srcLine + "](" + uri + ")");
  }

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
    const isTask = /^\s*[-*+]\s+\[[ xX-]\]/.test(line);
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
 * Diff-based: preserves checkbox state from existing lines,
 * adds new tasks from vault, removes tasks that disappeared.
 * Builds the entire file content in memory and writes once.
 */
export async function refreshAll(
  app: App,
  file: TFile,
  plugin: AggregatorPluginRef,
  sourcePath?: string | null,
): Promise<void> {
  const content = await app.vault.read(file);
  const lines = content.split("\n");
  const headingRegex = /^(#{1,6})\s+(.+)$/;
  const taskRegex = /^[-*+]\s+\[([ xX-])\]\s+(.*)$/;

  // Collect headings with position and mode
  const found: { index: number; level: number; text: string; mode: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRegex);
    if (!m) continue;
    const mode = resolveHeadingMode(m[2]);
    if (mode) {
      found.push({ index: i, level: m[1].length, text: m[2].trim(), mode });
    }
  }

  // Aggregate tasks: group headings by mode so each mode is queried only once
  const modeCache: Record<string, TaskRow[]> = {};
  for (const h of found) {
    if (!modeCache[h.mode]) {
      modeCache[h.mode] = await (plugin.aggregateTasksForMode(h.mode, sourcePath) as Promise<TaskRow[]>);
    }
  }

  // For each heading, diff existing lines with aggregated tasks
  type SectionPlan = {
    start: number;
    end: number;
    headingLine: string;
    mode: string;
    /** Final task lines to write (formatted, with preserved checkbox state) */
    outLines: string[];
  };
  const plans: SectionPlan[] = [];
  for (let s = 0; s < found.length; s++) {
    const h = found[s];
    const sectionEnd = s + 1 < found.length ? found[s + 1].index : lines.length;
    const freshTasks = modeCache[h.mode];

    // Parse existing checkbox state from current section
    const existingChecked = new Map<string, boolean>();
    for (let i = h.index + 1; i < sectionEnd; i++) {
      const tm = lines[i].match(taskRegex);
      if (tm) {
        // Use the text after checkbox as key (strip trailing directives for matching)
        const key = normalizeTaskKey(tm[2]);
        existingChecked.set(key, tm[1].toLowerCase() === "x");
      }
    }

    // Build output lines: preserve checked state for matching tasks
    const outLines: string[] = [];
    const usedKeys = new Set<string>();
    for (const task of freshTasks) {
      const key = normalizeTaskKey(task.cleanText || task.rawText || "");
      usedKeys.add(key);
      const wasChecked = existingChecked.get(key) || false;
      outLines.push(formatTaskLine(task, wasChecked));
    }
    // Keep non-task lines (blank lines, comments) from the original section
    for (let i = h.index + 1; i < sectionEnd; i++) {
      if (!taskRegex.test(lines[i]) && lines[i].trim() !== "") {
        outLines.push(lines[i]);
      }
    }

    plans.push({ start: h.index, end: sectionEnd, headingLine: lines[h.index], mode: h.mode, outLines });
  }

  // Build new file content
  const result: string[] = [];
  let cursor = 0;
  for (const plan of plans) {
    result.push(...lines.slice(cursor, plan.start));
    result.push(plan.headingLine);
    result.push("");
    if (plan.outLines.length > 0) {
      result.push(...plan.outLines);
      result.push("");
    } else {
      result.push(EMPTY_MSGS[plan.mode] || "*No tasks*");
      result.push("");
    }
    cursor = plan.end;
  }
  result.push(...lines.slice(cursor));

  const newContent = result.join("\n");
  if (newContent !== content) {
    await app.vault.modify(file, newContent);
  }
}

/** Normalize task text for matching: strip time prefix and bucket/project directives */
function normalizeTaskKey(text: string): string {
  return text
    .replace(/^\d{1,2}:\d{2}(\s*[\u2014\-\u2013]\s*\d{1,2}:\d{2})?\s*/, "") // time prefix
    .replace(/@[^\s]+/g, "") // directives
    .trim()
    .toLowerCase();
}
