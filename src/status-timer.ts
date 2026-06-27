import type { FlowtimeSettings } from "./types";

interface TimerData {
  taskName: string;
  remaining: number;
  total: number;
  interval: ReturnType<typeof setInterval> | null;
}

interface SessionData {
  taskText: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
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
  onSessionEnd: (data: SessionData) => Promise<void>;
  onTimerStop: () => void;
}

export function createStatusTimer(opts: StatusTimerOpts): {
  start(taskName: string, totalSeconds: number): void;
  stop(): void;
  pause(): void;
  toggle(): void;
  getState(): TimerState | null;
  updateDisplay(): void;
  statusBarItem: HTMLElement;
  currentTimer: TimerData | null;
  settings: FlowtimeSettings;
  notify: (msg: string, isError?: boolean) => void;
  onSessionEnd: (data: SessionData) => Promise<void>;
  onTimerStop: () => void;
} {
  const { statusBarItem, settings, notify, onSessionEnd, onTimerStop } = opts;

  let currentTimer: TimerData | null = null;
  let _currentTaskName: string = "";
  let _startTime: Date | null = null;
  let _sessionRecorded: boolean = false;

  statusBarItem.addClass("flowtime-status-timer");
  updateDisplay();

  function start(taskName: string, totalSeconds: number): void {
    stop();
    _currentTaskName = taskName;
    _startTime = new Date();
    _sessionRecorded = false;

    currentTimer = {
      taskName,
      remaining: totalSeconds,
      total: totalSeconds,
      interval: null,
    };

    currentTimer.interval = window.setInterval(() => {
      currentTimer!.remaining--;
      updateDisplay();

      if (currentTimer!.remaining <= 0) {
        stop();
        notify("\u23F0 Time\u2019s up! " + taskName);
      }
    }, 1000);

    updateDisplay();
  }

  function stop(): void {
    if (currentTimer?.interval) {
      window.clearInterval(currentTimer.interval);
    }
    const hadTimer = !!currentTimer;
    if (currentTimer && !_sessionRecorded) {
      _sessionRecorded = true;
      if (onSessionEnd && _startTime) {
        const now = new Date();
        onSessionEnd({
          taskText: _currentTaskName,
          startTime: _startTime.toISOString(),
          endTime: now.toISOString(),
          durationMinutes: Math.round((now.getTime() - _startTime.getTime()) / 60000),
        });
      }
    }
    if (hadTimer && onTimerStop) {
      onTimerStop();
    }
    currentTimer = null;
    updateDisplay();
  }

  function pause(): void {
    if (currentTimer?.interval) {
      window.clearInterval(currentTimer.interval);
      currentTimer.interval = null;
    }
    updateDisplay();
  }

  function toggle(): void {
    if (!currentTimer) return;

    if (currentTimer.interval) {
      window.clearInterval(currentTimer.interval);
      currentTimer.interval = null;
    } else if (currentTimer.remaining > 0) {
    currentTimer.interval = window.setInterval(() => {
        currentTimer!.remaining--;
        updateDisplay();

        if (currentTimer!.remaining <= 0) {
          stop();
          notify("\u23F0 Time\u2019s up! " + currentTimer!.taskName);
        }
      }, 1000);
    }

    updateDisplay();
  }

  function getState(): TimerState | null {
    if (!currentTimer) return null;
    return {
      taskName: currentTimer.taskName,
      remaining: currentTimer.remaining,
      total: currentTimer.total,
      isRunning: !!currentTimer.interval,
    };
  }

  function updateDisplay(): void {
    if (!settings.statusBarTimer) {
      statusBarItem.setText("");
      return;
    }

    if (!currentTimer) {
      statusBarItem.setText("\u23F1 --");
      return;
    }

    const fmt = (sec: number): string => {
      if (sec <= 0) return "00:00";
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      if (h > 0)
        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };

    const icon = currentTimer.interval ? "\u23F8" : "\u25B6";
    const name =
      currentTimer.taskName.length > 30
        ? currentTimer.taskName.slice(0, 27) + "\u2026"
        : currentTimer.taskName;

    statusBarItem.setText(`\u23F1 ${fmt(currentTimer.remaining)} \u2014 ${name}  ${icon}`);
  }

  return {
    start,
    stop,
    pause,
    toggle,
    getState,
    updateDisplay,
    statusBarItem,
    currentTimer,
    settings,
    notify,
    onSessionEnd,
    onTimerStop,
  };
}

// Backward-compatible class wrapper
export class StatusTimer {
  declare start: ReturnType<typeof createStatusTimer>['start'];
  declare stop: ReturnType<typeof createStatusTimer>['stop'];
  declare pause: ReturnType<typeof createStatusTimer>['pause'];
  declare toggle: ReturnType<typeof createStatusTimer>['toggle'];
  declare getState: ReturnType<typeof createStatusTimer>['getState'];
  declare updateDisplay: ReturnType<typeof createStatusTimer>['updateDisplay'];
  declare statusBarItem: ReturnType<typeof createStatusTimer>['statusBarItem'];
  declare currentTimer: ReturnType<typeof createStatusTimer>['currentTimer'];
  declare settings: ReturnType<typeof createStatusTimer>['settings'];
  declare notify: ReturnType<typeof createStatusTimer>['notify'];
  declare onSessionEnd: ReturnType<typeof createStatusTimer>['onSessionEnd'];
  declare onTimerStop: ReturnType<typeof createStatusTimer>['onTimerStop'];

  constructor(opts: StatusTimerOpts) {
    const impl = createStatusTimer(opts);
    this.start = impl.start;
    this.stop = impl.stop;
    this.pause = impl.pause;
    this.toggle = impl.toggle;
    this.getState = impl.getState;
    this.updateDisplay = impl.updateDisplay;
    this.statusBarItem = impl.statusBarItem;
    this.currentTimer = impl.currentTimer;
    this.settings = impl.settings;
    this.notify = impl.notify;
    this.onSessionEnd = impl.onSessionEnd;
    this.onTimerStop = impl.onTimerStop;
  }
}
