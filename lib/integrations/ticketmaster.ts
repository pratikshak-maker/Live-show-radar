import { z } from "zod";
import { readEnv } from "../env";
import { errMessage, fail, notConfigured, ok, type Result } from "../result";
import { similarity } from "../normalize";
import { fetchWithTimeout } from "../throttle";
import { EARLY_BIRD_RE } from "../early-bird";
import type { Tier } from "../types";

// Every field is optional — Ticketmaster coverage in India is thin and inconsistent.
const EventSchema = z
  .object({
    name: z.string().optional(),
    url: z.string().optional(),
    dates: z
      .object({
        start: z.object({ localDate: z.string().optional(), localTime: z.string().optional() }).partial().optional(),
        status: z.object({ code: z.string().optional() }).partial().optional(),
      })
      .partial()
      .optional(),
    sales: z
      .object({
        public: z.object({ startDateTime: z.string().optional(), endDateTime: z.string().optional() }).partial().optional(),
        presales: z
          .array(z.object({ name: z.string().optional(), startDateTime: z.string().optional(), endDateTime: z.string().optional() }))
          .optional(),
      })
      .partial()
      .optional(),
    priceRanges: z.array(z.object({ min: z.number().optional(), max: z.number().optional(), currency: z.string().optional() })).optional(),
    _embedded: z
      .object({
        venues: z.array(z.object({ name: z.string().optional(), city: z.object({ name: z.string().optional() }).partial().optional(), state: z.object({ name: z.string().optional() }).partial().optional() })).optional(),
        attractions: z.array(z.object({ name: z.string().optional() })).optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

const ResponseSchema = z.object({
  _embedded: z.object({ events: z.array(EventSchema).default([]) }).partial().optional(),
});

export type TmEvent = {
  name: string;
  url: string | null;
  city: string | null;
  state: string | null;
  venue: string | null;
  startDate: string | null;
  startTime: string | null;
  cancelled: boolean;
  onSaleAt: string | null;
  tiers: Tier[];
  priceMinInr: number | null;
};

/** Pure mapper (unit-tested against a fixture with missing optional fields). */
export function mapTicketmasterEvents(json: unknown, artistName: string, now: Date = new Date()): TmEvent[] {
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) return [];
  const events = parsed.data._embedded?.events ?? [];
  const out: TmEvent[] = [];
  for (const e of events) {
    const attractions = e._embedded?.attractions?.map((a) => a.name ?? "") ?? [];
    const matches = [...attractions, e.name ?? ""].some((n) => n && similarity(n, artistName) >= 0.85);
    if (!matches) continue;
    const venue = e._embedded?.venues?.[0];
    const status = (e.dates?.status?.code ?? "").toLowerCase();
    const tiers: Tier[] = [];
    for (const p of e.sales?.presales ?? []) {
      const start = p.startDateTime ? new Date(p.startDateTime) : null;
      const end = p.endDateTime ? new Date(p.endDateTime) : null;
      let st: Tier["status"] = "unknown";
      if (start && start.getTime() > now.getTime()) st = "upcoming";
      else if (end && end.getTime() > now.getTime()) st = "on_sale";
      else if (start) st = end ? "sold_out" : "on_sale";
      tiers.push({
        name: p.name || "Presale",
        price_inr: null,
        status: end && end.getTime() <= now.getTime() ? "unknown" : st,
        sale_start: p.startDateTime ?? null,
        sale_end: p.endDateTime ?? null,
        is_early_bird: EARLY_BIRD_RE.test(p.name || "presale"),
      });
    }
    const min = e.priceRanges?.filter((p) => !p.currency || p.currency.toUpperCase() === "INR").map((p) => p.min).filter((n): n is number => typeof n === "number");
    const priceMinInr = min && min.length > 0 ? Math.round(Math.min(...min)) : null;
    const pub = e.sales?.public;
    if (pub?.startDateTime) {
      const start = new Date(pub.startDateTime);
      const end = pub.endDateTime ? new Date(pub.endDateTime) : null;
      tiers.push({
        name: "General",
        price_inr: priceMinInr,
        status: start.getTime() > now.getTime() ? "upcoming" : end && end.getTime() <= now.getTime() ? "unknown" : "on_sale",
        sale_start: pub.startDateTime,
        sale_end: pub.endDateTime ?? null,
        is_early_bird: false,
      });
    }
    out.push({
      name: e.name ?? artistName,
      url: e.url ?? null,
      city: venue?.city?.name ?? null,
      state: venue?.state?.name ?? null,
      venue: venue?.name ?? null,
      startDate: e.dates?.start?.localDate ?? null,
      startTime: e.dates?.start?.localTime?.slice(0, 5) ?? null,
      cancelled: status === "cancelled" || status === "canceled",
      onSaleAt: pub?.startDateTime ?? null,
      tiers,
      priceMinInr,
    });
  }
  return out;
}

export async function searchEvents(artistName: string): Promise<Result<TmEvent[]>> {
  const key = readEnv().TICKETMASTER_API_KEY;
  if (!key) return notConfigured("Ticketmaster");
  try {
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(key)}&keyword=${encodeURIComponent(artistName)}&countryCode=IN&classificationName=music&size=20&sort=date,asc`;
    const res = await fetchWithTimeout(url, { timeoutMs: 10_000 });
    if (res.status === 429) return fail("rate_limited", "Ticketmaster is rate limiting us.", 2000);
    if (res.status === 401) return fail("upstream_error", "Ticketmaster rejected the API key.");
    if (!res.ok) return fail("upstream_error", `Ticketmaster returned ${res.status}`);
    return ok(mapTicketmasterEvents(await res.json(), artistName)); // empty is normal for India
  } catch (e) {
    return fail("upstream_error", errMessage(e));
  }
}
