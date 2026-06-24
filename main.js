const { Plugin, Notice } = require("obsidian");
const { TaskPlannerRenderer } = require("./src/renderer");
const { FlowtimeSettingsTab, DEFAULT_SETTINGS } = require("./src/settings");
const { ProjectEngine } = require("./src/project-engine");
const { TemplateEngine } = require("./src/template-engine");
const { QuickEntryModal } = require("./src/quick-entry");

module.exports = class FlowtimePlugin extends Plugin {
	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		this.notify = (message, isError = false) => {
			if (!isError && this.settings.quietMode) return;
			new Notice(message, this.settings.noticeDuration);
		};

		this.addSettingTab(new FlowtimeSettingsTab(this.app, this));

		this.projectEngine = new ProjectEngine(this.app, this.settings);
		this.templateEngine = new TemplateEngine(this.app, this);

		this.registerEvent(this.app.vault.on("modify", (file) => {
			this.projectEngine.invalidate(file.path);
		}));
		this.registerEvent(this.app.vault.on("delete", (file) => {
			this.projectEngine.invalidate(file.path);
		}));

		// Quick entry command
		this.addCommand({
			id: "add-task",
			name: "Add Task",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "T" }],
			callback: () => {
				new QuickEntryModal(this.app, this).open();
			},
		});

		// ── Status bar timer ──
		this.currentTimer = null;
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.addClass("flowtime-status-timer");
		this.updateStatusBar();

		this.registerDomEvent(this.statusBarItem, "click", () => {
			this.toggleStatusTimer();
		});
		this.registerDomEvent(this.statusBarItem, "contextmenu", (e) => {
			e.preventDefault();
			this.stopStatusTimer();
		});

		this.startStatusTimer = (taskName, totalSeconds) => {
			this.stopStatusTimer();

			this.currentTimer = {
				taskName,
				remaining: totalSeconds,
				total: totalSeconds,
				interval: null,
			};

			this.currentTimer.interval = setInterval(() => {
				this.currentTimer.remaining--;
				this.updateStatusBar();

				if (this.currentTimer.remaining <= 0) {
					this.stopStatusTimer();
					this.notify("⏰ Time's up! " + taskName);
				}
			}, 1000);

			this.updateStatusBar();
		};

		this.stopStatusTimer = () => {
			if (this.currentTimer?.interval) {
				clearInterval(this.currentTimer.interval);
			}
			this.currentTimer = null;
			this.updateStatusBar();
		};

		this.toggleStatusTimer = () => {
			if (!this.currentTimer) return;

			if (this.currentTimer.interval) {
				clearInterval(this.currentTimer.interval);
				this.currentTimer.interval = null;
			} else if (this.currentTimer.remaining > 0) {
				this.currentTimer.interval = setInterval(() => {
					this.currentTimer.remaining--;
					this.updateStatusBar();

					if (this.currentTimer.remaining <= 0) {
						this.stopStatusTimer();
						this.notify("⏰ Time's up! " + this.currentTimer.taskName);
					}
				}, 1000);
			}

			this.updateStatusBar();
		};

		this.updateStatusBar = () => {
			if (!this.settings.statusBarTimer) {
				this.statusBarItem.setText("");
				return;
			}

			if (!this.currentTimer) {
				this.statusBarItem.setText("⏱ --");
				return;
			}

			const fmt = (sec) => {
				if (sec <= 0) return "00:00";
				const h = Math.floor(sec / 3600);
				const m = Math.floor((sec % 3600) / 60);
				const s = sec % 60;
				if (h > 0)
					return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
				return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
			};

			const icon = this.currentTimer.interval ? "⏸" : "▶";
			const name =
				this.currentTimer.taskName.length > 30
					? this.currentTimer.taskName.slice(0, 27) + "…"
					: this.currentTimer.taskName;

			this.statusBarItem.setText(`⏱ ${fmt(this.currentTimer.remaining)} — ${name}  ${icon}`);
		};

		this.renderers = [];
		for (const [name, mode] of [
			["task-planner", "today"],
			["task-planner-overdue", "overdue"],
			["task-planner-dueweek", "dueweek"],
			["task-planner-weekly", "weekly"],
			["task-planner-project", "project"],
		]) {
			this.registerMarkdownCodeBlockProcessor(name, (_src, el, ctx) => {
				const r = new TaskPlannerRenderer(this.app, el, mode, this.projectEngine, ctx.sourcePath);
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
				const { Modal } = require("obsidian");
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
	}
};
