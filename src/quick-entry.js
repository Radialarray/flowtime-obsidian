const { Modal, Notice } = require("obsidian");
const { parseDate } = require("./date-parser");

class QuickEntryModal extends Modal {
	constructor(app, plugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("flowtime-quick-entry");

		// Title
		contentEl.createEl("h2", { text: "Add Task" });

		// ── Task text ──
		contentEl.createEl("label", { text: "Task", cls: "flowtime-label" });
		const taskInput = contentEl.createEl("input", {
			type: "text",
			placeholder: "What needs to be done?",
			cls: "flowtime-input",
		});
		taskInput.focus();

		// ── Date ──
		contentEl.createEl("label", { text: "Date", cls: "flowtime-label" });
		const dateRow = contentEl.createEl("div", { cls: "flowtime-row" });
		const dateInput = dateRow.createEl("input", {
			type: "text",
			placeholder: "today, tomorrow, next monday, 2026-06-24",
			value: "today",
			cls: "flowtime-input",
		});
		const datePreview = dateRow.createEl("span", {
			text: "→ @" + (parseDate("today") || "—"),
			cls: "flowtime-date-preview",
		});

		// ── Live preview helper (defined early so all handlers can call it) ──
		const preview = contentEl.createEl("div", { cls: "flowtime-preview" });
		preview.createEl("div", { text: "Preview:", cls: "flowtime-label" });
		const previewCode = preview.createEl("code", { cls: "flowtime-preview-code" });

		const updateLivePreview = () => {
			const date = parseDate(dateInput.value);
			const project = projInput.value.trim();
			const task = taskInput.value.trim();
			let line = "- [ ] " + (task || "task description");
			if (project) line += " #" + this.plugin.settings.tagPrefix + project;
			if (date) line += " @" + date;
			const dur = parseInt(durSelect.value, 10);
			if (dur && dur > 0) {
				const durStr = dur < 60 ? dur + "m" : dur / 60 + "h";
				line += " @" + durStr;
			}
			const bucket = bucketSelect.value;
			if (bucket) line += " @b:" + bucket;
			// Add parent indent if set
			const parentLine = parentSelect ? parentSelect.value : "";
			if (parentLine) line = "  " + line;
			previewCode.setText(line);
		};

		// Live preview on date input
		dateInput.addEventListener("input", () => {
			const parsed = parseDate(dateInput.value);
			datePreview.setText(parsed ? "→ @" + parsed : "→ ?");
			datePreview.toggleClass("flowtime-date-invalid", !parsed);
			updateLivePreview();
		});

		// ── Project (input with dropdown on focus) ──
		contentEl.createEl("label", { text: "Project", cls: "flowtime-label" });
		const projInput = contentEl.createEl("input", {
			type: "text",
			placeholder: "Type or select a project",
			cls: "flowtime-input",
		});

		// Dropdown appended to body
		const projDD = document.createElement("div");
		projDD.className = "flowtime-proj-dd";
		let allProjects = [];

		const openDD = () => {
			const r = projInput.getBoundingClientRect();
			projDD.style.left = r.left + "px";
			projDD.style.top = (r.bottom + 4) + "px";
			projDD.style.width = r.width + "px";
			projDD.style.display = "block";
			document.body.appendChild(projDD);
			populateDD(projInput.value);
		};

		const closeDD = () => {
			projDD.style.display = "none";
			if (projDD.parentNode) projDD.parentNode.removeChild(projDD);
		};

		const populateDD = (query) => {
			projDD.empty();
			const q = query.toLowerCase().trim();
			const matches = q
				? allProjects.filter(p => p.name.toLowerCase().includes(q))
				: allProjects;
			for (const proj of matches.slice(0, 8)) {
				const item = projDD.createEl("button", { text: proj.name, cls: "flowtime-proj-dd-item" });
				item.addEventListener("click", () => {
					projInput.value = proj.name;
					closeDD();
					updateLivePreview();
				});
			}
			if (matches.length === 0) {
				projDD.createEl("div", { text: "No projects found", cls: "flowtime-proj-dd-empty" });
			}
		};

		projInput.addEventListener("focus", () => openDD());
		projInput.addEventListener("input", () => {
			if (!projDD.parentNode) openDD();
			else populateDD(projInput.value);
			updateLivePreview();
		});
		projInput.addEventListener("keydown", (e) => {
			if (e.key === "Escape") closeDD();
		});
		projInput.addEventListener("blur", () => {
			setTimeout(closeDD, 150);
		});

		// Load projects + auto-detect
		const activeFile = this.app.workspace.getActiveFile();
		if (this.plugin.projectEngine) {
			this.plugin.projectEngine.getAllProjects().then(projects => {
				allProjects = projects;
			});
			if (activeFile) {
				this.plugin.projectEngine.resolve(activeFile.path).then(result => {
					if (result?.name && !projInput.value) {
						projInput.value = result.name;
						updateLivePreview();
					}
				}).catch(() => {});
			}
		}

		// ── Duration ──
		contentEl.createEl("label", { text: "Duration", cls: "flowtime-label" });
		const durSelect = contentEl.createEl("select", { cls: "flowtime-select" });
		const durations = [
			0, 10, 15, 20, 25, 30, 45, 60, 90, 120, 150, 180, 210, 240,
		];
		for (const d of durations) {
			durSelect.createEl("option", {
				text:
					d === 0
						? "None"
						: d < 60
							? d + "m"
							: d / 60 + "h",
				value: String(d),
			});
		}

		// ── Bucket ──
		contentEl.createEl("label", { text: "Bucket", cls: "flowtime-label" });
		const bucketSelect = contentEl.createEl("select", { cls: "flowtime-select" });
		const buckets = this.plugin.settings.buckets || [];
		bucketSelect.createEl("option", { text: "None", value: "" });
		for (const b of buckets) {
			bucketSelect.createEl("option", {
				text: b.name,
				value: b.id,
				attr: { "data-color": b.color },
			});
		}

		// Update preview on any input change
		taskInput.addEventListener("input", updateLivePreview);
		projInput.addEventListener("input", updateLivePreview);
		durSelect.addEventListener("change", updateLivePreview);
		bucketSelect.addEventListener("change", updateLivePreview);
		updateLivePreview();

		// v0.6.0: Parent task dropdown for subtask hierarchy
		contentEl.createEl("label", { text: "Subtask of", cls: "flowtime-label" });
		const parentSelect = contentEl.createEl("select", { cls: "flowtime-select" });
		parentSelect.createEl("option", { text: "None (top-level)", value: "" });

		// Load parent candidates from the target file
		const loadParents = async () => {
			const activeFile = this.app.workspace.getActiveFile();
			let target = activeFile;
			const targetSetting = this.plugin.settings.quickEntryTargetFile;

			if (targetSetting === "daily-note") {
				const today = new Date().toISOString().split("T")[0];
				const allFiles = this.app.vault.getMarkdownFiles();
				const dailyFile = allFiles.find((f) => f.basename === today);
				if (dailyFile) target = dailyFile;
			} else if (targetSetting === "inbox") {
				const inbox = this.app.vault.getAbstractFileByPath(
					this.plugin.settings.inboxPath || "Inbox.md",
				);
				if (inbox) target = inbox;
			}

			if (!target) return;

			try {
				const content = await this.app.vault.read(target);
				const lines = content.split("\n");
				const { parseTaskLine } = require("./task-parser");

				// Collect top-level tasks (indent===0) for parent candidates
				const candidates = [];
				for (let i = 0; i < lines.length; i++) {
					const parsed = parseTaskLine(lines[i], target, i);
					if (parsed && parsed.indent === 0 && parsed.status !== "x") {
						candidates.push(parsed);
					}
				}

				// Populate dropdown (keep existing selection if possible)
				const currentVal = parentSelect.value;
				parentSelect.empty();
				parentSelect.createEl("option", { text: "None (top-level)", value: "" });
				for (const c of candidates.slice(0, 20)) {
					const opt = parentSelect.createEl("option", {
						text: c.cleanText.slice(0, 60),
						value: String(c.line),
					});
					if (currentVal && String(c.line) === currentVal) {
						opt.selected = true;
					}
				}
			} catch (_) {}
		};
		loadParents();

		// Parent select changes update preview
		parentSelect.addEventListener("change", updateLivePreview);

		// ── Buttons ──
		const btnRow = contentEl.createEl("div", { cls: "flowtime-btn-row" });
		const cancelBtn = btnRow.createEl("button", {
			text: "Cancel",
			cls: "flowtime-btn-cancel",
		});
		const submitBtn = btnRow.createEl("button", {
			text: "Add Task",
			cls: "flowtime-btn-submit",
		});

		cancelBtn.addEventListener("click", () => this.close());

		// ── Submit logic ──
		const doSubmit = async () => {
			const task = taskInput.value.trim();
			if (!task) {
				this.plugin.notify("Task description is required", true);
				return;
			}

			const date = parseDate(dateInput.value);
			const project = projInput.value.trim();

			// Build task line
			const parentIndent = parentSelect.value ? "  " : "";
			let line = parentIndent + "- [ ] " + task;
			if (project) line += " #" + this.plugin.settings.tagPrefix + project;
			if (date) line += " @" + date;
			const dur = parseInt(durSelect.value, 10);
			if (dur && dur > 0) {
				const durStr = dur < 60 ? dur + "m" : dur / 60 + "h";
				line += " @" + durStr;
			}
			const bucket = bucketSelect.value;
			if (bucket) line += " @b:" + bucket;

			// Determine target file
			let targetFile = activeFile;
			const target = this.plugin.settings.quickEntryTargetFile;

			if (target === "daily-note") {
				// Search vault for a file whose basename matches today's date
				const today = new Date().toISOString().split("T")[0];
				const allFiles = this.app.vault.getMarkdownFiles();
				const dailyFile = allFiles.find((f) => f.basename === today);
				targetFile = dailyFile || activeFile;
			} else if (target === "project-file" && project) {
				// Try to find project folder note via projectEngine cache
				const cached = this.plugin.projectEngine?.cache?.get?.(
					activeFile?.path,
				);
				if (cached?.path) {
					const f = this.app.vault.getAbstractFileByPath(cached.path);
					if (f) targetFile = f;
				}
			} else if (target === "inbox") {
				// Write to inbox file
				const inboxPath = this.plugin.settings.inboxPath || "Inbox.md";
				const f = this.app.vault.getAbstractFileByPath(inboxPath);
				if (f) {
					targetFile = f;
				} else {
					this.plugin.notify("Inbox not found. Run Flowtime: Process Inbox to create it.", true);
					return;
				}
			} // "active-file" → targetFile stays as activeFile

			if (!targetFile) {
				this.plugin.notify("No target file found...", true);
				return;
			}

			// Append line to file
			try {
				const content = await this.app.vault.read(targetFile);
				const newContent = content.trimEnd() + "\n" + line + "\n";
				await this.app.vault.modify(targetFile, newContent);
				this.plugin.notify("✅ Task added: " + task);
				this.close();
			} catch (e) {
				this.plugin.notify("❌ Failed to add task: " + e.message, true);
			}
		};

		submitBtn.addEventListener("click", doSubmit);

		// Enter key submits from task or date fields
		taskInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				doSubmit();
			}
		});
		dateInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				doSubmit();
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

module.exports = { QuickEntryModal };
