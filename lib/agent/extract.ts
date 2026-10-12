import { isEarlyBirdName } from "../early-bird";
import type { JsonLdEvent } from "../html-evidence";
import { generateJson } from "../integrations/gemini";
import type { TmEvent } from "../integrations/ticketmaster";
import { domainOf, normalizeArtist, resolveCity } from "../normalize";
import { istParts, todayIST } from "../time";
import type { ArtistRow, Tier } from "../types";
import { evidenceBlocks } from "./enrich";
import { EXTRACTION_PROMPT_V1, fill } from "./prompts";
import { ExtractionSchema, GEMINI_EXTRACTION_SCHEMA, type Candidate } from "./schemas";
import type { Bundle, Discovery, RunCtx } from "./types";

/** Deterministic mapping of a Ticketmaster event into a candidate (no AI involved). */
export function candidateFromTicketmaster(e: TmEvent, artist: ArtistRow): Candidate | null {
  if (!e.startDate || !e.city) return null;
  const url = e.url ?? "https://www.ticketmaster.in/";
  return {
    from: "ticketmaster",
    artist_name_as_written: artist.name,
    is_this_artist: true,
    title: e.name,
    event_type: "concert",
    city: e.city,
    state: e.state,
    country: "India",
    venue_name: e.venue,
    start_date: e.startDate,
    end_date: null,
    start_time: e.startTime,
    ticket_url: e.url,
    ticket_platform: "ticketmaster",
    tiers: e.tiers,
    on_sale_at: e.onSaleAt,
    early_bird_mentioned: e.tiers.some((t) => t.is_early_bird),
    status: e.cancelled ? "cancelled" : "scheduled",
    evidence_urls: [url],
    evidence_quote: `Listed on Ticketmaster: ${e.name}`.slice(0, 300),
  };
}

function offerStatus(
  availability: string | null,
  validFrom: string | null,
  now: Date,
): Tier["status"] {
  const a = (availability ?? "").toLowerCase();
  if (a.includes("soldout") || a.includes("outofstock")) return "sold_out";
  if (
    a.includes("preorder") ||
    a.includes("presale") ||
    (validFrom && new Date(validFrom).getTime() > now.getTime())
  )
    return "upcoming";
  if (a.includes("instock") || a.includes("onlineonly") || a.includes("limitedavailability"))
    return "on_sale";
  return "unknown";
}

/** Rule-based candidates from JSON-LD on a scraped ticketing page (used when Gemini is unavailable). */
export function candidatesFromJsonLd(
  pageUrl: string,
  events: JsonLdEvent[],
  artist: ArtistRow,
  now: Date,
): Candidate[] {
  const norm = normalizeArtist(artist.name);
  const out: Candidate[] = [];
  for (const ev of events) {
    if (!ev.startDate || !ev.name) continue;
    const titleNorm = normalizeArtist(ev.name);
    if (!` ${titleNorm} `.includes(` ${norm} `)) continue; // page event must be about this artist
    const city = resolveCity(ev.city ?? "");
    const { date, time } = ev.startDate.includes("T")
      ? istParts(new Date(ev.startDate))
      : { date: ev.startDate.slice(0, 10), time: "" };
    const tiers: Tier[] = ev.offers.map((o) => ({
      name: o.name ?? "Ticket",
      price_inr:
        o.price && /^\d+(\.\d+)?$/.test(o.price) && (!o.currency || o.currency === "INR")
          ? Math.round(Number(o.price))
          : null,
      status: offerStatus(o.availability, o.validFrom, now),
      sale_start: o.validFrom,
      sale_end: o.validThrough,
      is_early_bird: isEarlyBirdName(o.name ?? ""),
    }));
    out.push({
      from: "rules",
      artist_name_as_written: artist.name,
      is_this_artist: true,
      title: ev.name,
      event_type: "concert",
      city: city?.name ?? ev.city ?? "",
      state: city?.state ?? null,
      country: city ? "India" : "Unknown",
      venue_name: ev.venue,
      start_date: date,
      end_date: null,
      start_time: time || null,
      ticket_url: pageUrl,
      ticket_platform: domainOf(pageUrl)?.split(".")[0] ?? null,
      tiers,
      on_sale_at: null,
      early_bird_mentioned: tiers.some((t) => t.is_early_bird),
      status: "scheduled",
      evidence_urls: [pageUrl],
      evidence_quote: `JSON-LD Event on the ticket page: ${ev.name}`.slice(0, 300),
    });
  }
  return out;
}

/** Stage C: Gemini JSON-mode extraction + deterministic mapping of structured sources. */
export async function extract(
  artist: ArtistRow,
  d: Discovery,
  bundle: Bundle,
  ctx: RunCtx,
): Promise<Candidate[]> {
  const { logger } = ctx;
  const name = artist.name;
  const out: Candidate[] = [];

  // Deterministic sources always pass through.
  for (const e of d.tm) {
    const c = candidateFromTicketmaster(e, artist);
    if (c) out.push(c);
  }

  const hasText = bundle.sources.some((s) => s.kind !== "ticketmaster");
  let aiRan = false;
  if (
    d.aiAvailable &&
    hasText &&
    !(d.noShows && bundle.sources.every((s) => s.kind === "gemini" || s.kind === "ticketmaster")) &&
    !ctx.gemini.exhausted
  ) {
    const prompt = fill(EXTRACTION_PROMPT_V1, {
      TODAY_IST: todayIST(ctx.now()),
      ARTIST: name,
      DISAMBIGUATION_LINE: artist.disambiguation ? ` (${artist.disambiguation})` : "",
      HOME_CITY: ctx.homeCity,
      EVIDENCE_BLOCKS: evidenceBlocks(bundle),
    });
    const r = await generateJson(prompt, GEMINI_EXTRACTION_SCHEMA, ExtractionSchema, ctx.gemini);
    ctx.stats.geminiCalls = ctx.gemini.calls;
    if (r.ok) {
      aiRan = true;
      for (const s of r.data.data.shows) out.push({ ...s, from: "ai" });
      await logger.info(
        "extract",
        `Found ${r.data.data.shows.length} possible show${r.data.data.shows.length === 1 ? "" : "s"}. Checking sources…`,
        name,
      );
    } else {
      await logger.warn(
        "extract",
        `Couldn't read the search results reliably (${r.message}). Skipping AI results for this run.`,
        name,
      );
    }
  }

  // Rule-based fallback when AI didn't run: parse JSON-LD from scraped pages.
  if (!aiRan) {
    for (const s of bundle.sources) {
      if (s.page && s.page.jsonLdEvents.length > 0)
        out.push(...candidatesFromJsonLd(s.url, s.page.jsonLdEvents, artist, ctx.now()));
    }
  }
  return out;
}
