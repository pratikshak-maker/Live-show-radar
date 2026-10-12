import { getDb, one } from "./db";
import { getConfiguredMap, missingConnectionsCount } from "./integrations/registry";
import { laneFor } from "./scoring";
export { groupIntoLanes } from "./lanes";
export type { Lanes } from "./lanes";
import { todayIST } from "./time";
import type { ArtistRow, Lane, ShowWithArtist } from "./types";

/** Show + the artist fields the UI needs + venue coordinates, in one row. */
export const SHOW_SQL = `
  select s.*,
         json_build_object('id', a.id, 'name', a.name, 'image_url', a.image_url,
                           'origin', a.origin, 'is_favorite', a.is_favorite) as artist,
         v.lat, v.lng
    from shows s
    join artists a on a.id = s.artist_id
    left join venues v on v.id = s.venue_id`;

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
  const params: unknown[] = [todayIST()];
  let where = "s.status in ('scheduled','postponed') and s.start_date >= $1::date";
  if (f.city) {
    params.push(f.city);
    where += ` and s.city = $${params.length}`;
  }
  let rows = await db
    .query<ShowWithArtist>(`${SHOW_SQL} where ${where} order by s.start_date asc limit 500`, params)
    .catch(() => [] as ShowWithArtist[]);

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
  return one<ShowWithArtist>(db, `${SHOW_SQL} where s.id = $1`, [id]).catch(() => null);
}

export async function listArtists(): Promise<(ArtistRow & { show_count: number })[]> {
  const db = getDb();
  if (!db) return [];
  return db
    .query<ArtistRow & { show_count: number }>(
      `select a.*,
              (select count(*)::int from shows s
                where s.artist_id = a.id and not s.is_sample
                  and s.status in ('scheduled','postponed') and s.start_date >= $1::date) as show_count
         from artists a
        where a.is_active
        order by a.name`,
      [todayIST()],
    )
    .catch(() => []);
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
  if (!db)
    return { configured: false, artistCount: 0, lastCheckedAt: null, missingConnections: missing };
  const row = await one<{ artists: number; last: string | null }>(
    db,
    `select (select count(*)::int from artists where is_active) as artists,
            (select max(finished_at) from scan_runs where status in ('completed','partial')) as last`,
  ).catch(() => null);
  return {
    configured: true,
    artistCount: row?.artists ?? 0,
    lastCheckedAt: row?.last ?? null,
    missingConnections: missing,
  };
}

export async function hasRealShowData(): Promise<{ realShows: number; completedScans: number }> {
  const db = getDb();
  if (!db) return { realShows: 0, completedScans: 0 };
  const row = await one<{ real: number; scans: number }>(
    db,
    `select (select count(*)::int from shows where not is_sample) as real,
            (select count(*)::int from scan_runs where status in ('completed','partial')) as scans`,
  ).catch(() => null);
  return { realShows: row?.real ?? 0, completedScans: row?.scans ?? 0 };
}
