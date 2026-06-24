const { Plugin, Notice, Modal, EditorSuggest } = require("obsidian");
const { FlowtimeRenderer } = require("./src/renderer");
const { FlowtimeSettingsTab, DEFAULT_SETTINGS } = require("./src/settings");
const { ProjectEngine } = require("./src/project-engine");
const { TemplateEngine } = require("./src/template-engine");
const { QuickEntryModal } = require("./src/quick-entry");
const { runOnboard } = require("./src/onboard");
const { StatusTimer } = require("./src/status-timer");
const { SessionStore } = require("./src/session-store");

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

		this.projectEngine = new ProjectEngine(this.app, this.settings);
		this.templateEngine = new TemplateEngine(this.app, this);
		this.sessionStore = new SessionStore(this.app.vault);

		this.registerEvent(this.app.vault.on("modify", (file) => {
			this.projectEngine.invalidate(file.path);
		}));
		this.registerEvent(this.app.vault.on("delete", (file) => {
			this.projectEngine.invalidate(file.path);
		}));

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
					}
					onOpen() {
						const { contentEl } = this;
						contentEl.createEl("h2", { text: "New Project" });
						contentEl.createEl("p", {
							text: "Creates a project folder note with frontmatter marker.",
							cls: "flowtime-label",
						});

						const input = contentEl.createEl("input", {
							type: "text",
							placeholder: "Project name",
							cls: "flowtime-input",
						});
						input.style.marginTop = "8px";
						input.focus();

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
								this.onSubmit(name);
								this.close();
							}
						});
						input.addEventListener("keydown", (e) => {
							if (e.key === "Enter") {
								const name = input.value.trim();
								if (name) {
									this.onSubmit(name);
									this.close();
								}
							}
						});
					}
					onClose() {
						this.contentEl.empty();
					}
				}

				new ProjectNameModal(this.app, async (name) => {
					try {
						await this.templateEngine.createProject(name);
						this.notify("✅ Project created: " + name);
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
	}
};
