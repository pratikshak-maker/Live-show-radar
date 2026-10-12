import { NextResponse } from "next/server";
import { z } from "zod";
import { buildCalendarEvents, templateLink, type CalendarKind } from "@/lib/calendar-build";
import { apiError, dbMissing, parseBody, UUID } from "@/lib/api";
import { getDb } from "@/lib/db";
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

  await db.from("shows").update({ decision: body.data.decision }).eq("id", id);

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
      const { data: existing } = await db
        .from("calendar_events")
        .select("html_link")
        .eq("show_id", id)
        .eq("kind", kind)
        .maybeSingle();
      if (existing) {
        created.push({ kind, htmlLink: (existing.html_link as string | null) ?? null });
        continue;
      }
      const r = await createCalendarEvent(ev, `${appUrl}/?show=${id}`);
      if (r.ok) {
        await db
          .from("calendar_events")
          .upsert(
            { show_id: id, kind, google_event_id: r.data.id, html_link: r.data.htmlLink },
            { onConflict: "show_id,kind", ignoreDuplicates: true },
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
    await db.from("shows").update({ decision: null }).eq("id", id);
    return NextResponse.json({ ok: true });
  }
  const parsed = z.enum(KINDS).safeParse(kindParam);
  if (!parsed.success) return apiError("invalid_request", "Unknown calendar kind.");
  const { data: row } = await db
    .from("calendar_events")
    .select("id, google_event_id")
    .eq("show_id", id)
    .eq("kind", parsed.data)
    .maybeSingle();
  if (row?.google_event_id) await deleteCalendarEvent(row.google_event_id as string);
  if (row)
    await db
      .from("calendar_events")
      .delete()
      .eq("id", row.id as string);
  return NextResponse.json({ ok: true });
}
