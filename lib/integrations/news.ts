import * as cheerio from "cheerio";
import { errMessage, fail, ok, type Result } from "../result";
import { fetchWithTimeout } from "../throttle";

export type NewsItem = {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  domain: string | null;
};

const domainOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** Bing News RSS wraps article links in an apiclick redirect; the real URL is its `url` parameter. */
export function unwrapBingLink(link: string): string {
  try {
    const u = new URL(link);
    const real = u.searchParams.get("url");
    return real && /^https?:\/\//.test(real) ? real : link;
  } catch {
    return link;
  }
}

/** Pure: parse a Bing News RSS document (unit-tested). */
export function parseNewsRss(xml: string): NewsItem[] {
  const $ = cheerio.load(xml, { xml: true });
  return $("item")
    .map((_i, el) => {
      const link = unwrapBingLink($(el).find("link").first().text().trim());
      const date = $(el).find("pubDate").first().text().trim();
      const parsed = date ? new Date(date) : null;
      return {
        title: $(el).find("title").first().text().trim(),
        url: link,
        snippet: $(el).find("description").first().text().replace(/\s+/g, " ").trim().slice(0, 400),
        publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
        domain: domainOf(link),
      };
    })
    .get()
    .filter((n: NewsItem) => n.title && /^https?:\/\//.test(n.url));
}

/**
 * Keyless web discovery used when Gemini's Google Search grounding isn't available on the key's plan.
 * Bing News RSS (personal, non-commercial use — this is a personal alert tool) returns recent articles
 * with direct links that Gemini's URL-context tool can then read.
 */
export async function searchNews(query: string, maxAgeDays = 240): Promise<Result<NewsItem[]>> {
  try {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&mkt=en-IN`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: 10_000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LiveShowRadar/1.0)",
        Accept: "application/rss+xml",
      },
    });
    if (!res.ok) return fail("upstream_error", `News search returned ${res.status}`);
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const items = parseNewsRss(await res.text()).filter(
      (n) => !n.publishedAt || new Date(n.publishedAt).getTime() >= cutoff,
    );
    // Newest first, one article per domain+title.
    const seen = new Set<string>();
    return ok(
      items
        .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
        .filter((n) => (seen.has(n.title) ? false : (seen.add(n.title), true))),
    );
  } catch (e) {
    return fail("upstream_error", errMessage(e));
  }
}
