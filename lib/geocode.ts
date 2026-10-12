import type { SupabaseClient } from "@supabase/supabase-js";
import { geocodeVenue } from "./integrations/nominatim";
import { resolveCity } from "./normalize";

/** Geocode up to `limit` venues that have no coordinates yet; falls back to the city centre. */
export async function geocodePending(db: SupabaseClient, limit = 3): Promise<number> {
  const { data } = await db
    .from("venues")
    .select("id, name, city")
    .is("geocoded_at", null)
    .limit(limit);
  let done = 0;
  for (const v of (data ?? []) as { id: string; name: string; city: string }[]) {
    const r = await geocodeVenue(v.name, v.city);
    let coords = r.ok ? r.data : null;
    if (!coords) {
      const c = resolveCity(v.city);
      coords = c ? { lat: c.lat, lng: c.lng } : null;
    }
    if (r.ok || coords) {
      await db
        .from("venues")
        .update({
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          geocoded_at: new Date().toISOString(),
        })
        .eq("id", v.id);
      done++;
    }
  }
  return done;
}
