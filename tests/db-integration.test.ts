import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDbForTests, type Db } from "@/lib/db";
import { reconcileCandidate } from "@/lib/agent/reconcile";
import { notify } from "@/lib/agent/notify";
import { deadlineSweep, markPastShows } from "@/lib/agent/sweeps";
import { executeScan, startScan } from "@/lib/agent/run-scan";
import { MemoryLogger } from "@/lib/agent/logger";
import type { RunCtx, ValidCandidate } from "@/lib/agent/types";
import { GeminiBudget } from "@/lib/integrations/gemini";
import { getOAuthState } from "@/lib/integrations/registry";
import { acquireLock, addUsage, getUsageToday, releaseLock } from "@/lib/lock";
import { resolveCity } from "@/lib/normalize";
import { getAppStatus, getShow, listArtists, listShows } from "@/lib/queries";
import { rateLimit } from "@/lib/rate-limit";
import { ensureSampleShows } from "@/lib/sample-mode";
import { getAppSettings } from "@/lib/settings";
import type { ArtistRow } from "@/lib/types";
import { setSetting } from "@/lib/db";

// Same row shapes as production: dates as strings, timestamps as ISO, numerics as numbers.
const iso = (v: string) =>
  new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString();
const parsers = {
  20: (v: string) => Number(v),
  1700: (v: string) => Number(v),
  1082: (v: string) => v,
  1083: (v: string) => v,
  1114: (v: string) => iso(v + "Z"),
  1184: (v: string) => iso(v),
};

let pg: PGlite;
let db: Db;

beforeAll(async () => {
  pg = new PGlite({ parsers });
  const sql = readFileSync(
    new URL("../db/migrations/0001_init.sql", import.meta.url),
    "utf8",
  ).replace('create extension if not exists "pgcrypto";', "");
  await pg.exec(sql);
  await pg.exec(readFileSync(new URL("../db/seed.sql", import.meta.url), "utf8"));
  db = {
    query: async <T>(text: string, params: unknown[] = []) =>
      (await pg.query<T>(text, params)).rows,
  };
  setDbForTests(db);
  delete process.env.GEMINI_API_KEY;
  delete process.env.TICKETMASTER_API_KEY;
  delete process.env.SCRAPINGBEE_API_KEY;
}, 60_000);

afterAll(async () => {
  setDbForTests(null);
  await pg.close();
});

const artistByName = async (name: string) =>
  (await db.query<ArtistRow>("select * from artists where name = $1", [name]))[0];

function ctx(): RunCtx {
  return {
    runId: "test",
    logger: new MemoryLogger(),
    gemini: new GeminiBudget(5),
    homeCity: "Bengaluru",
    now: () => new Date(),
    stats: {
      artists: 0,
      candidates: 0,
      newShows: 0,
      updated: 0,
      alerts: 0,
      geminiCalls: 0,
      sbCredits: 0,
    },
    scrapeBlocked: false,
    changeIds: [],
  };
}

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

function candidate(over: Partial<ValidCandidate> = {}): ValidCandidate {
  return {
    from: "ai",
    artist_name_as_written: "Prateek Kuhad",
    is_this_artist: true,
    title: "Tour",
    event_type: "concert",
    city: "Bengaluru",
    state: null,
    country: "India",
    venue_name: "Phoenix Marketcity",
    start_date: inDays(30),
    end_date: null,
    start_time: "19:30",
    ticket_url: "https://www.district.in/e/pk",
    ticket_platform: "district",
    tiers: [
      {
        name: "Early Bird",
        price_inr: 1499,
        status: "on_sale",
        sale_start: null,
        sale_end: new Date(Date.now() + 100 * 3_600_000).toISOString(),
        is_early_bird: true,
      },
    ],
    on_sale_at: null,
    early_bird_mentioned: true,
    status: "scheduled",
    evidence_urls: ["https://www.district.in/e/pk"],
    evidence_quote: "x",
    cityInfo: resolveCity("Bengaluru")!,
    confidence: 0.8,
    ticketingConfirmed: true,
    lowConfidence: false,
    sourceRefs: [
      {
        url: "https://www.district.in/e/pk",
        kind: "scrapingbee",
        fetched_at: new Date().toISOString(),
      },
    ],
    ...over,
  };
}

describe("queries on a fresh database", () => {
  it("lists the 40 seeded artists with show counts", async () => {
    const artists = await listArtists();
    expect(artists).toHaveLength(40);
    expect(artists.every((a) => a.show_count === 0)).toBe(true);
    const status = await getAppStatus();
    expect(status).toMatchObject({ configured: true, artistCount: 40, lastCheckedAt: null });
  });

  it("sample mode inserts 4 clearly-flagged shows once", async () => {
    expect(await ensureSampleShows()).toBe(true);
    expect(await ensureSampleShows()).toBe(true);
    const shows = await listShows();
    expect(shows).toHaveLength(4);
    expect(shows.every((s) => s.is_sample)).toBe(true);
    const s = shows[0];
    expect(typeof s.start_date).toBe("string");
    expect(s.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof s.confidence).toBe("number");
    expect(s.artist.name).toBeTruthy();
  });

  it("settings round-trip through jsonb", async () => {
    await setSetting("home_city", "Mumbai");
    expect((await getAppSettings()).homeCity).toBe("Mumbai");
    await setSetting("home_city", "Bengaluru");
    expect((await getOAuthState("google")).connected).toBe(false);
  });
});

describe("reconcile + notify against Postgres", () => {
  it("inserts a new show with a new_show change, then is idempotent", async () => {
    const artist = await artistByName("Prateek Kuhad");
    const c = ctx();
    const existing: never[] = [];
    const r = await reconcileCandidate(db, artist, candidate(), existing, c);
    expect(r).toMatchObject({ isNew: true, changes: ["new_show"] });
    expect(c.changeIds).toHaveLength(1);

    const show = await getShow(r!.showId);
    expect(show).toMatchObject({
      city: "Bengaluru",
      is_home_city: true,
      early_bird_status: "open",
      price_min_inr: 1499,
    });
    expect(show!.tiers).toHaveLength(1);
    expect(show!.sources[0].kind).toBe("scrapingbee");
    expect(show!.venue_id).toBeTruthy();

    const again = await reconcileCandidate(db, artist, candidate(), [show!], ctx());
    expect(again).toMatchObject({ isNew: false, changes: [] });
  });

  it("notify creates one in-app alert per change and skips email when not configured", async () => {
    const changes = await db.query<{ id: string }>("select id from show_changes");
    const sent = await notify(
      db,
      changes.map((c) => c.id),
    );
    expect(sent).toBe(0); // no Google / SMTP
    const inApp = await db.query<{ status: string }>(
      "select status from alerts where channel = 'in_app'",
    );
    expect(inApp).toHaveLength(1);
    const email = await db.query<{ status: string; error: string }>(
      "select status, error from alerts where channel <> 'in_app'",
    );
    expect(email).toEqual([{ status: "skipped", error: "not_configured" }]);
    await notify(
      db,
      changes.map((c) => c.id),
    );
    expect(await db.query("select id from alerts where channel = 'in_app'")).toHaveLength(1);
  });

  it("deadline sweep flips open → closing_soon once, with a change", async () => {
    await db.query(
      "update shows set early_bird_deadline = now() + interval '10 hours' where not is_sample",
    );
    expect(await deadlineSweep(db)).toBe(1);
    expect(await deadlineSweep(db)).toBe(0);
    const s = await db.query<{ early_bird_status: string }>(
      "select early_bird_status from shows where not is_sample",
    );
    expect(s[0].early_bird_status).toBe("closing_soon");
  });

  it("marks past shows", async () => {
    await db.query(
      "update shows set start_date = current_date - 3 where is_sample and city = 'Mumbai'",
    );
    await markPastShows(db);
    const past = await db.query("select id from shows where status = 'past'");
    expect(past).toHaveLength(1);
  });
});

describe("locks, usage and rate limits through the app helpers", () => {
  it("works end to end", async () => {
    expect(await acquireLock("t", 60)).toBe(true);
    expect(await acquireLock("t", 60)).toBe(false);
    await releaseLock("t");
    expect(await acquireLock("t", 60)).toBe(true);
    await addUsage("scrapingbee", 5);
    await addUsage("scrapingbee", 5);
    expect(await getUsageToday("scrapingbee")).toBe(10);
    const first = await rateLimit("scan_manual", "global");
    const second = await rateLimit("scan_manual", "global");
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("a full scan run with no AI keys", () => {
  it("runs, logs in plain English, updates artists and releases the lock", async () => {
    const s = await startScan("manual");
    expect(s.status).toBe("started");
    if (s.status !== "started") return;
    const busy = await startScan("manual");
    expect(busy).toEqual({ status: "busy", runId: s.runId });

    await executeScan(s.runId);
    const run = (
      await db.query<{ status: string; stats: { artists: number }; artist_ids: string[] }>(
        "select status, stats, artist_ids from scan_runs where id = $1",
        [s.runId],
      )
    )[0];
    expect(run.status).toBe("completed");
    expect(run.stats.artists).toBe(4);
    expect(run.artist_ids).toHaveLength(4);
    const logs = await db.query<{ step: string; message: string }>(
      "select step, message from scan_logs where run_id = $1",
      [s.runId],
    );
    expect(logs.some((l) => l.message.includes("Searching the web for"))).toBe(true);
    expect(logs.some((l) => l.message.includes("Gemini isn't connected"))).toBe(true);
    expect(logs.filter((l) => l.step === "artist_done")).toHaveLength(4);
    const scanned = await db.query("select id from artists where last_scanned_at is not null");
    expect(scanned.length).toBeGreaterThanOrEqual(4);
    expect(await acquireLock("scan", 60)).toBe(true);
  });
});
