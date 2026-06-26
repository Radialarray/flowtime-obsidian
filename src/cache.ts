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

/** Return type of createTaskCache(). */
export interface TaskCacheInstance {
  get(filePath: string): CacheEntry | null;
  set(filePath: string, parsedTasks: Omit<ParsedTask, "file">[]): void;
  invalid(filePath: string): void;
  has(filePath: string): boolean;
  clear(): void;
  readonly size: number;
  autoEvict(fileExistsFn: (path: string) => Promise<boolean>): Promise<number>;
  checkSafetyLimits(): { warnings: string[] };
  toJSON(): Record<
    string,
    { parsedTasks: Omit<ParsedTask, "file">[]; mtime: number; size: number }
  >;
  fromJSON(obj: Record<string, unknown>): void;
  evictStale(vaultAdapter: {
    stat(path: string): Promise<{ mtime: number; size: number } | null>;
  }): Promise<number>;
  getTasksForDateRange(dateFrom: string, dateTo: string): DateIndexEntry[];
}

export function createTaskCache(): TaskCacheInstance {
  const _cache = new Map<string, CacheEntry>();
  const _dateIndex = new Map<string, DateIndexEntry[]>();
  let _warningIssued = false;

  /** Index a file's tasks by date. */
  function _indexFile(
    filePath: string,
    parsedTasks: Omit<ParsedTask, "file">[],
  ): void {
    for (const [, entries] of _dateIndex) {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].filePath === filePath) entries.splice(i, 1);
      }
    }
    for (const task of parsedTasks) {
      if (!task.taskDate) continue;
      if (!_dateIndex.has(task.taskDate)) {
        _dateIndex.set(task.taskDate, []);
      }
      _dateIndex.get(task.taskDate)!.push({ filePath, task });
    }
  }

  /** Approximate size of cache in bytes. */
  function _approximateSize(): number {
    try {
      return new Blob([JSON.stringify(toJSON())]).size;
    } catch (_) {
      return 0;
    }
  }

  /**
   * Get all cached tasks within a date range [from, to] (inclusive, YYYY-MM-DD).
   * Only returns what's already cached — does not read from disk.
   */
  function getTasksForDateRange(
    dateFrom: string,
    dateTo: string,
  ): DateIndexEntry[] {
    const result: DateIndexEntry[] = [];
    for (const [dateStr, entries] of _dateIndex) {
      if (dateStr >= dateFrom && dateStr <= dateTo) {
        result.push(...entries);
      }
    }
    return result;
  }

  /** Get cached entry for a file path. */
  function get(filePath: string): CacheEntry | null {
    return _cache.get(filePath) || null;
  }

  /** Store parsed tasks for a file path. Only stores entries that actually contain tasks. */
  function set(
    filePath: string,
    parsedTasks: Omit<ParsedTask, "file">[],
  ): void {
    if (!parsedTasks) parsedTasks = [];
    _indexFile(filePath, parsedTasks);
    if (parsedTasks.length === 0) {
      _cache.delete(filePath);
      return;
    }
    _cache.set(filePath, {
      parsedTasks,
      mtime: Date.now(),
      size: 0,
    });
  }

  /** Remove cached entry for a file path. */
  function invalid(filePath: string): void {
    _cache.delete(filePath);
    for (const [, entries] of _dateIndex) {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].filePath === filePath) entries.splice(i, 1);
      }
    }
  }

  /** Check if a file path is cached. */
  function has(filePath: string): boolean {
    return _cache.has(filePath);
  }

  /** Clear all cached entries. */
  function clear(): void {
    _cache.clear();
    _dateIndex.clear();
    _warningIssued = false;
  }

  /**
   * Auto-evict stale entries by checking against existing files.
   */
  async function autoEvict(
    fileExistsFn: (path: string) => Promise<boolean>,
  ): Promise<number> {
    const stale: string[] = [];
    for (const [path] of _cache) {
      try {
        const exists = await fileExistsFn(path);
        if (!exists) stale.push(path);
      } catch (_) {
        stale.push(path);
      }
    }
    for (const path of stale) {
      _cache.delete(path);
    }
    return stale.length;
  }

  /** Check safety limits and log warning if exceeded. */
  function checkSafetyLimits(): { warnings: string[] } {
    const warnings: string[] = [];

    if (_cache.size > MAX_CACHE_ENTRIES && !_warningIssued) {
      warnings.push(
        `Task cache has ${_cache.size} entries (limit: ${MAX_CACHE_ENTRIES}). Consider rebuilding.`,
      );
    }

    const approxSize = _approximateSize();
    if (approxSize > MAX_CACHE_SIZE_BYTES && !_warningIssued) {
      warnings.push(
        `Task cache is ~${(approxSize / 1024 / 1024).toFixed(1)}MB (limit: 1MB). Consider clearing the cache.`,
      );
    }

    if (warnings.length > 0) {
      _warningIssued = true;
    }

    return { warnings };
  }

  /** Serialize cache to a plain object for storage. */
  function toJSON(): Record<
    string,
    { parsedTasks: Omit<ParsedTask, "file">[]; mtime: number; size: number }
  > {
    const obj: Record<string, CacheEntry> = {};
    for (const [key, val] of _cache) {
      if (val.parsedTasks && val.parsedTasks.length > 0) {
        obj[key] = {
          parsedTasks: val.parsedTasks,
          mtime: val.mtime,
          size: val.size,
        };
      }
    }
    return obj;
  }

  /** Load cache from a previously serialized object. */
  function fromJSON(obj: Record<string, unknown>): void {
    if (!obj || typeof obj !== "object") return;
    for (const [key, val] of Object.entries(obj)) {
      const entry = val as Record<string, unknown>;
      const tasks = Array.isArray(val)
        ? (val as Omit<ParsedTask, "file">[])
        : (entry?.parsedTasks as Omit<ParsedTask, "file">[]);
      const mtime = (entry?.mtime as number) || Date.now();
      const size = (entry?.size as number) || 0;
      if (Array.isArray(tasks) && tasks.length > 0) {
        _cache.set(key, { parsedTasks: tasks, mtime, size });
        _indexFile(key, tasks);
      }
    }
  }

  /**
   * Cross-session staleness check: compare cached mtime against actual file mtime.
   * Invalidates entries where the file has been modified since caching.
   */
  async function evictStale(vaultAdapter: {
    stat(path: string): Promise<{ mtime: number; size: number } | null>;
  }): Promise<number> {
    const stale: string[] = [];
    for (const [path, entry] of _cache) {
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
    for (const path of stale) invalid(path);
    return stale.length;
  }

  return {
    get,
    set,
    invalid,
    has,
    clear,
    get size() {
      return _cache.size;
    },
    autoEvict,
    checkSafetyLimits,
    toJSON,
    fromJSON,
    evictStale,
    getTasksForDateRange,
  };
}

/**
 * Backward-compatible class wrapper.
 * @deprecated Use createTaskCache() instead.
 */
export class TaskCache {
  private _impl: TaskCacheInstance;

  constructor() {
    this._impl = createTaskCache();
  }

  get(filePath: string): CacheEntry | null {
    return this._impl.get(filePath);
  }
  set(
    filePath: string,
    parsedTasks: Omit<ParsedTask, "file">[],
  ): void {
    this._impl.set(filePath, parsedTasks);
  }
  invalid(filePath: string): void {
    this._impl.invalid(filePath);
  }
  has(filePath: string): boolean {
    return this._impl.has(filePath);
  }
  clear(): void {
    this._impl.clear();
  }
  get size(): number {
    return this._impl.size;
  }
  autoEvict(
    fileExistsFn: (path: string) => Promise<boolean>,
  ): Promise<number> {
    return this._impl.autoEvict(fileExistsFn);
  }
  checkSafetyLimits(): { warnings: string[] } {
    return this._impl.checkSafetyLimits();
  }
  toJSON(): Record<
    string,
    { parsedTasks: Omit<ParsedTask, "file">[]; mtime: number; size: number }
  > {
    return this._impl.toJSON();
  }
  fromJSON(obj: Record<string, unknown>): void {
    this._impl.fromJSON(obj);
  }
  evictStale(vaultAdapter: {
    stat(path: string): Promise<{ mtime: number; size: number } | null>;
  }): Promise<number> {
    return this._impl.evictStale(vaultAdapter);
  }
  getTasksForDateRange(
    dateFrom: string,
    dateTo: string,
  ): DateIndexEntry[] {
    return this._impl.getTasksForDateRange(dateFrom, dateTo);
  }
}
