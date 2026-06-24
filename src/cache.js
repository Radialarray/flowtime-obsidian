/**
 * Persistent task cache for Flowtime.
 *
 * Stores parsed task data per file path so that full vault scans
 * are only needed on first load. Subsequent renders read from cache.
 * Invalidated on file save, delete, and Flowtime actions.
 *
 * Cache is serialized via toJSON/fromJSON for persistence across
 * Obsidian restarts (stored in plugin settings data).
 */
class TaskCache {
	constructor() {
		/** @type {Map<string, { parsedTasks: object[], mtime: number }>} */
		this._cache = new Map();
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
	 * @param {string} filePath
	 * @param {object[]} parsedTasks — array of task objects (without file references)
	 */
	set(filePath, parsedTasks) {
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
	}

	/**
	 * Serialize cache to a plain object for storage.
	 * @returns {object} — filePath -> parsedTasks[]
	 */
	toJSON() {
		const obj = {};
		for (const [key, val] of this._cache) {
			obj[key] = val.parsedTasks;
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
			if (Array.isArray(val)) {
				this._cache.set(key, { parsedTasks: val, mtime: Date.now() });
			}
		}
	}
}

module.exports = { TaskCache };
