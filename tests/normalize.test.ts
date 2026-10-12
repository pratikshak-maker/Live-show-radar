import { describe, expect, it } from "vitest";
import {
  citySlug,
  dedupeKey,
  isTicketingDomain,
  normalizeArtist,
  normalizeUrl,
  resolveCity,
  similarity,
} from "@/lib/normalize";

describe("normalizeArtist", () => {
  it("strips diacritics, 'The', and punctuation", () => {
    expect(normalizeArtist("Sigur Rós")).toBe("sigur ros");
    expect(normalizeArtist("The Local Train")).toBe("local train");
    expect(normalizeArtist("Peter Cat Recording Co.")).toBe("peter cat recording co");
    expect(normalizeArtist("Ben Böhmer")).toBe("ben bohmer");
    expect(normalizeArtist("Rufus Du Sol")).toBe("rufus du sol");
  });
  it("treats & and 'and' alike", () => {
    expect(normalizeArtist("Simon & Garfunkel")).toBe(normalizeArtist("Simon and Garfunkel"));
  });
});

describe("similarity", () => {
  it("is 1 for same normalised names and low for different ones", () => {
    expect(similarity("The Lumineers", "Lumineers")).toBe(1);
    expect(similarity("Anuv Jain", "Anuv Jain (tribute)")).toBeLessThan(0.85);
    expect(similarity("Prateek Kuhad", "Prateek Kuhad.")).toBeGreaterThanOrEqual(0.85);
    expect(similarity("Lauv", "Lava")).toBeLessThan(0.85);
  });
});

describe("resolveCity", () => {
  const cases: [string, string][] = [
    ["Bangalore", "Bengaluru"],
    ["BLR", "Bengaluru"],
    ["Bengaluru, Karnataka", "Bengaluru"],
    ["Bombay", "Mumbai"],
    ["Navi Mumbai", "Mumbai"],
    ["Thane", "Mumbai"],
    ["New Delhi", "Delhi NCR"],
    ["Gurgaon", "Delhi NCR"],
    ["Gurugram", "Delhi NCR"],
    ["Noida", "Delhi NCR"],
    ["NCR", "Delhi NCR"],
    ["Madras", "Chennai"],
    ["Calcutta", "Kolkata"],
    ["Secunderabad", "Hyderabad"],
    ["Pune", "Pune"],
    ["Vagator", "Goa"],
    ["Anjuna", "Goa"],
    ["Panaji", "Goa"],
    ["Assagao", "Goa"],
    ["Cochin", "Kochi"],
    ["Ernakulam", "Kochi"],
    ["Mysore", "Mysuru"],
    ["Vizag", "Visakhapatnam"],
    ["Trivandrum", "Thiruvananthapuram"],
    ["Pondicherry", "Puducherry"],
    ["Shillong", "Shillong"],
    ["Dharamshala", "Dharamshala"],
  ];
  it.each(cases)("%s -> %s", (alias, canonical) => {
    expect(resolveCity(alias)?.name).toBe(canonical);
  });
  it("returns null for non-Indian / unknown cities", () => {
    expect(resolveCity("London")).toBeNull();
    expect(resolveCity("Dubai")).toBeNull();
    expect(resolveCity(null)).toBeNull();
  });
  it("provides coordinates and a slug", () => {
    const c = resolveCity("Bangalore");
    expect(c?.slug).toBe("bengaluru");
    expect(c?.lat).toBeCloseTo(12.97, 1);
  });
});

describe("dedupeKey", () => {
  it("is artistNorm|slug|date", () => {
    expect(dedupeKey("The Local Train", citySlug("Bangalore"), "2026-12-14")).toBe(
      "local train|bengaluru|2026-12-14",
    );
  });
});

describe("urls", () => {
  it("recognises ticketing domains incl. subdomains", () => {
    expect(isTicketingDomain("https://www.district.in/events/x")).toBe(true);
    expect(isTicketingDomain("https://in.bookmyshow.com/x")).toBe(true);
    expect(isTicketingDomain("https://evil-district.in.example.com/x")).toBe(false);
    expect(isTicketingDomain(null)).toBe(false);
  });
  it("normalises tracking params, www and trailing slash", () => {
    expect(normalizeUrl("https://www.District.in/a/?utm_source=x#top")).toBe(
      "https://district.in/a",
    );
  });
});
