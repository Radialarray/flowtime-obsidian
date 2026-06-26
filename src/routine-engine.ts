import { Notice } from "obsidian";
import type { App } from "obsidian";
import { parseTaskLine, parseRecurrence, isRecurrenceDue } from "./task-parser";
import type { FlowtimeSettings } from "./types";

interface FlowtimePluginRef {
  settings: FlowtimeSettings;
}

interface GenEntry {
  routineFile: string;
  lineHash: string;
  targetDate: string;
  generatedAt: string;
}

export class RoutineEngine {
  private app: App;
  private plugin: FlowtimePluginRef;

  constructor(app: App, plugin: FlowtimePluginRef) {
    this.app = app;
    this.plugin = plugin;
  }

  get routinesFolder(): string {
    return ((this.plugin?.settings?.routinesFolder || "Routines/").replace(/\/+$/, "") + "/");
  }

  get generatedFilePath(): string {
    return this.app.vault.configDir + "/plugins/flowtime/routines-generated.json";
  }

  get isVacationMode(): boolean {
    return !!this.plugin?.settings?.vacationMode;
  }

  get workdays(): number[] {
    return this.plugin?.settings?.workdays || [1, 2, 3, 4, 5];
  }

  async loadGenerated(): Promise<GenEntry[]> {
    try {
      const path = this.generatedFilePath;
      if (await this.app.vault.adapter.exists(path)) {
        const raw = await this.app.vault.adapter.read(path);
        const data = JSON.parse(raw) as { entries?: GenEntry[] };
        return Array.isArray(data?.entries) ? data.entries : [];
      }
      const oldPaths = [
        this.routinesFolder + ".generated.json",
        "flowtime/routines/.generated.json",
      ];
      let oldPath: string | null = null;
      for (const p of oldPaths) {
        if (await this.app.vault.adapter.exists(p)) {
          oldPath = p;
          break;
        }
      }
      if (oldPath) {
        const raw = await this.app.vault.adapter.read(oldPath);
        const data = JSON.parse(raw) as { entries?: GenEntry[] };
        const entries = Array.isArray(data?.entries) ? data.entries : [];
        if (entries.length > 0) {
          await this.app.vault.adapter.write(path, JSON.stringify({ entries }, null, 2));
          await this.app.vault.adapter.remove(oldPath);
          if (!this.plugin?.settings?.quietMode) {
            new Notice("\u{1F4C1} Migrated routine tracking to plugin folder");
          }
        }
        return entries;
      }
    } catch (_) { /* fine */ }
    return [];
  }

  async saveGenerated(entries: GenEntry[]): Promise<void> {
    try {
      const path = this.generatedFilePath;
      await this.app.vault.adapter.write(path, JSON.stringify({ entries }, null, 2));
    } catch (e) {
      console.warn("Flowtime: Failed to save .generated.json:", (e as Error).message);
    }
  }

  private _hashLine(line: string): string {
    let hash = 0;
    const s = line.replace(/\s+/g, " ").trim();
    for (let i = 0; i < s.length; i++) {
      const chr = s.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0;
    }
    return "h" + Math.abs(hash).toString(36);
  }

  private _hasEntry(entries: GenEntry[], lineHash: string, targetDate: string): boolean {
    return entries.some((e) => e.lineHash === lineHash && e.targetDate === targetDate);
  }

  async scanRoutines(): Promise<
    Array<{ routineFile: string; line: number; rawLine: string; parsed: ReturnType<typeof parseTaskLine>; recurrence: ReturnType<typeof parseRecurrence> }>
  > {
    const results: Array<{
      routineFile: string; line: number; rawLine: string;
      parsed: NonNullable<ReturnType<typeof parseTaskLine>>;
      recurrence: NonNullable<ReturnType<typeof parseRecurrence>>;
    }> = [];
    try {
      const folder = this.app.vault.getAbstractFileByPath(this.routinesFolder);
      if (!folder || !("children" in folder)) return results;
      const children = (folder as { children: Array<{ name: string; path: string }> }).children;

      for (const child of children) {
        if (child.name === ".generated.json") continue;
        if (!child.name.endsWith(".md")) continue;

        const file = this.app.vault.getAbstractFileByPath(child.path);
        if (!file) continue;
        const content = await this.app.vault.read(file as import("obsidian").TFile);
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const parsed = parseTaskLine(lines[i], file as import("obsidian").TFile, i);
          if (!parsed) continue;
          if (!parsed.rawText.match(/🔁/)) continue;

          const recurrence = parseRecurrence(parsed.rawText);
          if (!recurrence) continue;

          results.push({ routineFile: child.path, line: i, rawLine: lines[i], parsed, recurrence });
        }
      }
    } catch (e) {
      console.warn("Flowtime: Error scanning routines folder:", (e as Error).message);
    }
    return results;
  }

  async ensureRoutinesFolder(): Promise<void> {
    try {
      if (!(await this.app.vault.adapter.exists(this.routinesFolder))) {
        await this.app.vault.createFolder(this.routinesFolder.replace(/\/$/, ""));
        if (!this.plugin?.settings?.quietMode) {
          new Notice("\u{1F4C1} Created " + this.routinesFolder);
        }
      }
    } catch (e) {
      console.warn("Flowtime: Could not create routines folder:", (e as Error).message);
    }
  }

  async generateForDate(
    dateStr: string,
    options: { force?: boolean; dryRun?: boolean } = {},
  ): Promise<number> {
    if (!dateStr) return 0;
    if (this.isVacationMode && !options.force) return 0;

    const entries = await this.loadGenerated();
    const routines = await this.scanRoutines();
    let generated = 0;
    const newEntries: GenEntry[] = [];

    for (const routine of routines) {
      const due = isRecurrenceDue(routine.recurrence, dateStr, {
        workdays: this.workdays,
        lastGenerated: this._lastGenForLine(entries, routine) ?? undefined,
      });
      if (!due) continue;

      const lineHash = this._hashLine(routine.rawLine);

      if (!options.force && this._hasEntry(entries, lineHash, dateStr)) continue;
      if (!options.force && this._hasEntry(newEntries, lineHash, dateStr)) continue;

      const todayStr = new Date().toISOString().split("T")[0];
      let taskLine = routine.rawLine;
      taskLine = taskLine.replace(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/gu, "@" + dateStr);
      if (!taskLine.match(/[@⏳📅]\s*\d{4}-\d{2}-\d{2}/u)) {
        taskLine = taskLine.replace(/(\]\s*)/, "$1@" + dateStr + " ");
      }

      if (options.dryRun) {
        generated++;
        newEntries.push({ routineFile: routine.routineFile, lineHash, targetDate: dateStr, generatedAt: todayStr });
        continue;
      }

      const dailyFile = await this._ensureDailyNote(dateStr);
      if (!dailyFile) continue;

      const written = await this._appendTaskIfMissing(dailyFile, taskLine);
      if (written) {
        generated++;
        newEntries.push({ routineFile: routine.routineFile, lineHash, targetDate: dateStr, generatedAt: todayStr });
      }
    }

    if (newEntries.length > 0 && !options.dryRun) {
      await this.saveGenerated([...entries, ...newEntries]);
    }

    return generated;
  }

  async generateForRange(fromDate: string, toDate: string): Promise<number> {
    let total = 0;
    const from = new Date(fromDate + "T12:00:00");
    const to = new Date(toDate + "T12:00:00");

    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      total += await this.generateForDate(dateStr);
    }
    return total;
  }

  async generateForWeek(dateInWeek: string): Promise<number> {
    const date = new Date(dateInWeek + "T12:00:00");
    const day = date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return this.generateForRange(monday.toISOString().split("T")[0], sunday.toISOString().split("T")[0]);
  }

  async generateToday(options: { force?: boolean } = {}): Promise<number> {
    const today = new Date().toISOString().split("T")[0];
    return this.generateForDate(today, options);
  }

  async generateThisWeek(): Promise<number> {
    const today = new Date().toISOString().split("T")[0];
    return this.generateForWeek(today);
  }

  async generateAllDue(options: { force?: boolean } = {}): Promise<number> {
    if (this.isVacationMode && !options.force) return 0;
    const today = new Date().toISOString().split("T")[0];
    let total = 0;
    total += await this.generateForDate(today, options);

    const date = new Date(today + "T12:00:00");
    const day = date.getDay();
    const friday = new Date(date);
    friday.setDate(date.getDate() + (day === 0 ? 5 : 5 - day));

    if (friday > date) {
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      const rangeEnd = friday.toISOString().split("T")[0];
      total += await this.generateForRange(nextDay.toISOString().split("T")[0], rangeEnd);
    }
    return total;
  }

  private async _ensureDailyNote(dateStr: string): Promise<import("obsidian").TFile | null> {
    let folder = "";
    try {
      const dailyNotesPath = this.app.vault.configDir + "/daily-notes.json";
      if (await this.app.vault.adapter.exists(dailyNotesPath)) {
        const config = JSON.parse(await this.app.vault.adapter.read(dailyNotesPath)) as { folder?: string };
        folder = config.folder || "";
      }
    } catch (_) { /* fine */ }

    const filePath = folder
      ? (folder.endsWith("/") ? folder : folder + "/") + dateStr + ".md"
      : dateStr + ".md";

    try {
      let file = this.app.vault.getAbstractFileByPath(filePath);
      if (!file) {
        file = await this.app.vault.create(filePath, "");
      }
      return file as import("obsidian").TFile;
    } catch (e) {
      console.warn("Flowtime: Could not ensure daily note:", filePath, (e as Error).message);
      return null;
    }
  }

  private async _appendTaskIfMissing(file: import("obsidian").TFile, taskLine: string): Promise<boolean> {
    try {
      const content = await this.app.vault.read(file);
      const lines = content.split("\n");
      const trimmed = taskLine.trim();
      if (lines.some((l) => l.trim() === trimmed)) return false;

      const newContent = content.endsWith("\n")
        ? content + trimmed + "\n"
        : content + (content ? "\n" : "") + trimmed + "\n";
      await this.app.vault.modify(file, newContent);
      return true;
    } catch (e) {
      console.warn("Flowtime: Could not append task:", (e as Error).message);
      return false;
    }
  }

  private _lastGenForLine(
    entries: GenEntry[],
    routine: { routineFile: string; rawLine: string },
  ): string | null {
    const lineHash = this._hashLine(routine.rawLine);
    const match = entries
      .filter((e) => e.routineFile === routine.routineFile && e.lineHash === lineHash)
      .sort((a, b) => b.targetDate.localeCompare(a.targetDate));
    return match.length > 0 ? match[0].targetDate : null;
  }

  async clearTracking(): Promise<void> {
    try {
      const path = this.generatedFilePath;
      if (await this.app.vault.adapter.exists(path)) {
        await this.app.vault.adapter.remove(path);
      }
    } catch (_) { /* fine */ }
  }
}
