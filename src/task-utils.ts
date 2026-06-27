/**
 * task-utils — Shared utility functions for Flowtime renderers.
 * All functions are stateless where possible; vault I/O functions accept
 * the Obsidian Vault instance as a parameter.
 */

import type { App, TFile, Vault } from "obsidian";
import { MarkdownView } from "obsidian";
import type { ParsedTask, TaskRow } from "./types";
import { parseTaskLine } from "./task-parser";

/* ─── Document helper ─── */

/** Get active document for popout window compatibility */
export function activeDoc(app: App): Document {
  return app.workspace.getActiveViewOfType(MarkdownView)?.containerEl?.ownerDocument ?? activeDocument;
}

/* ─── Constants ─── */

export const DUR_OPTS = [10, 15, 20, 25, 30, 45, 60, 90, 120, 150, 180, 210, 240];
export const START_H = 7;
export const START_END = 20;

/* ─── Time helpers ─── */

/** Generate time slot options (HH:MM) in 30-min increments from h1 to h2 */
export function timeOpts(h1: number, h2: number): string[] {
  const r: string[] = [];
  for (let h = h1; h <= h2; h++)
    for (let m = 0; m < 60; m += 30)
      r.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  return r;
}

/**
 * Parse a stored time block like "09:00—10:30" into { start, dur }.
 * Durations are snapped to the nearest DUR_OPTS value.
 */
export function parseStored(t: string): { start: string; dur: number } {
  if (!t) return { start: "", dur: 0 };
  const m = t.match(/^(\d{1,2}:\d{2})\s*[—\-–]\s*(\d{1,2}:\d{2})$/);
  if (!m) return { start: "", dur: 0 };
  const d =
    m[2].split(":").reduce((a, n) => +n + 60 * a, 0) -
    m[1].split(":").reduce((a, n) => +n + 60 * a, 0);
  return {
    start: m[1],
    dur: d > 0
      ? DUR_OPTS.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a))
      : 0,
  };
}

/** Calculate end time string (HH:MM) from start + duration in minutes */
export function calcEnd(s: string, d: number): string {
  if (!s || !d) return "";
  const t = s.split(":").reduce((a, n) => +n + 60 * a, 0) + d;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.round(t % 60)).padStart(2, "0")}`;
}

/**
 * Parse a duration string like "30m", "1.5h", "1h 30m" to minutes.
 * Supports plain integer strings (treated as minutes).
 */
export function parseDurStr(str: string): number {
  if (!str) return 0;
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  let total = 0;
  const hMatch = str.match(/([\d.]+)\s*h/);
  if (hMatch) total += parseFloat(hMatch[1]) * 60;
  const mMatch = str.match(/(\d+)\s*m/);
  if (mMatch) total += parseInt(mMatch[1], 10);
  return Math.round(total);
}

/**
 * Convert a time string (HH:MM) to a grid row number.
 * Row 1 = header, row 2 = START_H:00.
 */
export function timeToRow(timeStr: string, startH?: number): number {
  if (!timeStr) return -1;
  const h1 = startH != null ? startH : START_H;
  const parts = timeStr.split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) || 0;
  const totalMinutes = h * 60 + m;
  const startMinutes = h1 * 60;
  if (totalMinutes < startMinutes) return -1;
  const slotIndex = Math.round((totalMinutes - startMinutes) / 30);
  return 2 + slotIndex;
}

/**
 * Convert a grid row number back to a time string (HH:MM).
 */
export function rowToTime(rowNum: number, startH?: number, startEnd?: number): string {
  if (rowNum < 2) return "";
  const h1 = startH != null ? startH : START_H;
  const h2 = startEnd != null ? startEnd : START_END;
  const slotIndex = rowNum - 2;
  const totalMinutes = h1 * 60 + slotIndex * 30;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > h2) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/* ─── Date helpers ─── */

/** Get Monday (YYYY-MM-DD) of the week containing the given date */
export function getMonday(d: string): string {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().split("T")[0];
}

/** Get Friday (YYYY-MM-DD) given a Monday date string */
export function getFriday(mondayStr: string): string {
  const m = new Date(mondayStr + "T12:00:00");
  m.setDate(m.getDate() + 4);
  return m.toISOString().split("T")[0];
}

/** Get Sunday (YYYY-MM-DD) given any date string */
export function getSunday(dateStr: string): string {
  const monday = new Date(getMonday(dateStr));
  monday.setDate(monday.getDate() + 6);
  return monday.toISOString().split("T")[0];
}

/** ISO 8601 week number for a given date string */
export function getWeekNumber(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00");
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

/**
 * Format a YYYY-MM-DD date for human-readable display (with day prefix).
 * Returns e.g. "Mon 24 (Today)", "Tue 25 (Tomorrow)", "24.6."
 */
export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const label = days[d.getDay()] + " " + d.getDate();
  if (diff === 0) return label + " (Today)";
  if (diff === 1) return label + " (Tomorrow)";
  if (diff === -1) return label + " (Yesterday)";
  if (diff > -7 && diff < 7) return label;
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

/**
 * Format a YYYY-MM-DD date for short display (no day prefix for Today).
 * Returns e.g. "Today", "Tomorrow", "Mon 24", "24.6."
 */
export function fmtDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > -7 && diff < 7) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[d.getDay()] + " " + d.getDate();
  }
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

/* ─── Priority ─── */

/** Map priority emoji to sort weight (higher = first) */
export function priorityWeight(p: string | null | undefined): number {
  const w: Record<string, number> = { "🟥": 5, "🟨": 3, "🟩": 1 };
  return p ? (w[p] || 0) : 0;
}

/* ─── File scope ─── */

/**
 * Check if a file path is within the plugin's scan scope.
 */
export function isFileInScope(filePath: string, projectsRoot: string, configDir: string): boolean {
  if (filePath.startsWith(configDir) || filePath.startsWith(".git")) return false;
  if (!projectsRoot) return true;
  const normalizedRoot = projectsRoot.endsWith("/") ? projectsRoot : projectsRoot + "/";
  return filePath.startsWith(normalizedRoot);
}

/* ─── Vault I/O ─── */

/** Cache interface that has get/set methods */
export interface TaskCacheLike {
  get(path: string): { parsedTasks: Omit<ParsedTask, "file">[] } | null;
  set(path: string, tasks: Omit<ParsedTask, "file">[]): void;
}

/**
 * Get parsed tasks for a file, using cache if available.
 */
export async function getFileTasks(
  file: TFile,
  app: App,
  cache?: TaskCacheLike | null,
): Promise<ParsedTask[]> {
  const cached = cache?.get(file.path);
  if (cached) {
    return cached.parsedTasks.map((t) => ({ ...t, file }));
  }
  const content = await app.vault.read(file);
  const lines = content.split("\n");
  const result: ParsedTask[] = [];
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseTaskLine(lines[i], file, i);
    if (parsed) result.push(parsed);
  }
  if (cache) {
    const cacheable = result.map((t) => {
      const { file: _f, ...rest } = t;
      return rest;
    });
    cache.set(file.path, cacheable);
  }
  return result;
}

/**
 * Save a time block with duration directive to a task's source line.
 */
export async function saveTimeWithDuration(
  vault: Vault,
  task: TaskRow,
  startStr: string,
  durMinutes: number,
): Promise<void> {
  if (!task.file) return;
  const endStr = startStr && durMinutes > 0 ? calcEnd(startStr, durMinutes) : "";
  let timeBlock = startStr;
  if (endStr) timeBlock += "—" + endStr;

  const content = await vault.read(task.file);
  const lines = content.split("\n");
  let line = lines[task.line];
  if (!line) return;

  const hasTime = line.match(/^\s*[-*+]\s*\[[^\]]*\]\s*\d{1,2}:\d{2}/);
  if (hasTime && timeBlock) {
    line = line.replace(
      /^(\s*[-*+]\s*\[[^\]]*\]\s*)\d{1,2}:\d{2}(?:\s*[—\-–]\s*\d{1,2}:\d{2})?/,
      "$1" + timeBlock,
    );
  } else if (timeBlock) {
    line = line.replace(/^(\s*[-*+]\s*\[[^\]]*\]\s*)/, "$1" + timeBlock + " ");
  } else {
    line = line.replace(
      /^(\s*[-*+]\s*\[[^\]]*\]\s*)\d{1,2}:\d{2}(?:\s*[—\-–]\s*\d{1,2}:\d{2})?\s*/,
      "$1",
    );
  }

  if (durMinutes > 0) {
    const durStr = durMinutes < 60 ? durMinutes + "m" : durMinutes / 60 + "h";
    if (line.match(/@\d+(?:\.\d+)?[hm]/)) {
      line = line.replace(/@\d+(?:\.\d+)?[hm]/, "@" + durStr);
    } else {
      line += " @" + durStr;
    }
  } else {
    line = line.replace(/@\d+(?:\.\d+)?[hm]\s*/, "");
  }

  if (line !== lines[task.line]) {
    lines[task.line] = line;
    await vault.modify(task.file, lines.join("\n"));
  }
}

/**
 * Toggle a task's checkbox status in the vault.
 */
export async function toggleCheck(vault: Vault, task: TaskRow): Promise<boolean> {
  if (!task.file) return task.status === "x";
  const content = await vault.read(task.file);
  const lines = content.split("\n");
  const line = lines[task.line];
  if (!line) return task.status === "x";

  const isChecked = line.match(/\[x\]/i);
  const newLine = isChecked
    ? line.replace(/\[x\]/i, "[ ]")
    : line.replace(/\[ \]/, "[x]");

  lines[task.line] = newLine;
  await vault.modify(task.file, lines.join("\n"));
  task.status = isChecked ? " " : "x";
  return !isChecked;
}

/**
 * Update a task's date directive (@YYYY-MM-DD) in the vault.
 */
export async function updateDate(vault: Vault, task: TaskRow, newDate: string): Promise<void> {
  if (!task.file) return;
  const content = await vault.read(task.file);
  const lines = content.split("\n");
  const line = lines[task.line];
  if (!line) return;
  if (newDate) {
    const re = /[@⏳📅]\s*\d{4}-\d{2}-\d{2}/u;
    lines[task.line] = re.test(line)
      ? line.replace(re, "@" + newDate)
      : line.replace(
          /^(\s*[-*+]\s*\[[^\]]*\]\s*)(.*)$/,
          (_, p, r) => p + r + " @" + newDate,
        );
  } else {
    lines[task.line] = line.replace(/\s*[@⏳📅]\s*\d{4}-\d{2}-\d{2}/u, "");
  }
  await vault.modify(task.file, lines.join("\n"));
}
