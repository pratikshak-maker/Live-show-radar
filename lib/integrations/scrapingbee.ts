import { z } from "zod";
import { readEnv } from "../env";
import { htmlToEvidence, type PageEvidence } from "../html-evidence";
import { addUsage, getUsageToday } from "../lock";
import { domainOf, isHttpUrl, isTicketingDomain } from "../normalize";
import { errMessage, fail, notConfigured, ok, type Result } from "../result";

const BASE = "https://app.scrapingbee.com/api/v1";
export const HTML_COST = 5; // render_js=true default cost (per ScrapingBee docs)
export const GOOGLE_COST = 15; // conservative estimate; the real header value wins when present

function auth(): Record<string, string> | null {
  const key = readEnv().SCRAPINGBEE_API_KEY;
  // The docs mark the api_key query param deprecated in favour of a Bearer header.
  return key ? { Authorization: `Bearer ${key}` } : null;
}

async function budgetOk(cost: number): Promise<boolean> {
  const used = await getUsageToday("scrapingbee");
  return used + cost <= readEnv().SCRAPINGBEE_DAILY_CREDIT_BUDGET;
}

function costFromHeaders(res: Response, fallback: number): number {
  const raw = res.headers.get("Spb-Cost") ?? res.headers.get("spb-cost");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function call(
  url: string,
  cost: number,
  timeoutMs: number,
): Promise<Result<{ res: Response; cost: number }>> {
  const headers = auth();
  if (!headers) return notConfigured("ScrapingBee");
  if (!(await budgetOk(cost))) return fail("quota_exhausted", "Scrape budget reached for today.");
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: ctl.signal });
      if (res.status >= 500 && attempt === 0) continue; // 5xx aren't billed; retry once
      if (res.status === 429) return fail("rate_limited", "ScrapingBee is rate limiting us.", 5000);
      if (res.status === 401 || res.status === 403)
        return fail("upstream_error", "ScrapingBee rejected the API key.");
      if (!res.ok) return fail("upstream_error", `ScrapingBee returned ${res.status}`); // never retry 4xx
      const spent = costFromHeaders(res, cost);
      await addUsage("scrapingbee", spent);
      return ok({ res, cost: spent });
    } catch (e) {
      if (attempt === 1)
        return fail(
          "upstream_error",
          ctl.signal.aborted ? "ScrapingBee timed out." : errMessage(e),
        );
    } finally {
      clearTimeout(t);
    }
  }
  return fail("upstream_error", "ScrapingBee failed.");
}

/** Fetch + clean a public ticketing page. Never sends cookies or credentials. */
export async function scrapePage(
  pageUrl: string,
): Promise<Result<{ evidence: PageEvidence; cost: number }>> {
  if (!isHttpUrl(pageUrl)) return fail("invalid_response", "Not a web URL.");
  const q = new URLSearchParams({
    url: pageUrl,
    render_js: "true",
    block_resources: "true",
    wait: "2000",
  });
  const r = await call(`${BASE}/?${q.toString()}`, HTML_COST, 20_000);
  if (!r.ok) return r;
  try {
    const html = await r.data.res.text();
    return ok({ evidence: htmlToEvidence(html), cost: r.data.cost });
  } catch (e) {
    return fail("upstream_error", errMessage(e));
  }
}

const GoogleSchema = z.object({
  organic_results: z
    .array(
      z.object({ title: z.string().optional(), url: z.string(), domain: z.string().optional() }),
    )
    .default([]),
});

export type SearchHit = { title: string | null; url: string; domain: string | null };

/** ScrapingBee Google Search API → organic results from ticketing/news domains. */
export async function googleSearch(query: string): Promise<Result<SearchHit[]>> {
  const q = new URLSearchParams({ search: query, country_code: "in" });
  const r = await call(`${BASE}/google?${q.toString()}`, GOOGLE_COST, 25_000);
  if (!r.ok) return r;
  try {
    const parsed = GoogleSchema.safeParse(await r.data.res.json());
    if (!parsed.success) return fail("invalid_response", "Unexpected ScrapingBee Google response");
    return ok(
      parsed.data.organic_results.map((o) => ({
        title: o.title ?? null,
        url: o.url,
        domain: o.domain ?? domainOf(o.url),
      })),
    );
  } catch (e) {
    return fail("upstream_error", errMessage(e));
  }
}

const NEWS_HINT =
  /(rollingstone|thehindu|indianexpress|hindustantimes|timesofindia|mid-day|scroll|lifestyleasia|homegrown|nh7|bandwagon|pinkvilla|ndtv)/i;

export function pickResultUrls(hits: SearchHit[], limit = 2): string[] {
  const ticketing = hits.filter((h) => isTicketingDomain(h.url));
  const news = hits.filter((h) => !isTicketingDomain(h.url) && NEWS_HINT.test(h.domain ?? ""));
  return [...ticketing, ...news].slice(0, limit).map((h) => h.url);
}
