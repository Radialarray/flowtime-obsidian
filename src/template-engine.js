class TemplateEngine {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
	}

	// Replace {{VARIABLE}} placeholders with values
	render(template, vars) {
		let result = template;
		for (const [key, value] of Object.entries(vars)) {
			result = result.replace(
				new RegExp("\\{\\{" + key + "\\}\\}", "g"),
				value || "",
			);
		}
		return result;
	}

	// Daily note variables
	getDailyVars() {
		const today = new Date().toISOString().split("T")[0];
		return { DATE: today };
	}

	// Weekly note variables
	getWeeklyVars() {
		const today = new Date();
		const day = today.getDay();
		const monday = new Date(today);
		monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
		const sunday = new Date(monday);
		sunday.setDate(monday.getDate() + 6);
		return {
			DATE: today.toISOString().split("T")[0],
			WEEK_START: monday.toISOString().split("T")[0],
			WEEK_END: sunday.toISOString().split("T")[0],
		};
	}

	// Project variables
	getProjectVars(name) {
		return { NAME: name || "" };
	}

	// Insert content at cursor in active editor
	insertAtCursor(editor, content) {
		const cursor = editor.getCursor();
		editor.replaceRange(content, cursor);
	}

	// Insert daily dashboard template
	insertDaily() {
		const editor = this.app.workspace.activeEditor?.editor;
		if (!editor) return false;
		const content = this.render(
			this.plugin.settings.dailyTemplate,
			this.getDailyVars(),
		);
		this.insertAtCursor(editor, content);
		return true;
	}

	// Insert weekly dashboard template
	insertWeekly() {
		const editor = this.app.workspace.activeEditor?.editor;
		if (!editor) return false;
		const content = this.render(
			this.plugin.settings.weeklyTemplate,
			this.getWeeklyVars(),
		);
		this.insertAtCursor(editor, content);
		return true;
	}

	// Create a new project folder + folder note
	async createProject(name) {
		const root = this.plugin.settings.projectsRoot || "";
		const basePath = root ? root + "/" + name : name;
		const notePath = basePath + "/" + name + ".md";

		// Create folder if it doesn't exist
		const folderExists = this.app.vault.getAbstractFileByPath(basePath);
		if (!folderExists) {
			await this.app.vault.createFolder(basePath);
		}

		// Create folder note from template
		const content = this.render(
			this.plugin.settings.projectTemplate,
			{ NAME: name },
		);

		const noteExists = this.app.vault.getAbstractFileByPath(notePath);
		if (!noteExists) {
			await this.app.vault.create(notePath, content);
		}

		// Open the new note
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (file) {
			await this.app.workspace.getLeaf().openFile(file);
		}

		return notePath;
	}
}

module.exports = { TemplateEngine };
