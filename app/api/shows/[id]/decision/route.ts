import { NextResponse } from "next/server";
import { z } from "zod";
import { buildCalendarEvents, templateLink, type CalendarKind } from "@/lib/calendar-build";
import { apiError, dbMissing, parseBody, UUID } from "@/lib/api";
import { getDb, one } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/integrations/calendar";
import { getOAuthState } from "@/lib/integrations/registry";
import { rateLimit, rateLimitScopeForRequest } from "@/lib/rate-limit";
import { getShow } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KINDS = ["concert", "early_bird_deadline", "on_sale", "decide_reminder"] as const;

const Body = z.object({
  decision: z.enum(["going", "maybe", "not_interested"]),
  calendar: z
    .object({
      concert: z.boolean().optional(),
      earlyBirdDeadline: z.boolean().optional(),
      onSale: z.boolean().optional(),
      decideReminder: z.boolean().optional(),
    })
    .optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb();
  if (!db) return dbMissing();
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError("invalid_request", "Bad show id.");
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;

  const rl = await rateLimit("decision", rateLimitScopeForRequest(req));
  if (!rl.allowed)
    return apiError("rate_limited", "That's a lot of changes — try again soon.", 429, {
      retryAfterSeconds: rl.retryAfterSeconds,
    });

  const show = await getShow(id);
  if (!show) return apiError("not_found", "That show doesn't exist.", 404);
  if (show.is_sample)
    return apiError(
      "sample",
      "This is a sample show — real shows appear after the first check.",
      400,
    );

  await db.query("update shows set decision = $2 where id = $1", [id, body.data.decision]);

  const wanted: CalendarKind[] = [];
  const c = body.data.calendar;
  if (c?.concert) wanted.push("concert");
  if (c?.earlyBirdDeadline) wanted.push("early_bird_deadline");
  if (c?.onSale) wanted.push("on_sale");
  if (c?.decideReminder) wanted.push("decide_reminder");

  const appUrl = readEnv().APP_URL;
  const events = buildCalendarEvents(show, appUrl, new Date(), show.ai_brief);
  const google = await getOAuthState("google");
  const created: { kind: CalendarKind; htmlLink: string | null }[] = [];
  const templateLinks: { kind: CalendarKind; url: string }[] = [];

  for (const kind of wanted) {
    const ev = events[kind];
    if (!ev) continue;
    if (google.connected) {
      // Idempotent: never create a duplicate for (show, kind).
      const existing = await one<{ html_link: string | null }>(
        db,
        "select html_link from calendar_events where show_id = $1 and kind = $2",
        [id, kind],
      );
      if (existing) {
        created.push({ kind, htmlLink: existing.html_link ?? null });
        continue;
      }
      const r = await createCalendarEvent(ev, `${appUrl}/?show=${id}`);
      if (r.ok) {
        await db.query(
          `insert into calendar_events(show_id, kind, google_event_id, html_link) values ($1, $2, $3, $4)
           on conflict (show_id, kind) do nothing`,
          [id, kind, r.data.id, r.data.htmlLink],
        );
        created.push({ kind, htmlLink: r.data.htmlLink });
        continue;
      }
      // Fall through to a template link if Google failed for this event.
    }
    templateLinks.push({ kind, url: templateLink(ev) });
  }

  return NextResponse.json({
    decision: body.data.decision,
    created,
    templateLinks,
    googleConnected: google.connected,
  });
}

/** Undo: remove one calendar event (and its row), or clear the decision when no kind is given. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb();
  if (!db) return dbMissing();
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError("invalid_request", "Bad show id.");
  const kindParam = new URL(req.url).searchParams.get("kind");

  if (!kindParam) {
    await db.query("update shows set decision = null where id = $1", [id]);
    return NextResponse.json({ ok: true });
  }
  const parsed = z.enum(KINDS).safeParse(kindParam);
  if (!parsed.success) return apiError("invalid_request", "Unknown calendar kind.");
  const row = await one<{ id: string; google_event_id: string | null }>(
    db,
    "select id, google_event_id from calendar_events where show_id = $1 and kind = $2",
    [id, parsed.data],
  );
  if (row?.google_event_id) await deleteCalendarEvent(row.google_event_id);
  if (row) await db.query("delete from calendar_events where id = $1", [row.id]);
  return NextResponse.json({ ok: true });
}
