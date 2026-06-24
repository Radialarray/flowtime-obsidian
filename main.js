const { Plugin } = require("obsidian");
const { TaskPlannerRenderer } = require("./src/renderer");
const { FlowtimeSettingsTab, DEFAULT_SETTINGS } = require("./src/settings");
const { ProjectEngine } = require("./src/project-engine");
const { QuickEntryModal } = require("./src/quick-entry");

module.exports = class FlowtimePlugin extends Plugin {
	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.addSettingTab(new FlowtimeSettingsTab(this.app, this));

		this.projectEngine = new ProjectEngine(this.app, this.settings);

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
			callback: () => {
				new QuickEntryModal(this.app, this).open();
			},
		});

		this.renderers = [];
		for (const [name, mode] of [
			["task-planner", "today"],
			["task-planner-overdue", "overdue"],
			["task-planner-dueweek", "dueweek"],
		]) {
			this.registerMarkdownCodeBlockProcessor(name, (_src, el, ctx) => {
				const r = new TaskPlannerRenderer(this.app, el, mode, this.projectEngine);
				r.plugin = this;
				this.renderers.push(r);
				ctx.addChild(r);
			});
		}
	}
};
