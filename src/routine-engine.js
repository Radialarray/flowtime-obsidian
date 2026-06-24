const { Notice } = require("obsidian");
const { parseTaskLine, parseRecurrence, isRecurrenceDue } = require("./task-parser");

/**
 * RoutineEngine — scans a designated vault folder for routine template files,
 * evaluates recurrence rules, and generates task instances into daily notes.
 *
 * Tracks generation history in .generated.json (inside the routines folder)
 * to prevent cross-device duplication when the vault syncs via Obsidian Sync or Git.
 */
class RoutineEngine {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
	}

	/* ─── config accessors ─── */

	get routinesFolder() {
		return (this.plugin?.settings?.routinesFolder || "flowtime/routines/").replace(/\/+$/, "") + "/";
	}

	get generatedFilePath() {
		return this.routinesFolder + ".generated.json";
	}

	get isVacationMode() {
		return !!this.plugin?.settings?.vacationMode;
	}

	get workdays() {
		return this.plugin?.settings?.workdays || [1, 2, 3, 4, 5];
	}

	/* ─── .generated.json I/O ─── */

	async loadGenerated() {
		try {
			const path = this.generatedFilePath;
			if (await this.app.vault.adapter.exists(path)) {
				const raw = await this.app.vault.adapter.read(path);
				const data = JSON.parse(raw);
				return Array.isArray(data?.entries) ? data.entries : [];
			}
		} catch (_) {}
		return [];
	}

	async saveGenerated(entries) {
		try {
			const path = this.generatedFilePath;
			await this.app.vault.adapter.write(path, JSON.stringify({ entries }, null, 2));
		} catch (e) {
			console.warn("Flowtime: Failed to save .generated.json:", e.message);
		}
	}

	/**
	 * Stable hash for a task line (used to detect renames/edits).
	 */
	_hashLine(line) {
		let hash = 0;
		const s = line.replace(/\s+/g, " ").trim();
		for (let i = 0; i < s.length; i++) {
			const chr = s.charCodeAt(i);
			hash = ((hash << 5) - hash) + chr;
			hash |= 0; // Convert to 32bit int
		}
		return "h" + Math.abs(hash).toString(36);
	}

	_hasEntry(entries, lineHash, targetDate) {
		return entries.some(e => e.lineHash === lineHash && e.targetDate === targetDate);
	}

	/* ─── scanning ─── */

	/**
	 * Scan the routines folder and return parsed template tasks.
	 * Each returned object: { routineFile, line, rawLine, parsed, recurrence }
	 */
	async scanRoutines() {
		const results = [];
		try {
			const folder = this.app.vault.getAbstractFileByPath(this.routinesFolder);
			if (!folder || !folder.children) return results;

			for (const child of folder.children) {
				if (child.name === ".generated.json") continue;
				if (!child.name.endsWith(".md")) continue;

				const content = await this.app.vault.read(child);
				const lines = content.split("\n");

				for (let i = 0; i < lines.length; i++) {
					const parsed = parseTaskLine(lines[i], child, i);
					if (!parsed) continue;
					// Must have a recurrence marker to be a routine
					if (!parsed.rawText.match(/🔁/)) continue;

					const recurrence = parseRecurrence(parsed.rawText);
					if (!recurrence) continue;

					results.push({
						routineFile: child.path,
						line: i,
						rawLine: lines[i],
						parsed,
						recurrence,
					});
				}
			}
		} catch (e) {
			console.warn("Flowtime: Error scanning routines folder:", e.message);
		}
		return results;
	}

	/**
	 * Ensure the routines folder exists.
	 */
	async ensureRoutinesFolder() {
		try {
			if (!(await this.app.vault.adapter.exists(this.routinesFolder))) {
				await this.app.vault.createFolder(this.routinesFolder.replace(/\/$/, ""));
				if (!this.plugin?.settings?.quietMode) {
					new Notice("📁 Created " + this.routinesFolder);
				}
			}
		} catch (e) {
			console.warn("Flowtime: Could not create routines folder:", e.message);
		}
	}

	/* ─── generation ─── */

	/**
	 * Generate routine task instances for a specific date.
	 * Writes to the daily note if it exists (or creates it).
	 *
	 * @param {string} dateStr - YYYY-MM-DD
	 * @param {object} [options]
	 * @param {boolean} [options.force] - Re-generate even if already generated
	 * @param {boolean} [options.dryRun] - Don't write, just return what would be generated
	 * @returns {Promise<number>} Number of tasks generated
	 */
	async generateForDate(dateStr, options = {}) {
		if (!dateStr) return 0;
		if (this.isVacationMode && !options.force) return 0;

		const entries = await this.loadGenerated();
		const routines = await this.scanRoutines();
		let generated = 0;
		const newEntries = [];

		for (const routine of routines) {
			// Evaluate if this recurrence is due on dateStr
			const due = isRecurrenceDue(routine.recurrence, dateStr, {
				workdays: this.workdays,
				lastGenerated: this._lastGenForLine(entries, routine),
			});
			if (!due) continue;

			const lineHash = this._hashLine(routine.rawLine);

			// Already generated for this date?
			if (!options.force && this._hasEntry(entries, lineHash, dateStr)) continue;
			if (!options.force && this._hasEntry(newEntries, lineHash, dateStr)) continue;

			// Build the actual task line for the daily note.
			// Preserve the original task text but ensure date is set correctly.
			const todayStr = new Date().toISOString().split("T")[0];
			let taskLine = routine.rawLine;
			// Replace any existing date with the target date
			taskLine = taskLine.replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/g, "@" + dateStr);
			// If no date was present, insert it
			if (!taskLine.match(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/)) {
				taskLine = taskLine.replace(/(\]\s*)/, "$1@" + dateStr + " ");
			}

			if (options.dryRun) {
				generated++;
				newEntries.push({ routineFile: routine.routineFile, lineHash, targetDate: dateStr, generatedAt: todayStr });
				continue;
			}

			// Write to daily note
			const dailyFile = await this._ensureDailyNote(dateStr);
			if (!dailyFile) continue;

			const written = await this._appendTaskIfMissing(dailyFile, taskLine);
			if (written) {
				generated++;
				newEntries.push({ routineFile: routine.routineFile, lineHash, targetDate: dateStr, generatedAt: todayStr });
			}
		}

		if (newEntries.length > 0 && !options.dryRun) {
			await this.saveGenerated([...entries, ...newEntries]);
		}

		return generated;
	}

	/**
	 * Generate for a range of dates.
	 *
	 * @param {string} fromDate - YYYY-MM-DD
	 * @param {string} toDate - YYYY-MM-DD (inclusive)
	 * @returns {Promise<number>} Total tasks generated
	 */
	async generateForRange(fromDate, toDate) {
		let total = 0;
		const from = new Date(fromDate + "T12:00:00");
		const to = new Date(toDate + "T12:00:00");

		for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
			const dateStr = d.toISOString().split("T")[0];
			total += await this.generateForDate(dateStr);
		}
		return total;
	}

	/**
	 * Generate for a full week (Mon-Sun based on the given date).
	 */
	async generateForWeek(dateInWeek) {
		const date = new Date(dateInWeek + "T12:00:00");
		const day = date.getDay();
		const monday = new Date(date);
		monday.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
		const sunday = new Date(monday);
		sunday.setDate(monday.getDate() + 6);

		return this.generateForRange(
			monday.toISOString().split("T")[0],
			sunday.toISOString().split("T")[0],
		);
	}

	/**
	 * Generate for today.
	 */
	async generateToday(options = {}) {
		const today = new Date().toISOString().split("T")[0];
		return this.generateForDate(today, options);
	}

	/**
	 * Generate for this week.
	 */
	async generateThisWeek() {
		const today = new Date().toISOString().split("T")[0];
		return this.generateForWeek(today);
	}

	/**
	 * Full generate: today + this week's remaining days.
	 * Called on plugin load.
	 */
	async generateAllDue(options = {}) {
		if (this.isVacationMode && !options.force) return 0;
		const today = new Date().toISOString().split("T")[0];
		let total = 0;
		total += await this.generateForDate(today, options);

		// Also generate for rest of this week (so weekplan view has data)
		const date = new Date(today + "T12:00:00");
		const day = date.getDay();
		const friday = new Date(date);
		friday.setDate(date.getDate() + (day === 0 ? 5 : 5 - day));

		if (friday > date) {
			const nextDay = new Date(date);
			nextDay.setDate(nextDay.getDate() + 1);
			const rangeEnd = friday.toISOString().split("T")[0];
			total += await this.generateForRange(
				nextDay.toISOString().split("T")[0],
				rangeEnd,
			);
		}
		return total;
	}

	/* ─── helpers ─── */

	async _ensureDailyNote(dateStr) {
		// Determine daily notes folder from Obsidian settings or default to vault root
		let folder = "";
		try {
			const dailyNotesPath = this.app.vault.configDir + "/daily-notes.json";
			if (await this.app.vault.adapter.exists(dailyNotesPath)) {
				const config = JSON.parse(await this.app.vault.adapter.read(dailyNotesPath));
				folder = config.folder || "";
			}
		} catch (_) {}

		const filePath = folder
			? (folder.endsWith("/") ? folder : folder + "/") + dateStr + ".md"
			: dateStr + ".md";

		try {
			let file = this.app.vault.getAbstractFileByPath(filePath);
			if (!file) {
				file = await this.app.vault.create(filePath, "");
			}
			return file;
		} catch (e) {
			console.warn("Flowtime: Could not ensure daily note:", filePath, e.message);
			return null;
		}
	}

	/**
	 * Append a task line to a file if it doesn't already exist in the file.
	 * Checks for duplicate lines (same text after trimming).
	 */
	async _appendTaskIfMissing(file, taskLine) {
		try {
			const content = await this.app.vault.read(file);
			const lines = content.split("\n");

			// Don't append if identical line already exists
			const trimmed = taskLine.trim();
			if (lines.some(l => l.trim() === trimmed)) return false;

			// Append with a newline separator
			const newContent = content.endsWith("\n")
				? content + trimmed + "\n"
				: content + (content ? "\n" : "") + trimmed + "\n";
			await this.app.vault.modify(file, newContent);
			return true;
		} catch (e) {
			console.warn("Flowtime: Could not append task:", e.message);
			return false;
		}
	}

	/**
	 * Get the last generation entry for a specific routine.
	 */
	_lastGenForLine(entries, routine) {
		const lineHash = this._hashLine(routine.rawLine);
		const match = entries
			.filter(e => e.routineFile === routine.routineFile && e.lineHash === lineHash)
			.sort((a, b) => b.targetDate.localeCompare(a.targetDate));
		return match.length > 0 ? match[0].targetDate : null;
	}

	/**
	 * Clear all generation tracking (for rebuild).
	 */
	async clearTracking() {
		try {
			const path = this.generatedFilePath;
			if (await this.app.vault.adapter.exists(path)) {
				await this.app.vault.adapter.remove(path);
			}
		} catch (_) {}
	}
}

module.exports = { RoutineEngine };
