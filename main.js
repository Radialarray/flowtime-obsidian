const { Plugin } = require("obsidian");
const { TaskPlannerRenderer } = require("./src/renderer");
const { FlowtimeSettingsTab, DEFAULT_SETTINGS } = require("./src/settings");

module.exports = class FlowtimePlugin extends Plugin {
	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.addSettingTab(new FlowtimeSettingsTab(this.app, this));

		this.renderers = [];
		for (const [name, mode] of [
			["task-planner", "today"],
			["task-planner-overdue", "overdue"],
			["task-planner-dueweek", "dueweek"],
		]) {
			this.registerMarkdownCodeBlockProcessor(name, (_src, el, ctx) => {
				const r = new TaskPlannerRenderer(this.app, el, mode);
				r.plugin = this;
				this.renderers.push(r);
				ctx.addChild(r);
			});
		}
	}
};
