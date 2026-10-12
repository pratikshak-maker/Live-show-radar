import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { BRIEF_PROMPT_V1, fill } from "@/lib/agent/prompts";
import { BriefSchema, GEMINI_BRIEF_SCHEMA } from "@/lib/agent/schemas";
import { apiError, dbMissing, UUID } from "@/lib/api";
import { getDb, json, one } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { getHomeCity } from "@/lib/settings";
import { GeminiBudget, generateJson } from "@/lib/integrations/gemini";
import { rateLimit, rateLimitScopeForRequest } from "@/lib/rate-limit";
import { getShow } from "@/lib/queries";
import { todayIST } from "@/lib/time";
import { formatInTimeZone } from "date-fns-tz";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb();
  if (!db) return dbMissing();
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError("invalid_request", "Bad show id.");
  const show = await getShow(id);
  if (!show) return apiError("not_found", "That show doesn't exist.", 404);

  const env = readEnv();
  const homeCity = await getHomeCity();
  const today = todayIST();
  const fields = {
    artist: show.artist.name,
    city: show.city,
    venue: show.venue_name,
    date: show.start_date,
    time: show.start_time,
    status: show.status,
    early_bird_status: show.early_bird_status,
    early_bird_deadline: show.early_bird_deadline,
    on_sale_at: show.on_sale_at,
    tiers: show.tiers,
    price_min_inr: show.price_min_inr,
    confidence: show.confidence,
    home: homeCity,
    today,
  };
  const hash = createHash("sha256").update(JSON.stringify(fields)).digest("hex");
  if (show.ai_brief && show.ai_brief_hash === hash)
    return NextResponse.json({ brief: show.ai_brief, cached: true });
  if (!env.GEMINI_API_KEY) return NextResponse.json({ brief: null, reason: "not_configured" });
  if (show.is_sample) return NextResponse.json({ brief: null, reason: "sample" });

  const rl = await rateLimit("brief", rateLimitScopeForRequest(req));
  if (!rl.allowed) {
    if (show.ai_brief) return NextResponse.json({ brief: show.ai_brief, cached: true });
    return apiError("rate_limited", "Too many briefs this hour.", 429, {
      retryAfterSeconds: rl.retryAfterSeconds,
    });
  }

  const going = await one<{ n: number }>(
    db,
    "select count(*)::int as n from shows where artist_id = $1 and decision = 'going' and id <> $2",
    [show.artist_id, show.id],
  );
  const count = going?.n ?? 0;

  const prompt = fill(BRIEF_PROMPT_V1, {
    TODAY_IST: today,
    WEEKDAY: formatInTimeZone(new Date(), "Asia/Kolkata", "EEEE"),
    HOME_CITY: homeCity,
    SHOW_JSON: JSON.stringify(fields),
    GOING_COUNT: String(count ?? 0),
  });
  const r = await generateJson(prompt, GEMINI_BRIEF_SCHEMA, BriefSchema, new GeminiBudget(3));
  if (!r.ok) {
    if (show.ai_brief) return NextResponse.json({ brief: show.ai_brief, cached: true });
    return NextResponse.json({
      brief: null,
      reason: r.reason === "not_configured" ? "not_configured" : "unavailable",
    });
  }
  const brief = r.data.data;
  await db.query("update shows set ai_brief = $2::jsonb, ai_brief_hash = $3 where id = $1", [
    id,
    json(brief),
    hash,
  ]);
  return NextResponse.json({ brief, cached: false });
}
