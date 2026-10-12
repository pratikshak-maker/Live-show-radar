import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, parseQuery } from "@/lib/api";
import { rateLimit, rateLimitScopeForRequest } from "@/lib/rate-limit";
import { searchArtists } from "@/lib/integrations/musicbrainz";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = parseQuery(req.url, z.object({ q: z.string().trim().min(2).max(100) }));
  if (!q.ok) return q.res;
  const rl = await rateLimit("search", rateLimitScopeForRequest(req));
  if (!rl.allowed) return apiError("rate_limited", "Slow down a little.", 429, { retryAfterSeconds: rl.retryAfterSeconds });
  const r = await searchArtists(q.data.q);
  if (!r.ok) return NextResponse.json({ results: [], note: r.message });
  return NextResponse.json({ results: r.data });
}
