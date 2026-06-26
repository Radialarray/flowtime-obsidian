/**
 * v1.3.0: ListEnhancer — enhances markdown notes with interactive task features
 * when the note has `type: flowtime-list` in its frontmatter.
 *
 * The note itself IS the task list. The plugin:
 * - Parses ### headings as drop zones
 * - Enhances task lines (- [ ]) with drag handles, checkboxes, timers
 * - Aggregates tasks from the vault and writes them into the note
 * - Persists drag reordering and date changes back to source files
 */

class ListEnhancer {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
		this._active = false;
		this._currentPath = null;
		this._observedTasks = []; // tasks currently shown in the enhanced note
		this._dispose = null; // cleanup function
	}

	/**
	 * Check if the active note should be enhanced.
	 * Called on active leaf change and on layout ready.
	 */
	async check() {
		const file = this.app.workspace.getActiveFile();
		if (!file) return this.deactivate();

		if (this._currentPath === file.path && this._active) return;

		const cache = this.app.metadataCache.getCache(file.path);
		const fm = cache?.frontmatter;
		const isListNote = fm?.type === "flowtime-list";

		if (isListNote) {
			await this.activate(file);
		} else if (this._active) {
			this.deactivate();
		}
	}

	/**
	 * Activate enhancement on a note.
	 * Sets up DOM observers and renders the interactive list.
	 */
	async activate(file) {
		this.deactivate(); // cleanup previous if any
		this._active = true;
		this._currentPath = file.path;
		console.log("FT LIST ENHANCER: activated on", file.path);

		// We need the rendered markdown to be available.
		// Listen for layout changes or use a MutationObserver on the preview.
		// For now, schedule the first enhancement pass.
		setTimeout(() => this._enhance(), 500);
	}

	/**
	 * Deactivate — remove all enhancements and clean up.
	 */
	deactivate() {
		if (this._dispose) {
			this._dispose();
			this._dispose = null;
		}
		this._cleanupDOM();
		this._active = false;
		this._currentPath = null;
		this._observedTasks = [];
	}

	/* ─── Document Parser ─── */

	/**
	 * Parse the active note's content: extract headings and task lines.
	 * Returns an array of sections: { heading, level, tasks: [{ line, text, checked, indent }] }
	 */
	_parseNote(content) {
		const lines = content.split("\n");
		const sections = [];
		let currentSection = { heading: null, level: 0, tasks: [] };

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
			if (headingMatch) {
				// Save previous section if it has tasks
				if (currentSection.tasks.length > 0 || currentSection.heading) {
					sections.push(currentSection);
				}
				currentSection = {
					heading: headingMatch[2].trim(),
					level: headingMatch[1].length,
					tasks: [],
					startLine: i,
				};
				continue;
			}
			const taskMatch = line.match(/^(\s*)[-*+]\s+\[([ xX\-])\]\s+(.*)$/);
			if (taskMatch) {
				currentSection.tasks.push({
					line: i,
					indent: taskMatch[1].length,
					checked: taskMatch[2] !== " ",
					text: taskMatch[3],
					raw: line,
				});
			}
		}
		// Push last section
		if (currentSection.tasks.length > 0 || currentSection.heading) {
			sections.push(currentSection);
		}
		return sections;
	}

	/* ─── DOM Enhancement ─── */

	/** Main enhancement pass — called after note renders */
	_enhance() {
		this._cleanupDOM();
		const view = this.app.workspace.activeEditor;

		// In Live Preview / Source mode, task lines use HyperMD-task-line
		// In Reading view, they use .task-list-item
		const container =
			view?.previewEl || // Reading view
			document.querySelector(".markdown-source-view"); // Live Preview / Source

		if (!container) {
			// Retry after a short delay (rendering may not be done yet)
			setTimeout(() => this._enhance(), 300);
			return;
		}

		// Try both selectors
		const selector =
			".task-list-item:not(.ft-list-enhanced), .HyperMD-task-line:not(.ft-list-enhanced)";
		const taskEls = container.querySelectorAll(selector);
		if (taskEls.length === 0) {
			// Retry — CM lines may render async
			setTimeout(() => this._enhance(), 500);
			return;
		}

		for (const el of taskEls) {
			this._enhanceTaskLine(el);
		}

		// Set up drag/drop on the container
		this._setupDragDrop(container);

		// Watch for DOM changes (new tasks rendered, view mode switch)
		if (!this._observer) {
			this._observer = new MutationObserver(() => {
				// Debounce — don't re-enhance on every keystroke
				clearTimeout(this._observeTimer);
				this._observeTimer = setTimeout(() => this._enhance(), 500);
			});
			this._observer.observe(container, {
				childList: true,
				subtree: true,
			});
		}
	}

	/** Enhance a single task line with drag handle + interactive elements */
	_enhanceTaskLine(el) {
		if (el.classList.contains("ft-list-enhanced")) return;
		el.classList.add("ft-list-enhanced");

		// In Live Preview, the drag handle goes at the start of the line content
		// In Reading view, before the checkbox
		const isPreview = el.classList.contains("task-list-item");
		const insertPoint = isPreview ? el.firstChild : (el.querySelector(".cm-formatting-task")?.nextSibling || el.firstChild);

		const handle = el.createEl("span", {
			text: "⠿",
			cls: "ft-list-drag ft-enhance-drag",
			attr: { title: "Drag to reorder" },
		});
		el.insertBefore(handle, insertPoint);

		// For HyperMD lines, ensure the handle doesn't interfere with editing
		if (!isPreview) {
			handle.style.position = "absolute";
			handle.style.left = "0";
			handle.style.top = "0";
			handle.style.zIndex = "1";
			el.style.position = "relative";
			el.style.paddingLeft = "22px";
		}
	}

	/** Remove all DOM enhancements */
	_cleanupDOM() {
		if (this._observer) {
			this._observer.disconnect();
			this._observer = null;
		}
		document
			.querySelectorAll(".ft-list-enhanced")
			.forEach((el) => el.classList.remove("ft-list-enhanced"));
		document
			.querySelectorAll(".ft-enhance-drag")
			.forEach((el) => el.remove());
	}

	/* ─── Drag & Drop ─── */

	/** Set up mouse-based drag on enhanced task lines */
	_setupDragDrop(container) {
		// Reuse the same approach as list view
		// For now: stub — will be implemented in next iteration
	}
}

module.exports = { ListEnhancer };
