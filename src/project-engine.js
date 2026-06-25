class ProjectEngine {
	constructor(app, settings) {
		this.app = app;
		this.settings = settings;
		this.cache = new Map();
	}

	/**
	 * Resolve project for a given file path.
	 * Returns { name: string|null, path: string|null, source: 'frontmatter'|'folder'|null }
	 */
	async resolve(filePath) {
		if (this.cache.has(filePath)) return this.cache.get(filePath);

		// Strategy 1: Walk up directory tree looking for folder note with frontmatter marker
		const result = await this._resolveFromFrontmatter(filePath);
		if (result) {
			this.cache.set(filePath, result);
			return result;
		}

		// Strategy 2: Fallback to parent folder name
		const fallback = await this._resolveFromFolder(filePath);
		this.cache.set(filePath, fallback);
		return fallback;
	}

	/* ─── helpers ─── */

	_parentDir(filePath) {
		const idx = filePath.lastIndexOf("/");
		if (idx <= 0) return "";
		return filePath.substring(0, idx + 1);
	}

	/* ─── strategies ─── */

	/**
	 * Walk directory tree upward from file's parent dir.
	 * At each level, check for a folder note (file named same as the directory,
	 * sibling to it). If found, parse its frontmatter for the configured
	 * marker key/value. On match, return project info.
	 */
	async _resolveFromFrontmatter(filePath) {
		let dir = this._parentDir(filePath);
		const rootSetting = this.settings.projectsRoot || "";
		const rootPath = rootSetting
			? rootSetting.endsWith("/")
				? rootSetting
				: rootSetting + "/"
			: "";

		while (dir) {
			if (rootPath && !dir.startsWith(rootPath)) break;

			const dirName = dir.replace(/\/$/, "").split("/").pop();
			if (!dirName) break;

			const candidatePath = dir + dirName + ".md";
			const file = this.app.vault.getAbstractFileByPath(candidatePath);

			if (file) {
				const content = await this.app.vault.read(file);
				const { found, name } = this._parseFrontmatter(content);
				if (found) {
					return {
						name: name || dirName,
						path: candidatePath,
						source: "frontmatter",
					};
				}
			}

			// Walk up one level
			const trimmed = dir.replace(/\/$/, "");
			const idx = trimmed.lastIndexOf("/");
			if (idx <= 0) break;
			dir = trimmed.substring(0, idx + 1);
		}

		return null;
	}

	/**
	 * Parse frontmatter from file content.
	 * Returns { found: boolean, name: string|null }
	 * - found: true if the configured marker key/value pair exists
	 * - name: value of projectNameKey, title, or alias (first found)
	 */
	_parseFrontmatter(content) {
		const match = content.match(/^---\n([\s\S]*?)\n---/);
		if (!match) return { found: false, name: null };

		const yamlLines = match[1].split("\n");
		const key = this.settings.projectFrontmatterKey;
		const value = this.settings.projectFrontmatterValue;

		let isProject = false;
		let name = null;

		for (const line of yamlLines) {
			const kv = line.match(/^(\w[\w\s-]*?):\s+(.+)$/);
			if (!kv) continue;
			const k = kv[1].trim();
			const v = kv[2].trim();

			if (k === key && v === value) isProject = true;
			if (k === this.settings.projectNameKey) name = v;
			if (!name && (k === "title" || k === "alias")) name = v;
		}

		return { found: isProject, name };
	}

	/**
	 * Use parent folder name as project display name.
	 */
	async _resolveFromFolder(filePath) {
		if (!this.settings.fallbackToFolderName) {
			return { name: null, path: null, source: null };
		}
		const dir = this._parentDir(filePath);
		const dirName = dir.replace(/\/$/, "").split("/").pop();
		return { name: dirName || null, path: null, source: "folder" };
	}

	/**
	 * Extract project name from a #tag in task text (for Sprint 3 use).
	 */
	resolveFromTag(taskText, tagPrefix) {
		const escaped = tagPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const regex = new RegExp(`#${escaped}(\\S+)`, "i");
		const match = taskText.match(regex);
		return match ? match[1] : null;
	}

	/**
	 * Scan vault for all known projects (folder notes with frontmatter marker).
	 * Returns sorted array of unique project names.
	 */
	async getAllProjects() {
		const projects = new Map(); // name → path
		const files = this.app.vault.getMarkdownFiles();
		const key = this.settings.projectFrontmatterKey;
		const value = this.settings.projectFrontmatterValue;
		const nameKey = this.settings.projectNameKey;
		for (const file of files) {
			// Only check files that could be folder notes (name matches parent dir)
			const parts = file.path.split("/");
			const folder = parts.length > 1 ? parts[parts.length - 2] : null;
			if (!folder || file.basename !== folder) continue;

			try {
				// Use metadataCache for frontmatter — avoids vault.read() + YAML parse
				const cache = this.app.metadataCache.getCache(file.path);
				const fm = cache?.frontmatter;
				if (fm && fm[key] === value) {
					const name = fm[nameKey] || fm.title || fm.alias || folder;
					if (!projects.has(name)) {
						projects.set(name, file.path);
					}
				}
			} catch (_) {}
		}
		// Sort alphabetically
		return [...projects.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([name, path]) => ({ name, path }));
	}

	/* ─── cache management ─── */

	/**
	 * Invalidate cache entries for a given path.
	 * If it's a directory path, invalidates all entries under it.
	 */
	invalidate(filePath) {
		this.cache.delete(filePath);
		// If called with a directory path, also clear all entries under it
		if (filePath.endsWith("/")) {
			for (const key of this.cache.keys()) {
				if (key.startsWith(filePath)) {
					this.cache.delete(key);
				}
			}
		}
	}

	clear() {
		this.cache.clear();
	}
}

module.exports = { ProjectEngine };
