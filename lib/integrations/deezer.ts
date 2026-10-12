import { z } from "zod";
import { errMessage, fail, ok, type Result } from "../result";
import { similarity } from "../normalize";
import { fetchWithTimeout } from "../throttle";

const Schema = z.object({
  data: z
    .array(z.object({ name: z.string(), picture_medium: z.string().url().optional() }))
    .default([]),
});

/** Returns an image URL only when the top hit's name matches at >= 0.85 similarity. */
export async function artistImage(name: string): Promise<Result<string | null>> {
  try {
    const res = await fetchWithTimeout(
      `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`,
      { timeoutMs: 6000 },
    );
    if (!res.ok) return fail("upstream_error", `Deezer returned ${res.status}`);
    const parsed = Schema.safeParse(await res.json());
    if (!parsed.success) return fail("invalid_response", "Unexpected Deezer response");
    const top = parsed.data.data[0];
    if (!top?.picture_medium || similarity(top.name, name) < 0.85) return ok(null);
    return ok(top.picture_medium);
  } catch (e) {
    return fail("upstream_error", errMessage(e));
  }
}
