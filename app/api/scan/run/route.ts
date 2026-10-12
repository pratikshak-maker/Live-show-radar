import { after, NextResponse } from "next/server";
import { z } from "zod";
import { executeScan, startScan } from "@/lib/agent/run-scan";
import { apiError, dbMissing, parseBody, UUID } from "@/lib/api";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const Schema = z.object({ artistId: z.string().regex(UUID).optional() });

async function activeRunId(): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const { data } = await db.from("scan_runs").select("id").eq("status", "running").order("started_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function POST(req: Request) {
  if (!getDb()) return dbMissing();
  const body = await parseBody(req, Schema);
  if (!body.ok) return body.res;
  const { artistId } = body.data;

  const rl = artistId ? await rateLimit("scan_artist", artistId) : await rateLimit("scan_manual", "global");
  if (!rl.allowed) {
    const active = await activeRunId();
    if (active) return NextResponse.json({ runId: active, attached: true });
    return apiError("rate_limited", "Just checked — the next check is available shortly.", 429, { retryAfterSeconds: rl.retryAfterSeconds });
  }

  const started = await startScan(artistId ? "artist" : "manual", artistId ? [artistId] : undefined);
  if (started.status === "busy") {
    if (started.runId) return NextResponse.json({ runId: started.runId, attached: true });
    return apiError("busy", "A check is already running. Try again in a moment.", 409);
  }
  if (started.status === "no_db") return dbMissing();

  const runId = started.runId;
  // Respond now; the work continues within maxDuration. The UI polls /api/scan/runs/[id].
  after(() => executeScan(runId, artistId ? [artistId] : undefined));
  return NextResponse.json({ runId, attached: false });
}
