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

	// ── v0.4.0: Dashboard creation methods ──

	/** Dashboard.md (daily overview) content */
	getDashboardDailyTemplate() {
		return `# Dashboard — Today

## 🔄 Carry Over
\`\`\`flowtime-overdue
\`\`\`

## 🎯 Today
\`\`\`flowtime-today
\`\`\`

## ⚠️ Due This Week
\`\`\`flowtime-dueweek
\`\`\`
`;
	}

	/** Dashboard Weekly.md (full overview) content */
	getDashboardWeeklyTemplate() {
		return `# Dashboard — Weekly

## 🔄 Carry Over
\`\`\`flowtime-overdue
\`\`\`

## 🎯 Today
\`\`\`flowtime-today
\`\`\`

## ⚠️ Due This Week
\`\`\`flowtime-dueweek
\`\`\`

## 📅 Week Plan
\`\`\`flowtime-weekplan
\`\`\`

## 📊 This Week (by project)
\`\`\`flowtime-weekly
\`\`\`

## 📊 Budget Overview
\`\`\`flowtime-buckets
\`\`\`

## 📋 Session History
\`\`\`flowtime-sessions
\`\`\`
`;
	}

	/** Today.md content — always shows today's context */
	getTodayTemplate() {
		return `# 📅 Today

## 🎯 Today
\`\`\`flowtime-today
\`\`\`

## 🔄 Carry Over
\`\`\`flowtime-overdue
\`\`\`

## ◌ Up Next
\`\`\`flowtime-soon
\`\`\`

## 📝 Notes
`;
	}

	/**
	 * Create or ensure Today.md at vault root.
	 * @param {string} [path="Today.md"]
	 * @returns {string|null} path of created/existing file
	 */
	async createToday(path) {
		const filePath = path || "Today.md";
		const exists = this.app.vault.getAbstractFileByPath(filePath);
		if (exists) return filePath;

		await this.app.vault.create(filePath, this.getTodayTemplate());
		return filePath;
	}

	/**
	 * Create a dashboard file at vault root.
	 * @param {"daily"|"weekly"} mode
	 * @returns {string|null} path of created file, or null if already exists
	 */
	async createDashboard(mode) {
		const path = mode === "weekly" ? "Dashboard Weekly.md" : "Dashboard.md";
		const exists = this.app.vault.getAbstractFileByPath(path);
		if (exists) return null;

		const content =
			mode === "weekly"
				? this.getDashboardWeeklyTemplate()
				: this.getDashboardDailyTemplate();

		await this.app.vault.create(path, content);
		return path;
	}

	// v0.4.0: Tasks.md template (no placeholder/fake tasks — just structure)
	getProjectTasksTemplate(name) {
		return `# ${name} — Tasks

## 🎯 Active Sprint

\`\`\`flowtime-project
\`\`\`

## 📋 Backlog
`;
	}

	// v0.4.0: Wiki.md template
	getProjectWikiTemplate(name) {
		return `# ${name} — Wiki

## Overview

## Architecture

## Decisions

## Reference Links

## Meeting Notes
`;
	}

	// Create a new project folder + all 3 standard files
	async createProject(name, opts = {}) {
		const scaffoldTasks = opts.scaffoldTasks !== false;
		const scaffoldWiki = opts.scaffoldWiki !== false;

		const root = this.plugin.settings.projectsRoot || "";
		const basePath = root ? root + "/" + name : name;
		const notePath = basePath + "/" + name + ".md";
		const tasksPath = basePath + "/" + name + " Tasks.md";
		const wikiPath = basePath + "/" + name + " Wiki.md";

		// Create folder if it doesn't exist
		const folderExists = this.app.vault.getAbstractFileByPath(basePath);
		if (!folderExists) {
			await this.app.vault.createFolder(basePath);
		}

		// Create folder note from template
		const content = this.render(this.plugin.settings.projectTemplate, {
			NAME: name,
		});

		const noteExists = this.app.vault.getAbstractFileByPath(notePath);
		if (!noteExists) {
			await this.app.vault.create(notePath, content);
		}

		// Scaffold Tasks.md
		if (scaffoldTasks) {
			const tasksExists = this.app.vault.getAbstractFileByPath(tasksPath);
			if (!tasksExists) {
				await this.app.vault.create(
					tasksPath,
					this.getProjectTasksTemplate(name),
				);
			}
		}

		// Scaffold Wiki.md
		if (scaffoldWiki) {
			const wikiExists = this.app.vault.getAbstractFileByPath(wikiPath);
			if (!wikiExists) {
				await this.app.vault.create(
					wikiPath,
					this.getProjectWikiTemplate(name),
				);
			}
		}

		// Open the folder note
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (file) {
			await this.app.workspace.getLeaf().openFile(file);
		}

		return { notePath, tasksPath, wikiPath };
	}
}

module.exports = { TemplateEngine };
