const { Plugin, MarkdownRenderChild, Notice } = require("obsidian");

module.exports = class TaskPlannerTablePlugin extends Plugin {
	async onload() {
		for (const [name, mode] of [
			["task-planner", "today"],
			["task-planner-overdue", "overdue"],
			["task-planner-dueweek", "dueweek"],
		]) {
			this.registerMarkdownCodeBlockProcessor(name, (_src, el, ctx) => {
				ctx.addChild(new TaskPlannerRenderer(this.app, el, mode));
			});
		}
	}
};

const DUR_OPTS = [10, 15, 20, 25, 30, 45, 60, 90, 120, 150, 180, 210, 240];
const START_H = 7,
	START_END = 20;

class TaskPlannerRenderer extends MarkdownRenderChild {
	constructor(app, containerEl, mode) {
		super(containerEl);
		this.app = app;
		this.mode = mode || "today";
		this.tasks = [];
		this.rowData = [];
		this.startOpts = [];
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
			console.error("TP error:", e);
		}
	}

	/* ─── helpers ─── */
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

	_fmtDur(m) {
		return !m
			? "--"
			: m < 60
				? m + "m"
				: ((m / 60) % 1 === 0 ? m / 60 : (m / 60).toFixed(1)) + "h";
	}
	_calcEnd(s, d) {
		if (!s || !d) return "";
		const t = s.split(":").reduce((a, n) => +n + 60 * a, 0) + d;
		return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.round(t % 60)).padStart(2, "0")}`;
	}
	_fmtT(sec) {
		if (sec <= 0) return "00:00";
		const h = Math.floor(sec / 3600),
			m = Math.floor((sec % 3600) / 60),
			s = sec % 60;
		return h > 0
			? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
			: `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	}

	_clean(t) {
		return t
			.replace(/[⏳📅🛫➕✅] \d{4}-\d{2}-\d{2}/gu, "")
			.replace(/🔺|⏫|🔼|🔽|⏬/g, "")
			.replace(/🔁 [^\s]+( \d+[dwmy])?/g, "")
			.replace(/#\S+/g, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	_beep() {
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

	_sort() {
		this.tasks.sort((a, b) => {
			if (!a.time && !b.time) return 0;
			if (!a.time) return 1;
			if (!b.time) return -1;
			return a.time.localeCompare(b.time);
		});
	}

	/* ─── load ─── */
	async loadTasks() {
		const today = new Date().toISOString().split("T")[0];
		// End of current week — Sunday
		const eow = new Date();
		eow.setDate(eow.getDate() + ((7 - eow.getDay()) % 7));
		const eowStr = eow.toISOString().split("T")[0];

		this.tasks = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (file.path.startsWith(".obsidian") || file.path.startsWith(".git"))
				continue;
			const lines = (await this.app.vault.read(file)).split("\n");
			for (let i = 0; i < lines.length; i++) {
				const m = lines[i].match(/^(\s*[-*+]\s*\[([^\]]*)\]\s*)(.*)$/);
				if (!m) continue;
				const status = m[2].trim();
				if (status === "x" || status === "-" || status === "X") continue;

				const schedMatch = m[3].match(/⏳\s*(\d{4}-\d{2}-\d{2})/);
				const dueMatch = m[3].match(/📅\s*(\d{4}-\d{2}-\d{2})/);
				const taskDate = (schedMatch || [])[1] || "";
				const dueDate = (dueMatch || [])[1] || "";

				if (this.mode === "today" && taskDate !== today) continue;
				if (this.mode === "overdue" && (!taskDate || taskDate >= today))
					continue;
				if (this.mode === "dueweek") {
					const inWeek = (d, inclToday) =>
						d && (inclToday ? d >= today : d > today) && d <= eowStr;
					if (!inWeek(dueDate, true) && !inWeek(taskDate, false)) continue;
				}

				let time = "",
					rest = m[3];
				const tm = rest.match(
					/^(\d{1,2}:\d{2}(?:\s*[—\-–]\s*\d{1,2}:\d{2})?)\s*/,
				);
				if (tm) {
					time = tm[1];
					rest = rest.slice(tm[0].length);
				}

				this.tasks.push({
					file,
					line: i,
					rawLine: lines[i],
					time,
					taskDate,
					dueDate,
					rawText: rest.trim(),
					cleanText: this._clean(rest),
					status,
				});
			}
		}
		this._sort();
	}

	/* ─── render ─── */
	renderTable() {
		this.containerEl.empty();
		this.rowData = [];
		if (this.tasks.length === 0) {
			const msgs = {
				overdue: "🎉 No overdue tasks!",
				dueweek: "🎉 No tasks due this week!",
				today: "📭 No tasks scheduled for today. Add ⏳ today to any task.",
			};
			this.containerEl.createEl("p", {
				text: msgs[this.mode] || msgs.today,
				cls: "task-planner-empty",
			});
			return;
		}
		this.startOpts = this._timeOpts(START_H, START_END);
		const od = this.mode === "overdue",
			dw = this.mode === "dueweek";
		const toolbar = this.containerEl.createEl("div", { cls: "tp-toolbar" });

		const tdy = new Date().toISOString().split("T")[0];

		if (od || dw) {
			const mkBtn = (text, cls, fn) => {
				const b = toolbar.createEl("button", { text, cls });
				b.addEventListener("click", fn);
				return b;
			};
			mkBtn("📅 Assign All to Today", "tp-bulk-btn", async () => {
				for (const t of this.tasks) await this.updateDate(t, tdy);
				this.tasks = [];
				this.renderTable();
				new Notice("✅ All assigned to today");
			});
			if (od) {
				mkBtn("🗑 Backlog All", "tp-bulk-btn tp-bulk-remove", async () => {
					for (const t of this.tasks) await this.updateDate(t, "");
					this.tasks = [];
					this.renderTable();
					new Notice("🗑 All sent to backlog");
				});
			}
		} else {
			const sv = toolbar.createEl("button", {
				text: "💾 Save All",
				cls: "tp-save-all-btn",
			});
			sv.addEventListener("click", async () => {
				sv.setText("⏳ Saving...");
				let ok = 0,
					err = 0;
				for (const rd of this.rowData) {
					const s = rd.si.value,
						d = parseInt(rd.ds.value, 10);
					if (!s || !d || d <= 0) continue;
					const nt = `${s}—${this._calcEnd(s, d)}`;
					if (nt === rd.task.time) continue;
					try {
						await this.saveTime(rd.task, nt);
						rd.task.time = nt;
						ok++;
					} catch (_) {
						err++;
					}
				}
				if (ok + err > 0) {
					this._sort();
					this.buildRows(tbody);
				}
				const p = [];
				if (ok) p.push(`✅ ${ok} saved`);
				if (err) p.push(`❌ ${err} failed`);
				sv.setText(p.length ? p.join(" ") : "💾 Save All");
				if (p.length) new Notice(p.join(", "));
			});
		}

		const table = this.containerEl.createEl("table", {
			cls: "flowtime",
		});
		const hr = table.createEl("thead").createEl("tr");
		if (od || dw) {
			hr.createEl("th", { text: "Task", cls: "col-task" });
			hr.createEl("th", { text: "Source", cls: "col-source" });
			hr.createEl("th", { text: dw ? "Due" : "Date", cls: "col-date" });
			hr.createEl("th", { cls: "col-actions" });
		} else {
			hr.createEl("th", { text: "Time", cls: "col-time" });
			hr.createEl("th", { text: "Task", cls: "col-task" });
			hr.createEl("th", { text: "Source", cls: "col-source" });
			hr.createEl("th", { text: "Date", cls: "col-date" });
			hr.createEl("th", { text: "⏱", cls: "col-timer" });
		}
		const tbody = table.createEl("tbody");
		this.buildRows(tbody);
	}

	buildRows(tbody) {
		tbody.empty();
		this.rowData = [];
		document
			.querySelectorAll(".tp-start-dd,.tp-date-popup")
			.forEach((e) => e.remove());
		// Remove stale outside-click handler
		if (this._closePopups) {
			document.removeEventListener("click", this._closePopups, true);
			this._closePopups = null;
		}
		const tdy = new Date().toISOString().split("T")[0];
		const od = this.mode === "overdue",
			_dw = this.mode === "dueweek";

		for (const task of this.tasks) {
			const { start, dur } = this._parseStored(task.time);
			const row = tbody.createEl("tr");
			let si, ds; // startInput, durationSelect

			if (!od && !_dw) {
				const tc = row.createEl("td");
				const wr = tc.createEl("div", { cls: "tp-start-wrap" });
				si = wr.createEl("input", {
					type: "text",
					value: start || "",
					placeholder: "09:00",
					cls: "tp-start-input",
				});
				const tb = wr.createEl("button", { text: "▾", cls: "tp-start-toggle" });
				const dd = document.createElement("div");
				dd.className = "tp-start-dd";
				for (const t of this.startOpts) {
					const it = dd.createEl("button", { text: t, cls: "tp-dd-item" });
					if (t === start) it.addClass("tp-dd-sel");
					it.addEventListener("click", () => {
						si.value = t;
						cd();
						up();
					});
				}
				const od2 = () => {
					const r = wr.getBoundingClientRect();
					["left", "top"].forEach(
						(p) =>
							(dd.style[p] =
								r[p === "left" ? "left" : "bottom"] +
								(p === "left" ? 0 : 4) +
								"px"),
					);
					dd.style.width = Math.max(r.width, 80) + "px";
					dd.classList.add("tp-dd-open");
					document.body.appendChild(dd);
				};
				const cd = () => {
					dd.classList.remove("tp-dd-open");
					if (dd.parentNode) dd.parentNode.removeChild(dd);
				};
				tb.addEventListener("click", (e) => {
					e.stopPropagation();
					dd.classList.contains("tp-dd-open") ? cd() : od2();
				});
				si.addEventListener("focusout", (e) => {
					if (!wr.contains(e.relatedTarget)) cd();
				});

				tc.createEl("span", { text: "  +  ", cls: "tp-plus" });
				ds = tc.createEl("select", { cls: "tp-time-dur" });
				ds.createEl("option", { attr: { value: "" }, text: "--" });
				for (const d of DUR_OPTS) {
					const o = ds.createEl("option", {
						text: this._fmtDur(d),
						attr: { value: d },
					});
					if (d === dur) o.selected = true;
				}
				const ps = tc.createEl("span", { text: "", cls: "tp-preview" });
				const up = () => {
					const s = si.value,
						d = parseInt(ds.value, 10);
					ps.setText(s && d > 0 ? "→ " + this._calcEnd(s, d) : "");
				};
				si.addEventListener("input", up);
				ds.addEventListener("change", up);
				up();
			}

			row.createEl("td", { text: task.cleanText, cls: "tp-task-text" });
			const sc = row.createEl("td", { cls: "tp-source" });
			const lnk = sc.createEl("a", {
				text: task.file.basename,
				cls: "tp-source-link",
			});
			lnk.addEventListener("click", () =>
				this.app.workspace.openLinkText(task.file.path, "", false, {
					line: task.line + 1,
				}),
			);

			/* Date cell (shared) */
			const dc = row.createEl("td", { cls: "tp-date-cell" });
			const dw = dc.createEl("div", { cls: "tp-date-wrap" });
			const dispDate = _dw
				? task.dueDate || task.taskDate || "+"
				: task.taskDate || "+";
			const hasDate = _dw ? task.dueDate || task.taskDate : task.taskDate;
			const ds2 = dw.createEl("span", {
				text: dispDate,
				cls: "tp-date-badge" + (hasDate ? "" : " tp-date-none"),
			});
			const dp = document.createElement("div");
			dp.className = "tp-date-popup";
			const dpi = dp.createEl("input", {
				type: "date",
				value: task.taskDate || "",
				cls: "tp-dp-input",
			});
			const mkDpBtn = (txt, cls) => dp.createEl("button", { text: txt, cls });
			const bTdy = mkDpBtn("Today", "tp-dp-btn"),
				bTmw = mkDpBtn("Tomorrow", "tp-dp-btn"),
				bNw = mkDpBtn("Next Week", "tp-dp-btn"),
				bBkl = mkDpBtn("✕ Backlog", "tp-dp-btn tp-dp-remove");
			const fmt = (d) => d.toISOString().split("T")[0];
			// Register one document capture handler for all popups
			if (!this._closePopups) {
				this._closePopups = (ev) => {
					document.querySelectorAll(".tp-date-popup.tp-dp-open").forEach((p) => {
						if (p.contains(ev.target) || (p._badge && p._badge.contains(ev.target))) return;
						p.classList.remove("tp-dp-open");
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
				dp.classList.add("tp-dp-open");
				document.body.appendChild(dp);
			};
			const cp = () => {
				dp.classList.remove("tp-dp-open");
				if (dp.parentNode) dp.parentNode.removeChild(dp);
			};
			ds2.addEventListener("click", (e) => {
				e.stopPropagation();
				dp.classList.contains("tp-dp-open") ? cp() : op();
			});
			const ap = async (nd) => {
				cp();
				try {
					await this.updateDate(task, nd);
					task.taskDate = nd;
					if (nd && nd === tdy) {
						const newDisp = _dw ? task.dueDate || nd : nd;
						ds2.setText(newDisp);
						ds2.removeClass("tp-date-none");
					} else {
						row.remove();
						this.tasks = this.tasks.filter((t) => t !== task);
						this.rowData = this.rowData.filter((r) => r.task !== task);
						if (!this.tasks.length) this.renderTable();
					}
				} catch (e) {
					new Notice("❌ " + e.message);
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

			/* Timer (today) or action buttons (overdue) */
			if (od || _dw) {
				const ac = row.createEl("td", { cls: "tp-actions-cell" });
				const aw = ac.createEl("div", { cls: "tp-actions-wrap" });
				const abTdy = aw.createEl("button", {
					text: "📅 Today",
					cls: "tp-act-btn",
				});
				abTdy.addEventListener("click", async () => {
					await this.updateDate(task, tdy);
					row.remove();
					this.tasks = this.tasks.filter((t) => t !== task);
					if (!this.tasks.length) this.renderTable();
				});
				if (od) {
					const abBkl = aw.createEl("button", {
						text: "🗑 Backlog",
						cls: "tp-act-btn tp-act-remove",
					});
					abBkl.addEventListener("click", async () => {
						await this.updateDate(task, "");
						row.remove();
						this.tasks = this.tasks.filter((t) => t !== task);
						if (!this.tasks.length) this.renderTable();
					});
				} else {
					const abDue = aw.createEl("button", {
						text: "📅 On Due",
						cls: "tp-act-btn",
					});
					abDue.addEventListener("click", async () => {
						if (!task.dueDate) return;
						await this.updateDate(task, task.dueDate);
						row.remove();
						this.tasks = this.tasks.filter((t) => t !== task);
						if (!this.tasks.length) this.renderTable();
					});
				}
			} else {
				const ts = {
					remaining: (dur || 0) * 60,
					total: (dur || 0) * 60,
					interval: null,
					running: false,
				};
				const tmr = row.createEl("td", { cls: "tp-timer-cell" });
				const tr2 = tmr.createEl("div", { cls: "tp-timer-row" });
				const pb = tr2.createEl("button", { text: "▶", cls: "tp-timer-play" });
				const disp = tr2.createEl("span", {
					text: this._fmtT(ts.remaining),
					cls: "tp-timer-display",
				});
				const rb = tr2.createEl("button", { text: "↺", cls: "tp-timer-reset" });
				const ud = () => {
					disp.setText(this._fmtT(ts.remaining));
					disp.toggleClass("tp-timer-expired", ts.remaining <= 0);
				};
				const stp = () => {
					if (ts.interval) {
						clearInterval(ts.interval);
						ts.interval = null;
					}
					ts.running = false;
					pb.setText("▶");
				};
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
							disp.addClass("tp-timer-expired");
							new Notice("⏰ Time's up! " + task.cleanText);
							this._beep();
						}
					}, 1000);
				};
				pb.addEventListener("click", () => {
					const dm = parseInt(ds.value, 10);
					if (!dm || dm <= 0) return;
					if (ts.running) {
						stp();
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
					stp();
					const dm = parseInt(ds.value, 10);
					ts.remaining = dm && dm > 0 ? dm * 60 : 0;
					ts.total = ts.remaining;
					ud();
				});
				ds.addEventListener("change", () => {
					stp();
					const dm = parseInt(ds.value, 10);
					ts.remaining = dm && dm > 0 ? dm * 60 : 0;
					ts.total = ts.remaining;
					ud();
				});
			}
			if (!od) this.rowData.push({ task, si, ds });
		}
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
			const re = /⏳\s*\d{4}-\d{2}-\d{2}/;
			lines[task.line] = re.test(line)
				? line.replace(re, "⏳ " + nd)
				: line.replace(
						/^(\s*[-*+]\s*\[[^\]]*\]\s*)(.*)$/,
						(_, p, r) => p + r + " ⏳ " + nd,
					);
		} else {
			lines[task.line] = line.replace(/\s*⏳\s*\d{4}-\d{2}-\d{2}/, "");
		}
		await this.app.vault.modify(task.file, lines.join("\n"));
	}
}
