const { MarkdownRenderChild, Notice } = require("obsidian");

const DUR_OPTS = [10, 15, 20, 25, 30, 45, 60, 90, 120, 150, 180, 210, 240];
const START_H = 7;
const START_END = 20;

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
	}

	async onload() {
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
			.replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/gu, "")
			.replace(/🔺|⏫|🔼|🔽|⏬/g, "")
			.replace(/🔁 every \d* (day|days|week|weeks|month|months)/g, "")
			.replace(/🔁 [^\s]+( \d+[dwmy])?/g, "")
			.replace(/#\S+/g, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	_getMonday(d) {
		const date = new Date(d);
		const day = date.getDay();
		const diff = day === 0 ? -6 : 1 - day;
		date.setDate(date.getDate() + diff);
		return date.toISOString().split("T")[0];
	}
	_getSunday(d) {
		const monday = new Date(this._getMonday(d));
		monday.setDate(monday.getDate() + 6);
		return monday.toISOString().split("T")[0];
	}
	_parseRecurrence(text) {
		const match = text.match(/🔁\s*every\s+(\d*)\s*(day|days|week|weeks|month|months)/);
		if (!match) return null;
		const n = parseInt(match[1] || "1", 10);
		const unit = match[2].replace(/s$/, "");
		return { interval: n, unit };
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

		// Weekly boundaries
		const mon = this._getMonday(today);
		const sun = this._getSunday(today);

		// Project mode: resolve source file's project first
		let targetProject = null;
		if (this.mode === "project") {
			if (this.sourcePath && this.projectEngine) {
				const sp = await this.projectEngine.resolve(this.sourcePath);
				targetProject = sp?.name || null;
			}
			// If source has no project, show nothing
			if (!targetProject) {
				this.tasks = [];
				return;
			}
		}

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

				const dateMatch = m[3].match(/[@⏳📅]\s*(\d{4}-\d{2}-\d{2})/);
				const taskDate = (dateMatch || [])[1] || "";

				if (this.mode === "today" && taskDate !== today) continue;
				if (this.mode === "overdue" && (!taskDate || taskDate >= today))
					continue;
				if (this.mode === "dueweek") {
					if (!taskDate || taskDate < today || taskDate > eowStr) continue;
				}
				if (this.mode === "weekly") {
					if (!taskDate || taskDate < mon || taskDate > sun) continue;
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

				// Extract priority before cleaning
				let priority = null;
				const prioMatch = rest.match(/[🔺⏫🔼🔽⏬]/);
				if (prioMatch) priority = prioMatch[0];

				const project = this.projectEngine
					? await this.projectEngine.resolve(file.path)
					: null;

				// Fallback: check task text for #project/xxx tag
				let projName = project?.name || null;
				let projPath = project?.path || null;
				let projSource = project?.source || null;
				if (!projName && this.projectEngine && rest) {
					const tagPrefix = this.plugin?.settings?.tagPrefix || "project/";
					const tagProject = this.projectEngine.resolveFromTag(rest, tagPrefix);
					if (tagProject) {
						projName = tagProject;
						projSource = "tag";
					}
				}

				// Project mode: skip tasks not matching target project
				if (this.mode === "project") {
					if (projName !== targetProject) continue;
				}

				this.tasks.push({
					file,
					line: i,
					rawLine: lines[i],
					time,
					taskDate,
					rawText: rest.trim(),
					cleanText: this._clean(rest),
					status,
					priority,
					project: projName,
					projectPath: projPath,
					projectSource: projSource,
				});
			}
		}

		if (this.mode === "weekly") {
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
	}

	/* ─── render ─── */
	renderTable() {
		this.containerEl.empty();
		this.rowData = [];
		if (this.tasks.length === 0) {
			const msgs = {
				overdue: "🎉 No overdue tasks!",
				dueweek: "🎉 No tasks due this week!",
				weekly: "🎉 No tasks scheduled this week!",
				project: "📭 No tasks for this project.",
				today: "📭 No tasks scheduled for today. Add @today to any task.",
			};
			this.containerEl.createEl("p", {
				text: msgs[this.mode] || msgs.today,
				cls: "flowtime-empty",
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
			today: "💡 Set times and durations — edits save to source files",
			overdue: "📋 Tasks past their scheduled date — reassign or backlog",
			dueweek: "⚠️ Tasks due this week — schedule or defer",
			weekly: "📊 This week's tasks grouped by project",
			project: "📁 Tasks for this project",
		};
		const heading = headings[this.mode];
		const tdy = new Date().toISOString().split("T")[0];

		const bar = this.containerEl.createEl("div", { cls: "ft-topbar" });
		if (heading) {
			bar.createEl("span", { text: heading, cls: "ft-heading-text" });
		}
		const toolbar = bar.createEl("div", { cls: "ft-toolbar" });

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
		} else {
			const sv = toolbar.createEl("button", {
				text: "💾 Save All",
				cls: "ft-save-all-btn",
			});
			sv.addEventListener("click", async () => {
				sv.setText("⏳ Saving...");
				let ok = 0, err = 0;
				for (const rd of this.rowData) {
					if (!rd.si || !rd.ds) continue;
					const s = rd.si.value,
						d = parseInt(rd.ds.value, 10);
					if (!s || !d || d <= 0) continue;
					const nt = `${s}—${this._calcEnd(s, d)}`;
					if (nt === rd.task.time) continue;
					try {
						await this.saveTime(rd.task, nt);
						rd.task.time = nt;
						ok++;
					} catch (_) { err++; }
				}
				if (ok + err > 0) {
					this._sort();
					const tbody = this.containerEl.querySelector("tbody");
					if (tbody) this.buildRows(tbody);
				}
				const p = [];
				if (ok) p.push(`✅ ${ok} saved`);
				if (err) p.push(`❌ ${err} failed`);
				sv.setText(p.length ? p.join(" ") : "💾 Save All");
				if (p.length) this.plugin?.notify?.(p.join(", "), err > 0);
			});
		}

		const table = this.containerEl.createEl("table", {
			cls: "flowtime-table",
		});
		const hr = table.createEl("thead").createEl("tr");
		if (isCompact) {
			hr.createEl("th", { text: "✓", cls: "col-check" });
			hr.createEl("th", { text: "Task", cls: "col-task" });
			hr.createEl("th", { text: "Project", cls: "col-project" });
			hr.createEl("th", { text: "Source", cls: "col-source" });
			hr.createEl("th", { text: dw ? "Due" : "Date", cls: "col-date" });
			hr.createEl("th", { cls: "col-actions" });
		} else {
			hr.createEl("th", { text: "Time", cls: "col-time" });
			hr.createEl("th", { text: "✓", cls: "col-check" });
			hr.createEl("th", { text: "Task", cls: "col-task" });
			hr.createEl("th", { text: "Project", cls: "col-project" });
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
			.querySelectorAll(".ft-start-dd,.ft-date-popup")
			.forEach((e) => e.remove());
		// Remove stale outside-click handler
		if (this._closePopups) {
			document.removeEventListener("click", this._closePopups, true);
			this._closePopups = null;
		}
		const tdy = new Date().toISOString().split("T")[0];
		const od = this.mode === "overdue",
			_dw = this.mode === "dueweek",
			wk = this.mode === "weekly",
			pj = this.mode === "project";
		const isCompact = od || _dw || wk;

		// Weekly: group rows by project with header rows
		if (wk) {
			const groups = {};
			for (const task of this.tasks) {
				const key = task.project || "__none__";
				if (!groups[key]) groups[key] = [];
				groups[key].push(task);
			}
			for (const [proj, projTasks] of Object.entries(groups)) {
				const gr = tbody.createEl("tr", { cls: "ft-project-group" });
				gr.createEl("td", {
					text: proj === "__none__" ? "Other" : proj,
					attr: { colspan: "6" },
				});
				for (const task of projTasks) {
					this._renderTaskRow(tbody, task, tdy, od, _dw, wk, pj, isCompact);
				}
			}
			return;
		}

		for (const task of this.tasks) {
			this._renderTaskRow(tbody, task, tdy, od, _dw, wk, pj, isCompact);
		}
	}

	/* Single row builder for all modes */
	_renderTaskRow(tbody, task, tdy, od, _dw, wk, pj, isCompact) {
		const { start, dur } = this._parseStored(task.time);
		const row = tbody.createEl("tr");
		let si, ds; // startInput, durationSelect

		if (!isCompact) {
			const tc = row.createEl("td");
			const wr = tc.createEl("div", { cls: "ft-start-wrap" });
			si = wr.createEl("input", {
				type: "text",
				value: start || "",
				placeholder: "09:00",
				cls: "ft-start-input",
			});
			const tb = wr.createEl("button", { text: "▾", cls: "ft-start-toggle" });
			const dd = document.createElement("div");
			dd.className = "ft-start-dd";
			for (const t of this.startOpts) {
				const it = dd.createEl("button", { text: t, cls: "ft-dd-item" });
				if (t === start) it.addClass("ft-dd-sel");
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
				dd.classList.add("ft-dd-open");
				document.body.appendChild(dd);
			};
			const cd = () => {
				dd.classList.remove("ft-dd-open");
				if (dd.parentNode) dd.parentNode.removeChild(dd);
			};
			tb.addEventListener("click", (e) => {
				e.stopPropagation();
				dd.classList.contains("ft-dd-open") ? cd() : od2();
			});
			si.addEventListener("focusout", (e) => {
				if (!wr.contains(e.relatedTarget)) cd();
			});

			tc.createEl("span", { text: "  +  ", cls: "ft-plus" });
			ds = tc.createEl("select", { cls: "ft-time-dur" });
			ds.createEl("option", { attr: { value: "" }, text: "--" });
			for (const d of DUR_OPTS) {
				const o = ds.createEl("option", {
					text: this._fmtDur(d),
					attr: { value: d },
				});
				if (d === dur) o.selected = true;
			}
			const ps = tc.createEl("span", { text: "", cls: "ft-preview" });
			const up = () => {
				const s = si.value,
					d = parseInt(ds.value, 10);
				ps.setText(s && d > 0 ? "→ " + this._calcEnd(s, d) : "");
			};
			si.addEventListener("input", up);
			ds.addEventListener("change", up);
			up();
		}

		// Checkbox column
		this._buildCheckCell(row, task);

		// Task cell: priority + text
		this._buildTaskCell(row, task);

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

		/* Date cell (shared) */
		const dc = row.createEl("td", { cls: "ft-date-cell" });
		const dw = dc.createEl("div", { cls: "ft-date-wrap" });
		const dispDate = task.taskDate || "+";
		const hasDate = task.taskDate;
		const ds2 = dw.createEl("span", {
			text: dispDate,
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
					ds2.setText(nd);
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

		/* Timer (today) or action buttons (compact) */
		if (isCompact) {
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
		} else {
			const ts = {
				remaining: (dur || 0) * 60,
				total: (dur || 0) * 60,
				interval: null,
				running: false,
			};
			const tmr = row.createEl("td", { cls: "ft-timer-cell" });
			const tr2 = tmr.createEl("div", { cls: "ft-timer-row" });
			const pb = tr2.createEl("button", { text: "▶", cls: "ft-timer-play" });
			const disp = tr2.createEl("span", {
				text: this._fmtT(ts.remaining),
				cls: "ft-timer-display",
			});
			const rb = tr2.createEl("button", { text: "↺", cls: "ft-timer-reset" });
			const ud = () => {
				disp.setText(this._fmtT(ts.remaining));
				disp.toggleClass("ft-timer-expired", ts.remaining <= 0);
			};
			const stp = () => {
				if (ts.interval) {
					clearInterval(ts.interval);
					ts.interval = null;
				}
				ts.running = false;
				pb.setText("▶");
				if (this.plugin?.stopStatusTimer) {
					this.plugin.stopStatusTimer();
				}
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
						disp.addClass("ft-timer-expired");
						this.plugin?.notify?.("⏰ Time's up! " + task.cleanText);
						if (this.plugin?.settings?.timerSound !== false) {
							this._beep();
						}
						if (this.plugin?.stopStatusTimer) {
							this.plugin.stopStatusTimer();
						}
					}
				}, 1000);
				// Sync with status bar
				if (this.plugin?.startStatusTimer) {
					const dm = parseInt(ds.value, 10);
					this.plugin.startStatusTimer(task.cleanText, dm * 60);
				}
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
		if (!isCompact) this.rowData.push({ task, si, ds });
	}

	/* Build task cell with priority + text (checkbox is separate column) */
	_buildTaskCell(row, task) {
		const tc = row.createEl("td", { cls: "ft-task-cell" });
		if (task.priority) {
			tc.createEl("span", { text: task.priority, cls: "ft-priority" });
		}
		const textEl = tc.createEl("span", { text: task.cleanText, cls: "ft-task-text" });
		if (task.status === "x" || task.status === "X") {
			row.addClass("ft-task-done");
			textEl.addClass("ft-task-done-text");
		}
	}

	/* Build checkbox cell as dedicated column */
	_buildCheckCell(row, task) {
		const cc = row.createEl("td", { cls: "ft-check-cell" });
		const chk = cc.createEl("span", {
			text: task.status === "x" || task.status === "X" ? "☑" : "☐",
			cls: "ft-checkbox",
		});
		chk.addEventListener("click", async (e) => {
			e.stopPropagation();
			await this.toggleTaskComplete(task);
		});
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
			const re = /[@⏳📅]\s*\d{4}-\d{2}-\d{2}/;
			lines[task.line] = re.test(line)
				? line.replace(re, "@" + nd)
				: line.replace(
						/^(\s*[-*+]\s*\[[^\]]*\]\s*)(.*)$/,
						(_, p, r) => p + r + " @" + nd,
					);
		} else {
			lines[task.line] = line.replace(/\s*[@⏳📅]\s*\d{4}-\d{2}-\d{2}/, "");
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
	async toggleTaskComplete(task) {
		const content = await this.app.vault.read(task.file);
		const lines = content.split("\n");
		const line = lines[task.line];
		if (!line) return;

		const wasCompleted = /\[(x|X)\]/.test(line);
		const newLine = wasCompleted
			? line.replace(/\[(x|X)\]/, "[ ]")
			: line.replace(/\[ \]/, "[x]");
		lines[task.line] = newLine;
		await this.app.vault.modify(task.file, lines.join("\n"));

		// Toggle status in memory
		task.status = wasCompleted ? " " : "x";

		// Handle recurrence if completing
		if (!wasCompleted) {
			await this._handleRecurrence(task, newLine);
		}

		// Rebuild to reflect new status — keep task in table
		const tbody = this.containerEl.querySelector("tbody");
		if (tbody) this.buildRows(tbody);
		await this._refreshSiblings();
	}

	/* ─── recurrence ─── */
	async _handleRecurrence(task, completedLine) {
		const rec = this._parseRecurrence(completedLine);
		if (!rec) return;

		let baseDate = task.taskDate
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
			.replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/, "@" + nextDate);

		const content = await this.app.vault.read(task.file);
		const lines = content.split("\n");
		lines.splice(task.line + 1, 0, newTaskLine);
		await this.app.vault.modify(task.file, lines.join("\n"));
	}
}

module.exports = { FlowtimeRenderer };
