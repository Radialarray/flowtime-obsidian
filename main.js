const { Plugin, MarkdownRenderChild, Notice } = require("obsidian");

module.exports = class TaskPlannerTablePlugin extends Plugin {
	async onload() {
		this.registerMarkdownCodeBlockProcessor(
			"task-planner",
			(_source, el, ctx) => {
				ctx.addChild(new TaskPlannerRenderer(this.app, el));
			},
		);
	}
};

class TaskPlannerRenderer extends MarkdownRenderChild {
	constructor(app, containerEl) {
		super(containerEl);
		this.app = app;
		this.tasks = [];
		this.rowData = [];
		this.startOpts = [];
		this.durationOpts = [
			10, 15, 20, 25, 30, 45, 60, 90, 120, 150, 180, 210, 240,
		];
	}

	async onload() {
		try {
			await this.loadTasks();
			this.renderTable();
		} catch (e) {
			this.containerEl.createEl("p", {
				text: "⚠️ Error: " + e.message,
				cls: "task-planner-empty",
			});
			console.error("Flowtime error:", e);
		}
	}

	_timeOpts(startH, endH) {
		const opts = [];
		for (let h = startH; h <= endH; h++) {
			for (let m = 0; m < 60; m += 30) {
				opts.push(
					`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
				);
			}
		}
		return opts;
	}

	_parseStoredTime(t) {
		if (!t) return { start: "", duration: 0 };
		const m = t.match(/^(\d{1,2}:\d{2})\s*[—\-–]\s*(\d{1,2}:\d{2})$/);
		if (!m) return { start: "", duration: 0 };
		const [sh, sm] = m[1].split(":").map(Number);
		const [eh, em] = m[2].split(":").map(Number);
		const durMin = eh * 60 + em - (sh * 60 + sm);
		const snapped = this.durationOpts.reduce((a, b) =>
			Math.abs(b - durMin) < Math.abs(a - durMin) ? b : a,
		);
		return { start: m[1], duration: durMin > 0 ? snapped : 0 };
	}

	_fmtDur(min) {
		if (!min) return "--";
		if (min < 60) return min + "m";
		const h = min / 60;
		return (h % 1 === 0 ? h : h.toFixed(1)) + "h";
	}

	_calcEndTime(start, durationMin) {
		if (!start || !durationMin) return "";
		const [h, m] = start.split(":").map(Number);
		const total = h * 60 + m + durationMin;
		const eh = Math.floor(total / 60);
		const em = Math.round(total % 60);
		return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
	}

	_cleanTaskText(text) {
		return text
			.replace(/[⏳📅🛫➕✅] \d{4}-\d{2}-\d{2}/gu, "")
			.replace(/🔺|⏫|🔼|🔽|⏬/g, "")
			.replace(/🔁 [^\s]+( \d+[dwmy])?/g, "")
			.replace(/#\S+/g, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	_fmtTime(seconds) {
		if (seconds <= 0) return "00:00";
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		const s = seconds % 60;
		if (h > 0)
			return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
		return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	}

	_playBeep() {
		try {
			const ctx = new AudioContext();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.frequency.value = 880;
			gain.gain.setValueAtTime(0.3, ctx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
			osc.start(ctx.currentTime);
			// Second beep
			const osc2 = ctx.createOscillator();
			const gain2 = ctx.createGain();
			osc2.connect(gain2);
			gain2.connect(ctx.destination);
			osc2.frequency.value = 660;
			gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.2);
			gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
			osc2.start(ctx.currentTime + 0.2);
		} catch (e) {
			/* Audio not available */
		}
	}

	_sortTasks() {
		this.tasks.sort((a, b) => {
			if (!a.time && !b.time) return 0;
			if (!a.time) return 1;
			if (!b.time) return -1;
			return a.time.localeCompare(b.time);
		});
	}

	async loadTasks() {
		const today = new Date().toISOString().split("T")[0];
		const files = this.app.vault.getMarkdownFiles();
		const dateStr = `⏳ ${today}`;
		this.tasks = [];

		for (const file of files) {
			if (file.path.startsWith(".obsidian") || file.path.startsWith(".git"))
				continue;
			const content = await this.app.vault.read(file);
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const taskMatch = line.match(/^(\s*[-*+]\s*\[([^\]]*)\]\s*)(.*)$/);
				if (!taskMatch) continue;
				const status = taskMatch[2].trim();
				const rest = taskMatch[3];
				if (!rest.includes(dateStr)) continue;
				if (status === "x" || status === "-" || status === "X") continue;

				let time = "";
				let rawText = rest;
				const timeMatch = rest.match(
					/^(\d{1,2}:\d{2}(?:\s*[—\-–]\s*\d{1,2}:\d{2})?)\s*/,
				);
				if (timeMatch) {
					time = timeMatch[1];
					rawText = rest.slice(timeMatch[0].length);
				}

				this.tasks.push({
					file,
					line: i,
					rawLine: line,
					time,
					rawText: rawText.trim(),
					cleanText: this._cleanTaskText(rawText),
					status,
				});
			}
		}

		this._sortTasks();
	}

	renderTable() {
		this.containerEl.empty();
		this.rowData = [];

		if (this.tasks.length === 0) {
			this.containerEl.createEl("p", {
				text: "📭 No tasks scheduled for today. Add ⏳ today to any task.",
				cls: "task-planner-empty",
			});
			return;
		}

		this.startOpts = this._timeOpts(7, 20);

		// Toolbar
		const toolbar = this.containerEl.createEl("div", { cls: "tp-toolbar" });
		const saveAllBtn = toolbar.createEl("button", {
			text: "💾 Save All",
			cls: "tp-save-all-btn",
		});

		// Table
		const table = this.containerEl.createEl("table", {
			cls: "flowtime",
		});
		const thead = table.createEl("thead");
		const hr = thead.createEl("tr");
		hr.createEl("th", { text: "Time", cls: "col-time" });
		hr.createEl("th", { text: "Task", cls: "col-task" });
		hr.createEl("th", { text: "Source", cls: "col-source" });
		hr.createEl("th", { text: "⏱", cls: "col-timer" });

		const tbody = table.createEl("tbody");
		this.buildRows(tbody);

		// Save All
		saveAllBtn.addEventListener("click", async () => {
			saveAllBtn.setText("⏳ Saving...");
			let saved = 0,
				errors = 0;

			for (const rd of this.rowData) {
				const start = rd.startInput.value;
				const dur = parseInt(rd.durationSelect.value, 10);
				if (!start || !dur || dur <= 0) continue;
				const end = this._calcEndTime(start, dur);
				const newTime = `${start}—${end}`;
				if (newTime === rd.task.time) continue;

				try {
					await this.saveTime(rd.task, newTime);
					rd.task.time = newTime;
					saved++;
				} catch (e) {
					errors++;
				}
			}

			if (saved > 0 || errors > 0) {
				this._sortTasks();
				this.buildRows(tbody);
			}

			const parts = [];
			if (saved > 0) parts.push(`✅ ${saved} saved`);
			if (errors > 0) parts.push(`❌ ${errors} failed`);
			saveAllBtn.setText(parts.length ? parts.join(" ") : "💾 Save All");
			if (parts.length) {
				new Notice(parts.join(", "));
				if (parts.length === 1)
					setTimeout(() => saveAllBtn.setText("💾 Save All"), 2000);
			}
		});
	}

	buildRows(tbody) {
		tbody.empty();
		this.rowData = [];
		// Clean up orphaned dropdowns from previous renders
		document.querySelectorAll(".tp-start-dd").forEach((el) => el.remove());

		for (const task of this.tasks) {
			const { start, duration } = this._parseStoredTime(task.time);
			const row = tbody.createEl("tr");

			// --- Time cell ---
			const timeCell = row.createEl("td");
			// --- Start time: custom dropdown with free typing ---
			const startWrap = timeCell.createEl("div", { cls: "tp-start-wrap" });
			const startInput = startWrap.createEl("input", {
				type: "text",
				value: start || "",
				placeholder: "09:00",
				cls: "tp-start-input",
			});
			const toggleBtn = startWrap.createEl("button", {
				text: "▾",
				cls: "tp-start-toggle",
			});
			// Dropdown as body child for proper layering
			const dd = document.createElement("div");
			dd.className = "tp-start-dd";
			for (const t of this.startOpts) {
				const item = dd.createEl("button", {
					text: t,
					cls: "tp-dd-item",
				});
				if (t === start) item.addClass("tp-dd-sel");
				item.addEventListener("click", () => {
					startInput.value = t;
					closeDd();
					updatePreview();
				});
			}

			const openDd = () => {
				const r = startWrap.getBoundingClientRect();
				dd.style.left = r.left + "px";
				dd.style.top = r.bottom + 4 + "px";
				dd.style.width = Math.max(r.width, 80) + "px";
				dd.classList.add("tp-dd-open");
				document.body.appendChild(dd);
			};

			const closeDd = () => {
				dd.classList.remove("tp-dd-open");
				if (dd.parentNode) dd.parentNode.removeChild(dd);
			};

			toggleBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				if (dd.classList.contains("tp-dd-open")) {
					closeDd();
				} else {
					openDd();
				}
			});

			// Close when focus leaves the wrapper
			startInput.addEventListener("focusout", (e) => {
				if (!startWrap.contains(e.relatedTarget)) closeDd();
			});

			timeCell.createEl("span", { text: "  +  ", cls: "tp-plus" });

			const durationSelect = timeCell.createEl("select", {
				cls: "tp-time-dur",
			});
			durationSelect.createEl("option", { attr: { value: "" }, text: "--" });
			for (const d of this.durationOpts) {
				const opt = durationSelect.createEl("option", {
					text: this._fmtDur(d),
					attr: { value: d },
				});
				if (d === duration) opt.selected = true;
			}

			const previewSpan = timeCell.createEl("span", {
				text: "",
				cls: "tp-preview",
			});
			const updatePreview = () => {
				const s = startInput.value;
				const d = parseInt(durationSelect.value, 10);
				previewSpan.setText(s && d > 0 ? "→ " + this._calcEndTime(s, d) : "");
			};
			startInput.addEventListener("input", updatePreview);
			durationSelect.addEventListener("change", updatePreview);
			updatePreview();

			// --- Task description ---
			row.createEl("td", { text: task.cleanText, cls: "tp-task-text" });

			// --- Source file link ---
			const sourceCell = row.createEl("td", { cls: "tp-source" });
			const link = sourceCell.createEl("a", {
				text: task.file.basename,
				cls: "tp-source-link",
			});
			link.addEventListener("click", () => {
				this.app.workspace.openLinkText(task.file.path, "", false, {
					line: task.line + 1,
				});
			});

			// --- Countdown timer ---
			const timerState = {
				remaining: (duration > 0 ? duration : 0) * 60, // seconds
				total: (duration > 0 ? duration : 0) * 60,
				interval: null,
				isRunning: false,
			};

			const timerCell = row.createEl("td", { cls: "tp-timer-cell" });
			const timerRow = timerCell.createEl("div", { cls: "tp-timer-row" });

			const playBtn = timerRow.createEl("button", {
				text: "▶",
				cls: "tp-timer-play",
			});

			const displaySpan = timerRow.createEl("span", {
				text: this._fmtTime(timerState.remaining),
				cls: "tp-timer-display",
			});

			const resetBtn = timerRow.createEl("button", {
				text: "↺",
				cls: "tp-timer-reset",
			});

			const updateDisplay = () => {
				displaySpan.setText(this._fmtTime(timerState.remaining));
				if (timerState.remaining <= 0) {
					displaySpan.addClass("tp-timer-expired");
				} else {
					displaySpan.removeClass("tp-timer-expired");
				}
			};

			const stopTimer = () => {
				if (timerState.interval) {
					clearInterval(timerState.interval);
					timerState.interval = null;
				}
				timerState.isRunning = false;
				playBtn.setText("▶");
			};

			const startTimer = () => {
				if (timerState.remaining <= 0) return;
				timerState.isRunning = true;
				playBtn.setText("⏸");
				timerState.interval = setInterval(() => {
					timerState.remaining--;
					updateDisplay();

					if (timerState.remaining <= 0) {
						stopTimer();
						timerState.remaining = 0;
						updateDisplay();
						displaySpan.addClass("tp-timer-expired");
						new Notice("⏰ Time's up! " + task.cleanText);
						this._playBeep();
					}
				}, 1000);
			};

			playBtn.addEventListener("click", () => {
				const durMin = parseInt(durationSelect.value, 10);
				if (!durMin || durMin <= 0) return;

				if (timerState.isRunning) {
					stopTimer();
				} else {
					// If timer has expired or never started, reset to current duration
					if (timerState.remaining <= 0) {
						timerState.remaining = durMin * 60;
						timerState.total = durMin * 60;
						updateDisplay();
					}
					startTimer();
				}
			});

			resetBtn.addEventListener("click", () => {
				stopTimer();
				const durMin = parseInt(durationSelect.value, 10);
				timerState.remaining = durMin && durMin > 0 ? durMin * 60 : 0;
				timerState.total = timerState.remaining;
				updateDisplay();
			});

			// Reset timer when duration changes
			durationSelect.addEventListener("change", () => {
				stopTimer();
				const durMin = parseInt(durationSelect.value, 10);
				timerState.remaining = durMin && durMin > 0 ? durMin * 60 : 0;
				timerState.total = timerState.remaining;
				updateDisplay();
				updatePreview();
			});

			this.rowData.push({ task, startInput, durationSelect });
		}
	}

	async saveTime(task, time) {
		const content = await this.app.vault.read(task.file);
		const lines = content.split("\n");
		const line = lines[task.line];
		if (!line) throw new Error("Task line not found");

		const match = line.match(/^(\s*[-*+]\s*\[[^\]]*\]\s*)(.*)$/);
		if (!match) throw new Error("Could not parse task line");

		const prefix = match[1];
		let rest = match[2];
		rest = rest.replace(/^\d{1,2}:\d{2}(\s*[—\-–]\s*\d{1,2}:\d{2})?\s*/, "");
		lines[task.line] = time ? `${prefix}${time} ${rest}` : `${prefix}${rest}`;

		await this.app.vault.modify(task.file, lines.join("\n"));
	}
}
