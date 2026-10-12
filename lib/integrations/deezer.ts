import { z } from "zod";
import { errMessage, fail, ok, type Result } from "../result";
import { similarity } from "../normalize";
import { fetchWithTimeout } from "../throttle";

const Schema = z.object({
  data: z
    .array(
      z.object({
        name: z.string(),
        nb_fan: z.number().optional(),
        picture_medium: z.string().url().optional(),
        picture_big: z.string().url().optional(),
      }),
    )
    .default([]),
});

/** Deezer serves a generic silhouette for artists without a photo; its path has an empty hash. */
export const isPlaceholder = (url: string) => /\/images\/artist\/\/|\/artist\/\//.test(url);

/**
 * Best photo for an artist: among the top hits whose name matches at >= 0.85 similarity,
 * take the most-followed one with a real (non-placeholder) picture. Prefers the 500px image.
 */
export async function artistImage(name: string): Promise<Result<string | null>> {
  try {
    const res = await fetchWithTimeout(
      `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`,
      { timeoutMs: 6000 },
    );
    if (!res.ok) return fail("upstream_error", `Deezer returned ${res.status}`);
    const parsed = Schema.safeParse(await res.json());
    if (!parsed.success) return fail("invalid_response", "Unexpected Deezer response");
    const best = parsed.data.data
      .filter((a) => similarity(a.name, name) >= 0.85)
      .map((a) => ({ ...a, url: a.picture_big ?? a.picture_medium }))
      .filter((a): a is typeof a & { url: string } => Boolean(a.url) && !isPlaceholder(a.url!))
      .sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0))[0];
    return ok(best?.url ?? null);
  } catch (e) {
    return fail("upstream_error", errMessage(e));
  }
}
