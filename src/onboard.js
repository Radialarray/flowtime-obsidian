const { Notice } = require("obsidian");

async function runOnboard(app, plugin) {
	const stats = { migrated: 0, projects: 0, skipped: 0 };

	// ── Step 1: Migrate dates ──
	const files = app.vault.getMarkdownFiles();
	for (const file of files) {
		if (file.path.startsWith(".obsidian") || file.path.startsWith(".git"))
			continue;

		const content = await app.vault.read(file);
		const lines = content.split("\n");
		let changed = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// Only process task lines
			if (!line.match(/^\s*[-*+]\s*\[[^\]]*\]/)) continue;

			let newLine = line;

			// Extract existing dates
			const schedMatch = newLine.match(/⏳\s*(\d{4}-\d{2}-\d{2})/);
			const dueMatch = newLine.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
			const existingAt = newLine.match(/@\s*(\d{4}-\d{2}-\d{2})/);

			// Already in @ format and no old markers — skip this line
			if (existingAt && !schedMatch && !dueMatch) {
				continue;
			}

			// Priority: ⏳ (scheduled) > 📅 (due) > keep existing @
			let keepDate = null;
			if (schedMatch) keepDate = schedMatch[1];
			else if (dueMatch) keepDate = dueMatch[1];
			else if (existingAt) keepDate = existingAt[1];

			// Remove all old date markers
			newLine = newLine.replace(/\s*⏳\s*\d{4}-\d{2}-\d{2}/, "");
			newLine = newLine.replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/, "");
			newLine = newLine.replace(/\s*@\s*\d{4}-\d{2}-\d{2}/, "");

			// Add unified @ date at end
			if (keepDate) {
				newLine = newLine.trimEnd() + " @" + keepDate;
			}

			if (newLine !== line) {
				lines[i] = newLine;
				changed = true;
			}
		}

		if (changed) {
			await app.vault.modify(file, lines.join("\n"));
			stats.migrated++;
		}
	}

	// ── Step 2: Mark project folders ──
	for (const file of files) {
		const parts = file.path.split("/");
		const folder = parts.length > 1 ? parts[parts.length - 2] : null;
		if (!folder || file.basename !== folder) continue;

		const content = await app.vault.read(file);
		const hasFM = content.match(/^---\n([\s\S]*?)\n---/);

		if (hasFM) {
			const fm = hasFM[1];
			if (fm.match(/^type\s*:\s*project/m)) continue; // already marked
			// Has frontmatter but not "type: project" — add it
			const newContent = content.replace(/^(---\n)/, "$1type: project\n");
			await app.vault.modify(file, newContent);
		} else {
			// No frontmatter at all — add it with name
			const newContent =
				"---\ntype: project\nname: " + folder + "\n---\n\n" + content;
			await app.vault.modify(file, newContent);
		}
		stats.projects++;
	}

	// ── Step 3: Report ──
	const msgs = [];
	if (stats.migrated > 0) msgs.push("✅ " + stats.migrated + " files migrated to @ format");
	if (stats.projects > 0) msgs.push("📁 " + stats.projects + " projects marked");
	if (msgs.length === 0) msgs.push("✨ Already up to date — nothing to migrate");

	plugin.notify(msgs.join(", "));
}

module.exports = { runOnboard };
