class StatusTimer {
	constructor({ statusBarItem, settings, notify }) {
		this.statusBarItem = statusBarItem;
		this.settings = settings;
		this.notify = notify;
		this.currentTimer = null;

		this.statusBarItem.addClass("flowtime-status-timer");
		this.updateDisplay();
	}

	start(taskName, totalSeconds) {
		this.stop();

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
		this.currentTimer = null;
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
