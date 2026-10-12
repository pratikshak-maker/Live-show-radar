import { evidenceToText } from "../html-evidence";
import { scrapePage } from "../integrations/scrapingbee";
import { isTicketingDomain, normalizeUrl } from "../normalize";
import type { ArtistRow, ShowRow } from "../types";
import type { Bundle, Discovery, EvidenceSource, RunCtx } from "./types";

const SIX_HOURS = 6 * 3_600_000;
const LIVE = new Set(["open", "closing_soon", "imminent"]);

export function urlsInText(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s)\]>"'<]+/g)].map((m) => m[0].replace(/[.,;]+$/, ""));
}

/** Which ticketing URLs deserve a (paid) scrape this run. Pure; unit-tested. */
export function pickScrapeTargets(
  d: Pick<Discovery, "grounded" | "tm" | "fallbackUrls" | "groundedText">,
  existing: Pick<ShowRow, "ticket_url" | "last_enriched_at" | "early_bird_status">[],
  now: Date,
  limit = 3,
): string[] {
  const pool = [
    ...d.grounded.map((g) => g.resolvedUrl),
    ...d.tm.map((e) => e.url).filter((u): u is string => Boolean(u)),
    ...d.fallbackUrls,
    ...urlsInText(d.groundedText ?? ""),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of pool) {
    if (!isTicketingDomain(url)) continue;
    const key = normalizeUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    const known = existing.find((s) => s.ticket_url && normalizeUrl(s.ticket_url) === key);
    if (known && known.last_enriched_at) {
      const fresh = now.getTime() - new Date(known.last_enriched_at).getTime() < SIX_HOURS;
      if (fresh || !LIVE.has(known.early_bird_status)) continue; // only re-scrape live early-bird shows
    }
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

/** Stage B: scrape ticketing pages, then assemble the evidence bundle for extraction. */
export async function enrich(
  artist: ArtistRow,
  d: Discovery,
  existing: ShowRow[],
  ctx: RunCtx,
): Promise<Bundle> {
  const { logger } = ctx;
  const name = artist.name;
  const sources: EvidenceSource[] = [];
  const now = ctx.now().toISOString();
  let n = 1;

  // Gemini grounded text: one citable block per grounded source.
  d.grounded.forEach((g, i) => {
    sources.push({
      n: n++,
      url: g.resolvedUrl,
      kind: "gemini",
      fetchedAt: now,
      title: g.title ?? undefined,
      ticketingPage: false,
      content:
        i === 0
          ? `Research notes (Google-grounded):\n${d.groundedText ?? ""}`
          : `Cited by the research notes above${g.title ? ` (page title: ${g.title})` : ""}.`,
    });
  });

  // Ticketmaster events (structured)
  for (const e of d.tm) {
    sources.push({
      n: n++,
      url: e.url ?? "https://www.ticketmaster.in/",
      kind: "ticketmaster",
      fetchedAt: now,
      title: e.name,
      ticketingPage: true,
      content: `Ticketmaster event: ${e.name} | ${e.startDate ?? "?"} ${e.startTime ?? ""} | ${e.venue ?? "?"}, ${e.city ?? "?"} | ${e.cancelled ? "CANCELLED" : "scheduled"}${
        e.tiers.length
          ? " | tiers: " +
            e.tiers
              .map(
                (t) =>
                  `${t.name} (${t.status}${t.sale_start ? ", from " + t.sale_start : ""}${t.sale_end ? ", until " + t.sale_end : ""})`,
              )
              .join("; ")
          : ""
      }${e.priceMinInr ? ` | from INR ${e.priceMinInr}` : ""}`,
    });
  }

  // ScrapingBee pages
  const targets = ctx.scrapeBlocked ? [] : pickScrapeTargets(d, existing, ctx.now());
  for (const url of targets) {
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* keep raw */
    }
    await logger.info("scrape", `Reading the ${host} ticket page…`, name);
    const r = await scrapePage(url);
    if (r.ok) {
      ctx.stats.sbCredits += r.data.cost;
      sources.push({
        n: n++,
        url,
        kind: "scrapingbee",
        fetchedAt: ctx.now().toISOString(),
        title: r.data.evidence.title ?? undefined,
        ticketingPage: true,
        content: evidenceToText(r.data.evidence),
        page: r.data.evidence,
      });
    } else if (r.reason === "quota_exhausted") {
      ctx.scrapeBlocked = true;
      await logger.warn(
        "scrape",
        "Scrape budget reached for today — using search results only.",
        name,
      );
      break;
    } else if (r.reason === "not_configured") {
      break;
    } else {
      await logger.warn(
        "scrape",
        `Couldn't read ${host} (${r.message}). Using search results instead.`,
        name,
      );
    }
  }
  return { artist, sources };
}

export function evidenceBlocks(bundle: Bundle): string {
  return bundle.sources
    .map((s) => `[SOURCE ${s.n}] url=${s.url} kind=${s.kind} fetched=${s.fetchedAt}\n${s.content}`)
    .join("\n\n");
}
