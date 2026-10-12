import { formatInTimeZone } from "date-fns-tz";
import { addDaysISO, fmtDateTime, IST, istToDate, todayIST } from "./time";
import { confidenceLabel } from "./scoring";
import type { AiBrief, ShowWithArtist } from "./types";

export type CalendarKind = "concert" | "early_bird_deadline" | "on_sale" | "decide_reminder";

export type CalEvent = {
  kind: CalendarKind;
  summary: string;
  description: string;
  location?: string;
  allDay: boolean;
  /** Timed events: UTC instants. All-day: `date` strings (end exclusive, per Google/iCal). */
  start: Date;
  end: Date;
  startDate?: string;
  endDate?: string;
  reminderMinutes: number[];
};

const MIN = 60_000;
const HOUR = 3_600_000;

function baseDescription(show: ShowWithArtist, appUrl: string, extra?: string): string {
  const lines: string[] = [];
  if (extra) lines.push(extra, "");
  if (show.ticket_url) lines.push(`Tickets: ${show.ticket_url}`);
  const src = show.sources.slice(0, 3).map((s) => s.url);
  if (src.length) lines.push(`Sources: ${src.join(", ")}`);
  lines.push(`Confidence: ${confidenceLabel(Number(show.confidence))}`);
  lines.push(`Open in Radar: ${appUrl}/?show=${show.id}`);
  lines.push("Added by Live Show Radar");
  return lines.join("\n");
}

/** Pure: which calendar events exist for this show right now. Unit-tested. */
export function buildCalendarEvents(
  show: ShowWithArtist,
  appUrl: string,
  now: Date = new Date(),
  brief?: Pick<AiBrief, "headline" | "reasons"> | null,
): Partial<Record<CalendarKind, CalEvent>> {
  const out: Partial<Record<CalendarKind, CalEvent>> = {};
  const artist = show.artist.name;
  const place = show.venue_name ?? show.city;

  // Concert
  const location = [show.venue_name, show.city].filter(Boolean).join(", ");
  if (show.start_time) {
    const start = istToDate(show.start_date, show.start_time.slice(0, 5));
    out.concert = {
      kind: "concert",
      summary: `🎵 ${artist} — ${place}`,
      description: baseDescription(show, appUrl),
      location,
      allDay: false,
      start,
      end: new Date(start.getTime() + 3 * HOUR),
      reminderMinutes: [1440, 180],
    };
  } else {
    const start = istToDate(show.start_date);
    out.concert = {
      kind: "concert",
      summary: `🎵 ${artist} — ${place}`,
      description: baseDescription(show, appUrl, "Start time to be confirmed."),
      location,
      allDay: true,
      start,
      end: istToDate(addDaysISO(show.start_date, 1)),
      startDate: show.start_date,
      endDate: addDaysISO(show.start_date, 1),
      reminderMinutes: [1440, 180],
    };
  }

  // Early-bird deadline (only if one is known and still ahead)
  const deadline = show.early_bird_deadline ? new Date(show.early_bird_deadline) : null;
  if (deadline && deadline.getTime() > now.getTime()) {
    let start = new Date(deadline.getTime() - 30 * MIN);
    let end = deadline;
    if (start.getTime() <= now.getTime()) {
      start = new Date(now.getTime() + MIN);
      end = new Date(Math.max(deadline.getTime(), start.getTime() + 15 * MIN));
    }
    out.early_bird_deadline = {
      kind: "early_bird_deadline",
      summary: `⏰ Early bird closes — ${artist} (${show.city})`,
      description: baseDescription(show, appUrl, `Early bird closes ${fmtDateTime(deadline)} IST.`),
      location,
      allDay: false,
      start,
      end,
      reminderMinutes: [1440, 180, 30],
    };
  }

  // Tickets go live
  const onSale = show.on_sale_at ? new Date(show.on_sale_at) : null;
  if (onSale && onSale.getTime() > now.getTime()) {
    out.on_sale = {
      kind: "on_sale",
      summary: `🎟️ Tickets go live — ${artist} (${show.city})`,
      description: baseDescription(show, appUrl, `Tickets go on sale ${fmtDateTime(onSale)} IST.`),
      allDay: false,
      start: onSale,
      end: new Date(onSale.getTime() + 30 * MIN),
      reminderMinutes: [60, 10],
    };
  }

  // Decide reminder: 6h before the early-bird deadline, else tomorrow 10:00 IST
  let when: Date;
  if (deadline && deadline.getTime() > now.getTime()) {
    when = new Date(deadline.getTime() - 6 * HOUR);
    if (when.getTime() <= now.getTime()) when = new Date(now.getTime() + 5 * MIN);
  } else {
    when = istToDate(addDaysISO(todayIST(now), 1), "10:00");
  }
  const briefLines = brief
    ? `${brief.headline}\n${brief.reasons.map((r) => `• ${r}`).join("\n")}`
    : undefined;
  out.decide_reminder = {
    kind: "decide_reminder",
    summary: `🤔 Decide: ${artist} in ${show.city}?`,
    description: baseDescription(show, appUrl, briefLines),
    allDay: false,
    start: when,
    end: new Date(when.getTime() + 15 * MIN),
    reminderMinutes: [0],
  };
  return out;
}

/** Pre-filled "Add to Google Calendar" link — needs no setup. */
export function templateLink(e: CalEvent): string {
  const fmt = (d: Date) => formatInTimeZone(d, IST, "yyyyMMdd'T'HHmmss");
  const dates = e.allDay
    ? `${e.startDate?.replaceAll("-", "")}/${e.endDate?.replaceAll("-", "")}`
    : `${fmt(e.start)}/${fmt(e.end)}`;
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: e.summary,
    dates,
    details: e.description,
    ctz: IST,
  });
  if (e.location) p.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** Google Calendar API request body for events.insert. */
export function toGoogleEvent(e: CalEvent, sourceUrl: string): Record<string, unknown> {
  return {
    summary: e.summary,
    description: e.description,
    location: e.location,
    start: e.allDay ? { date: e.startDate } : { dateTime: e.start.toISOString(), timeZone: IST },
    end: e.allDay ? { date: e.endDate } : { dateTime: e.end.toISOString(), timeZone: IST },
    source: { title: "Live Show Radar", url: sourceUrl },
    reminders: {
      useDefault: false,
      overrides: e.reminderMinutes.map((minutes) => ({ method: "popup", minutes })),
    },
  };
}
