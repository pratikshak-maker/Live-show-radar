import { NextResponse } from "next/server";
import { enrichMissing } from "@/lib/artists";
import { runScan } from "@/lib/agent/run-scan";
import { deadlineSweep, expireDeadlines, markPastShows } from "@/lib/agent/sweeps";
import { apiError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { readEnv } from "@/lib/env";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = readEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return apiError("unauthorized", "Unauthorized", 401);
  const db = getDb();
  if (!db) return apiError("db_not_configured", "Database not connected.", 503);

  const scan = await runScan({ trigger: "cron" });
  await markPastShows(db);
  await expireDeadlines(db);
  const closingSoon = await deadlineSweep(db);
  const enriched = await enrichMissing(2);

  return NextResponse.json({ ok: true, scan, closingSoon, enriched });
}
