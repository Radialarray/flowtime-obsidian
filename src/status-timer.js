class StatusTimer {
	constructor({ statusBarItem, settings, notify, onSessionEnd, onTimerStop }) {
		this.statusBarItem = statusBarItem;
		this.settings = settings;
		this.notify = notify;
		this.onSessionEnd = onSessionEnd;
		this.onTimerStop = onTimerStop;
		this.currentTimer = null;
		this._currentTaskName = "";
		this._startTime = null;
		this._sessionRecorded = false;

		this.statusBarItem.addClass("flowtime-status-timer");
		this.updateDisplay();
	}

	start(taskName, totalSeconds) {
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
			this.currentTimer.remaining--;
			this.updateDisplay();

			if (this.currentTimer.remaining <= 0) {
				this.stop();
				this.notify("⏰ Time's up! " + taskName);
			}
		}, 1000);

		this.updateDisplay();
	}

	stop() {
		if (this.currentTimer?.interval) {
			clearInterval(this.currentTimer.interval);
		}
		// Record session end (avoid double-fire via flag)
		if (this.currentTimer && !this._sessionRecorded) {
			this._sessionRecorded = true;
			if (this.onSessionEnd && this._startTime) {
				const now = new Date();
				this.onSessionEnd({
					taskText: this._currentTaskName,
					startTime: this._startTime.toISOString(),
					endTime: now.toISOString(),
					durationMinutes: Math.round((now - this._startTime) / 60000),
				});
			}
		}
		if (this.onTimerStop) {
			this.onTimerStop();
		}
		this.currentTimer = null;
		this.updateDisplay();
	}

	/**
	 * Pause without recording a session or notifying onTimerStop.
	 * Used when the table timer pauses — the session isn't over.
	 */
	pause() {
		if (this.currentTimer?.interval) {
			clearInterval(this.currentTimer.interval);
			this.currentTimer.interval = null;
		}
		this.updateDisplay();
	}

	toggle() {
		if (!this.currentTimer) return;

		if (this.currentTimer.interval) {
			clearInterval(this.currentTimer.interval);
			this.currentTimer.interval = null;
		} else if (this.currentTimer.remaining > 0) {
			this.currentTimer.interval = setInterval(() => {
				this.currentTimer.remaining--;
				this.updateDisplay();

				if (this.currentTimer.remaining <= 0) {
					this.stop();
					this.notify("⏰ Time's up! " + this.currentTimer.taskName);
				}
			}, 1000);
		}

		this.updateDisplay();
	}

	/**
	 * Get current timer state for table resync after re-render.
	 * Returns null if no timer is active.
	 */
	getState() {
		if (!this.currentTimer) return null;
		return {
			taskName: this.currentTimer.taskName,
			remaining: this.currentTimer.remaining,
			total: this.currentTimer.total,
			isRunning: !!this.currentTimer.interval,
		};
	}

	updateDisplay() {
		if (!this.settings.statusBarTimer) {
			this.statusBarItem.setText("");
			return;
		}

		if (!this.currentTimer) {
			this.statusBarItem.setText("⏱ --");
			return;
		}

		const fmt = (sec) => {
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
				? this.currentTimer.taskName.slice(0, 27) + "…"
				: this.currentTimer.taskName;

		this.statusBarItem.setText(`⏱ ${fmt(this.currentTimer.remaining)} — ${name}  ${icon}`);
	}
}

module.exports = { StatusTimer };
