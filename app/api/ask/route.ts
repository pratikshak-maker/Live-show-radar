import { NextResponse } from "next/server";
import { z } from "zod";
import { ASK_PROMPT_V1, fill } from "@/lib/agent/prompts";
import { AskSchema, GEMINI_ASK_SCHEMA } from "@/lib/agent/schemas";
import { apiError, dbMissing, parseBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { getHomeCity } from "@/lib/settings";
import { GeminiBudget, generateJson } from "@/lib/integrations/gemini";
import { listShows } from "@/lib/queries";
import { rateLimit, rateLimitScopeForRequest } from "@/lib/rate-limit";
import { todayIST } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!getDb()) return dbMissing();
  const body = await parseBody(req, z.object({ question: z.string().trim().min(2).max(300) }));
  if (!body.ok) return body.res;
  const env = readEnv();
  const homeCity = await getHomeCity();
  if (!env.GEMINI_API_KEY)
    return NextResponse.json({ answer: null, reason: "not_configured", shows: [] });

  const rl = await rateLimit("ask", rateLimitScopeForRequest(req));
  if (!rl.allowed)
    return apiError("rate_limited", "You've asked a lot this hour — try again soon.", 429, {
      retryAfterSeconds: rl.retryAfterSeconds,
    });

  const shows = (await listShows()).filter((s) => !s.is_sample).slice(0, 150);
  const compact = shows.map((s) => ({
    id: s.id,
    artist: s.artist.name,
    city: s.city,
    venue: s.venue_name,
    date: s.start_date,
    early_bird: s.early_bird_status,
    early_bird_deadline: s.early_bird_deadline,
    priority: s.priority_score,
  }));
  const prompt = fill(ASK_PROMPT_V1, {
    TODAY_IST: todayIST(),
    HOME_CITY: homeCity,
    SHOWS_JSON: JSON.stringify(compact),
    QUESTION: body.data.question,
  });
  const r = await generateJson(prompt, GEMINI_ASK_SCHEMA, AskSchema, new GeminiBudget(3));
  if (!r.ok) return NextResponse.json({ answer: null, reason: "unavailable", shows: [] });
  const known = new Map(shows.map((s) => [s.id, s]));
  const matched = r.data.data.show_ids
    .filter((id) => known.has(id))
    .slice(0, 8)
    .map((id) => known.get(id)!);
  return NextResponse.json({ answer: r.data.data.answer, shows: matched });
}
