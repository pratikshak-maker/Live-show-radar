import { getDb, one, updateById } from "./db";
import { normalizeArtist, similarity } from "./normalize";
import { artistImage } from "./integrations/deezer";
import { lookupArtist } from "./integrations/musicbrainz";
import type { ArtistRow, Origin } from "./types";

export type NewArtist = {
  name: string;
  mbid?: string | null;
  spotifyId?: string | null;
  disambiguation?: string | null;
  country?: string | null;
  imageUrl?: string | null;
  genres?: string[];
  source: ArtistRow["source"];
};

export function originFromCountry(country: string | null | undefined): Origin {
  if (!country) return "unknown";
  return country.toUpperCase() === "IN" ? "india" : "international";
}

/** Insert (or return the existing) artist. Skips network enrichment — call enrichArtist after. */
export async function addArtist(
  a: NewArtist,
): Promise<{ artist: ArtistRow; created: boolean } | null> {
  const db = getDb();
  if (!db) return null;
  const norm = normalizeArtist(a.name);
  if (!norm) return null;
  const existing = await one<ArtistRow>(db, "select * from artists where name_normalized = $1", [
    norm,
  ]);
  if (existing) {
    if (!existing.is_active) {
      await db.query("update artists set is_active = true where id = $1", [existing.id]);
      existing.is_active = true;
    }
    return { artist: existing, created: false };
  }
  try {
    const row = await one<ArtistRow>(
      db,
      `insert into artists(name, name_normalized, mbid, spotify_id, disambiguation, genres, image_url, origin, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (name_normalized) do nothing
       returning *`,
      [
        a.name.trim(),
        norm,
        a.mbid ?? null,
        a.spotifyId ?? null,
        a.disambiguation ?? null,
        a.genres ?? [],
        a.imageUrl ?? null,
        originFromCountry(a.country),
        a.source,
      ],
    );
    if (row) return { artist: row, created: true };
    // Lost a race with a concurrent insert: return the winner.
    const again = await one<ArtistRow>(db, "select * from artists where name_normalized = $1", [
      norm,
    ]);
    return again ? { artist: again, created: false } : null;
  } catch {
    return null;
  }
}

/** Best-effort: fill image (Deezer) and mbid/disambiguation/origin (MusicBrainz). Never throws. */
export async function enrichArtist(id: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    const a = await one<ArtistRow>(db, "select * from artists where id = $1", [id]);
    if (!a) return;
    const patch: Record<string, unknown> = {};

    if (!a.image_url) {
      const img = await artistImage(a.name);
      if (img.ok && img.data) patch.image_url = img.data;
    }
    if (!a.mbid) {
      const mb = await lookupArtist(a.name);
      if (mb.ok && mb.data && similarity(mb.data.name, a.name) >= 0.85) {
        patch.mbid = mb.data.mbid;
        if (mb.data.disambiguation) patch.disambiguation = mb.data.disambiguation;
        // Keep the curated origin of seeded artists; only fill an unknown one.
        if (a.origin === "unknown") patch.origin = originFromCountry(mb.data.country);
      }
    }
    await updateById(db, "artists", id, patch);
  } catch {
    /* best effort */
  }
}

/** Enrich up to `limit` artists that still lack an image or MusicBrainz id. */
export async function enrichMissing(limit = 3): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  // Random order so an artist that never matches can't starve the rest.
  const rows = await db
    .query<{ id: string }>(
      "select id from artists where is_active and (image_url is null or mbid is null) order by random() limit $1",
      [limit],
    )
    .catch(() => [] as { id: string }[]);
  for (const r of rows) await enrichArtist(r.id);
  return rows.length;
}
