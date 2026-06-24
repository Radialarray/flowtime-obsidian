const { MarkdownRenderChild, Notice } = require("obsidian");
const { parseTaskLine, parseRecurrence, formatDuration, formatTimer } = require("./task-parser");
const { renderProgressBar, formatHours } = require("./budget-state");

const DUR_OPTS = [10, 15, 20, 25, 30, 45, 60, 90, 120, 150, 180, 210, 240];
const START_H = 7;
const START_END = 20;

/**
 * WeekplanRenderer — day-by-day week planning view.
 *
 * Renders Monday–Friday with all tasks (routines + one-offs) per day,
 * inline editing, daily budget bars, and toolbar actions.
 */
class WeekplanRenderer extends MarkdownRenderChild {
	constructor(app, containerEl, plugin, projectEngine, sourcePath) {
		super(containerEl);
		this.app = app;
		this.containerEl = containerEl;
		this.plugin = plugin;
		this.projectEngine = projectEngine;
		this.sourcePath = sourcePath;
		this.dayTasks = {};     // dateStr → task[]
		this.dayTotals = {};    // dateStr → total minutes
		this.dailyCap = 12;
	}

	async onload() {
		try {
			this.dailyCap = this.plugin?.settings?.dailyCap || 12;
			await this.loadWeek();
			this.renderView();
		} catch (e) {
			this.containerEl.createEl("p", {
				text: "⚠️ Error: " + e.message,
				cls: "flowtime-empty",
			});
			console.error("Weekplan error:", e);
		}
	}

	/* ─── helpers ─── */

	_getMonday(d) {
		const date = new Date(d);
		const day = date.getDay();
		const diff = day === 0 ? -6 : 1 - day;
		date.setDate(date.getDate() + diff);
		return date.toISOString().split("T")[0];
	}

	_getFriday(mondayStr) {
		const m = new Date(mondayStr + "T12:00:00");
		m.setDate(m.getDate() + 4);
		return m.toISOString().split("T")[0];
	}

	_timeOpts(h1, h2) {
		const r = [];
		for (let h = h1; h <= h2; h++)
			for (let m = 0; m < 60; m += 30)
				r.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
		return r;
	}

	_parseStored(t) {
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
					? DUR_OPTS.reduce((a, b) =>
							Math.abs(b - d) < Math.abs(a - d) ? b : a,
						)
					: 0,
		};
	}

	_parseDurStr(s) {
		if (!s) return 0;
		const m = s.match(/^(\d+(?:\.\d+)?)\s*([hm])$/);
		if (m) return m[2] === "h" ? parseFloat(m[1]) * 60 : parseFloat(m[1]);
		return parseInt(s, 10) || 0;
	}

	_calcEnd(s, d) {
		if (!s || !d) return "";
		const t = s.split(":").reduce((a, n) => +n + 60 * a, 0) + d;
		return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.round(t % 60)).padStart(2, "0")}`;
	}

	_fmtDate(dateStr) {
		if (!dateStr) return "";
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const d = new Date(dateStr + "T00:00:00");
		const diff = Math.round((d - today) / 86400000);
		const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
		const label = days[d.getDay()] + " " + d.getDate();
		if (diff === 0) return label + " (Today)";
		if (diff === 1) return label + " (Tomorrow)";
		return label;
	}

	_isFileInScope(filePath) {
		if (filePath.startsWith(".obsidian") || filePath.startsWith(".git")) return false;
		const root = this.plugin?.settings?.projectsRoot || "";
		if (!root) return true;
		const normalizedRoot = root.endsWith("/") ? root : root + "/";
		return filePath.startsWith(normalizedRoot);
	}

	async _getFileTasks(file) {
		const cache = this.plugin?.taskCache;
		const cached = cache?.get(file.path);
		if (cached) {
			return cached.parsedTasks.map(t => ({ ...t, file }));
		}
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		const result = [];
		for (let i = 0; i < lines.length; i++) {
			const parsed = parseTaskLine(lines[i], file, i);
			if (parsed) result.push(parsed);
		}
		if (cache) {
			const cacheable = result.map(t => {
				const { file: f, ...rest } = t;
				return rest;
			});
			cache.set(file.path, cacheable);
		}
		return result;
	}

	_priorityWeight(p) {
		const w = { "🟥": 5, "🟨": 3, "🟩": 1 };
		return w[p] || 0;
	}

	/* ─── loading ─── */

	async loadWeek() {
		const today = new Date().toISOString().split("T")[0];
		const mon = this._getMonday(today);
		const fri = this._getFriday(mon);

		this.weekStart = mon;
		this.weekEnd = fri;
		this.dayTasks = {};
		this.dayTotals = {};

		// Initialize each day
		const days = [];
		const d = new Date(mon + "T12:00:00");
		const end = new Date(fri + "T12:00:00");
		while (d <= end) {
			days.push(d.toISOString().split("T")[0]);
			d.setDate(d.getDate() + 1);
		}

		for (const dateStr of days) {
			this.dayTasks[dateStr] = [];
			this.dayTotals[dateStr] = 0;
		}

		// Scan vault for tasks matching this week
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!this._isFileInScope(file.path)) continue;
			const fileTasks = await this._getFileTasks(file);
			for (const parsed of fileTasks) {
				if (parsed.status === "x" || parsed.status === "-" || parsed.status === "X") continue;

				const { taskDate, rawText, time, status, priority, cleanText, bucket, durationMinutes } = parsed;

				if (!taskDate) continue;

				// Check if the task's date is within this week
				if (taskDate < mon || taskDate > fri) continue;

				// Detect if this is a routine-generated task (has 🔁 in text)
				const isRoutine = !!rawText.match(/🔁/);

				// Resolve project
				let project = null;
				if (this.projectEngine) {
					const pj = await this.projectEngine.resolve(file.path);
					project = pj?.name || null;
				}
				if (!project && rawText) {
					const pMatch = rawText.match(/@p:([^\s]+)/);
					if (pMatch) project = pMatch[1];
				}
				if (!project && rawText) {
					const tp = this.plugin?.settings?.tagPrefix || "project/";
					const tagMatch = rawText.match(new RegExp(tp + "([^\\s]+)"));
					if (tagMatch) project = tagMatch[1];
				}

				if (this.dayTasks[taskDate]) {
					this.dayTasks[taskDate].push({
						file,
						line: parsed.line,
						rawLine: parsed.rawLine,
						time,
						taskDate,
						durationMinutes: durationMinutes || 0,
						rawText,
						cleanText,
						status,
						priority,
						bucket,
						project,
						isRoutine,
					});
					this.dayTotals[taskDate] += durationMinutes || 0;
				}
			}
		}

		// Sort tasks in each day: priority → time
		for (const dateStr of days) {
			this.dayTasks[dateStr].sort((a, b) => {
				const pa = this._priorityWeight(a.priority);
				const pb = this._priorityWeight(b.priority);
				if (pa !== pb) return pb - pa;
				if (!a.time && !b.time) return 0;
				if (!a.time) return 1;
				if (!b.time) return -1;
				return a.time.localeCompare(b.time);
			});
		}
	}

	/* ─── rendering ─── */

	renderView() {
		this.containerEl.empty();

		const today = new Date().toISOString().split("T")[0];

		// ── Header bar ──
		const header = this.containerEl.createEl("div", { cls: "ft-wp-header" });

		// Week label
		const weekNum = this._getWeekNumber(this.weekStart);
		const headerTitle = header.createEl("div", { cls: "ft-wp-title" });
		headerTitle.createEl("span", {
			text: `📅 Week ${weekNum} — ${this._fmtDate(this.weekStart)} → ${this._fmtDate(this.weekEnd)}`,
			cls: "ft-wp-week-label",
		});

		// Toolbar buttons
		const toolbar = header.createEl("div", { cls: "ft-wp-toolbar" });

		const genBtn = toolbar.createEl("button", { text: "🔄 Regenerate Routines", cls: "ft-wp-btn" });
		genBtn.addEventListener("click", async () => {
			if (this.plugin?.routineEngine) {
				const count = await this.plugin.routineEngine.generateAllDue({ force: true });
				this.plugin.notify?.("🔁 Generated " + count + " routine task" + (count === 1 ? "" : "s"));
				await this.loadWeek();
				this.renderView();
			}
		});

		const vacBtn = toolbar.createEl("button", {
			text: this.plugin?.settings?.vacationMode ? "▶ Resume Routines" : "⏸ Vacation Mode",
			cls: "ft-wp-btn" + (this.plugin?.settings?.vacationMode ? " ft-wp-vacation-on" : ""),
		});
		vacBtn.addEventListener("click", async () => {
			if (this.plugin) {
				this.plugin.settings.vacationMode = !this.plugin.settings.vacationMode;
				await this.plugin.saveData(this.plugin.settings);
				this.renderView();
				this.plugin.notify?.(this.plugin.settings.vacationMode
					? "⏸ Routine generation paused"
					: "▶ Routine generation resumed");
			}
		});

		const addBtn = toolbar.createEl("button", { text: "➕ Add Task", cls: "ft-wp-btn ft-wp-btn-primary" });
		addBtn.addEventListener("click", () => {
			const { QuickEntryModal } = require("./quick-entry");
			const modal = new QuickEntryModal(this.app, this.plugin);
			modal.open();
		});

		// ── Vacation notice ──
		if (this.plugin?.settings?.vacationMode) {
			const notice = this.containerEl.createEl("div", { cls: "ft-wp-vacation-notice" });
			notice.createEl("span", { text: "⏸ Vacation mode is ON — routines are paused" });
		}

		// ── Daily sections ──
		let hasAnyTasks = false;
		const days = Object.keys(this.dayTasks).sort();

		for (const dateStr of days) {
			const tasks = this.dayTasks[dateStr];
			const totalMin = this.dayTotals[dateStr];
			const totalHours = totalMin / 60;

			if (tasks.length === 0) continue;
			hasAnyTasks = true;

			// Day section
			const section = this.containerEl.createEl("div", { cls: "ft-wp-day" });

			// Day header with budget bar
			const dayHeader = section.createEl("div", { cls: "ft-wp-day-header" });
			dayHeader.createEl("span", {
				text: this._fmtDate(dateStr),
				cls: "ft-wp-day-label" + (dateStr === today ? " ft-wp-today" : ""),
			});

			// Budget bar
			if (this.dailyCap > 0) {
				const bar = renderProgressBar(totalHours, this.dailyCap, `${formatHours(totalHours)}h / ${this.dailyCap}h`);
				bar.style.minWidth = "180px";
				bar.style.marginLeft = "12px";
				dayHeader.appendChild(bar);
			}

			// Task list for this day
			for (const task of tasks) {
				this._renderTaskRow(section, task, dateStr, today);
			}
		}

		if (!hasAnyTasks) {
			const empty = this.containerEl.createEl("div", { cls: "ft-wp-empty" });
			empty.createEl("p", { text: "📭 No tasks scheduled this week." });
			empty.createEl("p", {
				text: "Add tasks with dates in this week's range, or set up routines in your routines folder.",
				cls: "ft-wp-empty-hint",
			});
		}
	}

	_renderTaskRow(section, task, dateStr, today) {
		const row = section.createEl("div", { cls: "ft-wp-task" });
		if (task.status === "x" || task.status === "-") {
			row.addClass("ft-wp-task-done");
		}

		const { start, dur } = this._parseStored(task.time);

		// ── Time column ──
		const timeCol = row.createEl("div", { cls: "ft-wp-time" });

		const startId = "ft-wp-start-" + Math.random().toString(36).slice(2, 6);
		const si = timeCol.createEl("input", {
			type: "text",
			value: start || "",
			placeholder: "09:00",
			cls: "ft-wp-start-input",
			attr: { list: startId },
		});
		const startList = timeCol.createEl("datalist", { attr: { id: startId } });
		for (const t of this._timeOpts(START_H, START_END)) {
			startList.createEl("option", { attr: { value: t } });
		}

		const durId = "ft-wp-dur-" + Math.random().toString(36).slice(2, 6);
		const di = timeCol.createEl("input", {
			type: "text",
			value: dur ? formatDuration(dur) : "",
			placeholder: "30m",
			cls: "ft-wp-dur-input",
			attr: { list: durId },
		});
		const durList = timeCol.createEl("datalist", { attr: { id: durId } });
		for (const d of DUR_OPTS) {
			durList.createEl("option", { attr: { value: formatDuration(d) } });
		}

		// End preview
		const endPreview = timeCol.createEl("span", { text: "", cls: "ft-wp-end-preview" });
		const updateEnd = () => {
			const s = si.value;
			const d = this._parseDurStr(di.value);
			endPreview.setText(s && d > 0 ? "→" + this._calcEnd(s, d) : "");
		};
		const saveTime = (() => {
			let timer;
			return () => {
				clearTimeout(timer);
				timer = setTimeout(() => this._saveTaskTime(task, si, di, endPreview), 300);
			};
		})();
		si.addEventListener("input", () => { updateEnd(); saveTime(); });
		di.addEventListener("input", () => { updateEnd(); saveTime(); });
		updateEnd();

		// ── Checkbox ──
		const checkCol = row.createEl("div", { cls: "ft-wp-check" });
		const cb = checkCol.createEl("span", {
			cls: "ft-checkbox" + (task.status === "x" ? " ft-checked" : ""),
		});
		cb.addEventListener("click", async () => {
			try {
				await this._toggleCheck(task, cb);
				cb.toggleClass("ft-checked");
				row.toggleClass("ft-wp-task-done");
			} catch (e) {
				this.plugin?.notify?.("❌ " + e.message, true);
			}
		});

		// ── Task text ──
		const textCol = row.createEl("div", { cls: "ft-wp-text" });
		if (task.priority) {
			textCol.createEl("span", { text: task.priority, cls: "ft-wp-priority" });
		}
		if (task.isRoutine) {
			textCol.createEl("span", { text: "🔁", cls: "ft-wp-routine-badge" });
		}
		if (task.project) {
			textCol.createEl("span", { text: task.project, cls: "ft-wp-project" });
		}
		const textSpan = textCol.createEl("span", {
			text: task.cleanText,
			cls: "ft-wp-task-text",
		});

		// Source link
		if (task.file) {
			const srcLink = textCol.createEl("a", {
				text: "📎",
				cls: "ft-wp-source-link",
				attr: { title: task.file.basename + ":" + (task.line + 1) },
			});
			srcLink.addEventListener("click", () =>
				this.app.workspace.openLinkText(task.file.path, "", false, {
					line: task.line + 1,
				}),
			);
		}

		// ── Actions ──
		const actionsCol = row.createEl("div", { cls: "ft-wp-actions" });

		// Timer
		const timerBtn = actionsCol.createEl("button", {
			text: dur > 0 ? formatTimer(dur * 60) : "⏱",
			cls: "ft-wp-timer-btn",
		});
		// Timer state for inline countdown
		let timerState = null;
		timerBtn.addEventListener("click", () => {
			if (timerState && timerState.running) {
				// Stop
				clearInterval(timerState.interval);
				timerState.running = false;
				timerBtn.setText(dur > 0 ? formatTimer(timerState.remaining) : "⏱");
				return;
			}
			const totalSeconds = (dur || 0) * 60;
			if (totalSeconds <= 0) return;
			timerState = {
				remaining: totalSeconds,
				total: totalSeconds,
				running: true,
				interval: setInterval(() => {
					timerState.remaining -= 1;
					timerBtn.setText(formatTimer(Math.max(0, timerState.remaining)));
					if (timerState.remaining <= 0) {
						clearInterval(timerState.interval);
						timerState.running = false;
						this._beep();
						timerBtn.setText("⏱ Done");
					}
				}, 1000),
			};
		});

		// Delete button (removes from this day — for routines, marks in .generated.json)
		const delBtn = actionsCol.createEl("button", {
			text: "🗑️",
			cls: "ft-wp-del-btn",
			attr: { title: "Remove from this day" },
		});
		delBtn.addEventListener("click", async () => {
			await this._removeTask(task);
			row.remove();
			// Re-render to update totals
			await this.loadWeek();
			this.renderView();
		});

		// Store row reference
		row._taskData = { task, si, di, endPreview };
	}

	/* ─── task operations ─── */

	async _toggleCheck(task, cbEl) {
		if (!task.file) return;
		const content = await this.app.vault.read(task.file);
		const lines = content.split("\n");
		const line = lines[task.line];
		if (!line) return;

		const isChecked = line.match(/\[x\]/i);
		const newLine = isChecked
			? line.replace(/\[x\]/i, "[ ]")
			: line.replace(/\[ \]/, "[x]");

		lines[task.line] = newLine;
		await this.app.vault.modify(task.file, lines.join("\n"));
		task.status = isChecked ? " " : "x";
	}

	async _saveTaskTime(task, si, di, endPreview) {
		if (!task.file) return;
		const start = si.value.trim();
		const durMinutes = this._parseDurStr(di.value.trim());
		const end = start && durMinutes > 0 ? this._calcEnd(start, durMinutes) : "";

		let timeBlock = start;
		if (end) timeBlock += "—" + end;

		const content = await this.app.vault.read(task.file);
		const lines = content.split("\n");
		let line = lines[task.line];
		if (!line) return;

		// Replace existing time block or add one at the start of task text
		const hasTime = line.match(/^\s*[-*+]\s*\[[^\]]*\]\s*\d{1,2}:\d{2}/);
		if (hasTime && timeBlock) {
			line = line.replace(
				/^(\s*[-*+]\s*\[[^\]]*\]\s*)\d{1,2}:\d{2}(?:\s*[—\-–]\s*\d{1,2}:\d{2})?/,
				"$1" + timeBlock,
			);
		} else if (timeBlock) {
			line = line.replace(
				/^(\s*[-*+]\s*\[[^\]]*\]\s*)/,
				"$1" + timeBlock + " ",
			);
		} else {
			// Remove time block if both empty
			line = line.replace(
				/^(\s*[-*+]\s*\[[^\]]*\]\s*)\d{1,2}:\d{2}(?:\s*[—\-–]\s*\d{1,2}:\d{2})?\s*/,
				"$1",
			);
		}

		// Update duration directive if present
		if (durMinutes > 0) {
			const durStr = durMinutes < 60 ? durMinutes + "m" : (durMinutes / 60) + "h";
			if (line.match(/@\d+(?:\.\d+)?[hm]/)) {
				line = line.replace(/@\d+(?:\.\d+)?[hm]/, "@" + durStr);
			} else {
				line += " @" + durStr;
			}
		} else {
			line = line.replace(/@\d+(?:\.\d+)?[hm]\s*/, "");
		}

		lines[task.line] = line;
		await this.app.vault.modify(task.file, lines.join("\n"));
	}

	async _removeTask(task) {
		if (!task.file) return;

		// If it's a routine, mark in .generated.json so engine doesn't re-create
		if (task.isRoutine && this.plugin?.routineEngine) {
			const entries = await this.plugin.routineEngine.loadGenerated();
			// Remove the task line from the file
			await this._deleteTaskLine(task);
			// Also add a tombstone entry if the routine line hash matches
			// (the engine already checks .generated.json before creating, so
			//  if we just leave the existing entry, it won't re-create)
			// No need for tombstone — existing entry prevents re-creation
		} else {
			await this._deleteTaskLine(task);
		}
	}

	async _deleteTaskLine(task) {
		if (!task.file) return;
		const content = await this.app.vault.read(task.file);
		const lines = content.split("\n");
		if (lines[task.line] !== undefined) {
			lines[task.line] = ""; // Blank the line instead of removing (preserves line numbers for cache)
			await this.app.vault.modify(task.file, lines.join("\n"));
		}
	}

	_getWeekNumber(dateStr) {
		const d = new Date(dateStr + "T12:00:00");
		d.setHours(0, 0, 0, 0);
		d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
		const week1 = new Date(d.getFullYear(), 0, 4);
		return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
	}

	_beep() {
		if (this.plugin?.settings?.timerSound === false) return;
		try {
			for (const [freq, delay] of [[880, 0], [660, 0.2]]) {
				const ctx = new AudioContext(),
					o = ctx.createOscillator(),
					g = ctx.createGain();
				o.connect(g);
				g.connect(ctx.destination);
				o.frequency.value = freq;
				g.gain.setValueAtTime(0.3, ctx.currentTime + delay);
				g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + 0.6);
				o.start(ctx.currentTime + delay);
			}
		} catch (_) {}
	}
}

module.exports = { WeekplanRenderer };
