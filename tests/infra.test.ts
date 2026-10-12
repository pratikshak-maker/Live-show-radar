import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, maskEmail, sign, verifySigned } from "@/lib/crypto";
import { evaluateWindow } from "@/lib/rate-limit";
import { readEnv } from "@/lib/env";
import { countdownParts, fmtDateTime, fmtDay, fmtTime, timeLeftPhrase, todayIST } from "@/lib/time";

const KEY = randomBytes(32).toString("base64");

describe("crypto", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("refresh-token-123", KEY);
    const b = encrypt("refresh-token-123", KEY);
    expect(a).not.toBe(b);
    expect(decrypt(a, KEY)).toBe("refresh-token-123");
  });
  it("fails on tamper or wrong key", () => {
    const a = encrypt("secret", KEY);
    const buf = Buffer.from(a, "base64");
    buf[buf.length - 1] ^= 1;
    expect(() => decrypt(buf.toString("base64"), KEY)).toThrow();
    expect(() => decrypt(a, randomBytes(32).toString("base64"))).toThrow();
  });
  it("rejects a bad key length", () => {
    expect(() => encrypt("x", "short")).toThrow();
  });
  it("signs and verifies values", () => {
    const s = sign("admin", "k")!;
    expect(verifySigned(s, "k")).toBe("admin");
    expect(verifySigned(s + "x", "k")).toBeNull();
  });
  it("masks emails", () => {
    expect(maskEmail("karan@gmail.com")).toBe("ka***@gmail.com");
  });
});

describe("rate limiter window logic", () => {
  it("allows up to max, then blocks with retryAfter, then resets", () => {
    const t0 = 1_000_000;
    let state: { windowStart: number; count: number } | null = null;
    const hit = (now: number) => {
      const r = evaluateWindow(state, now, 2, 60);
      state = { windowStart: r.windowStart, count: r.count };
      return r;
    };
    expect(hit(t0).allowed).toBe(true);
    expect(hit(t0 + 1000).allowed).toBe(true);
    const blocked = hit(t0 + 2000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(58);
    expect(hit(t0 + 61_000).allowed).toBe(true);
  });
});

describe("env", () => {
  it("never throws and treats empty strings as unset", () => {
    const e = readEnv({ GEMINI_API_KEY: "", SCAN_BATCH_SIZE: "", PORT: "" });
    expect(e.GEMINI_API_KEY).toBeUndefined();
    expect(e.SCAN_BATCH_SIZE).toBe(4);
    expect(e.GEMINI_MODEL).toBe("gemini-flash-latest");
    expect(e.HOME_CITY).toBe("Bengaluru");
  });
  it("falls back to the default for junk numbers", () => {
    expect(readEnv({ SCAN_TIME_BUDGET_MS: "abc" }).SCAN_TIME_BUDGET_MS).toBe(45000);
  });
});

describe("IST helpers", () => {
  it("todayIST rolls over at 18:30 UTC", () => {
    expect(todayIST(new Date("2026-12-01T18:29:00Z"))).toBe("2026-12-01");
    expect(todayIST(new Date("2026-12-01T18:31:00Z"))).toBe("2026-12-02");
  });
  it("formats days and times", () => {
    expect(fmtDay("2026-12-14")).toBe("Mon 14 Dec");
    expect(fmtDateTime("2026-12-06T18:29:00Z")).toBe("Sun 6 Dec, 11:59 PM");
    expect(fmtTime("19:30")).toBe("7:30 PM");
    expect(fmtTime("00:05")).toBe("12:05 AM");
    expect(fmtTime(null)).toBeNull();
  });
  it("countdowns", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    expect(countdownParts(new Date(now.getTime() + (5 * 60 + 12) * 60_000), now)).toBe("5h 12m");
    expect(countdownParts(new Date(now.getTime() + 52 * 60 * 60_000), now)).toBe("2d 4h");
    expect(countdownParts(new Date(now.getTime() - 1), now)).toBeNull();
    expect(timeLeftPhrase(new Date(now.getTime() + 5 * 3_600_000), now)).toBe("about 5 hours left");
  });
});
