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

export class StatusTimer {
  statusBarItem: HTMLElement;
  settings: FlowtimeSettings;
  notify: (msg: string, isError?: boolean) => void;
  onSessionEnd: (data: SessionData) => Promise<void>;
  onTimerStop: () => void;
  currentTimer: TimerData | null = null;
  private _currentTaskName: string = "";
  private _startTime: Date | null = null;
  private _sessionRecorded: boolean = false;

  constructor(opts: StatusTimerOpts) {
    this.statusBarItem = opts.statusBarItem;
    this.settings = opts.settings;
    this.notify = opts.notify;
    this.onSessionEnd = opts.onSessionEnd;
    this.onTimerStop = opts.onTimerStop;

    this.statusBarItem.addClass("flowtime-status-timer");
    this.updateDisplay();
  }

  start(taskName: string, totalSeconds: number): void {
    this.stop();
    this._currentTaskName = taskName;
    this._startTime = new Date();
    this._sessionRecorded = false;

    this.currentTimer = {
      taskName,
      remaining: totalSeconds,
      total: totalSeconds,
      interval: null,
    };

    this.currentTimer.interval = setInterval(() => {
      this.currentTimer!.remaining--;
      this.updateDisplay();

      if (this.currentTimer!.remaining <= 0) {
        this.stop();
        this.notify("⏰ Time's up! " + taskName);
      }
    }, 1000);

    this.updateDisplay();
  }

  stop(): void {
    if (this.currentTimer?.interval) {
      clearInterval(this.currentTimer.interval);
    }
    const hadTimer = !!this.currentTimer;
    if (this.currentTimer && !this._sessionRecorded) {
      this._sessionRecorded = true;
      if (this.onSessionEnd && this._startTime) {
        const now = new Date();
        this.onSessionEnd({
          taskText: this._currentTaskName,
          startTime: this._startTime.toISOString(),
          endTime: now.toISOString(),
          durationMinutes: Math.round((now.getTime() - this._startTime.getTime()) / 60000),
        });
      }
    }
    if (hadTimer && this.onTimerStop) {
      this.onTimerStop();
    }
    this.currentTimer = null;
    this.updateDisplay();
  }

  pause(): void {
    if (this.currentTimer?.interval) {
      clearInterval(this.currentTimer.interval);
      this.currentTimer.interval = null;
    }
    this.updateDisplay();
  }

  toggle(): void {
    if (!this.currentTimer) return;

    if (this.currentTimer.interval) {
      clearInterval(this.currentTimer.interval);
      this.currentTimer.interval = null;
    } else if (this.currentTimer.remaining > 0) {
      this.currentTimer.interval = setInterval(() => {
        this.currentTimer!.remaining--;
        this.updateDisplay();

        if (this.currentTimer!.remaining <= 0) {
          this.stop();
          this.notify("⏰ Time's up! " + this.currentTimer!.taskName);
        }
      }, 1000);
    }

    this.updateDisplay();
  }

  getState(): TimerState | null {
    if (!this.currentTimer) return null;
    return {
      taskName: this.currentTimer.taskName,
      remaining: this.currentTimer.remaining,
      total: this.currentTimer.total,
      isRunning: !!this.currentTimer.interval,
    };
  }

  updateDisplay(): void {
    if (!this.settings.statusBarTimer) {
      this.statusBarItem.setText("");
      return;
    }

    if (!this.currentTimer) {
      this.statusBarItem.setText("⏱ --");
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

    const icon = this.currentTimer.interval ? "⏸" : "▶";
    const name =
      this.currentTimer.taskName.length > 30
        ? this.currentTimer.taskName.slice(0, 27) + "\u2026"
        : this.currentTimer.taskName;

    this.statusBarItem.setText(`⏱ ${fmt(this.currentTimer.remaining)} \u2014 ${name}  ${icon}`);
  }
}
