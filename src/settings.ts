import { PluginSettingTab, Setting, Notice } from "obsidian";
import type { App, Plugin } from "obsidian";
import type { FlowtimeSettings } from "./types";

export const DEFAULT_SETTINGS: FlowtimeSettings = {
  projectFrontmatterKey: "type",
  projectFrontmatterValue: "project",
  projectNameKey: "name",
  fallbackToFolderName: true,
  tagPrefix: "project/",
  projectsRoot: "",

  quickEntryTargetFile: "daily-note",

  buckets: [
    { id: "deep-work", name: "Deep Work", color: "#4a9eff", weeklyLimit: 20, sortOrder: 0 },
    { id: "admin", name: "Admin", color: "#a8a8a8", weeklyLimit: 5, sortOrder: 1 },
    { id: "meetings", name: "Meetings", color: "#e6a700", weeklyLimit: 5, sortOrder: 2 },
  ],
  bucketPrefix: "budget/",
  dailyCap: 12,

  defaultView: "table",
  dateFormat: "YYYY-MM-DD",
  statusBarTimer: true,
  contentWidthPreset: "s",

  timerSound: true,
  noticeDuration: 4000,
  quietMode: false,
  tabHistoryEnabled: true,

  dailyTemplate:
    "## 🔄 Carry Over\n```flowtime-overdue\n```\n\n## 🎯 Today\n```flowtime-today\n```\n\n## ⚠️ Due This Week\n```flowtime-dueweek\n```\n\n## 📝 Notes\n- [ ] Morning review 🔺 🔁 every day @{{DATE}}\n- [ ] Quick note @{{DATE}}\n",
  weeklyTemplate:
    "## 📊 This Week\n```flowtime-weekly\n```\n\n## ⚠️ Due Next Week\n```flowtime-dueweek\n```\n\n## 📝 Review\n- [ ] Plan next week 🔁 every week @{{WEEK_END}}\n- [ ] Review goals 🔺 @{{WEEK_END}}\n",
  projectTemplate:
    "---\ntype: project\nname: {{NAME}}\nstatus: active\ntags: [project]\n---\n\n# {{NAME}}\n\n## 🎯 Goal\n\n## 📋 Tasks\n\n```flowtime-project\n```\n\n## 📝 Notes\n",

  inboxPath: "Inbox.md",
  inboxDefaultDuration: 30,
  inboxDefaultBucket: "",
  inboxDefaultProject: "",

  todayNotePath: "Today.md",

  savedViews: {},

  sprints: [
    {
      id: "q2-staging",
      name: "Q2 Staging",
      start: "2026-04-01",
      end: "2026-06-30",
      goal: "Launch staging environment",
      color: "#2d9ce0",
    },
  ],

  routinesFolder: "Routines/",
  vacationMode: false,
  autoGenerateOnStartup: true,
  autoGenerateOnOpenDaily: true,
  workdays: [1, 2, 3, 4, 5],
  weekStartDay: 1,
  hideCompletedRoutines: false,
};

interface FlowtimePluginType extends Plugin {
  settings: FlowtimeSettings;
  projectEngine: { getAllProjects(): Promise<Array<{ name: string; path: string }>> };
  taskCache: { clear(): void };
  _openTodayNote(): Promise<void>;
  saveData(data: FlowtimeSettings): Promise<void>;
}

export class FlowtimeSettingsTab extends PluginSettingTab {
  plugin: FlowtimePluginType;

  constructor(app: App, plugin: FlowtimePluginType) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private _applyWidthPreset(preset: string): void {
    document.body.classList.remove("ft-wide-s", "ft-wide-m", "ft-wide-l", "ft-wide-xl");
    if (preset && ["s", "m", "l", "xl"].includes(preset)) {
      document.body.classList.add("ft-wide-" + preset);
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    let _g: HTMLElement;

    // ═══ Projects ═══
    _g = containerEl.createEl("div", { cls: "ft-settings-group" });
    _g.createEl("h2", { text: "Projects" });

    new Setting(_g)
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

    new Setting(_g)
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

    new Setting(_g)
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

    new Setting(_g)
      .setName("Fallback to folder name")
      .setDesc("Use folder name as the project display name when no frontmatter marker is found")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.fallbackToFolderName)
          .onChange(async (value) => {
            this.plugin.settings.fallbackToFolderName = value;
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

    new Setting(_g)
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

    new Setting(_g)
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
            if (oldRoot !== value) {
              this.plugin.taskCache?.clear();
              new Notice(
                "🔄 Projects root changed — task cache cleared. It will rebuild on next render.",
                5000,
              );
            }
          }),
      );

    // ═══ Buckets & Budget ═══
    _g = containerEl.createEl("div", { cls: "ft-settings-group" });
    _g.createEl("h2", { text: "Buckets & Budget" });

    new Setting(_g)
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

    new Setting(_g)
      .setName("Daily budget cap")
      .setDesc("Maximum scheduled hours per day before warning (hours)")
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

    containerEl.createEl("h3", { text: "Bucket definitions" });

    const buckets = this.plugin.settings.buckets || [];
    for (const bucket of buckets) {
      new Setting(_g)
        .setName(bucket.name)
        .setDesc(`Weekly limit: ${bucket.weeklyLimit}h · Color: ${bucket.color}`)
        .addText((text) =>
          text
            .setPlaceholder("Name")
            .setValue(bucket.name)
            .onChange(async (value) => {
              bucket.name = value;
              bucket.id = value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
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
          picker.setValue(bucket.color).onChange(async (value) => {
            bucket.color = value;
            await this.plugin.saveData(this.plugin.settings);
            this.display();
          }),
        )
        .addExtraButton((btn) =>
          btn
            .setIcon("trash")
            .setTooltip("Delete bucket")
            .onClick(async () => {
              this.plugin.settings.buckets = this.plugin.settings.buckets.filter(
                (b) => b.id !== bucket.id,
              );
              await this.plugin.saveData(this.plugin.settings);
              this.display();
            }),
        );
    }

    new Setting(_g).setName("Add new bucket").addButton((btn) =>
      btn
        .setButtonText("+ Add Bucket")
        .setCta()
        .onClick(async () => {
          const bks = this.plugin.settings.buckets || [];
          bks.push({
            id: "bucket-" + (bks.length + 1),
            name: "New Bucket",
            color: "#4a9eff",
            weeklyLimit: 10,
            sortOrder: bks.length,
          });
          this.plugin.settings.buckets = bks;
          await this.plugin.saveData(this.plugin.settings);
          this.display();
        }),
    );

    // ═══ Task Capture ═══
    _g = containerEl.createEl("div", { cls: "ft-settings-group" });
    _g.createEl("h2", { text: "Task Capture" });

    new Setting(_g)
      .setName("Quick Entry target")
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

    new Setting(_g)
      .setName("Inbox file")
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

    new Setting(_g)
      .setName("Default duration")
      .setDesc("Pre-filled duration (minutes) when processing inbox items as tasks")
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

    new Setting(_g)
      .setName("Default bucket")
      .setDesc("Pre-filled bucket when processing inbox items (leave empty for none)")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "None");
        for (const b of this.plugin.settings.buckets) {
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

    // ═══ Templates ═══
    _g = containerEl.createEl("div", { cls: "ft-settings-group" });
    _g.createEl("h2", { text: "Templates" });

    {
      let dailyTaEl: HTMLTextAreaElement;
      const dailySetting = new Setting(_g)
        .setName("Daily template")
        .setDesc("Template used for the daily note dashboard")
        .addTextArea((text) => {
          dailyTaEl = text.inputEl as HTMLTextAreaElement;
          text
            .setPlaceholder("Enter daily template\u2026")
            .setValue(this.plugin.settings.dailyTemplate)
            .onChange(async (value) => {
              this.plugin.settings.dailyTemplate = value;
              await this.plugin.saveData(this.plugin.settings);
            });
        });
      dailySetting.settingEl.querySelector("textarea")!.rows = 8;
      dailySetting.addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("Restore default")
          .onClick(async () => {
            this.plugin.settings.dailyTemplate = DEFAULT_SETTINGS.dailyTemplate;
            await this.plugin.saveData(this.plugin.settings);
            dailyTaEl.value = DEFAULT_SETTINGS.dailyTemplate;
          }),
      );
    }

    {
      let weeklyTaEl: HTMLTextAreaElement;
      const weeklySetting = new Setting(_g)
        .setName("Weekly template")
        .setDesc("Template used for the weekly review note")
        .addTextArea((text) => {
          weeklyTaEl = text.inputEl as HTMLTextAreaElement;
          text
            .setPlaceholder("Enter weekly template\u2026")
            .setValue(this.plugin.settings.weeklyTemplate)
            .onChange(async (value) => {
              this.plugin.settings.weeklyTemplate = value;
              await this.plugin.saveData(this.plugin.settings);
            });
        });
      weeklySetting.settingEl.querySelector("textarea")!.rows = 6;
      weeklySetting.addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("Restore default")
          .onClick(async () => {
            this.plugin.settings.weeklyTemplate = DEFAULT_SETTINGS.weeklyTemplate;
            await this.plugin.saveData(this.plugin.settings);
            weeklyTaEl.value = DEFAULT_SETTINGS.weeklyTemplate;
          }),
      );
    }

    {
      let projTaEl: HTMLTextAreaElement;
      const projSetting = new Setting(_g)
        .setName("Project template")
        .setDesc("Template used when creating a new project folder note")
        .addTextArea((text) => {
          projTaEl = text.inputEl as HTMLTextAreaElement;
          text
            .setPlaceholder("Enter project template\u2026")
            .setValue(this.plugin.settings.projectTemplate)
            .onChange(async (value) => {
              this.plugin.settings.projectTemplate = value;
              await this.plugin.saveData(this.plugin.settings);
            });
        });
      projSetting.settingEl.querySelector("textarea")!.rows = 8;
      projSetting.addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("Restore default")
          .onClick(async () => {
            this.plugin.settings.projectTemplate = DEFAULT_SETTINGS.projectTemplate;
            await this.plugin.saveData(this.plugin.settings);
            projTaEl.value = DEFAULT_SETTINGS.projectTemplate;
          }),
      );
    }

    // ═══ Planning & Routines ═══
    _g = containerEl.createEl("div", { cls: "ft-settings-group" });
    _g.createEl("h2", { text: "Planning & Routines" });

    new Setting(_g)
      .setName("Today note")
      .setDesc("Path for the persistent Today note. Shows tasks, overdue, and upcoming items.")
      .addText((text) =>
        text
          .setPlaceholder("Today.md")
          .setValue(this.plugin.settings.todayNotePath)
          .onChange(async (value) => {
            this.plugin.settings.todayNotePath = value || "Today.md";
            await this.plugin.saveData(this.plugin.settings);
          }),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Open")
          .setCta()
          .onClick(async () => {
            await this.plugin._openTodayNote();
          }),
      );

    // Sprints
    containerEl.createEl("h3", { text: "Sprints" });

    const sprints = this.plugin.settings.sprints || [];
    for (const sprint of sprints) {
      const sprintSetting = new Setting(_g)
        .setName(sprint.name || sprint.id)
        .setDesc(`${sprint.goal || ""}  ·  ${sprint.start} → ${sprint.end}`)
        .addText((text) =>
          text
            .setPlaceholder("Name")
            .setValue(sprint.name)
            .onChange(async (value) => {
              sprint.name = value;
              sprint.id = value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
              await this.plugin.saveData(this.plugin.settings);
            }),
        )
        .addText((text) =>
          text
            .setPlaceholder("Goal")
            .setValue(sprint.goal || "")
            .onChange(async (value) => {
              sprint.goal = value;
              await this.plugin.saveData(this.plugin.settings);
            }),
        );

      sprintSetting.addText((text) =>
        text
          .setPlaceholder("Start (YYYY-MM-DD)")
          .setValue(sprint.start || "")
          .onChange(async (value) => {
            sprint.start = value;
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

      sprintSetting.addText((text) =>
        text
          .setPlaceholder("End (YYYY-MM-DD)")
          .setValue(sprint.end || "")
          .onChange(async (value) => {
            sprint.end = value;
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

      sprintSetting.addColorPicker((picker) =>
        picker.setValue(sprint.color || "#2d9ce0").onChange(async (value) => {
          sprint.color = value;
          await this.plugin.saveData(this.plugin.settings);
          this.display();
        }),
      );

      sprintSetting.addExtraButton((btn) =>
        btn
          .setIcon("trash")
          .setTooltip("Delete sprint")
          .onClick(async () => {
            this.plugin.settings.sprints = sprints.filter((s) => s.id !== sprint.id);
            await this.plugin.saveData(this.plugin.settings);
            this.display();
          }),
      );
    }

    new Setting(_g).setName("Add new sprint").addButton((btn) =>
      btn
        .setButtonText("+ Add Sprint")
        .setCta()
        .onClick(async () => {
          const s = this.plugin.settings.sprints || [];
          s.push({
            id: "sprint-" + (s.length + 1),
            name: "New Sprint",
            start: "",
            end: "",
            goal: "",
            color: "#2d9ce0",
          });
          this.plugin.settings.sprints = s;
          await this.plugin.saveData(this.plugin.settings);
          this.display();
        }),
    );

    // Routines
    containerEl.createEl("h3", { text: "Routines" });

    new Setting(_g)
      .setName("Routines folder")
      .setDesc("Folder where routine template markdown files live. Each task line with 🔁 becomes a routine.")
      .addText((text) =>
        text
          .setPlaceholder("Routines/")
          .setValue(this.plugin.settings.routinesFolder)
          .onChange(async (value) => {
            this.plugin.settings.routinesFolder = value;
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

    new Setting(_g)
      .setName("Vacation mode")
      .setDesc("Pause all routine generation. No new routine tasks will be created until turned off.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.vacationMode)
          .onChange(async (value) => {
            this.plugin.settings.vacationMode = value;
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

    new Setting(_g)
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

    new Setting(_g)
      .setName("Auto-generate on open daily")
      .setDesc("Generate routines when today's daily note is opened.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoGenerateOnOpenDaily)
          .onChange(async (value) => {
            this.plugin.settings.autoGenerateOnOpenDaily = value;
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

    new Setting(_g)
      .setName("Workdays")
      .setDesc("Days considered workdays for 🔁 every workday recurrence. Comma-separated (0=Sun … 6=Sat). Default: 1,2,3,4,5")
      .addText((text) =>
        text
          .setPlaceholder("1,2,3,4,5")
          .setValue((this.plugin.settings.workdays || [1, 2, 3, 4, 5]).join(","))
          .onChange(async (value) => {
            const nums = value
              .split(",")
              .map((s) => parseInt(s.trim(), 10))
              .filter((n) => !isNaN(n) && n >= 0 && n <= 6);
            if (nums.length > 0) {
              this.plugin.settings.workdays = nums;
              await this.plugin.saveData(this.plugin.settings);
            }
          }),
      );

    new Setting(_g)
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

    new Setting(_g)
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

    // ═══ Display & Layout ═══
    _g = containerEl.createEl("div", { cls: "ft-settings-group" });
    _g.createEl("h2", { text: "Display & Layout" });

    new Setting(_g)
      .setName("Default view")
      .setDesc("Which view to show for today/soon code blocks")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("table", "Table")
          .addOption("list", "List")
          .setValue(this.plugin.settings.defaultView)
          .onChange(async (value) => {
            this.plugin.settings.defaultView = value as "table" | "list";
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

    new Setting(_g)
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

    new Setting(_g)
      .setName("Content width")
      .setDesc("S = ~700px · M = ~1000px · L = ~1400px · XL = full width (centered)")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("s", "S — Narrow (~700px)")
          .addOption("m", "M — Medium (~1000px)")
          .addOption("l", "L — Wide (~1400px)")
          .addOption("xl", "XL — Full width")
          .setValue(this.plugin.settings.contentWidthPreset)
          .onChange(async (value) => {
            this.plugin.settings.contentWidthPreset = value as FlowtimeSettings["contentWidthPreset"];
            await this.plugin.saveData(this.plugin.settings);
            this._applyWidthPreset(value);
          });
      });

    new Setting(_g)
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

    // ═══ Notifications ═══
    _g = containerEl.createEl("div", { cls: "ft-settings-group" });
    _g.createEl("h2", { text: "Notifications" });

    new Setting(_g)
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

    new Setting(_g)
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

    new Setting(_g)
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

    new Setting(_g)
      .setName("Tab history")
      .setDesc("When closing a tab opened from a Flowtime link, navigate back to the previous tab instead of the next one")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.tabHistoryEnabled)
          .onChange(async (value) => {
            this.plugin.settings.tabHistoryEnabled = value;
            await this.plugin.saveData(this.plugin.settings);
          }),
      );
  }
}
