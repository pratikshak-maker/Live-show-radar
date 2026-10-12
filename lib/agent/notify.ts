import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunCtx } from "./types";

export const ALERT_WORTHY = new Set([
  "new_show",
  "early_bird_opened",
  "early_bird_closing_soon",
  "early_bird_imminent",
  "deadline_found",
  "date_changed",
  "venue_changed",
  "cancelled",
]);

/**
 * Stage F. Creates in-app alert rows for this run's changes (idempotent via the
 * unique (show_id, alert_type, channel) constraint). Email delivery is added in M8.
 * Returns the number of alert-worthy changes.
 */
export async function notify(db: SupabaseClient, ctx: RunCtx): Promise<number> {
  if (ctx.changeIds.length === 0) return 0;
  const { data } = await db
    .from("show_changes")
    .select("id, show_id, change_type, show:shows(is_sample, confidence)")
    .in("id", ctx.changeIds);
  type Row = { id: string; show_id: string; change_type: string; show: { is_sample: boolean; confidence: number } | null };
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => ALERT_WORTHY.has(r.change_type) && r.show && !r.show.is_sample);
  if (rows.length === 0) return 0;
  await db.from("alerts").upsert(
    rows.map((r) => ({ show_id: r.show_id, change_id: r.id, channel: "in_app", alert_type: r.change_type, status: "sent", sent_at: new Date().toISOString() })),
    { onConflict: "show_id,alert_type,channel", ignoreDuplicates: true },
  );
  return rows.length;
}
