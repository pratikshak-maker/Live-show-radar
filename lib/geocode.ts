import type { Db } from "./db";
import { geocodeVenue } from "./integrations/nominatim";
import { resolveCity } from "./normalize";

/** Geocode up to `limit` venues that have no coordinates yet; falls back to the city centre. */
export async function geocodePending(db: Db, limit = 3): Promise<number> {
  const rows = await db.query<{ id: string; name: string; city: string }>(
    "select id, name, city from venues where geocoded_at is null limit $1",
    [limit],
  );
  let done = 0;
  for (const v of rows) {
    const r = await geocodeVenue(v.name, v.city);
    let coords = r.ok ? r.data : null;
    if (!coords) {
      const c = resolveCity(v.city);
      coords = c ? { lat: c.lat, lng: c.lng } : null;
    }
    if (r.ok || coords) {
      await db.query("update venues set lat = $2, lng = $3, geocoded_at = now() where id = $1", [
        v.id,
        coords?.lat ?? null,
        coords?.lng ?? null,
      ]);
      done++;
    }
  }
  return done;
}
