import { z } from "zod";
import { readEnv } from "../env";
import { errMessage, fail, notConfigured, ok, type Result } from "../result";
import { fetchWithTimeout } from "../throttle";

export const SPOTIFY_SCOPE = "user-follow-read";

export function spotifyAuthUrl(state: string): string | null {
  const e = readEnv();
  if (!e.SPOTIFY_CLIENT_ID || !e.SPOTIFY_CLIENT_SECRET) return null;
  const p = new URLSearchParams({
    response_type: "code",
    client_id: e.SPOTIFY_CLIENT_ID,
    scope: SPOTIFY_SCOPE,
    redirect_uri: e.SPOTIFY_REDIRECT_URI,
    state,
  });
  return `https://accounts.spotify.com/authorize?${p.toString()}`;
}

const TokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
});

export type SpotifyTokens = z.infer<typeof TokenSchema>;

async function tokenRequest(body: URLSearchParams): Promise<Result<SpotifyTokens>> {
  const e = readEnv();
  if (!e.SPOTIFY_CLIENT_ID || !e.SPOTIFY_CLIENT_SECRET) return notConfigured("Spotify");
  try {
    const basic = Buffer.from(`${e.SPOTIFY_CLIENT_ID}:${e.SPOTIFY_CLIENT_SECRET}`).toString(
      "base64",
    );
    const res = await fetchWithTimeout("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      timeoutMs: 10_000,
    });
    if (!res.ok) return fail("upstream_error", `Spotify token endpoint returned ${res.status}`);
    const parsed = TokenSchema.safeParse(await res.json());
    return parsed.success
      ? ok(parsed.data)
      : fail("invalid_response", "Unexpected Spotify token response");
  } catch (err) {
    return fail("upstream_error", errMessage(err));
  }
}

export function exchangeCode(code: string) {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: readEnv().SPOTIFY_REDIRECT_URI,
    }),
  );
}

const FollowingSchema = z.object({
  artists: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        images: z.array(z.object({ url: z.string() })).default([]),
        genres: z.array(z.string()).default([]),
      }),
    ),
    cursors: z.object({ after: z.string().nullable().optional() }).nullable().optional(),
    next: z.string().nullable().optional(),
  }),
});

export type SpotifyArtist = {
  spotifyId: string;
  name: string;
  imageUrl: string | null;
  genres: string[];
};

/** GET /v1/me/following?type=artist (still available in Development Mode per the Feb 2026 migration guide). */
export async function followedArtists(accessToken: string): Promise<Result<SpotifyArtist[]>> {
  const out: SpotifyArtist[] = [];
  let after: string | null = null;
  try {
    for (let page = 0; page < 10; page++) {
      const url: string = `https://api.spotify.com/v1/me/following?type=artist&limit=50${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      const res = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeoutMs: 10_000,
      });
      if (res.status === 429) return fail("rate_limited", "Spotify is rate limiting us.", 5000);
      if (res.status === 403)
        return fail(
          "upstream_error",
          "Spotify refused: this account isn't allowed to use the app.",
        );
      if (!res.ok) return fail("upstream_error", `Spotify returned ${res.status}`);
      const parsed = FollowingSchema.safeParse(await res.json());
      if (!parsed.success) return fail("invalid_response", "Unexpected Spotify response");
      for (const a of parsed.data.artists.items) {
        out.push({
          spotifyId: a.id,
          name: a.name,
          imageUrl: a.images[0]?.url ?? null,
          genres: a.genres,
        });
      }
      after = parsed.data.artists.cursors?.after ?? null;
      if (!after) break;
    }
    return ok(out);
  } catch (e) {
    return fail("upstream_error", errMessage(e));
  }
}
