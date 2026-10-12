import { getDb, json, one, type Db } from "../db";
import { getHomeCity } from "../settings";
import { readEnv } from "../env";
import { GeminiBudget } from "../integrations/gemini";
import { geocodePending } from "../geocode";
import { acquireLock, releaseLock } from "../lock";
import { errMessage } from "../result";
import { fmtDateTime, fmtDay, todayIST } from "../time";
import type { ArtistRow, ShowRow } from "../types";
import { discover } from "./discover";
import { enrich } from "./enrich";
import { extract } from "./extract";
import { RunLogger } from "./logger";
import { notify } from "./notify";
import { PROMPT_VERSIONS } from "./prompts";
import { reconcileCandidate } from "./reconcile";
import type { RunCtx, RunStats } from "./types";
import { DROP_MESSAGES, validateCandidates } from "./validate";

export type ScanTrigger = "cron" | "manual" | "artist";
export type StartResult =
  | { status: "started"; runId: string }
  | { status: "busy"; runId: string | null }
  | { status: "no_db" };

const LOCK_KEY = "scan";
const LOCK_TTL_SECONDS = 120;

/** Step 1-2: take the lock and create the run row. */
export async function startScan(trigger: ScanTrigger, artistIds?: string[]): Promise<StartResult> {
  const db = getDb();
  if (!db) return { status: "no_db" };
  const got = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!got) {
    const running = await one<{ id: string }>(
      db,
      "select id from scan_runs where status = 'running' order by started_at desc limit 1",
    ).catch(() => null);
    return { status: "busy", runId: running?.id ?? null };
  }
  const run = await one<{ id: string }>(
    db,
    "insert into scan_runs(trigger, artist_ids, status) values ($1, $2::uuid[], 'running') returning id",
    [trigger, artistIds ?? []],
  ).catch(() => null);
  if (!run) {
    await releaseLock(LOCK_KEY);
    return { status: "no_db" };
  }
  return { status: "started", runId: run.id };
}

async function pickArtists(db: Db, batch: number, favoritesFirst: boolean): Promise<ArtistRow[]> {
  const rows = await db.query<ArtistRow>(
    "select * from artists where is_active order by last_scanned_at asc nulls first limit 200",
  );
  const stamp = (a: ArtistRow) => (a.last_scanned_at ? new Date(a.last_scanned_at).getTime() : 0);
  rows.sort((a, b) => {
    const an = a.last_scanned_at === null;
    const bn = b.last_scanned_at === null;
    if (an !== bn) return an ? -1 : 1; // never-scanned first
    if (favoritesFirst && a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
    if (stamp(a) !== stamp(b)) return stamp(a) - stamp(b);
    return Number(b.is_favorite) - Number(a.is_favorite); // favourites win ties
  });
  return rows.slice(0, batch);
}

function earlyBirdSentence(s: Pick<ShowRow, "early_bird_status" | "early_bird_deadline">): string {
  const dl = s.early_bird_deadline ? fmtDateTime(s.early_bird_deadline) : null;
  switch (s.early_bird_status) {
    case "open":
    case "closing_soon":
      return dl ? `Early bird is open until ${dl}.` : "Early bird is open (no deadline listed).";
    case "imminent":
      return dl ? `Early bird opens ${dl}.` : "Early bird opens soon.";
    case "sold_out":
      return "Early bird is sold out.";
    case "not_offered":
      return "General sale only.";
    default:
      return "Ticket tiers aren't published yet.";
  }
}

async function processArtist(db: Db, artist: ArtistRow, ctx: RunCtx): Promise<void> {
  const { logger } = ctx;
  const name = artist.name;
  const today = todayIST(ctx.now());
  const existing = await db.query<ShowRow>(
    "select * from shows where artist_id = $1 and not is_sample and start_date >= $2::date",
    [artist.id, today.slice(0, 8) + "01"],
  );

  const d = await discover(artist, ctx);
  const bundle = await enrich(artist, d, existing, ctx);
  const candidates = await extract(artist, d, bundle, ctx);
  ctx.stats.candidates += candidates.length;

  const { valid, dropped } = validateCandidates(candidates, artist, bundle, existing, ctx.now());
  for (const x of dropped) {
    await logger.warn(
      "validate",
      `Ignored a possible show in ${x.candidate.city || "an unknown city"} on ${x.candidate.start_date}: it ${DROP_MESSAGES[x.reason]}.`,
      name,
    );
  }

  let realInserted = 0;
  for (const vc of valid) {
    const r = await reconcileCandidate(db, artist, vc, existing, ctx);
    if (!r) {
      await logger.error(
        "match",
        `Couldn't save the ${vc.cityInfo.name} show. Will retry next check.`,
        name,
      );
      continue;
    }
    const row = existing.find((s) => s.id === r.showId);
    const where = `${vc.cityInfo.name}, ${fmtDay(row?.start_date ?? vc.start_date)}${row?.venue_name ? ` at ${row.venue_name}` : ""}`;
    if (r.isNew) {
      ctx.stats.newShows++;
      realInserted++;
      await logger.success(
        "match",
        `Confirmed: ${where}. ${row ? earlyBirdSentence(row) : ""}`.trim(),
        name,
      );
      await logger.success(
        "alert",
        vc.confidence >= 0.5
          ? "New show! Sending an email alert."
          : "New show, but confidence is low — no email yet.",
        name,
      );
    } else if (r.changes.length > 0) {
      ctx.stats.updated++;
      await logger.success(
        "match",
        `Updated: ${where}. ${row ? earlyBirdSentence(row) : ""}`.trim(),
        name,
      );
    } else {
      await logger.info("match", `Already known (${where}) — no changes.`, name);
    }
  }
  if (valid.length === 0 && dropped.length === 0)
    await logger.info("match", `No upcoming India shows for ${name} right now.`, name);

  if (realInserted > 0) await db.query("delete from shows where is_sample"); // real data replaces sample mode

  await db.query(
    "update artists set last_scanned_at = now(), last_scan_status = $2 where id = $1",
    [artist.id, valid.length > 0 || existing.length > 0 ? "ok" : "no_results"],
  );
}

async function pool<T>(
  items: T[],
  concurrency: number,
  shouldStart: () => boolean,
  fn: (item: T) => Promise<void>,
): Promise<number> {
  let next = 0;
  let started = 0;
  const worker = async () => {
    while (next < items.length && shouldStart()) {
      const item = items[next++];
      started++;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return started;
}

/** Steps 3-8: does the work. Always releases the lock. */
export async function executeScan(runId: string, artistIds?: string[]): Promise<void> {
  const db = getDb();
  if (!db) return;
  const env = readEnv();
  const logger = new RunLogger(runId);
  const startedAt = Date.now();
  const stats: RunStats = {
    artists: 0,
    candidates: 0,
    newShows: 0,
    updated: 0,
    alerts: 0,
    geminiCalls: 0,
    sbCredits: 0,
    prompts: { ...PROMPT_VERSIONS },
  };
  const ctx: RunCtx = {
    runId,
    logger,
    gemini: new GeminiBudget(),
    homeCity: await getHomeCity(),
    now: () => new Date(),
    stats,
    scrapeBlocked: false,
    changeIds: [],
  };
  let status: "completed" | "partial" | "failed" = "completed";
  let error: string | null = null;

  try {
    let artists: ArtistRow[];
    if (artistIds && artistIds.length > 0) {
      artists = await db.query<ArtistRow>("select * from artists where id = any($1::uuid[])", [
        artistIds,
      ]);
    } else {
      const c = await one<{ n: number }>(db, "select count(*)::int as n from scan_runs");
      artists = await pickArtists(db, env.SCAN_BATCH_SIZE, (c?.n ?? 0) % 2 === 1);
      await db.query("update scan_runs set artist_ids = $2::uuid[] where id = $1", [
        runId,
        artists.map((a) => a.id),
      ]);
    }
    if (artists.length === 0)
      await logger.info("search", "No artists to check yet. Add one on the Artists page.");

    const budgetLeft = () => Date.now() - startedAt < env.SCAN_TIME_BUDGET_MS;
    let failures = 0;
    const started = await pool(artists, 2, budgetLeft, async (artist) => {
      stats.artists++;
      try {
        await processArtist(db, artist, ctx);
      } catch (e) {
        failures++;
        await logger.error(
          "search",
          `Couldn't finish checking ${artist.name} (${errMessage(e).slice(0, 120)}). Your data is safe — we'll retry on the next check.`,
          artist.name,
        );
        await db
          .query(
            "update artists set last_scanned_at = now(), last_scan_status = 'error' where id = $1",
            [artist.id],
          )
          .catch(() => undefined);
      }
      await logger.info("artist_done", `Finished ${artist.name}.`, artist.name);
    });
    if (started < artists.length) {
      status = "partial";
      await logger.warn(
        "search",
        "Time budget reached — the remaining artists will be checked on the next run.",
      );
    }
    if (artists.length > 0 && failures === artists.length) status = "failed";

    // Notify (stage F)
    stats.alerts = await notify(db, ctx.changeIds);

    // Lazy geocoding while there's time left.
    if (budgetLeft()) await geocodePending(db, 3);
  } catch (e) {
    status = "failed";
    error = errMessage(e).slice(0, 300);
    await logger.error(
      "search",
      "Couldn't reach the search service. Your data is safe — we'll retry on the next check.",
    );
  } finally {
    stats.geminiCalls = ctx.gemini.calls;
    await db
      .query(
        "update scan_runs set status = $2, stats = $3::jsonb, error = $4, finished_at = now() where id = $1",
        [runId, status, json(stats), error],
      )
      .catch(() => undefined);
    await releaseLock(LOCK_KEY);
  }
}

/** Cron path: start and execute inline. */
export async function runScan(opts: {
  trigger: ScanTrigger;
  artistIds?: string[];
}): Promise<StartResult> {
  const s = await startScan(opts.trigger, opts.artistIds);
  if (s.status === "started") await executeScan(s.runId, opts.artistIds);
  return s;
}
