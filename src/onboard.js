const { Modal, Notice } = require("obsidian");

/** v0.5.0: Default daily routine template — regenerates every workday */
const ROUTINE_DAILY_TEMPLATE = `## 🌅 Morning
- [ ] Morning pages @06:00—06:30 @b:deep-work 🔁 every workday
- [ ] Review today's goals @06:30—06:45 🔁 every workday
- [ ] Check email & messages @06:45—07:00 @b:admin 🔁 every workday

## 🌙 Evening
- [ ] Daily review & tomorrow prep @16:30—17:00 @b:admin 🔁 every workday

## Notes
- This file runs every workday (Mon-Fri by default)
- See also Weekly.md for weekly/monthly routines
`;

/** v0.5.0: Default weekly routine template — weekly/monthly intervals */
const ROUTINE_WEEKLY_TEMPLATE = `## 📅 Weekly
- [ ] Sprint planning @09:00—10:00 🔁 every Mon
- [ ] Weekly review @15:00—16:00 🔁 every Fri
- [ ] Team standup @09:00—09:15 🔁 every Mon Wed Fri

## 📆 Monthly
- [ ] Pay bills 🔁 every month on 1st
- [ ] Review goals 🔁 every month on 15th

## Notes
- This file handles weekly (Mon, Mon Wed Fri) and monthly tasks
- Combined with Daily.md, all routines generate into your daily notes automatically
- Syntax: 🔁 every day | workday | Mon | Mon Wed Fri | 2nd Sun | last Fri | month on 15th | 3 days
`;

const BUCKET_PRESETS = {
	default: {
		label: "Default (Deep Work + Admin + Meetings)",
		buckets: [
			{
				id: "deep-work",
				name: "Deep Work",
				color: "#4a9eff",
				weeklyLimit: 20,
				sortOrder: 0,
			},
			{
				id: "admin",
				name: "Admin",
				color: "#a8a8a8",
				weeklyLimit: 5,
				sortOrder: 1,
			},
			{
				id: "meetings",
				name: "Meetings",
				color: "#e6a700",
				weeklyLimit: 5,
				sortOrder: 2,
			},
		],
	},
	minimal: {
		label: "Minimal (Deep Work only)",
		buckets: [
			{
				id: "deep-work",
				name: "Deep Work",
				color: "#4a9eff",
				weeklyLimit: 40,
				sortOrder: 0,
			},
		],
	},
	creative: {
		label: "Creative (Deep Work + Design + Admin)",
		buckets: [
			{
				id: "deep-work",
				name: "Deep Work",
				color: "#4a9eff",
				weeklyLimit: 15,
				sortOrder: 0,
			},
			{
				id: "design",
				name: "Design",
				color: "#ff6b6b",
				weeklyLimit: 15,
				sortOrder: 1,
			},
			{
				id: "admin",
				name: "Admin",
				color: "#a8a8a8",
				weeklyLimit: 5,
				sortOrder: 2,
			},
		],
	},
};

/**
 * v0.4.0 — Multi-step onboarding wizard.
 * Guides the user through: layout → dashboards → buckets → daily notes → first project
 */
/**
 * Detect which onboarding steps are already done.
 * Returns an object with boolean flags for each step.
 */
async function detectSetupState(app, plugin) {
	const vault = app.vault;
	const settings = plugin.settings;
	const setup = {
		layoutDone: false,
		dashboardDone: false,
		bucketsDone: false,
		dailyNotesDone: false,
		routinesDone: false,
	};

	// Layout: check for any folder notes with "type: project" frontmatter
	try {
		for (const file of vault.getMarkdownFiles()) {
			if (file.name === file.parent?.name + ".md") {
				const content = await vault.read(file);
				if (
					content.includes("type: project") ||
					content.includes('type: "project"')
				) {
					setup.layoutDone = true;
					break;
				}
			}
		}
	} catch (_) {}

	// Dashboard: check if Dashboard.md exists at vault root
	try {
		setup.dashboardDone =
			!!vault.getAbstractFileByPath("Dashboard.md") ||
			!!vault.getAbstractFileByPath("Dashboard Weekly.md");
	} catch (_) {}

	// Buckets: check if buckets have been customized from defaults
	try {
		const buckets = settings.buckets || [];
		// Consider "done" if there are any non-default buckets or limits differ
		const defaultIds = ["deep-work", "admin", "meetings"];
		const hasCustom = buckets.some(
			(b) => b.weeklyLimit !== 20 && b.weeklyLimit !== 5 && b.weeklyLimit !== 5,
		);
		const hasExtra = buckets.some((b) => !defaultIds.includes(b.id));
		setup.bucketsDone =
			buckets.length > 0 && (hasCustom || hasExtra || buckets.length !== 3);
	} catch (_) {}

	// Daily notes: check if daily notes folder exists with files
	try {
		const dailyNotesPath = app.vault.configDir + "/daily-notes.json";
		if (await app.vault.adapter.exists(dailyNotesPath)) {
			const raw = await app.vault.adapter.read(dailyNotesPath);
			const config = JSON.parse(raw);
			const folder = config.folder || "";
			if (folder) {
				const folderEntry = vault.getAbstractFileByPath(folder);
				if (
					folderEntry &&
					folderEntry.children &&
					folderEntry.children.length > 0
				) {
					setup.dailyNotesDone = true;
				}
			}
		}
	} catch (_) {}

	// Routines: check if flowtime/routines/ has .md files
	try {
		const routinesFolder = settings.routinesFolder || "flowtime/routines/";
		const folderEntry = vault.getAbstractFileByPath(
			routinesFolder.replace(/\/$/, ""),
		);
		if (folderEntry && folderEntry.children) {
			const hasRoutineFiles = folderEntry.children.some(
				(c) => c.name.endsWith(".md") && c.name !== ".generated.json",
			);
			setup.routinesDone = hasRoutineFiles;
		}
	} catch (_) {}

	return setup;
}

async function runOnboard(app, plugin) {
	const state = {
		step: 0,
		projectsRoot: "",
		layoutType: "flat",
		createDailyDashboard: true,
		createWeeklyDashboard: false,
		bucketPreset: "default",
		dailyNotesFolder: "Daily",
		firstProjectName: "",
		scaffoldFirstProject: false,
		scaffoldTasks: true,
		scaffoldWiki: true,
		createRoutines: true,
	};

	const setup = await detectSetupState(app, plugin);

	const steps = [
		{ modal: LayoutStepModal, needed: () => !setup.layoutDone },
		{ modal: DashboardStepModal, needed: () => !setup.dashboardDone },
		{ modal: BucketStepModal, needed: () => !setup.bucketsDone },
		{ modal: DailyNotesStepModal, needed: () => !setup.dailyNotesDone },
		{ modal: RoutineStepModal, needed: () => !setup.routinesDone },
		{ modal: ProjectStepModal, needed: () => true }, // always optional
	];

	while (state.step >= 0 && state.step < steps.length) {
		if (!steps[state.step].needed()) {
			state.step++;
			continue;
		}
		const { modal } = steps[state.step];
		await new Promise((resolve) => {
			new modal(app, state, resolve).open();
		});
	}

	if (state.step < 0) return; // cancelled

	try {
		await applySettings(plugin, state);
		plugin.notify("✅ Flowtime workspace ready!");
	} catch (e) {
		plugin.notify("❌ Onboarding failed: " + e.message, true);
	}
}

/* ─── One Step Per Modal ─── */

class LayoutStepModal extends Modal {
	constructor(app, state, onDone) {
		super(app);
		this.state = state;
		this.onDone = onDone;
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Welcome to Flowtime 🕐" });
		contentEl.createEl("p", {
			text: "Let's set up your workspace in a few quick steps.",
			cls: "flowtime-label",
		});

		contentEl.createEl("h3", { text: "Step 1: Workspace Layout" });
		contentEl.createEl("p", {
			text: "Where should projects live?",
			cls: "flowtime-label",
		});

		const mkRadio = (label, group, value, checked) => {
			const lbl = contentEl.createEl("label", { cls: "flowtime-label" });
			const input = lbl.createEl("input", { type: "radio", value: value });
			if (checked) input.checked = true;
			lbl.append(" " + label);
			// Click handler to ensure single-select within group
			lbl.addEventListener("click", () => {
				contentEl.querySelectorAll("input[type='radio']").forEach((r) => {
					if (r !== input && r.getAttribute("data-radio-group") === group)
						r.checked = false;
				});
				input.checked = true;
			});
			input.setAttribute("data-radio-group", group);
			return input;
		};

		mkRadio(
			"Flat layout — projects at vault root (/ProjectA, /ProjectB)",
			"layout",
			"flat",
			true,
		);
		mkRadio(
			"Nested layout — projects under a folder (/Projects/ProjectA)",
			"layout",
			"nested",
		);

		const btnRow = contentEl.createEl("div", { cls: "flowtime-btn-row" });
		const cancelBtn = btnRow.createEl("button", {
			text: "Cancel",
			cls: "flowtime-btn-cancel",
		});
		const nextBtn = btnRow.createEl("button", {
			text: "Next →",
			cls: "flowtime-btn-submit",
		});

		cancelBtn.addEventListener("click", () => {
			this.state.step = -1;
			this.close();
			this.onDone();
		});
		nextBtn.addEventListener("click", () => {
			const sel = contentEl.querySelector(
				"input[data-radio-group='layout']:checked",
			);
			this.state.layoutType = sel ? sel.value : "flat";
			this.state.projectsRoot =
				this.state.layoutType === "nested" ? "Projects" : "";
			this.state.step++;
			this.close();
			this.onDone();
		});
	}
	onClose() {
		this.contentEl.empty();
	}
}

class DashboardStepModal extends Modal {
	constructor(app, state, onDone) {
		super(app);
		this.state = state;
		this.onDone = onDone;
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Step 2: Dashboard Templates" });
		contentEl.createEl("p", {
			text: "Create overview files at vault root with Flowtime code blocks already in place.",
			cls: "flowtime-label",
		});

		const dailyCb = contentEl.createEl("label", { cls: "flowtime-label" });
		const dailyCheck = dailyCb.createEl("input", { type: "checkbox" });
		dailyCheck.checked = true;
		dailyCheck.style.marginRight = "6px";
		dailyCb.append(
			" Dashboard.md — daily overview (overdue + today + due this week)",
		);

		const weeklyCb = contentEl.createEl("label", { cls: "flowtime-label" });
		const weeklyCheck = weeklyCb.createEl("input", { type: "checkbox" });
		weeklyCheck.style.marginRight = "6px";
		weeklyCb.append(
			" Dashboard Weekly.md — full overview (+ weekly + budget + sessions + weekplan)",
		);

		contentEl.createEl("p", {
			text: "Tip: Start with the daily dashboard. You can add the weekly one later.",
			cls: "flowtime-label",
			attr: {
				style:
					"color: var(--text-muted); font-size: var(--font-ui-smaller); margin-top: 12px;",
			},
		});

		const btnRow = contentEl.createEl("div", { cls: "flowtime-btn-row" });
		const backBtn = btnRow.createEl("button", {
			text: "← Back",
			cls: "flowtime-btn-cancel",
		});
		const nextBtn = btnRow.createEl("button", {
			text: "Next →",
			cls: "flowtime-btn-submit",
		});

		backBtn.addEventListener("click", () => {
			this.state.step--;
			this.close();
			this.onDone();
		});
		nextBtn.addEventListener("click", () => {
			this.state.createDailyDashboard = dailyCheck.checked;
			this.state.createWeeklyDashboard = weeklyCheck.checked;
			this.state.step++;
			this.close();
			this.onDone();
		});
	}
	onClose() {
		this.contentEl.empty();
	}
}

class BucketStepModal extends Modal {
	constructor(app, state, onDone) {
		super(app);
		this.state = state;
		this.onDone = onDone;
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Step 3: Time Budgets (Buckets)" });
		contentEl.createEl("p", {
			text: "Choose a bucket preset, or skip to keep your current configuration.",
			cls: "flowtime-label",
		});

		let firstPreset = null;
		for (const [key, preset] of Object.entries(BUCKET_PRESETS)) {
			const groupId = "buckets-" + Math.random().toString(36).slice(2, 6);
			const lbl = contentEl.createEl("label", { cls: "flowtime-label" });
			const input = lbl.createEl("input", { type: "radio", value: key });
			if (!firstPreset) firstPreset = input;
			input.checked = key === "default";
			lbl.append(" " + preset.label);
			lbl.addEventListener("click", () => {
				contentEl
					.querySelectorAll("input[type='radio']")
					.forEach((r) => (r.checked = false));
				input.checked = true;
			});
		}

		// Skip option
		const skipLbl = contentEl.createEl("label", { cls: "flowtime-label" });
		const skipInput = skipLbl.createEl("input", {
			type: "radio",
			value: "keep",
		});
		skipLbl.append(" Skip — keep my current buckets");
		skipLbl.addEventListener("click", () => {
			contentEl
				.querySelectorAll("input[type='radio']")
				.forEach((r) => (r.checked = false));
			skipInput.checked = true;
		});

		const btnRow = contentEl.createEl("div", { cls: "flowtime-btn-row" });
		const backBtn = btnRow.createEl("button", {
			text: "← Back",
			cls: "flowtime-btn-cancel",
		});
		const nextBtn = btnRow.createEl("button", {
			text: "Next →",
			cls: "flowtime-btn-submit",
		});

		backBtn.addEventListener("click", () => {
			this.state.step--;
			this.close();
			this.onDone();
		});
		nextBtn.addEventListener("click", () => {
			const sel = contentEl.querySelector("input[type='radio']:checked");
			this.state.bucketPreset = sel ? sel.value : "keep";
			this.state.step++;
			this.close();
			this.onDone();
		});
	}
	onClose() {
		this.contentEl.empty();
	}
}

class DailyNotesStepModal extends Modal {
	constructor(app, state, onDone) {
		super(app);
		this.state = state;
		this.onDone = onDone;
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Step 4: Daily Notes" });
		contentEl.createEl("p", {
			text: "Set the folder for daily notes (YYYY-MM-DD.md files).",
			cls: "flowtime-label",
		});
		contentEl.createEl("label", {
			text: "Daily notes folder:",
			cls: "flowtime-label",
		});
		const folderInput = contentEl.createEl("input", {
			type: "text",
			value: this.state.dailyNotesFolder,
			placeholder: "Daily",
			cls: "flowtime-input",
		});
		contentEl.createEl("p", {
			text: "This will update .obsidian/daily-notes.json and create the folder if needed.",
			cls: "flowtime-label",
			attr: {
				style:
					"color: var(--text-muted); font-size: var(--font-ui-smaller); margin-top: 8px;",
			},
		});

		const btnRow = contentEl.createEl("div", { cls: "flowtime-btn-row" });
		const backBtn = btnRow.createEl("button", {
			text: "← Back",
			cls: "flowtime-btn-cancel",
		});
		const nextBtn = btnRow.createEl("button", {
			text: "Next →",
			cls: "flowtime-btn-submit",
		});

		backBtn.addEventListener("click", () => {
			this.state.step--;
			this.close();
			this.onDone();
		});
		nextBtn.addEventListener("click", () => {
			this.state.dailyNotesFolder = folderInput.value.trim() || "Daily";
			this.state.step++;
			this.close();
			this.onDone();
		});
	}
	onClose() {
		this.contentEl.empty();
	}
}

class RoutineStepModal extends Modal {
	constructor(app, state, onDone) {
		super(app);
		this.state = state;
		this.onDone = onDone;
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Step 5: Routines (v0.5.0)" });
		contentEl.createEl("p", {
			text: "Routines auto-generate recurring tasks into your daily notes. Create a template file with 🔁 markers and the engine handles the rest.",
			cls: "flowtime-label",
		});
		contentEl.createEl("p", {
			text: "Sample routine files will be created at flowtime/routines/Daily.md and Weekly.md",
			cls: "flowtime-label",
			attr: {
				style: "color: var(--text-muted); font-size: var(--font-ui-smaller);",
			},
		});

		const preview = contentEl.createEl("div", {
			cls: "flowtime-preview",
			attr: {
				style:
					"background: var(--background-secondary); padding: 8px; border-radius: var(--radius-s); margin-top: 8px; max-height: 200px; overflow-y: auto; font-size: var(--font-ui-smaller); white-space: pre; font-family: var(--font-monospace);",
			},
		});
		preview.setText(ROUTINE_DAILY_TEMPLATE.replace(/\t/g, "  "));

		const createCb = contentEl.createEl("label", {
			cls: "flowtime-label",
			attr: { style: "margin-top: 12px;" },
		});
		const createCheck = createCb.createEl("input", { type: "checkbox" });
		createCheck.checked = true;
		createCheck.style.marginRight = "6px";
		createCb.append(" Create sample routine files (recommended)");

		const btnRow = contentEl.createEl("div", { cls: "flowtime-btn-row" });
		const backBtn = btnRow.createEl("button", {
			text: "← Back",
			cls: "flowtime-btn-cancel",
		});
		const nextBtn = btnRow.createEl("button", {
			text: "Next →",
			cls: "flowtime-btn-submit",
		});

		backBtn.addEventListener("click", () => {
			this.state.step--;
			this.close();
			this.onDone();
		});
		nextBtn.addEventListener("click", () => {
			this.state.createRoutines = createCheck.checked;
			this.state.step++;
			this.close();
			this.onDone();
		});
	}
	onClose() {
		this.contentEl.empty();
	}
}

class ProjectStepModal extends Modal {
	constructor(app, state, onDone) {
		super(app);
		this.state = state;
		this.onDone = onDone;
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Step 6: First Project (optional)" });
		contentEl.createEl("p", {
			text: "Scaffold your first project? You can always create more later.",
			cls: "flowtime-label",
		});

		const nameInput = contentEl.createEl("input", {
			type: "text",
			placeholder: "Project name (leave empty to skip)",
			cls: "flowtime-input",
		});
		nameInput.focus();

		const tasksCb = contentEl.createEl("label", {
			cls: "flowtime-label",
			attr: { style: "margin-top: 12px;" },
		});
		const tasksCheck = tasksCb.createEl("input", { type: "checkbox" });
		tasksCheck.checked = true;
		tasksCheck.style.marginRight = "6px";
		tasksCb.append(" Create Tasks.md");

		const wikiCb = contentEl.createEl("label", { cls: "flowtime-label" });
		const wikiCheck = wikiCb.createEl("input", { type: "checkbox" });
		wikiCheck.checked = true;
		wikiCheck.style.marginRight = "6px";
		wikiCb.append(" Create Wiki.md");

		const btnRow = contentEl.createEl("div", { cls: "flowtime-btn-row" });
		const backBtn = btnRow.createEl("button", {
			text: "← Back",
			cls: "flowtime-btn-cancel",
		});
		const finishBtn = btnRow.createEl("button", {
			text: "🎉 Finish Setup",
			cls: "flowtime-btn-submit",
		});

		backBtn.addEventListener("click", () => {
			this.state.step--;
			this.close();
			this.onDone();
		});
		finishBtn.addEventListener("click", () => {
			this.state.firstProjectName = nameInput.value.trim();
			this.state.scaffoldFirstProject = !!this.state.firstProjectName;
			this.state.scaffoldTasks = tasksCheck.checked;
			this.state.scaffoldWiki = wikiCheck.checked;
			this.state.step = 6; // exit loop
			this.close();
			this.onDone();
		});
	}
	onClose() {
		this.contentEl.empty();
	}
}

/* ─── Apply Settings ─── */

/* ─── Apply Settings ─── */

async function applySettings(plugin, state) {
	const results = [];

	// 1. Update projectsRoot
	plugin.settings.projectsRoot = state.projectsRoot;

	// 2. Buckets — apply preset or keep existing
	if (state.bucketPreset !== "keep" && BUCKET_PRESETS[state.bucketPreset]) {
		plugin.settings.buckets = BUCKET_PRESETS[state.bucketPreset].buckets;
		results.push("buckets configured");
	}

	// 3. Daily notes folder
	try {
		const dailyNotesPath = plugin.app.vault.configDir + "/daily-notes.json";
		const folder = state.dailyNotesFolder;

		// Create folder if missing
		if (!(await plugin.app.vault.adapter.exists(folder))) {
			await plugin.app.vault.createFolder(folder);
			results.push("created Daily/ folder");
		}

		// Update daily-notes.json
		const existingConfig = {};
		try {
			if (await plugin.app.vault.adapter.exists(dailyNotesPath)) {
				const raw = await plugin.app.vault.adapter.read(dailyNotesPath);
				Object.assign(existingConfig, JSON.parse(raw));
			}
		} catch (_) {}
		existingConfig.folder = folder;
		if (!existingConfig.format) existingConfig.format = "YYYY-MM-DD";
		await plugin.app.vault.adapter.write(
			dailyNotesPath,
			JSON.stringify(existingConfig, null, 2),
		);
		results.push("daily notes set to " + folder);
	} catch (e) {
		console.warn("Flowtime: Could not configure daily notes:", e.message);
		results.push("daily notes folder (warning: " + e.message + ")");
	}

	// 4. Create dashboards
	if (state.createDailyDashboard) {
		const path = await plugin.templateEngine.createDashboard("daily");
		if (path) results.push("created " + path);
		else results.push("Dashboard.md already exists");
	}
	if (state.createWeeklyDashboard) {
		const path = await plugin.templateEngine.createDashboard("weekly");
		if (path) results.push("created " + path);
		else results.push("Dashboard Weekly.md already exists");
	}

	// 5. Scaffold first project
	if (state.scaffoldFirstProject && state.firstProjectName) {
		await plugin.templateEngine.createProject(state.firstProjectName, {
			scaffoldTasks: state.scaffoldTasks,
			scaffoldWiki: state.scaffoldWiki,
		});
		results.push("project '" + state.firstProjectName + "' created");
	}

	// 6. Create routines folder and sample template (v0.5.0)
	const routinesFolder = plugin.settings.routinesFolder || "flowtime/routines/";
	try {
		if (!(await plugin.app.vault.adapter.exists(routinesFolder))) {
			await plugin.app.vault.createFolder(routinesFolder.replace(/\/$/, ""));
			results.push("created routines folder");
		}

		if (state.createRoutines) {
			const dailyPath = routinesFolder + "Daily.md";
			const weeklyPath = routinesFolder + "Weekly.md";
			const today = new Date().toISOString().split("T")[0];
			// Replace @today placeholders with actual date
			const dailyContent = ROUTINE_DAILY_TEMPLATE; // daily template has no @today
			const weeklyContent = ROUTINE_WEEKLY_TEMPLATE; // weekly template has no @today

			if (!plugin.app.vault.getAbstractFileByPath(dailyPath)) {
				await plugin.app.vault.create(dailyPath, dailyContent);
				results.push("created " + dailyPath);
			} else {
				results.push(dailyPath + " already exists");
			}

			if (!plugin.app.vault.getAbstractFileByPath(weeklyPath)) {
				await plugin.app.vault.create(weeklyPath, weeklyContent);
				results.push("created " + weeklyPath);
			} else {
				results.push(weeklyPath + " already exists");
			}
		}
	} catch (e) {
		console.warn("Flowtime: Could not set up routines:", e.message);
		results.push("routines (warning: " + e.message + ")");
	}

	// Save all settings
	await plugin.saveData(plugin.settings);
	if (plugin.taskCache) plugin.taskCache.clear();

	new Notice("✅ Flowtime setup complete: " + results.join(", "), 6000);
}

module.exports = { runOnboard };
