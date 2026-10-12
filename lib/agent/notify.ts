import { one, type Db } from "../db";
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
  is_sample: boolean;
  confidence: number;
};

/**
 * Stage F.
 *  1. In-app alert rows for every alert-worthy change (the bell badge). Idempotent via the unique
 *     (show_id, alert_type, channel) constraint.
 *  2. ONE email per run containing every change that has not been emailed before, with
 *     Act-now and home-city items first. Low-confidence (< threshold) and sample shows never email.
 * Returns the number of changes included in the email (0 if none sent).
 */
export async function notify(db: Db, changeIds: string[]): Promise<number> {
  if (changeIds.length === 0) return 0;
  const data = await db.query<ChangeRow>(
    `select c.id, c.show_id, c.change_type, s.is_sample, s.confidence
       from show_changes c join shows s on s.id = c.show_id
      where c.id = any($1::uuid[])`,
    [changeIds],
  );
  const rows = data.filter((r) => ALERT_WORTHY.has(r.change_type) && !r.is_sample);
  if (rows.length === 0) return 0;

  const now = new Date().toISOString();
  for (const r of rows) {
    await db.query(
      `insert into alerts(show_id, change_id, channel, alert_type, status, sent_at)
       values ($1, $2, 'in_app', $3, 'sent', $4)
       on conflict (show_id, alert_type, channel) do nothing`,
      [r.show_id, r.id, r.change_type, now],
    );
  }

  const settings = await getAppSettings();
  if (!settings.emailAlertsEnabled) return 0;
  const eligible = rows.filter((r) => Number(r.confidence) >= settings.minConfidenceForEmail);
  if (eligible.length === 0) return 0;

  // Skip anything already emailed (or deliberately skipped) for the same show + alert type.
  const prior = await db.query<{ show_id: string; alert_type: string; status: string }>(
    "select show_id, alert_type, status from alerts where channel in ('gmail','smtp') and show_id = any($1::uuid[])",
    [[...new Set(eligible.map((r) => r.show_id))]],
  );
  const done = new Set(
    prior
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

  const count = await one<{ n: number }>(
    db,
    "select count(*)::int as n from artists where is_active",
  );
  const content = buildEmail(items, { appUrl: readEnv().APP_URL, artistCount: count?.n ?? 0 });
  const sent = await sendAlertEmail(content);

  const channel = sent.ok ? sent.data.channel : "gmail";
  const status = sent.ok ? "sent" : sent.reason === "not_configured" ? "skipped" : "failed";
  const error = sent.ok
    ? null
    : sent.reason === "not_configured"
      ? "not_configured"
      : sent.message.slice(0, 200);
  for (const r of fresh) {
    await db.query(
      `insert into alerts(show_id, change_id, channel, alert_type, status, error, sent_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (show_id, alert_type, channel) do update set
         change_id = excluded.change_id, status = excluded.status, error = excluded.error, sent_at = excluded.sent_at`,
      [r.show_id, r.id, channel, r.change_type, status, error, sent.ok ? now : null],
    );
  }
  return sent.ok ? items.length : 0;
}
