import { NextResponse } from "next/server";
import { apiError, dbMissing } from "@/lib/api";
import { getDb } from "@/lib/db";
import { buildEmail } from "@/lib/email/templates";
import { sendAlertEmail } from "@/lib/email/send";
import { readEnv } from "@/lib/env";
import { maskEmail } from "@/lib/crypto";
import { fixtureShow } from "@/lib/fixtures";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Sends a real email built from a clearly-marked sample show. */
export async function POST() {
  const db = getDb();
  if (!db) return dbMissing();
  const { count } = await db
    .from("artists")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  const show = fixtureShow({
    name: "Sample Artist",
    city: "Bengaluru",
    is_home_city: true,
    venue_name: "Sample Venue",
  });
  const content = buildEmail([{ show, changeType: "new_show" }], {
    appUrl: readEnv().APP_URL,
    artistCount: count ?? 0,
    testBanner: true,
  });
  const r = await sendAlertEmail(content);
  if (!r.ok) {
    return apiError(
      r.reason,
      r.reason === "not_configured"
        ? "Connect Google (or add Gmail SMTP details) to send email alerts."
        : r.message,
      r.reason === "not_configured" ? 400 : 502,
    );
  }
  return NextResponse.json({ ok: true, channel: r.data.channel, to: maskEmail(r.data.to) });
}
