import { createHash } from "node:crypto";
import { getDb } from "./db";
import { readEnv } from "./env";

export type RateLimitSpec = { action: string; max: number; windowSeconds: number };

export const LIMITS = {
  scan_manual: { max: 1, windowSeconds: 180 },
  scan_artist: { max: 1, windowSeconds: 600 },
  ask: { max: 10, windowSeconds: 3600 },
  brief: { max: 30, windowSeconds: 3600 },
  decision: { max: 20, windowSeconds: 3600 },
  search: { max: 120, windowSeconds: 3600 },
  import: { max: 20, windowSeconds: 3600 },
} as const;

/** Pure fixed-window logic with injected time (also unit-tested). */
export function evaluateWindow(
  prev: { windowStart: number; count: number } | null,
  nowMs: number,
  max: number,
  windowSeconds: number,
): { allowed: boolean; windowStart: number; count: number; retryAfterSeconds: number } {
  const windowMs = windowSeconds * 1000;
  const fresh = !prev || nowMs - prev.windowStart >= windowMs;
  const windowStart = fresh ? nowMs : prev.windowStart;
  const count = fresh ? 1 : prev.count + 1;
  const allowed = count <= max;
  return {
    allowed,
    windowStart,
    count,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((windowStart + windowMs - nowMs) / 1000)),
  };
}

export function ipHash(ip: string): string {
  const salt = readEnv().CRON_SECRET ?? "live-show-radar";
  return createHash("sha256")
    .update(ip + salt)
    .digest("hex")
    .slice(0, 16);
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/** Atomic via the hit_rate_limit SQL function. Fails open if the DB is unavailable. */
export async function rateLimit(
  action: keyof typeof LIMITS,
  scope: string,
): Promise<RateLimitResult> {
  const db = getDb();
  if (!db) return { allowed: true, retryAfterSeconds: 0 };
  const spec = LIMITS[action];
  const key = `${action}:${scope}`;
  try {
    const { data, error } = await db.rpc("hit_rate_limit", {
      p_key: key,
      p_window_seconds: spec.windowSeconds,
    });
    if (error || !Array.isArray(data) || data.length === 0)
      return { allowed: true, retryAfterSeconds: 0 };
    const row = data[0] as { out_count: number; out_window_start: string };
    const windowStart = new Date(row.out_window_start).getTime();
    const allowed = row.out_count <= spec.max;
    return {
      allowed,
      retryAfterSeconds: allowed
        ? 0
        : Math.max(1, Math.ceil((windowStart + spec.windowSeconds * 1000 - Date.now()) / 1000)),
    };
  } catch {
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export function rateLimitScopeForRequest(req: Request): string {
  return ipHash(clientIp(req));
}
