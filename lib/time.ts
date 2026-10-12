import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const IST = "Asia/Kolkata";

export function todayIST(now: Date = new Date()): string {
  return formatInTimeZone(now, IST, "yyyy-MM-dd");
}

/** Add days to a YYYY-MM-DD string (calendar arithmetic, tz-free). */
export function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonthsISO(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function diffDaysISO(a: string, b: string): number {
  return Math.round(
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

/** "Sat 14 Dec" */
export function fmtDay(dateISO: string): string {
  return formatInTimeZone(new Date(`${dateISO}T12:00:00+05:30`), IST, "EEE d MMM");
}

/** "Fri 6 Dec, 11:59 PM" */
export function fmtDateTime(d: Date | string): string {
  return formatInTimeZone(new Date(d), IST, "EEE d MMM, h:mm a");
}

/** "7:30 PM" from "19:30" */
export function fmtTime(hhmm: string | null | undefined): string | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/** Combine a local IST date + "HH:mm" into a UTC Date. */
export function istToDate(dateISO: string, hhmm = "00:00"): Date {
  return fromZonedTime(`${dateISO}T${hhmm}:00`, IST);
}

export function istParts(d: Date): { date: string; time: string } {
  return { date: formatInTimeZone(d, IST, "yyyy-MM-dd"), time: formatInTimeZone(d, IST, "HH:mm") };
}

/** "about 5 hours left". Returns null if the instant is past. */
export function timeLeftPhrase(target: Date | string, now: Date = new Date()): string | null {
  const ms = new Date(target).getTime() - now.getTime();
  if (ms <= 0) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `about ${Math.max(mins, 1)} minute${mins === 1 ? "" : "s"} left`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `about ${hours} hour${hours === 1 ? "" : "s"} left`;
  return `about ${Math.round(hours / 24)} days left`;
}

/** Compact countdown for the ticket stub: "5h 12m", "2d 4h". */
export function countdownParts(target: Date | string, now: Date = new Date()): string | null {
  const ms = new Date(target).getTime() - now.getTime();
  if (ms <= 0) return null;
  const mins = Math.floor(ms / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function relativeAgo(d: Date | string | null | undefined, now: Date = new Date()): string {
  if (!d) return "never";
  const mins = Math.floor((now.getTime() - new Date(d).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
