/**
 * Persistent task cache for Flowtime.
 *
 * Stores parsed task data per file path so that full vault scans
 * are only needed on first load. Subsequent renders read from cache.
 * Invalidated on file save, delete, and Flowtime actions.
 *
 * v0.4.0 improvements:
 * - Only stores entries for files that actually contain tasks (no empty arrays)
 * - Auto-eviction: validates entries against existing files on load
 * - Safety limits: warns if cache exceeds 5000 entries or 1MB
 * - Stored in separate file (task-cache.json) instead of bloated data.json
 */

const MAX_CACHE_ENTRIES = 5000;
const MAX_CACHE_SIZE_BYTES = 1_000_000; // 1MB

class TaskCache {
	constructor() {
		/** @type {Map<string, { parsedTasks: object[], mtime: number, size: number }>} */
		this._cache = new Map();
		/** @type {Map<string, Array<{filePath: string, task: object}>>} */
		this._dateIndex = new Map();
		this._warningIssued = false;
	}

	/**
	 * Maintain date index for a file's tasks.
	 * Removes old entries for this file, then re-indexes all tasks.
	 * @param {string} filePath
	 * @param {object[]} parsedTasks
	 */
	_indexFile(filePath, parsedTasks) {
		// Remove stale date entries for this file
		for (const [, entries] of this._dateIndex) {
			for (let i = entries.length - 1; i >= 0; i--) {
				if (entries[i].filePath === filePath) entries.splice(i, 1);
			}
		}
		// Add new entries
		for (const task of parsedTasks) {
			if (!task.taskDate) continue;
			if (!this._dateIndex.has(task.taskDate)) {
				this._dateIndex.set(task.taskDate, []);
			}
			this._dateIndex.get(task.taskDate).push({ filePath, task });
		}
	}

	/**
	 * Get all cached tasks within a date range [from, to] (inclusive, YYYY-MM-DD).
	 * Returns array of { filePath, task } for every matching cached task.
	 * Does NOT read from disk — only returns what's already cached.
	 * @param {string} dateFrom
	 * @param {string} dateTo
	 * @returns {Array<{filePath: string, task: object}>}
	 */
	getTasksForDateRange(dateFrom, dateTo) {
		const result = [];
		for (const [dateStr, entries] of this._dateIndex) {
			if (dateStr >= dateFrom && dateStr <= dateTo) {
				result.push(...entries);
			}
		}
		return result;
	}

	/**
	 * Get cached entry for a file path.
	 * @param {string} filePath
	 * @returns {{ parsedTasks: object[], mtime: number } | null}
	 */
	get(filePath) {
		return this._cache.get(filePath) || null;
	}

	/**
	 * Store parsed tasks for a file path.
	 * Only stores entries that actually contain tasks (skips empty arrays).
	 * @param {string} filePath
	 * @param {object[]} parsedTasks — array of task objects (without file references)
	 */
	set(filePath, parsedTasks) {
		if (!parsedTasks) parsedTasks = [];
		this._indexFile(filePath, parsedTasks);
		if (parsedTasks.length === 0) {
			// Don't store empty entries — saves space
			this._cache.delete(filePath);
			return;
		}
		this._cache.set(filePath, { parsedTasks, mtime: Date.now(), size: 0 });
	}

	/**
	 * Remove cached entry for a file path.
	 * @param {string} filePath
	 */
	invalid(filePath) {
		this._cache.delete(filePath);
		// Clear from date index too
		for (const [, entries] of this._dateIndex) {
			for (let i = entries.length - 1; i >= 0; i--) {
				if (entries[i].filePath === filePath) entries.splice(i, 1);
			}
		}
	}

	/**
	 * Check if a file path is cached.
	 * @param {string} filePath
	 * @returns {boolean}
	 */
	has(filePath) {
		return this._cache.has(filePath);
	}

	/** Clear all cached entries. */
	clear() {
		this._cache.clear();
		this._dateIndex.clear();
		this._warningIssued = false;
	}

	/**
	 * Returns number of cached entries.
	 * @returns {number}
	 */
	get size() {
		return this._cache.size;
	}

	/**
	 * Auto-evict stale entries by checking against existing files.
	 * Removes entries for files that no longer exist in the vault.
	 * @param {function(string): boolean} fileExistsFn — async function that returns true if file exists
	 * @returns {number} number of evicted entries
	 */
	async autoEvict(fileExistsFn) {
		const stale = [];
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

	/**
	 * Check safety limits and log warning if exceeded.
	 * @returns {{ warnings: string[] }}
	 */
	checkSafetyLimits() {
		const warnings = [];

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

	/**
	 * Approximate size of cache in bytes.
	 * @returns {number}
	 */
	_approximateSize() {
		try {
			return new Blob([JSON.stringify(this.toJSON())]).size;
		} catch (_) {
			return 0;
		}
	}

	/**
	 * Serialize cache to a plain object for storage.
	 * Stores mtime per file for cross-session staleness checks.
	 * @returns {object} — filePath -> { parsedTasks, mtime }
	 */
	toJSON() {
		const obj = {};
		for (const [key, val] of this._cache) {
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

	/**
	 * Load cache from a previously serialized object.
	 * @param {object} obj
	 */
	fromJSON(obj) {
		if (!obj || typeof obj !== "object") return;
		for (const [key, val] of Object.entries(obj)) {
			const tasks = Array.isArray(val) ? val : val?.parsedTasks;
			const mtime = val?.mtime || Date.now();
			const size = val?.size || 0;
			if (Array.isArray(tasks) && tasks.length > 0) {
				this._cache.set(key, { parsedTasks: tasks, mtime, size });
				this._indexFile(key, tasks);
			}
		}
	}

	/**
	 * Cross-session staleness check: compare cached mtime against actual file mtime.
	 * Invalidates entries where the file has been modified since caching.
	 * Run once after fromJSON() during plugin startup.
	 * @param {object} vaultAdapter — app.vault.adapter
	 * @returns {Promise<number>} number of stale entries evicted
	 */
	async evictStale(vaultAdapter) {
		const stale = [];
		for (const [path, entry] of this._cache) {
			try {
				const stat = await vaultAdapter.stat(path);
				if (!stat) {
					stale.push(path);
				} else if (stat.mtime > entry.mtime) {
					// File modified since caching (same machine or sync)
					stale.push(path);
				} else if (entry.size > 0 && stat.size !== entry.size) {
					// Size changed but mtime didn't — sync preserved mtime, content changed
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

module.exports = { TaskCache, MAX_CACHE_ENTRIES, MAX_CACHE_SIZE_BYTES };
