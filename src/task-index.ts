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
import type { ParsedTask, FlowtimeSettings } from "./types";
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

export class TaskIndex {
  /** filePath → parsed tasks */
  private _byFile: Map<string, ParsedTask[]> = new Map();
  /** date → file paths */
  private _byDate: Map<string, Set<string>> = new Map();
  /** Total indexed tasks count */
  private _totalTasks: number = 0;
  /** Whether the initial scan has completed */
  private _initialized: boolean = false;

  get initialized(): boolean {
    return this._initialized;
  }

  get totalTasks(): number {
    return this._totalTasks;
  }

  /* ─── Full Scan ─── */

  /**
   * Perform the initial full vault scan.
   * Should be called once on plugin startup.
   */
  async scanAll(files: TFile[], vault: Vault, projectsRoot: string): Promise<void> {
    this.clear();
    const root = projectsRoot || "";

    for (const file of files) {
      if (!this._isInScope(file.path, root)) continue;
      await this._indexFile(file, vault);
    }

    this._initialized = true;
  }

  /* ─── Incremental Updates ─── */

  /** Re-index a single file after modification */
  async indexFile(file: TFile, vault: Vault, projectsRoot: string): Promise<void> {
    if (!this._isInScope(file.path, projectsRoot)) return;
    this.removeFile(file.path);
    await this._indexFile(file, vault);
  }

  /** Remove a file from the index */
  removeFile(filePath: string): void {
    const existing = this._byFile.get(filePath);
    if (existing) {
      for (const task of existing) {
        if (task.taskDate) {
          const set = this._byDate.get(task.taskDate);
          if (set) set.delete(filePath);
        }
        this._totalTasks--;
      }
      this._byFile.delete(filePath);
    }
  }

  /** Clear all index data */
  clear(): void {
    this._byFile.clear();
    this._byDate.clear();
    this._totalTasks = 0;
    this._initialized = false;
  }

  /* ─── Query ─── */

  /**
   * Get tasks matching the given criteria.
   * All criteria are AND-ed together.
   */
  getTasks(query: TaskQuery = {}): ParsedTask[] {
    if (!this._initialized) return [];

    // Fast path: query by date range
    if (query.date || query.dateFrom || query.dateTo) {
      const from = query.date || query.dateFrom || "0000-01-01";
      const to = query.date || query.dateTo || "9999-12-31";

      const fileSet = new Set<string>();
      for (const [dateStr, files] of this._byDate) {
        if (dateStr >= from && dateStr <= to) {
          for (const fp of files) fileSet.add(fp);
        }
      }

      const result: ParsedTask[] = [];
      for (const fp of fileSet) {
        const tasks = this._byFile.get(fp);
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
    for (const [, tasks] of this._byFile) {
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

  /**
   * Get the total duration minutes for tasks on a specific date.
   * Used by _computeDailyTotal() in renderer.
   */
  getDailyDurationTotal(dateStr: string): number {
    const tasks = this.getTasks({ date: dateStr, includeCompleted: false });
    return tasks.reduce((sum, t) => sum + (t.durationMinutes || 0), 0);
  }

  /* ─── Persistence ─── */

  /**
   * Save index to disk for fast reload on next startup.
   * Stores only essential data: filePath → [{ taskDate, durationMinutes, bucket, sprint, projectTag, indent, status }]
   */
  async save(adapter: { write(path: string, data: string): Promise<void> }): Promise<void> {
    const slim: Record<string, Array<{
      d: string; m: number; b: string | null; s: string | null; p: string | null; i: number; st: string;
    }>> = {};

    for (const [fp, tasks] of this._byFile) {
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
      ".obsidian/plugins/flowtime/task-index.json",
      JSON.stringify({ v: 1, entries: slim }),
    );
  }

  /**
   * Load index from disk.
   * Returns true if loaded successfully, false if file missing or corrupted.
   */
  async load(adapter: { read(path: string): Promise<string>; exists(path: string): Promise<boolean> }): Promise<boolean> {
    const path = ".obsidian/plugins/flowtime/task-index.json";
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
        this._byFile.set(fp, tasks);
        this._totalTasks += tasks.length;

        for (const t of tasks) {
          if (t.taskDate) {
            if (!this._byDate.has(t.taskDate)) {
              this._byDate.set(t.taskDate, new Set());
            }
            this._byDate.get(t.taskDate)!.add(fp);
          }
        }
      }

      this._initialized = true;
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ─── Helpers ─── */

  private _isInScope(filePath: string, projectsRoot: string): boolean {
    if (filePath.startsWith(".obsidian") || filePath.startsWith(".git")) return false;
    if (!projectsRoot) return true;
    const normalized = projectsRoot.endsWith("/") ? projectsRoot : projectsRoot + "/";
    return filePath.startsWith(normalized);
  }

  private async _indexFile(file: TFile, vault: Vault): Promise<void> {
    try {
      const content = await vault.read(file);
      const lines = content.split("\n");
      const tasks: ParsedTask[] = [];

      for (let i = 0; i < lines.length; i++) {
        const parsed = parseTaskLine(lines[i], file, i);
        if (parsed) {
          tasks.push(parsed);
          if (parsed.taskDate) {
            if (!this._byDate.has(parsed.taskDate)) {
              this._byDate.set(parsed.taskDate, new Set());
            }
            this._byDate.get(parsed.taskDate)!.add(file.path);
          }
          this._totalTasks++;
        }
      }

      this._byFile.set(file.path, tasks);
    } catch (_) {
      // File may have been deleted between scan and read
    }
  }
}
