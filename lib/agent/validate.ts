import { confidenceScore } from "../scoring";
import { domainOf, normalizeUrl, resolveCity, similarity } from "../normalize";
import { addMonthsISO, diffDaysISO, isValidISODate, todayIST } from "../time";
import type { ArtistRow, SourceRef } from "../types";
import type { Candidate } from "./schemas";
import type { Bundle, ValidCandidate } from "./types";

export type DropReason =
  | "not_this_artist"
  | "not_in_india"
  | "bad_date"
  | "past_date"
  | "too_far_out"
  | "evidence_not_in_bundle"
  | "cancelled_unknown";

export type Dropped = { candidate: Candidate; reason: DropReason; detail: string };

export type ExistingKey = { city_slug: string; start_date: string };

export const DROP_MESSAGES: Record<DropReason, string> = {
  not_this_artist: "looks like a different or tribute act",
  not_in_india: "isn't in India",
  bad_date: "has an invalid date",
  past_date: "is already in the past",
  too_far_out: "is more than 18 months away",
  evidence_not_in_bundle: "cites a source I wasn't given",
  cancelled_unknown: "was cancelled before I ever tracked it",
};

/** Stage D — deterministic hallucination guards. No AI. */
export function validateCandidates(
  candidates: Candidate[],
  artist: Pick<ArtistRow, "name">,
  bundle: Bundle,
  existing: ExistingKey[],
  now: Date,
): { valid: ValidCandidate[]; dropped: Dropped[] } {
  const today = todayIST(now);
  const limit = addMonthsISO(today, 18);
  const bundleUrls = new Map(bundle.sources.map((s) => [normalizeUrl(s.url), s]));
  const valid: ValidCandidate[] = [];
  const dropped: Dropped[] = [];

  const drop = (c: Candidate, reason: DropReason) => dropped.push({ candidate: c, reason, detail: DROP_MESSAGES[reason] });

  const pre: { c: Candidate; cityInfo: NonNullable<ReturnType<typeof resolveCity>> }[] = [];
  for (const c of candidates) {
    // 1. namesake / tribute
    if (!c.is_this_artist || similarity(c.artist_name_as_written, artist.name) < 0.85) {
      drop(c, "not_this_artist");
      continue;
    }
    // 2. India + resolvable city
    const cityInfo = resolveCity(c.city);
    if (!/^india$/i.test(c.country.trim()) || !cityInfo) {
      drop(c, "not_in_india");
      continue;
    }
    // 3. dates
    if (!isValidISODate(c.start_date)) {
      drop(c, "bad_date");
      continue;
    }
    if (c.start_date < today) {
      drop(c, "past_date");
      continue;
    }
    if (c.start_date > limit) {
      drop(c, "too_far_out");
      continue;
    }
    // 4. the model may only cite what it was given
    if (!c.evidence_urls.every((u) => bundleUrls.has(normalizeUrl(u)))) {
      drop(c, "evidence_not_in_bundle");
      continue;
    }
    // 5. cancelled and never seen before
    const known = existing.some((e) => e.city_slug === cityInfo.slug && Math.abs(diffDaysISO(e.start_date, c.start_date)) <= 1);
    if (c.status === "cancelled" && !known) {
      drop(c, "cancelled_unknown");
      continue;
    }
    pre.push({ c, cityInfo });
  }

  for (const { c, cityInfo } of pre) {
    const refs = c.evidence_urls.map((u) => bundleUrls.get(normalizeUrl(u))).filter((s): s is NonNullable<typeof s> => Boolean(s));
    const ticketingConfirmed =
      c.from === "ticketmaster" || refs.some((s) => s.ticketingPage && (s.kind !== "scrapingbee" || Boolean(s.page)));

    // A second, independent source agrees on city + date (±1 day): another candidate from a
    // different origin/domain, or Ticketmaster.
    const myDomains = new Set(c.evidence_urls.map((u) => domainOf(u)));
    const second =
      myDomains.size >= 2 ||
      pre.some(
        (o) =>
          o.c !== c &&
          o.cityInfo.slug === cityInfo.slug &&
          Math.abs(diffDaysISO(o.c.start_date, c.start_date)) <= 1 &&
          (o.c.from !== c.from || o.c.evidence_urls.some((u) => !myDomains.has(domainOf(u)))),
      );

    let confidence = confidenceScore({ ticketingConfirmed, secondSourceAgrees: second, hasVenue: Boolean(c.venue_name) });
    // Rule-based only (no AI confirmation): cap below "Likely".
    const lowConfidence = c.from === "rules";
    if (lowConfidence) confidence = Math.min(confidence, 0.55);

    const sourceRefs: SourceRef[] = refs.map((s) => ({ url: s.url, title: s.title, kind: s.kind, fetched_at: s.fetchedAt }));
    valid.push({ ...c, cityInfo, confidence, ticketingConfirmed, lowConfidence, sourceRefs });
  }
  return { valid, dropped };
}
