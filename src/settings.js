const { PluginSettingTab, Setting } = require("obsidian");

const DEFAULT_SETTINGS = {
	// Project Detection
	projectFrontmatterKey: "type",
	projectFrontmatterValue: "project",
	projectNameKey: "name",
	fallbackToFolderName: true,
	tagPrefix: "project/",
	projectsRoot: "",

	// Quick Entry
	quickEntryTargetFile: "daily-note",

	// Buckets
	buckets: [
		{ id: "deep-work", name: "Deep Work", color: "#4a9eff", weeklyLimit: 20, sortOrder: 0 },
		{ id: "admin", name: "Admin", color: "#a8a8a8", weeklyLimit: 5, sortOrder: 1 },
		{ id: "meetings", name: "Meetings", color: "#e6a700", weeklyLimit: 5, sortOrder: 2 },
	],
	bucketPrefix: "budget/",
	dailyCap: 12,

	// Display
	dateFormat: "YYYY-MM-DD",
	statusBarTimer: true,
	contentWidth: 0,

	// Notifications
	timerSound: true,
	noticeDuration: 4000,
	quietMode: false,

	// Templates
	dailyTemplate:
		"## 🔄 Carry Over\n```flowtime-overdue\n```\n\n## 🎯 Today\n```flowtime-today\n```\n\n## ⚠️ Due This Week\n```flowtime-dueweek\n```\n\n## 📝 Notes\n- [ ] Morning review 🔺 🔁 every day @{{DATE}}\n- [ ] Quick note @{{DATE}}\n",
	weeklyTemplate:
		"## 📊 This Week\n```flowtime-weekly\n```\n\n## ⚠️ Due Next Week\n```flowtime-dueweek\n```\n\n## 📝 Review\n- [ ] Plan next week 🔁 every week @{{WEEK_END}}\n- [ ] Review goals 🔺 @{{WEEK_END}}\n",
	projectTemplate:
		"---\ntype: project\nname: {{NAME}}\nstatus: active\ntags: [project]\n---\n\n# {{NAME}}\n\n## 🎯 Goal\n\n## 📋 Tasks\n\n```flowtime-project\n```\n\n## 📝 Notes\n",

	// Inbox
	inboxPath: "Inbox.md",
	inboxDefaultDuration: 30,
	inboxDefaultBucket: "",
	inboxDefaultProject: "",

	// Saved Views
	savedViews: {},

	// Routines (v0.5.0)
	routinesFolder: "flowtime/routines/",
	vacationMode: false,
	autoGenerateOnStartup: true,
	autoGenerateOnOpenDaily: true,
	workdays: [1, 2, 3, 4, 5], // Mon-Fri
	weekStartDay: 1, // Monday
	hideCompletedRoutines: false,
};

class FlowtimeSettingsTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	_applyContentWidth(px) {
		if (px > 0) {
			document.body.classList.add("ft-wide");
			document.body.style.setProperty("--ft-content-width", px + "px");
		} else {
			document.body.classList.remove("ft-wide");
			document.body.style.removeProperty("--ft-content-width");
		}
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		// ── Project Detection ──
		containerEl.createEl("h2", { text: "Project Detection" });

		new Setting(containerEl)
			.setName("Frontmatter key")
			.setDesc("Frontmatter field that marks a note as a project root")
			.addText((text) =>
				text
					.setPlaceholder("type")
					.setValue(this.plugin.settings.projectFrontmatterKey)
					.onChange(async (value) => {
						this.plugin.settings.projectFrontmatterKey = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Frontmatter value")
			.setDesc("Value of the frontmatter key that triggers project detection")
			.addText((text) =>
				text
					.setPlaceholder("project")
					.setValue(this.plugin.settings.projectFrontmatterValue)
					.onChange(async (value) => {
						this.plugin.settings.projectFrontmatterValue = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Project name key")
			.setDesc("Frontmatter field used as the project display name")
			.addText((text) =>
				text
					.setPlaceholder("name")
					.setValue(this.plugin.settings.projectNameKey)
					.onChange(async (value) => {
						this.plugin.settings.projectNameKey = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Fallback to folder name")
			.setDesc("Use folder name as the project name when no frontmatter marker is found")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.fallbackToFolderName)
					.onChange(async (value) => {
						this.plugin.settings.fallbackToFolderName = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Tag prefix")
			.setDesc("Prefix for @p: project tags (e.g. @p:Website). Legacy #project/ prefix is deprecated.")
			.addText((text) =>
				text
					.setPlaceholder("project/")
					.setValue(this.plugin.settings.tagPrefix)
					.onChange(async (value) => {
						this.plugin.settings.tagPrefix = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Projects root")
			.setDesc("Root folder for projects — leave empty to scan the entire vault")
			.addText((text) =>
				text
					.setPlaceholder("")
					.setValue(this.plugin.settings.projectsRoot)
					.onChange(async (value) => {
						const oldRoot = this.plugin.settings.projectsRoot;
						this.plugin.settings.projectsRoot = value;
						await this.plugin.saveData(this.plugin.settings);
						// Detect change and offer to rebuild cache
						if (oldRoot !== value) {
							this.plugin.taskCache?.clear();
							new Notice("🔄 Projects root changed — task cache cleared. It will rebuild on next render.", 5000);
						}
					}),
			);

		// ── Quick Entry ──
		containerEl.createEl("h2", { text: "Quick Entry" });

		new Setting(containerEl)
			.setName("Default target file")
			.setDesc("Where new tasks are saved by default")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("daily-note", "Daily note")
					.addOption("active-file", "Active file")
					.addOption("project-file", "Project file")
					.addOption("inbox", "Inbox")
					.setValue(this.plugin.settings.quickEntryTargetFile)
					.onChange(async (value) => {
						this.plugin.settings.quickEntryTargetFile = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		// ── Buckets ──
		containerEl.createEl("h2", { text: "Buckets" });

		new Setting(containerEl)
			.setName("Bucket tag prefix")
			.setDesc("Prefix used for bucket tags (e.g. @budget:deep-work)")
			.addText((text) =>
				text
					.setPlaceholder("budget/")
					.setValue(this.plugin.settings.bucketPrefix)
					.onChange(async (value) => {
						this.plugin.settings.bucketPrefix = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Daily budget cap (hours)")
			.setDesc("Maximum scheduled hours per day before warning")
			.addText((text) =>
				text
					.setPlaceholder("12")
					.setValue(String(this.plugin.settings.dailyCap))
					.onChange(async (value) => {
						const num = parseFloat(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.dailyCap = num;
							await this.plugin.saveData(this.plugin.settings);
						}
					}),
			);

		containerEl.createEl("h3", { text: "Configure Buckets" });

		// Render each bucket
		const buckets = this.plugin.settings.buckets || [];
		for (const bucket of buckets) {
			new Setting(containerEl)
				.setName(bucket.name)
				.setDesc(`Weekly limit: ${bucket.weeklyLimit}h · Color: ${bucket.color}`)
				.addText((text) =>
					text
						.setPlaceholder("Name")
						.setValue(bucket.name)
						.onChange(async (value) => {
							bucket.name = value;
							bucket.id = value
								.toLowerCase()
								.replace(/\s+/g, "-")
								.replace(/[^a-z0-9-]/g, "");
							await this.plugin.saveData(this.plugin.settings);
						}),
				)
				.addText((text) =>
					text
						.setPlaceholder("Weekly limit (h)")
						.setValue(String(bucket.weeklyLimit))
						.onChange(async (value) => {
							const num = parseFloat(value);
							if (!isNaN(num) && num > 0) {
								bucket.weeklyLimit = num;
								await this.plugin.saveData(this.plugin.settings);
							}
						}),
				)
				.addColorPicker((picker) =>
					picker
						.setValue(bucket.color)
						.onChange(async (value) => {
							bucket.color = value;
							// Update the swatch in the description
							await this.plugin.saveData(this.plugin.settings);
							this.display();
						}),
				)
				.addExtraButton((btn) =>
					btn
						.setIcon("trash")
						.setTooltip("Delete bucket")
						.onClick(async () => {
							this.plugin.settings.buckets =
								this.plugin.settings.buckets.filter(
									(b) => b.id !== bucket.id,
								);
							await this.plugin.saveData(this.plugin.settings);
							this.display(); // Re-render
						}),
				);
		}

		// Add Bucket button
		new Setting(containerEl).setName("Add new bucket").addButton((btn) =>
			btn
				.setButtonText("+ Add Bucket")
				.setCta()
				.onClick(async () => {
					const buckets = this.plugin.settings.buckets || [];
					const newBucket = {
						id: "bucket-" + (buckets.length + 1),
						name: "New Bucket",
						color: "#4a9eff",
						weeklyLimit: 10,
						sortOrder: buckets.length,
					};
					buckets.push(newBucket);
					this.plugin.settings.buckets = buckets;
					await this.plugin.saveData(this.plugin.settings);
					this.display(); // Re-render
				}),
		);

		// ── Inbox ──
		containerEl.createEl("h2", { text: "Inbox" });

		new Setting(containerEl)
			.setName("Inbox file path")
			.setDesc("Path to the inbox file where you capture tasks. Relative to vault root.")
			.addText((text) =>
				text
					.setPlaceholder("Inbox.md")
					.setValue(this.plugin.settings.inboxPath)
					.onChange(async (value) => {
						this.plugin.settings.inboxPath = value || "Inbox.md";
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Default duration (minutes)")
			.setDesc("Pre-filled duration when processing inbox items as tasks")
			.addText((text) =>
				text
					.setPlaceholder("30")
					.setValue(String(this.plugin.settings.inboxDefaultDuration))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 0) {
							this.plugin.settings.inboxDefaultDuration = num;
							await this.plugin.saveData(this.plugin.settings);
						}
					}),
			);

		new Setting(containerEl)
			.setName("Default bucket")
			.setDesc("Pre-filled bucket when processing inbox items as tasks (leave empty for none)")
			.addDropdown((dropdown) => {
				dropdown.addOption("", "None");
				const buckets = this.plugin.settings.buckets || [];
				for (const b of buckets) {
					dropdown.addOption(b.id, b.name);
				}
				dropdown
					.setValue(this.plugin.settings.inboxDefaultBucket)
					.onChange(async (value) => {
						this.plugin.settings.inboxDefaultBucket = value;
						await this.plugin.saveData(this.plugin.settings);
					});
				return dropdown;
			});

		// ── Display ──
		containerEl.createEl("h2", { text: "Display" });

		new Setting(containerEl)
			.setName("Date format")
			.setDesc("Format string for dates (uses moment.js syntax)")
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD")
					.setValue(this.plugin.settings.dateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dateFormat = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Show timer in status bar")
			.setDesc("Display the running countdown timer in the status bar")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.statusBarTimer)
					.onChange(async (value) => {
						this.plugin.settings.statusBarTimer = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		let cwSlider;
		new Setting(containerEl)
			.setName("Content width")
			.setDesc("Max width of the content area in pixels — 0 uses Obsidian's default width")
			.addSlider((slider) => {
				cwSlider = slider;
				slider
					.setLimits(0, 1920, 20)
					.setValue(this.plugin.settings.contentWidth)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.contentWidth = value;
						await this.plugin.saveData(this.plugin.settings);
						this._applyContentWidth(value);
					});
			})
			.addExtraButton((btn) =>
				btn
					.setIcon("reset")
					.setTooltip("Reset to default")
					.onClick(async () => {
						this.plugin.settings.contentWidth = 0;
						await this.plugin.saveData(this.plugin.settings);
						cwSlider.setValue(0);
						this._applyContentWidth(0);
					}),
			);

		// ── Notifications ──
		containerEl.createEl("h2", { text: "Notifications" });

		new Setting(containerEl)
			.setName("Play sound on timer expiry")
			.setDesc("Beep when a countdown timer reaches zero")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.timerSound)
					.onChange(async (value) => {
						this.plugin.settings.timerSound = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Notice duration")
			.setDesc("How long notifications stay visible, in milliseconds (0 = persistent)")
			.addText((text) =>
				text
					.setPlaceholder("4000")
					.setValue(String(this.plugin.settings.noticeDuration))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 0) {
							this.plugin.settings.noticeDuration = num;
							await this.plugin.saveData(this.plugin.settings);
						}
					}),
			);

		new Setting(containerEl)
			.setName("Quiet mode")
			.setDesc("Suppress all non-error notifications")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.quietMode)
					.onChange(async (value) => {
						this.plugin.settings.quietMode = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		// ── Templates ──
		containerEl.createEl("h2", { text: "Templates" });

		let dailyTaEl;
		new Setting(containerEl)
			.setName("Daily template")
			.setDesc("Template used for the daily note dashboard")
			.addTextArea((text) => {
				dailyTaEl = text.inputEl;
				text
					.setPlaceholder("Enter daily template…")
					.setValue(this.plugin.settings.dailyTemplate)
					.onChange(async (value) => {
						this.plugin.settings.dailyTemplate = value;
						await this.plugin.saveData(this.plugin.settings);
					});
			})
			.then((setting) => {
				setting.controlEl.querySelector("textarea").rows = 8;
			})
			.addExtraButton((btn) =>
				btn
					.setIcon("reset")
					.setTooltip("Restore default")
					.onClick(async () => {
						this.plugin.settings.dailyTemplate =
							DEFAULT_SETTINGS.dailyTemplate;
						await this.plugin.saveData(this.plugin.settings);
						dailyTaEl.value = DEFAULT_SETTINGS.dailyTemplate;
					}),
			);

		let weeklyTaEl;
		new Setting(containerEl)
			.setName("Weekly template")
			.setDesc("Template used for the weekly review note")
			.addTextArea((text) => {
				weeklyTaEl = text.inputEl;
				text
					.setPlaceholder("Enter weekly template…")
					.setValue(this.plugin.settings.weeklyTemplate)
					.onChange(async (value) => {
						this.plugin.settings.weeklyTemplate = value;
						await this.plugin.saveData(this.plugin.settings);
					});
			})
			.then((setting) => {
				setting.controlEl.querySelector("textarea").rows = 6;
			})
			.addExtraButton((btn) =>
				btn
					.setIcon("reset")
					.setTooltip("Restore default")
					.onClick(async () => {
						this.plugin.settings.weeklyTemplate =
							DEFAULT_SETTINGS.weeklyTemplate;
						await this.plugin.saveData(this.plugin.settings);
						weeklyTaEl.value = DEFAULT_SETTINGS.weeklyTemplate;
					}),
			);

		let projTaEl;
		new Setting(containerEl)
			.setName("Project template")
			.setDesc("Template used when creating a new project folder note")
			.addTextArea((text) => {
				projTaEl = text.inputEl;
				text
					.setPlaceholder("Enter project template…")
					.setValue(this.plugin.settings.projectTemplate)
					.onChange(async (value) => {
						this.plugin.settings.projectTemplate = value;
						await this.plugin.saveData(this.plugin.settings);
					});
			})
			.then((setting) => {
				setting.controlEl.querySelector("textarea").rows = 8;
			})
			.addExtraButton((btn) =>
				btn
					.setIcon("reset")
					.setTooltip("Restore default")
					.onClick(async () => {
						this.plugin.settings.projectTemplate =
							DEFAULT_SETTINGS.projectTemplate;
						await this.plugin.saveData(this.plugin.settings);
						projTaEl.value = DEFAULT_SETTINGS.projectTemplate;
					}),
			);

		// ── Routines (v0.5.0) ──
		containerEl.createEl("h2", { text: "Routines" });

		new Setting(containerEl)
			.setName("Routines folder")
			.setDesc("Folder where routine template markdown files live. Each task line with 🔁 becomes a routine.")
			.addText((text) =>
				text
					.setPlaceholder("flowtime/routines/")
					.setValue(this.plugin.settings.routinesFolder)
					.onChange(async (value) => {
						this.plugin.settings.routinesFolder = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Vacation mode")
			.setDesc("Pause all routine generation. No new routine tasks will be created until this is turned off.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.vacationMode)
					.onChange(async (value) => {
						this.plugin.settings.vacationMode = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Auto-generate on startup")
			.setDesc("Run routine engine when the plugin loads.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoGenerateOnStartup)
					.onChange(async (value) => {
						this.plugin.settings.autoGenerateOnStartup = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Auto-generate on open daily note")
			.setDesc("Generate routines when today's daily note is opened.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoGenerateOnOpenDaily)
					.onChange(async (value) => {
						this.plugin.settings.autoGenerateOnOpenDaily = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Workdays")
			.setDesc("Which days are considered workdays for the 🔁 every workday recurrence. Comma-separated numbers (0=Sun, 1=Mon, ... 6=Sat). Default: 1,2,3,4,5")
			.addText((text) =>
				text
					.setPlaceholder("1,2,3,4,5")
					.setValue((this.plugin.settings.workdays || [1,2,3,4,5]).join(","))
					.onChange(async (value) => {
						const nums = value.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 0 && n <= 6);
						if (nums.length > 0) {
							this.plugin.settings.workdays = nums;
							await this.plugin.saveData(this.plugin.settings);
						}
					}),
			);

		new Setting(containerEl)
			.setName("Week start day")
			.setDesc("First day of the week for the weekplan view. 0=Sunday, 1=Monday.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("0", "Sunday")
					.addOption("1", "Monday")
					.setValue(String(this.plugin.settings.weekStartDay ?? 1))
					.onChange(async (value) => {
						this.plugin.settings.weekStartDay = parseInt(value, 10);
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Hide completed routines")
			.setDesc("Don't show checked-off routine tasks in the weekplan view.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hideCompletedRoutines)
					.onChange(async (value) => {
						this.plugin.settings.hideCompletedRoutines = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);
	}
}

module.exports = { DEFAULT_SETTINGS, FlowtimeSettingsTab };
