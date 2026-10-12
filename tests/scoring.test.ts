import { describe, expect, it } from "vitest";
import {
  confidenceLabel,
  confidenceScore,
  deriveEarlyBird,
  laneFor,
  priorityScore,
} from "@/lib/scoring";
import type { Tier } from "@/lib/types";

const NOW = new Date("2026-12-01T10:00:00Z");
const h = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

const eb = (over: Partial<Tier> = {}): Tier => ({
  name: "Early Bird",
  price_inr: 999,
  status: "on_sale",
  sale_start: null,
  sale_end: null,
  is_early_bird: true,
  ...over,
});
const ga: Tier = { name: "GA", price_inr: 1999, status: "on_sale", sale_start: null, sale_end: null, is_early_bird: false };

describe("deriveEarlyBird", () => {
  it("unknown when no tier data at all", () => {
    expect(deriveEarlyBird([], null, NOW).status).toBe("unknown");
  });
  it("not_offered when there are tiers but none early bird and none mentioned", () => {
    expect(deriveEarlyBird([ga], null, NOW).status).toBe("not_offered");
  });
  it("unknown when early bird is mentioned but no tier carries it", () => {
    expect(deriveEarlyBird([ga], null, NOW, true).status).toBe("unknown");
  });
  it("sold_out when the early-bird tier is sold out", () => {
    expect(deriveEarlyBird([eb({ status: "sold_out" })], null, NOW).status).toBe("sold_out");
  });
  it("imminent when the tier is upcoming, deadline = sale_start", () => {
    const r = deriveEarlyBird([eb({ status: "upcoming", sale_start: h(30) })], null, NOW);
    expect(r).toEqual({ status: "imminent", deadline: h(30) });
  });
  it("imminent when sale_start is in the future even if status says on_sale", () => {
    expect(deriveEarlyBird([eb({ sale_start: h(5) })], null, NOW).status).toBe("imminent");
  });
  it("imminent via on_sale_at in the future", () => {
    const r = deriveEarlyBird([eb({ status: "upcoming" })], h(10), NOW);
    expect(r.status).toBe("imminent");
    expect(r.deadline).toBe(h(10));
  });
  it("open when on sale with sale_end far away", () => {
    const r = deriveEarlyBird([eb({ sale_end: h(100) })], null, NOW);
    expect(r).toEqual({ status: "open", deadline: h(100) });
  });
  it("open with no deadline when none is stated", () => {
    expect(deriveEarlyBird([eb()], null, NOW)).toEqual({ status: "open", deadline: null });
  });
  it("closing_soon at exactly 48h", () => {
    expect(deriveEarlyBird([eb({ sale_end: h(48) })], null, NOW).status).toBe("closing_soon");
  });
  it("open just beyond 48h", () => {
    expect(deriveEarlyBird([eb({ sale_end: h(48.01) })], null, NOW).status).toBe("open");
  });
  it("unknown if the stated deadline already passed", () => {
    expect(deriveEarlyBird([eb({ sale_end: h(-1) })], null, NOW).status).toBe("unknown");
  });
  it("unknown for an early-bird tier with unknown status", () => {
    expect(deriveEarlyBird([eb({ status: "unknown" })], null, NOW).status).toBe("unknown");
  });
});

describe("confidenceScore", () => {
  it("starts at 0.4 and caps at 1", () => {
    expect(confidenceScore({ ticketingConfirmed: false, secondSourceAgrees: false, hasVenue: false })).toBe(0.4);
    expect(confidenceScore({ ticketingConfirmed: true, secondSourceAgrees: true, hasVenue: true })).toBe(1);
    expect(confidenceScore({ ticketingConfirmed: true, secondSourceAgrees: false, hasVenue: true })).toBe(0.8);
  });
  it("labels", () => {
    expect(confidenceLabel(0.8)).toBe("Confirmed");
    expect(confidenceLabel(0.7)).toBe("Likely");
    expect(confidenceLabel(0.5)).toBe("Unverified");
  });
});

describe("priorityScore", () => {
  const base = { isHomeCity: true, earlyBird: "open" as const, firstSeenAt: h(-100), isFavorite: false, confidence: 1 };
  it("home + open + full confidence", () => {
    expect(priorityScore(base, NOW)).toBe(80);
  });
  it("freshness and favourite add", () => {
    expect(priorityScore({ ...base, firstSeenAt: h(-2), isFavorite: true }, NOW)).toBe(110);
  });
  it("other city is lower, confidence multiplies", () => {
    expect(priorityScore({ ...base, isHomeCity: false, earlyBird: "closing_soon", confidence: 0.5 }, NOW)).toBe(45);
  });
});

describe("laneFor", () => {
  it("act_now needs an urgent status and a deadline within 7 days", () => {
    expect(laneFor({ early_bird_status: "open", early_bird_deadline: h(24), is_home_city: false }, NOW)).toBe("act_now");
    expect(laneFor({ early_bird_status: "open", early_bird_deadline: h(24 * 8), is_home_city: true }, NOW)).toBe("home");
    expect(laneFor({ early_bird_status: "open", early_bird_deadline: null, is_home_city: true }, NOW)).toBe("home");
    expect(laneFor({ early_bird_status: "sold_out", early_bird_deadline: h(5), is_home_city: false }, NOW)).toBe("elsewhere");
    expect(laneFor({ early_bird_status: "imminent", early_bird_deadline: h(5), is_home_city: false }, NOW)).toBe("act_now");
  });
});
