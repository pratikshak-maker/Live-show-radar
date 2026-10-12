import { readEnv } from "../env";
import { groundedSearch } from "../integrations/gemini";
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
    d.aiAvailable = false;
    const why =
      g.reason === "not_configured"
        ? "Gemini isn't connected, so I'll use ticketing sources only."
        : g.reason === "quota_exhausted"
          ? `${g.message} Falling back to other sources.`
          : "Couldn't reach the search service — trying other sources.";
    await logger.warn("search", why, name);
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
