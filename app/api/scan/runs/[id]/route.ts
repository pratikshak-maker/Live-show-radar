import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, dbMissing, parseQuery, UUID } from "@/lib/api";
import { getDb, one } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb();
  if (!db) return dbMissing();
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError("invalid_request", "Bad run id.");
  const q = parseQuery(
    req.url,
    z.object({ afterLogId: z.coerce.number().int().min(0).default(0) }),
  );
  if (!q.ok) return q.res;

  const run = await one<{ status: string }>(db, "select * from scan_runs where id = $1", [id]);
  if (!run) return apiError("not_found", "That run doesn't exist.", 404);
  const logs = await db.query(
    `select id, ts, level, artist_name, step, message from scan_logs
      where run_id = $1 and id > $2 order by id asc limit 300`,
    [id, q.data.afterLogId],
  );
  return NextResponse.json({ run, logs, done: run.status !== "running" });
}
