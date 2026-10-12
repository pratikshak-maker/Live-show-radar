import type { EarlyBirdStatus, Lane, Tier } from "./types";

const HOUR = 3_600_000;

export type EarlyBirdResult = { status: EarlyBirdStatus; deadline: string | null };

/**
 * Derive early-bird status from tier data. Pure; `now` is injected for tests.
 * `earlyBirdMentioned` is true when the evidence talks about early-bird pricing at all.
 */
export function deriveEarlyBird(
  tiers: Tier[],
  onSaleAt: string | null,
  now: Date,
  earlyBirdMentioned = false,
): EarlyBirdResult {
  const eb = tiers.find((t) => t.is_early_bird);
  if (!eb) {
    if (earlyBirdMentioned) return { status: "unknown", deadline: null };
    if (tiers.length === 0) return { status: "unknown", deadline: null };
    return { status: "not_offered", deadline: null };
  }
  if (eb.status === "sold_out") return { status: "sold_out", deadline: null };

  const t = (s: string | null) => {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const saleStart = t(eb.sale_start);
  const saleEnd = t(eb.sale_end);
  const onSale = t(onSaleAt);
  const nowMs = now.getTime();

  const startsLater =
    eb.status === "upcoming" ||
    (saleStart !== null && saleStart.getTime() > nowMs) ||
    (onSale !== null && onSale.getTime() > nowMs && eb.status !== "on_sale");
  if (startsLater) {
    const dl = saleStart ?? onSale;
    return { status: "imminent", deadline: dl ? dl.toISOString() : null };
  }

  if (eb.status === "on_sale") {
    if (saleEnd && saleEnd.getTime() <= nowMs) return { status: "unknown", deadline: null };
    const closing = saleEnd !== null && saleEnd.getTime() - nowMs <= 48 * HOUR;
    return {
      status: closing ? "closing_soon" : "open",
      deadline: saleEnd ? saleEnd.toISOString() : null,
    };
  }
  return { status: "unknown", deadline: null };
}

export type ConfidenceInput = {
  /** A ticketing-domain page or JSON-LD confirmed date + city. */
  ticketingConfirmed: boolean;
  /** A second independent source (different domain, or Ticketmaster) agrees on date ±1 day + city. */
  secondSourceAgrees: boolean;
  hasVenue: boolean;
};

export function confidenceScore(i: ConfidenceInput): number {
  let c = 0.4;
  if (i.ticketingConfirmed) c += 0.3;
  if (i.secondSourceAgrees) c += 0.2;
  if (i.hasVenue) c += 0.1;
  return Math.min(1, Math.round(c * 100) / 100);
}

export function confidenceLabel(c: number): "Confirmed" | "Likely" | "Unverified" {
  if (c >= 0.8) return "Confirmed";
  if (c >= 0.6) return "Likely";
  return "Unverified";
}

export type PriorityInput = {
  isHomeCity: boolean;
  earlyBird: EarlyBirdStatus;
  firstSeenAt: string;
  isFavorite: boolean;
  confidence: number;
};

export function priorityScore(i: PriorityInput, now: Date = new Date()): number {
  let s = i.isHomeCity ? 50 : 20;
  const eb: Record<EarlyBirdStatus, number> = {
    closing_soon: 40,
    open: 30,
    imminent: 25,
    unknown: 5,
    sold_out: 0,
    not_offered: 0,
  };
  s += eb[i.earlyBird];
  if (now.getTime() - new Date(i.firstSeenAt).getTime() <= 24 * HOUR) s += 15;
  if (i.isFavorite) s += 15;
  return Math.round(s * (0.5 + i.confidence / 2));
}

export type LaneInput = {
  early_bird_status: EarlyBirdStatus;
  early_bird_deadline: string | null;
  is_home_city: boolean;
};

/** "Act now": early bird open/closing_soon/imminent with a deadline in the next 7 days. */
export function laneFor(s: LaneInput, now: Date = new Date()): Lane {
  const urgent =
    s.early_bird_status === "open" ||
    s.early_bird_status === "closing_soon" ||
    s.early_bird_status === "imminent";
  if (urgent && s.early_bird_deadline) {
    const dl = new Date(s.early_bird_deadline).getTime();
    if (dl > now.getTime() && dl - now.getTime() <= 7 * 24 * HOUR) return "act_now";
  }
  return s.is_home_city ? "home" : "elsewhere";
}
