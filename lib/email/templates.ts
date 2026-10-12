import { buildCalendarEvents, templateLink } from "../calendar-build";
import { confidenceLabel } from "../scoring";
import { fmtDateTime, fmtDay, fmtTime, timeLeftPhrase } from "../time";
import { isHttpUrl, isTicketingDomain } from "../normalize";
import type { ShowWithArtist } from "../types";

export type AlertItem = { show: ShowWithArtist; changeType: string };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const EB_LIVE = new Set(["open", "closing_soon", "imminent"]);

function isActNow(s: ShowWithArtist, now: Date): boolean {
  if (!EB_LIVE.has(s.early_bird_status) || !s.early_bird_deadline) return false;
  const ms = new Date(s.early_bird_deadline).getTime() - now.getTime();
  return ms > 0 && ms <= 7 * 24 * 3_600_000;
}

/** Act-now items first, then home city, then by priority. */
export function sortItems(items: AlertItem[], now: Date = new Date()): AlertItem[] {
  return [...items].sort((a, b) => {
    const an = Number(isActNow(a.show, now));
    const bn = Number(isActNow(b.show, now));
    if (an !== bn) return bn - an;
    if (a.show.is_home_city !== b.show.is_home_city) return a.show.is_home_city ? -1 : 1;
    return b.show.priority_score - a.show.priority_score;
  });
}

/** Subject line from the highest-priority item in the run. */
export function buildSubject(items: AlertItem[], now: Date = new Date()): string {
  const sorted = sortItems(items, now);
  const top = sorted[0];
  if (!top) return "Live Show Radar";
  const s = top.show;
  const day = fmtDay(s.start_date);
  const distinct = new Set(sorted.map((i) => i.show.id)).size;
  const more = distinct > 1 ? ` (+${distinct - 1} more)` : "";
  let base: string;
  if (top.changeType === "cancelled") base = `Cancelled: ${s.artist.name} in ${s.city}, ${day}`;
  else if (top.changeType === "date_changed" || top.changeType === "venue_changed") base = `Update: ${s.artist.name} in ${s.city}, ${day}`;
  else if (s.is_home_city && (s.early_bird_status === "open" || s.early_bird_status === "closing_soon") && s.early_bird_deadline) {
    base = `🎟️ ${s.artist.name} in ${s.city}, ${day} — early bird open till ${fmtDateTime(s.early_bird_deadline)}`;
  } else base = `New: ${s.artist.name} in ${s.city}, ${day}`;
  return base + more;
}

function ebBadge(s: ShowWithArtist, now: Date): { text: string; tone: "urgent" | "muted" } | null {
  const dl = s.early_bird_deadline ? new Date(s.early_bird_deadline) : null;
  const left = dl ? timeLeftPhrase(dl, now) : null;
  switch (s.early_bird_status) {
    case "open":
    case "closing_soon":
      return { text: dl ? `Early bird open until ${fmtDateTime(dl)} IST${left ? ` — ${left}` : ""}` : "Early bird is open (no deadline listed)", tone: "urgent" };
    case "imminent":
      return { text: dl ? `Early bird opens ${fmtDateTime(dl)} IST${left ? ` — ${left}` : ""}` : "Early bird opens soon", tone: "urgent" };
    case "sold_out":
      return { text: "Early bird sold out", tone: "muted" };
    default:
      return null;
  }
}

/** The ticket link must be allowlisted; otherwise fall back to the first source, then the app. */
export function safeBookUrl(s: ShowWithArtist, appUrl: string): string {
  if (isHttpUrl(s.ticket_url) && isTicketingDomain(s.ticket_url)) return s.ticket_url;
  const src = s.sources.find((x) => isHttpUrl(x.url));
  return src?.url ?? `${appUrl}/?show=${s.id}`;
}

function changeLabel(type: string): string {
  switch (type) {
    case "new_show":
      return "New show";
    case "early_bird_opened":
      return "Early bird opened";
    case "early_bird_closing_soon":
      return "Early bird closing soon";
    case "early_bird_imminent":
      return "Early bird opens soon";
    case "deadline_found":
      return "Deadline announced";
    case "date_changed":
      return "New date";
    case "venue_changed":
      return "New venue";
    case "cancelled":
      return "Cancelled";
    default:
      return "Update";
  }
}

export type EmailContent = { subject: string; html: string; text: string };

export function buildEmail(
  items: AlertItem[],
  opts: { appUrl: string; artistCount: number; now?: Date; testBanner?: boolean },
): EmailContent {
  const now = opts.now ?? new Date();
  const sorted = sortItems(items, now);
  // One block per show even if several changes fired.
  const seen = new Set<string>();
  const blocks = sorted.filter((i) => (seen.has(i.show.id) ? false : (seen.add(i.show.id), true)));
  const subject = (opts.testBanner ? "[TEST] " : "") + buildSubject(items, now);
  const footer = `Live Show Radar is watching ${opts.artistCount} artists for you. Change alert settings: ${opts.appUrl}/settings`;

  const htmlBlocks = blocks
    .map(({ show: s, changeType }) => {
      const time = fmtTime(s.start_time);
      const badge = ebBadge(s, now);
      const cal = buildCalendarEvents(s, opts.appUrl, now).concert;
      const buttons = [
        { label: "Book tickets", href: safeBookUrl(s, opts.appUrl), primary: true },
        ...(cal ? [{ label: "Add to Google Calendar", href: templateLink(cal), primary: false }] : []),
        { label: "Open in Radar", href: `${opts.appUrl}/?show=${s.id}`, primary: false },
      ];
      return `
<tr><td style="padding:0 0 16px 0">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e6dff5;border-radius:16px">
  <tr><td style="padding:18px 20px">
   <div style="font-size:12px;color:#6b5f86;margin-bottom:4px">${esc(changeLabel(changeType))}${s.is_home_city ? " · in your city" : ""}</div>
   <div style="font-size:22px;line-height:28px;font-weight:700;color:#1e1534">${esc(s.artist.name)} — ${esc(s.city)}</div>
   <div style="font-size:15px;color:#1e1534;margin-top:4px">${esc(s.venue_name ?? s.city)} · ${esc(fmtDay(s.start_date))}${time ? `, ${esc(time)}` : ""}</div>
   ${badge ? `<div style="margin-top:10px;display:inline-block;padding:6px 12px;border-radius:999px;font-size:13px;font-weight:600;background:${badge.tone === "urgent" ? "#fff1d6" : "#efeaf7"};color:${badge.tone === "urgent" ? "#8a5200" : "#5e5378"}">${esc(badge.text)}</div>` : ""}
   <div style="font-size:13px;color:#5e5378;margin-top:10px">${s.price_min_inr ? `From ₹${s.price_min_inr.toLocaleString("en-IN")} · ` : ""}${esc(confidenceLabel(Number(s.confidence)))}</div>
   <div style="margin-top:14px">
    ${buttons
      .map(
        (b) =>
          `<a href="${esc(b.href)}" style="display:inline-block;margin:0 8px 8px 0;padding:11px 16px;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none;${b.primary ? "background:#d62f6c;color:#ffffff" : "background:#f1eafb;color:#1e1534"}">${esc(b.label)}</a>`,
      )
      .join("")}
   </div>
  </td></tr>
 </table>
</td></tr>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f2fc;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f2fc"><tr><td align="center" style="padding:24px 12px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
  ${opts.testBanner ? `<tr><td style="padding:0 0 12px 0"><div style="background:#fff1d6;color:#8a5200;border-radius:10px;padding:10px 14px;font-size:13px"><strong>This is a test alert.</strong> Real alerts look just like this.</div></td></tr>` : ""}
  ${htmlBlocks}
  <tr><td style="padding:8px 4px;font-size:12px;color:#6b5f86">${esc(footer)}</td></tr>
 </table>
</td></tr></table></body></html>`;

  const text = [
    ...(opts.testBanner ? ["THIS IS A TEST ALERT. Real alerts look just like this.", ""] : []),
    ...blocks.map(({ show: s, changeType }) => {
      const time = fmtTime(s.start_time);
      const badge = ebBadge(s, now);
      const cal = buildCalendarEvents(s, opts.appUrl, now).concert;
      return [
        `${changeLabel(changeType).toUpperCase()}: ${s.artist.name} — ${s.city}`,
        `${s.venue_name ?? s.city} · ${fmtDay(s.start_date)}${time ? `, ${time}` : ""}`,
        ...(badge ? [badge.text] : []),
        `${s.price_min_inr ? `From ₹${s.price_min_inr.toLocaleString("en-IN")} · ` : ""}${confidenceLabel(Number(s.confidence))}`,
        `Book tickets: ${safeBookUrl(s, opts.appUrl)}`,
        ...(cal ? [`Add to Google Calendar: ${templateLink(cal)}`] : []),
        `Open in Radar: ${opts.appUrl}/?show=${s.id}`,
        "",
      ].join("\n");
    }),
    footer,
  ].join("\n");

  return { subject, html, text };
}
