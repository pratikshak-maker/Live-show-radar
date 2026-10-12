import { NextResponse } from "next/server";
import { z } from "zod";
import { adminRequired, isAdmin } from "@/lib/admin";
import { apiError, dbMissing, parseBody } from "@/lib/api";
import { maskEmail } from "@/lib/crypto";
import { getDb, setSetting } from "@/lib/db";
import { getOAuthState } from "@/lib/integrations/registry";
import { CITIES } from "@/lib/normalize";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!getDb()) return dbMissing();
  const [s, google] = await Promise.all([getAppSettings(), getOAuthState("google")]);
  return NextResponse.json({
    alertEmail: s.alertEmail,
    emailAlertsEnabled: s.emailAlertsEnabled,
    minConfidenceForEmail: s.minConfidenceForEmail,
    homeCity: s.homeCity,
    cities: Object.keys(CITIES),
    googleEmailMasked: google.email ? maskEmail(google.email) : null,
    googleEmailDefault: google.email,
    adminRequired: adminRequired(),
    adminUnlocked: await isAdmin(),
  });
}

const Patch = z.object({
  alert_email: z.string().email().max(200).or(z.literal("")).optional(),
  email_alerts_enabled: z.boolean().optional(),
  min_confidence_for_email: z.number().min(0).max(1).optional(),
  home_city: z.string().refine((c) => c in CITIES, "Unknown city").optional(),
});

export async function PATCH(req: Request) {
  if (!getDb()) return dbMissing();
  if (!(await isAdmin())) return apiError("admin_required", "Enter the admin passcode first.", 401);
  const body = await parseBody(req, Patch);
  if (!body.ok) return body.res;
  for (const [k, v] of Object.entries(body.data)) if (v !== undefined) await setSetting(k, v);
  return NextResponse.json({ ok: true });
}
