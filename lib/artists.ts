import { getDb } from "./db";
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
  const { data: existing } = await db
    .from("artists")
    .select("*")
    .eq("name_normalized", norm)
    .maybeSingle();
  if (existing) {
    const row = existing as ArtistRow;
    if (!row.is_active) {
      await db.from("artists").update({ is_active: true }).eq("id", row.id);
      row.is_active = true;
    }
    return { artist: row, created: false };
  }
  const { data, error } = await db
    .from("artists")
    .insert({
      name: a.name.trim(),
      name_normalized: norm,
      mbid: a.mbid ?? null,
      spotify_id: a.spotifyId ?? null,
      disambiguation: a.disambiguation ?? null,
      genres: a.genres ?? [],
      image_url: a.imageUrl ?? null,
      origin: originFromCountry(a.country),
      source: a.source,
    })
    .select("*")
    .single();
  if (error || !data) return null;
  return { artist: data as ArtistRow, created: true };
}

/** Best-effort: fill image (Deezer) and mbid/disambiguation/origin (MusicBrainz). Never throws. */
export async function enrichArtist(id: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  const { data } = await db.from("artists").select("*").eq("id", id).maybeSingle();
  if (!data) return;
  const a = data as ArtistRow;
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
  if (Object.keys(patch).length > 0) await db.from("artists").update(patch).eq("id", id);
}

/** Enrich up to `limit` artists that still lack an image or MusicBrainz id. */
export async function enrichMissing(limit = 3): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const { data } = await db
    .from("artists")
    .select("id")
    .eq("is_active", true)
    .or("image_url.is.null,mbid.is.null")
    .order("created_at", { ascending: true })
    .limit(limit);
  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  for (const id of ids) await enrichArtist(id);
  return ids.length;
}
