import type { Vault } from "obsidian";

interface SessionRecord {
  type: "session";
  date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  bucket: string;
  task_text: string;
  notes: string;
}

interface CompletionRecord {
  type: "completion";
  date: string;
  bucket: string;
  task_text: string;
  completed_at: string;
}

type RecordLike = SessionRecord | CompletionRecord;

interface QueryOpts {
  dateFrom?: string;
  dateTo?: string;
  bucket?: string;
  types?: string[];
  limit?: number;
}

interface DailyTotal {
  date: string;
  bucket: string;
  total_minutes: number;
}

interface WeeklyTotal {
  weekStart: string;
  bucket: string;
  total_minutes: number;
}

export class SessionStore {
  private vault: Vault;
  private basePath: string;

  constructor(vault: Vault) {
    this.vault = vault;
    this.basePath = vault.configDir + "/plugins/flowtime/sessions";
  }

  private async _ensureDir(): Promise<void> {
    try {
      const exists = await this.vault.adapter.exists(this.basePath);
      if (exists) {
        const stat = await this.vault.adapter.stat(this.basePath);
        if (stat && stat.type === "file") {
          await this.vault.adapter.remove(this.basePath);
        }
        return;
      }
    } catch (_) { /* fine */ }
    try {
      await this.vault.createFolder(this.basePath);
    } catch (_) { /* fine */ }
  }

  private _filePath(date: string): string {
    return `${this.basePath}/${date}.ndjson`;
  }

  private async _append(path: string, line: string): Promise<void> {
    try {
      await this.vault.adapter.append(path, line);
    } catch (_) {
      await this.vault.adapter.write(path, line);
    }
  }

  private _validateRecord(record: Record<string, unknown>): string | null {
    if (!record || typeof record !== "object") return "Record must be an object";
    if (!record.type || !["session", "completion"].includes(record.type as string))
      return "Record must have type 'session' or 'completion'";
    if (record.type === "session") {
      if (!record.start_time || typeof record.start_time !== "string")
        return "Session must have start_time (ISO string)";
      if (!record.end_time || typeof record.end_time !== "string")
        return "Session must have end_time (ISO string)";
      if (typeof record.duration_minutes !== "number" || (record.duration_minutes as number) < 0)
        return "Session must have duration_minutes (number >= 0)";
    }
    if (record.type === "completion") {
      if (!record.completed_at || typeof record.completed_at !== "string")
        return "Completion must have completed_at (ISO string)";
    }
    return null;
  }

  async writeSession(opts: {
    startTime: string;
    endTime: string;
    durationMinutes: number;
    bucket: string;
    taskText: string;
    notes: string;
  }): Promise<void> {
    await this._ensureDir();
    const date = opts.startTime
      ? opts.startTime.split("T")[0]
      : new Date().toISOString().split("T")[0];
    const record: SessionRecord = {
      type: "session",
      date,
      start_time: opts.startTime || new Date().toISOString(),
      end_time: opts.endTime || new Date().toISOString(),
      duration_minutes: typeof opts.durationMinutes === "number" ? opts.durationMinutes : 0,
      bucket: opts.bucket || "",
      task_text: opts.taskText || "",
      notes: opts.notes || "",
    };
    const err = this._validateRecord(record as unknown as Record<string, unknown>);
    if (err) {
      console.warn("Flowtime: Invalid session record —", err, record);
      return;
    }
    await this._append(this._filePath(date), JSON.stringify(record) + "\n");
  }

  async writeCompletion(opts: {
    date?: string;
    bucket: string;
    taskText: string;
    completedAt: string;
  }): Promise<void> {
    await this._ensureDir();
    const record: CompletionRecord = {
      type: "completion",
      date: opts.date || new Date().toISOString().split("T")[0],
      bucket: opts.bucket || "",
      task_text: opts.taskText || "",
      completed_at: opts.completedAt || new Date().toISOString(),
    };
    const err = this._validateRecord(record as unknown as Record<string, unknown>);
    if (err) {
      console.warn("Flowtime: Invalid completion record —", err, record);
      return;
    }
    await this._append(this._filePath(record.date), JSON.stringify(record) + "\n");
  }

  async query(opts: QueryOpts = {}): Promise<RecordLike[]> {
    await this._ensureDir();
    const results: RecordLike[] = [];
    try {
      const listing = await this.vault.adapter.list(this.basePath);
      const files = listing.files.filter((f) => f.endsWith(".ndjson")).sort();

      for (const filePath of files) {
        const dateMatch = filePath.match(/(\d{4}-\d{2}-\d{2})\.ndjson$/);
        if (!dateMatch) continue;
        const fileDate = dateMatch[1];

        if (opts.dateFrom && fileDate < opts.dateFrom) continue;
        if (opts.dateTo && fileDate > opts.dateTo) continue;

        const content = await this.vault.adapter.read(filePath);
        const lines = content.split("\n").filter((l) => l.trim());
        for (const line of lines) {
          try {
            const record = JSON.parse(line) as RecordLike;
            if (opts.types && !opts.types.includes(record.type)) continue;
            if (opts.bucket && record.bucket !== opts.bucket) continue;
            results.push(record);
          } catch (_) { /* skip malformed */ }
        }
      }
    } catch (_) { /* fine */ }

    results.sort((a, b) => {
      const aTime = (a as SessionRecord).start_time || (a as CompletionRecord).completed_at || "";
      const bTime = (b as SessionRecord).start_time || (b as CompletionRecord).completed_at || "";
      return bTime.localeCompare(aTime);
    });

    if (opts.limit) return results.slice(0, opts.limit);
    return results;
  }

  async getDailyTotals(opts: QueryOpts = {}): Promise<DailyTotal[]> {
    const sessions = await this.query({ ...opts, types: ["session"] });
    const totals: Record<string, number> = {};
    for (const rec of sessions) {
      const s = rec as SessionRecord;
      const key = `${s.date}:${s.bucket}`;
      totals[key] = (totals[key] || 0) + (s.duration_minutes || 0);
    }
    return Object.entries(totals).map(([key, total_minutes]) => {
      const [date, bucket] = key.split(":");
      return { date, bucket, total_minutes };
    });
  }

  async getWeeklyTotals(opts: QueryOpts = {}): Promise<WeeklyTotal[]> {
    const daily = await this.getDailyTotals(opts);
    const weeks: Record<string, number> = {};
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
    return Object.entries(weeks)
      .map(([key, total_minutes]) => {
        const [weekStart, bucket] = key.split(":");
        return { weekStart, bucket, total_minutes };
      })
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  }
}
