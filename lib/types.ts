export type EarlyBirdStatus =
  | "open"
  | "closing_soon"
  | "imminent"
  | "sold_out"
  | "not_offered"
  | "unknown";

export type TierStatus = "on_sale" | "sold_out" | "upcoming" | "unknown";

export type Tier = {
  name: string;
  price_inr: number | null;
  status: TierStatus;
  sale_start: string | null;
  sale_end: string | null;
  is_early_bird: boolean;
};

export type SourceRef = {
  url: string;
  title?: string;
  kind: "gemini" | "scrapingbee" | "ticketmaster";
  fetched_at: string;
};

export type ShowStatus = "scheduled" | "cancelled" | "postponed" | "past";
export type Decision = "going" | "maybe" | "not_interested";
export type Origin = "india" | "international" | "unknown";

export type ArtistRow = {
  id: string;
  name: string;
  name_normalized: string;
  mbid: string | null;
  spotify_id: string | null;
  disambiguation: string | null;
  genres: string[];
  image_url: string | null;
  origin: Origin;
  source: "seed" | "manual" | "lastfm" | "spotify";
  is_favorite: boolean;
  is_active: boolean;
  last_scanned_at: string | null;
  last_scan_status: string | null;
  created_at: string;
};

export type AiBrief = {
  headline: string;
  urgency: "buy_today" | "this_week" | "no_rush" | "unclear";
  reasons: string[];
  travel_note: string | null;
  caveat: string | null;
};

export type ShowRow = {
  id: string;
  artist_id: string;
  dedupe_key: string;
  title: string | null;
  event_type: "concert" | "festival" | "club" | "other";
  city: string;
  city_slug: string;
  state: string | null;
  is_home_city: boolean;
  venue_id: string | null;
  venue_name: string | null;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  ticket_url: string | null;
  ticket_platform: string | null;
  early_bird_status: EarlyBirdStatus;
  early_bird_deadline: string | null;
  on_sale_at: string | null;
  price_min_inr: number | null;
  price_max_inr: number | null;
  tiers: Tier[];
  confidence: number;
  priority_score: number;
  sources: SourceRef[];
  status: ShowStatus;
  decision: Decision | null;
  ai_brief: AiBrief | null;
  ai_brief_hash: string | null;
  is_sample: boolean;
  first_seen_at: string;
  last_seen_at: string;
  last_enriched_at: string | null;
  updated_at: string;
};

/** Show joined with the artist fields the UI needs, plus venue coordinates. */
export type ShowWithArtist = ShowRow & {
  artist: Pick<ArtistRow, "id" | "name" | "image_url" | "origin" | "is_favorite">;
  lat?: number | null;
  lng?: number | null;
};

export type ChangeType =
  | "new_show"
  | "early_bird_opened"
  | "early_bird_closing_soon"
  | "early_bird_imminent"
  | "tier_sold_out"
  | "date_changed"
  | "venue_changed"
  | "cancelled"
  | "deadline_found";

export type Lane = "act_now" | "home" | "elsewhere";
