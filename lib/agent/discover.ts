import { readEnv } from "../env";
import { groundedSearch, readUrls } from "../integrations/gemini";
import { searchNews } from "../integrations/news";
import { googleSearch, pickResultUrls } from "../integrations/scrapingbee";
import { searchEvents } from "../integrations/ticketmaster";
import { todayIST } from "../time";
import type { ArtistRow } from "../types";
import type { Discovery, RunCtx } from "./types";
import { DISCOVERY_PROMPT_V1, fill } from "./prompts";

export const NO_SHOWS_SENTINEL = "NO_INDIA_SHOWS_FOUND";

export function buildDiscoveryPrompt(artist: ArtistRow, homeCity: string, now: Date): string {
  const today = todayIST(now);
  const year = Number(today.slice(0, 4));
  return fill(DISCOVERY_PROMPT_V1, {
    TODAY_IST: today,
    ARTIST: artist.name,
    DISAMBIGUATION_LINE: artist.disambiguation ? ` (${artist.disambiguation})` : "",
    ORIGIN: artist.origin,
    HOME_CITY: homeCity,
    YEAR: String(year),
    NEXT_YEAR: String(year + 1),
  });
}

/** Stage A: three sources, merged. */
export async function discover(artist: ArtistRow, ctx: RunCtx): Promise<Discovery> {
  const { logger } = ctx;
  const name = artist.name;
  const d: Discovery = {
    groundedText: null,
    grounded: [],
    tm: [],
    fallbackUrls: [],
    noShows: false,
    aiAvailable: true,
    news: [],
    pageNotes: {},
  };

  await logger.info("search", `Searching the web for ${name} shows in India…`, name);

  // A1 — Gemini grounded search (primary)
  let a1Failed = false;
  const g = await groundedSearch(buildDiscoveryPrompt(artist, ctx.homeCity, ctx.now()), ctx.gemini);
  if (g.ok) {
    d.groundedText = g.data.text;
    d.grounded = g.data.sources;
    d.noShows = g.data.text.includes(NO_SHOWS_SENTINEL) || g.data.text.length === 0;
    ctx.stats.geminiCalls = ctx.gemini.calls;
    if (d.noShows)
      await logger.info("search", `No upcoming India shows found for ${name} in web search.`, name);
    else
      await logger.info(
        "search",
        `Web search found possible shows. Checking ${d.grounded.length} source${d.grounded.length === 1 ? "" : "s"}…`,
        name,
      );
  } else {
    a1Failed = true;
    // Grounding being off doesn't mean Gemini is off: reading pages and extraction still work.
    d.aiAvailable = g.reason !== "not_configured" && !ctx.gemini.quotaExhausted;
    if (g.reason === "not_configured") {
      await logger.warn(
        "search",
        "Gemini isn't connected, so I'll use ticketing sources only.",
        name,
      );
    } else if (!(g.reason === "quota_exhausted" && ctx.gemini.groundingBlocked)) {
      await logger.warn(
        "search",
        "Couldn't reach Google Search — searching the news instead.",
        name,
      );
    }
  }

  // A1b — Keyless news search + Gemini reads the articles (when grounding isn't available)
  if (a1Failed && d.aiAvailable) {
    const year = Number(todayIST(ctx.now()).slice(0, 4));
    const n = await searchNews(`"${name}" (concert OR tour OR gig OR live OR festival) India`);
    if (n.ok && n.data.length > 0) {
      d.news = n.data.slice(0, 6);
      await logger.info(
        "search",
        `Found ${d.news.length} recent article${d.news.length === 1 ? "" : "s"} about ${name}. Reading them…`,
        name,
      );
      const read = await readUrls(
        d.news.map((a) => a.url),
        `Today is ${todayIST(ctx.now())} (Asia/Kolkata). Tracked artist: "${name}". Report only facts about LIVE PERFORMANCES by this exact artist in INDIA happening on or after today (${year} or ${year + 1}): city, venue, date (with year), start time, event/tour/festival name, ticket platform and ticket page URLs, ticket tiers with INR prices, early-bird / pre-sale details and any sale start or end dates and times. Mention cancellations or postponements.`,
        ctx.gemini,
      );
      ctx.stats.geminiCalls = ctx.gemini.calls;
      if (read.ok) {
        for (const r of read.data.reads) if (r.notes) d.pageNotes[r.url] = r.notes;
        const useful = Object.keys(d.pageNotes).length;
        await logger.info(
          "search",
          useful > 0
            ? `Read ${useful} article${useful === 1 ? "" : "s"} with show details. Checking them…`
            : `The articles don't mention an upcoming India show for ${name}.`,
          name,
        );
      } else {
        await logger.warn(
          "search",
          `Couldn't read the articles (${read.message}). Using headlines only.`,
          name,
        );
      }
    } else if (n.ok) {
      d.noShows = true;
      await logger.info("search", `No recent news about ${name} playing in India.`, name);
    } else {
      await logger.warn("search", `News search didn't answer (${n.message}).`, name);
    }
  }

  // A2 — Ticketmaster (secondary)
  if (readEnv().TICKETMASTER_API_KEY) {
    const tm = await searchEvents(name);
    if (tm.ok) {
      d.tm = tm.data.filter((e) => e.startDate && e.city);
      if (d.tm.length > 0)
        await logger.info(
          "search",
          `Ticketmaster lists ${d.tm.length} event${d.tm.length === 1 ? "" : "s"} for ${name}.`,
          name,
        );
    } else if (tm.reason !== "not_configured") {
      await logger.warn("search", `Ticketmaster didn't answer (${tm.message}).`, name);
    }
  }

  // A3 — ScrapingBee Google Search (fallback)
  const needFallback = a1Failed || (d.noShows && artist.is_favorite);
  if (needFallback && readEnv().SCRAPINGBEE_API_KEY && !ctx.scrapeBlocked) {
    const year = todayIST(ctx.now()).slice(0, 4);
    const s = await googleSearch(`${name} concert India tickets ${year}`);
    if (s.ok) {
      d.fallbackUrls = pickResultUrls(s.data, 2);
      ctx.stats.sbCredits += 15;
      if (d.fallbackUrls.length > 0)
        await logger.info(
          "search",
          `Backup search found ${d.fallbackUrls.length} ticketing page${d.fallbackUrls.length === 1 ? "" : "s"} to read.`,
          name,
        );
    } else if (s.reason === "quota_exhausted") {
      ctx.scrapeBlocked = true;
      await logger.warn(
        "scrape",
        "Scrape budget reached for today — using search results only.",
        name,
      );
    } else if (s.reason !== "not_configured") {
      await logger.warn("search", `Backup search failed (${s.message}).`, name);
    }
  }
  return d;
}
