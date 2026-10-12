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
    await db.from("shows").delete().eq("is_sample", true);
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
  await db.from("artists").upsert(rows, { onConflict: "name_normalized", ignoreDuplicates: true });
  await db.from("artists").update({ is_active: true }).eq("source", "seed");
  return NextResponse.json({ ok: true, count: rows.length });
}
