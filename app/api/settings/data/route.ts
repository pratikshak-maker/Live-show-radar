import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/admin";
import { apiError, dbMissing, parseBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { normalizeArtist } from "@/lib/normalize";
import { SEED_ARTISTS } from "@/lib/seed-data";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["clear_samples", "reset_artists"]) });

export async function POST(req: Request) {
  const db = getDb();
  if (!db) return dbMissing();
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  if (!(await isAdmin())) return apiError("admin_required", "Enter the admin passcode first.", 401);

  if (body.data.action === "clear_samples") {
    await db.query("delete from shows where is_sample");
    return NextResponse.json({ ok: true });
  }
  // Reset to the starter list: re-add / re-activate seed artists. Nothing is deleted.
  const rows = SEED_ARTISTS.map((a) => ({
    name: a.name,
    name_normalized: normalizeArtist(a.name),
    origin: a.origin,
    source: "seed" as const,
    is_favorite: a.favorite ?? false,
    is_active: true,
  }));
  for (const r of rows) {
    await db.query(
      `insert into artists(name, name_normalized, origin, source, is_favorite, is_active)
       values ($1, $2, $3, $4, $5, true) on conflict (name_normalized) do nothing`,
      [r.name, r.name_normalized, r.origin, r.source, r.is_favorite],
    );
  }
  await db.query("update artists set is_active = true where source = 'seed'");
  return NextResponse.json({ ok: true, count: rows.length });
}
