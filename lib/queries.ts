import { getDb } from "./db";
import { getConfiguredMap, missingConnectionsCount } from "./integrations/registry";
import { laneFor } from "./scoring";
export { groupIntoLanes } from "./lanes";
export type { Lanes } from "./lanes";
import { todayIST } from "./time";
import type { ArtistRow, Lane, ShowRow, ShowWithArtist } from "./types";

const SHOW_SELECT =
  "*, artist:artists(id, name, image_url, origin, is_favorite), venue:venues(lat, lng)";

type RawShow = ShowRow & {
  artist: ShowWithArtist["artist"] | null;
  venue: { lat: number | null; lng: number | null } | null;
};

function shape(r: RawShow): ShowWithArtist | null {
  if (!r.artist) return null;
  const { venue, ...rest } = r;
  return { ...(rest as ShowRow), artist: r.artist, lat: venue?.lat ?? null, lng: venue?.lng ?? null };
}

export type ShowFilters = {
  lane?: Lane | "all";
  city?: string;
  q?: string;
  includeHidden?: boolean;
  hiddenOnly?: boolean;
};

export async function listShows(f: ShowFilters = {}): Promise<ShowWithArtist[]> {
  const db = getDb();
  if (!db) return [];
  const today = todayIST();
  let query = db
    .from("shows")
    .select(SHOW_SELECT)
    .in("status", ["scheduled", "postponed"])
    .gte("start_date", today)
    .order("start_date", { ascending: true })
    .limit(500);
  if (f.city) query = query.eq("city", f.city);
  const { data, error } = await query;
  if (error || !data) return [];
  let rows = (data as unknown as RawShow[]).map(shape).filter((x): x is ShowWithArtist => x !== null);

  if (f.hiddenOnly) rows = rows.filter((s) => s.decision === "not_interested");
  else if (!f.includeHidden) rows = rows.filter((s) => s.decision !== "not_interested");

  if (f.q) {
    const q = f.q.toLowerCase();
    rows = rows.filter(
      (s) =>
        s.artist.name.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q) ||
        (s.venue_name ?? "").toLowerCase().includes(q),
    );
  }
  if (f.lane && f.lane !== "all") {
    const now = new Date();
    rows = rows.filter((s) => laneFor(s, now) === f.lane);
  }
  return rows;
}

export async function getShow(id: string): Promise<ShowWithArtist | null> {
  const db = getDb();
  if (!db) return null;
  const { data } = await db.from("shows").select(SHOW_SELECT).eq("id", id).maybeSingle();
  return data ? shape(data as unknown as RawShow) : null;
}

export async function listArtists(): Promise<(ArtistRow & { show_count: number })[]> {
  const db = getDb();
  if (!db) return [];
  const [{ data: artists }, { data: shows }] = await Promise.all([
    db.from("artists").select("*").eq("is_active", true).order("name"),
    db
      .from("shows")
      .select("artist_id")
      .in("status", ["scheduled", "postponed"])
      .gte("start_date", todayIST())
      .eq("is_sample", false),
  ]);
  const counts = new Map<string, number>();
  for (const s of shows ?? []) {
    const id = (s as { artist_id: string }).artist_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return ((artists ?? []) as ArtistRow[]).map((a) => ({ ...a, show_count: counts.get(a.id) ?? 0 }));
}

export type AppStatus = {
  configured: boolean;
  artistCount: number;
  lastCheckedAt: string | null;
  missingConnections: number;
};

export async function getAppStatus(): Promise<AppStatus> {
  const map = getConfiguredMap();
  const missing = missingConnectionsCount(map);
  const db = getDb();
  if (!db) return { configured: false, artistCount: 0, lastCheckedAt: null, missingConnections: missing };
  const [{ count }, { data: last }] = await Promise.all([
    db.from("artists").select("id", { count: "exact", head: true }).eq("is_active", true),
    db
      .from("scan_runs")
      .select("finished_at")
      .in("status", ["completed", "partial"])
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    configured: true,
    artistCount: count ?? 0,
    lastCheckedAt: (last?.finished_at as string | null | undefined) ?? null,
    missingConnections: missing,
  };
}

export async function hasRealShowData(): Promise<{ realShows: number; completedScans: number }> {
  const db = getDb();
  if (!db) return { realShows: 0, completedScans: 0 };
  const [{ count: realShows }, { count: completedScans }] = await Promise.all([
    db.from("shows").select("id", { count: "exact", head: true }).eq("is_sample", false),
    db.from("scan_runs").select("id", { count: "exact", head: true }).in("status", ["completed", "partial"]),
  ]);
  return { realShows: realShows ?? 0, completedScans: completedScans ?? 0 };
}
