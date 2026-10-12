import { NextResponse } from "next/server";
import { dbMissing } from "@/lib/api";
import { getDb } from "@/lib/db";
import { geocodePending } from "@/lib/geocode";
import { rateLimit, rateLimitScopeForRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Lazily geocodes a few venues (1 req/s throttle inside) the first time the map is viewed. */
export async function POST(req: Request) {
  const db = getDb();
  if (!db) return dbMissing();
  const rl = await rateLimit("search", rateLimitScopeForRequest(req));
  if (!rl.allowed) return NextResponse.json({ done: 0, remaining: 0 });
  const done = await geocodePending(db, 3);
  const { count } = await db
    .from("venues")
    .select("id", { count: "exact", head: true })
    .is("geocoded_at", null);
  return NextResponse.json({ done, remaining: count ?? 0 });
}
