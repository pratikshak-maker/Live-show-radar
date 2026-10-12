import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, one } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { alertMessage } from "@/lib/email/messages";

export const dynamic = "force-dynamic";

type AlertRow = {
  id: string;
  show_id: string;
  alert_type: string;
  read_at: string | null;
  created_at: string;
  city: string;
  start_date: string;
  artist_name: string;
};

export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ alerts: [], unread: 0 });
  const rows = await db.query<AlertRow>(
    `select al.id, al.show_id, al.alert_type, al.read_at, al.created_at,
            s.city, s.start_date, a.name as artist_name
       from alerts al
       join shows s on s.id = al.show_id
       join artists a on a.id = s.artist_id
      where al.channel = 'in_app'
      order by al.created_at desc
      limit 20`,
  );
  const alerts = rows.map((r) => ({
    id: r.id,
    show_id: r.show_id,
    alert_type: r.alert_type,
    read_at: r.read_at,
    created_at: r.created_at,
    message: alertMessage(r.alert_type, r.artist_name, r.city, r.start_date),
  }));
  const unread = await one<{ n: number }>(
    db,
    "select count(*)::int as n from alerts where channel = 'in_app' and read_at is null",
  );
  return NextResponse.json({ alerts, unread: unread?.n ?? 0 });
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
  if (body.data.all) {
    await db.query("update alerts set read_at = $1 where channel = 'in_app' and read_at is null", [
      now,
    ]);
  } else {
    await db.query(
      "update alerts set read_at = $1 where channel = 'in_app' and read_at is null and id = any($2::uuid[])",
      [now, body.data.ids ?? []],
    );
  }
  return NextResponse.json({ ok: true });
}
