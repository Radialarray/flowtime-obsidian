/**
 * Parse natural language date strings to YYYY-MM-DD format.
 * Returns null if unable to parse.
 *
 * Supported inputs:
 *   today, tod, tomorrow, tom, yesterday, yes
 *   mon/monday, tue/tuesday, ... sun/sunday  → next occurrence (today=skip week)
 *   next mon, next monday, ...                → skip one occurrence
 *   next week                                 → +7 days
 *   in 3 days, in 3d, in 1 week, in 1w, in 2 weeks, in 2w
 *   in 1 month, in 1m
 *   2026-06-24, 2026/06/24                    → exact / slash
 *   24.06.2026                                → European
 *   06/24/2026                                → US
 *   Leading @ is stripped before parsing
 */

/** Format a Date object to YYYY-MM-DD string */
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Return new Date for the next occurrence of dayIndex (0=Sunday) */
function nextDay(from: Date, dayIndex: number): Date {
  const d = new Date(from);
  let diff = dayIndex - d.getDay();
  if (diff <= 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return d;
}

const EXACT_MAP: Record<string, number> = {
  today: 0,
  tod: 0,
  tomorrow: 1,
  tom: 1,
  yesterday: -1,
  yes: -1,
};

const DAY_NAMES = [
  "sunday", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday",
];
const DAY_ABBR = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function parseDate(input: string): string | null {
  if (!input) return null;

  let s = input.trim().toLowerCase();

  // Strip leading @ (from task format @today)
  if (s.startsWith("@")) s = s.slice(1).trim();
  if (!s) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ── Exact keywords ──
  if (s in EXACT_MAP) {
    const d = new Date(today);
    d.setDate(d.getDate() + EXACT_MAP[s]);
    return fmt(d);
  }

  // ── "next <day>" pattern (skip one occurrence) ──
  const nextDayMatch = s.match(/^next\s+(sun|mon|tue|wed|thu|fri|sat)(day)?$/);
  if (nextDayMatch) {
    const idx = DAY_ABBR.indexOf(nextDayMatch[1]);
    const d = nextDay(today, idx);
    d.setDate(d.getDate() + 7);
    return fmt(d);
  }

  // ── Bare day name ──
  for (let i = 0; i < DAY_NAMES.length; i++) {
    if (s === DAY_NAMES[i] || s === DAY_ABBR[i]) {
      return fmt(nextDay(today, i));
    }
  }

  // ── "next week" ──
  if (s === "next week") {
    const d = new Date(today);
    d.setDate(d.getDate() + 7);
    return fmt(d);
  }

  // ── "in X days", "in Xd", "in X week(s)", "in Xw", "in X month(s)", "in Xm" ──
  const inMatch = s.match(/^in\s+(\d+)\s*(d(?:ays?)?|w(?:eeks?)?|m(?:onths?)?)$/);
  if (inMatch) {
    const num = parseInt(inMatch[1], 10);
    const unit = inMatch[2][0];
    const d = new Date(today);
    if (unit === "d") d.setDate(d.getDate() + num);
    else if (unit === "w") d.setDate(d.getDate() + num * 7);
    else if (unit === "m") d.setDate(d.getDate() + num * 30);
    return fmt(d);
  }

  // ── Already formatted YYYY-MM-DD ──
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, _y, m, d] = isoMatch.map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return s;
    }
  }

  // ── YYYY/MM/DD ──
  const slashMatch = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slashMatch) {
    const [, _y, m, d] = slashMatch.map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(_y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  // ── DD.MM.YYYY (European) ──
  const euMatch = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (euMatch) {
    const [, d, m, y] = euMatch.map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  // ── MM/DD/YYYY (US) ──
  const usMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (usMatch) {
    const [, m, d, y] = usMatch.map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  return null;
}
