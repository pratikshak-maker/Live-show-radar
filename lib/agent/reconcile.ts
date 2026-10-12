import type { SupabaseClient } from "@supabase/supabase-js";
import { dedupeKey, isHomeCity, isHttpUrl, isTicketingDomain, normalizeArtist, venueKey } from "../normalize";
import { deriveEarlyBird, priorityScore } from "../scoring";
import { diffDaysISO } from "../time";
import type { ArtistRow, ChangeType, ShowRow, SourceRef, Tier } from "../types";
import type { RunCtx, ValidCandidate } from "./types";

export function findMatch(
  existing: Pick<ShowRow, "id" | "city_slug" | "start_date">[],
  citySlug: string,
  startDate: string,
): (typeof existing)[number] | null {
  const sameCity = existing.filter((s) => s.city_slug === citySlug);
  return (
    sameCity.find((s) => s.start_date === startDate) ??
    sameCity.find((s) => Math.abs(diffDaysISO(s.start_date, startDate)) <= 1) ??
    null
  );
}

/** Tiers are merged by name; the freshest data wins, but an empty incoming list never wipes old data. */
export function mergeTiers(old: Tier[], incoming: Tier[]): Tier[] {
  if (incoming.length === 0) return old;
  const map = new Map<string, Tier>();
  for (const t of old) map.set(t.name.toLowerCase().trim(), t);
  for (const t of incoming) map.set(t.name.toLowerCase().trim(), t);
  return [...map.values()];
}

export function mergeSources(old: SourceRef[], incoming: SourceRef[]): SourceRef[] {
  const map = new Map<string, SourceRef>();
  for (const s of old) map.set(s.url, s);
  for (const s of incoming) map.set(s.url, s);
  return [...map.values()];
}

export type ShowPatch = Omit<
  ShowRow,
  "id" | "artist_id" | "decision" | "ai_brief" | "ai_brief_hash" | "is_sample" | "first_seen_at" | "venue_id" | "updated_at"
>;

export type UpsertPlan = { patch: ShowPatch; changes: ChangeType[]; isNew: boolean };

/** Pure: compute the merged row and the list of change events. Unit-tested. */
export function planUpsert(
  old: ShowRow | null,
  vc: ValidCandidate,
  artist: Pick<ArtistRow, "name" | "is_favorite">,
  homeCity: string,
  now: Date,
): UpsertPlan {
  const tiers = mergeTiers(old?.tiers ?? [], vc.tiers);
  const sources = mergeSources(old?.sources ?? [], vc.sourceRefs);
  const onSaleAt = vc.on_sale_at ?? old?.on_sale_at ?? null;
  const mentioned = vc.early_bird_mentioned || tiers.some((t) => t.is_early_bird);
  const eb = deriveEarlyBird(tiers, onSaleAt, now, mentioned);

  // A ±1 day match is normally listing/timezone noise. Only a ticketing-confirmed date overrides.
  let startDate = vc.start_date;
  let dateChanged = false;
  if (old && old.start_date !== vc.start_date) {
    if (vc.ticketingConfirmed) dateChanged = true;
    else startDate = old.start_date;
  }

  const prices = tiers.map((t) => t.price_inr).filter((p): p is number => typeof p === "number");
  const ticketUrl = isHttpUrl(vc.ticket_url) && isTicketingDomain(vc.ticket_url) ? vc.ticket_url : (old?.ticket_url ?? (isHttpUrl(vc.ticket_url) ? vc.ticket_url : null));
  const confidence = Math.max(old ? Number(old.confidence) : 0, vc.confidence);
  const status = vc.status === "scheduled" ? (old?.status === "cancelled" ? "scheduled" : (old?.status ?? "scheduled")) : vc.status;
  const isHome = isHomeCity(vc.cityInfo.name, homeCity);

  const patch: ShowPatch = {
    dedupe_key: dedupeKey(artist.name, vc.cityInfo.slug, startDate),
    title: vc.title ?? old?.title ?? null,
    event_type: vc.event_type,
    city: vc.cityInfo.name,
    city_slug: vc.cityInfo.slug,
    state: vc.state ?? vc.cityInfo.state,
    is_home_city: isHome,
    venue_name: vc.venue_name ?? old?.venue_name ?? null,
    start_date: startDate,
    end_date: vc.end_date ?? old?.end_date ?? null,
    start_time: vc.start_time ?? old?.start_time ?? null,
    ticket_url: ticketUrl,
    ticket_platform: vc.ticket_platform ?? old?.ticket_platform ?? null,
    early_bird_status: eb.status,
    early_bird_deadline: eb.deadline ?? (eb.status === "unknown" || eb.status === "open" ? (old?.early_bird_deadline ?? null) : null),
    on_sale_at: onSaleAt,
    price_min_inr: prices.length ? Math.min(...prices) : (old?.price_min_inr ?? null),
    price_max_inr: prices.length ? Math.max(...prices) : (old?.price_max_inr ?? null),
    tiers,
    confidence,
    priority_score: 0,
    sources,
    status,
    last_seen_at: now.toISOString(),
    last_enriched_at: vc.sourceRefs.some((s) => s.kind === "scrapingbee") ? now.toISOString() : (old?.last_enriched_at ?? null),
  };
  patch.priority_score = priorityScore(
    { isHomeCity: isHome, earlyBird: eb.status, firstSeenAt: old?.first_seen_at ?? now.toISOString(), isFavorite: artist.is_favorite, confidence },
    now,
  );

  const changes: ChangeType[] = [];
  if (!old) {
    changes.push("new_show");
  } else {
    if (eb.status === "open" && ["unknown", "imminent", "not_offered"].includes(old.early_bird_status)) changes.push("early_bird_opened");
    if (eb.status === "closing_soon" && old.early_bird_status !== "closing_soon") changes.push("early_bird_closing_soon");
    if (eb.status === "imminent" && old.early_bird_status !== "imminent" && eb.deadline) changes.push("early_bird_imminent");
    if (!old.early_bird_deadline && patch.early_bird_deadline) changes.push("deadline_found");
    const oldSold = new Set(old.tiers.filter((t) => t.status === "sold_out").map((t) => t.name.toLowerCase()));
    if (tiers.some((t) => t.status === "sold_out" && !oldSold.has(t.name.toLowerCase()))) changes.push("tier_sold_out");
    if (dateChanged) changes.push("date_changed");
    if (old.venue_name && patch.venue_name && normalizeArtist(old.venue_name) !== normalizeArtist(patch.venue_name)) changes.push("venue_changed");
    if (status === "cancelled" && old.status !== "cancelled") changes.push("cancelled");
  }
  return { patch, changes, isNew: !old };
}

export type ReconcileResult = { showId: string; isNew: boolean; changes: ChangeType[] };

/** Apply a plan to the DB (upsert show, venue link, change rows). `existing` is mutated to stay current. */
export async function reconcileCandidate(
  db: SupabaseClient,
  artist: ArtistRow,
  vc: ValidCandidate,
  existing: ShowRow[],
  ctx: RunCtx,
): Promise<ReconcileResult | null> {
  const match = findMatch(existing, vc.cityInfo.slug, vc.start_date);
  const old = match ? (existing.find((s) => s.id === match.id) ?? null) : null;
  const now = ctx.now();
  const plan = planUpsert(old, vc, artist, ctx.homeCity, now);

  // Venue cache row (coordinates are filled lazily).
  let venueId: string | null = old?.venue_id ?? null;
  if (plan.patch.venue_name) {
    const key = venueKey(plan.patch.venue_name, plan.patch.city);
    const { data: v } = await db
      .from("venues")
      .upsert({ name: plan.patch.venue_name, city: plan.patch.city, key }, { onConflict: "key" })
      .select("id")
      .single();
    venueId = (v?.id as string | undefined) ?? venueId;
  }

  let row: ShowRow | null = null;
  if (old) {
    const { data, error } = await db
      .from("shows")
      .update({ ...plan.patch, venue_id: venueId, updated_at: now.toISOString() })
      .eq("id", old.id)
      .select("*")
      .single();
    if (error || !data) return null;
    row = data as ShowRow;
    const i = existing.findIndex((s) => s.id === old.id);
    if (i >= 0) existing[i] = row;
  } else {
    const { data, error } = await db
      .from("shows")
      .insert({ ...plan.patch, artist_id: artist.id, venue_id: venueId, first_seen_at: now.toISOString() })
      .select("*")
      .single();
    if (error || !data) return null;
    row = data as ShowRow;
    existing.push(row);
  }

  for (const type of plan.changes) {
    const { data } = await db
      .from("show_changes")
      .insert({
        show_id: row.id,
        change_type: type,
        before: old ? { early_bird_status: old.early_bird_status, start_date: old.start_date, venue_name: old.venue_name, early_bird_deadline: old.early_bird_deadline } : null,
        after: { early_bird_status: row.early_bird_status, start_date: row.start_date, venue_name: row.venue_name, early_bird_deadline: row.early_bird_deadline },
      })
      .select("id")
      .single();
    if (data?.id) ctx.changeIds.push(data.id as string);
  }
  return { showId: row.id, isNew: plan.isNew, changes: plan.changes };
}
