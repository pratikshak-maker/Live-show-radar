import { Type } from "@google/genai";
import { z } from "zod";

export const TierSchema = z.object({
  name: z.string().min(1),
  price_inr: z.number().int().positive().nullable(),
  status: z.enum(["on_sale", "sold_out", "upcoming", "unknown"]),
  sale_start: z.string().nullable(),
  sale_end: z.string().nullable(),
  is_early_bird: z.boolean(),
});

export const ExtractedShowSchema = z.object({
  artist_name_as_written: z.string(),
  is_this_artist: z.boolean(),
  title: z.string().nullable(),
  event_type: z.enum(["concert", "festival", "club", "other"]),
  city: z.string(),
  state: z.string().nullable(),
  country: z.string(),
  venue_name: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string().nullable(),
  start_time: z.string().nullable(),
  ticket_url: z.string().url().nullable(),
  ticket_platform: z.string().nullable(),
  tiers: z.array(TierSchema),
  on_sale_at: z.string().nullable(),
  early_bird_mentioned: z.boolean(),
  status: z.enum(["scheduled", "cancelled", "postponed"]),
  evidence_urls: z.array(z.string().url()).min(1),
  evidence_quote: z.string().max(300),
});

export const ExtractionSchema = z.object({
  shows: z.array(ExtractedShowSchema),
  notes: z.string().max(500).nullable(),
});

export type Tier = z.infer<typeof TierSchema>;
export type ExtractedShow = z.infer<typeof ExtractedShowSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;

/** A candidate show on its way through validate → reconcile. */
export type Candidate = ExtractedShow & { from: "ai" | "ticketmaster" | "rules" };

// ── Gemini response-schema mirror of ExtractionSchema ───────────────
const str = (nullable = false) => ({ type: Type.STRING, nullable });

export const GEMINI_EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    shows: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          artist_name_as_written: str(),
          is_this_artist: { type: Type.BOOLEAN },
          title: str(true),
          event_type: { type: Type.STRING, enum: ["concert", "festival", "club", "other"] },
          city: str(),
          state: str(true),
          country: str(),
          venue_name: str(true),
          start_date: str(),
          end_date: str(true),
          start_time: str(true),
          ticket_url: str(true),
          ticket_platform: str(true),
          tiers: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: str(),
                price_inr: { type: Type.INTEGER, nullable: true },
                status: { type: Type.STRING, enum: ["on_sale", "sold_out", "upcoming", "unknown"] },
                sale_start: str(true),
                sale_end: str(true),
                is_early_bird: { type: Type.BOOLEAN },
              },
              required: ["name", "price_inr", "status", "sale_start", "sale_end", "is_early_bird"],
            },
          },
          on_sale_at: str(true),
          early_bird_mentioned: { type: Type.BOOLEAN },
          status: { type: Type.STRING, enum: ["scheduled", "cancelled", "postponed"] },
          evidence_urls: { type: Type.ARRAY, items: { type: Type.STRING } },
          evidence_quote: str(),
        },
        required: [
          "artist_name_as_written",
          "is_this_artist",
          "title",
          "event_type",
          "city",
          "state",
          "country",
          "venue_name",
          "start_date",
          "end_date",
          "start_time",
          "ticket_url",
          "ticket_platform",
          "tiers",
          "on_sale_at",
          "early_bird_mentioned",
          "status",
          "evidence_urls",
          "evidence_quote",
        ],
      },
    },
    notes: str(true),
  },
  required: ["shows", "notes"],
};

// ── Brief + Ask ─────────────────────────────────────────────────────
export const BriefSchema = z.object({
  headline: z.string().max(80),
  urgency: z.enum(["buy_today", "this_week", "no_rush", "unclear"]),
  reasons: z.array(z.string().max(120)).min(1).max(3),
  travel_note: z.string().max(200).nullable(),
  caveat: z.string().max(200).nullable(),
});

export const GEMINI_BRIEF_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headline: str(),
    urgency: { type: Type.STRING, enum: ["buy_today", "this_week", "no_rush", "unclear"] },
    reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
    travel_note: str(true),
    caveat: str(true),
  },
  required: ["headline", "urgency", "reasons", "travel_note", "caveat"],
};

export const AskSchema = z.object({
  answer: z.string().max(600),
  show_ids: z.array(z.string()).max(8),
});

export const GEMINI_ASK_SCHEMA = {
  type: Type.OBJECT,
  properties: { answer: str(), show_ids: { type: Type.ARRAY, items: { type: Type.STRING } } },
  required: ["answer", "show_ids"],
};
