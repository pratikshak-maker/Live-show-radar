import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, todayIST } from "../time";
import { notify } from "./notify";

/** Marks shows whose end (or start) date is before today (IST) as past. */
export async function markPastShows(db: SupabaseClient, now: Date = new Date()): Promise<void> {
  const today = todayIST(now);
  await db.from("shows").update({ status: "past" }).in("status", ["scheduled", "postponed"]).is("end_date", null).lt("start_date", today);
  await db.from("shows").update({ status: "past" }).in("status", ["scheduled", "postponed"]).not("end_date", "is", null).lt("end_date", today);
}

/**
 * Early-bird deadline sweep: any `open` show whose deadline is within 48h and has no
 * early_bird_closing_soon change yet becomes `closing_soon`, with a change + alert.
 * Cheap SQL only — runs on every cron tick, even when scans are skipped.
 */
export async function deadlineSweep(db: SupabaseClient, now: Date = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + 48 * 3_600_000).toISOString();
  const { data } = await db
    .from("shows")
    .select("id, early_bird_deadline, early_bird_status, start_date, venue_name")
    .eq("early_bird_status", "open")
    .eq("is_sample", false)
    .gt("early_bird_deadline", now.toISOString())
    .lte("early_bird_deadline", horizon);
  const shows = (data ?? []) as { id: string; early_bird_deadline: string; early_bird_status: string; start_date: string; venue_name: string | null }[];
  const changeIds: string[] = [];
  for (const s of shows) {
    const { data: existing } = await db.from("show_changes").select("id").eq("show_id", s.id).eq("change_type", "early_bird_closing_soon").limit(1);
    if (existing && existing.length > 0) {
      await db.from("shows").update({ early_bird_status: "closing_soon" }).eq("id", s.id);
      continue;
    }
    await db.from("shows").update({ early_bird_status: "closing_soon", updated_at: now.toISOString() }).eq("id", s.id);
    const { data: ch } = await db
      .from("show_changes")
      .insert({
        show_id: s.id,
        change_type: "early_bird_closing_soon",
        before: { early_bird_status: "open" },
        after: { early_bird_status: "closing_soon", early_bird_deadline: s.early_bird_deadline },
      })
      .select("id")
      .single();
    if (ch?.id) changeIds.push(ch.id as string);
  }
  if (changeIds.length > 0) await notify(db, changeIds);
  return changeIds.length;
}

/** Shows whose early-bird deadline has passed fall back to unknown so stale countdowns disappear. */
export async function expireDeadlines(db: SupabaseClient, now: Date = new Date()): Promise<void> {
  await db
    .from("shows")
    .update({ early_bird_status: "unknown", early_bird_deadline: null })
    .in("early_bird_status", ["open", "closing_soon"])
    .lt("early_bird_deadline", now.toISOString());
  void addDaysISO;
}
