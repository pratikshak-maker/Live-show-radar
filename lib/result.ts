export type FailReason =
  | "not_configured"
  | "rate_limited"
  | "quota_exhausted"
  | "upstream_error"
  | "invalid_response";

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; reason: FailReason; message: string; retryAfterMs?: number };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const fail = (reason: FailReason, message: string, retryAfterMs?: number): Result<never> => ({
  ok: false,
  reason,
  message,
  retryAfterMs,
});

export const notConfigured = (what: string): Result<never> =>
  fail("not_configured", `${what} is not connected yet.`);

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
