import {
	Platform,
	Plugin,
	Notice,
	Modal,
	MarkdownView,
	MarkdownPostProcessorContext,
	App,
	Editor,
	MarkdownFileInfo,
	TAbstractFile,
	TFile,
} from "obsidian";
import { FlowtimeRenderer } from "./renderer";
import { FlowtimeSettingsTab, DEFAULT_SETTINGS } from "./settings";
import { ProcessInboxModal } from "./inbox-processor";
import { ProjectEngine } from "./project-engine";
import {
  insertDaily,
  insertWeekly,
  insertWeekplan,
  createDashboard,
  createProject,
  createToday,
} from "./template-engine";
import { QuickEntryModal } from "./quick-entry";
import { runOnboard } from "./onboard";
import { StatusTimer } from "./status-timer";
import { SessionStore } from "./session-store";
import { TaskCache } from "./cache";
import { RoutineEngine } from "./routine-engine";
import { extractNote } from "./extract-note";
import { ListEnhancer } from "./list-enhancer";
import { WeekplanRenderer } from "./weekplan-renderer";
import { AddTaskSuggest, AtCompletionsSuggest } from "./suggests/at-completions";
import { TaskIndex } from "./task-index";
import type { FlowtimeSettings, TaskRow } from "./types";

/* ─── Inline types ─── */

interface ExtractState {
  timestamp: number;
  newFilePath: string;
	fileName: string;
}


/* ═══════════════════════════════════════════════════════════════════
   FlowtimePlugin — main plugin entry point
   ═══════════════════════════════════════════════════════════════════ */

export default class FlowtimePlugin extends Plugin {
	settings!: FlowtimeSettings;
	notify!: (message: string, isError?: boolean) => void;
	projectEngine!: ProjectEngine;
	sessionStore!: SessionStore;
	taskCache!: TaskCache;
	taskIndex!: TaskIndex;
	routineEngine!: RoutineEngine;
	statusTimer!: StatusTimer;
	listEnhancer!: ListEnhancer;
	renderers: (FlowtimeRenderer | WeekplanRenderer)[] = [];
	isMobile: boolean = false;
	onHeadingDrop?: () => Promise<void>;

	_activeRowTimer: unknown = null;
	_activeRowTimerStop: (() => void) | null = null;
	_lastExtract: ExtractState | null = null;

	_cacheSaveTimer: ReturnType<typeof setTimeout> | null = null;
	_cacheFilePath!: () => string;
	_notifiedCacheClean: boolean = false;

	_dailyGenTimer: ReturnType<typeof setTimeout> | null = null;
	_routineWatchTimer: ReturnType<typeof setTimeout> | null = null;
	_previousProjectsRoot: string = "";
	_tabHistory: string[] = [];
	_tabHistoryMax: number = 20;

	_scheduleCacheSave!: (force?: boolean) => void;
	_loadTaskCache!: () => Promise<void>;
	_saveTaskCache!: () => Promise<void>;

	override async onload(): Promise<void> {
		const savedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);
		// Ensure buckets default is populated if saved data has empty/null buckets
		if (!this.settings.buckets || this.settings.buckets.length === 0) {
			this.settings.buckets = DEFAULT_SETTINGS.buckets;
		}

		// v0.7.0: One-time migration of routinesFolder from old default
		if (
			this.settings.routinesFolder === "flowtime/routines/" &&
			!savedData?.routinesFolderMigrated
		) {
			this.settings.routinesFolder = "Routines/";
			this.settings.routinesFolderMigrated = true;
			await this.saveData(this.settings);
		}

		this.isMobile = Platform.isMobile;
		// On mobile, force list view regardless of user setting
		if (this.isMobile && this.settings.defaultView === "table") {
			// Don't persist — just override in-memory so renderers pick it up
		}

		this.notify = (message: string, isError: boolean = false): void => {
			if (!isError && this.settings.quietMode) return;
			new Notice(message, this.settings.noticeDuration);
		};

		this.addSettingTab(new FlowtimeSettingsTab(this.app, this));

		// v1.2.0: Migrate old contentWidth slider to preset
		if (
			this.settings.contentWidth !== undefined &&
			this.settings.contentWidthPreset === undefined
		) {
			const cw = this.settings.contentWidth;
			if (cw <= 0 || cw <= 800) this.settings.contentWidthPreset = "s";
			else if (cw <= 1100) this.settings.contentWidthPreset = "m";
			else if (cw <= 1500) this.settings.contentWidthPreset = "l";
			else this.settings.contentWidthPreset = "xl";
			delete this.settings.contentWidth;
		}
		// Default to "s" if not set
		if (!this.settings.contentWidthPreset) {
			this.settings.contentWidthPreset = "s";
		}

		// Apply content width preset
		if (this.settings.contentWidthPreset) {
			document.body.classList.add(
				"ft-wide-" + this.settings.contentWidthPreset,
			);
		}

		this.projectEngine = new ProjectEngine(this.app, this.settings);
		this.sessionStore = new SessionStore(this.app.vault);
		this.taskCache = new TaskCache();
		this.taskIndex = new TaskIndex();
		this.routineEngine = new RoutineEngine(this.app, this);

		// ── v0.4.0: Cache persistence in separate file ──
		this._cacheSaveTimer = null;
		this._cacheFilePath = () =>
			this.app.vault.configDir + "/plugins/flowtime/task-cache.json";
		// Track whether we've shown the cache-clean notice this session
		this._notifiedCacheClean = false;

		this._loadTaskCache = async (): Promise<void> => {
			try {
				const cachePath = this._cacheFilePath();
				if (await this.app.vault.adapter.exists(cachePath)) {
					const raw = await this.app.vault.adapter.read(cachePath);
					const parsed = JSON.parse(raw);
					this.taskCache.fromJSON(parsed);
				} else if (savedData && savedData._taskCache) {
					this.taskCache.fromJSON(savedData._taskCache as Record<string, unknown>);
					delete savedData._taskCache;
				}
			} catch (_) {
				/* ignore */
			}
		};

		this._saveTaskCache = async (): Promise<void> => {
			try {
				const data = this.taskCache.toJSON();
				await this.app.vault.adapter.write(
					this._cacheFilePath(),
					JSON.stringify(data, null, 2),
				);
			} catch (_) {
				/* ignore */
			}
		};

		// Load cache from separate file (with legacy fallback)
		await this._loadTaskCache();
		console.log("Flowtime cache: loaded, cache size =", this.taskCache.size);

		// Cross-session staleness: files modified while Obsidian was closed
		const staleCount = await this.taskCache.evictStale(
			this.app.vault.adapter,
		);
		if (staleCount > 0) {
			console.log("Flowtime cache: evicted stale =", staleCount);
			await this._saveTaskCache();
		}

		// v0.4.0: Auto-evict stale cache entries (files that no longer exist)
		const evicted = await this.taskCache.autoEvict(async (path: string) => {
			return !!this.app.vault.getAbstractFileByPath(path);
		});
		console.log(
			"Flowtime cache: evicted =",
			evicted,
			"_notifiedCacheClean =",
			this._notifiedCacheClean,
		);
		if (evicted > 0) {
			await this._saveTaskCache();
			console.log("Flowtime cache: saved after autoEvict");
			// Show notice at most once per session to avoid repeating the same count
			if (!this._notifiedCacheClean) {
				this._notifiedCacheClean = true;
				this.notify(
					`\u{1F9F9} Task cache cleaned: ${evicted} stale entries removed`,
				);
			}
		}

		// v0.4.0: Check safety limits
		const { warnings } = this.taskCache.checkSafetyLimits();
		for (const w of warnings) {
			this.notify("\u26A0\uFE0F " + w, true);
		}

		// v1.4.0: TaskIndex — cached task index with incremental updates
		const indexLoaded = await this.taskIndex.load(this.app.vault.adapter);
		if (!indexLoaded) {
			console.log("Flowtime: Building task index...");
			await this.taskIndex.scanAll(
				this.app.vault.getMarkdownFiles(),
				this.app.vault,
				this.settings.projectsRoot,
			);
			await this.taskIndex.save(this.app.vault.adapter);
			console.log("Flowtime: Task index built —", this.taskIndex.totalTasks, "tasks");
		} else {
			console.log("Flowtime: Task index loaded from disk —", this.taskIndex.totalTasks, "tasks");
		}

		// v0.7.0: Ensure session directory exists in plugin folder
		await this._ensureSessionDir();

		// v0.7.0: Optional daily notes folder — silently skip if missing
		await this._ensureDailyNotesFolder();

		// v0.5.0: Ensure routines folder exists
		await this.routineEngine.ensureRoutinesFolder();

		// v0.5.0: Auto-generate routine instances
		if (this.settings.autoGenerateOnStartup !== false) {
			try {
				const count = await this.routineEngine.generateAllDue();
				if (count > 0 && !this.settings.quietMode) {
					this.notify(
						"\u{1F501} Generated " +
							count +
							" routine task" +
							(count === 1 ? "" : "s"),
					);
				}
			} catch (e) {
				console.warn("Flowtime: Routine generation error:", (e as Error).message);
			}
		}

		// v0.8.0: Schedule twice-daily generation (morning 6 AM + evening 6 PM)
		// so long-running Obsidian sessions still get new routine tasks each day.
		this._scheduleDailyGenerations();

		// Track old projectsRoot to detect changes
		this._previousProjectsRoot = this.settings.projectsRoot;

		const onFileModified = (file: TAbstractFile): void => {
			this.projectEngine.invalidate(file.path);
			this.taskCache.invalid(file.path);
			if (file instanceof TFile && file.path.endsWith(".md")) {
				void this.taskIndex.indexFile(file, this.app.vault, this.settings.projectsRoot);
			}
			this._scheduleCacheSave();
		};
		const onFileDeleted = (file: TAbstractFile): void => {
			this.projectEngine.invalidate(file.path);
			this.taskCache.invalid(file.path);
			this.taskIndex.removeFile(file.path);
			this._scheduleCacheSave();
		};
		this.registerEvent(this.app.vault.on("modify", onFileModified));
		this.registerEvent(this.app.vault.on("delete", onFileDeleted));
		this.registerEvent(this.app.vault.on("create", onFileModified));

		// v0.5.0: Watch routines folder for changes → re-generate (debounced)
		const routinesFolder = this.settings.routinesFolder || "Routines/";
		this._routineWatchTimer = null;
		this.registerEvent(
			this.app.vault.on("modify", (file: TAbstractFile) => {
				if (
					file.path.startsWith(routinesFolder) &&
					!file.path.endsWith(".generated.json")
				) {
				if (this._routineWatchTimer) clearTimeout(this._routineWatchTimer);
				this._routineWatchTimer = setTimeout(async () => {
					this._routineWatchTimer = null;
					try {
						await this.routineEngine.generateAllDue();
					} catch (e) {
						console.warn("Flowtime: Routine auto-gen error:", (e as Error).message);
					}
				}, 5000);
				}
			}),
		);

		// Register /add-task slash command suggester
		this.registerEditorSuggest(new AddTaskSuggest(this.app, this));

		// v0.4.0: Register unified @-completions (directives + command macros)
		this.registerEditorSuggest(new AtCompletionsSuggest(this.app, this));

		// Quick entry command
		this.addCommand({
			id: "add-task",
			name: "Add Task",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "I" }],
			callback: () => {
				new QuickEntryModal(this.app, this).open();
			},
		});

		// Add Task at Cursor command
		this.addCommand({
			id: "add-task-inline",
			name: "Add Task at Cursor",
			editorCallback: (editor: Editor) => {
				const today = new Date().toISOString().split("T")[0];
				const cursor = editor.getCursor();
				const line = "- [ ]  @" + today + " ";
				editor.replaceRange(line, cursor);
				// Move cursor to after "- [ ] " so user can type task text immediately
				editor.setCursor({ line: cursor.line, ch: cursor.ch + 6 });
			},
		});

		// ── Extract to New Note command (Ctrl+G) ──
		this.addCommand({
			id: "extract-to-new-note",
			name: "Extract to new note",
			hotkeys: [{ modifiers: ["Mod"], key: "G" }],
			editorCallback: async (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
				extractNote(this.app, editor, view as MarkdownView, this);
			},
		});

		// ── Undo Extract command ──
		this.addCommand({
			id: "undo-extract",
			name: "Undo extract (delete created note)",
			editorCallback: async (editor: Editor, _view: MarkdownView | MarkdownFileInfo) => {
				const ext = this._lastExtract;
				if (!ext || Date.now() - ext.timestamp > 30000) {
					new Notice("No recent extract to undo");
					return;
				}
				// Undo the editor change
				editor.undo();
				// Delete the created file
				const file = this.app.vault.getAbstractFileByPath(ext.newFilePath);
				if (file) {
					try {
						await this.app.vault.delete(file);
						this.notify(`\u21A9\uFE0F Undo extract: deleted "${ext.fileName}"`);
					} catch (_) { /* fine */ }
				}
				this._lastExtract = null;
			},
		});

		// ── Append to Inbox command ──
		this.addCommand({
			id: "append-to-inbox",
			name: "Append to Inbox",
			callback: () => {
				class AppendToInboxModal extends Modal {
					plugin: FlowtimePlugin;

					constructor(app: App, plugin: FlowtimePlugin) {
						super(app);
						this.plugin = plugin;
					}
					override onOpen(): void {
						const { contentEl } = this;
						contentEl.createEl("h2", { text: "\u{1F4E5} Append to Inbox" });
						const textarea = contentEl.createEl("textarea", {
							placeholder: "What's on your mind?",
							cls: "flowtime-input",
						});
						textarea.style.width = "100%";
						textarea.style.minHeight = "80px";
						textarea.focus();

						const btnRow = contentEl.createEl("div", {
							cls: "flowtime-btn-row",
						});
						const cancelBtn = btnRow.createEl("button", {
							text: "Cancel",
							cls: "flowtime-btn-cancel",
						});
						const submitBtn = btnRow.createEl("button", {
							text: "Append",
							cls: "flowtime-btn-submit",
						});

						cancelBtn.addEventListener("click", () => this.close());
						submitBtn.addEventListener("click", async () => {
							const text = textarea.value.trim();
							if (!text) {
								this.plugin.notify("Nothing to append", true);
								return;
							}
							const path = this.plugin.settings.inboxPath || "Inbox.md";
							try {
								let content = "";
								if (await this.plugin.app.vault.adapter.exists(path)) {
									content = await this.plugin.app.vault.read(
										this.plugin.app.vault.getAbstractFileByPath(path) as TFile,
									);
								}
								// Split into lines, add the new text, write back
								const lines = text.split("\n").filter((l) => l.trim());
								const newContent =
									content.trimEnd() + "\n" + lines.join("\n") + "\n";
								if (await this.plugin.app.vault.adapter.exists(path)) {
									await this.plugin.app.vault.modify(
										this.plugin.app.vault.getAbstractFileByPath(path) as TFile,
										newContent,
									);
								} else {
									await this.plugin.app.vault.create(path, newContent);
								}
								this.plugin.notify(
									`\u{1F4E5} ${lines.length} line(s) added to inbox`,
								);
								this.close();
							} catch (e) {
								this.plugin.notify(
									"Failed to append: " + (e as Error).message,
									true,
								);
							}
						});

						// Ctrl+Enter or Cmd+Enter to submit
						textarea.addEventListener("keydown", (e: KeyboardEvent) => {
							if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
								submitBtn.click();
							}
						});
					}
					override onClose(): void {
						this.contentEl.empty();
					}
				}
				new AppendToInboxModal(this.app, this).open();
			},
		});

		// ── Create Inbox command ──
		this.addCommand({
			id: "create-inbox",
			name: "Create Inbox",
			callback: () => {
				this._ensureInbox();
			},
		});

		// ── Process Inbox command ──
		this.addCommand({
			id: "process-inbox",
			name: "Process Inbox",
			callback: () => {
				new ProcessInboxModal(this.app, this).open();
			},
		});

		// ── Status bar timer ──
		this.statusTimer = new StatusTimer({
			statusBarItem: this.addStatusBarItem(),
			settings: this.settings,
			notify: this.notify,
			onSessionEnd: async (data: {
				startTime: string;
				endTime: string;
				durationMinutes: number;
				taskText: string;
			}): Promise<void> => {
				await this.sessionStore.writeSession({
					startTime: data.startTime,
					endTime: data.endTime,
					durationMinutes: data.durationMinutes,
					bucket: "",
					taskText: data.taskText,
					notes: "",
				});
			},
			// Status bar right-click stop → stop active per-row timer
			onTimerStop: () => {
				if (this._activeRowTimerStop) {
					this._activeRowTimerStop();
					this._activeRowTimerStop = null;
				}
			},
		});

		this.registerDomEvent(this.statusTimer.statusBarItem, "click", () => {
			this.statusTimer.toggle();
		});
		this.registerDomEvent(
			this.statusTimer.statusBarItem,
			"contextmenu",
			(e: MouseEvent) => {
				e.preventDefault();
				this.statusTimer.stop();
			},
		);

		this.renderers = [];
		for (const [name, mode] of [
			["flowtime-today", "today"],
			["flowtime-overdue", "overdue"],
			["flowtime-dueweek", "dueweek"],
			["flowtime-weekly", "weekly"],
			["flowtime-soon", "soon"],
			["flowtime-project", "project"],
			["flowtime-buckets", "budget"],
			["flowtime-sessions", "sessions"],
			["flowtime-sprints", "sprints"], // v0.6.0
		] as Array<[string, string]>) {
			this.registerMarkdownCodeBlockProcessor(
				name,
				(_src: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
					const r = new FlowtimeRenderer(
						this.app,
						el,
						mode as any,
						this.projectEngine,
						ctx.sourcePath,
					);
					r.plugin = this as any;
					this.renderers.push(r);
					ctx.addChild(r);
				},
			);
		}

		// v0.5.0: Weekplan renderer (uses dedicated WeekplanRenderer)
		this.registerMarkdownCodeBlockProcessor(
			"flowtime-weekplan",
			(_src: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				const r = new WeekplanRenderer(
					this.app,
					el,
					this as any,
					this.projectEngine,
					ctx.sourcePath,
				);
				this.renderers.push(r);
				ctx.addChild(r);
			},
		);

		// ── Template Engine Commands ──

		this.addCommand({
			id: "insert-daily-dashboard",
			name: "Insert daily dashboard",
			editorCallback: (_editor: Editor) => {
				insertDaily(this.app, this.settings);
			},
		});

		this.addCommand({
			id: "insert-weekly-dashboard",
			name: "Insert weekly dashboard",
			editorCallback: (_editor: Editor) => {
				insertWeekly(this.app, this.settings);
			},
		});

		this.addCommand({
			id: "insert-weekplan",
			name: "Insert weekplan",
			editorCallback: (_editor: Editor) => {
				insertWeekplan(this.app);
			},
		});

		this.addCommand({
			id: "open-today-note",
			name: "Open Today Note",
			callback: () => {
				this._openTodayNote();
			},
		});

		// ── Create Dashboard commands ──
		this.addCommand({
			id: "create-daily-dashboard",
			name: "Create Daily Dashboard",
			callback: async () => {
				try {
					const result = await createDashboard(this.app, "daily");
					if (result) {
						const file = this.app.vault.getAbstractFileByPath(result);
						if (file)
							await this.app.workspace.getLeaf().openFile(file as TFile);
						this.notify("\u{1F4CB} Created Daily Dashboard");
					} else {
						this.notify("\u{1F4CB} Daily Dashboard already exists", true);
					}
				} catch (e) {
					this.notify(
						"Could not create dashboard: " + (e as Error).message,
						true,
					);
				}
			},
		});

		this.addCommand({
			id: "create-weekly-dashboard",
			name: "Create Weekly Dashboard",
			callback: async () => {
				try {
					const result = await createDashboard(this.app, "weekly");
					if (result) {
						const file = this.app.vault.getAbstractFileByPath(result);
						if (file)
							await this.app.workspace.getLeaf().openFile(file as TFile);
						this.notify("\u{1F4CB} Created Weekly Dashboard");
					} else {
						this.notify("\u{1F4CB} Weekly Dashboard already exists", true);
					}
				} catch (e) {
					this.notify(
						"Could not create dashboard: " + (e as Error).message,
						true,
					);
				}
			},
		});

		this.addCommand({
			id: "new-project",
			name: "New Project",
			callback: () => {
				class ProjectNameModal extends Modal {
					onSubmit: (
						name: string,
						opts: { scaffoldTasks: boolean; scaffoldWiki: boolean },
					) => void;
					scaffoldTasks: boolean = true;
					scaffoldWiki: boolean = true;

					constructor(
						app: App,
						onSubmit: (
							name: string,
							opts: { scaffoldTasks: boolean; scaffoldWiki: boolean },
						) => void,
					) {
						super(app);
						this.onSubmit = onSubmit;
					}
					override onOpen(): void {
						const { contentEl } = this;
						contentEl.createEl("h2", { text: "New Project" });
						contentEl.createEl("p", {
							text: "Creates a new project folder with notes.",
							cls: "flowtime-label",
						});

						const input = contentEl.createEl("input", {
							type: "text",
							placeholder: "Project name",
							cls: "flowtime-input",
						});
						input.style.marginTop = "8px";
						input.focus();

						// Scaffold options
						const hrEl = contentEl.createEl("hr");
						hrEl.style.margin = "12px 0";
						const tasksCb = contentEl.createEl("label", {
							cls: "flowtime-label",
						});
						const tasksCheck = tasksCb.createEl("input", {
							type: "checkbox",
						}) as HTMLInputElement;
						tasksCheck.checked = this.scaffoldTasks;
						tasksCheck.style.marginRight = "6px";
						tasksCheck.addEventListener("change", () => {
							this.scaffoldTasks = tasksCheck.checked;
						});
						tasksCb.append(
							" Create Tasks.md (with flowtime-project block + starter tasks)",
						);

						const wikiCb = contentEl.createEl("label", {
							cls: "flowtime-label",
						});
						const wikiCheck = wikiCb.createEl("input", {
							type: "checkbox",
						}) as HTMLInputElement;
						wikiCheck.checked = this.scaffoldWiki;
						wikiCheck.style.marginRight = "6px";
						wikiCheck.addEventListener("change", () => {
							this.scaffoldWiki = wikiCheck.checked;
						});
						wikiCb.append(" Create Wiki.md (with template sections)");

						const btnRow = contentEl.createEl("div", {
							cls: "flowtime-btn-row",
						});
						const cancelBtn = btnRow.createEl("button", {
							text: "Cancel",
							cls: "flowtime-btn-cancel",
						});
						const createBtn = btnRow.createEl("button", {
							text: "Create",
							cls: "flowtime-btn-submit",
						});

						cancelBtn.addEventListener("click", () => this.close());
						createBtn.addEventListener("click", () => {
							const name = input.value.trim();
							if (name) {
								this.onSubmit(name, {
									scaffoldTasks: this.scaffoldTasks,
									scaffoldWiki: this.scaffoldWiki,
								});
								this.close();
							}
						});
						input.addEventListener("keydown", (e: KeyboardEvent) => {
							if (e.key === "Enter") {
								const name = input.value.trim();
								if (name) {
									this.onSubmit(name, {
										scaffoldTasks: this.scaffoldTasks,
										scaffoldWiki: this.scaffoldWiki,
									});
									this.close();
								}
							}
						});
					}
					override onClose(): void {
						this.contentEl.empty();
					}
				}

				new ProjectNameModal(
					this.app,
					async (
						name: string,
						opts: { scaffoldTasks: boolean; scaffoldWiki: boolean },
					) => {
						try {
							const result = await createProject(
								this.app,
								this.settings,
								name,
								opts,
							);
							const parts = [result.notePath];
							if (result.tasksPath) parts.push(result.tasksPath);
							if (result.wikiPath) parts.push(result.wikiPath);
							this.notify(
								"\u2705 Project created: " +
									name +
									" (" +
									parts.length +
									" files)",
							);
						} catch (e) {
							this.notify(
								"\u274C Failed to create project: " + (e as Error).message,
								true,
							);
						}
					},
				).open();
			},
		});

		// ── Add Bucket Command ──
		this.addCommand({
			id: "add-bucket",
			name: "Add Bucket",
			callback: () => {
				class BucketModal extends Modal {
					plugin: FlowtimePlugin;

					constructor(app: App, plugin: FlowtimePlugin) {
						super(app);
						this.plugin = plugin;
					}
					override onOpen(): void {
						const { contentEl } = this;
						contentEl.createEl("h2", { text: "Add Bucket" });
						contentEl.createEl("p", {
							text: "Create a new time-budget category.",
							cls: "flowtime-label",
						});

						contentEl.createEl("label", {
							text: "Name",
							cls: "flowtime-label",
						});
						const nameInput = contentEl.createEl("input", {
							type: "text",
							placeholder: "e.g. Deep Work",
							cls: "flowtime-input",
						});

						contentEl.createEl("label", {
							text: "Color",
							cls: "flowtime-label",
						});
						const colorInput = contentEl.createEl("input", {
							type: "color",
							value: "#4a9eff",
							cls: "flowtime-input",
						});
						colorInput.style.padding = "2px";
						colorInput.style.width = "60px";

						contentEl.createEl("label", {
							text: "Weekly limit (hours)",
							cls: "flowtime-label",
						});
						const limitInput = contentEl.createEl("input", {
							type: "number",
							value: "10",
							cls: "flowtime-input",
						}) as HTMLInputElement;
						limitInput.min = "1";

						const btnRow = contentEl.createEl("div", {
							cls: "flowtime-btn-row",
						});
						const cancelBtn = btnRow.createEl("button", {
							text: "Cancel",
							cls: "flowtime-btn-cancel",
						});
						const createBtn = btnRow.createEl("button", {
							text: "Create",
							cls: "flowtime-btn-submit",
						});

						cancelBtn.addEventListener("click", () => this.close());
						createBtn.addEventListener("click", async () => {
							const name = nameInput.value.trim();
							if (!name) {
								this.plugin.notify("Name is required", true);
								return;
							}
							const color = colorInput.value;
							const limit = parseInt(limitInput.value, 10);
							if (!limit || limit <= 0) {
								this.plugin.notify("Limit must be > 0", true);
								return;
							}

							const buckets = this.plugin.settings.buckets || [];
							const id = name
								.toLowerCase()
								.replace(/\s+/g, "-")
								.replace(/[^a-z0-9-]/g, "");
							buckets.push({
								id,
								name,
								color,
								weeklyLimit: limit,
								sortOrder: buckets.length,
							});
							this.plugin.settings.buckets = buckets;
							await this.plugin.saveData(this.plugin.settings);
							this.plugin.notify("\u2705 Bucket created: " + name);
							this.close();
						});
					}
					override onClose(): void {
						this.contentEl.empty();
					}
				}
				new BucketModal(this.app, this).open();
			},
		});

		// ── v0.5.0: Routine Engine Commands ──

		this.addCommand({
			id: "generate-routines",
			name: "Generate Routines",
			callback: async () => {
				const count = await this.routineEngine.generateAllDue({
					force: true,
				});
				this.notify(
					"\u{1F501} Generated " +
						count +
						" routine task" +
						(count === 1 ? "" : "s"),
				);
			},
		});

		this.addCommand({
			id: "generate-routines-today",
			name: "Generate Routines for Today",
			callback: async () => {
				const count = await this.routineEngine.generateToday({
					force: true,
				});
				this.notify(
					"\u{1F501} Generated " +
						count +
						" routine task" +
						(count === 1 ? "" : "s") +
						" for today",
				);
			},
		});

		this.addCommand({
			id: "clear-routine-tracking",
			name: "Clear Routine Generation Tracking",
			callback: async () => {
				await this.routineEngine.clearTracking();
				this.notify(
					"\u{1F5D1} Routine tracking cleared. Regenerate to recreate instances.",
				);
			},
		});

		// ── Timer Commands ──
		this.addCommand({
			id: "start-timer",
			name: "Start Timer",
			callback: () => {
				class StartTimerModal extends Modal {
					statusTimer: StatusTimer;
					notifyFn: (msg: string, isError?: boolean) => void;

					constructor(
						app: App,
						statusTimer: StatusTimer,
						notifyFn: (msg: string, isError?: boolean) => void,
					) {
						super(app);
						this.statusTimer = statusTimer;
						this.notifyFn = notifyFn;
					}
					override onOpen(): void {
						const { contentEl } = this;
						contentEl.createEl("h2", { text: "\u23F1 Start Timer" });

						contentEl.createEl("label", {
							text: "Task name",
							cls: "flowtime-label",
						});
						const nameInput = contentEl.createEl("input", {
							type: "text",
							placeholder: "What are you working on?",
							cls: "flowtime-input",
						});
						nameInput.style.width = "100%";
						nameInput.focus();

						contentEl.createEl("label", {
							text: "Duration (minutes)",
							cls: "flowtime-label",
						});
						const durInput = contentEl.createEl("input", {
							type: "number",
							value: "25",
							cls: "flowtime-input",
						}) as HTMLInputElement;
						durInput.min = "1";
						durInput.style.width = "100px";

						const btnRow = contentEl.createEl("div", {
							cls: "flowtime-btn-row",
						});
						const cancelBtn = btnRow.createEl("button", {
							text: "Cancel",
							cls: "flowtime-btn-cancel",
						});
						const startBtn = btnRow.createEl("button", {
							text: "Start",
							cls: "flowtime-btn-submit",
						});

						cancelBtn.addEventListener("click", () => this.close());
						startBtn.addEventListener("click", () => {
							const name = nameInput.value.trim();
							if (!name) {
								this.notifyFn("Task name is required", true);
								return;
							}
							const minutes = parseInt(durInput.value, 10);
							if (!minutes || minutes < 1) {
								this.notifyFn("Duration must be at least 1 minute", true);
								return;
							}
							this.statusTimer.start(name, minutes * 60);
							this.notifyFn(
								"\u23F1 Started timer: " + name + " (" + minutes + "m)",
							);
							this.close();
						});

						nameInput.addEventListener("keydown", (e: KeyboardEvent) => {
							if (e.key === "Enter") startBtn.click();
						});
					}
					override onClose(): void {
						this.contentEl.empty();
					}
				}
				new StartTimerModal(this.app, this.statusTimer, this.notify).open();
			},
		});

		this.addCommand({
			id: "stop-timer",
			name: "Stop Timer",
			callback: () => {
				if (this.statusTimer.currentTimer) {
					const name = this.statusTimer.currentTimer.taskName;
					this.statusTimer.stop();
					this.notify("\u23F1 Timer stopped: " + name);
				} else {
					this.notify("\u23F1 No active timer", true);
				}
			},
		});

		// ── Onboard / Migrate Command ──
		this.addCommand({
			id: "onboard",
			name: "Onboard / Migrate",
			callback: () => {
				runOnboard(this.app, this);
			},
		});

		// ── v0.4.0: Flowtime: Reset to Defaults ──
		this.addCommand({
			id: "reset-settings",
			name: "Reset to Defaults",
			callback: async () => {
				class ConfirmModal extends Modal {
					onConfirm: () => void;

					constructor(app: App, onConfirm: () => void) {
						super(app);
						this.onConfirm = onConfirm;
					}
					override onOpen(): void {
						const { contentEl } = this;
						contentEl.createEl("h2", {
							text: "Reset Flowtime to Defaults?",
						});
						contentEl.createEl("p", {
							text: "This will clear all settings, buckets, and the task cache. Project files and session data will NOT be affected.",
							cls: "flowtime-label",
						});
						const btnRow = contentEl.createEl("div", {
							cls: "flowtime-btn-row",
						});
						const cancelBtn = btnRow.createEl("button", {
							text: "Cancel",
							cls: "flowtime-btn-cancel",
						});
						const confirmBtn = btnRow.createEl("button", {
							text: "Reset",
							cls: "flowtime-btn-submit",
						});
						confirmBtn.style.background = "var(--text-error)";
						cancelBtn.addEventListener("click", () => this.close());
						confirmBtn.addEventListener("click", () => {
							this.onConfirm();
							this.close();
						});
					}
					override onClose(): void {
						this.contentEl.empty();
					}
				}
				new ConfirmModal(this.app, async () => {
					this.settings = Object.assign({}, DEFAULT_SETTINGS);
					this.taskCache.clear();
					await this.saveData(this.settings);
					// Remove separate cache file if it exists
					try {
						const cachePath = this._cacheFilePath();
						if (await this.app.vault.adapter.exists(cachePath)) {
							await this.app.vault.adapter.remove(cachePath);
						}
					} catch (_) {
						/* ignore */
					}
					this.notify(
						"\u2705 Flowtime reset to defaults. Reload for full effect.",
					);
				}).open();
			},
		});

		// ── v0.4.0: Rebuild Cache Command ──
		this.addCommand({
			id: "rebuild-cache",
			name: "Rebuild Task Cache",
			callback: async () => {
				this.taskCache.clear();
				this.notify(
					"\u{1F504} Cache cleared. It will rebuild on next render.",
				);
			},
		});

		/**
		 * Debounced cache save — writes 2s after last change.
		 */
		this._scheduleCacheSave = (force?: boolean): void => {
			if (force && this._cacheSaveTimer) {
				clearTimeout(this._cacheSaveTimer);
				this._cacheSaveTimer = null;
			}
			if (this._cacheSaveTimer) return;
			this._cacheSaveTimer = setTimeout(
				async () => {
					this._cacheSaveTimer = null;
					try {
						await this._saveTaskCache();
						// Also strip legacy _taskCache from data.json if present
						const data = (await this.loadData()) || {};
						if (data._taskCache) {
							delete (data as Record<string, unknown>)._taskCache;
							await this.saveData(data);
						}
					} catch (_) {
						/* ignore */
					}
				},
				force ? 0 : 2000,
			);
		};

		// Save cache on unload as well
		this.register(() => {
			if (this._cacheSaveTimer) {
				clearTimeout(this._cacheSaveTimer);
				this._cacheSaveTimer = null;
			}
			if (this._dailyGenTimer) {
				clearTimeout(this._dailyGenTimer);
				this._dailyGenTimer = null;
			}
			// Clean up content width preset classes
			document.body.classList.remove(
				"ft-wide-s",
				"ft-wide-m",
				"ft-wide-l",
				"ft-wide-xl",
			);
		});

		// v1.3.0: ListEnhancer — interactive markdown task notes
		// Re-aggregation callback: refreshes mobile file after source changes
		this.onHeadingDrop = async () => {
			const file = this.app.workspace.getActiveFile();
			if (file && this._isMobileAggregateFile(file)) {
				const { refreshAll } = await import("./task-aggregator");
				await refreshAll(this.app, file, this, file.path);
			}
		};
		this.listEnhancer = new ListEnhancer(this.app, this);

		// v1.4.0: Tab history — navigate back to previous tab on close
		let _prevLeafFile: string | null = null;
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				this.listEnhancer.check();

				if (!this.settings.tabHistoryEnabled) return;

				const newFile = (leaf?.view as MarkdownView | null)?.file;
				const newPath = newFile?.path || null;

				// Detect tab close: if the previously active file is no longer open in any leaf
				if (_prevLeafFile && _prevLeafFile !== newPath) {
				const stillOpen = this.app.workspace.getLeavesOfType("markdown")
					.some((l) => (l.view as MarkdownView)?.file?.path === _prevLeafFile);
					if (!stillOpen && this._tabHistory.length > 0) {
						// Pop history (skip self) and navigate back
						let backPath: string | null = null;
						while (this._tabHistory.length > 0) {
							const candidate = this._tabHistory.pop()!;
							if (candidate !== _prevLeafFile) {
								backPath = candidate;
								break;
							}
						}
						if (backPath) {
							const backFile = this.app.vault.getAbstractFileByPath(backPath);
							if (backFile) {
								// If back-file is already open in a leaf, focus it; otherwise open in active leaf
								const existingLeaf = this.app.workspace.getLeavesOfType("markdown")
									.find((l) => (l.view as MarkdownView)?.file?.path === backPath);
								if (existingLeaf) {
									this.app.workspace.setActiveLeaf(existingLeaf);
								} else {
									this.app.workspace.getLeaf().openFile(backFile as TFile);
								}
							}
						}
					}
				}

				// Push current file to history (deduplicate: remove old entry if re-entering)
				if (newPath && (!this._tabHistory.length || this._tabHistory[this._tabHistory.length - 1] !== newPath)) {
					// Remove any prior occurrence so switching back doesn't create duplicates
					const prevIdx = this._tabHistory.lastIndexOf(newPath);
					if (prevIdx >= 0 && prevIdx !== this._tabHistory.length - 1) {
						this._tabHistory.splice(prevIdx, 1);
					}
					this._tabHistory.push(newPath);
					if (this._tabHistory.length > this._tabHistoryMax) {
						this._tabHistory.shift();
					}
				}

				_prevLeafFile = newPath;
			}),
		);
		this.app.workspace.onLayoutReady(() => {
			this.listEnhancer.check();
		});

		// v1.5.0: Mobile markdown view — auto-aggregate tasks on file open
		this.registerEvent(
			this.app.workspace.on("file-open", async (file) => {
				if (!file || !this._isMobileAggregateFile(file)) return;
				const { refreshAll } = await import("./task-aggregator");
				await refreshAll(this.app, file, this, file.path);
				// Re-enhance after aggregation writes to file
				setTimeout(() => this.listEnhancer.check(), 300);
			}),
		);
	}

	_isMobileAggregateFile(file: TFile): boolean {
		// Check frontmatter via metadata cache
		const cache = this.app.metadataCache.getCache(file.path);
		const fm = cache?.frontmatter as Record<string, unknown> | undefined;
		if (fm?.type === "flowtime-list" || fm?.type === "flowtime-mobile") return true;
		// Fallback: check raw content for frontmatter (cache may not be ready yet)
		if (!cache) return file.path.endsWith("mobile.md") || file.basename.includes("mobile");
		return false;
	}

	/**
	 * Aggregate tasks using the exact same loadTasks() logic as FlowtimeRenderer.
	 * Creates a hidden renderer instance, runs its loadTasks, returns tasks.
	 * Guarantees identical results to the table/list views.
	 */
	async aggregateTasksForMode(modeStr: string, sourcePath?: string): Promise<TaskRow[]> {
		const { FlowtimeRenderer } = await import("./renderer");
		const hidden = createDiv();
		const r = new (FlowtimeRenderer as any)(
			this.app,
			hidden,
			modeStr,
			this.projectEngine,
			sourcePath || "",
		) as FlowtimeRenderer;
		r.plugin = this as any;
		await (r as any).loadTasks();
		return (r as any).tasks || [];
	}

	/**
	 * v0.7.0: Ensure the sessions directory exists in the plugin folder.
	 * Migrates any leftover data from the old vault-root flowtime/ location
	 * and cleans up the empty parent folder.
	 */
	async _ensureSessionDir(): Promise<void> {
		const sessionDir =
			this.app.vault.configDir + "/plugins/flowtime/sessions";
		try {
			if (!(await this.app.vault.adapter.exists(sessionDir))) {
				await this.app.vault.createFolder(sessionDir);
			}

			// v0.7.0: Migrate old flowtime/sessions/ — copy files, then purge originals
			const oldDir = "flowtime/sessions";
			if (await this.app.vault.adapter.exists(oldDir)) {
				let count = 0;
				const listing = await this.app.vault.adapter.list(oldDir);
				for (const f of listing.files) {
					const content = await this.app.vault.adapter.read(f);
					const newPath = sessionDir + "/" + f.split("/").pop();
					await this.app.vault.adapter.write(newPath, content);
					await this.app.vault.adapter.remove(f);
					count++;
				}
				// Remove now-empty directory
				await this.app.vault.adapter.rmdir(oldDir, false);
				if (count > 0) {
					this.notify(
						"\u{1F4C1} Migrated " +
							count +
							" session file(s) to plugin folder",
					);
				}
			}

			// v0.7.0: Purge any remaining empty flowtime/ tree
			await this._purgeFlowtime();
		} catch (e) {
			console.warn(
				"Flowtime: Could not ensure sessions directory:",
				(e as Error).message,
			);
		}
	}

	/**
	 * Recursively nuke the old flowtime/ tree if it's empty of .md files
	 * (only plugin debris like empty dirs + .ndjson leftovers).
	 */
	async _purgeFlowtime(): Promise<void> {
		try {
			const root = "flowtime";
			if (!(await this.app.vault.adapter.exists(root))) return;

			// Walk subdirs and remove any orphaned files + empty dirs
			for (const sub of [root + "/routines", root + "/sessions"]) {
				try {
					if (await this.app.vault.adapter.exists(sub)) {
						const list = await this.app.vault.adapter.list(sub);
						for (const f of list.files)
							await this.app.vault.adapter.remove(f);
						await this.app.vault.adapter.rmdir(sub, false);
					}
				} catch (_) {
					/* ignore */
				}
			}

			// Nuke root if nothing left
			const rootList = await this.app.vault.adapter.list(root);
			if (rootList.files.length === 0 && rootList.folders.length === 0) {
				await this.app.vault.adapter.rmdir(root, false);
			}
		} catch (_) {
			/* ignore */
		}
	}

	/**
	 * v0.8.0: Schedule twice-daily routine generation at 6 AM and 6 PM.
	 *
	 * Uses a self-rescheduling setTimeout chain. Each fire calculates ms until
	 * the next target time so long-running Obsidian sessions still get new
	 * routine tasks every day without requiring a restart.
	 */
	_scheduleDailyGenerations(): void {
		if (this._dailyGenTimer) {
			clearTimeout(this._dailyGenTimer);
		}

		const now = new Date();
		const hour = now.getHours();
		const target = new Date(now);

		if (hour < 6) {
			// Next is 6 AM today
			target.setHours(6, 0, 0, 0);
		} else if (hour < 18) {
			// Next is 6 PM today
			target.setHours(18, 0, 0, 0);
		} else {
			// Next is 6 AM tomorrow
			target.setDate(target.getDate() + 1);
			target.setHours(6, 0, 0, 0);
		}

		const delay = Math.max(0, target.getTime() - now.getTime());

		this._dailyGenTimer = setTimeout(async () => {
			this._dailyGenTimer = null;
			try {
				const count = await this.routineEngine.generateAllDue();
				if (count > 0 && !this.settings.quietMode) {
					this.notify(
						"\u{1F501} Generated " +
							count +
							" routine task" +
							(count === 1 ? "" : "s"),
					);
				}
			} catch (e) {
				console.warn("Flowtime: Daily gen error:", (e as Error).message);
			}
			// Re-schedule for the next 6 AM or 6 PM
			this._scheduleDailyGenerations();
		}, delay);
	}

	/**
	 * v0.7.0: Silently ensure daily notes folder from .obsidian/daily-notes.json
	 * exists. No-op if not configured or already present — only creates (once)
	 * if configured but missing. Never shows a notification.
	 */
	async _ensureDailyNotesFolder(): Promise<void> {
		try {
			const dailyNotesPath =
				this.app.vault.configDir + "/daily-notes.json";
			if (!(await this.app.vault.adapter.exists(dailyNotesPath))) return;
			const content = await this.app.vault.adapter.read(dailyNotesPath);
			const config = JSON.parse(content);
			const folder = config.folder;
			if (!folder) return;
			if (!(await this.app.vault.adapter.exists(folder))) {
				await this.app.vault.createFolder(folder);
			}
		} catch (_) {
			/* ignore */
		}
	}

	/**
	 * Ensure the inbox file exists (used by inbox processor modal, not auto-created).
	 */
	async _ensureInbox(): Promise<void> {
		const path = this.settings.inboxPath || "Inbox.md";
		try {
			if (!(await this.app.vault.adapter.exists(path))) {
				const template = `# \u{1F4E5} Inbox

Capture tasks, ideas, and notes here. One line per item.
Process them with **Flowtime: Process Inbox**.
`;
				await this.app.vault.create(path, template);
				this.notify("\u{1F4E5} Created inbox: " + path);
			}
		} catch (e) {
			console.warn("Flowtime: Could not create inbox:", (e as Error).message);
		}
	}

	/**
	 * Open or reveal the Today note in a new leaf.
	 * v0.6.0
	 */
	async _openTodayNote(): Promise<void> {
		try {
			const path = this.settings.todayNotePath || "Today.md";
			// Ensure it exists
			await createToday(this.app, path);
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file) {
				await this.app.workspace.getLeaf().openFile(file as TFile);
			}
		} catch (e) {
			this.notify(
				"Could not open Today note: " + (e as Error).message,
				true,
			);
		}
	}
}
