import { z } from "zod";
import { userAgent } from "../env";
import { errMessage, fail, ok, type Result } from "../result";
import { createThrottle, fetchWithTimeout } from "../throttle";

const throttle = createThrottle(1100); // Nominatim usage policy: 1 request / second

const Schema = z.array(z.object({ lat: z.string(), lon: z.string() }));

export async function geocodeVenue(venue: string, city: string): Promise<Result<{ lat: number; lng: number } | null>> {
  try {
    const q = `${venue}, ${city}, India`;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=in`;
    const res = await throttle(() =>
      fetchWithTimeout(url, { headers: { "User-Agent": userAgent(), Accept: "application/json" }, timeoutMs: 8000 }),
    );
    if (!res.ok) return fail("upstream_error", `Nominatim returned ${res.status}`);
    const parsed = Schema.safeParse(await res.json());
    if (!parsed.success) return fail("invalid_response", "Unexpected Nominatim response");
    const hit = parsed.data[0];
    if (!hit) return ok(null);
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? ok({ lat, lng }) : ok(null);
  } catch (e) {
    return fail("upstream_error", errMessage(e));
  }
}
