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

export function resolveHeadingMode(heading: string): string | null {
  const key = heading.toLowerCase().trim();
  return HEADING_MODES[key] || null;
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

  // Project
  if (task.project) parts.push("@p:" + task.project);

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

  // For each heading, determine section bounds and aggregate tasks
  type SectionPlan = { start: number; end: number; headingLine: string; tasks: TaskRow[] };
  const plans: SectionPlan[] = [];
  for (let s = 0; s < found.length; s++) {
    const h = found[s];
    const sectionEnd = s + 1 < found.length ? found[s + 1].index : lines.length;
    const tasks = await (plugin.aggregateTasksForMode(h.mode, sourcePath) as Promise<TaskRow[]>);
    plans.push({
      start: h.index,
      end: sectionEnd,
      headingLine: lines[h.index],
      tasks,
    });
  }

  // Build new file content (process top-down, adjusting for size changes)
  const result: string[] = [];
  let cursor = 0;
  for (const plan of plans) {
    // Copy lines before this section
    result.push(...lines.slice(cursor, plan.start));
    // Heading line
    result.push(plan.headingLine);
    // Blank line after heading
    result.push("");
    // Task lines
    if (plan.tasks.length > 0) {
      for (const task of plan.tasks) {
        result.push(formatTaskLine(task));
      }
      result.push("");
    } else {
      result.push("*No tasks*");
      result.push("");
    }
    cursor = plan.end;
  }
  // Copy remaining lines after last section
  result.push(...lines.slice(cursor));

  const newContent = result.join("\n");
  if (newContent !== content) {
    await app.vault.modify(file, newContent);
  }
}
