import { NextResponse } from "next/server";
import { z } from "zod";
import { dbMissing, parseQuery } from "@/lib/api";
import { getDb } from "@/lib/db";
import { ensureSampleShows } from "@/lib/sample-mode";
import { listShows } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Query = z.object({
  lane: z.enum(["act_now", "home", "elsewhere", "all"]).default("all"),
  city: z.string().max(60).optional(),
  status: z.string().optional(),
  q: z.string().max(100).optional(),
  includeHidden: z.enum(["0", "1", "true", "false"]).optional(),
});

export async function GET(req: Request) {
  if (!getDb()) return dbMissing();
  const q = parseQuery(req.url, Query);
  if (!q.ok) return q.res;
  await ensureSampleShows();
  const shows = await listShows({
    lane: q.data.lane,
    city: q.data.city,
    q: q.data.q,
    includeHidden: q.data.includeHidden === "1" || q.data.includeHidden === "true",
  });
  return NextResponse.json({ shows });
}
