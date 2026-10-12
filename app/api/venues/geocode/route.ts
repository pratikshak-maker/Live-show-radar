import { NextResponse } from "next/server";
import { dbMissing } from "@/lib/api";
import { getDb, one } from "@/lib/db";
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
  const left = await one<{ n: number }>(
    db,
    "select count(*)::int as n from venues where geocoded_at is null",
  );
  return NextResponse.json({ done, remaining: left?.n ?? 0 });
}
