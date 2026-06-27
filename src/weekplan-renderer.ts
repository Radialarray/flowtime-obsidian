/**
 * WeekplanRenderer — day-by-day week planning view.
 *
 * Renders Monday–Friday with all tasks (routines + one-offs) per day,
 * inline editing, daily budget bars, and toolbar actions.
 */

import { MarkdownRenderChild, TFile } from "obsidian";
import type { App } from "obsidian";
import { parseTaskLine, formatDuration, formatTimer } from "./task-parser";
import { renderProgressBar } from "./budget-state";
import {
  DUR_OPTS,
  START_H,
  START_END,
  parseStored,
  calcEnd,
  parseDurStr,
  timeToRow,
  getMonday,
  getFriday,
  getWeekNumber,
  isFileInScope,
  getFileTasks,
  toggleCheck,
  priorityWeight,
  saveTimeWithDuration,
  fmtDate,
} from "./task-utils";
import type { TaskRow, ParsedTask, FlowtimeSettings } from "./types";
import { QuickEntryModal } from "./quick-entry";

/* ─── Local types ─── */

export interface FlowtimePluginRef {
	settings: FlowtimeSettings;
	isMobile?: boolean;
	projectEngine?: {
		getAllProjects(): Promise<Array<{ name: string; path: string }>>;
		resolve(filePath: string): Promise<{ name: string | null; path: string | null; source: string | null }>;
	};
	taskCache?: {
		get(filePath: string): { parsedTasks: Omit<ParsedTask, "file">[] } | null;
		set(filePath: string, tasks: Omit<ParsedTask, "file">[]): void;
		getTasksForDateRange(
			dateFrom: string,
			dateTo: string,
		): Array<{ filePath: string; task: Omit<ParsedTask, "file"> }>;
	};
	routineEngine?: {
		generateAllDue(options?: { force?: boolean }): Promise<number>;
		loadGenerated(): Promise<void>;
	};
	notify: (msg: string, isError?: boolean) => void;
	saveData?: (data: FlowtimeSettings) => Promise<void>;
}

/** Extended TaskRow with renderer-specific computed fields */
interface WeekTask extends TaskRow {
	isRoutine: boolean;
}

interface OccupiedSlot {
	rowStart: number;
	rowEnd: number;
}

/** DOM element carrying grid-slots data */
interface GridElement extends HTMLElement {
	_tgSlots?: string[];
}

/** DOM element carrying grid-task-card data */
interface GridTaskCard extends HTMLElement {
	_tgRowStart?: number;
	_tgRowEnd?: number;
	_tgTask?: WeekTask;
}

/**
 * WeekplanRenderer — day-by-day week planning view.
 *
 * Renders Monday–Friday with all tasks (routines + one-offs) per day,
 * inline editing, daily budget bars, and toolbar actions.
 */
class WeekplanRenderer extends MarkdownRenderChild {
	app: App;
	containerEl: HTMLElement;
	plugin: FlowtimePluginRef;
	projectEngine: FlowtimePluginRef["projectEngine"];
	sourcePath: string;
	dayTasks: Record<string, WeekTask[]>;
	dayTotals: Record<string, number>;
	dailyCap: number;
	gridMode: boolean;
	weekStart!: string;
	weekEnd!: string;
	dayOrder!: string[];
	_tgEditPopup: HTMLElement | null;
	_tgOccupied: Record<string, OccupiedSlot[]>;
	_tgUtCount: Record<string, number>;

	constructor(
		app: App,
		containerEl: HTMLElement,
		plugin: FlowtimePluginRef,
		projectEngine: FlowtimePluginRef["projectEngine"],
		sourcePath: string,
	) {
		super(containerEl);
		this.app = app;
		this.containerEl = containerEl;
		this.plugin = plugin;
		this.projectEngine = projectEngine;
		this.sourcePath = sourcePath;
		this.dayTasks = {};
		this.dayTotals = {};
		this.dailyCap = 12;
		this.gridMode = false;
		this._tgEditPopup = null;
		this._tgOccupied = {};
		this._tgUtCount = {};
	}

	/** Get active document for popout window compatibility */
	private get _doc(): Document {
		return this.containerEl?.ownerDocument ?? activeDocument;
	}

	override onload(): void {
		this.dailyCap = this.plugin?.settings?.dailyCap || 12;
		// Phase 1: Render instantly from cache (fast, might miss recent changes)
		this._loadFromCache();
		this.renderView();
		// Phase 2: Full scan in background, re-render when done
		void (async (): Promise<void> => {
			try {
				await this.loadWeek();
				this.renderView();
			} catch (e) {
				this.containerEl.createEl("p", {
					text: "⚠️ Error: " + (e as Error).message,
					cls: "flowtime-empty",
				});
				console.error("Weekplan error:", e);
			}
		})();
	}

	/* ─── helpers ─── */

	_getMonday(d: string): string {
		const date = new Date(d);
		const day = date.getDay();
		const diff = day === 0 ? -6 : 1 - day;
		date.setDate(date.getDate() + diff);
		return date.toISOString().split("T")[0];
	}

	_getFriday(mondayStr: string): string {
		const m = new Date(mondayStr + "T12:00:00");
		m.setDate(m.getDate() + 4);
		return m.toISOString().split("T")[0];
	}

	_timeOpts(h1: number, h2: number): string[] {
		const r: string[] = [];
		for (let h = h1; h <= h2; h++)
			for (let m = 0; m < 60; m += 30)
				r.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
		return r;
	}

	_parseStored(t: string): { start: string; dur: number } {
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

	_parseDurStr(s: string): number {
		if (!s) return 0;
		const m = s.match(/^(\d+(?:\.\d+)?)\s*([hm])$/);
		if (m) return m[2] === "h" ? parseFloat(m[1]) * 60 : parseFloat(m[1]);
		return parseInt(s, 10) || 0;
	}

	_calcEnd(s: string, d: number): string {
		if (!s || !d) return "";
		const t = s.split(":").reduce((a, n) => +n + 60 * a, 0) + d;
		return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.round(t % 60)).padStart(2, "0")}`;
	}

	_fmtDate(dateStr: string): string {
		return fmtDate(dateStr);
  }

  async _getFileTasks(file: TFile): Promise<ParsedTask[]> {
		const cache = this.plugin?.taskCache;
		const cached = cache?.get(file.path);
		if (cached) {
			return cached.parsedTasks.map((t) => ({ ...t, file }));
		}
		const content = await this.app.vault.read(file);
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

	_priorityWeight(p: string | null | undefined): number {
		const w: Record<string, number> = { "🟥": 5, "🟨": 3, "🟩": 1 };
		return (p && w[p]) || 0;
	}

	/* ─── loading ─── */

	/** Quick load from cache only — no I/O. Call before renderView(). */
	_loadFromCache(): void {
		const today = new Date().toISOString().split("T")[0];
		const mon = getMonday(today);
		const fri = getFriday(mon);
		this._initWeek(mon, fri);

		const cached =
			this.plugin?.taskCache?.getTasksForDateRange(mon, fri) || [];
		for (const { filePath, task: parsed } of cached) {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile) || !parsed.taskDate) continue;
			if (!this.dayTasks[parsed.taskDate]) continue;
			this._addTaskNoProject(parsed, file);
		}
	}

	/** Full scan — reads uncached files, refreshes cache. Call async after first render. */
	async loadWeek(): Promise<void> {
		const today = new Date().toISOString().split("T")[0];
		const root = this.plugin?.settings?.projectsRoot || "";
		const mon = getMonday(today);
		const fri = getFriday(mon);

		this._initWeek(mon, fri);

		const cache = this.plugin?.taskCache;
		const cached = cache?.getTasksForDateRange(mon, fri) || [];
		const cachedPaths = new Set(cached.map((e) => e.filePath));

		// Scan uncached files in parallel
		const allFiles = this.app.vault
			.getMarkdownFiles()
			.filter((f) => isFileInScope(f.path, root, this.app.vault.configDir));
		const uncached = allFiles.filter((f) => !cachedPaths.has(f.path));

		const freshResults = await Promise.all(
			uncached.map(async (file: TFile) => ({
				file,
				tasks: await getFileTasks(file, this.app, cache),
			})),
		);

		// Process cached entries + fresh results
		for (const { filePath, task: parsed } of cached) {
			if (!parsed.taskDate || !this.dayTasks[parsed.taskDate]) continue;
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) continue;
			await this._addTask(parsed, file);
		}
		for (const { file, tasks } of freshResults) {
			for (const parsed of tasks) {
				if (
					parsed.status === "x" ||
					parsed.status === "-" ||
					parsed.status === "X"
				)
					continue;
				if (!parsed.taskDate || !this.dayTasks[parsed.taskDate]) continue;
				await this._addTask(parsed, file);
			}
		}

		this._sortDays();
	}

	/** Init day buckets for a Mon-Fri range */
	_initWeek(mon: string, fri: string): void {
		this.weekStart = mon;
		this.weekEnd = fri;
		this.dayTasks = {};
		this.dayTotals = {};
		const d = new Date(mon + "T12:00:00");
		const end = new Date(fri + "T12:00:00");
		while (d <= end) {
			const dateStr = d.toISOString().split("T")[0];
			this.dayTasks[dateStr] = [];
			this.dayTotals[dateStr] = 0;
			d.setDate(d.getDate() + 1);
		}
	}

	/** Add parsed task to day bucket (with project resolution) */
	async _addTask(parsed: ParsedTask, file: TFile): Promise<void> {
		const {
			taskDate,
			rawText,
			time,
			priority,
			cleanText,
			bucket,
			durationMinutes,
		} = parsed;
		const isRoutine = !!rawText.match(/🔁/);
		let project: string | null = null;
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
		this.dayTasks[taskDate].push({
			file,
			line: parsed.line,
			rawLine: parsed.rawLine,
			time,
			taskDate,
			durationMinutes: durationMinutes || 0,
			rawText,
			cleanText,
			status: parsed.status,
			priority,
			bucket,
			project,
			isRoutine,
		});
		this.dayTotals[taskDate] += durationMinutes || 0;
	}

	/** Fast path version — skips projectEngine resolve (no I/O) */
	_addTaskNoProject(parsed: ParsedTask, file: TFile): void {
		const {
			taskDate,
			rawText,
			time,
			priority,
			cleanText,
			bucket,
			durationMinutes,
		} = parsed;
		const isRoutine = !!rawText.match(/🔁/);
		let project: string | null = null;
		if (rawText) {
			const pMatch = rawText.match(/@p:([^\s]+)/);
			if (pMatch) project = pMatch[1];
			if (!project) {
				const tp = this.plugin?.settings?.tagPrefix || "project/";
				const tagMatch = rawText.match(new RegExp(tp + "([^\\s]+)"));
				if (tagMatch) project = tagMatch[1];
			}
		}
		this.dayTasks[taskDate].push({
			file,
			line: parsed.line,
			rawLine: parsed.rawLine,
			time,
			taskDate,
			durationMinutes: durationMinutes || 0,
			rawText,
			cleanText,
			status: parsed.status,
			priority,
			bucket,
			project,
			isRoutine,
		});
		this.dayTotals[taskDate] += durationMinutes || 0;
	}

	/** Sort tasks in each day: priority → time */
	_sortDays(): void {
		for (const dateStr of Object.keys(this.dayTasks)) {
			this.dayTasks[dateStr].sort((a, b) => {
				const pa = priorityWeight(a.priority);
				const pb = priorityWeight(b.priority);
				if (pa !== pb) return pb - pa;
				if (!a.time && !b.time) return 0;
				if (!a.time) return 1;
				if (!b.time) return -1;
				return a.time.localeCompare(b.time);
			});
		}
	}

	/* ─── rendering ─── */

	renderView(): void {
		this.containerEl.empty();

		// ── Header bar ──
		const header = this.containerEl.createEl("div", { cls: "ft-wp-header" });

		// Week label
		const weekNum = getWeekNumber(this.weekStart);
		const headerTitle = header.createEl("div", { cls: "ft-wp-title" });
		headerTitle.createEl("span", {
			text: `📅 Week ${weekNum} — ${this._fmtDate(this.weekStart)} → ${this._fmtDate(this.weekEnd)}`,
			cls: "ft-wp-week-label",
		});

		// Toolbar buttons
		const toolbar = header.createEl("div", { cls: "ft-wp-toolbar" });

		const genBtn = toolbar.createEl("button", {
			text: "🔄 Regenerate Routines",
			cls: "ft-wp-btn",
		});
		genBtn.addEventListener("click", () => {
			void (async () => {
				if (this.plugin?.routineEngine) {
					const count = await this.plugin.routineEngine.generateAllDue({
						force: true,
					});
					this.plugin.notify?.(
						"🔁 Generated " + count + " routine task" + (count === 1 ? "" : "s"),
					);
					await this.loadWeek();
					this.renderView();
				}
			})();
		});

		const vacBtn = toolbar.createEl("button", {
			text: this.plugin?.settings?.vacationMode
				? "▶ Resume Routines"
				: "⏸ Vacation Mode",
			cls:
				"ft-wp-btn" +
				(this.plugin?.settings?.vacationMode ? " ft-wp-vacation-on" : ""),
		});
		vacBtn.addEventListener("click", () => {
			void (async () => {
				if (this.plugin) {
					this.plugin.settings.vacationMode = !this.plugin.settings.vacationMode;
					await this.plugin.saveData?.(this.plugin.settings);
					this.renderView();
					this.plugin.notify?.(
						this.plugin.settings.vacationMode
							? "⏸ Routine generation paused"
							: "▶ Routine generation resumed",
					);
				}
			})();
		});

		// ── Small screen check (grid requires min 760px) ──
		const isSmallScreen = this.plugin?.isMobile || (typeof window !== "undefined" && window.innerWidth < 768);

		// v0.5.0: Toggle list/grid view (hidden on small screens where grid is unavailable)
		if (!isSmallScreen) {
			const toggleBtn = toolbar.createEl("button", {
				text: this.gridMode ? "📋 List View" : "📅 Grid View",
				cls: "ft-wp-btn ft-wp-btn-toggle",
			});
			toggleBtn.addEventListener("click", () => {
				this.gridMode = !this.gridMode;
				this.renderView();
			});
		}

		const addBtn = toolbar.createEl("button", {
			text: "➕ Add Task",
			cls: "ft-wp-btn ft-wp-btn-primary",
		});
		addBtn.addEventListener("click", () => {
			const modal = new QuickEntryModal(this.app, this.plugin);
			modal.open();
		});

		// ── Vacation notice ──
		if (this.plugin?.settings?.vacationMode) {
			const notice = this.containerEl.createEl("div", {
				cls: "ft-wp-vacation-notice",
			});
			notice.createEl("span", {
				text: "⏸ Vacation mode is ON — routines are paused",
			});
		}

		// Grid view needs min 760px — disable on phones and small tablets
		if (this.gridMode && isSmallScreen) {
			this.gridMode = false;
		}
		if (this.gridMode) {
			this.renderGridView();
		} else {
			this.renderListView();
		}
	}

	/* ─── Timeline Grid View ─── */

	/**
	 * Convert a time string (HH:MM) to a grid row number.
	 * Row 1 = header, Row 2 = START_H:00, each 30min = +1 row.
	 */
	_timeToRow(timeStr: string): number {
		if (!timeStr) return -1;
		const parts = timeStr.split(":");
		const h = parseInt(parts[0], 10);
		const m = parseInt(parts[1], 10) || 0;
		const totalMinutes = h * 60 + m;
		const startMinutes = START_H * 60;
		if (totalMinutes < startMinutes) return -1;
		const slotIndex = Math.round((totalMinutes - startMinutes) / 30);
		return 2 + slotIndex; // row 1 = header, row 2 = first slot
	}

	/**
	 * Map day names (dateStr) to grid column indexes.
	 * Column 1 = time labels, columns 2-6 = Mon-Fri.
	 */
	_dateToCol(dateStr: string): number {
		if (!this.dayOrder) return 2;
		const idx = this.dayOrder.indexOf(dateStr);
		return idx >= 0 ? idx + 2 : 2;
	}

	renderGridView(): void {
		const today = new Date().toISOString().split("T")[0];
		const days = Object.keys(this.dayTasks).sort();
		this.dayOrder = days;
		if (days.length === 0) {
			const empty = this.containerEl.createEl("div", { cls: "ft-wp-empty" });
			empty.createEl("p", { text: "📭 No tasks scheduled this week." });
			return;
		}

		// ── Grid container ──
		const wrap = this.containerEl.createEl("div", { cls: "ft-tg-wrap" });
		const grid: GridElement = wrap.createEl("div", { cls: "ft-tg-grid" });

		// Build time slots (every 30min from START_H to START_END)
		const slots: string[] = [];
		for (let h = START_H; h <= START_END; h++) {
			for (let m = 0; m < 60; m += 30) {
				if (h === START_END && m > 0) break;
				slots.push(
					`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
				);
			}
		}

		// Total grid rows = 1 header + slots length
		grid.setCssProps({ "--tg-rows": String(1 + slots.length), "--tg-cols": String(1 + days.length) });
		grid._tgSlots = slots;

		// ── Header row ──
		const hc = grid.createEl("div", { cls: "ft-tg-hc" });
		hc.setCssProps({ gridRow: "1", gridColumn: "1" });

		const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
		for (let di = 0; di < days.length; di++) {
			const dateStr = days[di];
			const d = new Date(dateStr + "T12:00:00");
			const dayName = dayNames[d.getDay()];
			const dayNum = d.getDate();
			const isToday = dateStr === today;
			const hd = grid.createEl("div", {
				cls: "ft-tg-hd" + (isToday ? " ft-tg-today" : ""),
			});
			hd.setCssProps({ gridRow: "1", gridColumn: String(di + 2) });
			hd.createEl("span", { text: dayName, cls: "ft-tg-hd-day" });
			hd.createEl("span", { text: String(dayNum), cls: "ft-tg-hd-date" });
		}

		// ── Time labels + grid background cells ──
		for (let si = 0; si < slots.length; si++) {
			const rowNum = si + 2;
			const timeLabel = slots[si];

			// Time label (col 1)
			const tl = grid.createEl("div", { cls: "ft-tg-time" });
			tl.setCssProps({ gridRow: String(rowNum), gridColumn: "1" });
			tl.setText(timeLabel);

			// Background cells for each day at this time
			for (let di = 0; di < days.length; di++) {
				const cell = grid.createEl("div", { cls: "ft-tg-cell" });
				cell.setCssProps({ gridRow: String(rowNum), gridColumn: String(di + 2) });
				// Highlight current time slot on today
				if (days[di] === today) {
					const now = new Date();
					const nowMin = now.getHours() * 60 + now.getMinutes();
					const slotMin =
						parseInt(timeLabel.split(":")[0], 10) * 60 +
						parseInt(timeLabel.split(":")[1], 10);
					if (nowMin >= slotMin && nowMin < slotMin + 30) {
						cell.addClass("ft-tg-now");
					}
				}
			}
		}

		// ── Hour separators (thicker lines at whole hours) ──
		for (let h = START_H + 1; h <= START_END; h++) {
			const rowNum = (h - START_H) * 2 + 2;
			for (let di = 0; di < days.length; di++) {
				const sep = grid.createEl("div", { cls: "ft-tg-hsep" });
				sep.setCssProps({ gridRow: String(rowNum), gridColumn: String(di + 2) });
			}
		}

		// ── Task cards ──
		this._tgEditPopup = null;
		this._tgOccupied = {};
		this._tgUtCount = {};

		for (const dateStr of days) {
			const tasks = this.dayTasks[dateStr];
			const col = this._dateToCol(dateStr);

			// First pass: render timed tasks
			for (const task of tasks) {
				if (!task.time) continue;
				this._renderGridTask(grid, task, col);
			}

			// Second pass: untimed tasks listed at bottom of day column
			const untimed = tasks.filter((t) => !t.time);
			if (untimed.length === 0) continue;

			const bottomRow = 2 + slots.length;
			for (const task of untimed) {
				this._renderGridTask(grid, task, col);
			}
			// Untimed section label
			const utLabel = grid.createEl("div", { cls: "ft-tg-ut-label" });
			utLabel.setCssProps({ gridRow: String(bottomRow + 1), gridColumn: String(col) });
			utLabel.setText("⋯");
		}
	}

	/** Render a single task card on the timeline grid */
	_renderGridTask(grid: GridElement, task: WeekTask, col: number): void {
		const { start, dur } = parseStored(task.time);
		if (start) {
			const rowStart = timeToRow(start, START_H);
			const endTime = calcEnd(start, dur);
			let rowEnd = endTime
				? timeToRow(endTime, START_H)
				: rowStart + 1;
			if (rowEnd <= rowStart) rowEnd = rowStart + 1;
			if (rowStart < 2) return; // outside visible range

			// Track occupied columns: col > [ { rowStart, rowEnd, count } ]
			if (!this._tgOccupied) this._tgOccupied = {};
			if (!this._tgOccupied[col]) this._tgOccupied[col] = [];
			const overlaps = this._tgOccupied[col].filter(
				(o) => rowStart < o.rowEnd && rowEnd > o.rowStart,
			);
			const stackLevel = overlaps.length; // 0 = first, 1 = second, etc.
			this._tgOccupied[col].push({ rowStart, rowEnd });

			const card: GridTaskCard = grid.createEl("div", {
				cls:
					"ft-tg-card" +
					(task.status === "x" ? " ft-tg-done" : "") +
					(task.isRoutine ? " ft-tg-routine" : "") +
					(stackLevel > 0 ? " ft-tg-stacked" : ""),
			});
			card.setCssStyles({
				gridRow: `${rowStart} / ${rowEnd}`,
				gridColumn: String(col),
				marginLeft: stackLevel > 0 ? `${stackLevel * 20 + 1}px` : "1px",
				width: stackLevel > 0
					? `calc(100% - ${stackLevel * 20 + 2}px)`
					: "calc(100% - 2px)",
			});
			card._tgRowStart = rowStart;
			card._tgRowEnd = rowEnd;
			card._tgTask = task;

			// Priority dot
			if (task.priority) {
				card.createEl("span", { text: task.priority, cls: "ft-tg-prio" });
			}
			// Routine badge
			if (task.isRoutine) {
				card.createEl("span", { text: "🔁", cls: "ft-tg-routine-badge" });
			}
			// Task text
			card.createEl("span", { text: task.cleanText, cls: "ft-tg-text" });

			// Project label (below text)
			if (task.project) {
				card.createEl("span", { text: task.project, cls: "ft-tg-project" });
			}

			// Time tooltip (updated live during resize)
			const timeLabel = card.createEl("span", {
				text: start + (dur ? "—" + endTime : ""),
				cls: "ft-tg-time-label",
			});

			// ── Resize handle (v0.5.0) ──
			const resizeHandle = card.createEl("div", { cls: "ft-tg-resize-handle" });
			const startResize = (e: MouseEvent | TouchEvent): void => {
				e.preventDefault();
				e.stopPropagation();
				const ev = "touches" in e ? e.touches[0] : e;
				this._startCardResize(ev as unknown as MouseEvent, card, grid, timeLabel);
			};
			resizeHandle.addEventListener("mousedown", startResize as EventListener);
			resizeHandle.addEventListener("touchstart", startResize as EventListener, { passive: false });

			// Click to edit popup
			card.addEventListener("click", (e: MouseEvent) => {
				if (e.target === resizeHandle) return;
				e.stopPropagation();
				this._openTaskEditPopup(card, task, start, dur);
			});
		} else {
			// Untimed task — rendered at the bottom of the day column, stacked
			// Track untimed count per column to give each a unique row
			if (!this._tgUtCount) this._tgUtCount = {};
			this._tgUtCount[col] = (this._tgUtCount[col] || 0) + 1;
			// Place untimed tasks starting from bottom + 2 rows each
			const bottomBase = 2 + ((grid._tgSlots && grid._tgSlots.length) || 26);
			const utRow = bottomBase + this._tgUtCount[col];

			const card = grid.createEl("div", {
				cls:
					"ft-tg-card ft-tg-untimed" +
					(task.status === "x" ? " ft-tg-done" : "") +
					(task.isRoutine ? " ft-tg-routine" : ""),
			});
			card.setCssProps({ gridColumn: String(col), gridRow: `${utRow} / ${utRow + 1}` });

			card.createEl("span", { cls: "ft-tg-ut-dot" });
			card.createEl("span", { text: task.cleanText, cls: "ft-tg-text" });
			if (task.project) {
				card.createEl("span", { text: task.project, cls: "ft-tg-project" });
			}
			card.addEventListener("click", (e: MouseEvent) => {
				e.stopPropagation();
				this._openTaskEditPopup(card, task, "", 0);
			});
		}
	}

	/* ─── Drag-to-resize (v0.5.0) ─── */

	/** Start dragging a card's resize handle */
	_startCardResize(
		e: MouseEvent,
		card: GridTaskCard,
		grid: GridElement,
		timeLabel: HTMLElement,
	): void {
		const rowStart = card._tgRowStart;
		if (!rowStart || rowStart < 2) return;

		// Grid row height from CSS: header=36px, data rows=28px
		const HEADER_H = 36;
		const ROW_H = 28;

		// Snap a mouse Y to the nearest grid row, clamped to valid range
		const yToRow = (clientY: number): number => {
			const wrap = grid.closest(".ft-tg-wrap");
			const scrollTop = wrap ? wrap.scrollTop : 0;
			const rect = grid.getBoundingClientRect();
			const relY = clientY - rect.top + scrollTop;
			if (relY < HEADER_H) return rowStart + 1; // min = 30 min
			const rawRow = 2 + Math.round((relY - HEADER_H) / ROW_H);
			// Clamp: at least start+1, at most last data row
			const maxRow =
				2 +
				(parseInt(grid.style.getPropertyValue("--tg-rows"), 10) || 27) -
				1;
			return Math.max(rowStart + 1, Math.min(rawRow, maxRow));
		};

		// Live drag indicator
		const dragIndicator = this._doc.createElement("div");
		dragIndicator.className = "ft-tg-resize-indicator";
		grid.appendChild(dragIndicator);

		const updateDrag = (_clientX: number, clientY: number): void => {
			const newRowEnd = yToRow(clientY);
			card.setCssProps({ gridRow: `${rowStart} / ${newRowEnd}` });
			card._tgRowEnd = newRowEnd;

			// Position indicator at the new bottom edge
			const wrap = grid.closest(".ft-tg-wrap");
			const scrollTop = wrap ? wrap.scrollTop : 0;
			const rowIndex = newRowEnd - 2;
			const yPos = HEADER_H + rowIndex * ROW_H - scrollTop;
			dragIndicator.setCssStyles({
				top: yPos + "px",
				left: "60px",
				width: "calc(100% - 60px)",
			});
			dragIndicator.addClass("ft-dd-open");

			// Show time label on indicator
			const newEndTime = this._rowToTime(newRowEnd);
			const startTime = this._rowToTime(rowStart);
			if (startTime && newEndTime) {
				dragIndicator.textContent = `${startTime}—${newEndTime}`;
			}
		};

		const onMove = (ev: MouseEvent | TouchEvent): void => {
			ev.preventDefault();
			const pt = "touches" in ev ? ev.touches[0] : ev;
			updateDrag(pt.clientX, pt.clientY);
		};
		const touchOnMove = (ev: TouchEvent): void => onMove(ev);

		const cleanup = async (): Promise<void> => {
			this._doc.removeEventListener("mousemove", onMove as EventListener, true);
			this._doc.removeEventListener("mouseup", onUp as EventListener, true);
			this._doc.removeEventListener("touchmove", touchOnMove, true);
			this._doc.removeEventListener("touchend", onTouchUp, true);
			this._doc.removeEventListener("touchcancel", onTouchUp, true);
			dragIndicator.remove();

			const newRowEnd = card._tgRowEnd;
			if (!newRowEnd) return;
			const newEndTime = this._rowToTime(newRowEnd);
			const startTime = this._rowToTime(rowStart);
			if (!startTime || !newEndTime) return;

			// Calculate duration in minutes
			const sParts = startTime.split(":").map(Number);
			const eParts = newEndTime.split(":").map(Number);
			const durMinutes =
				eParts[0] * 60 + eParts[1] - (sParts[0] * 60 + sParts[1]);
			if (durMinutes <= 0) return;

			// Update the task data
			const task = card._tgTask;
			if (!task) return;
			task.time = startTime + "—" + newEndTime;
			task.durationMinutes = durMinutes;

			// Update time label on card
			timeLabel.textContent = startTime + "—" + newEndTime;

			// Persist to vault
			await this._saveTaskInline(
				task,
				startTime,
				durMinutes < 60 ? durMinutes + "m" : durMinutes / 60 + "h",
			);
		};

		const onUp = (): void => { void cleanup(); };
		const onTouchUp = (): void => { void cleanup(); };

		this._doc.addEventListener("mousemove", onMove as EventListener, true);
		this._doc.addEventListener("mouseup", onUp as EventListener, true);
		this._doc.addEventListener("touchmove", touchOnMove, true);
		this._doc.addEventListener("touchend", onTouchUp, true);
		this._doc.addEventListener("touchcancel", onTouchUp, true);

		// Init position
		updateDrag(e.clientX, e.clientY);
	}

	/** Convert a grid row number back to a time string (HH:MM) */
	_rowToTime(rowNum: number): string {
		if (rowNum < 2) return "";
		const slotIndex = rowNum - 2;
		const totalMinutes = START_H * 60 + slotIndex * 30;
		const h = Math.floor(totalMinutes / 60);
		const m = totalMinutes % 60;
		if (h > START_END) return "";
		return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
	}

	/** Open an edit popup for a grid task card */
	_openTaskEditPopup(
		card: GridTaskCard,
		task: WeekTask,
		start: string,
		dur: number,
	): void {
		// Close any existing popup
		if (this._tgEditPopup) {
			this._tgEditPopup.remove();
			this._tgEditPopup = null;
		}

		const popup = this._doc.createElement("div");
		popup.className = "ft-tg-popup";

		// Position near the card (clamped to viewport)
		const rect = card.getBoundingClientRect();
		popup.setCssStyles({
			left: Math.max(4, Math.min(rect.left, window.innerWidth - 210)) + "px",
			top: Math.min(rect.bottom + 4, window.innerHeight - 220) + "px",
		});

		// ── Time input ──
		const timeRow = popup.createEl("div", { cls: "ft-tg-popup-row" });
		timeRow.createEl("label", { text: "Time: ", cls: "ft-tg-popup-label" });
		const startInput = timeRow.createEl("input", {
			type: "text",
			value: start || "",
			placeholder: "09:00",
			cls: "ft-tg-popup-input",
		});
		const durInput = timeRow.createEl("input", {
			type: "text",
			value: dur ? formatDuration(dur) : "",
			placeholder: "30m",
			cls: "ft-tg-popup-input",
		});

		// ── Checkbox ──
		const checkRow = popup.createEl("div", { cls: "ft-tg-popup-row" });
		const cb = checkRow.createEl("input", {
			type: "checkbox",
			cls: "ft-tg-popup-cb",
		});
		cb.checked = task.status === "x";
		checkRow.createEl("span", { text: " Done", cls: "ft-tg-popup-label" });

		// ── Save button ──
		const btnRow = popup.createEl("div", { cls: "ft-tg-popup-row" });
		const saveBtn = btnRow.createEl("button", {
			text: "Save",
			cls: "ft-tg-popup-btn",
		});
		const delBtn = btnRow.createEl("button", {
			text: "🗑 Remove",
			cls: "ft-tg-popup-btn ft-tg-popup-del",
		});

		saveBtn.addEventListener("click", () => {
			void (async () => {
				// Update time
				task.time = startInput.value.trim()
					? (() => {
							const s = startInput.value.trim();
							const d = this._parseDurStr(durInput.value.trim());
							return d > 0 ? s + "—" + this._calcEnd(s, d) : s;
						})()
					: "";
				task.durationMinutes = this._parseDurStr(durInput.value.trim());

				// Persist to vault
				await this._saveTaskInline(
					task,
					startInput.value.trim(),
					durInput.value.trim(),
				);

				// Toggle check
				if (cb.checked !== (task.status === "x")) {
					await this._toggleCheck(task);
				}

				popup.remove();
				this._tgEditPopup = null;
				await this.loadWeek();
				this.renderView();
			})();
		});

		delBtn.addEventListener("click", () => {
			void (async () => {
				await this._removeTask(task);
				popup.remove();
				this._tgEditPopup = null;
				await this.loadWeek();
				this.renderView();
			})();
		});

		// Close on outside click
		const closeHandler = (e: MouseEvent): void => {
			if (!popup.contains(e.target as Node) && e.target !== card) {
				popup.remove();
				this._tgEditPopup = null;
				this._doc.removeEventListener("click", closeHandler, true);
			}
		};
		window.setTimeout(() => this._doc.addEventListener("click", closeHandler, true), 0);

		this._doc.body.appendChild(popup);
		this._tgEditPopup = popup;
	}

	/** Save time changes from the grid edit popup to the vault file */
	async _saveTaskInline(
		task: WeekTask,
		startStr: string,
		durStr: string,
	): Promise<void> {
		if (!task.file) return;
		const durMinutes = this._parseDurStr(durStr);
		const end =
			startStr && durMinutes > 0 ? this._calcEnd(startStr, durMinutes) : "";
		let timeBlock = startStr;
		if (end) timeBlock += "—" + end;

		const content = await this.app.vault.read(task.file);
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
			line = line.replace(
				/^(\s*[-*+]\s*\[[^\]]*\]\s*)/,
				"$1" + timeBlock + " ",
			);
		} else {
			line = line.replace(
				/^(\s*[-*+]\s*\[[^\]]*\]\s*)\d{1,2}:\d{2}(?:\s*[—\-–]\s*\d{1,2}:\d{2})?\s*/,
				"$1",
			);
		}

		if (durMinutes > 0) {
			const durStr2 =
				durMinutes < 60 ? durMinutes + "m" : durMinutes / 60 + "h";
			if (line.match(/@\d+(?:\.\d+)?[hm]/)) {
				line = line.replace(/@\d+(?:\.\d+)?[hm]/, "@" + durStr2);
			} else {
				line += " @" + durStr2;
			}
		} else {
			line = line.replace(/@\d+(?:\.\d+)?[hm]\s*/, "");
		}

		lines[task.line] = line;
		await this.app.vault.modify(task.file, lines.join("\n"));
	}

	renderListView(): void {
		const today = new Date().toISOString().split("T")[0];
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
				const bar = renderProgressBar(totalHours, this.dailyCap, undefined, dayHeader);
				bar.addClass("ft-min-w-180");
				bar.addClass("ft-ml-12");
				dayHeader.appendChild(bar);
			}

			// Task list for this day
			for (const task of tasks) {
				this._renderTaskRow(section, task);
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

	_renderTaskRow(section: HTMLElement, task: WeekTask): void {
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
		const endPreview = timeCol.createEl("span", {
			text: "",
			cls: "ft-wp-end-preview",
		});
		const updateEnd = (): void => {
			const s = si.value;
			const d = this._parseDurStr(di.value);
			endPreview.setText(s && d > 0 ? "→" + this._calcEnd(s, d) : "");
		};
		const saveTime = (() => {
			let timer: ReturnType<typeof setTimeout>;
			return (): void => {
				window.clearTimeout(timer);
				timer = window.setTimeout(
					() => { void this._saveTaskTime(task, si, di); },
					300,
				);
			};
		})();
		si.addEventListener("input", () => {
			updateEnd();
			saveTime();
		});
		di.addEventListener("input", () => {
			updateEnd();
			saveTime();
		});
		updateEnd();

		// ── Checkbox ──
		const checkCol = row.createEl("div", { cls: "ft-wp-check" });
		const cb = checkCol.createEl("span", {
			cls: "ft-checkbox" + (task.status === "x" ? " ft-checked" : ""),
		});
		cb.addEventListener("click", () => {
			void (async () => {
				try {
					await this._toggleCheck(task);
					cb.toggleClass("ft-checked", task.status === "x");
					row.toggleClass("ft-wp-task-done", task.status === "x");
				} catch (e) {
					this.plugin.notify("❌ " + (e as Error).message, true);
				}
			})();
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
		textCol.createEl("span", {
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
				void this.app.workspace.openLinkText(task.file!.path, "", false, {
					eState: { line: task.line + 1 },
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
		let timerState: {
			remaining: number;
			total: number;
			running: boolean;
			interval: ReturnType<typeof setInterval>;
		} | null = null;
		timerBtn.addEventListener("click", () => {
			if (timerState && timerState.running) {
				// Stop
				window.clearInterval(timerState.interval);
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
				interval: window.setInterval(() => {
					if (!timerState) return;
					timerState.remaining -= 1;
					timerBtn.setText(formatTimer(Math.max(0, timerState.remaining)));
					if (timerState.remaining <= 0) {
						window.clearInterval(timerState.interval);
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
		delBtn.addEventListener("click", () => {
			void (async () => {
				await this._removeTask(task);
				row.remove();
				// Re-render to update totals
				await this.loadWeek();
				this.renderView();
			})();
		});
	}

	/* ─── task operations ─── */

	async _toggleCheck(task: WeekTask): Promise<void> {
		await toggleCheck(this.app.vault, task);
	}

	async _saveTaskTime(
		task: WeekTask,
		si: HTMLInputElement,
		di: HTMLInputElement,
	): Promise<void> {
		const start = si.value.trim();
		const durMinutes = parseDurStr(di.value.trim());
		await saveTimeWithDuration(this.app.vault, task, start, durMinutes);
		// Update in-memory task so grid view / next loadWeek uses fresh data
		const end = start && durMinutes > 0 ? calcEnd(start, durMinutes) : "";
		task.time = start ? (end ? `${start}—${end}` : start) : "";
		task.durationMinutes = durMinutes;
	}

	async _removeTask(task: WeekTask): Promise<void> {
		if (!task.file) return;

		// If it's a routine, mark in .generated.json so engine doesn't re-create
		if (task.isRoutine && this.plugin?.routineEngine) {
			await this.plugin.routineEngine.loadGenerated();
			// Remove the task line from the file
			await this._deleteTaskLine(task);
		} else {
			await this._deleteTaskLine(task);
		}
	}

	async _deleteTaskLine(task: WeekTask): Promise<void> {
		if (!task.file) return;
		const content = await this.app.vault.read(task.file);
		const lines = content.split("\n");
		if (lines[task.line] !== undefined) {
			lines[task.line] = ""; // Blank the line instead of removing (preserves line numbers for cache)
			await this.app.vault.modify(task.file, lines.join("\n"));
		}
	}

	_getWeekNumber(dateStr: string): number {
		const d = new Date(dateStr + "T12:00:00");
		d.setHours(0, 0, 0, 0);
		d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
		const week1 = new Date(d.getFullYear(), 0, 4);
		return (
			1 +
			Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
		);
	}

	_beep(): void {
		if (this.plugin?.settings?.timerSound === false) return;
		try {
			for (const [freq, delay] of [
				[880, 0],
				[660, 0.2],
			]) {
				const ctx = new AudioContext();
				const o = ctx.createOscillator();
				const g = ctx.createGain();
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
		} catch (_) {
			// Audio not available — silent fallback
		}
	}
}

export { WeekplanRenderer };
