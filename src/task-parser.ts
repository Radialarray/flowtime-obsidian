/**
 * Task parsing module.
 * Extracts structured task data from Obsidian task lines.
 */

import type { TFile } from "obsidian";
import type { ParsedTask, Recurrence, TreeNode, DisplayItem } from "./types";
import { parseDate } from "./date-parser";

/**
 * Parse a single task line and return a structured task object.
 * Returns null if the line is not a task line.
 */
export function parseTaskLine(line: string, file: TFile, lineIndex: number): ParsedTask | null {
  const m = line.match(/^(\s*[-*+]\s*\[([^\]]*)\]\s*)(.*)$/);
  if (!m) return null;

  const status = m[2].trim();

  // Extract indent level (normalize tabs to 2 spaces)
  const indentSpaces = m[1].match(/^\s*/)![0].replace(/\t/g, "  ").length;
  const indent = indentSpaces;

  // Extract date: /[@⏳📅]\s*(\d{4}-\d{2}-\d{2})/
  const dateMatch = m[3].match(/[@⏳📅]\s*(\d{4}-\d{2}-\d{2})/);
  let taskDate = (dateMatch || [])[1] || "";

  // Fallback — try natural language date parsing (@today, @tomorrow, etc.)
  if (!taskDate) {
    const nlMatch = m[3].match(/@(\S+)/g);
    if (nlMatch) {
      for (const token of nlMatch) {
        const resolved = parseDate(token);
        if (resolved) {
          taskDate = resolved;
          break;
        }
      }
    }
  }

  // Extract time block
  let time = "";
  let rest = m[3];
  const tm = rest.match(/^(\d{1,2}:\d{2}(?:\s*[—\-–]\s*\d{1,2}:\d{2})?)\s*/);
  if (tm) {
    time = tm[1];
    rest = rest.slice(tm[0].length);
  }

  // Extract priority — color dots or @high/@med/@low aliases
  let priority: string | null = null;
  const prioMatch = rest.match(/[🟥🟨🟩]/);
  if (prioMatch) priority = prioMatch[0];
  if (!priority) {
    if (rest.match(/@high\b/)) priority = "🟥";
    else if (rest.match(/@med\b/)) priority = "🟨";
    else if (rest.match(/@low\b/)) priority = "🟩";
  }

  // @soon tag
  const isSoon = !!rest.match(/@soon\b/);

  // Sort index: @i:<number>
  let sortIndex: number | null = null;
  const idxMatch = rest.match(/@i:([\d.]+)/);
  if (idxMatch) sortIndex = parseFloat(idxMatch[1]);

  // Sprint: @sprint:<id>
  let sprint: string | null = null;
  const sprintMatch = rest.match(/@sprint:([^\s]+)/);
  if (sprintMatch) sprint = sprintMatch[1];

  // Bucket: @bucket:<name> or @b:<name>
  let bucket: string | null = null;
  const bucketMatch = rest.match(/@(?:bucket|b):([^\s]+)/);
  if (bucketMatch) bucket = bucketMatch[1];

  // Project tag: @p:<name>
  let projectTag: string | null = null;
  const pMatch = rest.match(/@p:([^\s]+)/);
  if (pMatch) projectTag = pMatch[1];

  // Duration: @<number>h or @<number>m
  let durationMinutes = 0;
  const durMatch = rest.match(/@(\d+(?:\.\d+)?)([hm])/);
  if (durMatch) {
    const val = parseFloat(durMatch[1]);
    durationMinutes = durMatch[2] === "h" ? Math.round(val * 60) : Math.round(val);
  }

  // Fallback: compute duration from time block (e.g. 09:00—11:30)
  if (!durationMinutes && time) {
    const tbMatch = time.match(/^(\d{1,2}:\d{2})\s*[—\-–]\s*(\d{1,2}:\d{2})$/);
    if (tbMatch) {
      const start = tbMatch[1].split(":").reduce((a, n) => +n + 60 * a, 0);
      const end = tbMatch[2].split(":").reduce((a, n) => +n + 60 * a, 0);
      durationMinutes = Math.max(0, end - start);
    }
  }

  return {
    file,
    line: lineIndex,
    rawLine: line,
    time,
    taskDate,
    durationMinutes,
    rawText: rest.trim(),
    cleanText: cleanTaskText(rest),
    status,
    priority,
    bucket,
    projectTag,
    isSoon,
    indent,
    sprint,
    sortIndex,
  };
}

/**
 * Clean task text of all directives (dates, priority emoji, recurrence, tags).
 */
export function cleanTaskText(text: string): string {
  return text
    .replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/gu, "")
    .replace(
      /@(?:today|tod|tomorrow|tom|yesterday|yes|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi,
      "",
    )
    .replace(
      /@next\s+(?:week|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi,
      "",
    )
    .replace(/@in\s+\d+\s*[dwm]\b/gi, "")
    .replace(/@\d+(?:\.\d+)?[hm]/g, "")
    .replace(/@(?:bucket|b):[^\s]+/g, "")
    .replace(/@p:[^\s]+/g, "")
    .replace(/@(?:high|med|low|soon)\b/gi, "")
    .replace(/@\d{1,2}:\d{2}(?:[—\-–]\d{1,2}:\d{2})?/g, "")
    .replace(/@sprint:[^\s]+/g, "")
    .replace(/@i:[\d.]+/g, "")
    .replace(/[🟥🟨🟩]/g, "")
    .replace(/🔁 every .+$/gm, "")
    .replace(/#\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract recurrence info from task line text.
 * Returns a Recurrence object or null.
 */
export function parseRecurrence(text: string): Recurrence | null {
  const m = text.match(/🔁\s*every\s+(.+)$/);
  if (!m) return null;

  const expr = m[1].trim().toLowerCase();

  // Simple patterns
  if (expr === "day" || expr === "days" || expr === "1 day") return { type: "daily" };
  if (expr === "workday" || expr === "workdays") return { type: "workday" };
  if (expr === "week" || expr === "weeks" || expr === "1 week") return { type: "weekly" };
  if (expr === "month" || expr === "months" || expr === "1 month") return { type: "monthly" };

  // Interval gap: "every 3 days", "every 2 weeks", "every 3 months"
  const intervalMatch = expr.match(/^(\d+)\s*(day|days|week|weeks|month|months)$/);
  if (intervalMatch) {
    const n = parseInt(intervalMatch[1], 10);
    const unit = intervalMatch[2].replace(/s$/, "");
    if (n > 1) return { type: "interval", every: n, unit };
  }

  const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  // Check for nth-weekday pattern
  const nthMatch = expr.match(/^(1st|2nd|3rd|4th|last)\s+(sun|mon|tue|wed|thu|fri|sat)$/i);
  if (nthMatch) {
    const nthMap: Record<string, number> = { "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, last: -1 };
    return {
      type: "nth-weekday",
      nth: nthMap[nthMatch[1].toLowerCase()],
      weekday: dayNames.indexOf(nthMatch[2].toLowerCase()),
    };
  }

  // Month date: "every month on 15th"
  const monthDateMatch = expr.match(/^month\s+on\s+(\d{1,2})(?:st|nd|rd|th)?$/);
  if (monthDateMatch) {
    return { type: "month-date", monthDay: parseInt(monthDateMatch[1], 10) };
  }

  // Plain day names
  const dayNameMatch = expr.match(/\b(sun|mon|tue|wed|thu|fri|sat)\b/gi);
  if (dayNameMatch) {
    const days = [...new Set(dayNameMatch.map((d) => dayNames.indexOf(d.toLowerCase())))];
    return { type: "custom-days", days };
  }

  return null;
}

interface RecurrenceOptions {
  workdays?: number[];
  lastGenerated?: string;
}

/**
 * Evaluate whether a recurrence is due on the given date.
 */
export function isRecurrenceDue(
  recurrence: Recurrence | null,
  dateStr: string,
  options: RecurrenceOptions = {},
): boolean {
  if (!recurrence || !dateStr) return false;

  const date = new Date(dateStr + "T12:00:00");
  const dayOfWeek = date.getDay();
  const dayOfMonth = date.getDate();
  const month = date.getMonth();
  const year = date.getFullYear();

  switch (recurrence.type) {
    case "daily":
      return true;

    case "workday": {
      const workdays = options.workdays || [1, 2, 3, 4, 5];
      return workdays.includes(dayOfWeek);
    }

    case "weekly":
      return dayOfWeek === 1;

    case "monthly":
      return dayOfMonth === 1;

    case "custom-days":
      return (recurrence.days || []).includes(dayOfWeek);

    case "nth-weekday": {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const weekday = recurrence.weekday!;
      if (recurrence.nth === -1) {
        for (let d = daysInMonth; d >= 1; d--) {
          const dt = new Date(year, month, d);
          if (dt.getDay() === weekday) return dayOfMonth === d;
        }
        return false;
      }
      let count = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(year, month, d);
        if (dt.getDay() === weekday) {
          count++;
          if (d === dayOfMonth) return count === recurrence.nth;
        }
      }
      return false;
    }

    case "month-date":
      return dayOfMonth === recurrence.monthDay!;

    case "interval": {
      if (!options.lastGenerated) return true;
      const lastDate = new Date(options.lastGenerated + "T12:00:00");
      const diffMs = date.getTime() - lastDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      const unit = recurrence.unit || "day";
      const every = recurrence.every || 1;
      switch (unit) {
        case "day":   return diffDays >= every;
        case "week":  return diffDays >= every * 7;
        case "month": {
          const monthDiff = (year - lastDate.getFullYear()) * 12 + (month - lastDate.getMonth());
          return monthDiff >= every;
        }
        default: return true;
      }
    }

    default:
      return false;
  }
}

/**
 * Format duration in minutes for display.
 */
export function formatDuration(minutes: number): string {
  return !minutes
    ? "--"
    : minutes < 60
      ? minutes + "m"
      : ((minutes / 60) % 1 === 0 ? minutes / 60 : (minutes / 60).toFixed(1)) + "h";
}

/**
 * Format seconds countdown for timer display.
 */
export function formatTimer(seconds: number): string {
  if (seconds <= 0) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Build a parent-child tree from a flat list of parsed tasks.
 * Hierarchy is determined by indent level (2 spaces = 1 level).
 */
export function buildTaskTree(tasks: Pick<ParsedTask, "indent">[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [{ task: {} as TreeNode["task"], children: roots, depth: -1 }];

  for (const task of tasks) {
    const depth = Math.floor((task.indent ?? 0) / 2);
    const node: TreeNode = { task: task as TreeNode["task"], children: [], depth };

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }

    stack.push(node);
  }

  return roots;
}

/**
 * Flatten a task tree into a display list.
 * Collapsed parents omit their children.
 */
export function flattenTree(roots: TreeNode[], collapsedIds: Set<string> = new Set()): DisplayItem[] {
  const items: DisplayItem[] = [];

  function walk(node: TreeNode, collapseParent: boolean): void {
    const id = taskId(node.task);
    const isCollapsed = collapsedIds.has(id) || collapseParent;
    items.push({
      task: node.task,
      depth: node.depth,
      hasChildren: node.children.length > 0,
      childrenCount: node.children.length,
      childrenTasks: node.children.map((c) => c.task),
      collapsed: isCollapsed,
      taskId: id,
    });
    if (!isCollapsed) {
      for (const child of node.children) {
        walk(child, false);
      }
    }
  }

  for (const root of roots) {
    walk(root, false);
  }

  return items;
}

/**
 * Unique string ID for a task (file:line).
 */
export function taskId(task: { file?: { path?: string } | null; line: number }): string {
  return (task.file?.path || "") + ":" + task.line;
}
