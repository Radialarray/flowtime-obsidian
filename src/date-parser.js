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

/**
 * @param {string} input
 * @returns {string|null} YYYY-MM-DD or null
 */
function parseDate(input) {
	if (!input) return null;

	let s = input.trim().toLowerCase();

	// Strip leading @ (from task format @today)
	if (s.startsWith("@")) s = s.slice(1).trim();
	if (!s) return null;

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	// ── Exact keywords ──
	const exactMap = {
		today: 0,
		tod: 0,
		tomorrow: 1,
		tom: 1,
		yesterday: -1,
		yes: -1,
	};

	if (s in exactMap) {
		const d = new Date(today);
		d.setDate(d.getDate() + exactMap[s]);
		return _fmt(d);
	}

	// ── Day name helpers ──
	const dayNames = [
		"sunday", "monday", "tuesday", "wednesday",
		"thursday", "friday", "saturday",
	];
	const dayAbbr = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

	/**
	 * Return new Date for the next occurrence of dayIndex (0=Sunday).
	 * If today is that day, returns 7 days from now (next week).
	 */
	function _nextDay(from, dayIndex) {
		const d = new Date(from);
		let diff = dayIndex - d.getDay();
		if (diff <= 0) diff += 7;
		d.setDate(d.getDate() + diff);
		return d;
	}

	// ── "next <day>" pattern (skip one occurrence) ──
	const nextDayMatch = s.match(
		/^next\s+(sun|mon|tue|wed|thu|fri|sat)(day)?$/,
	);
	if (nextDayMatch) {
		const idx = dayAbbr.indexOf(nextDayMatch[1]);
		const d = _nextDay(today, idx);
		d.setDate(d.getDate() + 7); // skip one more week
		return _fmt(d);
	}

	// ── Bare day name ──
	for (let i = 0; i < dayNames.length; i++) {
		if (s === dayNames[i] || s === dayAbbr[i]) {
			return _fmt(_nextDay(today, i));
		}
	}

	// ── "next week" ──
	if (s === "next week") {
		const d = new Date(today);
		d.setDate(d.getDate() + 7);
		return _fmt(d);
	}

	// ── "in X days", "in Xd", "in X week(s)", "in Xw", "in X month(s)", "in Xm" ──
	const inMatch = s.match(
		/^in\s+(\d+)\s*(d(?:ays?)?|w(?:eeks?)?|m(?:onths?)?)$/,
	);
	if (inMatch) {
		const num = parseInt(inMatch[1], 10);
		const unit = inMatch[2][0]; // 'd', 'w', or 'm'
		const d = new Date(today);
		if (unit === "d") d.setDate(d.getDate() + num);
		else if (unit === "w") d.setDate(d.getDate() + num * 7);
		else if (unit === "m") d.setDate(d.getDate() + num * 30);
		return _fmt(d);
	}

	// ── Already formatted YYYY-MM-DD ──
	const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (isoMatch) {
		const [, y, m, d] = isoMatch.map(Number);
		if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
			return s; // already correct
		}
	}

	// ── YYYY/MM/DD ──
	const slashMatch = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
	if (slashMatch) {
		const [, y, m, d] = slashMatch.map(Number);
		if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
			return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
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

/**
 * Format a Date object to YYYY-MM-DD string.
 * @param {Date} d
 * @returns {string}
 */
function _fmt(d) {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

module.exports = { parseDate };
