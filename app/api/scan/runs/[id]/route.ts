import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, dbMissing, parseQuery, UUID } from "@/lib/api";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb();
  if (!db) return dbMissing();
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError("invalid_request", "Bad run id.");
  const q = parseQuery(req.url, z.object({ afterLogId: z.coerce.number().int().min(0).default(0) }));
  if (!q.ok) return q.res;

  const { data: run } = await db.from("scan_runs").select("*").eq("id", id).maybeSingle();
  if (!run) return apiError("not_found", "That run doesn't exist.", 404);
  const { data: logs } = await db
    .from("scan_logs")
    .select("id, ts, level, artist_name, step, message")
    .eq("run_id", id)
    .gt("id", q.data.afterLogId)
    .order("id", { ascending: true })
    .limit(300);
  return NextResponse.json({ run, logs: logs ?? [], done: run.status !== "running" });
}
