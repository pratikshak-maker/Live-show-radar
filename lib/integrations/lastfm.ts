import { z } from "zod";
import { readEnv } from "../env";
import { errMessage, fail, notConfigured, ok, type Result } from "../result";
import { fetchWithTimeout } from "../throttle";

const Schema = z.object({
  topartists: z.object({ artist: z.array(z.object({ name: z.string() })).default([]) }),
});
const ErrSchema = z.object({ error: z.number(), message: z.string() });

export async function topArtists(username: string): Promise<Result<string[]>> {
  const key = readEnv().LASTFM_API_KEY;
  if (!key) return notConfigured("Last.fm");
  const user = username.trim();
  if (!/^[A-Za-z0-9_-]{2,15}$/.test(user)) return fail("invalid_response", "That doesn't look like a Last.fm username.");
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(user)}&api_key=${encodeURIComponent(key)}&format=json&period=12month&limit=60`;
    const res = await fetchWithTimeout(url, { timeoutMs: 8000 });
    const json: unknown = await res.json().catch(() => null);
    const apiErr = ErrSchema.safeParse(json);
    if (apiErr.success) {
      return fail(apiErr.data.error === 6 ? "invalid_response" : "upstream_error", apiErr.data.error === 6 ? "No Last.fm user with that name." : apiErr.data.message);
    }
    if (!res.ok) return fail("upstream_error", `Last.fm returned ${res.status}`);
    const parsed = Schema.safeParse(json);
    if (!parsed.success) return fail("invalid_response", "Unexpected Last.fm response");
    return ok(parsed.data.topartists.artist.map((a) => a.name));
  } catch (e) {
    return fail("upstream_error", errMessage(e));
  }
}
