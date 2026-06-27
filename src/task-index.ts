/**
 * TaskIndex — cached task index with incremental updates.
 *
 * Replaces repeated full vault scans (getMarkdownFiles()) in renderer.ts
 * and weekplan-renderer.ts with a single initial scan + incremental deltas.
 *
 * Design:
 * - scanAll() — one-time full vault scan via getMarkdownFiles()
 * - Incremental updates via vault.on('modify'/'delete'/'create')
 * - getTasks(criteria) — filtered O(1) queries by date range, project, bucket, sprint
 * - Disk persistence to plugin data dir for fast reload
 */

import type { TFile, Vault } from "obsidian";
import type { ParsedTask } from "./types";
import { parseTaskLine } from "./task-parser";

interface TaskQuery {
  dateFrom?: string;
  dateTo?: string;
  date?: string;
  project?: string;
  bucket?: string;
  sprint?: string;
  scopeRoot?: string;
  includeCompleted?: boolean;
}

/* ─── Factory function (primary API) ─── */

export function createTaskIndex() {
  const _byFile = new Map<string, ParsedTask[]>();
  const _byDate = new Map<string, Set<string>>();
  let _totalTasks = 0;
  let _initialized = false;

  function _isInScope(filePath: string, projectsRoot: string, configDir: string): boolean {
    if (filePath.startsWith(configDir) || filePath.startsWith(".git")) return false;
    if (!projectsRoot) return true;
    const normalized = projectsRoot.endsWith("/") ? projectsRoot : projectsRoot + "/";
    return filePath.startsWith(normalized);
  }

  async function _indexFile(file: TFile, vault: Vault): Promise<void> {
    try {
      const content = await vault.read(file);
      const lines = content.split("\n");
      const tasks: ParsedTask[] = [];

      for (let i = 0; i < lines.length; i++) {
        const parsed = parseTaskLine(lines[i], file, i);
        if (parsed) {
          tasks.push(parsed);
          if (parsed.taskDate) {
            if (!_byDate.has(parsed.taskDate)) {
              _byDate.set(parsed.taskDate, new Set());
            }
            _byDate.get(parsed.taskDate)!.add(file.path);
          }
          _totalTasks++;
        }
      }

      _byFile.set(file.path, tasks);
    } catch (_) {
      // File may have been deleted between scan and read
    }
  }

  /* ─── Full Scan ─── */

  async function scanAll(files: TFile[], vault: Vault, projectsRoot: string): Promise<void> {
    clear();
    const root = projectsRoot || "";

    for (const file of files) {
      if (!_isInScope(file.path, root, vault.configDir)) continue;
      await _indexFile(file, vault);
    }

    _initialized = true;
  }

  /* ─── Incremental Updates ─── */

  async function indexFile(file: TFile, vault: Vault, projectsRoot: string): Promise<void> {
    if (!_isInScope(file.path, projectsRoot, vault.configDir)) return;
    removeFile(file.path);
    await _indexFile(file, vault);
  }

  function removeFile(filePath: string): void {
    const existing = _byFile.get(filePath);
    if (existing) {
      for (const task of existing) {
        if (task.taskDate) {
          const set = _byDate.get(task.taskDate);
          if (set) set.delete(filePath);
        }
        _totalTasks--;
      }
      _byFile.delete(filePath);
    }
  }

  function clear(): void {
    _byFile.clear();
    _byDate.clear();
    _totalTasks = 0;
    _initialized = false;
  }

  /* ─── Query ─── */

  function getTasks(query: TaskQuery = {}): ParsedTask[] {
    if (!_initialized) return [];

    // Fast path: query by date range
    if (query.date || query.dateFrom || query.dateTo) {
      const from = query.date || query.dateFrom || "0000-01-01";
      const to = query.date || query.dateTo || "9999-12-31";

      const fileSet = new Set<string>();
      for (const [dateStr, files] of _byDate) {
        if (dateStr >= from && dateStr <= to) {
          for (const fp of files) fileSet.add(fp);
        }
      }

      const result: ParsedTask[] = [];
      for (const fp of fileSet) {
        const tasks = _byFile.get(fp);
        if (!tasks) continue;
        for (const t of tasks) {
          if (!query.includeCompleted && (t.status === "x" || t.status === "X")) continue;
          if (query.project && t.projectTag !== query.project) continue;
          if (query.bucket && t.bucket !== query.bucket) continue;
          if (query.sprint && t.sprint !== query.sprint) continue;
          if (t.taskDate && (t.taskDate < from || t.taskDate > to)) continue;
          result.push(t);
        }
      }
      return result;
    }

    // Full scan fallback: iterate all files
    const result: ParsedTask[] = [];
    for (const [, tasks] of _byFile) {
      for (const t of tasks) {
        if (!query.includeCompleted && (t.status === "x" || t.status === "X")) continue;
        if (query.project && t.projectTag !== query.project) continue;
        if (query.bucket && t.bucket !== query.bucket) continue;
        if (query.sprint && t.sprint !== query.sprint) continue;
        result.push(t);
      }
    }
    return result;
  }

  function getDailyDurationTotal(dateStr: string): number {
    const tasks = getTasks({ date: dateStr, includeCompleted: false });
    return tasks.reduce((sum, t) => sum + (t.durationMinutes || 0), 0);
  }

  /* ─── Persistence ─── */

  async function save(adapter: { write(path: string, data: string): Promise<void> }, configDir: string): Promise<void> {
    const slim: Record<string, Array<{
      d: string; m: number; b: string | null; s: string | null; p: string | null; i: number; st: string;
    }>> = {};

    for (const [fp, tasks] of _byFile) {
      slim[fp] = tasks.map((t) => ({
        d: t.taskDate,
        m: t.durationMinutes,
        b: t.bucket,
        s: t.sprint,
        p: t.projectTag,
        i: t.indent,
        st: t.status,
      }));
    }

    await adapter.write(
      `${configDir}/plugins/flowtime/task-index.json`,
      JSON.stringify({ v: 1, entries: slim }),
    );
  }

  async function load(adapter: { read(path: string): Promise<string>; exists(path: string): Promise<boolean> }, configDir: string): Promise<boolean> {
    const path = `${configDir}/plugins/flowtime/task-index.json`;
    try {
      if (!(await adapter.exists(path))) return false;
      const raw = await adapter.read(path);
      const data = JSON.parse(raw) as { v: number; entries: Record<string, Array<{
        d: string; m: number; b: string | null; s: string | null; p: string | null; i: number; st: string;
      }>> };

      if (!data?.entries || data.v !== 1) return false;

      for (const [fp, entries] of Object.entries(data.entries)) {
        const tasks: ParsedTask[] = entries.map((e) => ({
          line: 0,
          rawLine: "",
          time: "",
          taskDate: e.d,
          durationMinutes: e.m,
          rawText: "",
          cleanText: "",
          status: e.st,
          priority: null,
          bucket: e.b,
          projectTag: e.p,
          isSoon: false,
          indent: e.i,
          sprint: e.s,
          sortIndex: null,
        }));
        _byFile.set(fp, tasks);
        _totalTasks += tasks.length;

        for (const t of tasks) {
          if (t.taskDate) {
            if (!_byDate.has(t.taskDate)) {
              _byDate.set(t.taskDate, new Set());
            }
            _byDate.get(t.taskDate)!.add(fp);
          }
        }
      }

      _initialized = true;
      return true;
    } catch (_) {
      return false;
    }
  }

  return {
    get initialized() { return _initialized; },
    get totalTasks() { return _totalTasks; },
    scanAll,
    indexFile,
    removeFile,
    clear,
    getTasks,
    getDailyDurationTotal,
    save,
    load,
  };
}

/* ─── Backward-compatible class wrapper ─── */

export class TaskIndex {
  private _impl: ReturnType<typeof createTaskIndex>;

  constructor() {
    this._impl = createTaskIndex();
  }

  get initialized(): boolean {
    return this._impl.initialized;
  }

  get totalTasks(): number {
    return this._impl.totalTasks;
  }

  async scanAll(files: TFile[], vault: Vault, projectsRoot: string): Promise<void> {
    return this._impl.scanAll(files, vault, projectsRoot);
  }

  async indexFile(file: TFile, vault: Vault, projectsRoot: string): Promise<void> {
    return this._impl.indexFile(file, vault, projectsRoot);
  }

  removeFile(filePath: string): void {
    return this._impl.removeFile(filePath);
  }

  clear(): void {
    return this._impl.clear();
  }

  getTasks(query?: TaskQuery): ParsedTask[] {
    return this._impl.getTasks(query);
  }

  getDailyDurationTotal(dateStr: string): number {
    return this._impl.getDailyDurationTotal(dateStr);
  }

  save(adapter: { write(path: string, data: string): Promise<void> }, configDir: string): Promise<void> {
    return this._impl.save(adapter, configDir);
  }

  load(adapter: { read(path: string): Promise<string>; exists(path: string): Promise<boolean> }, configDir: string): Promise<boolean> {
    return this._impl.load(adapter, configDir);
  }
}
