import { getDb, one, type Db } from "./db";
import { addDaysISO, todayIST } from "./time";
import { dedupeKey, resolveCity } from "./normalize";
import { hasRealShowData } from "./queries";
import { getConfiguredMap } from "./integrations/registry";
import type { ArtistRow } from "./types";

const SAMPLES = [
  {
    artist: "Prateek Kuhad",
    city: "Bengaluru",
    venue: "Phoenix Marketcity",
    days: 21,
    time: "19:30",
    eb: "open",
    ebHours: 70,
    price: 1499,
  },
  {
    artist: "Cigarettes After Sex",
    city: "Mumbai",
    venue: "Jio World Garden",
    days: 45,
    time: "20:00",
    eb: "imminent",
    ebHours: 40,
    price: 2999,
  },
  {
    artist: "Khruangbin",
    city: "Delhi NCR",
    venue: "Siri Fort Auditorium",
    days: 60,
    time: "19:00",
    eb: "unknown",
    ebHours: 0,
    price: null,
  },
  {
    artist: "Anuv Jain",
    city: "Bengaluru",
    venue: "Palace Grounds",
    days: 33,
    time: "18:30",
    eb: "not_offered",
    ebHours: 0,
    price: 1299,
  },
] as const;

/** Sample mode (§9.3): only while there is no real data. Real shows delete these rows automatically. */
export async function ensureSampleShows(): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    return await ensure(db);
  } catch {
    return false;
  }
}

async function ensure(db: Db): Promise<boolean> {
  const { realShows, completedScans } = await hasRealShowData();
  const geminiOn = getConfiguredMap().gemini.configured;
  if (realShows > 0 || (geminiOn && completedScans > 0)) return false;

  const existing = await one<{ n: number }>(
    db,
    "select count(*)::int as n from shows where is_sample",
  );
  if ((existing?.n ?? 0) > 0) return true;

  const artists = await db.query<Pick<ArtistRow, "id" | "name">>(
    "select id, name from artists where name = any($1)",
    [SAMPLES.map((s) => s.artist)],
  );
  const byName = new Map(artists.map((a) => [a.name, a.id]));
  const today = todayIST();
  let inserted = 0;
  for (const s of SAMPLES) {
    const artistId = byName.get(s.artist);
    const city = resolveCity(s.city);
    if (!artistId || !city) continue;
    const start = addDaysISO(today, s.days);
    await db.query(
      `insert into shows(artist_id, dedupe_key, city, city_slug, state, is_home_city, venue_name, start_date,
                         start_time, early_bird_status, early_bird_deadline, price_min_inr, confidence,
                         priority_score, is_sample)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0.5,10,true)
       on conflict (dedupe_key) do nothing`,
      [
        artistId,
        `sample|${dedupeKey(s.artist, city.slug, start)}`,
        city.name,
        city.slug,
        city.state,
        city.name === "Bengaluru",
        s.venue,
        start,
        s.time,
        s.eb,
        s.ebHours ? new Date(Date.now() + s.ebHours * 3_600_000).toISOString() : null,
        s.price,
      ],
    );
    inserted++;
  }
  return inserted > 0;
}
