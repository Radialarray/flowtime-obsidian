/**
 * Task parsing module.
 * Extracts structured task data from Obsidian task lines.
 */

const { parseDate } = require("./date-parser");

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

	// v0.6.0: Extract indent level (leading whitespace before task marker)
	// Normalize tabs to 2 spaces for consistent depth calculation
	const indentSpaces = m[1].match(/^\s*/)[0].replace(/\t/g, "  ").length;
	const indent = indentSpaces;

	// Extract date: /[@⏳📅]\s*(\d{4}-\d{2}-\d{2})/
	const dateMatch = m[3].match(/[@⏳📅]\s*(\d{4}-\d{2}-\d{2})/);
	let taskDate = (dateMatch || [])[1] || "";

	// v0.6.0: Fallback — try natural language date parsing (@today, @tomorrow, etc.)
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

	// Extract time block: /^(\d{1,2}:\d{2}(?:\s*[—\-–]\s*\d{1,2}:\d{2})?)\s*/
	let time = "",
		rest = m[3];
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

	// v1.3.0: Extract sort index: @i:<number>
	let sortIndex = null;
	const idxMatch = rest.match(/@i:([\d.]+)/);
	if (idxMatch) sortIndex = parseFloat(idxMatch[1]);

	// v0.6.0: Extract sprint: @sprint:<id>
	let sprint = null;
	const sprintMatch = rest.match(/@sprint:([^\s]+)/);
	if (sprintMatch) sprint = sprintMatch[1];

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
		durationMinutes =
			durMatch[2] === "h" ? Math.round(val * 60) : Math.round(val);
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
		projectTag, // v0.4.0: @p:Name or null
		isSoon, // v0.4.0: @soon tag
		indent, // v0.6.0: leading whitespace length for subtask hierarchy
		sprint, // v0.6.0: @sprint:id or null
		sortIndex, // v1.3.0: @i:number for manual sort order
	};
}

/**
 * Clean task text of all directives (dates, priority emoji, recurrence, tags).
 */
function cleanTaskText(text) {
	return text
		.replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/gu, "")
		.replace(
			/@(?:today|tod|tomorrow|tom|yesterday|yes|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi,
			"",
		) // v0.6.0: strip natural language date words
		.replace(
			/@next\s+(?:week|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi,
			"",
		) // @next week/day
		.replace(/@in\s+\d+\s*[dwm]\b/gi, "") // @in 3d / @in 1w / @in 2m
		.replace(/@\d+(?:\.\d+)?[hm]/g, "") // duration: @1.5h @30m
		.replace(/@(?:bucket|b):[^\s]+/g, "") // bucket directive
		.replace(/@p:[^\s]+/g, "") // v0.4.0: project directive
		.replace(/@(?:high|med|low|soon)\b/gi, "") // v0.4.0: priority/status tags
		.replace(/@\d{1,2}:\d{2}(?:[—\-–]\d{1,2}:\d{2})?/g, "") // @HH:MM time tags
		.replace(/@sprint:[^\s]+/g, "") // v0.6.0: sprint tag
		.replace(/@i:[\d.]+/g, "") // v1.3.0: sort index
		.replace(/[🟥🟨🟩]/g, "")
		.replace(/🔁 every .+$/gm, "") // v0.5.0: all recurrence markers
		.replace(/#\S+/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Extract recurrence info from task line text.
 * Returns a Recurrence object or null.
 *
 * Recognized patterns:
 *   🔁 every day
 *   🔁 every workday
 *   🔁 every week
 *   🔁 every month
 *   🔁 every Sun / Mon / Tue / Wed / Thu / Fri / Sat
 *   🔁 every Mon Wed Fri  (any combination of day names)
 *   🔁 every 2nd Sun / 1st Mon / 3rd Tue  (nth weekday of month)
 *   🔁 every month on 15th  (specific date of month)
 *   🔁 every 3 days / every 2 weeks / every 3 months  (interval gap)
 *
 * @param {string} text
 * @returns {object|null}
 */
function parseRecurrence(text) {
	const m = text.match(/🔁\s*every\s+(.+)$/);
	if (!m) return null;

	const expr = m[1].trim().toLowerCase();

	// Simple patterns
	if (expr === "day" || expr === "days" || expr === "1 day")
		return { type: "daily" };
	if (expr === "workday" || expr === "workdays") return { type: "workday" };
	if (expr === "week" || expr === "weeks" || expr === "1 week")
		return { type: "weekly" };
	if (expr === "month" || expr === "months" || expr === "1 month")
		return { type: "monthly" };

	// Interval gap: "every 3 days", "every 2 weeks", "every 3 months"
	const intervalMatch = expr.match(
		/^(\d+)\s*(day|days|week|weeks|month|months)$/,
	);
	if (intervalMatch) {
		const n = parseInt(intervalMatch[1], 10);
		const unit = intervalMatch[2].replace(/s$/, "");
		if (n > 1) return { type: "interval", every: n, unit };
	}

	// Day names: "every sun", "every mon wed fri"
	const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

	// Check for nth-weekday pattern: "every 2nd sun", "every 1st mon"
	const nthMatch = expr.match(
		/^(1st|2nd|3rd|4th|last)\s+(sun|mon|tue|wed|thu|fri|sat)$/i,
	);
	if (nthMatch) {
		const nthMap = { "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, last: -1 };
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

	// Plain day names: "every sun", "every mon wed fri"
	const dayNameMatch = expr.match(/\b(sun|mon|tue|wed|thu|fri|sat)\b/gi);
	if (dayNameMatch) {
		const days = [
			...new Set(dayNameMatch.map((d) => dayNames.indexOf(d.toLowerCase()))),
		];
		return { type: "custom-days", days };
	}

	return null;
}

/**
 * Evaluate whether a recurrence is due on the given date.
 *
 * For interval-based types (every N days/weeks/months), the
 * lastGenerated date from tracking is needed to determine if
 * enough time has passed. Without it, returns true.
 *
 * @param {object} recurrence - Result from parseRecurrence
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {object} [options]
 * @param {number[]} [options.workdays] - Day indices for workday mode (default [1,2,3,4,5])
 * @param {string} [options.lastGenerated] - Last generation date YYYY-MM-DD
 * @returns {boolean}
 */
function isRecurrenceDue(recurrence, dateStr, options = {}) {
	if (!recurrence || !dateStr) return false;

	const date = new Date(dateStr + "T12:00:00");
	const dayOfWeek = date.getDay(); // 0=Sun
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
			return recurrence.days.includes(dayOfWeek);

		case "nth-weekday": {
			const daysInMonth = new Date(year, month + 1, 0).getDate();
			if (recurrence.nth === -1) {
				// Last occurrence: count from end
				for (let d = daysInMonth; d >= 1; d--) {
					const dt = new Date(year, month, d);
					if (dt.getDay() === recurrence.weekday) {
						return dayOfMonth === d;
					}
				}
				return false;
			}
			// Nth occurrence: count from start
			let count = 0;
			for (let d = 1; d <= daysInMonth; d++) {
				const dt = new Date(year, month, d);
				if (dt.getDay() === recurrence.weekday) {
					count++;
					if (d === dayOfMonth) return count === recurrence.nth;
				}
			}
			return false;
		}

		case "month-date":
			return dayOfMonth === recurrence.monthDay;

		case "interval": {
			if (!options.lastGenerated) {
				// First time — assume due. Engine deduplicates via .generated.json.
				return true;
			}
			const lastDate = new Date(options.lastGenerated + "T12:00:00");
			const diffMs = date - lastDate;
			const diffDays = diffMs / (1000 * 60 * 60 * 24);
			switch (recurrence.unit) {
				case "day":
					return diffDays >= recurrence.every;
				case "week":
					return diffDays >= recurrence.every * 7;
				case "month": {
					const monthDiff =
						(year - lastDate.getFullYear()) * 12 +
						(month - lastDate.getMonth());
					return monthDiff >= recurrence.every;
				}
				default:
					return true;
			}
		}

		default:
			return false;
	}
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
			: ((minutes / 60) % 1 === 0 ? minutes / 60 : (minutes / 60).toFixed(1)) +
				"h";
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

/**
 * v0.6.0: Build a parent-child tree from a flat list of parsed tasks.
 * Hierarchy is determined by indent level.
 * Returns array of root nodes, each with: { task, children: [], depth }
 */
function buildTaskTree(tasks) {
	const roots = [];
	const stack = [{ children: roots, depth: -1 }];

	for (const task of tasks) {
		const depth = Math.floor(task.indent / 2);
		const node = { task, children: [], depth };

		// Pop until we find a parent shallower than this node
		while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
			stack.pop();
		}

		// Attach to parent or root
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
 * v0.6.0: Flatten a task tree into a display list.
 * Collapsed parents omit their children.
 * Each item gets { task, depth, hasChildren, childrenCount, collapsed, childrenTasks }
 */
function flattenTree(roots, collapsedIds = new Set()) {
	const items = [];

	function walk(node, collapseParent) {
		const id = taskId(node.task);
		const isCollapsed = collapsedIds.has(id) || collapseParent;
		items.push({
			task: node.task,
			depth: node.depth,
			hasChildren: node.children.length > 0,
			childrenCount: node.children.length,
			childrenTasks: node.children.map((c) => c.task), // actual child task refs
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
 * v0.6.0: Unique string ID for a task (file:line).
 */
function taskId(task) {
	return (task.file?.path || "") + ":" + task.line;
}

module.exports = {
	parseTaskLine,
	cleanTaskText,
	parseRecurrence,
	isRecurrenceDue,
	formatDuration,
	formatTimer,
	buildTaskTree, // v0.6.0
	flattenTree, // v0.6.0
	taskId, // v0.6.0
};
