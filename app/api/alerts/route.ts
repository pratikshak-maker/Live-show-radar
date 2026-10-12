import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { alertMessage } from "@/lib/email/messages";
import type { ShowRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type AlertRow = {
  id: string;
  show_id: string;
  alert_type: string;
  read_at: string | null;
  created_at: string;
  show: (Pick<ShowRow, "city" | "start_date" | "early_bird_status"> & { artist: { name: string } | null }) | null;
};

export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ alerts: [], unread: 0 });
  const { data } = await db
    .from("alerts")
    .select("id, show_id, alert_type, read_at, created_at, show:shows(city, start_date, early_bird_status, artist:artists(name))")
    .eq("channel", "in_app")
    .order("created_at", { ascending: false })
    .limit(20);
  const rows = ((data ?? []) as unknown as AlertRow[]).filter((r) => r.show?.artist);
  const alerts = rows.map((r) => ({
    id: r.id,
    show_id: r.show_id,
    alert_type: r.alert_type,
    read_at: r.read_at,
    created_at: r.created_at,
    message: alertMessage(r.alert_type, r.show!.artist!.name, r.show!.city, r.show!.start_date),
  }));
  const { count } = await db
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .eq("channel", "in_app")
    .is("read_at", null);
  return NextResponse.json({ alerts, unread: count ?? 0 });
}

const PatchSchema = z.object({
  ids: z.array(z.string().uuid()).max(50).optional(),
  all: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const db = getDb();
  if (!db) return apiError("db_not_configured", "Database not connected.", 503);
  const body = await parseBody(req, PatchSchema);
  if (!body.ok) return body.res;
  const now = new Date().toISOString();
  let q = db.from("alerts").update({ read_at: now }).eq("channel", "in_app").is("read_at", null);
  if (!body.data.all) q = q.in("id", body.data.ids ?? []);
  await q;
  return NextResponse.json({ ok: true });
}
