import { z } from "zod";
import { userAgent } from "../env";
import { errMessage, fail, ok, type Result } from "../result";
import { LruCache, createThrottle, fetchWithTimeout } from "../throttle";

const throttle = createThrottle(1100); // MusicBrainz: max 1 request / second
const cache = new LruCache<MbArtist[]>(200, 10 * 60_000);

const ResponseSchema = z.object({
  artists: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        disambiguation: z.string().optional(),
        country: z.string().optional(),
        type: z.string().optional(),
        score: z.number().optional(),
      }),
    )
    .default([]),
});

export type MbArtist = {
  mbid: string;
  name: string;
  disambiguation: string | null;
  country: string | null;
};

export async function searchArtists(q: string, limit = 6): Promise<Result<MbArtist[]>> {
  const query = q.trim();
  if (query.length < 2) return ok([]);
  const key = `${query.toLowerCase()}|${limit}`;
  const hit = cache.get(key);
  if (hit) return ok(hit);
  try {
    const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`;
    const res = await throttle(() =>
      fetchWithTimeout(url, { headers: { "User-Agent": userAgent(), Accept: "application/json" }, timeoutMs: 8000 }),
    );
    if (res.status === 503 || res.status === 429) return fail("rate_limited", "MusicBrainz is busy.", 2000);
    if (!res.ok) return fail("upstream_error", `MusicBrainz returned ${res.status}`);
    const parsed = ResponseSchema.safeParse(await res.json());
    if (!parsed.success) return fail("invalid_response", "Unexpected MusicBrainz response");
    const data = parsed.data.artists.map((a) => ({
      mbid: a.id,
      name: a.name,
      disambiguation: a.disambiguation || null,
      country: a.country ?? null,
    }));
    cache.set(key, data);
    return ok(data);
  } catch (e) {
    return fail("upstream_error", errMessage(e));
  }
}

/** Best match for enrichment: top hit whose name is a close match. */
export async function lookupArtist(name: string): Promise<Result<MbArtist | null>> {
  const r = await searchArtists(name, 3);
  if (!r.ok) return r;
  return ok(r.data[0] ?? null);
}
