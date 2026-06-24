const { Plugin, Notice, Modal, EditorSuggest } = require("obsidian");
const { FlowtimeRenderer } = require("./src/renderer");
const { FlowtimeSettingsTab, DEFAULT_SETTINGS } = require("./src/settings");
const { ProcessInboxModal } = require("./src/inbox-processor");
const { ProjectEngine } = require("./src/project-engine");
const { TemplateEngine } = require("./src/template-engine");
const { QuickEntryModal } = require("./src/quick-entry");
const { runOnboard } = require("./src/onboard");
const { StatusTimer } = require("./src/status-timer");
const { SessionStore } = require("./src/session-store");
const { TaskCache } = require("./src/cache");
const { RoutineEngine } = require("./src/routine-engine");

class AddTaskSuggest extends EditorSuggest {
	constructor(app, plugin) {
		super(app);
		this.plugin = plugin;
	}

	onTrigger(cursor, editor, file) {
		const line = editor.getLine(cursor.line);
		const before = line.slice(0, cursor.ch);
		const match = before.match(/\/add-task\s*$/);
		if (match) {
			return {
				start: { line: cursor.line, ch: cursor.ch - match[0].length },
				end: cursor,
				query: "",
			};
		}
		return null;
	}

	getSuggestions(context) {
		return [{ label: "Add a task", description: "Open the quick entry modal" }];
	}

	renderSuggestion(suggestion, el) {
		el.createEl("div", { text: suggestion.label });
		el.createEl("small", { text: suggestion.description });
	}

	selectSuggestion(suggestion, event) {
		if (this.context) {
			const editor = this.context.editor;
			const { start, end } = this.context;
			editor.replaceRange("", start, end);
		}
		new QuickEntryModal(this.app, this.plugin).open();
	}
}

/**
 * Unified @-completions.
 *
 * Two modes based on context:
 *
 * COMMAND MODE — @ is first non-whitespace on line → show task macros
 *   @td  → - [ ]  @today
 *   @tm  → - [ ]  @tomorrow
 *   @rec → - [ ]  🔁 every day @today
 *   @weekly → `flowtime-weekly` block
 *
 * DIRECTIVE MODE — @ inside a task line → show dates, durations, buckets, projects
 *   @today, @b:deep-work, @p:Website, @30m, @due:tomorrow
 */
class AtCompletionsSuggest extends EditorSuggest {
	limit = 30; // Override default ~10 suggestion limit

	constructor(app, plugin) {
		super(app);
		this.plugin = plugin;
	}

	onTrigger(cursor, editor, file) {
		const line = editor.getLine(cursor.line);
		const before = line.slice(0, cursor.ch);
		const atIndex = before.lastIndexOf("@");
		if (atIndex < 0) return null;

		const textAfterAt = before.slice(atIndex + 1);
		if (textAfterAt.includes(" ")) return null;

		// Detect COMMAND MODE: @ is the first non-whitespace char
		const lineLead = line.slice(0, atIndex);
		const isCommandMode =
			lineLead.trim() === "" && !line.match(/^\s*[-*+]\s*\[[^\]]*\]/);

		return {
			start: isCommandMode
				? { line: cursor.line, ch: 0 } // Replace whole line
				: { line: cursor.line, ch: atIndex }, // Replace from @
			end: cursor,
			query: textAfterAt,
			isCommandMode,
		};
	}

	async getSuggestions(context) {
		const q = context.query.toLowerCase();
		const isCommandMode = context.isCommandMode;

		if (isCommandMode) {
			// ── COMMAND MODE: task macros & code blocks ──
			const macros = [
				{ label: "@td", insert: "- [ ]  @today ", desc: "Today task skeleton" },
				{
					label: "@tm",
					insert: "- [ ]  @tomorrow ",
					desc: "Tomorrow task skeleton",
				},
				{ label: "@tk", insert: "- [ ]  ", desc: "Task skeleton (no date)" },
<<<<<<< HEAD
				{ label: "@now", insert: "- [ ]  @today @15m ", desc: "Quick 15m task now" },
				{ label: "@1h", insert: "- [ ]  @today @1h ", desc: "Quick 1h task today" },
				{ label: "@rec", insert: "- [ ]  🔁 every day @today ", desc: "Recurring daily task" },
				{ label: "@rep", insert: "- [ ]  🔁 every week @monday ", desc: "Recurring weekly task" },
				{ label: "@today", insert: "```flowtime-today\n```", desc: "Today tasks code block" },
				{ label: "@overdue", insert: "```flowtime-overdue\n```", desc: "Overdue tasks code block" },
				{ label: "@soon", insert: "```flowtime-soon\n```", desc: "Up next tasks code block" },
				{ label: "@weekly", insert: "```flowtime-weekly\n```", desc: "Weekly view code block" },
				{ label: "@budget", insert: "```flowtime-buckets\n```", desc: "Budget overview code block" },
				{ label: "@sessions", insert: "```flowtime-sessions\n```", desc: "Session history code block" },
				{ label: "@proj", insert: "```flowtime-project\n```", desc: "Project tasks code block" },
				{ label: "@dueweek", insert: "```flowtime-dueweek\n```", desc: "Due this week code block" },
				{ label: "@weekplan", insert: "```flowtime-weekplan\n```", desc: "Week plan code block" },
=======
				{
					label: "@now",
					insert: "- [ ]  @today @15m ",
					desc: "Quick 15m task now",
				},
				{
					label: "@1h",
					insert: "- [ ]  @today @1h ",
					desc: "Quick 1h task today",
				},
				{
					label: "@rec",
					insert: "- [ ]  🔁 every day @today ",
					desc: "Recurring daily task",
				},
				{
					label: "@rep",
					insert: "- [ ]  🔁 every week @monday ",
					desc: "Recurring weekly task",
				},
				{
					label: "@today",
					insert: "```flowtime-today\n```",
					desc: "Today tasks code block",
				},
				{
					label: "@overdue",
					insert: "```flowtime-overdue\n```",
					desc: "Overdue tasks code block",
				},
				{
					label: "@soon",
					insert: "```flowtime-soon\n```",
					desc: "Up next tasks code block",
				},
				{
					label: "@weekly",
					insert: "```flowtime-weekly\n```",
					desc: "Weekly view code block",
				},
				{
					label: "@budget",
					insert: "```flowtime-buckets\n```",
					desc: "Budget overview code block",
				},
				{
					label: "@sessions",
					insert: "```flowtime-sessions\n```",
					desc: "Session history code block",
				},
				{
					label: "@proj",
					insert: "```flowtime-project\n```",
					desc: "Project tasks code block",
				},
				{
					label: "@dueweek",
					insert: "```flowtime-dueweek\n```",
					desc: "Due this week code block",
				},
>>>>>>> main
			];
			const matched = macros
				.filter((m) => m.label.slice(1).includes(q))
				.map((m) => ({ ...m, type: "macro" }));
			// Always inject @inbox at the front
			if ("inbox".includes(q || "")) {
				matched.unshift({
					label: "@inbox",
					insert: "- [ ]  @today ",
					desc: "Inbox task with today date",
					type: "macro",
				});
			}
			// Debug: log whether @inbox is in results
			console.debug(
				"Flowtime suggestions:",
				matched.length,
				"items, has @inbox:",
				matched.some((m) => m.label === "@inbox"),
			);
			return matched;
		}

		// ── DIRECTIVE MODE: normal @ completions ──
		const suggestions = [];

		const dates = [
			{ label: "today", description: "Current date" },
			{ label: "tomorrow", description: "Next day" },
			{ label: "yesterday", description: "Previous day" },
			{ label: "monday", description: "Next Monday" },
			{ label: "tuesday", description: "Next Tuesday" },
			{ label: "wednesday", description: "Next Wednesday" },
			{ label: "thursday", description: "Next Thursday" },
			{ label: "friday", description: "Next Friday" },
			{ label: "saturday", description: "Next Saturday" },
			{ label: "sunday", description: "Next Sunday" },
			{ label: "next-week", description: "7 days from now" },
			{ label: "next-monday", description: "Monday after next" },
		];
		const durations = [
			{ label: "15m", description: "15 minutes" },
			{ label: "30m", description: "30 minutes" },
			{ label: "45m", description: "45 minutes" },
			{ label: "1h", description: "1 hour" },
			{ label: "1.5h", description: "1 hour 30 minutes" },
			{ label: "2h", description: "2 hours" },
			{ label: "3h", description: "3 hours" },
		];
		const buckets = (this.plugin?.settings?.buckets || []).map((b) => ({
			label: "b:" + b.id,
			description: b.name,
		}));
		const dueDates = [
			{ label: "due:today", description: "Due today" },
			{ label: "due:tomorrow", description: "Due tomorrow" },
		];

		// v0.4.0: Status & priority tags
		const inboxAction = [{ label: "inbox", description: "Add task to inbox" }];

		// v0.4.0: Status & priority tags
		const statusTags = [
			{ label: "soon", description: "Up next / backlog item" },
			{ label: "high", description: "🟥 High priority" },
			{ label: "med", description: "🟨 Medium priority" },
			{ label: "low", description: "🟩 Low priority" },
		];

		let projects = [];
		try {
			if (this.plugin?.projectEngine) {
				const projList = await this.plugin.projectEngine.getAllProjects();
				projects = projList.map((p) => ({
					label: "p:" + p.name,
					description: "Project",
				}));
			}
		} catch (_) {}

		if (q.startsWith("b:") || q.startsWith("bucket:")) {
			const bucketQ = q.replace(/^(b:|bucket:)/, "");
			for (const b of buckets) {
				if (
					b.label.toLowerCase().includes(bucketQ) ||
					b.description.toLowerCase().includes(bucketQ)
				)
					suggestions.push({
						label: "@" + b.label,
						description: b.description,
						type: "bucket",
					});
			}
		} else if (q.startsWith("due:")) {
			const dueQ = q.slice(4);
			for (const d of dueDates) {
				if (d.label.toLowerCase().includes(dueQ))
					suggestions.push({
						label: "@" + d.label,
						description: d.description,
						type: "due",
					});
			}
		} else if (q.startsWith("p:")) {
			const pQ = q.slice(2);
			for (const p of projects) {
				if (
					p.label.toLowerCase().includes(pQ) ||
					p.description.toLowerCase().includes(pQ)
				)
					suggestions.push({
						label: "@" + p.label,
						description: p.description,
						type: "project",
					});
			}
		} else {
			for (const i of inboxAction)
				if (i.label.toLowerCase().includes(q))
					suggestions.push({
						label: "@" + i.label,
						description: i.description,
						type: "status",
					});
			for (const d of dates)
				if (d.label.toLowerCase().includes(q))
					suggestions.push({
						label: "@" + d.label,
						description: d.description,
						type: "date",
					});
			for (const d of durations)
				if (d.label.toLowerCase().includes(q))
					suggestions.push({
						label: "@" + d.label,
						description: d.description,
						type: "duration",
					});
			for (const b of buckets)
				if (
					b.label.toLowerCase().includes(q) ||
					b.description.toLowerCase().includes(q)
				)
					suggestions.push({
						label: "@" + b.label,
						description: b.description,
						type: "bucket",
					});
			for (const d of dueDates)
				if (d.label.toLowerCase().includes(q))
					suggestions.push({
						label: "@" + d.label,
						description: d.description,
						type: "due",
					});
			for (const p of projects)
				if (
					p.label.toLowerCase().includes(q) ||
					p.description.toLowerCase().includes(q)
				)
					suggestions.push({
						label: "@" + p.label,
						description: p.description,
						type: "project",
					});
			for (const s of statusTags)
				if (s.label.toLowerCase().includes(q))
					suggestions.push({
						label: "@" + s.label,
						description: s.description,
						type: "status",
					});
		}

		return suggestions.slice(0, 14);
	}

	renderSuggestion(suggestion, el) {
		const icons = {
			date: "📅",
			duration: "⏱",
			bucket: "📊",
			due: "⏰",
			project: "📁",
			macro: "⚡",
			status: "🏷",
		};
		const icon = icons[suggestion.type] || "•";
		if (suggestion.type === "macro") {
			el.createEl("span", {
				text: icon + " " + suggestion.label,
				cls: "ft-at-completion-label",
			});
			el.createEl("small", {
				text: "  → " + (suggestion.insert || "").replace(/\n/g, "↵ "),
				cls: "ft-at-completion-desc",
			});
		} else {
			el.createEl("span", {
				text: icon + " " + suggestion.label,
				cls: "ft-at-completion-label",
			});
			el.createEl("small", {
				text: "  " + suggestion.description,
				cls: "ft-at-completion-desc",
			});
		}
	}

	selectSuggestion(suggestion, event) {
		if (!this.context) return;
		const editor = this.context.editor;
		const { start, end } = this.context;

		if (suggestion.type === "macro") {
			// Replace the entire line with the expanded macro
			editor.replaceRange(suggestion.insert, start, end);
		} else {
			// Replace @query with the completed directive
			editor.replaceRange(suggestion.label + " ", start, end);
		}
	}
}

module.exports = class FlowtimePlugin extends Plugin {
	async onload() {
		const savedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);
		// Ensure buckets default is populated if saved data has empty/null buckets
		if (!this.settings.buckets || this.settings.buckets.length === 0) {
			this.settings.buckets = DEFAULT_SETTINGS.buckets;
		}

		this.notify = (message, isError = false) => {
			if (!isError && this.settings.quietMode) return;
			new Notice(message, this.settings.noticeDuration);
		};

		this.addSettingTab(new FlowtimeSettingsTab(this.app, this));

		// Apply content width if set
		if (this.settings.contentWidth > 0) {
			document.body.classList.add("ft-wide");
			document.body.style.setProperty(
				"--ft-content-width",
				this.settings.contentWidth + "px",
			);
		}

		this.projectEngine = new ProjectEngine(this.app, this.settings);
		this.templateEngine = new TemplateEngine(this.app, this);
		this.sessionStore = new SessionStore(this.app.vault);
		this.taskCache = new TaskCache();
		this.routineEngine = new RoutineEngine(this.app, this);

		// ── v0.4.0: Cache persistence in separate file ──
		this._cacheSaveTimer = null;
		this._cacheFilePath = () =>
			this.app.vault.configDir + "/plugins/flowtime/task-cache.json";

		this._loadTaskCache = async () => {
			try {
				const cachePath = this._cacheFilePath();
				if (await this.app.vault.adapter.exists(cachePath)) {
					const content = await this.app.vault.adapter.read(cachePath);
					this.taskCache.fromJSON(JSON.parse(content));
				} else if (savedData && savedData._taskCache) {
					this.taskCache.fromJSON(savedData._taskCache);
					delete savedData._taskCache;
				}
			} catch (_) {}
		};

		this._saveTaskCache = async () => {
			try {
				await this.app.vault.adapter.write(
					this._cacheFilePath(),
					JSON.stringify(this.taskCache.toJSON(), null, 2),
				);
			} catch (_) {}
		};

		// Load cache from separate file (with legacy fallback)
		await this._loadTaskCache();

		// v0.4.0: Auto-evict stale cache entries (files that no longer exist)
		const evicted = await this.taskCache.autoEvict(async (path) => {
			return !!this.app.vault.getAbstractFileByPath(path);
		});
		if (evicted > 0) {
			this.notify(`🧹 Task cache cleaned: ${evicted} stale entries removed`);
		}

		// v0.4.0: Check safety limits
		const { warnings } = this.taskCache.checkSafetyLimits();
		for (const w of warnings) {
			this.notify("⚠️ " + w, true);
		}

		// v0.4.0: Ensure session directory exists
		await this._ensureSessionDir();

		// v0.4.0: Check daily notes folder exists
		await this._checkDailyNotesFolder();

<<<<<<< HEAD
		// v0.5.0: Ensure routines folder exists
		await this.routineEngine.ensureRoutinesFolder();

		// v0.5.0: Auto-generate routine instances
		if (this.settings.autoGenerateOnStartup !== false) {
			this.routineEngine.generateAllDue().then(count => {
				if (count > 0 && !this.settings.quietMode) {
					this.notify("🔁 Generated " + count + " routine task" + (count === 1 ? "" : "s"));
				}
			}).catch(e => console.warn("Flowtime: Routine generation error:", e.message));
		}
=======
		// Ensure inbox file exists
		await this._ensureInbox();
>>>>>>> main

		// Track old projectsRoot to detect changes
		this._previousProjectsRoot = this.settings.projectsRoot;

		const onFileChanged = (file) => {
			this.projectEngine.invalidate(file.path);
			this.taskCache.invalid(file.path);
			this._scheduleCacheSave();
		};
		this.registerEvent(this.app.vault.on("modify", onFileChanged));
		this.registerEvent(this.app.vault.on("delete", onFileChanged));
		// Also invalidate on rename (create+delete fires separately)

		// v0.5.0: Watch routines folder for changes → re-generate (debounced)
		const routinesFolder = this.settings.routinesFolder || "flowtime/routines/";
		this._routineWatchTimer = null;
		this.registerEvent(this.app.vault.on("modify", (file) => {
			if (file.path.startsWith(routinesFolder) && !file.path.endsWith(".generated.json")) {
				if (this._routineWatchTimer) clearTimeout(this._routineWatchTimer);
				this._routineWatchTimer = setTimeout(() => {
					this._routineWatchTimer = null;
					this.routineEngine.generateAllDue().catch(e =>
						console.warn("Flowtime: Routine auto-gen error:", e.message)
					);
				}, 5000);
			}
		}));

		// Register /add-task slash command suggester
		this.registerEditorSuggest(new AddTaskSuggest(this.app, this));

		// v0.4.0: Register unified @-completions (directives + command macros)
		this.registerEditorSuggest(new AtCompletionsSuggest(this.app, this));

		// Quick entry command
		this.addCommand({
			id: "add-task",
			name: "Add Task",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "I" }],
			callback: () => {
				new QuickEntryModal(this.app, this).open();
			},
		});

		// Add Task at Cursor command
		this.addCommand({
			id: "add-task-inline",
			name: "Add Task at Cursor",
			editorCallback: (editor) => {
				const today = new Date().toISOString().split("T")[0];
				const cursor = editor.getCursor();
				const line = "- [ ]  @" + today + " ";
				editor.replaceRange(line, cursor);
				// Move cursor to after "- [ ] " so user can type task text immediately
				editor.setCursor({ line: cursor.line, ch: cursor.ch + 6 });
			},
		});

		// ── Append to Inbox command ──
		this.addCommand({
			id: "append-to-inbox",
			name: "Append to Inbox",
			callback: () => {
				const { Modal } = require("obsidian");
				class AppendToInboxModal extends Modal {
					constructor(app, plugin) {
						super(app);
						this.plugin = plugin;
					}
					onOpen() {
						const { contentEl } = this;
						contentEl.createEl("h2", { text: "\u{1F4E5} Append to Inbox" });
						const textarea = contentEl.createEl("textarea", {
							placeholder: "What's on your mind?",
							cls: "flowtime-input",
						});
						textarea.style.width = "100%";
						textarea.style.minHeight = "80px";
						textarea.focus();

						const btnRow = contentEl.createEl("div", {
							cls: "flowtime-btn-row",
						});
						const cancelBtn = btnRow.createEl("button", {
							text: "Cancel",
							cls: "flowtime-btn-cancel",
						});
						const submitBtn = btnRow.createEl("button", {
							text: "Append",
							cls: "flowtime-btn-submit",
						});

						cancelBtn.addEventListener("click", () => this.close());
						submitBtn.addEventListener("click", async () => {
							const text = textarea.value.trim();
							if (!text) {
								this.plugin.notify("Nothing to append", true);
								return;
							}
							const path = this.plugin.settings.inboxPath || "Inbox.md";
							try {
								let content = "";
								if (await this.plugin.app.vault.adapter.exists(path)) {
									content = await this.plugin.app.vault.read(
										this.plugin.app.vault.getAbstractFileByPath(path),
									);
								}
								// Split into lines, add the new text, write back
								const lines = text.split("\n").filter((l) => l.trim());
								const newContent =
									content.trimEnd() + "\n" + lines.join("\n") + "\n";
								if (await this.plugin.app.vault.adapter.exists(path)) {
									await this.plugin.app.vault.modify(
										this.plugin.app.vault.getAbstractFileByPath(path),
										newContent,
									);
								} else {
									await this.plugin.app.vault.create(path, newContent);
								}
								this.plugin.notify(
									`\u{1F4E5} ${lines.length} line(s) added to inbox`,
								);
								this.close();
							} catch (e) {
								this.plugin.notify("Failed to append: " + e.message, true);
							}
						});

						// Ctrl+Enter or Cmd+Enter to submit
						textarea.addEventListener("keydown", (e) => {
							if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
								submitBtn.click();
							}
						});
					}
					onClose() {
						this.contentEl.empty();
					}
				}
				new AppendToInboxModal(this.app, this).open();
			},
		});

		// ── Status bar timer ──
		this.statusTimer = new StatusTimer({
			statusBarItem: this.addStatusBarItem(),
			settings: this.settings,
			notify: this.notify,
			onSessionEnd: async (data) => {
				await this.sessionStore.writeSession({
					startTime: data.startTime,
					endTime: data.endTime,
					durationMinutes: data.durationMinutes,
					bucket: "",
					taskText: data.taskText,
					notes: "",
				});
			},
			// Status bar right-click stop → stop active per-row timer
			onTimerStop: () => {
				if (this._activeRowTimerStop) {
					this._activeRowTimerStop();
					this._activeRowTimerStop = null;
				}
			},
		});

		this.registerDomEvent(this.statusTimer.statusBarItem, "click", () => {
			this.statusTimer.toggle();
		});
		this.registerDomEvent(
			this.statusTimer.statusBarItem,
			"contextmenu",
			(e) => {
				e.preventDefault();
				this.statusTimer.stop();
			},
		);

		this.renderers = [];
		const { WeekplanRenderer } = require("./src/weekplan-renderer");
		for (const [name, mode] of [
			["flowtime-today", "today"],
			["flowtime-overdue", "overdue"],
			["flowtime-dueweek", "dueweek"],
			["flowtime-weekly", "weekly"],
			["flowtime-soon", "soon"],
			["flowtime-project", "project"],
			["flowtime-buckets", "budget"],
			["flowtime-sessions", "sessions"],
		]) {
			this.registerMarkdownCodeBlockProcessor(name, (_src, el, ctx) => {
				const r = new FlowtimeRenderer(
					this.app,
					el,
					mode,
					this.projectEngine,
					ctx.sourcePath,
				);
				r.plugin = this;
				this.renderers.push(r);
				ctx.addChild(r);
			});
		}

		// v0.5.0: Weekplan renderer (uses dedicated WeekplanRenderer)
		this.registerMarkdownCodeBlockProcessor("flowtime-weekplan", (_src, el, ctx) => {
			const r = new WeekplanRenderer(this.app, el, this, this.projectEngine, ctx.sourcePath);
			this.renderers.push(r);
			ctx.addChild(r);
		});

		// ── Template Engine Commands ──

		this.addCommand({
			id: "insert-daily-dashboard",
			name: "Insert daily dashboard",
			editorCallback: (editor) => {
				this.templateEngine.insertDaily();
			},
		});

		this.addCommand({
			id: "insert-weekly-dashboard",
			name: "Insert weekly dashboard",
			editorCallback: (editor) => {
				this.templateEngine.insertWeekly();
			},
		});

		this.addCommand({
			id: "new-project",
			name: "New Project",
			callback: () => {
				class ProjectNameModal extends Modal {
					constructor(app, onSubmit) {
						super(app);
						this.onSubmit = onSubmit;
						this.scaffoldTasks = true;
						this.scaffoldWiki = true;
					}
					onOpen() {
						const { contentEl } = this;
						contentEl.createEl("h2", { text: "New Project" });
						contentEl.createEl("p", {
							text: "Creates a new project folder with notes.",
							cls: "flowtime-label",
						});

						const input = contentEl.createEl("input", {
							type: "text",
							placeholder: "Project name",
							cls: "flowtime-input",
						});
						input.style.marginTop = "8px";
						input.focus();

						// Scaffold options
						contentEl.createEl("hr", { style: "margin: 12px 0" });
						const tasksCb = contentEl.createEl("label", {
							cls: "flowtime-label",
						});
						const tasksCheck = tasksCb.createEl("input", { type: "checkbox" });
						tasksCheck.checked = this.scaffoldTasks;
						tasksCheck.style.marginRight = "6px";
						tasksCheck.addEventListener("change", () => {
							this.scaffoldTasks = tasksCheck.checked;
						});
						tasksCb.append(
							" Create Tasks.md (with flowtime-project block + starter tasks)",
						);

						const wikiCb = contentEl.createEl("label", {
							cls: "flowtime-label",
						});
						const wikiCheck = wikiCb.createEl("input", { type: "checkbox" });
						wikiCheck.checked = this.scaffoldWiki;
						wikiCheck.style.marginRight = "6px";
						wikiCheck.addEventListener("change", () => {
							this.scaffoldWiki = wikiCheck.checked;
						});
						wikiCb.append(" Create Wiki.md (with template sections)");

						const btnRow = contentEl.createEl("div", {
							cls: "flowtime-btn-row",
						});
						const cancelBtn = btnRow.createEl("button", {
							text: "Cancel",
							cls: "flowtime-btn-cancel",
						});
						const createBtn = btnRow.createEl("button", {
							text: "Create",
							cls: "flowtime-btn-submit",
						});

						cancelBtn.addEventListener("click", () => this.close());
						createBtn.addEventListener("click", () => {
							const name = input.value.trim();
							if (name) {
								this.onSubmit(name, {
									scaffoldTasks: this.scaffoldTasks,
									scaffoldWiki: this.scaffoldWiki,
								});
								this.close();
							}
						});
						input.addEventListener("keydown", (e) => {
							if (e.key === "Enter") {
								const name = input.value.trim();
								if (name) {
									this.onSubmit(name, {
										scaffoldTasks: this.scaffoldTasks,
										scaffoldWiki: this.scaffoldWiki,
									});
									this.close();
								}
							}
						});
					}
					onClose() {
						this.contentEl.empty();
					}
				}

				new ProjectNameModal(this.app, async (name, opts) => {
					try {
						const result = await this.templateEngine.createProject(name, opts);
						const parts = [result.notePath];
						if (result.tasksPath) parts.push(result.tasksPath);
						if (result.wikiPath) parts.push(result.wikiPath);
						this.notify(
							"✅ Project created: " + name + " (" + parts.length + " files)",
						);
					} catch (e) {
						this.notify("❌ Failed to create project: " + e.message, true);
					}
				}).open();
			},
		});

		// ── Add Bucket Command ──
		this.addCommand({
			id: "add-bucket",
			name: "Add Bucket",
			callback: () => {
				class BucketModal extends Modal {
					constructor(app, plugin) {
						super(app);
						this.plugin = plugin;
					}
					onOpen() {
						const { contentEl } = this;
						contentEl.createEl("h2", { text: "Add Bucket" });
						contentEl.createEl("p", {
							text: "Create a new time-budget category.",
							cls: "flowtime-label",
						});

						contentEl.createEl("label", {
							text: "Name",
							cls: "flowtime-label",
						});
						const nameInput = contentEl.createEl("input", {
							type: "text",
							placeholder: "e.g. Deep Work",
							cls: "flowtime-input",
						});

						contentEl.createEl("label", {
							text: "Color",
							cls: "flowtime-label",
						});
						const colorInput = contentEl.createEl("input", {
							type: "color",
							value: "#4a9eff",
							cls: "flowtime-input",
						});
						colorInput.style.padding = "2px";
						colorInput.style.width = "60px";

						contentEl.createEl("label", {
							text: "Weekly limit (hours)",
							cls: "flowtime-label",
						});
						const limitInput = contentEl.createEl("input", {
							type: "number",
							value: "10",
							min: "1",
							cls: "flowtime-input",
						});

						const btnRow = contentEl.createEl("div", {
							cls: "flowtime-btn-row",
						});
						const cancelBtn = btnRow.createEl("button", {
							text: "Cancel",
							cls: "flowtime-btn-cancel",
						});
						const createBtn = btnRow.createEl("button", {
							text: "Create",
							cls: "flowtime-btn-submit",
						});

						cancelBtn.addEventListener("click", () => this.close());
						createBtn.addEventListener("click", async () => {
							const name = nameInput.value.trim();
							if (!name) {
								this.plugin.notify("Name is required", true);
								return;
							}
							const color = colorInput.value;
							const limit = parseInt(limitInput.value, 10);
							if (!limit || limit <= 0) {
								this.plugin.notify("Limit must be > 0", true);
								return;
							}

							const buckets = this.plugin.settings.buckets || [];
							const id = name
								.toLowerCase()
								.replace(/\s+/g, "-")
								.replace(/[^a-z0-9-]/g, "");
							buckets.push({
								id,
								name,
								color,
								weeklyLimit: limit,
								sortOrder: buckets.length,
							});
							this.plugin.settings.buckets = buckets;
							await this.plugin.saveData(this.plugin.settings);
							this.plugin.notify("✅ Bucket created: " + name);
							this.close();
						});
					}
					onClose() {
						this.contentEl.empty();
					}
				}
				new BucketModal(this.app, this).open();
			},
		});

<<<<<<< HEAD
		// ── v0.5.0: Routine Engine Commands ──

		this.addCommand({
			id: "generate-routines",
			name: "Generate Routines",
			callback: async () => {
				const count = await this.routineEngine.generateAllDue({ force: true });
				this.notify("🔁 Generated " + count + " routine task" + (count === 1 ? "" : "s"));
			},
		});

		this.addCommand({
			id: "generate-routines-today",
			name: "Generate Routines for Today",
			callback: async () => {
				const count = await this.routineEngine.generateToday({ force: true });
				this.notify("🔁 Generated " + count + " routine task" + (count === 1 ? "" : "s") + " for today");
			},
		});

		this.addCommand({
			id: "clear-routine-tracking",
			name: "Clear Routine Generation Tracking",
			callback: async () => {
				await this.routineEngine.clearTracking();
				this.notify("🗑 Routine tracking cleared. Regenerate to recreate instances.");
=======
		// ── Process Inbox Command ──
		this.addCommand({
			id: "process-inbox",
			name: "Process Inbox",
			callback: () => {
				new ProcessInboxModal(this.app, this).open();
>>>>>>> main
			},
		});

		// ── Onboard / Migrate Command ──
		this.addCommand({
			id: "onboard",
			name: "Onboard / Migrate",
			callback: () => {
				runOnboard(this.app, this);
			},
		});

		// ── v0.4.0: Flowtime: Reset to Defaults ──
		this.addCommand({
			id: "reset-settings",
			name: "Reset to Defaults",
			callback: async () => {
				class ConfirmModal extends Modal {
					constructor(app, onConfirm) {
						super(app);
						this.onConfirm = onConfirm;
					}
					onOpen() {
						const { contentEl } = this;
						contentEl.createEl("h2", { text: "Reset Flowtime to Defaults?" });
						contentEl.createEl("p", {
							text: "This will clear all settings, buckets, and the task cache. Project files and session data will NOT be affected.",
							cls: "flowtime-label",
						});
						const btnRow = contentEl.createEl("div", {
							cls: "flowtime-btn-row",
						});
						const cancelBtn = btnRow.createEl("button", {
							text: "Cancel",
							cls: "flowtime-btn-cancel",
						});
						const confirmBtn = btnRow.createEl("button", {
							text: "Reset",
							cls: "flowtime-btn-submit",
						});
						confirmBtn.style.background = "var(--text-error)";
						cancelBtn.addEventListener("click", () => this.close());
						confirmBtn.addEventListener("click", () => {
							this.onConfirm();
							this.close();
						});
					}
					onClose() {
						this.contentEl.empty();
					}
				}
				new ConfirmModal(this.app, async () => {
					this.settings = Object.assign({}, DEFAULT_SETTINGS);
					this.taskCache.clear();
					await this.saveData(this.settings);
					// Remove separate cache file if it exists
					try {
						const cachePath = this._cacheFilePath();
						if (await this.app.vault.adapter.exists(cachePath)) {
							await this.app.vault.adapter.remove(cachePath);
						}
					} catch (_) {}
					this.notify("✅ Flowtime reset to defaults. Reload for full effect.");
				}).open();
			},
		});

		// ── v0.4.0: Rebuild Cache Command ──
		this.addCommand({
			id: "rebuild-cache",
			name: "Rebuild Task Cache",
			callback: async () => {
				this.taskCache.clear();
				this.notify("🔄 Cache cleared. It will rebuild on next render.");
			},
		});

		/**
		 * Debounced cache save — writes 2s after last change.
		 */
		this._scheduleCacheSave = (force) => {
			if (force && this._cacheSaveTimer) {
				clearTimeout(this._cacheSaveTimer);
				this._cacheSaveTimer = null;
			}
			if (this._cacheSaveTimer) return;
			this._cacheSaveTimer = setTimeout(
				async () => {
					this._cacheSaveTimer = null;
					try {
						await this._saveTaskCache();
						// Also strip legacy _taskCache from data.json if present
						const data = (await this.loadData()) || {};
						if (data._taskCache) {
							delete data._taskCache;
							await this.saveData(data);
						}
					} catch (_) {}
				},
				force ? 0 : 2000,
			);
		};

		// Save cache on unload as well
		this.register(() => {
			if (this._cacheSaveTimer) {
				clearTimeout(this._cacheSaveTimer);
				this._cacheSaveTimer = null;
			}
			// Clean up wide mode body class
			document.body.classList.remove("ft-wide");
		});
	}

	/**
	 * v0.4.0: Ensure the sessions directory exists on plugin load.
	 */
	async _ensureSessionDir() {
		try {
			const exists = await this.app.vault.adapter.exists("flowtime/sessions");
			if (!exists) {
				await this.app.vault.createFolder("flowtime/sessions");
				this.notify("📁 Created flowtime/sessions/ directory");
			}
		} catch (e) {
			console.warn("Flowtime: Could not create sessions directory:", e.message);
		}
	}

	/**
	 * v0.4.0: Check that the daily notes folder from .obsidian/daily-notes.json exists.
	 * If missing, warn the user so they can fix or create it.
	 */
	async _checkDailyNotesFolder() {
		try {
			const dailyNotesPath = this.app.vault.configDir + "/daily-notes.json";
			if (!(await this.app.vault.adapter.exists(dailyNotesPath))) return;
			const content = await this.app.vault.adapter.read(dailyNotesPath);
			const config = JSON.parse(content);
			const folder = config.folder;
			if (!folder) return;
			if (!(await this.app.vault.adapter.exists(folder))) {
				this.notify(
					"⚠️ Daily notes folder '" +
						folder +
						"' not found. Check Settings → Daily Notes.",
					true,
				);
			}
		} catch (_) {}
	}

	/**
	 * Ensure the inbox file exists, creating it with a default template if not.
	 */
	async _ensureInbox() {
		const path = this.settings.inboxPath || "Inbox.md";
		try {
			if (!(await this.app.vault.adapter.exists(path))) {
				const template = `# \u{1F4E5} Inbox

Capture tasks, ideas, and notes here. One line per item.
Process them with **Flowtime: Process Inbox**.
`;
				await this.app.vault.create(path, template);
				this.notify("\u{1F4E5} Created inbox: " + path);
			}
		} catch (e) {
			console.warn("Flowtime: Could not create inbox:", e.message);
		}
	}
};
