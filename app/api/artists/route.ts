import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { addArtist, enrichArtist } from "@/lib/artists";
import { apiError, dbMissing, parseBody, UUID } from "@/lib/api";
import { listArtists } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  if (!getDb()) return dbMissing();
  return NextResponse.json({ artists: await listArtists() });
}

const PostSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mbid: z.string().uuid().nullish(),
  disambiguation: z.string().max(200).nullish(),
  country: z.string().max(4).nullish(),
});

export async function POST(req: Request) {
  if (!getDb()) return dbMissing();
  const body = await parseBody(req, PostSchema);
  if (!body.ok) return body.res;
  const added = await addArtist({ ...body.data, source: "manual" });
  if (!added) return apiError("insert_failed", "Couldn't add that artist.", 500);
  if (added.created) await enrichArtist(added.artist.id);
  const artists = await listArtists();
  return NextResponse.json({
    artist: artists.find((a) => a.id === added.artist.id) ?? added.artist,
    created: added.created,
  });
}

const PatchSchema = z.object({
  id: z.string().regex(UUID),
  is_favorite: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const db = getDb();
  if (!db) return dbMissing();
  const body = await parseBody(req, PatchSchema);
  if (!body.ok) return body.res;
  const { id, ...patch } = body.data;
  if (Object.keys(patch).length === 0) return apiError("invalid_request", "Nothing to update.");
  const { error } = await db.from("artists").update(patch).eq("id", id);
  if (error) return apiError("update_failed", "Couldn't update that artist.", 500);
  return NextResponse.json({ ok: true });
}

/** Permanent delete (also removes the artist's shows). Admin-only when ADMIN_PASSCODE is set. */
export async function DELETE(req: Request) {
  const db = getDb();
  if (!db) return dbMissing();
  if (!(await isAdmin())) return apiError("admin_required", "Enter the admin passcode in Settings first.", 401);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return apiError("invalid_request", "Missing artist id.");
  await db.from("artists").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
