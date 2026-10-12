import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { addArtist, enrichArtist } from "@/lib/artists";
import { apiError, dbMissing, parseBody } from "@/lib/api";
import { normalizeArtist } from "@/lib/normalize";
import { rateLimit, rateLimitScopeForRequest } from "@/lib/rate-limit";
import { topArtists } from "@/lib/integrations/lastfm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Schema = z.object({
  username: z.string().trim().min(2).max(15),
  confirm: z.array(z.string().min(1).max(120)).max(100).optional(),
});

export async function POST(req: Request) {
  const db = getDb();
  if (!db) return dbMissing();
  const body = await parseBody(req, Schema);
  if (!body.ok) return body.res;
  const rl = await rateLimit("import", rateLimitScopeForRequest(req));
  if (!rl.allowed) return apiError("rate_limited", "Too many imports. Try again later.", 429, { retryAfterSeconds: rl.retryAfterSeconds });

  const top = await topArtists(body.data.username);
  if (!top.ok) {
    const status = top.reason === "not_configured" ? 503 : 400;
    return apiError(top.reason, top.message, status);
  }

  const { data: existing } = await db.from("artists").select("name_normalized");
  const known = new Set((existing ?? []).map((r) => (r as { name_normalized: string }).name_normalized));

  if (!body.data.confirm) {
    return NextResponse.json({
      artists: top.data.map((name) => ({ name, alreadyTracked: known.has(normalizeArtist(name)) })),
    });
  }

  // Only accept names that Last.fm actually returned for this user.
  const allowed = new Set(top.data);
  const names = body.data.confirm.filter((n) => allowed.has(n) && !known.has(normalizeArtist(n)));
  let added = 0;
  for (const name of names) {
    const r = await addArtist({ name, source: "lastfm" });
    if (r?.created) {
      added++;
      const id = r.artist.id;
      after(() => enrichArtist(id));
    }
  }
  return NextResponse.json({ added });
}
