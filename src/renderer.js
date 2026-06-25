const { MarkdownRenderChild, Notice } = require("obsidian");
const {
	parseTaskLine,
	cleanTaskText,
	parseRecurrence,
	formatDuration,
	formatTimer,
	buildTaskTree, // v0.6.0
	flattenTree, // v0.6.0
	taskId, // v0.6.0
} = require("./task-parser");
const { renderProgressBar, formatHours } = require("./budget-state");
const { evaluateFilter } = require("./filter-engine");
const {
	DUR_OPTS,
	START_H,
	START_END,
	timeOpts,
	parseStored,
	calcEnd,
	getMonday,
	getSunday,
	priorityWeight,
	getFileTasks,
	toggleCheck,
	updateDate,
} = require("./task-utils");

const COLUMNS = [
	{ id: 'time',     label: 'Time',    sortField: 'time',    width: '22%',   compactOnly: false, compactSkip: true,  defaultHide: false },
	{ id: 'check',    label: '✓',       sortField: 'status',  width: '36px',  compactOnly: false, compactSkip: false, defaultHide: false },
	{ id: 'priority', label: '!',       sortField: 'priority',width: '28px',  compactOnly: false, compactSkip: false, defaultHide: true },
	{ id: 'soon',     label: '~',       sortField: 'soon',    width: '36px',  compactOnly: false, compactSkip: false, defaultHide: true },
	{ id: 'task',     label: 'Task',    sortField: 'text',    width: 'auto',  compactOnly: false, compactSkip: false, defaultHide: false },
	{ id: 'project',  label: 'Project', sortField: 'project', width: 'auto',  compactOnly: false, compactSkip: false, defaultHide: false },
	{ id: 'bucket',   label: 'Bucket',  sortField: 'bucket',  width: 'auto',  compactOnly: false, compactSkip: false, defaultHide: false },
	{ id: 'sprint',   label: 'Sprint',  sortField: 'sprint',  width: 'auto',  compactOnly: false, compactSkip: false, defaultHide: true },
	{ id: 'source',   label: 'Source',  sortField: 'source',  width: 'auto',  compactOnly: false, compactSkip: false, defaultHide: false },
	{ id: 'date',     label: 'Date',    sortField: 'date',    width: 'auto',  compactOnly: false, compactSkip: false, defaultHide: false },
	{ id: 'actions',  label: ' ',       sortField: null,      width: 'auto',  compactOnly: true,  compactSkip: false, defaultHide: false },
	{ id: 'timer',    label: ' ',       sortField: null,      width: '22%',   compactOnly: false, compactSkip: true,  defaultHide: false },
];

class FlowtimeRenderer extends MarkdownRenderChild {
	constructor(app, containerEl, mode, projectEngine, sourcePath) {
		super(containerEl);
		this.app = app;
		this.plugin = null;
		this.mode = mode || "today";
		this.projectEngine = projectEngine || null;
		this.sourcePath = sourcePath || null;
		this.tasks = [];
		this.rowData = [];
		this.startOpts = [];
		this._columnVisibility = null;
		this._activeFilter = null;
		this._sortConfig = [];
		this._sortMode = null;
		this._groupConfig = { primary: null, secondary: null };
		this._collapsed = new Set(); // v0.6.0: collapsed tree nodes by taskId
		this._displayItems = []; // v0.6.0: flattened tree display list
	}

	async onload() {
		// Add some spacing above the code block for breathing room
		this.containerEl.style.marginTop = "6px";
		try {
			await this.loadTasks();
			this.renderTable();
		} catch (e) {
			this.containerEl.createEl("p", {
				text: "⚠️ Error: " + e.message,
				cls: "flowtime-empty",
			});
			console.error("TP error:", e);
		}
	}

	/* ─── helpers ─── */
	_timeOpts(h1, h2) {
		return timeOpts(h1, h2);
	}
	_parseStored(t) {
		return parseStored(t);
	}
	_calcEnd(s, d) {
		return calcEnd(s, d);
	}
	_getMonday(d) {
		return getMonday(d);
	}
	_getSunday(d) {
		return getSunday(d);
	}
	_computeBucketTotals() {
		const totals = {};
		const ref = this._refDate();
		const mon = this._getMonday(ref);
		const sun = this._getSunday(ref);
		for (const task of this.tasks) {
			if (!task.bucket) continue;
			if (task.taskDate && task.taskDate >= mon && task.taskDate <= sun) {
				totals[task.bucket] =
					(totals[task.bucket] || 0) + (task.durationMinutes || 0);
			}
		}
		return totals;
	}

	/**
	 * v0.4.0: Check if a file path is within the plugin's scan scope.
	 * Respects projectsRoot setting — if set, only files under that root are scanned.
	 * Always excludes .obsidian/ and .git/
	 */
	_isFileInScope(filePath) {
		if (filePath.startsWith(".obsidian") || filePath.startsWith(".git"))
			return false;
		const root = this.plugin?.settings?.projectsRoot || "";
		if (!root) return true; // No root filter — scan everything
		// v0.6.0: Always include the inbox file even if outside projectsRoot
		const inboxPath = (this.plugin?.settings?.inboxPath || "Inbox.md").replace(
			/^\.\//,
			"",
		);
		if (filePath === inboxPath || filePath.endsWith("/" + inboxPath))
			return true;
		const normalizedRoot = root.endsWith("/") ? root : root + "/";
		return filePath.startsWith(normalizedRoot);
	}

	async _computeDailyTotal() {
		const today = this._refDate();
		let total = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!this._isFileInScope(file.path)) continue;
			const fileTasks = await this._getFileTasks(file);
			for (const parsed of fileTasks) {
				if (parsed.taskDate === today && parsed.durationMinutes) {
					total += parsed.durationMinutes;
				}
			}
		}
		return total / 60; // return hours
	}

	_beep() {
		if (this.plugin?.settings?.timerSound === false) return;
		try {
			for (const [freq, delay] of [
				[880, 0],
				[660, 0.2],
			]) {
				const ctx = new AudioContext(),
					o = ctx.createOscillator(),
					g = ctx.createGain();
				o.connect(g);
				g.connect(ctx.destination);
				o.frequency.value = freq;
				g.gain.setValueAtTime(0.3, ctx.currentTime + delay);
				g.gain.exponentialRampToValueAtTime(
					0.01,
					ctx.currentTime + delay + 0.6,
				);
				o.start(ctx.currentTime + delay);
			}
		} catch (_) {}
	}

	_priorityWeight(p) {
		return priorityWeight(p);
	}

	/** v0.4.0: Default sort = priority (desc) → time (asc) → date (asc) */
	_sort() {
		this.tasks.sort((a, b) => {
			const pa = priorityWeight(a.priority);
			const pb = priorityWeight(b.priority);
			if (pa !== pb) return pb - pa; // higher priority first
			if (!a.time && !b.time) return 0;
			if (!a.time) return 1;
			if (!b.time) return -1;
			const tc = a.time.localeCompare(b.time);
			if (tc !== 0) return tc;
			// Same time: sort by date (earliest first)
			const da = a.taskDate || "";
			const db = b.taskDate || "";
			return da.localeCompare(db);
		});
	}

	_applySort() {
		if (!this._sortConfig || this._sortConfig.length === 0) {
			this._sort();
			return;
		}
		this.tasks.sort((a, b) => {
			for (const sc of this._sortConfig) {
				const va = this._getSortValue(a, sc.field);
				const vb = this._getSortValue(b, sc.field);
				let cmp = 0;
				if (typeof va === "string" && typeof vb === "string") {
					cmp = va.localeCompare(vb);
				} else if (typeof va === "number" && typeof vb === "number") {
					cmp = va - vb;
				} else {
					cmp = String(va || "").localeCompare(String(vb || ""));
				}
				if (cmp !== 0) return sc.direction === "desc" ? -cmp : cmp;
			}
			return 0;
		});
	}

	_getSortValue(task, field) {
		switch (field) {
			case "time":
				return task.time || "";
			case "status":
				return task.status || "";
			case "text":
				return task.cleanText || "";
			case "project":
				return task.project || "";
			case "bucket":
				return task.bucket || "";
			case "sprint":
				return task.sprint || ""; // v0.6.0
			case "source":
				return task.file?.basename || "";
			case "date":
				return task.taskDate || "";
			case "priority":
				return priorityWeight(task.priority);
			case "soon":
				return task.isSoon ? 1 : 0;
			default:
				return "";
		}
	}

	/** v0.6.0: Resolve sprint ID to display name from settings */
	_sprintName(id) {
		if (!id) return "";
		const sprints = this.plugin?.settings?.sprints || [];
		const def = sprints.find((s) => s.id === id);
		return def?.name || id;
	}

	_getGroupValue(task, field) {
		switch (field) {
			case "bucket":
				return task.bucket || "Unassigned";
			case "project":
				return task.project || "Other";
			case "sprint":
				return this._sprintName(task.sprint) || "No sprint"; // v0.6.0
			case "date":
				return task.taskDate || "No date";
			case "status":
				return task.status?.trim() ? "Done" : "Open";
			default:
				return "Other";
		}
	}

	/**
	 * Format a YYYY-MM-DD date for human-readable display.
	 * Returns "today", "tomorrow", "yesterday", "Mon 24", etc.
	 */
	_fmtDate(dateStr) {
		if (!dateStr) return "";
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const d = new Date(dateStr + "T00:00:00");
		const diff = Math.round((d - today) / 86400000);
		if (diff === 0) return "Today";
		if (diff === 1) return "Tomorrow";
		if (diff === -1) return "Yesterday";
		// Within this week: show day name
		if (diff > -7 && diff < 7) {
			const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
			return days[d.getDay()] + " " + d.getDate();
		}
		// Otherwise show short date
		return `${d.getDate()}.${d.getMonth() + 1}.`;
	}

	_isCompactMode() {
		return (
			this.mode === "overdue" ||
			this.mode === "dueweek" ||
			this.mode === "weekly"
		);
	}

	/* Count how many columns are visible for current mode */
	_visibleColCount(isCompact) {
		const v = this._columnVisibility || {};
		let count = 0;
		for (const col of COLUMNS) {
			if (col.compactOnly && !isCompact) continue;
			if (col.compactSkip && isCompact) continue;
			if (v[col.id] === false) continue;
			if (col.defaultHide && !v[col.id]) continue;
			count++;
		}
		return count || 1;
	}

	/* ─── helpers ─── */
	async _getFileTasks(file) {
		return getFileTasks(file, this.app, this.plugin?.taskCache);
	}

	/* ─── load ─── */

	/**
	 * v0.4.0: Derive reference date from source file or fall back to today.
	 * If the source file is a daily note (e.g. Daily/2026-06-25.md),
	 * use that date as "today" so the view is relative to the file's date.
	 */
	_refDate() {
		if (this.sourcePath) {
			const dateMatch = this.sourcePath.match(/(\d{4}-\d{2}-\d{2})\.md$/);
			if (dateMatch) return dateMatch[1];
		}
		return new Date().toISOString().split("T")[0];
	}

	async loadTasks() {
		if (this.mode === "sessions") {
			this.tasks = [];
			return;
		}

		// v0.6.0: Sprints mode — collect all tasks with @sprint:id
		if (this.mode === "sprints") {
			this.tasks = [];
			for (const file of this.app.vault.getMarkdownFiles()) {
				if (!this._isFileInScope(file.path)) continue;
				const fileTasks = await this._getFileTasks(file);
				for (const parsed of fileTasks) {
					if (!parsed.sprint) continue;
					const project = this.projectEngine
						? await this.projectEngine.resolve(file.path)
						: null;
					let projName = project?.name || null;
					this.tasks.push({
						file,
						line: parsed.line,
						rawLine: parsed.rawLine,
						time: parsed.time,
						taskDate: parsed.taskDate,
						rawText: parsed.rawText,
						cleanText: parsed.cleanText,
						status: parsed.status,
						priority: parsed.priority,
						bucket: parsed.bucket,
						durationMinutes: parsed.durationMinutes,
						project: projName,
						isSoon: parsed.isSoon,
						sprint: parsed.sprint, // v0.6.0
						indent: parsed.indent, // v0.6.0
					});
				}
			}
			return;
		}

		const today = this._refDate();
		const refDt = new Date(today + "T00:00:00");
		const eow = new Date(refDt);
		eow.setDate(eow.getDate() + ((7 - eow.getDay()) % 7));
		const eowStr = eow.toISOString().split("T")[0];
		const mon = this._getMonday(today);
		const sun = this._getSunday(today);

		// Project mode: resolve source file's project first
		let targetProject = null;
		if (this.mode === "project") {
			if (this.sourcePath && this.projectEngine) {
				const sp = await this.projectEngine.resolve(this.sourcePath);
				targetProject = sp?.name || null;
			}
			if (!targetProject) {
				this.tasks = [];
				return;
			}
		}

		// Budget mode: compute weekly totals and build from bucket definitions
		if (this.mode === "budget") {
			this._budgetDailyCap = this.plugin?.settings?.dailyCap || 12;
			this._budgetDailyCapUsed = await this._computeDailyTotal();

			const weeklyTotals = {};
			for (const file of this.app.vault.getMarkdownFiles()) {
				if (!this._isFileInScope(file.path)) continue;
				const fileTasks = await this._getFileTasks(file);
				for (const parsed of fileTasks) {
					if (!parsed.bucket) continue;
					if (
						parsed.taskDate &&
						parsed.taskDate >= mon &&
						parsed.taskDate <= sun
					) {
						weeklyTotals[parsed.bucket] =
							(weeklyTotals[parsed.bucket] || 0) +
							(parsed.durationMinutes || 0);
					}
				}
			}

			this.tasks = [];
			const buckets = this.plugin?.settings?.buckets || [];
			for (const b of buckets) {
				const usedMinutes = weeklyTotals[b.id] || 0;
				this.tasks.push({
					file: null,
					line: 0,
					rawLine: "",
					time: "",
					taskDate: "",
					durationMinutes: usedMinutes,
					rawText: "",
					cleanText: b.name,
					status: " ",
					priority: null,
					bucket: b.id,
					project: null,
					_bucketDef: b,
				});
			}
			return;
		}

		// v0.4.0: "soon" mode — show all @soon tasks
		if (this.mode === "soon") {
			this.tasks = [];
			for (const file of this.app.vault.getMarkdownFiles()) {
				if (!this._isFileInScope(file.path)) continue;
				const fileTasks = await this._getFileTasks(file);
				for (const parsed of fileTasks) {
					if (
						parsed.status === "x" ||
						parsed.status === "-" ||
						parsed.status === "X"
					)
						continue;
					// v0.6.0: "soon" mode shows @soon tasks AND tasks with future dates (> today)
					if (!(parsed.isSoon || (parsed.taskDate && parsed.taskDate > today)))
						continue;
					const {
						taskDate,
						rawText,
						time,
						status,
						priority,
						cleanText,
						bucket,
						durationMinutes,
						projectTag,
					} = parsed;
					const project = this.projectEngine
						? await this.projectEngine.resolve(file.path)
						: null;
					let projName = project?.name || null;
					const projPath = project?.path || null;
					let projSource = project?.source || null;
					if (!projName && this.projectEngine) {
						if (projectTag) {
							projName = projectTag;
							projSource = "tag";
						}
						if (!projName && rawText) {
							const tp = this.plugin?.settings?.tagPrefix || "project/";
							const tj = this.projectEngine.resolveFromTag(rawText, tp);
							if (tj) {
								projName = tj;
								projSource = "tag";
							}
						}
					}
					this.tasks.push({
						file,
						line: parsed.line,
						rawLine: parsed.rawLine,
						time,
						taskDate,
						rawText,
						cleanText,
						status,
						priority,
						bucket,
						durationMinutes,
						project: projName,
						projectPath: projPath,
						projectSource: projSource,
						isSoon: true,
						sprint: parsed.sprint,
						indent: parsed.indent, // v0.6.0
					});
				}
			}
			if (this._activeFilter)
				this.tasks = this.tasks.filter((t) =>
					evaluateFilter(this._activeFilter, t),
				);
			if (this._sortConfig?.length > 0) this._applySort();
			else this._sort();
			return;
		}

		this.tasks = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!this._isFileInScope(file.path)) continue;
			const fileTasks = await this._getFileTasks(file);
			for (const parsed of fileTasks) {
				if (
					parsed.status === "x" ||
					parsed.status === "-" ||
					parsed.status === "X"
				)
					continue;

				const {
					taskDate,
					rawText,
					time,
					status,
					priority,
					cleanText,
					bucket,
					durationMinutes,
					projectTag,
					isSoon,
				} = parsed;

				// v0.4.0: @soon tasks appear in today + overdue views even without dates
				const isSoonTask = isSoon && !taskDate;

				if (this.mode === "today") {
					if (taskDate !== today && !isSoonTask) continue;
				}
				if (this.mode === "overdue") {
					if ((!taskDate || taskDate >= today) && !isSoonTask) continue;
				}
				if (this.mode === "dueweek") {
					if (!taskDate || taskDate < today || taskDate > eowStr) continue;
				}
				if (this.mode === "weekly") {
					if (!taskDate || taskDate < mon || taskDate > sun) continue;
				}

				const project = this.projectEngine
					? await this.projectEngine.resolve(file.path)
					: null;

				// Fallback: check task text for #project/xxx tag or @p:Name
				let projName = project?.name || null;
				const projPath = project?.path || null;
				let projSource = project?.source || null;
				if (!projName && this.projectEngine) {
					// @p:Name syntax (v0.4.0+)
					if (projectTag) {
						projName = projectTag;
						projSource = "tag";
					}
				}

				// Project mode: skip tasks not matching target project
				if (this.mode === "project") {
					if (projName !== targetProject) continue;
				}

				this.tasks.push({
					file,
					line: parsed.line,
					rawLine: parsed.rawLine,
					time,
					taskDate,
					rawText,
					cleanText,
					status,
					priority,
					bucket,
					durationMinutes,
					project: projName,
					projectPath: projPath,
					projectSource: projSource,
					isSoon: isSoonTask, // v0.4.0: @soon tag
					sprint: parsed.sprint, // v0.6.0: @sprint:id
					indent: parsed.indent, // v0.6.0
				});
			}
		}

		// Apply active filter
		if (this._activeFilter) {
			this.tasks = this.tasks.filter((t) =>
				evaluateFilter(this._activeFilter, t),
			);
		}

		// Default grouping for weekly mode when no custom group set
		if (
			this.mode === "weekly" &&
			this._groupConfig &&
			!this._groupConfig.primary
		) {
			this._groupConfig = { primary: "project", secondary: null };
		}

		// Apply sort
		if (this._sortConfig && this._sortConfig.length > 0) {
			this._applySort();
		} else if (this.mode === "weekly") {
			this.tasks.sort((a, b) => {
				const pa = a.project || "";
				const pb = b.project || "";
				if (pa !== pb) return pa.localeCompare(pb);
				const da = a.taskDate || "";
				const db = b.taskDate || "";
				return da.localeCompare(db);
			});
		} else {
			this._sort();
		}

		// Trigger cache persistence after first load
		this.plugin?._scheduleCacheSave?.();
	}

	/* ─── render ─── */
	renderTable() {
		this.containerEl.empty();
		this.rowData = [];

		// Initialize column visibility defaults
		if (!this._columnVisibility) {
			this._columnVisibility = {
				check: true,
				task: true,
				priority: false, // v0.4.0: priority emoji column, hidden by default
				soon: false, // v0.4.0: @soon badge column, hidden by default
				project: false,
				bucket: false,
				source: false,
				date: true,
				actions: true,
				time: true,
				timer: true,
			};
		}
		// Today mode: hide date and actions (not needed when scheduling)
		if (this.mode === "today") {
			this._columnVisibility.date = false;
			this._columnVisibility.actions = false;
		}
		if (this.mode === "sessions") {
			this._renderSessionHistory();
			return;
		}
		if (this.mode === "budget") {
			this._renderBudgetView();
			return;
		}
		if (this.mode === "sprints") {
			this._renderSprintOverview();
			return;
		}
		if (this.tasks.length === 0) {
			const msgs = {
				overdue: "🎉 No overdue tasks!",
				dueweek: "🎉 No tasks due this week!",
				weekly: "🎉 No tasks scheduled this week!",
				soon: "📭 No tasks tagged with @soon. Add @soon to backlog items.",
				project: "📭 No tasks for this project.",
				today: "📭 No tasks scheduled for today.",
			};
			const emptyEl = this.containerEl.createEl("div", {
				cls: "ft-empty-state",
			});
			emptyEl.createEl("p", {
				text: msgs[this.mode] || msgs.today,
				cls: "flowtime-empty ft-empty-text",
			});

			const btnRow = emptyEl.createEl("div", { cls: "ft-empty-actions" });
			const addBtn = btnRow.createEl("button", {
				text: "➕ Add a task",
				cls: "ft-empty-btn",
			});
			addBtn.addEventListener("click", () => {
				const { QuickEntryModal } = require("./quick-entry");
				new QuickEntryModal(this.app, this.plugin).open();
			});
			return;
		}
		this.startOpts = this._timeOpts(START_H, START_END);
		const od = this.mode === "overdue",
			dw = this.mode === "dueweek",
			wk = this.mode === "weekly",
			pj = this.mode === "project";
		const isCompact = od || dw || wk;

		// Heading + toolbar on same row
		const headings = {
			today: "💡 Times and durations auto-save to source files",
			overdue: "📋 Tasks past their scheduled date — reassign or backlog",
			dueweek: "⚠️ Tasks due this week — schedule or defer",
			weekly: "📊 This week's tasks grouped by project",
			soon: "◌ Up next — @soon backlog items surfaced for attention",
			project: "📁 Tasks for this project",
		};
		const heading = headings[this.mode];
		const tdy = this._refDate();

		const bar = this.containerEl.createEl("div", { cls: "ft-topbar" });
		if (heading) {
			bar.createEl("div", { text: heading, cls: "ft-heading-row" });
		}
		const toolbar = bar.createEl("div", { cls: "ft-toolbar-row" });

		if (isCompact) {
			const mkBtn = (text, cls, fn) => {
				const b = toolbar.createEl("button", { text, cls });
				b.addEventListener("click", fn);
				return b;
			};
			mkBtn("📅 Assign All to Today", "ft-bulk-btn", async () => {
				for (const t of this.tasks) await this.updateDate(t, tdy);
				await this._refreshSiblings();
				this.tasks = [];
				this.renderTable();
				this.plugin?.notify?.("✅ All assigned to today");
			});
			if (od) {
				mkBtn("🗑 Backlog All", "ft-bulk-btn ft-bulk-remove", async () => {
					for (const t of this.tasks) await this.updateDate(t, "");
					await this._refreshSiblings();
					this.tasks = [];
					this.renderTable();
					this.plugin?.notify?.("🗑 All sent to backlog");
				});
			}
		}

		// ── Column visibility toggle ──
		const colBtn = toolbar.createEl("button", {
			text: "☰ Columns",
			cls: "ft-col-btn",
		});
		const colDD = document.createElement("div");
		colDD.className = "ft-col-dd";

		const colDefs = [
			{ id: "time", label: "Time" },
			{ id: "check", label: "✓" },
			{ id: "priority", label: "Prio" },
			{ id: "soon", label: "Soon" },
			{ id: "task", label: "Task" },
			{ id: "project", label: "Project" },
			{ id: "bucket", label: "Bucket" },
			{ id: "sprint", label: "Sprint" }, // v0.6.0
			{ id: "source", label: "Source" },
			{ id: "date", label: "Date" },
			{ id: "actions", label: "Actions" },
			{ id: "timer", label: "⏱" },
		];

		for (const def of colDefs) {
			if (isCompact && (def.id === "time" || def.id === "timer")) continue;
			if (!isCompact && def.id === "actions") continue;

			const item = colDD.createEl("label", { cls: "ft-col-dd-item" });
			const cb = item.createEl("input", { type: "checkbox" });
			cb.checked = this._columnVisibility[def.id] !== false;
			item.createEl("span", { text: " " + def.label });

			cb.addEventListener("change", () => {
				this._columnVisibility[def.id] = cb.checked;
				this.renderTable();
			});
		}

		const toggleDD = () => {
			const r = colBtn.getBoundingClientRect();
			colDD.style.left = r.left + "px";
			colDD.style.top = r.bottom + 4 + "px";
			colDD.classList.toggle("ft-col-dd-open");
			document.body.appendChild(colDD);
		};
		colBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			toggleDD();
		});
		const closeDD = (e) => {
			if (!colDD.contains(e.target) && e.target !== colBtn) {
				colDD.classList.remove("ft-col-dd-open");
				if (colDD.parentNode) colDD.parentNode.removeChild(colDD);
			}
		};
		document.addEventListener("click", closeDD, true);

		// ── Filter button ──
		const filterBtn = toolbar.createEl("button", {
			text: "🔍 Filter",
			cls: "ft-filter-btn",
		});
		if (this._activeFilter) {
			filterBtn.addClass("ft-filter-active-btn");
		} else {
			filterBtn.removeClass("ft-filter-active-btn");
		}
		const filterPanel = document.createElement("div");
		filterPanel.className = "ft-filter-panel";

		const buildFilterUI = () => {
			filterPanel.empty();

			// Filter row: field selector + op selector + value input + apply/clear
			const row = filterPanel.createEl("div", { cls: "ft-filter-row" });

			const fieldSel = row.createEl("select", { cls: "ft-filter-field" });
			const fieldOpts = [
				{ id: "bucket", label: "Bucket" },
				{ id: "project", label: "Project" },
				{ id: "sprint", label: "Sprint" }, // v0.6.0
				{ id: "date", label: "Date" },
				{ id: "text", label: "Task Text" },
				{ id: "duration", label: "Duration" },
				{ id: "status", label: "Status" },
				{ id: "priority", label: "Priority" },
			];
			for (const f of fieldOpts) {
				fieldSel.createEl("option", { text: f.label, value: f.id });
			}

			const opSel = row.createEl("select", { cls: "ft-filter-op" });
			const opOpts = [
				{ id: "eq", label: "is" },
				{ id: "neq", label: "is not" },
				{ id: "contains", label: "contains" },
				{ id: "gt", label: ">" },
				{ id: "gte", label: "≥" },
				{ id: "lt", label: "<" },
				{ id: "lte", label: "≤" },
				{ id: "exists", label: "exists" },
				{ id: "not_exists", label: "does not exist" },
			];
			for (const o of opOpts) {
				opSel.createEl("option", { text: o.label, value: o.id });
			}

			const valInput = row.createEl("input", {
				type: "text",
				placeholder: "Value",
				cls: "ft-filter-val",
			});

			const applyBtn = row.createEl("button", {
				text: "Apply",
				cls: "ft-filter-apply",
			});
			const clearBtn = row.createEl("button", {
				text: "✕ Clear",
				cls: "ft-filter-clear",
			});

			// Show active filter indicator
			if (this._activeFilter) {
				filterPanel.createEl("div", {
					text: "Active filter: " + JSON.stringify(this._activeFilter),
					cls: "ft-filter-active",
				});
			}

			applyBtn.addEventListener("click", async () => {
				const field = fieldSel.value;
				const op = opSel.value;
				const val = valInput.value.trim();

				if (op === "exists" || op === "not_exists") {
					this._activeFilter = { field, op };
				} else if (val) {
					// Parse number if numeric field
					const numericFields = ["duration"];
					const parsedVal = numericFields.includes(field)
						? isNaN(Number(val))
							? val
							: Number(val)
						: val;
					this._activeFilter = {
						field,
						op,
						value: op === "contains" ? val : parsedVal,
					};
				} else {
					return; // No value, no filter
				}

				await this.loadTasks(); // Re-load tasks (re-applies filter from scratch)
				this.renderTable();
				closePanel();
			});

			clearBtn.addEventListener("click", async () => {
				this._activeFilter = null;
				await this.loadTasks();
				this.renderTable();
				closePanel();
			});
		};

		const toggleFilterPanel = () => {
			if (filterPanel.classList.contains("ft-filter-open")) {
				closePanel();
			} else {
				const r = filterBtn.getBoundingClientRect();
				filterPanel.style.left = r.left + "px";
				filterPanel.style.top = r.bottom + 4 + "px";
				buildFilterUI();
				filterPanel.classList.add("ft-filter-open");
				document.body.appendChild(filterPanel);
			}
		};

		const closePanel = () => {
			filterPanel.classList.remove("ft-filter-open");
			if (filterPanel.parentNode)
				filterPanel.parentNode.removeChild(filterPanel);
		};

		const closeFilterPanelOnOutside = (e) => {
			if (!filterPanel.contains(e.target) && e.target !== filterBtn) {
				closePanel();
			}
		};
		document.addEventListener("click", closeFilterPanelOnOutside, true);

		filterBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			toggleFilterPanel();
		});

		// ── Group By dropdowns ──
		if (!this._groupConfig)
			this._groupConfig = { primary: null, secondary: null };

		const groupLabel = toolbar.createEl("span", {
			text: "Group:",
			cls: "ft-group-label",
		});

		const groupSel = toolbar.createEl("select", { cls: "ft-group-select" });
		groupSel.createEl("option", { text: "None", value: "" });
		groupSel.createEl("option", { text: "Bucket", value: "bucket" });
		groupSel.createEl("option", { text: "Project", value: "project" });
		groupSel.createEl("option", { text: "Sprint", value: "sprint" }); // v0.6.0
		groupSel.createEl("option", { text: "Date", value: "date" });
		groupSel.createEl("option", { text: "Status", value: "status" });
		if (this._groupConfig.primary) groupSel.value = this._groupConfig.primary;

		const subLabel = toolbar.createEl("span", {
			text: "then:",
			cls: "ft-group-label",
		});
		const subSel = toolbar.createEl("select", { cls: "ft-group-select" });
		subSel.createEl("option", { text: "None", value: "" });
		subSel.createEl("option", { text: "Bucket", value: "bucket" });
		subSel.createEl("option", { text: "Project", value: "project" });
		subSel.createEl("option", { text: "Sprint", value: "sprint" }); // v0.6.0
		subSel.createEl("option", { text: "Date", value: "date" });
		subSel.createEl("option", { text: "Status", value: "status" });
		if (this._groupConfig.secondary) subSel.value = this._groupConfig.secondary;

		const applyGroup = () => {
			this._groupConfig.primary = groupSel.value || null;
			this._groupConfig.secondary = subSel.value || null;
			this.renderTable();
		};

		groupSel.addEventListener("change", applyGroup);
		subSel.addEventListener("change", applyGroup);

		// v0.6.0: Tree expand/collapse tooltip
		if (this._displayItems.length > 0 || this.tasks.length > 0) {
			const treeSep = toolbar.createEl("span", {
				text: "|",
				cls: "ft-group-label",
			});
			const expandBtn = toolbar.createEl("button", {
				text: "◀ Expand",
				cls: "ft-filter-btn",
			});
			expandBtn.addEventListener("click", () => {
				this._collapsed.clear();
				this.renderTable();
			});
			const collapseBtn = toolbar.createEl("button", {
				text: "▶ Collapse",
				cls: "ft-filter-btn",
			});
			collapseBtn.addEventListener("click", () => {
				// Collapse all items with children
				for (const item of this._displayItems) {
					if (item.hasChildren) this._collapsed.add(item.taskId);
				}
				this.renderTable();
			});
		}

		// ── Save/Load View (placeholder — needs Modal, prompt() unavailable in Obsidian) ──
		// To be re-implemented with Obsidian Modal API in future release

		const tableWrap = this.containerEl.createEl("div", {
			cls: "ft-table-wrap",
		});
		const table = tableWrap.createEl("table", {
			cls: "flowtime-table ft-table",
		});
		const hr = table.createEl("thead").createEl("tr");

		const sortByColumn = (field) => (e) => {
			if (e.shiftKey) {
				const existing = this._sortConfig.findIndex((s) => s.field === field);
				if (existing >= 0) {
					this._sortConfig.splice(existing, 1);
				} else {
					this._sortConfig.push({ field, direction: "asc" });
				}
			} else {
				if (
					this._sortConfig.length === 1 &&
					this._sortConfig[0].field === field
				) {
					this._sortConfig[0].direction =
						this._sortConfig[0].direction === "asc" ? "desc" : "asc";
				} else {
					this._sortConfig = [{ field, direction: "asc" }];
				}
			}
			this._sortMode = "custom";
			this.loadTasks().then(() => {
				this.renderTable();
			});
		};

		const sortIndicator = (field) => {
			const s = this._sortConfig.find((s) => s.field === field);
			if (!s) return "";
			return s.direction === "asc" ? "▲" : "▼";
		};

		const makeSortableHeader = (label, field, cls, width) => {
			const th = hr.createEl("th", { cls });
			th.classList.add("ft-sortable");
			if (width) th.style.width = width;
			th.createEl("span", { text: label });
			if (field) {
				th.createEl("span", {
					cls: "ft-sort-indicator",
					text: sortIndicator(field),
				});
				th.addEventListener("click", sortByColumn(field));
			}
			return th;
		};

		const makeHeader = (cls, width) => {
			const th = hr.createEl("th", { cls });
			if (width) th.style.width = width;
			return th;
		};

		for (const col of COLUMNS) {
			// Skip compact-only columns in non-compact mode
			if (col.compactOnly && !isCompact) continue;
			// Skip compact-skip columns in compact mode
			if (col.compactSkip && isCompact) continue;
			// Check visibility
			if (this._columnVisibility[col.id] === false) continue;
			// Handle default-hidden columns (priority, soon, sprint)
			if (col.defaultHide && !this._columnVisibility[col.id]) continue;

			// Dynamic label for date column in due-week mode
			const label = (col.id === 'date' && dw) ? 'Due' : col.label;

			if (col.sortField) {
				makeSortableHeader(label, col.sortField, `col-${col.id}`, col.width);
			} else {
				makeHeader(`col-${col.id}`, col.width);
			}
		}
		const tbody = table.createEl("tbody");
		this.bucketTotals = this._computeBucketTotals();
		this.buildRows(tbody);

		// Daily cap summary (today mode only)
		if (this.mode === "today" && this.plugin?.settings?.dailyCap > 0) {
			const dailyCap = this.plugin.settings.dailyCap;
			const refTdy = this._refDate();
			const totalToday =
				this.tasks.reduce((sum, t) => {
					if (t.taskDate === refTdy) {
						return sum + (t.durationMinutes || 0);
					}
					return sum;
				}, 0) / 60;
			const capRow = this.containerEl.createEl("div", { cls: "ft-daily-cap" });
			capRow.createEl("span", { text: "Daily Budget: ", cls: "ft-cap-label" });
			const bar = renderProgressBar(
				totalToday,
				dailyCap,
				`${formatHours(totalToday)}h / ${dailyCap}h`,
			);
			bar.style.minWidth = "200px";
			capRow.appendChild(bar);
		}
	}

	_renderBudgetView() {
		this.containerEl.empty();

		// Title
		this.containerEl.createEl("h3", {
			text: "Budget Overview",
			cls: "ft-budget-title",
		});

		// Daily cap summary
		if (this._budgetDailyCap > 0) {
			const capSection = this.containerEl.createEl("div", {
				cls: "ft-budget-section",
			});
			capSection.createEl("div", {
				text: "Daily Budget",
				cls: "ft-budget-section-title",
			});
			const capRow = capSection.createEl("div", { cls: "ft-budget-row" });
			const bar = renderProgressBar(
				this._budgetDailyCapUsed,
				this._budgetDailyCap,
				`${formatHours(this._budgetDailyCapUsed)}h / ${this._budgetDailyCap}h`,
			);
			bar.style.minWidth = "250px";
			capRow.appendChild(bar);
		}

		// Bucket budget summary
		const section = this.containerEl.createEl("div", {
			cls: "ft-budget-section",
		});
		section.createEl("div", {
			text: "Weekly Bucket Budgets",
			cls: "ft-budget-section-title",
		});

		// Sort buckets by sortOrder
		const sorted = [...this.tasks].sort(
			(a, b) => (a._bucketDef?.sortOrder || 0) - (b._bucketDef?.sortOrder || 0),
		);

		for (const task of sorted) {
			const def = task._bucketDef;
			if (!def) continue;

			const row = section.createEl("div", { cls: "ft-budget-row" });

			// Color swatch + name
			const info = row.createEl("div", { cls: "ft-budget-info" });
			const swatch = info.createEl("span", { cls: "ft-bucket-swatch" });
			swatch.style.backgroundColor = def.color;
			info.createEl("span", { text: def.name, cls: "ft-budget-name" });

			// Progress bar
			const usedHours = task.durationMinutes / 60;
			const bar = renderProgressBar(
				usedHours,
				def.weeklyLimit,
				`${formatHours(usedHours)}h / ${def.weeklyLimit}h`,
			);
			bar.style.minWidth = "200px";
			row.appendChild(bar);
		}

		// Empty state
		if (sorted.length === 0) {
			section.createEl("p", {
				text: "No buckets configured. Add buckets in Settings.",
				cls: "ft-budget-empty",
			});
		}
	}

	/**
	 * v0.6.0: Render sprint overview — cards per sprint with progress.
	 */
	_renderSprintOverview() {
		this.containerEl.empty();

		const sprints = this.plugin?.settings?.sprints || [];
		if (sprints.length === 0) {
			this.containerEl.createEl("p", {
				text: "No sprints configured. Add sprints in Settings.",
				cls: "ft-budget-empty",
			});
			return;
		}

		// Collect all tasks grouped by sprint
		const sprintTasks = {};
		for (const task of this.tasks) {
			if (task.sprint) {
				if (!sprintTasks[task.sprint]) sprintTasks[task.sprint] = [];
				sprintTasks[task.sprint].push(task);
			}
		}

		for (const def of sprints) {
			const tasks = sprintTasks[def.id] || [];

			// Sprint card header
			const card = this.containerEl.createEl("div", {
				cls: "ft-budget-section",
			});

			const header = card.createEl("div", {
				cls: "ft-budget-section-title ft-sprint-card-header",
			});
			const nameEl = header.createEl("span", {
				text: def.name,
				cls: "ft-sprint-name",
			});
			if (def.color) {
				nameEl.style.borderLeft = "3px solid " + def.color;
				nameEl.style.paddingLeft = "8px";
			}

			// Goal & dates
			if (def.goal) {
				card.createEl("div", {
					text: def.goal,
					cls: "ft-sprint-goal",
				});
			}
			if (def.start || def.end) {
				card.createEl("div", {
					text: `${def.start || "?"} → ${def.end || "?"}`,
					cls: "ft-sprint-dates",
				});
			}

			// Progress bars
			if (tasks.length > 0) {
				const done = tasks.filter(
					(t) => t.status === "x" || t.status === "X",
				).length;
				const total = tasks.length;

				// Task progress
				const taskRow = card.createEl("div", { cls: "ft-budget-row" });
				taskRow.createEl("span", {
					text: `Tasks: ${done}/${total}`,
					cls: "ft-sprint-stat",
				});
				const taskBar = renderProgressBar(
					done,
					total,
					`${Math.round((done / total) * 100)}%`,
				);
				taskBar.style.minWidth = "200px";
				taskRow.appendChild(taskBar);

				// Time progress
				const totalMinutes = tasks.reduce(
					(sum, t) => sum + (t.durationMinutes || 0),
					0,
				);
				const doneMinutes = tasks
					.filter((t) => t.status === "x" || t.status === "X")
					.reduce((sum, t) => sum + (t.durationMinutes || 0), 0);

				if (totalMinutes > 0) {
					const timeRow = card.createEl("div", { cls: "ft-budget-row" });
					timeRow.createEl("span", {
						text: `Time: ${formatHours(doneMinutes / 60)}h / ${formatHours(totalMinutes / 60)}h`,
						cls: "ft-sprint-stat",
					});
					const timeBar = renderProgressBar(
						doneMinutes,
						totalMinutes,
						`${Math.round((doneMinutes / totalMinutes) * 100)}%`,
					);
					timeBar.style.minWidth = "200px";
					timeRow.appendChild(timeBar);
				}
			} else {
				card.createEl("p", {
					text: "No tasks tagged with @sprint:" + def.id,
					cls: "ft-sprint-empty",
				});
			}
		}
	}

	buildRows(tbody) {
		tbody.empty();
		this.rowData = [];
		this._resyncDone = false;
		document
			.querySelectorAll(".ft-date-popup,.ft-detail-popup")
			.forEach((e) => e.remove());
		// Remove stale outside-click handler
		if (this._closePopups) {
			document.removeEventListener("click", this._closePopups, true);
			this._closePopups = null;
		}
		const tdy = this._refDate();
		const od = this.mode === "overdue",
			_dw = this.mode === "dueweek",
			wk = this.mode === "weekly",
			pj = this.mode === "project";
		const isCompact = od || _dw || wk;

		const { primary, secondary } = this._groupConfig || {};

		if (primary) {
			// Build groups
			const groups = {};
			for (const task of this.tasks) {
				const key = this._getGroupValue(task, primary);
				const subKey = secondary
					? this._getGroupValue(task, secondary)
					: "__all__";
				if (!groups[key]) groups[key] = {};
				if (!groups[key][subKey]) groups[key][subKey] = [];
				groups[key][subKey].push(task);
			}

			const keys = Object.keys(groups).sort();
			for (const key of keys) {
				// Primary group header
				const gr = tbody.createEl("tr", { cls: "ft-project-group" });
				gr.createEl("td", {
					text: key || "Other",
					attr: { colspan: String(this._visibleColCount(isCompact)) },
				});

				const subGroups = groups[key];
				const subKeys = Object.keys(subGroups).sort();
				for (const subKey of subKeys) {
					if (secondary) {
						// Secondary group header
						const sr = tbody.createEl("tr", { cls: "ft-subgroup-header" });
						sr.createEl("td", {
							text: "  " + (subKey || "Other"),
							attr: { colspan: String(this._visibleColCount(isCompact)) },
						});
					}
					const groupItems = this._buildDisplayTree(subGroups[subKey]);
					for (const item of groupItems) {
						this._renderTaskRow(tbody, item, tdy, od, _dw, wk, pj, isCompact);
					}
				}
			}
		} else {
			// Standard flat rendering — separate @soon tasks
			const normalTasks = this.tasks.filter((t) => !t.isSoon);
			const soonTasks = this.tasks.filter((t) => t.isSoon);

			// v0.6.0: Build display tree for normal tasks
			this._displayItems = this._buildDisplayTree(normalTasks);
			for (const item of this._displayItems) {
				this._renderTaskRow(tbody, item, tdy, od, _dw, wk, pj, isCompact);
			}

			// v0.4.0: "Coming Soon" section for @soon tasks
			if (soonTasks.length > 0) {
				const gr = tbody.createEl("tr", { cls: "ft-project-group" });
				gr.createEl("td", {
					text: "◌ Up Next  (" + soonTasks.length + " tasks)",
					attr: { colspan: String(this._visibleColCount(isCompact)) },
				});
				const soonItems = this._buildDisplayTree(soonTasks);
				for (const item of soonItems) {
					this._renderTaskRow(tbody, item, tdy, od, _dw, wk, pj, isCompact);
				}
			}
		}
	}

	/**
	 * v0.6.0: Build flattened display tree from a task array.
	 * Groups by file, builds per-file trees, then flattens respecting _collapsed set.
	 */
	_buildDisplayTree(tasks) {
		if (!tasks || tasks.length === 0) return [];
		// Group by file path to build per-file trees
		const byFile = {};
		for (const task of tasks) {
			const key = task.file?.path || "_orphan";
			if (!byFile[key]) byFile[key] = [];
			byFile[key].push(task);
		}
		const allRoots = [];
		for (const fileTasks of Object.values(byFile)) {
			const roots = buildTaskTree(fileTasks);
			allRoots.push(...roots);
		}
		return flattenTree(allRoots, this._collapsed);
	}

	/* Single row builder for all modes — accepts task or tree item */
	_renderTaskRow(tbody, item, tdy, od, _dw, wk, pj, isCompact) {
		// Support both tree items { task, depth, ... } and raw task objects
		const task = item.task || item;
		const depth = item.depth !== undefined ? item.depth : 0;
		const hasChildren = !!item.hasChildren;
		const collapsed = !!item.collapsed;
		const tid = item.taskId || "";
		const { start, dur } = this._parseStored(task.time);
		const row = tbody.createEl("tr");
		let si, ds; // startInput, durationSelect

		if (!isCompact) {
			if (this._columnVisibility.time !== false) {
				const tc = row.createEl("td");

				// Container: inputs side by side
				const timeRow = tc.createEl("div", { cls: "ft-time-row" });

				// Start time combobox (text input + datalist)
				const startId =
					"ft-time-list-" +
					(this.rowData.length || 0) +
					Math.random().toString(36).slice(2, 6);
				const startGroup = timeRow.createEl("div", { cls: "ft-time-group" });
				si = startGroup.createEl("input", {
					type: "text",
					value: start || "",
					placeholder: "09:00",
					cls: "ft-start-input",
					attr: { list: startId },
				});
				const startList = startGroup.createEl("datalist", {
					attr: { id: startId },
				});
				for (const t of this.startOpts) {
					startList.createEl("option", { attr: { value: t } });
				}

				// Duration combobox (text input + datalist)
				const durId =
					"ft-dur-list-" +
					(this.rowData.length || 0) +
					Math.random().toString(36).slice(2, 6);
				const durGroup = timeRow.createEl("div", { cls: "ft-time-group" });
				ds = durGroup.createEl("input", {
					type: "text",
					value: dur ? formatDuration(dur) : "",
					placeholder: "30m",
					cls: "ft-dur-input",
					attr: { list: durId },
				});
				const durList = durGroup.createEl("datalist", { attr: { id: durId } });
				for (const d of DUR_OPTS) {
					durList.createEl("option", { attr: { value: formatDuration(d) } });
				}

				// End time preview below
				const ps = tc.createEl("div", { text: "", cls: "ft-preview" });
				const up = () => {
					const s = si.value,
						d = this._parseDurStr(ds.value);
					ps.setText(s && d > 0 ? "→ " + this._calcEnd(s, d) : "");
				};
				const debounceSave = (() => {
					let timer;
					return () => {
						if (timer) clearTimeout(timer);
						timer = setTimeout(() => this._autoSaveTime(task, si, ds), 300);
					};
				})();
				si.addEventListener("input", () => {
					up();
					debounceSave();
				});
				ds.addEventListener("input", () => {
					up();
					debounceSave();
				});
				up();
			}
		}

		// Checkbox column
		if (this._columnVisibility.check !== false) this._buildCheckCell(row, task);

		// v0.4.0: Priority column (hidden by default)
		if (
			this._columnVisibility.priority !== false &&
			this._columnVisibility.priority
		) {
			const pc = row.createEl("td", {
				cls: "ft-priority-cell",
				attr: { style: "text-align:center" },
			});
			if (task.priority) {
				pc.createEl("span", { text: task.priority, cls: "ft-priority-badge" });
			}
		}

		// v0.4.0: Soon badge column (hidden by default)
		if (this._columnVisibility.soon !== false && this._columnVisibility.soon) {
			const sc = row.createEl("td", {
				cls: "ft-soon-cell",
				attr: { style: "text-align:center" },
			});
			if (task.isSoon) {
				sc.createEl("span", { text: "◌", cls: "ft-soon-badge" });
			}
		}

		// Task cell: priority + text (v0.6.0: tree-aware with depth + toggle)
		const childrenTasks = item.childrenTasks || [];
		if (this._columnVisibility.task !== false)
			this._buildTaskCell(
				row,
				task,
				depth,
				hasChildren,
				collapsed,
				tid,
				childrenTasks,
			);

		if (this._columnVisibility.project !== false) {
			const pc = row.createEl("td", { cls: "ft-project-cell" });
			if (task.project) {
				const plink = pc.createEl("a", {
					text: task.project,
					cls: "ft-project-link",
				});
				if (task.projectPath) {
					plink.addEventListener("click", () =>
						this.app.workspace.openLinkText(task.projectPath, "", false),
					);
				}
			} else {
				pc.createEl("span", { text: "—", cls: "ft-project-none" });
			}
		}

		// Bucket cell
		if (this._columnVisibility.bucket !== false) {
			const bc = row.createEl("td", { cls: "ft-bucket-cell" });
			const bucketId = task.bucket;
			if (bucketId) {
				const buckets = this.plugin?.settings?.buckets || [];
				const bucketDef = buckets.find((b) => b.id === bucketId);
				if (bucketDef) {
					// Bucket name text above
					bc.createEl("div", { text: bucketDef.name, cls: "ft-bucket-label" });
					// Progress bar below (if has limit)
					if (bucketDef.weeklyLimit > 0) {
						const used = (this.bucketTotals?.[bucketId] || 0) / 60;
						const bar = renderProgressBar(
							used,
							bucketDef.weeklyLimit,
							`${formatHours(used)}h / ${bucketDef.weeklyLimit}h`,
						);
						bar.style.minWidth = "100px";
						bc.appendChild(bar);
					} else {
						bc.createEl("div", { text: "no limit", cls: "ft-bucket-nolimit" });
					}
				} else {
					bc.createEl("span", { text: bucketId, cls: "ft-bucket-missing" });
				}
			} else {
				bc.createEl("span", { text: "—", cls: "ft-bucket-none" });
			}
		}

		// v0.6.0: Sprint column (hidden by default)
		if (
			this._columnVisibility.sprint !== false &&
			this._columnVisibility.sprint
		) {
			const spc = row.createEl("td", { cls: "ft-bucket-cell" });
			if (task.sprint) {
				const badge = spc.createEl("span", {
					text: this._sprintName(task.sprint),
					cls: "ft-sprint-badge",
				});
				// Color the badge from sprint config
				const sprints = this.plugin?.settings?.sprints || [];
				const def = sprints.find((s) => s.id === task.sprint);
				if (def?.color) {
					badge.style.borderLeftColor = def.color;
				}
			} else {
				spc.createEl("span", { text: "—", cls: "ft-bucket-none" });
			}
		}

		if (this._columnVisibility.source !== false) {
			const sc = row.createEl("td", { cls: "ft-source" });
			const lnk = sc.createEl("a", {
				text: task.file.basename,
				cls: "ft-source-link",
			});
			lnk.addEventListener("click", () =>
				this.app.workspace.openLinkText(task.file.path, "", false, {
					line: task.line + 1,
				}),
			);
		}

		/* Date cell (shared) */
		if (this._columnVisibility.date !== false) {
			const dc = row.createEl("td", { cls: "ft-date-cell" });
			const dw = dc.createEl("div", { cls: "ft-date-wrap" });
			const hasDate = task.taskDate;
			const ds2 = dw.createEl("span", {
				text: hasDate ? this._fmtDate(task.taskDate) : "+",
				cls: "ft-date-badge" + (hasDate ? "" : " ft-date-none"),
			});
			const dp = document.createElement("div");
			dp.className = "ft-date-popup";
			const dpi = dp.createEl("input", {
				type: "date",
				value: task.taskDate || "",
				cls: "ft-dp-input",
			});
			const mkDpBtn = (txt, cls) => dp.createEl("button", { text: txt, cls });
			const bTdy = mkDpBtn("Today", "ft-dp-btn"),
				bTmw = mkDpBtn("Tomorrow", "ft-dp-btn"),
				bNw = mkDpBtn("Next Week", "ft-dp-btn"),
				bBkl = mkDpBtn("✕ Backlog", "ft-dp-btn ft-dp-remove");
			const fmt = (d) => d.toISOString().split("T")[0];
			// Register one document capture handler for all popups
			if (!this._closePopups) {
				this._closePopups = (ev) => {
					document
						.querySelectorAll(".ft-date-popup.ft-dp-open")
						.forEach((p) => {
							if (
								p.contains(ev.target) ||
								(p._badge && p._badge.contains(ev.target))
							)
								return;
							p.classList.remove("ft-dp-open");
							if (p.parentNode) p.parentNode.removeChild(p);
						});
				};
				document.addEventListener("click", this._closePopups, true);
			}
			dp._badge = ds2;
			const op = () => {
				const r = dw.getBoundingClientRect();
				dp.style.left = r.left + "px";
				dp.style.top = r.bottom + 4 + "px";
				dp.classList.add("ft-dp-open");
				document.body.appendChild(dp);
			};
			const cp = () => {
				dp.classList.remove("ft-dp-open");
				if (dp.parentNode) dp.parentNode.removeChild(dp);
			};
			ds2.addEventListener("click", (e) => {
				e.stopPropagation();
				dp.classList.contains("ft-dp-open") ? cp() : op();
			});
			const ap = async (nd) => {
				cp();
				try {
					await this.updateDate(task, nd);
					task.taskDate = nd;
					if (nd && nd === tdy) {
						ds2.setText(this._fmtDate(nd));
						ds2.removeClass("ft-date-none");
						await this._refreshSiblings();
					} else {
						row.remove();
						this.tasks = this.tasks.filter((t) => t !== task);
						this.rowData = this.rowData.filter((r) => r.task !== task);
						if (!this.tasks.length) this.renderTable();
						if (nd && nd !== tdy) await this._refreshSiblings();
					}
				} catch (e) {
					this.plugin?.notify?.("❌ " + e.message, true);
				}
			};
			dpi.addEventListener("change", () => ap(dpi.value));
			bTdy.addEventListener("click", () => ap(fmt(new Date())));
			bTmw.addEventListener("click", () =>
				ap(fmt(new Date(Date.now() + 864e5))),
			);
			bNw.addEventListener("click", () =>
				ap(fmt(new Date(Date.now() + 7 * 864e5))),
			);
			bBkl.addEventListener("click", () => ap(""));
		}

		/* Timer (today) or action buttons (compact) */
		if (isCompact && this._columnVisibility.actions !== false) {
			const ac = row.createEl("td", { cls: "ft-actions-cell" });
			const aw = ac.createEl("div", { cls: "ft-actions-wrap" });
			const abTdy = aw.createEl("button", {
				text: "📅 Today",
				cls: "ft-act-btn",
			});
			abTdy.addEventListener("click", async () => {
				await this.updateDate(task, tdy);
				await this._refreshSiblings();
				row.remove();
				this.tasks = this.tasks.filter((t) => t !== task);
				if (!this.tasks.length) this.renderTable();
			});
			if (od) {
				const abBkl = aw.createEl("button", {
					text: "🗑 Backlog",
					cls: "ft-act-btn ft-act-remove",
				});
				abBkl.addEventListener("click", async () => {
					await this.updateDate(task, "");
					await this._refreshSiblings();
					row.remove();
					this.tasks = this.tasks.filter((t) => t !== task);
					if (!this.tasks.length) this.renderTable();
				});
			}
		} else if (!isCompact && this._columnVisibility.timer !== false) {
			// Check if there's an active status timer to resync with
			const activeTimer = this.plugin?.statusTimer?.getState?.();
			const matchActive =
				activeTimer && activeTimer.taskName === task.cleanText;
			const ts = {
				remaining: matchActive ? activeTimer.remaining : (dur || 0) * 60,
				total: matchActive ? activeTimer.total : (dur || 0) * 60,
				interval: null,
				running: false,
			};
			const tmr = row.createEl("td", { cls: "ft-timer-cell" });
			const tr2 = tmr.createEl("div", { cls: "ft-timer-row" });
			const pb = tr2.createEl("button", { text: "▶", cls: "ft-timer-play" });
			const tmrBar = tr2.createEl("div", {
				cls: "ft-timer-progress ft-state-normal",
			});
			const tmrFill = tmrBar.createEl("div", { cls: "ft-timer-progress-fill" });
			const disp = tr2.createEl("span", {
				text: formatTimer(ts.remaining),
				cls: "ft-timer-display",
			});
			const rb = tr2.createEl("button", { text: "↺", cls: "ft-timer-reset" });
			const ud = () => {
				disp.setText(formatTimer(ts.remaining));
				disp.toggleClass("ft-timer-expired", ts.remaining <= 0);
				const pct =
					ts.total > 0 ? ((ts.total - ts.remaining) / ts.total) * 100 : 0;
				tmrFill.style.width = Math.min(pct, 100) + "%";
				if (pct >= 100) {
					tmrBar.className = "ft-timer-progress ft-state-over";
				} else if (pct >= 80) {
					tmrBar.className = "ft-timer-progress ft-state-warning";
				} else {
					tmrBar.className = "ft-timer-progress ft-state-normal";
				}
			};

			// stp: fully stop timer — records session on statusTimer
			const stp = () => {
				if (this.plugin) this.plugin._activeRowTimerStop = null;
				if (ts.interval) {
					clearInterval(ts.interval);
					ts.interval = null;
				}
				ts.running = false;
				pb.setText("▶");
				if (this.plugin?.statusTimer?.stop) {
					this.plugin.statusTimer.stop();
				}
			};

			// pauseTimer: just pause — no session recording
			const pauseTimer = () => {
				if (ts.interval) {
					clearInterval(ts.interval);
					ts.interval = null;
				}
				ts.running = false;
				pb.setText("▶");
				if (this.plugin?.statusTimer?.pause) {
					this.plugin.statusTimer.pause();
				}
			};

			// resumeTimer: resume existing timer without restarting
			const resumeTimer = () => {
				if (ts.remaining <= 0) return;
				ts.running = true;
				pb.setText("⏸");
				ts.interval = setInterval(() => {
					ts.remaining--;
					ud();
					if (ts.remaining <= 0) {
						stp();
						ts.remaining = 0;
						ud();
						disp.addClass("ft-timer-expired");
						this.plugin?.notify?.("⏰ Time's up! " + task.cleanText);
						if (this.plugin?.settings?.timerSound !== false) {
							this._beep();
						}
						if (this.plugin?.statusTimer?.stop) {
							this.plugin.statusTimer.stop();
						}
					}
				}, 1000);
				// Sync with status bar — toggle to resume if paused
				if (this.plugin?.statusTimer?.currentTimer?.interval === null) {
					this.plugin.statusTimer.toggle();
				}
			};

			// sta: start or switch to this task
			const sta = () => {
				if (ts.remaining <= 0) return;
				ts.running = true;
				pb.setText("⏸");
				ts.interval = setInterval(() => {
					ts.remaining--;
					ud();
					if (ts.remaining <= 0) {
						stp();
						ts.remaining = 0;
						ud();
						disp.addClass("ft-timer-expired");
						this.plugin?.notify?.("⏰ Time's up! " + task.cleanText);
						if (this.plugin?.settings?.timerSound !== false) {
							this._beep();
						}
						if (this.plugin?.statusTimer?.stop) {
							this.plugin.statusTimer.stop();
						}
					}
				}, 1000);
				// Start status bar timer first (stops any previous, records its session)
				if (this.plugin?.statusTimer?.start) {
					const dm = ds ? parseInt(ds.value, 10) : dur;
					this.plugin.statusTimer.start(task.cleanText, dm * 60);
				}
				// Register stop callback AFTER start() so onTimerStop doesn't fire on ourselves
				if (this.plugin) this.plugin._activeRowTimerStop = stp;
			};

			// If timer was running (from status bar), resume display without restarting
			// Only resync the FIRST matching row to prevent double-starts
			const resynced = this._resyncDone;
			if (matchActive && activeTimer.isRunning && !resynced) {
				this._resyncDone = true;
				ts.running = true;
				pb.setText("⏸");
				ts.interval = setInterval(() => {
					ts.remaining =
						this.plugin?.statusTimer?.currentTimer?.remaining ??
						ts.remaining - 1;
					if (ts.remaining < 0) ts.remaining = 0;
					ud();
					if (ts.remaining <= 0) {
						clearInterval(ts.interval);
						ts.interval = null;
						ts.running = false;
						pb.setText("▶");
					}
				}, 1000);
				if (this.plugin) this.plugin._activeRowTimerStop = stp;
			}

			pb.addEventListener("click", () => {
				const dm = ds ? parseInt(ds.value, 10) : dur;
				if (!dm || dm <= 0) return;
				if (ts.running) {
					pauseTimer();
				} else {
					if (ts.remaining <= 0) {
						ts.remaining = dm * 60;
						ts.total = dm * 60;
						ud();
					}
					sta();
				}
			});
			rb.addEventListener("click", () => {
				const isActiveTimer =
					ts.running ||
					this.plugin?.statusTimer?.currentTimer?.taskName === task.cleanText;
				if (isActiveTimer) {
					stp(); // Full stop — clears status bar and this row
				} else {
					// Local reset only — don't touch status bar or other rows
					if (ts.interval) {
						clearInterval(ts.interval);
						ts.interval = null;
					}
					ts.running = false;
					pb.setText("▶");
				}
				const dm = ds ? parseInt(ds.value, 10) : dur;
				ts.remaining = dm && dm > 0 ? dm * 60 : 0;
				ts.total = ts.remaining;
				ud();
			});
			if (ds) {
				ds.addEventListener("change", () => {
					const isActiveTimer =
						ts.running ||
						this.plugin?.statusTimer?.currentTimer?.taskName === task.cleanText;
					if (isActiveTimer) {
						stp(); // Stop active timer
					}
					const dm = parseInt(ds.value, 10);
					ts.remaining = dm && dm > 0 ? dm * 60 : 0;
					ts.total = ts.remaining;
					ud();
				});
			}
		}
		if (!isCompact) this.rowData.push({ task, si, ds });
	}

	/* Build task cell with priority + text + tree indent (v0.6.0) */
	_buildTaskCell(row, task, depth, hasChildren, collapsed, tid, childrenTasks) {
		const tc = row.createEl("td", { cls: "ft-task-cell" });

		// v0.6.0: Tree indent based on depth
		if (depth > 0) {
			tc.style.paddingLeft = depth * 18 + 8 + "px";
		}

		// v0.6.0: Collapse/expand toggle for parent rows
		if (hasChildren) {
			const toggle = tc.createEl("span", {
				text: collapsed ? "▶" : "▼",
				cls: "ft-tree-toggle",
			});
			toggle.addEventListener("click", (e) => {
				e.stopPropagation();
				if (this._collapsed.has(tid)) this._collapsed.delete(tid);
				else this._collapsed.add(tid);
				this.renderTable();
			});
		}

		if (task.priority) {
			tc.createEl("span", { text: task.priority, cls: "ft-priority" });
		}

		// Text + done styling
		const textEl = tc.createEl("span", {
			text: task.cleanText,
			cls: "ft-task-text",
		});
		if (task.status === "x" || task.status === "X") {
			row.addClass("ft-task-done");
			textEl.addClass("ft-task-done-text");
		}

		// v0.6.0: Mini progress bar when parent has children
		if (hasChildren && childrenTasks && childrenTasks.length > 0) {
			const done = childrenTasks.filter(
				(c) => c.status === "x" || c.status === "X",
			).length;
			const total = childrenTasks.length;
			const pct = total > 0 ? Math.round((done / total) * 100) : 0;
			const bar = tc.createEl("span", {
				cls: "ft-sub-progress",
				text: ` [${done}/${total}]`,
			});
			bar.title = `${done} of ${total} subtasks done (${pct}%)`;
		}

		textEl.addEventListener("click", (e) => {
			e.stopPropagation();
			this._showTaskDetail(
				task,
				textEl,
				new Date().toISOString().split("T")[0],
			);
		});
	}

	/* Build checkbox cell as dedicated column */
	_buildCheckCell(row, task) {
		const cc = row.createEl("td", { cls: "ft-check-cell" });
		const done = task.status === "x" || task.status === "X";
		const chk = cc.createEl("span", {
			cls: "ft-checkbox" + (done ? " ft-checked" : ""),
		});
		chk.addEventListener("click", async (e) => {
			e.stopPropagation();
			chk.classList.toggle("ft-checked");
			await this.toggleTaskComplete(task);
		});
	}

	/**
	 * Parse a duration string like "30m", "1.5h", "1h 30m" to minutes.
	 */
	_parseDurStr(str) {
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
	 * Auto-save time block when start time or duration changes.
	 */
	async _autoSaveTime(task, si, ds) {
		const s = si?.value;
		const d = ds ? this._parseDurStr(ds.value) : 0;
		if (!s || !d || d <= 0) return;
		const nt = `${s}—${this._calcEnd(s, d)}`;
		if (nt === task.time) return;
		try {
			await this.saveTime(task, nt);
			task.time = nt;
		} catch (_) {}
	}

	/**
	 * Show floating detail popup for a task (hidden fields).
	 */
	_showTaskDetail(task, anchorBtn, tdy) {
		document.querySelectorAll(".ft-detail-popup").forEach((e) => e.remove());

		const popup = document.createElement("div");
		popup.className = "ft-detail-popup";

		const r = anchorBtn.getBoundingClientRect();
		popup.style.left = Math.min(r.left, window.innerWidth - 320) + "px";
		popup.style.top = r.bottom + 4 + "px";

		// Task text
		const taskRow = popup.createEl("div", { cls: "ft-detail-row" });
		taskRow.createEl("span", {
			text: task.cleanText,
			cls: "ft-detail-task-text",
		});

		// Track pending changes
		let pendingDate = null;
		let pendingBucket = null;

		// Save pending changes and refresh
		const saveAndClose = async () => {
			let changed = false;
			if (pendingDate !== null && pendingDate !== task.taskDate) {
				await updateDate(this.app.vault, task, pendingDate);
				task.taskDate = pendingDate;
				changed = true;
			}
			if (pendingBucket !== null && pendingBucket !== task.bucket) {
				if (task.file) {
					const content = await this.app.vault.read(task.file);
					const lines = content.split("\n");
					const line = lines[task.line];
					if (line) {
						const hasBucketDir = /@(?:bucket|b):[^\s]+/.test(line);
						if (hasBucketDir) {
							lines[task.line] = line.replace(
								/@(?:bucket|b):[^\s]+/g,
								pendingBucket ? `@b:${pendingBucket}` : "",
							);
						} else if (pendingBucket) {
							lines[task.line] = line + ` @b:${pendingBucket}`;
						}
						await this.app.vault.modify(task.file, lines.join("\n"));
					}
				}
				task.bucket = pendingBucket || null;
				changed = true;
			}
			if (changed && this.plugin?.taskCache && task.file) {
				this.plugin.taskCache.invalid(task.file.path);
				await this.loadTasks();
				this.renderTable();
			}
			popup.remove();
			document.removeEventListener("click", closeOnOutside, true);
		};

		// Date
		const dateRow = popup.createEl("div", { cls: "ft-detail-row" });
		dateRow.createEl("label", { text: "Date: ", cls: "ft-detail-label" });
		const dateInput = dateRow.createEl("input", {
			type: "date",
			value: task.taskDate || "",
			cls: "ft-detail-input",
		});
		dateInput.addEventListener("change", () => {
			pendingDate = dateInput.value || "";
		});

		// Bucket
		const bucketRow = popup.createEl("div", { cls: "ft-detail-row" });
		bucketRow.createEl("label", { text: "Bucket: ", cls: "ft-detail-label" });
		const bucketSel = bucketRow.createEl("select", { cls: "ft-detail-select" });
		const buckets = this.plugin?.settings?.buckets || [];
		bucketSel.createEl("option", { text: "None", value: "" });
		for (const b of buckets) {
			const opt = bucketSel.createEl("option", { text: b.name, value: b.id });
			if (b.id === task.bucket) opt.selected = true;
		}
		bucketSel.addEventListener("change", () => {
			pendingBucket = bucketSel.value || "";
		});

		// Project
		const projRow = popup.createEl("div", { cls: "ft-detail-row" });
		projRow.createEl("label", { text: "Project: ", cls: "ft-detail-label" });
		if (task.project) {
			const projLink = projRow.createEl("a", {
				text: task.project,
				cls: "ft-detail-link",
			});
			const targetPath = task.projectPath || task.project;
			projLink.addEventListener("click", () =>
				this.app.workspace.openLinkText(targetPath, "", false),
			);
		} else {
			projRow.createEl("span", { text: "—", cls: "ft-detail-value" });
		}

		// Source
		const srcRow = popup.createEl("div", { cls: "ft-detail-row" });
		srcRow.createEl("label", { text: "Source: ", cls: "ft-detail-label" });
		const srcLink = srcRow.createEl("a", {
			text: task.file?.basename || "—",
			cls: "ft-detail-link",
		});
		if (task.file) {
			srcLink.addEventListener("click", () =>
				this.app.workspace.openLinkText(task.file.path, "", false, {
					line: task.line + 1,
				}),
			);
		}

		// Close button — save pending changes, then remove
		const closeBtn = popup.createEl("button", {
			text: "✕",
			cls: "ft-detail-close",
		});
		closeBtn.addEventListener("click", async () => await saveAndClose());

		// Close on outside click — save pending changes, then remove
		const closeOnOutside = (e) => {
			if (popup.contains(e.target)) return;
			if (e.target.tagName === "INPUT" && e.target.type === "date") return;
			// Remove listener first to prevent double-fire
			document.removeEventListener("click", closeOnOutside, true);
			saveAndClose();
		};
		setTimeout(
			() => document.addEventListener("click", closeOnOutside, true),
			200,
		);

		document.body.appendChild(popup);
	}

	async saveTime(task, time) {
		const lines = (await this.app.vault.read(task.file)).split("\n");
		const m = lines[task.line].match(/^(\s*[-*+]\s*\[[^\]]*\]\s*)(.*)$/);
		if (!m) throw Error("Could not parse task line");
		const rest = m[2].replace(
			/^\d{1,2}:\d{2}(\s*[—\-–]\s*\d{1,2}:\d{2})?\s*/,
			"",
		);
		lines[task.line] = m[1] + (time ? time + " " : "") + rest;
		await this.app.vault.modify(task.file, lines.join("\n"));
	}

	async updateDate(task, nd) {
		const lines = (await this.app.vault.read(task.file)).split("\n");
		const line = lines[task.line];
		if (!line) return;
		if (nd) {
			const re = /[@⏳📅]\s*\d{4}-\d{2}-\d{2}/u;
			lines[task.line] = re.test(line)
				? line.replace(re, "@" + nd)
				: line.replace(
						/^(\s*[-*+]\s*\[[^\]]*\]\s*)(.*)$/,
						(_, p, r) => p + r + " @" + nd,
					);
		} else {
			lines[task.line] = line.replace(/\s*[@⏳📅]\s*\d{4}-\d{2}-\d{2}/u, "");
		}
		await this.app.vault.modify(task.file, lines.join("\n"));
	}

	async _refreshSiblings() {
		if (!this.plugin) return;
		for (const r of this.plugin.renderers) {
			if (r === this) continue;
			await r.loadTasks();
			r.renderTable();
		}
	}

	/* ─── checkbox toggle ─── */
	async _renderSessionHistory() {
		this.containerEl.empty();

		if (!this.plugin?.sessionStore) {
			this.containerEl.createEl("p", {
				text: "Session store not available.",
				cls: "flowtime-empty",
			});
			return;
		}

		const buckets = this.plugin.settings.buckets || [];

		// ── Filter controls ──
		const filterBar = this.containerEl.createEl("div", {
			cls: "ft-sesh-filter-bar",
		});

		// Bucket filter
		filterBar.createEl("label", {
			text: "Bucket: ",
			cls: "ft-sesh-filter-label",
		});
		const bucketFilter = filterBar.createEl("select", {
			cls: "ft-sesh-filter",
		});
		bucketFilter.createEl("option", { text: "All", value: "" });
		for (const b of buckets) {
			bucketFilter.createEl("option", { text: b.name, value: b.id });
		}

		// Type filter
		filterBar.createEl("label", {
			text: "Type: ",
			cls: "ft-sesh-filter-label",
		});
		const typeFilter = filterBar.createEl("select", { cls: "ft-sesh-filter" });
		for (const [val, label] of [
			["", "All"],
			["session", "Sessions"],
			["completion", "Completions"],
		]) {
			typeFilter.createEl("option", { text: label, value: val });
		}

		// Limit
		filterBar.createEl("label", {
			text: "Show: ",
			cls: "ft-sesh-filter-label",
		});
		const limitFilter = filterBar.createEl("select", { cls: "ft-sesh-filter" });
		for (const n of [20, 50, 100, 500]) {
			limitFilter.createEl("option", {
				text: String(n),
				value: String(n),
				selected: n === 50,
			});
		}

		// ── Analytics Summary ──
		const summaryEl = this.containerEl.createEl("div", {
			cls: "ft-sesh-summary",
		});

		// Daily totals (today)
		const todayStr = new Date().toISOString().split("T")[0];
		const todayTotals = await this.plugin.sessionStore.getDailyTotals({
			dateFrom: todayStr,
			dateTo: todayStr,
		});

		if (todayTotals.length > 0) {
			const section = summaryEl.createEl("div", {
				cls: "ft-sesh-analytics-section",
			});
			section.createEl("div", {
				text: "📊 Today",
				cls: "ft-sesh-analytics-title",
			});
			for (const t of todayTotals) {
				const row = section.createEl("div", { cls: "ft-sesh-analytics-row" });
				const bDef = buckets.find((b) => b.id === t.bucket);
				if (bDef) {
					const swatch = row.createEl("span", { cls: "ft-bucket-swatch" });
					swatch.style.backgroundColor = bDef.color;
					row.createEl("span", {
						text: bDef.name,
						cls: "ft-sesh-analytics-name",
					});
				} else {
					row.createEl("span", {
						text: t.bucket || "unassigned",
						cls: "ft-sesh-analytics-name",
					});
				}
				row.createEl("span", {
					text: `${Math.round(t.total_minutes)}m (${(t.total_minutes / 60).toFixed(1)}h)`,
					cls: "ft-sesh-analytics-value",
				});
			}
		}

		// Weekly totals
		const weeklyTotals = await this.plugin.sessionStore.getWeeklyTotals();
		if (weeklyTotals.length > 0) {
			const section = summaryEl.createEl("div", {
				cls: "ft-sesh-analytics-section",
			});
			section.createEl("div", {
				text: "📅 This Week",
				cls: "ft-sesh-analytics-title",
			});

			// Show current week only (first entry if sorted desc)
			const currentWeekStart = weeklyTotals[0]?.weekStart;
			if (currentWeekStart) {
				const thisWeek = weeklyTotals.filter(
					(w) => w.weekStart === currentWeekStart,
				);
				for (const w of thisWeek) {
					const row = section.createEl("div", { cls: "ft-sesh-analytics-row" });
					const bDef = buckets.find((b) => b.id === w.bucket);
					if (bDef) {
						const swatch = row.createEl("span", { cls: "ft-bucket-swatch" });
						swatch.style.backgroundColor = bDef.color;
						row.createEl("span", {
							text: bDef.name,
							cls: "ft-sesh-analytics-name",
						});

						// Show vs weekly limit
						const limitHours = bDef.weeklyLimit;
						const usedHours = w.total_minutes / 60;
						if (limitHours > 0) {
							row.createEl("span", {
								text: `${usedHours.toFixed(1)}h / ${limitHours}h`,
								cls: "ft-sesh-analytics-value",
							});
						} else {
							row.createEl("span", {
								text: `${usedHours.toFixed(1)}h`,
								cls: "ft-sesh-analytics-value",
							});
						}
					} else {
						row.createEl("span", {
							text: w.bucket || "unassigned",
							cls: "ft-sesh-analytics-name",
						});
						row.createEl("span", {
							text: `${(w.total_minutes / 60).toFixed(1)}h`,
							cls: "ft-sesh-analytics-value",
						});
					}
				}
			}
		}

		// Last 5 completions
		const completions = await this.plugin.sessionStore.query({
			types: ["completion"],
			limit: 5,
		});
		if (completions.length > 0) {
			const section = summaryEl.createEl("div", {
				cls: "ft-sesh-analytics-section",
			});
			section.createEl("div", {
				text: "✅ Recent Completions",
				cls: "ft-sesh-analytics-title",
			});
			for (const c of completions) {
				const row = section.createEl("div", { cls: "ft-sesh-analytics-row" });
				row.createEl("span", {
					text: `☑ ${c.task_text || "—"}`,
					cls: "ft-sesh-analytics-name",
				});
				row.createEl("span", {
					text: c.date,
					cls: "ft-sesh-analytics-value ft-sesh-faint",
				});
			}
		}

		// Divider
		summaryEl.createEl("hr", { cls: "ft-sesh-divider" });

		// Results container
		const resultsEl = this.containerEl.createEl("div", {
			cls: "ft-sesh-results",
		});

		const loadResults = async () => {
			resultsEl.empty();

			const opts = {
				limit: parseInt(limitFilter.value, 10),
			};
			if (bucketFilter.value) opts.bucket = bucketFilter.value;
			if (typeFilter.value) opts.types = [typeFilter.value];

			const records = await this.plugin.sessionStore.query(opts);

			if (records.length === 0) {
				resultsEl.createEl("p", {
					text: "No sessions yet. Start a timer to see records here.",
					cls: "ft-sesh-empty",
				});
				return;
			}

			const table = resultsEl.createEl("table", { cls: "ft-sesh-table ft-table" });
			const thead = table.createEl("thead").createEl("tr");
			thead.createEl("th", { text: "Type" });
			thead.createEl("th", { text: "Date" });
			thead.createEl("th", { text: "Time" });
			thead.createEl("th", { text: "Duration" });
			thead.createEl("th", { text: "Bucket" });
			thead.createEl("th", { text: "Task / Note" });

			const tbody = table.createEl("tbody");
			for (const rec of records) {
				const row = tbody.createEl("tr");

				// Type icon
				const typeCell = row.createEl("td");
				typeCell.createEl("span", {
					text: rec.type === "session" ? "⏱" : "☑",
					cls: "ft-sesh-type-icon",
				});

				// Date
				row.createEl("td", { text: rec.date, cls: "ft-sesh-date" });

				// Time range (for sessions) or completed time (for completions)
				const timeCell = row.createEl("td", { cls: "ft-sesh-time" });
				if (rec.type === "session" && rec.start_time && rec.end_time) {
					const fmt = (iso) => iso.split("T")[1]?.slice(0, 5) || "";
					timeCell.setText(`${fmt(rec.start_time)}—${fmt(rec.end_time)}`);
				} else if (rec.completed_at) {
					timeCell.setText(rec.completed_at.split("T")[1]?.slice(0, 5) || "");
				}

				// Duration
				row.createEl("td", {
					text: rec.duration_minutes ? `${rec.duration_minutes}m` : "—",
					cls: "ft-sesh-dur",
				});

				// Bucket
				const bucketCell = row.createEl("td", { cls: "ft-sesh-bucket" });
				if (rec.bucket) {
					const bDef = buckets.find((b) => b.id === rec.bucket);
					if (bDef) {
						const badge = bucketCell.createEl("span", {
							text: bDef.name,
							cls: "ft-sesh-badge",
						});
						badge.style.borderLeftColor = bDef.color;
					} else {
						bucketCell.createEl("span", {
							text: rec.bucket,
							cls: "ft-sesh-badge-unknown",
						});
					}
				} else {
					bucketCell.createEl("span", { text: "—", cls: "ft-sesh-faint" });
				}

				// Task text
				row.createEl("td", {
					text: rec.task_text || rec.notes || "—",
					cls: "ft-sesh-task",
				});
			}
		};

		// Reload on filter change
		bucketFilter.addEventListener("change", loadResults);
		typeFilter.addEventListener("change", loadResults);
		limitFilter.addEventListener("change", loadResults);

		// Initial load
		await loadResults();
	}

	async toggleTaskComplete(task) {
		const wasCompleted = task.status === "x";
		await toggleCheck(this.app.vault, task);

		// Handle recurrence if completing
		if (!wasCompleted) {
			const content = await this.app.vault.read(task.file);
			const newLine = content.split("\n")[task.line];
			await this._handleRecurrence(task, newLine);
			if (this.plugin?.sessionStore) {
				await this.plugin.sessionStore.writeCompletion({
					date: task.taskDate || new Date().toISOString().split("T")[0],
					bucket: task.bucket || "",
					taskText: task.cleanText,
					completedAt: new Date().toISOString(),
				});
			}
		}

		const tbody = this.containerEl.querySelector("tbody");
		if (tbody) this.buildRows(tbody);
		await this._refreshSiblings();
	}

	/* ─── recurrence ─── */
	async _handleRecurrence(task, completedLine) {
		const rec = parseRecurrence(completedLine);
		if (!rec) return;

		const baseDate = task.taskDate
			? new Date(task.taskDate + "T00:00:00")
			: new Date();

		const next = new Date(baseDate);
		switch (rec.unit) {
			case "day":
				next.setDate(next.getDate() + rec.interval);
				break;
			case "week":
				next.setDate(next.getDate() + rec.interval * 7);
				break;
			case "month":
				next.setMonth(next.getMonth() + rec.interval);
				break;
		}
		const nextDate = next.toISOString().split("T")[0];

		const newTaskLine = completedLine
			.replace(/\[x\]/i, "[ ]")
			.replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/u, "@" + nextDate);

		const content = await this.app.vault.read(task.file);
		const lines = content.split("\n");
		lines.splice(task.line + 1, 0, newTaskLine);
		await this.app.vault.modify(task.file, lines.join("\n"));
	}
}

module.exports = { FlowtimeRenderer };
