import type { ShowWithArtist } from "./types";

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

export function fixtureShow(over: Partial<ShowWithArtist> & { name: string }): ShowWithArtist {
  const { name, ...rest } = over;
  return {
    id: crypto.randomUUID(),
    artist_id: "a",
    dedupe_key: "x",
    title: null,
    event_type: "concert",
    city: "Bengaluru",
    city_slug: "bengaluru",
    state: "Karnataka",
    is_home_city: true,
    venue_id: null,
    venue_name: "Phoenix Marketcity",
    start_date: day(30),
    end_date: null,
    start_time: "19:30",
    ticket_url: "https://www.district.in/",
    ticket_platform: "district",
    early_bird_status: "open",
    early_bird_deadline: hours(5.2),
    on_sale_at: null,
    price_min_inr: 1499,
    price_max_inr: 3999,
    tiers: [],
    confidence: 0.9,
    priority_score: 80,
    sources: [{ url: "https://www.district.in/", kind: "scrapingbee", fetched_at: hours(-1) }],
    status: "scheduled",
    decision: null,
    ai_brief: null,
    ai_brief_hash: null,
    is_sample: false,
    first_seen_at: hours(-2),
    last_seen_at: hours(-1),
    last_enriched_at: null,
    updated_at: hours(-1),
    artist: { id: "a", name, image_url: null, origin: "india", is_favorite: false },
    ...rest,
  };
}

/** Dev-only fixtures for /dev/cards: one card per stub state. */
export function cardFixtures(): { label: string; show: ShowWithArtist; glow?: boolean }[] {
  return [
    { label: "Early bird open", glow: true, show: fixtureShow({ name: "Prateek Kuhad", early_bird_deadline: hours(5.2) }) },
    {
      label: "Closing soon (<48h, pulses)",
      glow: true,
      show: fixtureShow({ name: "Cigarettes After Sex", early_bird_status: "closing_soon", early_bird_deadline: hours(20), city: "Mumbai", is_home_city: false, venue_name: "Jio World Garden" }),
    },
    {
      label: "Imminent",
      show: fixtureShow({ name: "Khruangbin", early_bird_status: "imminent", early_bird_deadline: hours(52) }),
    },
    {
      label: "Sold out",
      show: fixtureShow({ name: "Anuv Jain", early_bird_status: "sold_out", early_bird_deadline: null }),
    },
    {
      label: "Unknown tiers + Unverified",
      show: fixtureShow({ name: "Parvaaz", early_bird_status: "unknown", early_bird_deadline: null, confidence: 0.45, price_min_inr: null, city: "Delhi NCR", is_home_city: false }),
    },
    {
      label: "Not offered (general sale)",
      show: fixtureShow({ name: "The Local Train", early_bird_status: "not_offered", early_bird_deadline: null, confidence: 0.7 }),
    },
    {
      label: "Sample",
      show: fixtureShow({ name: "Bonobo", is_sample: true, early_bird_status: "unknown", early_bird_deadline: null, confidence: 0.5 }),
    },
  ];
}
