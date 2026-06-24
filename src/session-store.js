class SessionStore {
	constructor(vault) {
		this.vault = vault;
		this.basePath = "flowtime/sessions";
	}

	async _ensureDir() {
		try {
			// Check if path exists and is a file — remove it so we can create the dir
			const exists = await this.vault.adapter.exists(this.basePath);
			if (exists) {
				const stat = await this.vault.adapter.stat(this.basePath);
				if (stat && stat.type === "file") {
					await this.vault.adapter.remove(this.basePath);
				}
				return; // Already a directory
			}
		} catch (_) {}
		try {
			await this.vault.createFolder(this.basePath);
		} catch (_) {}
	}

	_filePath(date) {
		return `${this.basePath}/${date}.ndjson`;
	}

	async _append(path, line) {
		try {
			await this.vault.adapter.append(path, line);
		} catch (_) {
			await this.vault.adapter.write(path, line);
		}
	}

	/**
	 * v0.4.0: Validate a session record before writing.
	 * Returns null if valid, or an error message string if invalid.
	 */
	_validateRecord(record) {
		if (!record || typeof record !== "object") return "Record must be an object";
		if (!record.type || !["session", "completion"].includes(record.type)) return "Record must have type 'session' or 'completion'";
		if (record.type === "session") {
			if (!record.start_time || typeof record.start_time !== "string") return "Session must have start_time (ISO string)";
			if (!record.end_time || typeof record.end_time !== "string") return "Session must have end_time (ISO string)";
			if (typeof record.duration_minutes !== "number" || record.duration_minutes < 0) return "Session must have duration_minutes (number >= 0)";
		}
		if (record.type === "completion") {
			if (!record.completed_at || typeof record.completed_at !== "string") return "Completion must have completed_at (ISO string)";
		}
		return null; // valid
	}

	/**
	 * Write a session record on timer stop/expiry.
	 */
	async writeSession({ startTime, endTime, durationMinutes, bucket, taskText, notes }) {
		await this._ensureDir();
		const date = startTime ? startTime.split("T")[0] : new Date().toISOString().split("T")[0];
		const record = {
			type: "session",
			date,
			start_time: startTime || new Date().toISOString(),
			end_time: endTime || new Date().toISOString(),
			duration_minutes: typeof durationMinutes === "number" ? durationMinutes : 0,
			bucket: bucket || "",
			task_text: taskText || "",
			notes: notes || "",
		};
		const err = this._validateRecord(record);
		if (err) {
			console.warn("Flowtime: Invalid session record —", err, record);
			return;
		}
		await this._append(this._filePath(date), JSON.stringify(record) + "\n");
	}

	/**
	 * Write a completion record on task checkbox toggle to [x].
	 */
	async writeCompletion({ date, bucket, taskText, completedAt }) {
		await this._ensureDir();
		const record = {
			type: "completion",
			date: date || new Date().toISOString().split("T")[0],
			bucket: bucket || "",
			task_text: taskText || "",
			completed_at: completedAt || new Date().toISOString(),
		};
		const err = this._validateRecord(record);
		if (err) {
			console.warn("Flowtime: Invalid completion record —", err, record);
			return;
		}
		await this._append(this._filePath(date), JSON.stringify(record) + "\n");
	}

	/**
	 * Query session files. Returns array of parsed records.
	 * @param {object} opts — { dateFrom, dateTo, bucket, types, limit }
	 */
	async query(opts = {}) {
		await this._ensureDir();
		const results = [];
		try {
			const listing = await this.vault.adapter.list(this.basePath);
			const files = listing.files
				.filter(f => f.endsWith(".ndjson"))
				.sort();

			for (const filePath of files) {
				// Extract date from filename
				const dateMatch = filePath.match(/(\d{4}-\d{2}-\d{2})\.ndjson$/);
				if (!dateMatch) continue;
				const fileDate = dateMatch[1];

				// Filter by date range
				if (opts.dateFrom && fileDate < opts.dateFrom) continue;
				if (opts.dateTo && fileDate > opts.dateTo) continue;

				const content = await this.vault.adapter.read(filePath);
				const lines = content.split("\n").filter(l => l.trim());
				for (const line of lines) {
					try {
						const record = JSON.parse(line);
						if (opts.types && !opts.types.includes(record.type)) continue;
						if (opts.bucket && record.bucket !== opts.bucket) continue;
						results.push(record);
					} catch (_) {}
				}
			}
		} catch (_) {}

		// Sort by time descending
		results.sort((a, b) => (b.start_time || b.completed_at || "").localeCompare(a.start_time || a.completed_at || ""));

		if (opts.limit) return results.slice(0, opts.limit);
		return results;
	}

	/**
	 * Get daily totals for analytics.
	 * Returns [{ date, bucket, total_minutes }, ...]
	 */
	async getDailyTotals(opts = {}) {
		const sessions = await this.query({ ...opts, types: ["session"] });
		const totals = {};
		for (const s of sessions) {
			const key = `${s.date}:${s.bucket}`;
			totals[key] = (totals[key] || 0) + (s.duration_minutes || 0);
		}
		return Object.entries(totals).map(([key, total_minutes]) => {
			const [date, bucket] = key.split(":");
			return { date, bucket, total_minutes };
		});
	}

	/**
	 * Get weekly totals per bucket for analytics.
	 * Groups daily totals by ISO week.
	 * Returns [{ weekStart, bucket, total_minutes }, ...]
	 */
	async getWeeklyTotals(opts = {}) {
		const daily = await this.getDailyTotals(opts);
		const weeks = {};
		for (const d of daily) {
			const date = new Date(d.date + "T00:00:00");
			const day = date.getDay();
			const diff = day === 0 ? -6 : 1 - day;
			const monday = new Date(date);
			monday.setDate(date.getDate() + diff);
			const weekKey = monday.toISOString().split("T")[0];

			const key = `${weekKey}:${d.bucket}`;
			weeks[key] = (weeks[key] || 0) + d.total_minutes;
		}
		return Object.entries(weeks).map(([key, total_minutes]) => {
			const [weekStart, bucket] = key.split(":");
			return { weekStart, bucket, total_minutes };
		}).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
	}
}

module.exports = { SessionStore };
