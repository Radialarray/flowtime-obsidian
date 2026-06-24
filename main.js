const { Plugin, Notice, Modal, EditorSuggest } = require("obsidian");
const { FlowtimeRenderer } = require("./src/renderer");
const { FlowtimeSettingsTab, DEFAULT_SETTINGS } = require("./src/settings");
const { ProjectEngine } = require("./src/project-engine");
const { TemplateEngine } = require("./src/template-engine");
const { QuickEntryModal } = require("./src/quick-entry");
const { runOnboard } = require("./src/onboard");
const { StatusTimer } = require("./src/status-timer");
const { SessionStore } = require("./src/session-store");
const { TaskCache } = require("./src/cache");

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
			document.body.style.setProperty("--ft-content-width", this.settings.contentWidth + "px");
		}

		this.projectEngine = new ProjectEngine(this.app, this.settings);
		this.templateEngine = new TemplateEngine(this.app, this);
		this.sessionStore = new SessionStore(this.app.vault);
		this.taskCache = new TaskCache();

		// ── v0.4.0: Cache persistence in separate file ──
		this._cacheSaveTimer = null;
		this._cacheFilePath = () => this.app.vault.configDir + "/plugins/flowtime/task-cache.json";

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
			return !!(this.app.vault.getAbstractFileByPath(path));
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

		// Register /add-task slash command suggester
		this.registerEditorSuggest(new AddTaskSuggest(this.app, this));

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
		this.registerDomEvent(this.statusTimer.statusBarItem, "contextmenu", (e) => {
			e.preventDefault();
			this.statusTimer.stop();
		});

		this.renderers = [];
		for (const [name, mode] of [
			["flowtime-today", "today"],
			["flowtime-overdue", "overdue"],
			["flowtime-dueweek", "dueweek"],
			["flowtime-weekly", "weekly"],
			["flowtime-project", "project"],
			["flowtime-buckets", "budget"],
			["flowtime-sessions", "sessions"],
		]) {
			this.registerMarkdownCodeBlockProcessor(name, (_src, el, ctx) => {
				const r = new FlowtimeRenderer(this.app, el, mode, this.projectEngine, ctx.sourcePath);
				r.plugin = this;
				this.renderers.push(r);
				ctx.addChild(r);
			});
		}

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
						const tasksCb = contentEl.createEl("label", { cls: "flowtime-label" });
						const tasksCheck = tasksCb.createEl("input", { type: "checkbox" });
						tasksCheck.checked = this.scaffoldTasks;
						tasksCheck.style.marginRight = "6px";
						tasksCheck.addEventListener("change", () => { this.scaffoldTasks = tasksCheck.checked; });
						tasksCb.append(" Create Tasks.md (with flowtime-project block + starter tasks)");

						const wikiCb = contentEl.createEl("label", { cls: "flowtime-label" });
						const wikiCheck = wikiCb.createEl("input", { type: "checkbox" });
						wikiCheck.checked = this.scaffoldWiki;
						wikiCheck.style.marginRight = "6px";
						wikiCheck.addEventListener("change", () => { this.scaffoldWiki = wikiCheck.checked; });
						wikiCb.append(" Create Wiki.md (with template sections)");

						const btnRow = contentEl.createEl("div", { cls: "flowtime-btn-row" });
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
								this.onSubmit(name, { scaffoldTasks: this.scaffoldTasks, scaffoldWiki: this.scaffoldWiki });
								this.close();
							}
						});
						input.addEventListener("keydown", (e) => {
							if (e.key === "Enter") {
								const name = input.value.trim();
								if (name) {
									this.onSubmit(name, { scaffoldTasks: this.scaffoldTasks, scaffoldWiki: this.scaffoldWiki });
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
						this.notify("✅ Project created: " + name + " (" + parts.length + " files)");
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

						contentEl.createEl("label", { text: "Name", cls: "flowtime-label" });
						const nameInput = contentEl.createEl("input", {
							type: "text", placeholder: "e.g. Deep Work", cls: "flowtime-input",
						});

						contentEl.createEl("label", { text: "Color", cls: "flowtime-label" });
						const colorInput = contentEl.createEl("input", {
							type: "color", value: "#4a9eff", cls: "flowtime-input",
						});
						colorInput.style.padding = "2px";
						colorInput.style.width = "60px";

						contentEl.createEl("label", { text: "Weekly limit (hours)", cls: "flowtime-label" });
						const limitInput = contentEl.createEl("input", {
							type: "number", value: "10", min: "1", cls: "flowtime-input",
						});

						const btnRow = contentEl.createEl("div", { cls: "flowtime-btn-row" });
						const cancelBtn = btnRow.createEl("button", { text: "Cancel", cls: "flowtime-btn-cancel" });
						const createBtn = btnRow.createEl("button", { text: "Create", cls: "flowtime-btn-submit" });

						cancelBtn.addEventListener("click", () => this.close());
						createBtn.addEventListener("click", async () => {
							const name = nameInput.value.trim();
							if (!name) { this.plugin.notify("Name is required", true); return; }
							const color = colorInput.value;
							const limit = parseInt(limitInput.value, 10);
							if (!limit || limit <= 0) { this.plugin.notify("Limit must be > 0", true); return; }

							const buckets = this.plugin.settings.buckets || [];
							const id = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
							buckets.push({ id, name, color, weeklyLimit: limit, sortOrder: buckets.length });
							this.plugin.settings.buckets = buckets;
							await this.plugin.saveData(this.plugin.settings);
							this.plugin.notify("✅ Bucket created: " + name);
							this.close();
						});
					}
					onClose() { this.contentEl.empty(); }
				}
				new BucketModal(this.app, this).open();
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
						const btnRow = contentEl.createEl("div", { cls: "flowtime-btn-row" });
						const cancelBtn = btnRow.createEl("button", { text: "Cancel", cls: "flowtime-btn-cancel" });
						const confirmBtn = btnRow.createEl("button", { text: "Reset", cls: "flowtime-btn-submit" });
						confirmBtn.style.background = "var(--text-error)";
						cancelBtn.addEventListener("click", () => this.close());
						confirmBtn.addEventListener("click", () => { this.onConfirm(); this.close(); });
					}
					onClose() { this.contentEl.empty(); }
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
			this._cacheSaveTimer = setTimeout(async () => {
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
			}, force ? 0 : 2000);
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
				this.notify("⚠️ Daily notes folder '" + folder + "' not found. Check Settings → Daily Notes.", true);
			}
		} catch (_) {}
	}
};
