import { after, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { addArtist, enrichArtist } from "@/lib/artists";
import { readEnv } from "@/lib/env";
import { exchangeCode, followedArtists } from "@/lib/integrations/spotify";
import { saveTokens } from "@/lib/oauth-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const base = readEnv().APP_URL;
  const back = (q: string) => NextResponse.redirect(new URL(`/artists?${q}`, base));
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("lsr_spotify_state")?.value;

  if (url.searchParams.get("error")) return back("spotify=denied");
  if (!code || !state || !expected || state !== expected) return back("spotify=bad_state");

  const tokens = await exchangeCode(code);
  if (!tokens.ok) return back("spotify=error");

  const followed = await followedArtists(tokens.data.access_token);
  if (!followed.ok) return back(`spotify=${followed.reason === "upstream_error" ? "not_allowed" : "error"}`);

  let added = 0;
  const ids: string[] = [];
  for (const a of followed.data) {
    const r = await addArtist({ name: a.name, spotifyId: a.spotifyId, imageUrl: a.imageUrl, genres: a.genres, source: "spotify" });
    if (r?.created) {
      added++;
      ids.push(r.artist.id);
    }
  }
  if (tokens.data.refresh_token) {
    await saveTokens("spotify", {
      refreshToken: tokens.data.refresh_token,
      accessToken: tokens.data.access_token,
      expiresAt: new Date(Date.now() + tokens.data.expires_in * 1000),
      scopes: ["user-follow-read"],
    });
  }
  after(async () => {
    for (const id of ids) await enrichArtist(id);
  });
  const res = back(`spotify=ok&added=${added}`);
  res.cookies.delete("lsr_spotify_state");
  return res;
}
