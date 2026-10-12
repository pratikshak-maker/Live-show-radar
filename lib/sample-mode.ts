import { getDb } from "./db";
import { addDaysISO, todayIST } from "./time";
import { dedupeKey, resolveCity } from "./normalize";
import { hasRealShowData } from "./queries";
import { getConfiguredMap } from "./integrations/registry";
import type { ArtistRow } from "./types";

const SAMPLES = [
  { artist: "Prateek Kuhad", city: "Bengaluru", venue: "Phoenix Marketcity", days: 21, time: "19:30", eb: "open", ebHours: 70, price: 1499 },
  { artist: "Cigarettes After Sex", city: "Mumbai", venue: "Jio World Garden", days: 45, time: "20:00", eb: "imminent", ebHours: 40, price: 2999 },
  { artist: "Khruangbin", city: "Delhi NCR", venue: "Siri Fort Auditorium", days: 60, time: "19:00", eb: "unknown", ebHours: 0, price: null },
  { artist: "Anuv Jain", city: "Bengaluru", venue: "Palace Grounds", days: 33, time: "18:30", eb: "not_offered", ebHours: 0, price: 1299 },
] as const;

/** Sample mode (§9.3): only while there is no real data. Real shows delete these rows automatically. */
export async function ensureSampleShows(): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const { realShows, completedScans } = await hasRealShowData();
  const geminiOn = getConfiguredMap().gemini.configured;
  if (realShows > 0 || (geminiOn && completedScans > 0)) return false;

  const { count } = await db.from("shows").select("id", { count: "exact", head: true }).eq("is_sample", true);
  if ((count ?? 0) > 0) return true;

  const { data } = await db.from("artists").select("id, name, origin, is_favorite").in("name", SAMPLES.map((s) => s.artist));
  const byName = new Map(((data ?? []) as Pick<ArtistRow, "id" | "name">[]).map((a) => [a.name, a.id]));
  const today = todayIST();
  const rows = SAMPLES.flatMap((s) => {
    const artistId = byName.get(s.artist);
    const city = resolveCity(s.city);
    if (!artistId || !city) return [];
    const start = addDaysISO(today, s.days);
    return [
      {
        artist_id: artistId,
        dedupe_key: `sample|${dedupeKey(s.artist, city.slug, start)}`,
        city: city.name,
        city_slug: city.slug,
        state: city.state,
        is_home_city: city.name === "Bengaluru",
        venue_name: s.venue,
        start_date: start,
        start_time: s.time,
        early_bird_status: s.eb,
        early_bird_deadline: s.ebHours ? new Date(Date.now() + s.ebHours * 3_600_000).toISOString() : null,
        price_min_inr: s.price,
        confidence: 0.5,
        priority_score: 10,
        is_sample: true,
        tiers: [],
        sources: [],
      },
    ];
  });
  if (rows.length === 0) return false;
  await db.from("shows").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
  return true;
}
