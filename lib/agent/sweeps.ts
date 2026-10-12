import { json, one, type Db } from "../db";
import { todayIST } from "../time";
import { notify } from "./notify";

/** Marks shows whose end (or start) date is before today (IST) as past. */
export async function markPastShows(db: Db, now: Date = new Date()): Promise<void> {
  await db.query(
    `update shows set status = 'past'
      where status in ('scheduled','postponed') and coalesce(end_date, start_date) < $1::date`,
    [todayIST(now)],
  );
}

/**
 * Early-bird deadline sweep: any `open` show whose deadline is within 48h and has no
 * early_bird_closing_soon change yet becomes `closing_soon`, with a change + alert.
 * Cheap SQL only — runs on every cron tick, even when scans are skipped.
 */
export async function deadlineSweep(db: Db, now: Date = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + 48 * 3_600_000).toISOString();
  const shows = await db.query<{ id: string; early_bird_deadline: string; has_change: boolean }>(
    `select s.id, s.early_bird_deadline,
            exists(select 1 from show_changes c where c.show_id = s.id and c.change_type = 'early_bird_closing_soon') as has_change
       from shows s
      where s.early_bird_status = 'open' and not s.is_sample
        and s.early_bird_deadline > $1 and s.early_bird_deadline <= $2`,
    [now.toISOString(), horizon],
  );
  const changeIds: string[] = [];
  for (const s of shows) {
    await db.query(
      "update shows set early_bird_status = 'closing_soon', updated_at = now() where id = $1",
      [s.id],
    );
    if (s.has_change) continue;
    const ch = await one<{ id: string }>(
      db,
      `insert into show_changes(show_id, change_type, before, after)
       values ($1, 'early_bird_closing_soon', $2::jsonb, $3::jsonb) returning id`,
      [
        s.id,
        json({ early_bird_status: "open" }),
        json({ early_bird_status: "closing_soon", early_bird_deadline: s.early_bird_deadline }),
      ],
    );
    if (ch?.id) changeIds.push(ch.id);
  }
  if (changeIds.length > 0) await notify(db, changeIds);
  return changeIds.length;
}

/** Shows whose early-bird deadline has passed fall back to unknown so stale countdowns disappear. */
export async function expireDeadlines(db: Db, now: Date = new Date()): Promise<void> {
  await db.query(
    `update shows set early_bird_status = 'unknown', early_bird_deadline = null
      where early_bird_status in ('open','closing_soon') and early_bird_deadline < $1`,
    [now.toISOString()],
  );
}
