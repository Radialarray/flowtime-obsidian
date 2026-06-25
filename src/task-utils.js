/**
 * task-utils — Shared utility functions for Flowtime renderers.
 *
 * Extracted from renderer.js and weekplan-renderer.js to eliminate ~400 lines
 * of duplication across pure functions and vault I/O operations.
 *
 * All functions are stateless where possible; vault I/O functions accept
 * the Obsidian Vault instance as a parameter.
 */

const { parseTaskLine } = require("./task-parser");

/* ─── Constants ─── */

const DUR_OPTS = [10, 15, 20, 25, 30, 45, 60, 90, 120, 150, 180, 210, 240];
const START_H = 7;
const START_END = 20;

/* ─── Time helpers ─── */

/** Generate time slot options (HH:MM) in 30-min increments from h1 to h2 */
function timeOpts(h1, h2) {
	const r = [];
	for (let h = h1; h <= h2; h++)
		for (let m = 0; m < 60; m += 30)
			r.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
	return r;
}

/**
 * Parse a stored time block like "09:00—10:30" into { start, dur }.
 * Durations are snapped to the nearest DUR_OPTS value.
 */
function parseStored(t) {
	if (!t) return { start: "", dur: 0 };
	const m = t.match(/^(\d{1,2}:\d{2})\s*[—\-–]\s*(\d{1,2}:\d{2})$/);
	if (!m) return { start: "", dur: 0 };
	const d =
		m[2].split(":").reduce((a, n) => +n + 60 * a, 0) -
		m[1].split(":").reduce((a, n) => +n + 60 * a, 0);
	return {
		start: m[1],
		dur:
			d > 0
				? DUR_OPTS.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a))
				: 0,
	};
}

/** Calculate end time string (HH:MM) from start + duration in minutes */
function calcEnd(s, d) {
	if (!s || !d) return "";
	const t = s.split(":").reduce((a, n) => +n + 60 * a, 0) + d;
	return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.round(t % 60)).padStart(2, "0")}`;
}

/**
 * Parse a duration string like "30m", "1.5h", "1h 30m" to minutes.
 * Supports plain integer strings (treated as minutes).
 */
function parseDurStr(str) {
	if (!str) return 0;
	if (/^\d+$/.test(str)) return parseInt(str, 10); // plain minutes
	let total = 0;
	const hMatch = str.match(/([\d.]+)\s*h/);
	if (hMatch) total += parseFloat(hMatch[1]) * 60;
	const mMatch = str.match(/(\d+)\s*m/);
	if (mMatch) total += parseInt(mMatch[1], 10);
	return Math.round(total);
}

/**
 * Convert a time string (HH:MM) to a grid row number.
 * Used by the timeline grid view. Row 1 = header, row 2 = START_H:00.
 */
function timeToRow(timeStr, startH) {
	if (!timeStr) return -1;
	const h1 = startH != null ? startH : START_H;
	const parts = timeStr.split(":");
	const h = parseInt(parts[0], 10);
	const m = parseInt(parts[1], 10) || 0;
	const totalMinutes = h * 60 + m;
	const startMinutes = h1 * 60;
	if (totalMinutes < startMinutes) return -1;
	const slotIndex = Math.round((totalMinutes - startMinutes) / 30);
	return 2 + slotIndex; // row 1 = header, row 2 = first slot
}

/**
 * Convert a grid row number back to a time string (HH:MM).
 */
function rowToTime(rowNum, startH, startEnd) {
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
function getMonday(d) {
	const date = new Date(d);
	const day = date.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	date.setDate(date.getDate() + diff);
	return date.toISOString().split("T")[0];
}

/** Get Friday (YYYY-MM-DD) given a Monday date string */
function getFriday(mondayStr) {
	const m = new Date(mondayStr + "T12:00:00");
	m.setDate(m.getDate() + 4);
	return m.toISOString().split("T")[0];
}

/** Get Sunday (YYYY-MM-DD) given any date string */
function getSunday(dateStr) {
	const monday = new Date(getMonday(dateStr));
	monday.setDate(monday.getDate() + 6);
	return monday.toISOString().split("T")[0];
}

/** ISO 8601 week number for a given date string */
function getWeekNumber(dateStr) {
	const d = new Date(dateStr + "T12:00:00");
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
	const week1 = new Date(d.getFullYear(), 0, 4);
	return (
		1 +
		Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
	);
}

/**
 * Format a YYYY-MM-DD date for human-readable display.
 * Returns "Today", "Tomorrow", "Yesterday", "Mon 24", or "24.6."
 */
function fmtDate(dateStr) {
	if (!dateStr) return "";
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const d = new Date(dateStr + "T00:00:00");
	const diff = Math.round((d - today) / 86400000);
	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const label = days[d.getDay()] + " " + d.getDate();
	if (diff === 0) return label + " (Today)";
	if (diff === 1) return label + " (Tomorrow)";
	if (diff === -1) return label + " (Yesterday)";
	// Within this week: show day name
	if (diff > -7 && diff < 7) return label;
	// Otherwise show short date
	return `${d.getDate()}.${d.getMonth() + 1}.`;
}

/* ─── Priority ─── */

/** Map priority emoji to sort weight (higher = first) */
function priorityWeight(p) {
	const w = { "🟥": 5, "🟨": 3, "🟩": 1 };
	return w[p] || 0;
}

/* ─── File scope ─── */

/**
 * Check if a file path is within the plugin's scan scope.
 * Respects projectsRoot setting — if set, only files under that root are scanned.
 * Always excludes .obsidian/ and .git/
 */
function isFileInScope(filePath, projectsRoot) {
	if (filePath.startsWith(".obsidian") || filePath.startsWith(".git"))
		return false;
	if (!projectsRoot) return true;
	const normalizedRoot = projectsRoot.endsWith("/")
		? projectsRoot
		: projectsRoot + "/";
	return filePath.startsWith(normalizedRoot);
}

/* ─── Audio ─── */

/* ─── Vault I/O ─── */

/**
 * Get parsed tasks for a file, using cache if available.
 * Falls back to reading and parsing the file, then caches the result.
 *
 * @param {object} file - Obsidian TFile
 * @param {object} app - Obsidian App instance
 * @param {object} cache - Optional task cache (with .get/.set methods)
 * @returns {Promise<Array>} Array of parsed task objects with .file reference
 */
async function getFileTasks(file, app, cache) {
	const cached = cache?.get(file.path);
	if (cached) {
		return cached.parsedTasks.map((t) => ({ ...t, file }));
	}
	const content = await app.vault.read(file);
	const lines = content.split("\n");
	const result = [];
	for (let i = 0; i < lines.length; i++) {
		const parsed = parseTaskLine(lines[i], file, i);
		if (parsed) result.push(parsed);
	}
	if (cache) {
		const cacheable = result.map((t) => {
			const { file: f, ...rest } = t;
			return rest;
		});
		cache.set(file.path, cacheable);
	}
	return result;
}

/**
 * Save a time block with duration directive to a task's source line.
 * Replaces the time portion and updates the @duration directive.
 *
 * @param {object} vault - Obsidian Vault instance
 * @param {object} task - Task object with .file and .line
 * @param {string} startStr - Start time (HH:MM), or ""
 * @param {number} durMinutes - Duration in minutes, or 0
 */
async function saveTimeWithDuration(vault, task, startStr, durMinutes) {
	if (!task.file) return;
	const endStr =
		startStr && durMinutes > 0 ? calcEnd(startStr, durMinutes) : "";
	let timeBlock = startStr;
	if (endStr) timeBlock += "—" + endStr;

	const content = await vault.read(task.file);
	const lines = content.split("\n");
	let line = lines[task.line];
	if (!line) return;

	// Replace or add time block
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

	// Update duration directive
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
 *
 * @param {object} vault - Obsidian Vault instance
 * @param {object} task - Task object with .file, .line, .status
 * @returns {Promise<boolean>} True if task is now completed (x), false if unchecked
 */
async function toggleCheck(vault, task) {
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
 *
 * @param {object} vault - Obsidian Vault instance
 * @param {object} task - Task object with .file and .line
 * @param {string} newDate - New date string (YYYY-MM-DD), or "" to remove
 */
async function updateDate(vault, task, newDate) {
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

module.exports = {
	DUR_OPTS,
	START_H,
	START_END,
	timeOpts,
	parseStored,
	calcEnd,
	parseDurStr,
	timeToRow,
	rowToTime,
	getMonday,
	getFriday,
	getSunday,
	getWeekNumber,
	fmtDate,
	priorityWeight,
	isFileInScope,
	getFileTasks,
	saveTimeWithDuration,
	toggleCheck,
	updateDate,
};
