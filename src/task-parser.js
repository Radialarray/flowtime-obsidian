/**
 * Task parsing module.
 * Extracts structured task data from Obsidian task lines.
 */

/**
 * Parse a single task line and return a structured task object.
 * Returns null if the line is not a task line.
 *
 * @param {string} line - raw task line from markdown
 * @param {object} file - vault file reference
 * @param {number} lineIndex - line number in the file
 * @returns {object|null}
 */
function parseTaskLine(line, file, lineIndex) {
	const m = line.match(/^(\s*[-*+]\s*\[([^\]]*)\]\s*)(.*)$/);
	if (!m) return null;

	const status = m[2].trim();

	// Extract date: /[@⏳📅]\s*(\d{4}-\d{2}-\d{2})/
	const dateMatch = m[3].match(/[@⏳📅]\s*(\d{4}-\d{2}-\d{2})/);
	const taskDate = (dateMatch || [])[1] || "";

	// Extract time block: /^(\d{1,2}:\d{2}(?:\s*[—\-–]\s*\d{1,2}:\d{2})?)\s*/
	let time = "", rest = m[3];
	const tm = rest.match(/^(\d{1,2}:\d{2}(?:\s*[—\-–]\s*\d{1,2}:\d{2})?)\s*/);
	if (tm) {
		time = tm[1];
		rest = rest.slice(tm[0].length);
	}

	// v0.4.0: Extract priority — color dots (🟥🟨🟩) or @high/@med/@low aliases
	let priority = null;
	const prioMatch = rest.match(/[🟥🟨🟩]/);
	if (prioMatch) priority = prioMatch[0];
	if (!priority) {
		if (rest.match(/@high\b/)) priority = "🟥";
		else if (rest.match(/@med\b/)) priority = "🟨";
		else if (rest.match(/@low\b/)) priority = "🟩";
	}

	// v0.4.0: @soon tag — marks task as upcoming backlog
	const isSoon = !!rest.match(/@soon\b/);

	// Extract bucket: @bucket:<name> or @b:<name>
	let bucket = null;
	const bucketMatch = rest.match(/@(?:bucket|b):([^\s]+)/);
	if (bucketMatch) bucket = bucketMatch[1];

	// v0.4.0: Extract project from @p:<name> syntax
	let projectTag = null;
	const pMatch = rest.match(/@p:([^\s]+)/);
	if (pMatch) projectTag = pMatch[1];

	// Extract duration: @<number>h or @<number>m
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
		projectTag,     // v0.4.0: @p:Name or null
		isSoon,         // v0.4.0: @soon tag
	};
}

/**
 * Clean task text of all directives (dates, priority emoji, recurrence, tags).
 */
function cleanTaskText(text) {
	return text
		.replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/gu, "")
		.replace(/@\d+(?:\.\d+)?[hm]/g, "")  // duration: @1.5h @30m
		.replace(/@(?:bucket|b):[^\s]+/g, "") // bucket directive
		.replace(/@p:[^\s]+/g, "")             // v0.4.0: project directive
		.replace(/@(?:high|med|low|soon)\b/gi, "") // v0.4.0: priority/status tags
		.replace(/[🟥🟨🟩]/g, "")
		.replace(/🔁 every \d* (day|days|week|weeks|month|months)/g, "")
		.replace(/🔁 [^\s]+( \d+[dwmy])?/g, "")
		.replace(/#\S+/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Extract recurrence info from task line text.
 * Returns { interval, unit } or null.
 */
function parseRecurrence(text) {
	const match = text.match(/🔁\s*every\s+(\d*)\s*(day|days|week|weeks|month|months)/);
	if (!match) return null;
	const n = parseInt(match[1] || "1", 10);
	const unit = match[2].replace(/s$/, "");
	return { interval: n, unit };
}

/**
 * Format duration in minutes for display.
 * Returns e.g. "45m", "1.5h", "--"
 */
function formatDuration(minutes) {
	return !minutes
		? "--"
		: minutes < 60
			? minutes + "m"
			: ((minutes / 60) % 1 === 0 ? minutes / 60 : (minutes / 60).toFixed(1)) + "h";
}

/**
 * Format seconds countdown for timer display.
 * Returns "MM:SS" or "H:MM:SS".
 */
function formatTimer(seconds) {
	if (seconds <= 0) return "00:00";
	const h = Math.floor(seconds / 3600),
		m = Math.floor((seconds % 3600) / 60),
		s = seconds % 60;
	return h > 0
		? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
		: `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

module.exports = { parseTaskLine, cleanTaskText, parseRecurrence, formatDuration, formatTimer };
