/**
 * Persistent task cache for Flowtime.
 *
 * Stores parsed task data per file path so that full vault scans
 * are only needed on first load. Subsequent renders read from cache.
 * Invalidated on file save, delete, and Flowtime actions.
 */

import type { ParsedTask, CacheEntry, DateIndexEntry } from "./types";

export const MAX_CACHE_ENTRIES = 5000;
export const MAX_CACHE_SIZE_BYTES = 1_000_000;

export class TaskCache {
  private _cache: Map<string, CacheEntry> = new Map();
  private _dateIndex: Map<string, DateIndexEntry[]> = new Map();
  private _warningIssued: boolean = false;

  /** Index a file's tasks by date. */
  private _indexFile(filePath: string, parsedTasks: Omit<ParsedTask, "file">[]): void {
    for (const [, entries] of this._dateIndex) {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].filePath === filePath) entries.splice(i, 1);
      }
    }
    for (const task of parsedTasks) {
      if (!task.taskDate) continue;
      if (!this._dateIndex.has(task.taskDate)) {
        this._dateIndex.set(task.taskDate, []);
      }
      this._dateIndex.get(task.taskDate)!.push({ filePath, task });
    }
  }

  /**
   * Get all cached tasks within a date range [from, to] (inclusive, YYYY-MM-DD).
   * Only returns what's already cached — does not read from disk.
   */
  getTasksForDateRange(dateFrom: string, dateTo: string): DateIndexEntry[] {
    const result: DateIndexEntry[] = [];
    for (const [dateStr, entries] of this._dateIndex) {
      if (dateStr >= dateFrom && dateStr <= dateTo) {
        result.push(...entries);
      }
    }
    return result;
  }

  /** Get cached entry for a file path. */
  get(filePath: string): CacheEntry | null {
    return this._cache.get(filePath) || null;
  }

  /** Store parsed tasks for a file path. Only stores entries that actually contain tasks. */
  set(filePath: string, parsedTasks: Omit<ParsedTask, "file">[]): void {
    if (!parsedTasks) parsedTasks = [];
    this._indexFile(filePath, parsedTasks);
    if (parsedTasks.length === 0) {
      this._cache.delete(filePath);
      return;
    }
    this._cache.set(filePath, { parsedTasks, mtime: Date.now(), size: 0 });
  }

  /** Remove cached entry for a file path. */
  invalid(filePath: string): void {
    this._cache.delete(filePath);
    for (const [, entries] of this._dateIndex) {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].filePath === filePath) entries.splice(i, 1);
      }
    }
  }

  /** Check if a file path is cached. */
  has(filePath: string): boolean {
    return this._cache.has(filePath);
  }

  /** Clear all cached entries. */
  clear(): void {
    this._cache.clear();
    this._dateIndex.clear();
    this._warningIssued = false;
  }

  /** Number of cached entries. */
  get size(): number {
    return this._cache.size;
  }

  /**
   * Auto-evict stale entries by checking against existing files.
   */
  async autoEvict(fileExistsFn: (path: string) => Promise<boolean>): Promise<number> {
    const stale: string[] = [];
    for (const [path] of this._cache) {
      try {
        const exists = await fileExistsFn(path);
        if (!exists) stale.push(path);
      } catch (_) {
        stale.push(path);
      }
    }
    for (const path of stale) {
      this._cache.delete(path);
    }
    return stale.length;
  }

  /** Check safety limits and log warning if exceeded. */
  checkSafetyLimits(): { warnings: string[] } {
    const warnings: string[] = [];

    if (this._cache.size > MAX_CACHE_ENTRIES && !this._warningIssued) {
      warnings.push(
        `Task cache has ${this._cache.size} entries (limit: ${MAX_CACHE_ENTRIES}). Consider rebuilding.`,
      );
    }

    const approxSize = this._approximateSize();
    if (approxSize > MAX_CACHE_SIZE_BYTES && !this._warningIssued) {
      warnings.push(
        `Task cache is ~${(approxSize / 1024 / 1024).toFixed(1)}MB (limit: 1MB). Consider clearing the cache.`,
      );
    }

    if (warnings.length > 0) {
      this._warningIssued = true;
    }

    return { warnings };
  }

  /** Approximate size of cache in bytes. */
  private _approximateSize(): number {
    try {
      return new Blob([JSON.stringify(this.toJSON())]).size;
    } catch (_) {
      return 0;
    }
  }

  /** Serialize cache to a plain object for storage. */
  toJSON(): Record<string, { parsedTasks: Omit<ParsedTask, "file">[]; mtime: number; size: number }> {
    const obj: Record<string, CacheEntry> = {};
    for (const [key, val] of this._cache) {
      if (val.parsedTasks && val.parsedTasks.length > 0) {
        obj[key] = { parsedTasks: val.parsedTasks, mtime: val.mtime, size: val.size };
      }
    }
    return obj;
  }

  /** Load cache from a previously serialized object. */
  fromJSON(obj: Record<string, unknown>): void {
    if (!obj || typeof obj !== "object") return;
    for (const [key, val] of Object.entries(obj)) {
      const entry = val as Record<string, unknown>;
      const tasks = Array.isArray(val)
        ? (val as Omit<ParsedTask, "file">[])
        : (entry?.parsedTasks as Omit<ParsedTask, "file">[]);
      const mtime = (entry?.mtime as number) || Date.now();
      const size = (entry?.size as number) || 0;
      if (Array.isArray(tasks) && tasks.length > 0) {
        this._cache.set(key, { parsedTasks: tasks, mtime, size });
        this._indexFile(key, tasks);
      }
    }
  }

  /**
   * Cross-session staleness check: compare cached mtime against actual file mtime.
   * Invalidates entries where the file has been modified since caching.
   */
  async evictStale(vaultAdapter: {
    stat(path: string): Promise<{ mtime: number; size: number } | null>;
  }): Promise<number> {
    const stale: string[] = [];
    for (const [path, entry] of this._cache) {
      try {
        const stat = await vaultAdapter.stat(path);
        if (!stat) {
          stale.push(path);
        } else if (stat.mtime > entry.mtime) {
          stale.push(path);
        } else if (entry.size > 0 && stat.size !== entry.size) {
          stale.push(path);
        }
      } catch (_) {
        // stat() fails → file gone; autoEvict handles this
      }
    }
    for (const path of stale) this.invalid(path);
    return stale.length;
  }
}
