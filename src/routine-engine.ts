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

export function createRoutineEngine(app: App, plugin: FlowtimePluginRef) {
  function _routinesFolder(): string {
    return ((plugin?.settings?.routinesFolder || "Routines/").replace(/\/+$/, "") + "/");
  }

  function _generatedFilePath(): string {
    return app.vault.configDir + "/plugins/flowtime/routines-generated.json";
  }

  function _isVacationMode(): boolean {
    return !!plugin?.settings?.vacationMode;
  }

  function _workdays(): number[] {
    return plugin?.settings?.workdays || [1, 2, 3, 4, 5];
  }

  function _hashLine(line: string): string {
    let hash = 0;
    const s = line.replace(/\s+/g, " ").trim();
    for (let i = 0; i < s.length; i++) {
      const chr = s.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0;
    }
    return "h" + Math.abs(hash).toString(36);
  }

  function _hasEntry(entries: GenEntry[], lineHash: string, targetDate: string): boolean {
    return entries.some((e) => e.lineHash === lineHash && e.targetDate === targetDate);
  }

  function _lastGenForLine(
    entries: GenEntry[],
    routine: { routineFile: string; rawLine: string },
  ): string | null {
    const lineHash = _hashLine(routine.rawLine);
    const match = entries
      .filter((e) => e.routineFile === routine.routineFile && e.lineHash === lineHash)
      .sort((a, b) => b.targetDate.localeCompare(a.targetDate));
    return match.length > 0 ? match[0].targetDate : null;
  }

  async function loadGenerated(): Promise<GenEntry[]> {
    try {
      const path = _generatedFilePath();
      if (await app.vault.adapter.exists(path)) {
        const raw = await app.vault.adapter.read(path);
        const data = JSON.parse(raw) as { entries?: GenEntry[] };
        return Array.isArray(data?.entries) ? data.entries : [];
      }
      const oldPaths = [
        _routinesFolder() + ".generated.json",
        "flowtime/routines/.generated.json",
      ];
      let oldPath: string | null = null;
      for (const p of oldPaths) {
        if (await app.vault.adapter.exists(p)) {
          oldPath = p;
          break;
        }
      }
      if (oldPath) {
        const raw = await app.vault.adapter.read(oldPath);
        const data = JSON.parse(raw) as { entries?: GenEntry[] };
        const entries = Array.isArray(data?.entries) ? data.entries : [];
        if (entries.length > 0) {
          await app.vault.adapter.write(path, JSON.stringify({ entries }, null, 2));
          await app.vault.adapter.remove(oldPath);
          if (!plugin?.settings?.quietMode) {
            new Notice("\u{1F4C1} Migrated routine tracking to plugin folder");
          }
        }
        return entries;
      }
    } catch (_) { /* fine */ }
    return [];
  }

  async function saveGenerated(entries: GenEntry[]): Promise<void> {
    try {
      const path = _generatedFilePath();
      await app.vault.adapter.write(path, JSON.stringify({ entries }, null, 2));
    } catch (e) {
      console.warn("Flowtime: Failed to save .generated.json:", (e as Error).message);
    }
  }

  async function scanRoutines(): Promise<
    Array<{ routineFile: string; line: number; rawLine: string; parsed: ReturnType<typeof parseTaskLine>; recurrence: ReturnType<typeof parseRecurrence> }>
  > {
    const results: Array<{
      routineFile: string; line: number; rawLine: string;
      parsed: NonNullable<ReturnType<typeof parseTaskLine>>;
      recurrence: NonNullable<ReturnType<typeof parseRecurrence>>;
    }> = [];
    try {
      const folder = app.vault.getAbstractFileByPath(_routinesFolder());
      if (!folder || !("children" in folder)) return results;
      const children = (folder as { children: Array<{ name: string; path: string }> }).children;

      for (const child of children) {
        if (child.name === ".generated.json") continue;
        if (!child.name.endsWith(".md")) continue;

        const file = app.vault.getAbstractFileByPath(child.path);
        if (!file) continue;
        const content = await app.vault.read(file as import("obsidian").TFile);
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

  async function ensureRoutinesFolder(): Promise<void> {
    try {
      if (!(await app.vault.adapter.exists(_routinesFolder()))) {
        await app.vault.createFolder(_routinesFolder().replace(/\/$/, ""));
        if (!plugin?.settings?.quietMode) {
          new Notice("\u{1F4C1} Created " + _routinesFolder());
        }
      }
    } catch (e) {
      console.warn("Flowtime: Could not create routines folder:", (e as Error).message);
    }
  }

  async function _ensureDailyNote(dateStr: string): Promise<import("obsidian").TFile | null> {
    let folder = "";
    try {
      const dailyNotesPath = app.vault.configDir + "/daily-notes.json";
      if (await app.vault.adapter.exists(dailyNotesPath)) {
        const config = JSON.parse(await app.vault.adapter.read(dailyNotesPath)) as { folder?: string };
        folder = config.folder || "";
      }
    } catch (_) { /* fine */ }

    const filePath = folder
      ? (folder.endsWith("/") ? folder : folder + "/") + dateStr + ".md"
      : dateStr + ".md";

    try {
      let file = app.vault.getAbstractFileByPath(filePath);
      if (!file) {
        file = await app.vault.create(filePath, "");
      }
      return file as import("obsidian").TFile;
    } catch (e) {
      console.warn("Flowtime: Could not ensure daily note:", filePath, (e as Error).message);
      return null;
    }
  }

  async function _appendTaskIfMissing(file: import("obsidian").TFile, taskLine: string): Promise<boolean> {
    try {
      const content = await app.vault.read(file);
      const lines = content.split("\n");
      const trimmed = taskLine.trim();
      if (lines.some((l) => l.trim() === trimmed)) return false;

      const newContent = content.endsWith("\n")
        ? content + trimmed + "\n"
        : content + (content ? "\n" : "") + trimmed + "\n";
      await app.vault.modify(file, newContent);
      return true;
    } catch (e) {
      console.warn("Flowtime: Could not append task:", (e as Error).message);
      return false;
    }
  }

  async function generateForDate(
    dateStr: string,
    options: { force?: boolean; dryRun?: boolean } = {},
  ): Promise<number> {
    if (!dateStr) return 0;
    if (_isVacationMode() && !options.force) return 0;

    const entries = await loadGenerated();
    const routines = await scanRoutines();
    let generated = 0;
    const newEntries: GenEntry[] = [];

    for (const routine of routines) {
      const due = isRecurrenceDue(routine.recurrence, dateStr, {
        workdays: _workdays(),
        lastGenerated: _lastGenForLine(entries, routine) ?? undefined,
      });
      if (!due) continue;

      const lineHash = _hashLine(routine.rawLine);

      if (!options.force && _hasEntry(entries, lineHash, dateStr)) continue;
      if (!options.force && _hasEntry(newEntries, lineHash, dateStr)) continue;

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

      const dailyFile = await _ensureDailyNote(dateStr);
      if (!dailyFile) continue;

      const written = await _appendTaskIfMissing(dailyFile, taskLine);
      if (written) {
        generated++;
        newEntries.push({ routineFile: routine.routineFile, lineHash, targetDate: dateStr, generatedAt: todayStr });
      }
    }

    if (newEntries.length > 0 && !options.dryRun) {
      await saveGenerated([...entries, ...newEntries]);
    }

    return generated;
  }

  async function generateForRange(fromDate: string, toDate: string): Promise<number> {
    let total = 0;
    const from = new Date(fromDate + "T12:00:00");
    const to = new Date(toDate + "T12:00:00");

    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      total += await generateForDate(dateStr);
    }
    return total;
  }

  async function generateForWeek(dateInWeek: string): Promise<number> {
    const date = new Date(dateInWeek + "T12:00:00");
    const day = date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return generateForRange(monday.toISOString().split("T")[0], sunday.toISOString().split("T")[0]);
  }

  async function generateToday(options: { force?: boolean } = {}): Promise<number> {
    const today = new Date().toISOString().split("T")[0];
    return generateForDate(today, options);
  }

  async function generateThisWeek(): Promise<number> {
    const today = new Date().toISOString().split("T")[0];
    return generateForWeek(today);
  }

  async function generateAllDue(options: { force?: boolean } = {}): Promise<number> {
    if (_isVacationMode() && !options.force) return 0;
    const today = new Date().toISOString().split("T")[0];
    let total = 0;
    total += await generateForDate(today, options);

    const date = new Date(today + "T12:00:00");
    const day = date.getDay();
    const friday = new Date(date);
    friday.setDate(date.getDate() + (day === 0 ? 5 : 5 - day));

    if (friday > date) {
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      const rangeEnd = friday.toISOString().split("T")[0];
      total += await generateForRange(nextDay.toISOString().split("T")[0], rangeEnd);
    }
    return total;
  }

  async function clearTracking(): Promise<void> {
    try {
      const path = _generatedFilePath();
      if (await app.vault.adapter.exists(path)) {
        await app.vault.adapter.remove(path);
      }
    } catch (_) { /* fine */ }
  }

  return {
    scanRoutines,
    ensureRoutinesFolder,
    generateForDate,
    generateForRange,
    generateForWeek,
    generateToday,
    generateThisWeek,
    generateAllDue,
    clearTracking,
    loadGenerated,
    saveGenerated,
    get routinesFolder() { return _routinesFolder(); },
    get generatedFilePath() { return _generatedFilePath(); },
    get isVacationMode() { return _isVacationMode(); },
    get workdays() { return _workdays(); },
  };
}

// Backward-compatible class wrapper
export class RoutineEngine {
  declare scanRoutines: ReturnType<typeof createRoutineEngine>['scanRoutines'];
  declare ensureRoutinesFolder: ReturnType<typeof createRoutineEngine>['ensureRoutinesFolder'];
  declare generateForDate: ReturnType<typeof createRoutineEngine>['generateForDate'];
  declare generateForRange: ReturnType<typeof createRoutineEngine>['generateForRange'];
  declare generateForWeek: ReturnType<typeof createRoutineEngine>['generateForWeek'];
  declare generateToday: ReturnType<typeof createRoutineEngine>['generateToday'];
  declare generateThisWeek: ReturnType<typeof createRoutineEngine>['generateThisWeek'];
  declare generateAllDue: ReturnType<typeof createRoutineEngine>['generateAllDue'];
  declare clearTracking: ReturnType<typeof createRoutineEngine>['clearTracking'];
  declare loadGenerated: ReturnType<typeof createRoutineEngine>['loadGenerated'];
  declare saveGenerated: ReturnType<typeof createRoutineEngine>['saveGenerated'];
  declare routinesFolder: string;
  declare generatedFilePath: string;
  declare isVacationMode: boolean;
  declare workdays: number[];

  constructor(app: App, plugin: FlowtimePluginRef) {
    const impl = createRoutineEngine(app, plugin);
    this.scanRoutines = impl.scanRoutines;
    this.ensureRoutinesFolder = impl.ensureRoutinesFolder;
    this.generateForDate = impl.generateForDate;
    this.generateForRange = impl.generateForRange;
    this.generateForWeek = impl.generateForWeek;
    this.generateToday = impl.generateToday;
    this.generateThisWeek = impl.generateThisWeek;
    this.generateAllDue = impl.generateAllDue;
    this.clearTracking = impl.clearTracking;
    this.loadGenerated = impl.loadGenerated;
    this.saveGenerated = impl.saveGenerated;
    this.routinesFolder = impl.routinesFolder;
    this.generatedFilePath = impl.generatedFilePath;
    this.isVacationMode = impl.isVacationMode;
    this.workdays = impl.workdays;
  }
}
