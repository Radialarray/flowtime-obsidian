/**
 * StatusTimer — status bar display for the global timer.
 *
 * v2.0 Refactored to subscribe to TimerManager (global state) instead of
 * managing its own interval. Provides backward-compatible API for
 * command-modal ad-hoc timer creation.
 */

import type { FlowtimeSettings, GlobalTimerState } from "./types";

/* ─── TimerManager interface (subset used by StatusTimer) ─── */

interface TimerManagerRef {
  start(
    taskRef: { filePath: string; line: number; taskText: string; bucket?: string },
    durationSeconds: number,
    pomodoro?: { enabled: boolean; sessionMinutes: number; breakMinutes: number; longBreakMinutes: number; sessionsBeforeLongBreak: number },
  ): void;
  pause(): void;
  resume(): void;
  stop(): void;
  getState(): GlobalTimerState;
  subscribe(fn: (state: GlobalTimerState) => void): () => void;
  isActive(): boolean;
}

/* ─── Public API types ─── */

interface TimerData {
  taskName: string;
  remaining: number;
  total: number;
  interval: ReturnType<typeof setInterval> | null;
}

interface TimerState {
  taskName: string;
  remaining: number;
  total: number;
  isRunning: boolean;
}

interface StatusTimerOpts {
  statusBarItem: HTMLElement;
  settings: FlowtimeSettings;
  notify: (msg: string, isError?: boolean) => void;
  timerManager: TimerManagerRef;
}

/* ─── Factory ─── */

export function createStatusTimer(opts: StatusTimerOpts): {
  /** Start an ad-hoc timer (no file reference) — for command-modal backward compat */
  start(taskName: string, totalSeconds: number): void;
  stop(): void;
  pause(): void;
  toggle(): void;
  getState(): TimerState | null;
  updateDisplay(): void;
  statusBarItem: HTMLElement;
  /** Current timer data for backward compat (check if timer is active) */
  currentTimer: TimerData | null;
  settings: FlowtimeSettings;
  notify: (msg: string, isError?: boolean) => void;
  destroy(): void;
} {
  const { statusBarItem, settings, notify, timerManager } = opts;

  let _cached: TimerData | null = null;
  let _unsubscribe: (() => void) | null = null;

  /* ── Helpers ── */

  function _fmt(sec: number): string {
    if (sec <= 0) return "00:00";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0)
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  /* ── Display update (called by subscription) ── */

  function _onState(s: GlobalTimerState): void {
    if (!s.taskRef || s.total <= 0) {
      _cached = null;
    } else {
      _cached = {
        taskName: s.taskRef.taskText,
        remaining: s.remaining,
        total: s.total,
        interval: s.isRunning ? (1 as unknown as ReturnType<typeof setInterval>) : null,
      };
    }
    updateDisplay();
  }

  /* ── Public methods ── */

  function start(taskName: string, totalSeconds: number): void {
    timerManager.start(
      { filePath: "", line: -1, taskText: taskName },
      totalSeconds,
    );
  }

  function stop(): void {
    const state = timerManager.getState();
    const taskText = state.taskRef?.taskText || "unknown";
    const elapsed = Math.round((state.total - state.remaining) / 60) || 0;
    timerManager.stop();
    if (elapsed > 0) {
      notify(`\u23F1 Timer stopped: ${taskText} (${elapsed}m)`);
    } else {
      notify(`\u23F1 Timer stopped: ${taskText}`);
    }
  }

  function pause(): void {
    timerManager.pause();
  }

  function toggle(): void {
    const state = timerManager.getState();
    if (!state.taskRef) return;
    if (state.isRunning) {
      timerManager.pause();
    } else {
      timerManager.resume();
    }
  }

  function getState(): TimerState | null {
    if (!_cached) return null;
    return {
      taskName: _cached.taskName,
      remaining: _cached.remaining,
      total: _cached.total,
      isRunning: !!_cached.interval,
    };
  }

  function updateDisplay(): void {
    if (!settings.statusBarTimer) {
      statusBarItem.setText("");
      return;
    }

    if (!_cached) {
      statusBarItem.setText("\u23F1 --");
      return;
    }

    const icon = _cached.interval ? "\u23F8" : "\u25B6";
    const name =
      _cached.taskName.length > 30
        ? _cached.taskName.slice(0, 27) + "\u2026"
        : _cached.taskName;

    statusBarItem.setText(
      `\u23F1 ${_fmt(_cached.remaining)} \u2014 ${name}  ${icon}`,
    );
  }

  function destroy(): void {
    if (_unsubscribe) {
      _unsubscribe();
      _unsubscribe = null;
    }
  }

  /* ── Initialize ── */

  statusBarItem.addClass("flowtime-status-timer");
  _unsubscribe = timerManager.subscribe(_onState);
  updateDisplay();

  return {
    start,
    stop,
    pause,
    toggle,
    getState,
    updateDisplay,
    statusBarItem,
    get currentTimer(): TimerData | null { return _cached; },
    settings,
    notify,
    destroy,
  };
}

// Backward-compatible class wrapper
export class StatusTimer {
  declare start: ReturnType<typeof createStatusTimer>["start"];
  declare stop: ReturnType<typeof createStatusTimer>["stop"];
  declare pause: ReturnType<typeof createStatusTimer>["pause"];
  declare toggle: ReturnType<typeof createStatusTimer>["toggle"];
  declare getState: ReturnType<typeof createStatusTimer>["getState"];
  declare updateDisplay: ReturnType<typeof createStatusTimer>["updateDisplay"];
  declare statusBarItem: ReturnType<typeof createStatusTimer>["statusBarItem"];
  declare currentTimer: ReturnType<typeof createStatusTimer>["currentTimer"];
  declare settings: ReturnType<typeof createStatusTimer>["settings"];
  declare notify: ReturnType<typeof createStatusTimer>["notify"];
  declare destroy: ReturnType<typeof createStatusTimer>["destroy"];

  constructor(opts: StatusTimerOpts) {
    const impl = createStatusTimer(opts);
    this.start = impl.start;
    this.stop = impl.stop;
    this.pause = impl.pause;
    this.toggle = impl.toggle;
    this.getState = impl.getState;
    this.updateDisplay = impl.updateDisplay;
    this.statusBarItem = impl.statusBarItem;
    Object.defineProperty(this, "currentTimer", {
      get: () => impl.currentTimer,
      enumerable: true,
      configurable: true,
    });
    this.settings = impl.settings;
    this.notify = impl.notify;
    this.destroy = impl.destroy;
  }
}
