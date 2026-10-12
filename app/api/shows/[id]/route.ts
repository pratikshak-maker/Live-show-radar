import { NextResponse } from "next/server";
import { apiError, dbMissing, UUID } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getShow } from "@/lib/queries";
import { getOAuthState } from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb();
  if (!db) return dbMissing();
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError("invalid_request", "Bad show id.");
  const show = await getShow(id);
  if (!show) return apiError("not_found", "That show doesn't exist.", 404);
  const [changes, events, google] = await Promise.all([
    db.query(
      "select id, change_type, before, after, created_at from show_changes where show_id = $1 order by created_at desc limit 30",
      [id],
    ),
    db.query("select kind, html_link, google_event_id from calendar_events where show_id = $1", [
      id,
    ]),
    getOAuthState("google"),
  ]);
  return NextResponse.json({
    show,
    changes: changes ?? [],
    calendarEvents: events ?? [],
    googleConnected: google.connected,
  });
}
