/**
 * Template Engine — pure functions for template rendering and note creation.
 * All functions are stateless; app/settings passed as parameters.
 */

import type { App, Editor } from "obsidian";
import type { FlowtimeSettings } from "./types";

interface CreateProjectOpts {
  scaffoldTasks?: boolean;
  scaffoldWiki?: boolean;
}

/* ─── Pure helpers ─── */

export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp("\\{\\{" + key + "\\}\\}", "g"), value || "");
  }
  return result;
}

export function getDailyVars(): Record<string, string> {
  return { DATE: new Date().toISOString().split("T")[0] };
}

export function getWeeklyVars(): Record<string, string> {
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

export function getProjectVars(name: string): Record<string, string> {
  return { NAME: name || "" };
}

/* ─── Template strings ─── */

export function getDashboardDailyTemplate(): string {
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

export function getDashboardWeeklyTemplate(): string {
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

export function getTodayTemplate(): string {
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

export function getProjectTasksTemplate(name: string): string {
  return `# ${name} \u2014 Tasks

## \u{1F3AF} Active Sprint

\`\`\`flowtime-project
\`\`\`

## \u{1F4CB} Backlog
`;
}

export function getProjectWikiTemplate(name: string): string {
  return `# ${name} \u2014 Wiki

## Overview

## Architecture

## Decisions

## Reference Links

## Meeting Notes
`;
}

/* ─── Editor insertion ─── */

export function insertAtCursor(editor: Editor, content: string): void {
  const cursor = editor.getCursor();
  editor.replaceRange(content, cursor);
}

export function insertDaily(app: App, settings: FlowtimeSettings): boolean {
  const editor = app.workspace.activeEditor?.editor;
  if (!editor) return false;
  insertAtCursor(editor, renderTemplate(settings.dailyTemplate, getDailyVars()));
  return true;
}

export function insertWeekly(app: App, settings: FlowtimeSettings): boolean {
  const editor = app.workspace.activeEditor?.editor;
  if (!editor) return false;
  insertAtCursor(editor, renderTemplate(settings.weeklyTemplate, getWeeklyVars()));
  return true;
}

export function insertWeekplan(app: App): boolean {
  const editor = app.workspace.activeEditor?.editor;
  if (!editor) return false;
  insertAtCursor(editor, "```flowtime-weekplan\n```");
  return true;
}

/* ─── Note creation ─── */

export async function createToday(app: App, path?: string): Promise<string> {
  const filePath = path || "Today.md";
  const exists = app.vault.getAbstractFileByPath(filePath);
  if (exists) return filePath;
  await app.vault.create(filePath, getTodayTemplate());
  return filePath;
}

export async function createDashboard(app: App, mode: "daily" | "weekly"): Promise<string | null> {
  const path = mode === "weekly" ? "Dashboard Weekly.md" : "Dashboard.md";
  const exists = app.vault.getAbstractFileByPath(path);
  if (exists) return null;
  const content = mode === "weekly" ? getDashboardWeeklyTemplate() : getDashboardDailyTemplate();
  await app.vault.create(path, content);
  return path;
}

export async function createProject(
  app: App,
  settings: FlowtimeSettings,
  name: string,
  opts: CreateProjectOpts = {},
): Promise<{ notePath: string; tasksPath: string; wikiPath: string }> {
  const scaffoldTasks = opts.scaffoldTasks !== false;
  const scaffoldWiki = opts.scaffoldWiki !== false;

  const root = settings.projectsRoot || "";
  const basePath = root ? root + "/" + name : name;
  const notePath = basePath + "/" + name + ".md";
  const tasksPath = basePath + "/" + name + " Tasks.md";
  const wikiPath = basePath + "/" + name + " Wiki.md";

  const folderExists = app.vault.getAbstractFileByPath(basePath);
  if (!folderExists) {
    await app.vault.createFolder(basePath);
  }

  const content = renderTemplate(settings.projectTemplate, { NAME: name });
  const noteExists = app.vault.getAbstractFileByPath(notePath);
  if (!noteExists) {
    await app.vault.create(notePath, content);
  }

  if (scaffoldTasks) {
    const tasksExists = app.vault.getAbstractFileByPath(tasksPath);
    if (!tasksExists) {
      await app.vault.create(tasksPath, getProjectTasksTemplate(name));
    }
  }

  if (scaffoldWiki) {
    const wikiExists = app.vault.getAbstractFileByPath(wikiPath);
    if (!wikiExists) {
      await app.vault.create(wikiPath, getProjectWikiTemplate(name));
    }
  }

  const file = app.vault.getAbstractFileByPath(notePath);
  if (file) {
    await app.workspace.getLeaf().openFile(file as import("obsidian").TFile);
  }

  return { notePath, tasksPath, wikiPath };
}
