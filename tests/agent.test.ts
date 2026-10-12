import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { candidatesFromJsonLd, candidateFromTicketmaster } from "@/lib/agent/extract";
import { pickScrapeTargets, urlsInText } from "@/lib/agent/enrich";
import { findMatch, mergeSources, mergeTiers, planUpsert } from "@/lib/agent/reconcile";
import type { Candidate } from "@/lib/agent/schemas";
import type { Bundle, EvidenceSource, ValidCandidate } from "@/lib/agent/types";
import { validateCandidates } from "@/lib/agent/validate";
import { htmlToEvidence, parseJsonLdEvents } from "@/lib/html-evidence";
import { mapTicketmasterEvents } from "@/lib/integrations/ticketmaster";
import { resolveCity } from "@/lib/normalize";
import type { ArtistRow, ShowRow, Tier } from "@/lib/types";

const NOW = new Date("2026-10-12T06:00:00Z"); // 11:30 IST
const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

const artist = { name: "Prateek Kuhad", is_favorite: false } as ArtistRow;
const URL1 = "https://www.district.in/events/prateek-kuhad";

function src(url: string, over: Partial<EvidenceSource> = {}): EvidenceSource {
  return { n: 1, url, kind: "scrapingbee", fetchedAt: NOW.toISOString(), content: "", ticketingPage: true, page: htmlToEvidence("<html></html>"), ...over };
}
const bundle = (...s: EvidenceSource[]): Bundle => ({ artist, sources: s });

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    from: "ai",
    artist_name_as_written: "Prateek Kuhad",
    is_this_artist: true,
    title: null,
    event_type: "concert",
    city: "Bangalore",
    state: null,
    country: "India",
    venue_name: "Phoenix Marketcity",
    start_date: "2026-12-14",
    end_date: null,
    start_time: "19:30",
    ticket_url: URL1,
    ticket_platform: "district",
    tiers: [],
    on_sale_at: null,
    early_bird_mentioned: false,
    status: "scheduled",
    evidence_urls: [URL1],
    evidence_quote: "x",
    ...over,
  };
}

describe("validateCandidates (hallucination guards)", () => {
  const b = bundle(src(URL1));
  const run = (c: Candidate, existing: { city_slug: string; start_date: string }[] = []) =>
    validateCandidates([c], artist, b, existing, NOW);

  it("keeps a good candidate and resolves the city alias", () => {
    const r = run(cand());
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0].cityInfo.name).toBe("Bengaluru");
    expect(r.valid[0].ticketingConfirmed).toBe(true);
  });
  it("drops namesakes", () => {
    expect(run(cand({ is_this_artist: false })).dropped[0].reason).toBe("not_this_artist");
    expect(run(cand({ artist_name_as_written: "Prateek Kuhad Tribute" })).dropped[0].reason).toBe("not_this_artist");
  });
  it("drops foreign / unknown cities", () => {
    expect(run(cand({ country: "UAE", city: "Dubai" })).dropped[0].reason).toBe("not_in_india");
    expect(run(cand({ city: "Atlantis" })).dropped[0].reason).toBe("not_in_india");
  });
  it("drops past, invalid and >18 month dates", () => {
    expect(run(cand({ start_date: "2026-10-01" })).dropped[0].reason).toBe("past_date");
    expect(run(cand({ start_date: "2026-13-45" })).dropped[0].reason).toBe("bad_date");
    expect(run(cand({ start_date: "2028-06-01" })).dropped[0].reason).toBe("too_far_out");
  });
  it("keeps today (IST) as a valid date", () => {
    expect(run(cand({ start_date: "2026-10-12" })).valid).toHaveLength(1);
  });
  it("drops evidence URLs that are not in the bundle", () => {
    expect(run(cand({ evidence_urls: ["https://made-up.example/x"] })).dropped[0].reason).toBe("evidence_not_in_bundle");
    expect(run(cand({ evidence_urls: [URL1, "https://made-up.example/x"] })).dropped[0].reason).toBe("evidence_not_in_bundle");
  });
  it("matches evidence URLs after normalisation", () => {
    expect(run(cand({ evidence_urls: ["https://district.in/events/prateek-kuhad/?utm_source=x"] })).valid).toHaveLength(1);
  });
  it("drops cancelled shows unless already known", () => {
    expect(run(cand({ status: "cancelled" })).dropped[0].reason).toBe("cancelled_unknown");
    expect(run(cand({ status: "cancelled" }), [{ city_slug: "bengaluru", start_date: "2026-12-14" }]).valid).toHaveLength(1);
  });
  it("scores confidence: ticketing page + venue = 0.8; second source adds 0.2", () => {
    expect(run(cand()).valid[0].confidence).toBe(0.8);
    const tm = cand({ from: "ticketmaster", evidence_urls: ["https://www.ticketmaster.in/e"] });
    const b2 = bundle(src(URL1), src("https://www.ticketmaster.in/e", { kind: "ticketmaster", page: undefined }));
    const r = validateCandidates([cand(), tm], artist, b2, [], NOW);
    expect(r.valid.map((v) => v.confidence)).toEqual([1, 1]);
  });
  it("gemini-only evidence is not ticketing-confirmed (0.5 with venue)", () => {
    const g = src("https://news.example.com/a", { kind: "gemini", ticketingPage: false, page: undefined });
    const r = validateCandidates([cand({ evidence_urls: [g.url] })], artist, bundle(g), [], NOW);
    expect(r.valid[0].confidence).toBe(0.5);
    expect(r.valid[0].ticketingConfirmed).toBe(false);
  });
  it("caps rule-based candidates below Likely", () => {
    const r = validateCandidates([cand({ from: "rules" })], artist, b, [], NOW);
    expect(r.valid[0].confidence).toBeLessThan(0.6);
  });
});

function valid(over: Partial<ValidCandidate> = {}): ValidCandidate {
  return { ...cand(), cityInfo: resolveCity("Bengaluru")!, confidence: 0.8, ticketingConfirmed: true, lowConfidence: false, sourceRefs: [{ url: URL1, kind: "scrapingbee", fetched_at: NOW.toISOString() }], ...over };
}
const eb = (over: Partial<Tier> = {}): Tier => ({ name: "Early Bird", price_inr: 999, status: "on_sale", sale_start: null, sale_end: new Date(NOW.getTime() + 100 * 3_600_000).toISOString(), is_early_bird: true, ...over });

function oldRow(over: Partial<ShowRow> = {}): ShowRow {
  const p = planUpsert(null, valid({ tiers: [eb()] }), artist, "Bengaluru", NOW).patch;
  return { id: "s1", artist_id: "a", decision: null, ai_brief: null, ai_brief_hash: null, is_sample: false, first_seen_at: NOW.toISOString(), venue_id: null, updated_at: NOW.toISOString(), ...p, ...over } as ShowRow;
}

describe("reconcile: change detection", () => {
  it("new show emits only new_show", () => {
    const r = planUpsert(null, valid({ tiers: [eb()] }), artist, "Bengaluru", NOW);
    expect(r.isNew).toBe(true);
    expect(r.changes).toEqual(["new_show"]);
    expect(r.patch.early_bird_status).toBe("open");
    expect(r.patch.is_home_city).toBe(true);
    expect(r.patch.dedupe_key).toBe("prateek kuhad|bengaluru|2026-12-14");
  });
  it("open -> closing_soon", () => {
    const old = oldRow();
    const soon = eb({ sale_end: new Date(NOW.getTime() + 20 * 3_600_000).toISOString() });
    const r = planUpsert(old, valid({ tiers: [soon] }), artist, "Bengaluru", NOW);
    expect(r.changes).toContain("early_bird_closing_soon");
    expect(r.isNew).toBe(false);
  });
  it("unknown -> open emits early_bird_opened and deadline_found", () => {
    const old = oldRow({ early_bird_status: "unknown", early_bird_deadline: null, tiers: [] });
    const r = planUpsert(old, valid({ tiers: [eb()] }), artist, "Bengaluru", NOW);
    expect(r.changes).toEqual(expect.arrayContaining(["early_bird_opened", "deadline_found"]));
  });
  it("early bird sold out emits tier_sold_out", () => {
    const old = oldRow();
    const r = planUpsert(old, valid({ tiers: [eb({ status: "sold_out" })] }), artist, "Bengaluru", NOW);
    expect(r.changes).toContain("tier_sold_out");
    expect(r.patch.early_bird_status).toBe("sold_out");
  });
  it("cancelled", () => {
    const r = planUpsert(oldRow(), valid({ status: "cancelled" }), artist, "Bengaluru", NOW);
    expect(r.changes).toContain("cancelled");
    expect(r.patch.status).toBe("cancelled");
  });
  it("±1 day, unconfirmed: merges silently and keeps the old date", () => {
    const r = planUpsert(oldRow(), valid({ start_date: "2026-12-15", ticketingConfirmed: false, tiers: [eb()] }), artist, "Bengaluru", NOW);
    expect(r.patch.start_date).toBe("2026-12-14");
    expect(r.changes).not.toContain("date_changed");
  });
  it("±1 day, ticketing-confirmed: adopts the new date", () => {
    const r = planUpsert(oldRow(), valid({ start_date: "2026-12-15", tiers: [eb()] }), artist, "Bengaluru", NOW);
    expect(r.patch.start_date).toBe("2026-12-15");
    expect(r.changes).toContain("date_changed");
  });
  it("venue change", () => {
    const r = planUpsert(oldRow(), valid({ venue_name: "Palace Grounds", tiers: [eb()] }), artist, "Bengaluru", NOW);
    expect(r.changes).toContain("venue_changed");
  });
  it("re-seeing identical data emits no changes", () => {
    const r = planUpsert(oldRow(), valid({ tiers: [eb()] }), artist, "Bengaluru", NOW);
    expect(r.changes).toEqual([]);
  });
  it("never wipes tiers with an empty incoming list; keeps max confidence", () => {
    const r = planUpsert(oldRow(), valid({ tiers: [], confidence: 0.5 }), artist, "Bengaluru", NOW);
    expect(r.patch.tiers).toHaveLength(1);
    expect(r.patch.confidence).toBe(0.8);
  });
});

describe("reconcile helpers", () => {
  it("findMatch: exact, then ±1 day, same city only", () => {
    const rows = [
      { id: "a", city_slug: "bengaluru", start_date: "2026-12-14" },
      { id: "b", city_slug: "mumbai", start_date: "2026-12-14" },
    ];
    expect(findMatch(rows, "bengaluru", "2026-12-14")?.id).toBe("a");
    expect(findMatch(rows, "bengaluru", "2026-12-15")?.id).toBe("a");
    expect(findMatch(rows, "bengaluru", "2026-12-16")).toBeNull();
    expect(findMatch(rows, "pune", "2026-12-14")).toBeNull();
  });
  it("mergeTiers / mergeSources", () => {
    expect(mergeTiers([eb()], [eb({ status: "sold_out" }), { ...eb(), name: "GA", is_early_bird: false }])).toHaveLength(2);
    const s = { url: "u", kind: "gemini" as const, fetched_at: "t" };
    expect(mergeSources([s], [{ ...s, kind: "scrapingbee" }, { ...s, url: "v" }])).toHaveLength(2);
  });
});

describe("Ticketmaster mapper", () => {
  const events = mapTicketmasterEvents(JSON.parse(fx("ticketmaster.json")), "Prateek Kuhad", NOW);
  it("keeps matching events only and tolerates missing fields", () => {
    expect(events.map((e) => e.name)).toEqual(["Prateek Kuhad - The Way That Lovers Do Tour", "Prateek Kuhad"]);
    expect(events[1].city).toBeNull();
    expect(events[1].venue).toBeNull();
    expect(events[1].cancelled).toBe(true);
  });
  it("maps venue, time, price and tiers", () => {
    const e = events[0];
    expect(e).toMatchObject({ city: "Bangalore", venue: "Phoenix Marketcity", startDate: "2027-02-14", startTime: "19:30", priceMinInr: 1499 });
    expect(e.tiers[0]).toMatchObject({ name: "Early Bird Presale", is_early_bird: true });
    expect(e.tiers.some((t) => t.name === "General")).toBe(true);
  });
  it("produces a deterministic candidate", () => {
    const c = candidateFromTicketmaster(events[0], artist)!;
    expect(c.from).toBe("ticketmaster");
    expect(c.evidence_urls).toEqual(["https://www.ticketmaster.in/event/prateek-kuhad-bengaluru"]);
    expect(candidateFromTicketmaster(events[1], artist)).toBeNull();
  });
  it("returns [] for garbage", () => {
    expect(mapTicketmasterEvents({ nope: true }, "x")).toEqual([]);
    expect(mapTicketmasterEvents(null, "x")).toEqual([]);
  });
});

describe("JSON-LD + HTML evidence", () => {
  const html = fx("ticket-page.html");
  it("parses Event blocks from @graph, skipping malformed JSON-LD and non-events", () => {
    const evs = parseJsonLdEvents(html);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ name: "Anuv Jain Live in Bengaluru", venue: "Palace Grounds", city: "Bengaluru" });
    expect(evs[0].offers).toHaveLength(2);
    expect(evs[0].offers[0]).toMatchObject({ name: "Early Bird", price: "1299", availability: "InStock" });
  });
  it("strips scripts/nav/footer and collapses whitespace", () => {
    const e = htmlToEvidence(html);
    expect(e.title).toBe("Anuv Jain Live in Bengaluru | District");
    expect(e.ogDescription).toBe("Early bird tickets are on sale now.");
    expect(e.text).toContain("Anuv Jain Live");
    expect(e.text).not.toContain("var x");
    expect(e.text).not.toContain("Copyright");
    expect(e.text).not.toContain("Home |");
  });
  it("truncates to the limit", () => {
    expect(htmlToEvidence(`<body>${"a ".repeat(20000)}</body>`, 15000).text.length).toBeLessThanOrEqual(15000);
  });
  it("builds rule-based candidates with tiers (used when Gemini is off)", () => {
    const a = { ...artist, name: "Anuv Jain" } as ArtistRow;
    const cs = candidatesFromJsonLd("https://www.district.in/e", parseJsonLdEvents(html), a, new Date("2026-10-05T00:00:00Z"));
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ from: "rules", city: "Bengaluru", start_date: "2027-01-17", start_time: "19:00" });
    expect(cs[0].tiers.map((t) => [t.name, t.status, t.is_early_bird])).toEqual([
      ["Early Bird", "on_sale", true],
      ["Phase 1", "upcoming", false],
    ]);
    expect(candidatesFromJsonLd("u", parseJsonLdEvents(html), artist, NOW)).toHaveLength(0); // different artist
  });
});

describe("pickScrapeTargets", () => {
  const d = {
    grounded: [
      { uri: "x", resolvedUrl: "https://www.district.in/a", domain: "district.in", title: null },
      { uri: "y", resolvedUrl: "https://blog.example.com/p", domain: "blog.example.com", title: null },
    ],
    tm: [{ url: "https://www.ticketmaster.in/e" }] as never,
    fallbackUrls: ["https://in.bookmyshow.com/z"],
    groundedText: "Tickets: https://insider.in/e1, and https://district.in/a.",
  };
  it("only allowlisted ticketing domains, de-duplicated, limited", () => {
    const t = pickScrapeTargets(d, [], NOW, 3);
    expect(t).toHaveLength(3);
    expect(t).not.toContain("https://blog.example.com/p");
  });
  it("skips pages enriched <6h ago and non-live pages; re-scrapes stale live ones", () => {
    const fresh = [{ ticket_url: "https://district.in/a", last_enriched_at: new Date(NOW.getTime() - 3_600_000).toISOString(), early_bird_status: "open" as const }];
    expect(pickScrapeTargets(d, fresh, NOW, 5)).not.toContain("https://www.district.in/a");
    const staleLive = [{ ticket_url: "https://district.in/a", last_enriched_at: new Date(NOW.getTime() - 9 * 3_600_000).toISOString(), early_bird_status: "open" as const }];
    expect(pickScrapeTargets(d, staleLive, NOW, 5)).toContain("https://www.district.in/a");
    const staleDead = [{ ticket_url: "https://district.in/a", last_enriched_at: new Date(NOW.getTime() - 9 * 3_600_000).toISOString(), early_bird_status: "sold_out" as const }];
    expect(pickScrapeTargets(d, staleDead, NOW, 5)).not.toContain("https://www.district.in/a");
  });
  it("extracts URLs from text without trailing punctuation", () => {
    expect(urlsInText("see https://a.com/x, and (https://b.com/y).")).toEqual(["https://a.com/x", "https://b.com/y"]);
  });
});
