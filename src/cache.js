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
		/** @type {Map<string, { parsedTasks: object[], mtime: number }>} */
		this._cache = new Map();
		this._warningIssued = false;
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
		if (!parsedTasks || parsedTasks.length === 0) {
			// Don't store empty entries — saves space
			this._cache.delete(filePath);
			return;
		}
		this._cache.set(filePath, { parsedTasks, mtime: Date.now() });
	}

	/**
	 * Remove cached entry for a file path.
	 * @param {string} filePath
	 */
	invalid(filePath) {
		this._cache.delete(filePath);
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
	 * @returns {object} — filePath -> parsedTasks[]
	 */
	toJSON() {
		const obj = {};
		for (const [key, val] of this._cache) {
			if (val.parsedTasks && val.parsedTasks.length > 0) {
				obj[key] = val.parsedTasks;
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
			if (Array.isArray(val) && val.length > 0) {
				this._cache.set(key, { parsedTasks: val, mtime: Date.now() });
			}
		}
	}
}

module.exports = { TaskCache, MAX_CACHE_ENTRIES, MAX_CACHE_SIZE_BYTES };
