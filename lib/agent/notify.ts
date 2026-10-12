import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEmail, type AlertItem } from "../email/templates";
import { sendAlertEmail } from "../email/send";
import { readEnv } from "../env";
import { getShow } from "../queries";
import { getAppSettings } from "../settings";

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

type ChangeRow = {
  id: string;
  show_id: string;
  change_type: string;
  show: { is_sample: boolean; confidence: number } | null;
};

/**
 * Stage F.
 *  1. In-app alert rows for every alert-worthy change (the bell badge). Idempotent via the unique
 *     (show_id, alert_type, channel) constraint.
 *  2. ONE email per run containing every change that has not been emailed before, with
 *     Act-now and home-city items first. Low-confidence (< threshold) and sample shows never email.
 * Returns the number of changes included in the email (0 if none sent).
 */
export async function notify(db: SupabaseClient, changeIds: string[]): Promise<number> {
  if (changeIds.length === 0) return 0;
  const { data } = await db
    .from("show_changes")
    .select("id, show_id, change_type, show:shows(is_sample, confidence)")
    .in("id", changeIds);
  const rows = ((data ?? []) as unknown as ChangeRow[]).filter(
    (r) => ALERT_WORTHY.has(r.change_type) && r.show && !r.show.is_sample,
  );
  if (rows.length === 0) return 0;

  const now = new Date().toISOString();
  await db.from("alerts").upsert(
    rows.map((r) => ({
      show_id: r.show_id,
      change_id: r.id,
      channel: "in_app",
      alert_type: r.change_type,
      status: "sent",
      sent_at: now,
    })),
    { onConflict: "show_id,alert_type,channel", ignoreDuplicates: true },
  );

  const settings = await getAppSettings();
  if (!settings.emailAlertsEnabled) return 0;
  const eligible = rows.filter((r) => Number(r.show!.confidence) >= settings.minConfidenceForEmail);
  if (eligible.length === 0) return 0;

  // Skip anything already emailed (or deliberately skipped) for the same show + alert type.
  const { data: prior } = await db
    .from("alerts")
    .select("show_id, alert_type, status, channel")
    .in("channel", ["gmail", "smtp"])
    .in("show_id", [...new Set(eligible.map((r) => r.show_id))]);
  const done = new Set(
    ((prior ?? []) as { show_id: string; alert_type: string; status: string }[])
      .filter((p) => p.status === "sent" || p.status === "skipped")
      .map((p) => `${p.show_id}|${p.alert_type}`),
  );
  const fresh = eligible.filter((r) => !done.has(`${r.show_id}|${r.change_type}`));
  if (fresh.length === 0) return 0;

  const shows = new Map<string, NonNullable<Awaited<ReturnType<typeof getShow>>>>();
  for (const id of new Set(fresh.map((r) => r.show_id))) {
    const s = await getShow(id);
    if (s) shows.set(id, s);
  }
  const items: AlertItem[] = fresh.flatMap((r) => {
    const show = shows.get(r.show_id);
    return show ? [{ show, changeType: r.change_type }] : [];
  });
  if (items.length === 0) return 0;

  const { count } = await db
    .from("artists")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  const content = buildEmail(items, { appUrl: readEnv().APP_URL, artistCount: count ?? 0 });
  const sent = await sendAlertEmail(content);

  const channel = sent.ok ? sent.data.channel : "gmail";
  const status = sent.ok ? "sent" : sent.reason === "not_configured" ? "skipped" : "failed";
  await db.from("alerts").upsert(
    fresh.map((r) => ({
      show_id: r.show_id,
      change_id: r.id,
      channel,
      alert_type: r.change_type,
      status,
      error: sent.ok
        ? null
        : sent.reason === "not_configured"
          ? "not_configured"
          : sent.message.slice(0, 200),
      sent_at: sent.ok ? now : null,
    })),
    { onConflict: "show_id,alert_type,channel" },
  );
  return sent.ok ? items.length : 0;
}
