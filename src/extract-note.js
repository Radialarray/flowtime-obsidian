/**
 * extract-note — Extract selected text to a new note.
 *
 * Command: Ctrl+G (Mod+G)
 * Behavior:
 *   1. First selected line becomes the new note title
 *   2. New note created in the current file's folder
 *   3. Remaining selected lines move to the new note
 *   4. First line replaced with [[wikilink]] to the new note
 *   5. New note opens in a new leaf
 */

const { Notice } = require("obsidian");

class ExtractNoteHandler {
	constructor(app, editor, view, plugin) {
		this.app = app;
		this.editor = editor;
		this.view = view;
		this.plugin = plugin;
	}

	async run() {
		// ── Get selection as full lines ──
		const from = this.editor.getCursor("from");
		const to = this.editor.getCursor("to");

		if (from.line === to.line && from.ch === to.ch) {
			new Notice("Select text to extract to a new note");
			return;
		}

		const startLine = from.line;
		const endLine = to.line;

		// Read full lines
		const lines = [];
		for (let i = startLine; i <= endLine; i++) {
			lines.push(this.editor.getLine(i));
		}

		const firstLine = lines[0].trim();
		if (!firstLine) {
			new Notice("First line cannot be empty");
			return;
		}

		// ── Resolve current file ──
		const currentFile = this.view.file;
		if (!currentFile) {
			new Notice("No active file to extract from");
			return;
		}

		// ── Derive title from first line ──
		const title = this._cleanTitle(firstLine);
		const safeName = this._sanitizeFilename(title);
		if (!safeName) {
			new Notice("Could not derive a valid filename from the first line");
			return;
		}

		// ── Resolve target folder ──
		const rawFolder = currentFile.parent
			? currentFile.parent.path
			: "";
		const folderPath = rawFolder === "/" ? "" : rawFolder;

		// ── Ensure unique path ──
		const { path: newPath, name: finalName } =
			await this._ensureUniquePath(folderPath, safeName);

		// ── Content for new note (remaining lines after the first) ──
		const newContent = lines.slice(1).join("\n");

		// ── Create the new note ──
		try {
			await this.app.vault.create(newPath, newContent);
		} catch (e) {
			new Notice("Failed to create note: " + e.message);
			return;
		}

		// ── Replace the full selection with a [[wikilink]] ──
		const linkText = `[[${finalName}]]`;
		this.editor.replaceRange(
			linkText,
			{ line: startLine, ch: 0 },
			{
				line: endLine,
				ch: this.editor.getLine(endLine).length,
			},
		);

		// ── Store extract info for Undo Extract command ──
		this.plugin._lastExtract = {
			newFilePath: newPath,
			fileName: finalName,
			timestamp: Date.now(),
		};

		// ── Open the new note in a new tab ──
		// Preserves the source leaf so its undo history survives.
		const newFile = this.app.vault.getAbstractFileByPath(newPath);
		if (newFile) {
			await this.app.workspace.getLeaf("tab").openFile(newFile);
		}

		this.plugin.notify(`✅ Extracted to "${finalName}"`);
	}

	/**
	 * Strip list markers, checkbox markers, heading markers,
	 * and Flowtime @-directives from the first line
	 * to derive a readable title and clean filename.
	 */
	_cleanTitle(line) {
		return line
			.replace(/^\s*[-*+]\s*\[[^\]]*\]\s*/, "") // checkbox: - [ ]
			.replace(/^\s*[-*+]\s*/, "") // list marker: - * +
			.replace(/^#+\s*/, "") // heading: ##
			.replace(/^\s*\d+[.)]\s*/, "") // numbered: 1. 2)
			.replace(/^>\s*/, "") // blockquote: >
			.replace(/[\[\]]/g, "") // remove bare brackets
			.replace(/@\d{4}-\d{2}-\d{2}/g, "") // dates: @2026-06-24
			.replace(/@(today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next-week|next-monday)\b/gi, "") // relative dates
			.replace(/@\d+(?:\.\d+)?[hm]/g, "") // durations: @1h @30m
			.replace(/@(?:bucket|b):[^\s]+/g, "") // buckets: @b:deep-work
			.replace(/@p:[^\s]+/g, "") // projects: @p:Website
			.replace(/@(?:high|med|low|soon|inbox|snooze)\b/gi, "") // status/priority tags
			.replace(/@snooze\s+\d{4}-\d{2}-\d{2}/g, "") // snooze dates
			.replace(/@due:[^\s]+/g, "") // due dates: @due:tomorrow
			.replace(/🔁\s*every\s+\d*\s*(?:day|days|week|weeks|month|months|workday|workdays)\b/gi, "") // recurrence
			.replace(/[🟥🟨🟩]/gu, "") // priority color dots
			.replace(/#\S+/g, "") // tags
			.replace(/\s+/g, " ") // collapse whitespace
			.trim();
	}

	/**
	 * Sanitize a title string into a valid filename.
	 * Falls back to "Untitled" if the result is empty.
	 */
	_sanitizeFilename(title) {
		let name = title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "");
		name = name.replace(/\s+/g, " ").trim();
		if (name.length > 100) name = name.slice(0, 100).trim();
		if (name.endsWith(".")) name = name.slice(0, -1).trim();
		return name || "Untitled";
	}

	/**
	 * Check if a file at the given path already exists.
	 * If so, append " 2", " 3", etc. until the path is free.
	 */
	async _ensureUniquePath(folderPath, name) {
		let finalName = name;
		let counter = 1;
		const buildPath = (n) => {
			let p = folderPath
				? `${folderPath}/${n}.md`
				: `${n}.md`;
			// Strip duplicate leading slashes
			while (p.startsWith("/")) p = p.slice(1);
			return p;
		};

		let path = buildPath(finalName);
		while (await this.app.vault.adapter.exists(path)) {
			counter++;
			finalName = `${name} ${counter}`;
			path = buildPath(finalName);
		}

		return { path, name: finalName };
	}
}

module.exports = { ExtractNoteHandler };
