/**
 * TimerManager — global singleton for timer state.
 *
 * Single source of truth for all timer components:
 * - status bar timer
 * - inline row timers (table/list view)
 * - visual timer block (flowtime-timer code block)
 * - weekplan timer buttons
 *
 * State is published to subscribers on every change.
 * Active state is persisted to plugin file so it survives Obsidian restarts.
 */

import type { Vault } from "obsidian";
import type {
  GlobalTimerState,
  TimerTaskRef,
  PomodoroConfig,
  PomodoroRuntime,
} from "./types";

/* ─── Subscriber type ─── */
type Listener = (state: GlobalTimerState) => void;

/* ─── Persistence path ─── */
function stateFilePath(vault: Vault): string {
  return vault.configDir + "/plugins/flowtime/timer-state.json";
}

/* ─── Default (idle) state ─── */
function defaultState(): GlobalTimerState {
  return {
    taskRef: null,
    bucket: null,
    remaining: 0,
    total: 0,
    isRunning: false,
    startedAt: null,
    pomodoro: null,
  };
}
/* ─── Factory ─── */

export interface TimerManagerOpts {
  vault: Vault;
  /** Called when a timer session is completed (stopped or expired).
   *  The caller should persist via SessionStore. */
  onSessionComplete?: (data: {
    taskText: string;
    bucket: string | null;
    startTime: string;
    endTime: string;
    durationMinutes: number;
  }) => Promise<void>;
}

export function createTimerManager(opts: TimerManagerOpts) {
  const { vault, onSessionComplete } = opts;
  const _listeners = new Set<Listener>();
  const _state: GlobalTimerState = defaultState();
  let _intervalId: ReturnType<typeof setInterval> | null = null;
  let _lastTick: number = 0;

  /* ── Internal helpers ── */

  function _notify(): void {
    // Snapshot to avoid mutation during iteration
    const snap = { ..._state, pomodoro: _state.pomodoro ? { ..._state.pomodoro } : null };
    for (const fn of _listeners) {
      try { fn(snap); } catch (_) { /* subscriber error — don't break others */ }
    }
  }

  function _clearInterval(): void {
    if (_intervalId !== null) {
      window.clearInterval(_intervalId);
      _intervalId = null;
    }
  }

  function _recordSession(): void {
    if (!onSessionComplete || !_state.taskRef || !_state.startedAt) return;
    const now = new Date();
    const elapsedSec = Math.max(0, _state.total - _state.remaining);
    const durationMinutes = Math.max(1, Math.round(elapsedSec / 60));
    if (durationMinutes <= 0) return;
    void onSessionComplete({
      taskText: _state.taskRef.taskText,
      bucket: _state.bucket,
      startTime: _state.startedAt,
      endTime: now.toISOString(),
      durationMinutes,
    });
  }

  function _startInterval(): void {
    _clearInterval();
    _lastTick = Date.now();
    _intervalId = window.setInterval(() => {
      const now = Date.now();
      const elapsed = Math.round((now - _lastTick) / 1000);
      _lastTick = now;

      if (!_state.isRunning || _state.remaining <= 0) return;

      _state.remaining = Math.max(0, _state.remaining - elapsed);
      _notify();

      if (_state.remaining <= 0) {
        _onExpiry();
      }
    }, 1000);
  }

  function _onExpiry(): void {
    _clearInterval();
    _state.isRunning = false;
    _recordSession(); // Record completed session

    // Pomodoro: transition to break / next session
    if (_state.pomodoro) {
      const p = _state.pomodoro;
      if (p.onBreak) {
        // Break finished → start next session
        p.onBreak = false;
        p.completedSessions++;
        _state.remaining = p.sessionMinutes * 60;
        _state.total = _state.remaining;
        _state.isRunning = true;
        _startInterval();
        _notify();
        return;
      }
      // Session finished → start break
      p.onBreak = true;
      const isLongBreak =
        p.completedSessions > 0 &&
        p.completedSessions % p.sessionsBeforeLongBreak === 0;
      const breakSec = (isLongBreak ? p.longBreakMinutes : p.breakMinutes) * 60;
      p.breakRemaining = breakSec;
      _state.remaining = breakSec;
      _state.total = breakSec;
      _state.isRunning = true;
      _startInterval();
      _notify();
      return;
    }

    _notify();
  }

  /* ── Public API ── */

  /** Start a countdown timer for a task */
  function start(
    taskRef: TimerTaskRef,
    durationSeconds: number,
    pomodoro?: PomodoroConfig,
  ): void {
    _clearInterval();
    _state.taskRef = taskRef;
    _state.bucket = taskRef.bucket || null;
    _state.remaining = durationSeconds;
    _state.total = durationSeconds;
    _state.isRunning = true;
    _state.startedAt = new Date().toISOString();

    if (pomodoro && pomodoro.enabled) {
      _state.pomodoro = {
        totalSessions: 0, // unknown until done
        completedSessions: 0,
        sessionMinutes: pomodoro.sessionMinutes,
        breakMinutes: pomodoro.breakMinutes,
        longBreakMinutes: pomodoro.longBreakMinutes,
        sessionsBeforeLongBreak: pomodoro.sessionsBeforeLongBreak,
        onBreak: false,
        breakRemaining: 0,
      };
      // Override duration with first pomodoro session
      _state.remaining = pomodoro.sessionMinutes * 60;
      _state.total = _state.remaining;
    } else {
      _state.pomodoro = null;
    }

    _startInterval();
    _notify();
  }

  /** Pause the current timer */
  function pause(): void {
    _clearInterval();
    _state.isRunning = false;
    _notify();
    void _persist();
  }

  /** Resume a paused timer */
  function resume(): void {
    if (_state.remaining <= 0 || _state.isRunning) return;
    _state.isRunning = true;
    _startInterval();
    _notify();
  }

  /** Stop the timer entirely. Records session via onSessionComplete callback. */
  function stop(): void {
    _recordSession();

    _clearInterval();
    _state.taskRef = null;
    _state.bucket = null;
    _state.remaining = 0;
    _state.total = 0;
    _state.isRunning = false;
    _state.startedAt = null;
    _state.pomodoro = null;
    _notify();

    // Persist cleared state
    void _persistInternal(defaultState(), vault);
  }

  /** Skip current pomodoro session — go to next session or break */
  function skip(): void {
    if (!_state.pomodoro) return;

    // If on break, skip to next session
    if (_state.pomodoro.onBreak) {
      _state.pomodoro.onBreak = false;
      _state.pomodoro.completedSessions++;
      _state.remaining = _state.pomodoro.sessionMinutes * 60;
      _state.total = _state.remaining;
      _state.isRunning = true;
      _startInterval();
      _notify();
      return;
    }

    // If on session, skip to break
    _state.pomodoro.onBreak = true;
    const isLongBreak =
      _state.pomodoro.completedSessions > 0 &&
      _state.pomodoro.completedSessions % _state.pomodoro.sessionsBeforeLongBreak === 0;
    const breakSec =
      (isLongBreak ? _state.pomodoro.longBreakMinutes : _state.pomodoro.breakMinutes) * 60;
    _state.pomodoro.breakRemaining = breakSec;
    _state.remaining = breakSec;
    _state.total = breakSec;
    _state.isRunning = true;
    _startInterval();
    _notify();
  }

  /** Get current state snapshot */
  function getState(): GlobalTimerState {
    return {
      ..._state,
      pomodoro: _state.pomodoro ? { ..._state.pomodoro } : null,
    };
  }

  /** Subscribe to state changes. Returns unsubscribe function. */
  function subscribe(fn: Listener): () => void {
    _listeners.add(fn);
    // Immediately notify with current state
    fn(getState());
    return () => {
      _listeners.delete(fn);
    };
  }

  /** Check if a timer is active */
  function isActive(): boolean {
    return !!_state.taskRef;
  }

  /* ── Persistence ── */

  async function _persist(): Promise<void> {
    await _persistInternal(_state, vault);
  }

  /** Save state to plugin file */
  async function saveState(): Promise<void> {
    await _persist();
  }

  /** Load persisted state on startup */
  async function loadState(): Promise<void> {
    try {
      const path = stateFilePath(vault);
      if (await vault.adapter.exists(path)) {
        const raw = await vault.adapter.read(path);
        const saved = JSON.parse(raw) as Partial<GlobalTimerState>;

        // Restore taskRef if present
        if (saved.taskRef && saved.taskRef.filePath && saved.taskRef.taskText) {
          _state.taskRef = saved.taskRef as TimerTaskRef;
          _state.bucket = saved.bucket || null;
          _state.remaining = typeof saved.remaining === "number" ? saved.remaining : 0;
          _state.total = typeof saved.total === "number" ? saved.total : 0;
          _state.isRunning = false; // Always start paused after reload
          _state.startedAt = null;  // Reset startedAt to avoid stale session recording
          _state.pomodoro = saved.pomodoro ? (saved.pomodoro as PomodoroRuntime) : null;
          _notify();
        }

        // Clean up old state file (don't leave stale data)
        await vault.adapter.remove(path);
      }
    } catch (_) {
      /* ignore — start fresh */
    }
  }

  /** Destroy the manager — clear interval and listeners */
  function destroy(): void {
    _clearInterval();
    _listeners.clear();
  }

  return {
    start,
    pause,
    resume,
    stop,
    skip,
    getState,
    subscribe,
    isActive,
    saveState,
    loadState,
    destroy,
  };
}

async function _persistInternal(
  state: GlobalTimerState,
  vault: Vault,
): Promise<void> {
  try {
    const path = stateFilePath(vault);
    // Always remove first to avoid stale state on next load
    if (await vault.adapter.exists(path)) {
      await vault.adapter.remove(path);
    }
    // Only persist if there is an active task
    if (state.taskRef && state.remaining > 0) {
      const data = {
        taskRef: state.taskRef,
        bucket: state.bucket,
        remaining: state.remaining,
        total: state.total,
        isRunning: false, // Always save as paused
        startedAt: null,
        pomodoro: state.pomodoro,
      };
      await vault.adapter.write(path, JSON.stringify(data, null, 2));
    }
  } catch (_) {
    /* best-effort */
  }
}
