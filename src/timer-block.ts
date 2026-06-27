/**
 * TimerBlock — visual circular countdown timer displayed via markdown block.
 *
 * Usage: ```flowtime-timer
 * ```
 *
 * Renders an SVG circle that counts down with remaining time in the center.
 * Supports task selection, pomodoro mode, and full timer controls.
 * Subscribes to the global TimerManager for synchronized state.
 */

import { MarkdownRenderChild } from "obsidian";
import type { App, TFile } from "obsidian";
import { formatTimer } from "./task-parser";
import type {
  FlowtimeSettings,
  GlobalTimerState,
  TimerTaskRef,
  PomodoroConfig,
} from "./types";

/* ─── Plugin reference (extends MarkdownRenderChild for context) ─── */

interface TimerManagerRef {
  start(
    taskRef: { filePath: string; line: number; taskText: string; bucket?: string },
    durationSeconds: number,
    pomodoro?: PomodoroConfig,
  ): void;
  pause(): void;
  resume(): void;
  stop(): void;
  skip(): void;
  getState(): GlobalTimerState;
  subscribe(fn: (state: GlobalTimerState) => void): () => void;
  isActive(): boolean;
}

interface FlowtimePluginRef {
  settings: FlowtimeSettings;
  app: App;
  notify?: (msg: string, isError?: boolean) => void;
  timerManager?: TimerManagerRef;
  /** Aggregate today's tasks programmatically */
  aggregateTasksForMode?(
    mode: string,
    sourcePath?: string,
  ): Promise<Array<{ cleanText: string; rawText: string; file: TFile; line: number; bucket?: string; durationMinutes: number }>>;
}

/* ═══════════════════════════════════════════════════════════════════
   TimerBlock — MarkdownRenderChild that renders the visual timer
   ═══════════════════════════════════════════════════════════════════ */

export class TimerBlock extends MarkdownRenderChild {
  declare plugin: FlowtimePluginRef;
  declare app: App;
  sourcePath: string;

  _unsubscribe: (() => void) | null = null;
  _todayTasks: Array<{
    cleanText: string;
    rawText: string;
    file: TFile;
    line: number;
    bucket?: string;
    durationMinutes: number;
  }> = [];
  _loaded: boolean = false;
  _selectedTask: {
    cleanText: string;
    file: TFile;
    line: number;
    bucket?: string;
    durationMinutes: number;
  } | null = null;

  constructor(
    app: App,
    containerEl: HTMLElement,
    plugin: FlowtimePluginRef,
    sourcePath: string,
  ) {
    super(containerEl);
    this.app = app;
    this.plugin = plugin;
    this.sourcePath = sourcePath;
  }

  private get _doc(): Document {
    return this.containerEl?.ownerDocument ?? document;
  }

  override async onload(): Promise<void> {
    await this._loadTodayTasks();
    this._render();
    this._subscribe();
    this._loaded = true;
  }

  override onunload(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  /* ── Load today's tasks ── */

  async _loadTodayTasks(): Promise<void> {
    try {
      if (this.plugin.aggregateTasksForMode) {
        const tasks = await this.plugin.aggregateTasksForMode("today", this.sourcePath);
        this._todayTasks = (tasks || [])
          .filter((t) => t.cleanText && t.file)
          .map((t) => ({
            cleanText: t.cleanText,
            rawText: t.rawText || t.cleanText,
            file: t.file,
            line: t.line,
            bucket: t.bucket,
            durationMinutes: t.durationMinutes || 25,
          }));
      }
    } catch (_) {
      this._todayTasks = [];
    }
  }

  /* ── Render ── */

  _render(): void {
    const el = this.containerEl;
    el.empty();
    el.addClass("ft-timer-block");

    const state = this.plugin?.timerManager?.getState?.() as GlobalTimerState | null;
    const hasTimer = !!(state?.taskRef);

    // ── Header ──
    const header = el.createEl("div", { cls: "ft-timer-header" });
    header.createEl("span", {
      text: "\u23F1 Timer",
      cls: "ft-timer-title",
    });

    // ── Task selector ──
    const selector = el.createEl("div", { cls: "ft-timer-selector" });
    this._buildTaskSelector(selector, state);

    // ── Circle timer ──
    const circleWrap = el.createEl("div", { cls: "ft-timer-circle-wrap" });
    this._buildCircle(circleWrap, state);

    // ── Pomodoro info ──
    if (state?.pomodoro) {
      this._buildPomodoroInfo(el, state);
    }

    // ── Controls ──
    const controls = el.createEl("div", { cls: "ft-timer-controls" });
    this._buildControls(controls, state);

    // ── Task name display ──
    if (state?.taskRef) {
      const nameEl = el.createEl("div", { cls: "ft-timer-task-name" });
      nameEl.createEl("span", {
        text: state.taskRef.taskText,
        cls: "ft-timer-task-text",
      });
    } else if (!hasTimer && this._todayTasks.length === 0) {
      const emptyEl = el.createEl("div", { cls: "ft-timer-empty" });
      emptyEl.createEl("p", {
        text: "No tasks assigned for today.",
        cls: "ft-timer-empty-text",
      });
    }
  }

  _buildTaskSelector(
    container: HTMLElement,
    state: GlobalTimerState | null,
  ): void {
    if (state?.taskRef) return; // Timer active — no selector needed

    if (this._todayTasks.length === 0) {
      container.createEl("p", {
        text: "Add tasks to today to use the timer.",
        cls: "ft-timer-hint",
      });
      return;
    }

    const _label = container.createEl("label", {
      text: "Select a task:",
      cls: "ft-timer-label",
    });

    const select = container.createEl("select", { cls: "ft-timer-task-select" });
    select.createEl("option", { text: "-- choose a task --", value: "" });

    // Pre-select currently selected task
    for (const task of this._todayTasks) {
      const opt = select.createEl("option", {
        text: task.cleanText,
        value: String(this._todayTasks.indexOf(task)),
      });
      if (
        this._selectedTask &&
        this._selectedTask.file.path === task.file.path &&
        this._selectedTask.line === task.line
      ) {
        opt.selected = true;
      }
    }

    select.addEventListener("change", () => {
      const idx = parseInt(select.value, 10);
      if (idx >= 0 && idx < this._todayTasks.length) {
        const t = this._todayTasks[idx];
        this._selectedTask = {
          cleanText: t.cleanText,
          file: t.file,
          line: t.line,
          bucket: t.bucket,
          durationMinutes: t.durationMinutes || 25,
        };
      } else {
        this._selectedTask = null;
      }
    });

    if (this._selectedTask) {
      const idx = this._todayTasks.findIndex(
        (t) =>
          t.file.path === this._selectedTask!.file.path &&
          t.line === this._selectedTask!.line,
      );
      if (idx >= 0) select.value = String(idx);
    }
  }

  _buildCircle(
    container: HTMLElement,
    state: GlobalTimerState | null,
  ): void {
    const remaining = state?.remaining ?? 0;
    const total = state?.total ?? 0;
    const pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;

    // SVG circle dimensions
    const size = 200;
    const strokeW = 10;
    const radius = (size - strokeW) / 2;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - pct);

    // Color: normal → warning (≤20%) → expired
    let strokeColor = "var(--interactive-accent)";
    if (pct <= 0) strokeColor = "var(--text-error)";
    else if (pct <= 0.2) strokeColor = "var(--text-warning)";

    // Pomodoro break color
    if (state?.pomodoro?.onBreak) {
      strokeColor = "var(--color-green)";
    }

    const svg = container.createEl("div", { cls: "ft-timer-svg-wrap" });
    svg.innerHTML = `
      <svg viewBox="0 0 ${size} ${size}" class="ft-timer-svg">
        <!-- Background circle -->
        <circle
          cx="${size / 2}" cy="${size / 2}" r="${radius}"
          fill="none"
          stroke="var(--background-modifier-border)"
          stroke-width="${strokeW}"
        />
        <!-- Progress circle -->
        <circle
          cx="${size / 2}" cy="${size / 2}" r="${radius}"
          fill="none"
          stroke="${strokeColor}"
          stroke-width="${strokeW}"
          stroke-linecap="round"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${dashOffset}"
          transform="rotate(-90 ${size / 2} ${size / 2})"
          class="ft-timer-progress-circle"
        />
      </svg>
    `;

    // Time display in center (overlay on SVG)
    const timeDisplay = container.createEl("div", { cls: "ft-timer-time" });
    const timeVal = timeDisplay.createEl("span", {
      text: formatTimer(remaining),
      cls: "ft-timer-time-val",
    });
    if (remaining <= 0 && total > 0) {
      timeVal.addClass("ft-timer-expired");
    }

    // Pomodoro session indicator
    if (state?.pomodoro) {
      const sessionDot = timeDisplay.createEl("span", {
        text: state.pomodoro.onBreak
          ? `\u2615 Break ${state.pomodoro.completedSessions}/${state.pomodoro.totalSessions || "?"}`
          : `\u25CF Session ${state.pomodoro.completedSessions + 1}`,
        cls: "ft-timer-session-indicator",
      });
      if (state.pomodoro.onBreak) sessionDot.addClass("ft-timer-break");
    }

    if (!state?.isRunning && remaining > 0) {
      timeDisplay.addClass("ft-timer-paused");
    }

    // Running animation class
    if (state?.isRunning) {
      svg.addClass("ft-timer-running");
    }
  }

  _buildPomodoroInfo(
    container: HTMLElement,
    state: GlobalTimerState,
  ): void {
    const p = state.pomodoro;
    if (!p) return;

    const info = container.createEl("div", { cls: "ft-timer-pomodoro-info" });
    if (p.onBreak) {
      info.createEl("span", {
        text: `\u2615 Break — ${formatTimer(state.remaining)} remaining`,
        cls: "ft-timer-pomodoro-break",
      });
    } else {
      info.createEl("span", {
        text: `\u{1F345} Session ${p.completedSessions + 1} — ${p.sessionMinutes}m focus`,
        cls: "ft-timer-pomodoro-session",
      });
    }
  }

  _buildControls(
    container: HTMLElement,
    state: GlobalTimerState | null,
  ): void {
    const tm = this.plugin?.timerManager;
    if (!tm) return;

    const hasTimer = !!(state?.taskRef);
    const isRunning = !!(state?.isRunning);
    const hasPomodoro = !!(state?.pomodoro);

    // Start button (only when no active timer but task selected)
    if (!hasTimer) {
      const startBtn = container.createEl("button", {
        text: "\u25B6 Start",
        cls: "ft-timer-btn ft-timer-btn-start",
      });
      startBtn.addEventListener("click", () => {
        this._startSelectedTask();
      });
      if (!this._selectedTask) {
        startBtn.disabled = true;
        startBtn.addClass("ft-timer-btn-disabled");
      }
      return;
    }

    // Active timer controls
    if (isRunning) {
      // Pause
      const pauseBtn = container.createEl("button", {
        text: "\u23F8 Pause",
        cls: "ft-timer-btn ft-timer-btn-pause",
      });
      pauseBtn.addEventListener("click", () => {
        tm.pause();
      });

      // Skip (pomodoro only)
      if (hasPomodoro) {
        const skipBtn = container.createEl("button", {
          text: "\u23ED Skip",
          cls: "ft-timer-btn ft-timer-btn-skip",
        });
        skipBtn.addEventListener("click", () => {
          tm.skip();
        });
      }
    } else {
      // Resume
      const resumeBtn = container.createEl("button", {
        text: "\u25B6 Resume",
        cls: "ft-timer-btn ft-timer-btn-resume",
      });
      resumeBtn.addEventListener("click", () => {
        tm.resume();
      });

      // Skip (pomodoro only, even when paused)
      if (hasPomodoro) {
        const skipBtn = container.createEl("button", {
          text: "\u23ED Skip",
          cls: "ft-timer-btn ft-timer-btn-skip",
        });
        skipBtn.addEventListener("click", () => {
          tm.skip();
        });
      }
    }

    // Stop (always present when timer exists)
    const stopBtn = container.createEl("button", {
      text: "\u23F9 Stop",
      cls: "ft-timer-btn ft-timer-btn-stop",
    });
    stopBtn.addEventListener("click", () => {
      this._stopTimer();
    });
  }

  /* ── Actions ── */

  _startSelectedTask(): void {
    const task = this._selectedTask;
    const tm = this.plugin?.timerManager;
    if (!task || !tm) return;

    const pomodoro = this.plugin.settings.pomodoroEnabled
      ? ({
          enabled: true,
          sessionMinutes: this.plugin.settings.pomodoroSessionMinutes,
          breakMinutes: this.plugin.settings.pomodoroBreakMinutes,
          longBreakMinutes: this.plugin.settings.pomodoroLongBreakMinutes,
          sessionsBeforeLongBreak:
            this.plugin.settings.pomodoroSessionsBeforeLongBreak,
        } as PomodoroConfig)
      : undefined;

    const taskRef: TimerTaskRef = {
      filePath: task.file.path,
      line: task.line,
      taskText: task.cleanText,
      bucket: task.bucket,
    };

    tm.start(taskRef, task.durationMinutes * 60, pomodoro);
  }

  _stopTimer(): void {
    const tm = this.plugin?.timerManager;
    if (!tm) return;
    const taskText = tm.getState().taskRef?.taskText || "timer";
    tm.stop();
    if (this.plugin?.notify) {
      this.plugin.notify(`\u2705 Timer stopped: ${taskText}`);
    }
  }

  /* ── Subscription to global state ── */

  _subscribe(): void {
    const tm = this.plugin?.timerManager;
    if (!tm) return;

    this._unsubscribe = tm.subscribe(() => {
      if (this._loaded) {
        this._render();
      }
    });
  }
}
