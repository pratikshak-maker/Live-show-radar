import * as cheerio from "cheerio";

export type JsonLdEvent = {
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  venue: string | null;
  city: string | null;
  offers: {
    name: string | null;
    price: string | null;
    currency: string | null;
    availability: string | null;
    validFrom: string | null;
    validThrough: string | null;
    url: string | null;
  }[];
};

export type PageEvidence = {
  title: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  jsonLdEvents: JsonLdEvent[];
  text: string;
};

const str = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
};
const arr = <T>(v: T | T[] | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function isEventType(t: unknown): boolean {
  return arr(t as string | string[]).some((x) => typeof x === "string" && /Event$/.test(x));
}

function collectEvents(node: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(node)) return node.forEach((n) => collectEvents(n, out));
  if (!isObj(node)) return;
  if (isEventType(node["@type"])) out.push(node);
  if (node["@graph"]) collectEvents(node["@graph"], out);
}

function toEvent(e: Record<string, unknown>): JsonLdEvent {
  const loc = arr(e.location as unknown)[0];
  const locObj = isObj(loc) ? loc : null;
  const addr = locObj && isObj(locObj.address) ? locObj.address : null;
  const offers = arr(e.offers as unknown)
    .filter(isObj)
    .map((o) => ({
      name: str(o.name),
      price: str(o.price),
      currency: str(o.priceCurrency),
      availability: str(o.availability)?.replace(/^https?:\/\/schema\.org\//, "") ?? null,
      validFrom: str(o.validFrom),
      validThrough: str(o.validThrough),
      url: str(o.url),
    }));
  return {
    name: str(e.name),
    startDate: str(e.startDate),
    endDate: str(e.endDate),
    venue: locObj ? str(locObj.name) : null,
    city: addr ? (str(addr.addressLocality) ?? str(addr.addressRegion)) : null,
    offers,
  };
}

/** Parse JSON-LD Event blocks (also inside @graph / arrays). Malformed blocks are skipped. */
export function parseJsonLdEvents(html: string): JsonLdEvent[] {
  const $ = cheerio.load(html);
  const found: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      collectEvents(JSON.parse(raw), found);
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  return found.map(toEvent);
}

export function htmlToEvidence(html: string, maxChars = 15_000): PageEvidence {
  const jsonLdEvents = parseJsonLdEvents(html);
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim() || null;
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || null;
  const ogDescription = $('meta[property="og:description"]').attr("content")?.trim() || null;
  $("script, style, noscript, svg, nav, footer").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, maxChars);
  return { title, ogTitle, ogDescription, jsonLdEvents, text };
}

/** Render a page's evidence as plain text for the extraction prompt. */
export function evidenceToText(e: PageEvidence): string {
  const lines: string[] = [];
  if (e.title) lines.push(`Title: ${e.title}`);
  if (e.ogTitle) lines.push(`og:title: ${e.ogTitle}`);
  if (e.ogDescription) lines.push(`og:description: ${e.ogDescription}`);
  for (const ev of e.jsonLdEvents) {
    lines.push(
      `JSON-LD Event: ${ev.name ?? "?"} | start ${ev.startDate ?? "?"} | venue ${ev.venue ?? "?"} | city ${ev.city ?? "?"}`,
    );
    for (const o of ev.offers) {
      lines.push(
        `  offer: ${o.name ?? "ticket"} | price ${o.price ?? "?"} ${o.currency ?? ""} | ${o.availability ?? "?"} | from ${o.validFrom ?? "?"} | until ${o.validThrough ?? "?"}`,
      );
    }
  }
  lines.push("Page text:", e.text);
  return lines.join("\n");
}
