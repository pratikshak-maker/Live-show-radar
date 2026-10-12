import type { City } from "../normalize";
import type { ArtistRow, SourceRef } from "../types";
import type { GeminiBudget, GroundedSource } from "../integrations/gemini";
import type { TmEvent } from "../integrations/ticketmaster";
import type { PageEvidence } from "../html-evidence";
import type { Candidate } from "./schemas";
import type { RunLogger } from "./logger";

export type RunStats = {
  artists: number;
  candidates: number;
  newShows: number;
  updated: number;
  alerts: number;
  geminiCalls: number;
  sbCredits: number;
  prompts?: Record<string, string>;
};

export type RunCtx = {
  runId: string;
  logger: RunLogger;
  gemini: GeminiBudget;
  homeCity: string;
  now: () => Date;
  stats: RunStats;
  /** Set when the scrape budget is exhausted so we stop trying for the rest of the run. */
  scrapeBlocked: boolean;
  /** show_changes ids created in this run (for the notifier). */
  changeIds: string[];
};

export type EvidenceSource = {
  n: number;
  url: string;
  kind: SourceRef["kind"];
  fetchedAt: string;
  title?: string;
  content: string;
  /** True when this is a scraped page on a ticketing domain. */
  ticketingPage: boolean;
  page?: PageEvidence;
};

export type Discovery = {
  groundedText: string | null;
  grounded: GroundedSource[];
  tm: TmEvent[];
  fallbackUrls: string[];
  noShows: boolean;
  aiAvailable: boolean;
};

export type Bundle = {
  artist: ArtistRow;
  sources: EvidenceSource[];
};

export type ValidCandidate = Candidate & {
  cityInfo: City;
  confidence: number;
  ticketingConfirmed: boolean;
  lowConfidence: boolean;
  sourceRefs: SourceRef[];
};
