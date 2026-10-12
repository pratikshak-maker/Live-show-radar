import { getDb } from "../db";

export type LogLevel = "info" | "success" | "warn" | "error";

/** Writes human-readable scan_logs rows. These ARE the visible agent log, so they read like a story. */
export class RunLogger {
  constructor(public runId: string) {}

  async log(level: LogLevel, step: string, message: string, artistName?: string | null): Promise<void> {
    const db = getDb();
    if (!db) return;
    try {
      await db.from("scan_logs").insert({
        run_id: this.runId,
        level,
        step,
        message: message.slice(0, 500),
        artist_name: artistName ?? null,
      });
    } catch {
      /* logging must never break a scan */
    }
  }

  info = (step: string, message: string, artist?: string | null) => this.log("info", step, message, artist);
  success = (step: string, message: string, artist?: string | null) => this.log("success", step, message, artist);
  warn = (step: string, message: string, artist?: string | null) => this.log("warn", step, message, artist);
  error = (step: string, message: string, artist?: string | null) => this.log("error", step, message, artist);
}

/** Collects logs in memory (tests / dry runs). */
export class MemoryLogger extends RunLogger {
  entries: { level: LogLevel; step: string; message: string; artist?: string | null }[] = [];
  constructor() {
    super("memory");
  }
  override async log(level: LogLevel, step: string, message: string, artist?: string | null): Promise<void> {
    this.entries.push({ level, step, message, artist });
  }
}
