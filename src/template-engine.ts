import type { App, Editor } from "obsidian";
import type { FlowtimeSettings } from "./types";

interface FlowtimePluginRef {
  settings: FlowtimeSettings;
}

interface CreateProjectOpts {
  scaffoldTasks?: boolean;
  scaffoldWiki?: boolean;
}

export class TemplateEngine {
  private app: App;
  private plugin: FlowtimePluginRef;

  constructor(app: App, plugin: FlowtimePluginRef) {
    this.app = app;
    this.plugin = plugin;
  }

  render(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp("\\{\\{" + key + "\\}\\}", "g"), value || "");
    }
    return result;
  }

  getDailyVars(): Record<string, string> {
    const today = new Date().toISOString().split("T")[0];
    return { DATE: today };
  }

  getWeeklyVars(): Record<string, string> {
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

  getProjectVars(name: string): Record<string, string> {
    return { NAME: name || "" };
  }

  insertAtCursor(editor: Editor, content: string): void {
    const cursor = editor.getCursor();
    editor.replaceRange(content, cursor);
  }

  insertDaily(): boolean {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) return false;
    const content = this.render(this.plugin.settings.dailyTemplate, this.getDailyVars());
    this.insertAtCursor(editor, content);
    return true;
  }

  insertWeekly(): boolean {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) return false;
    const content = this.render(this.plugin.settings.weeklyTemplate, this.getWeeklyVars());
    this.insertAtCursor(editor, content);
    return true;
  }

  insertWeekplan(): boolean {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) return false;
    this.insertAtCursor(editor, "```flowtime-weekplan\n```");
    return true;
  }

  getDashboardDailyTemplate(): string {
    return `# Dashboard \u2014 Today

## \u{1F504} Carry Over
\`\`\`flowtime-overdue
\`\`\`

## \u{1F3AF} Today
\`\`\`flowtime-today
\`\`\`

## \u26A0\uFE0F Due This Week
\`\`\`flowtime-dueweek
\`\`\`
`;
  }

  getDashboardWeeklyTemplate(): string {
    return `# Dashboard \u2014 Weekly

## \u{1F504} Carry Over
\`\`\`flowtime-overdue
\`\`\`

## \u{1F3AF} Today
\`\`\`flowtime-today
\`\`\`

## \u26A0\uFE0F Due This Week
\`\`\`flowtime-dueweek
\`\`\`

## \u{1F4C5} Week Plan
\`\`\`flowtime-weekplan
\`\`\`

## \u{1F4CA} This Week (by project)
\`\`\`flowtime-weekly
\`\`\`

## \u{1F4CA} Budget Overview
\`\`\`flowtime-buckets
\`\`\`

## \u{1F4CB} Session History
\`\`\`flowtime-sessions
\`\`\`
`;
  }

  getTodayTemplate(): string {
    return `# \u{1F4C5} Today

## \u{1F3AF} Today
\`\`\`flowtime-today
\`\`\`

## \u{1F504} Carry Over
\`\`\`flowtime-overdue
\`\`\`

## \u25CC Up Next
\`\`\`flowtime-soon
\`\`\`

## \u{1F4DD} Notes
`;
  }

  async createToday(path?: string): Promise<string> {
    const filePath = path || "Today.md";
    const exists = this.app.vault.getAbstractFileByPath(filePath);
    if (exists) return filePath;
    await this.app.vault.create(filePath, this.getTodayTemplate());
    return filePath;
  }

  async createDashboard(mode: "daily" | "weekly"): Promise<string | null> {
    const path = mode === "weekly" ? "Dashboard Weekly.md" : "Dashboard.md";
    const exists = this.app.vault.getAbstractFileByPath(path);
    if (exists) return null;
    const content = mode === "weekly" ? this.getDashboardWeeklyTemplate() : this.getDashboardDailyTemplate();
    await this.app.vault.create(path, content);
    return path;
  }

  getProjectTasksTemplate(name: string): string {
    return `# ${name} \u2014 Tasks

## \u{1F3AF} Active Sprint

\`\`\`flowtime-project
\`\`\`

## \u{1F4CB} Backlog
`;
  }

  getProjectWikiTemplate(name: string): string {
    return `# ${name} \u2014 Wiki

## Overview

## Architecture

## Decisions

## Reference Links

## Meeting Notes
`;
  }

  async createProject(name: string, opts: CreateProjectOpts = {}): Promise<{ notePath: string; tasksPath: string; wikiPath: string }> {
    const scaffoldTasks = opts.scaffoldTasks !== false;
    const scaffoldWiki = opts.scaffoldWiki !== false;

    const root = this.plugin.settings.projectsRoot || "";
    const basePath = root ? root + "/" + name : name;
    const notePath = basePath + "/" + name + ".md";
    const tasksPath = basePath + "/" + name + " Tasks.md";
    const wikiPath = basePath + "/" + name + " Wiki.md";

    const folderExists = this.app.vault.getAbstractFileByPath(basePath);
    if (!folderExists) {
      await this.app.vault.createFolder(basePath);
    }

    const content = this.render(this.plugin.settings.projectTemplate, { NAME: name });
    const noteExists = this.app.vault.getAbstractFileByPath(notePath);
    if (!noteExists) {
      await this.app.vault.create(notePath, content);
    }

    if (scaffoldTasks) {
      const tasksExists = this.app.vault.getAbstractFileByPath(tasksPath);
      if (!tasksExists) {
        await this.app.vault.create(tasksPath, this.getProjectTasksTemplate(name));
      }
    }

    if (scaffoldWiki) {
      const wikiExists = this.app.vault.getAbstractFileByPath(wikiPath);
      if (!wikiExists) {
        await this.app.vault.create(wikiPath, this.getProjectWikiTemplate(name));
      }
    }

    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (file) {
      await this.app.workspace.getLeaf().openFile(file as import("obsidian").TFile);
    }

    return { notePath, tasksPath, wikiPath };
  }
}
