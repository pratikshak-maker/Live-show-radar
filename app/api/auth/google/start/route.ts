import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { readEnv } from "@/lib/env";
import { googleAuthUrl } from "@/lib/integrations/google-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  const base = readEnv().APP_URL;
  if (!(await isAdmin())) return NextResponse.redirect(new URL("/settings?admin=required", base));
  const state = randomBytes(32).toString("hex");
  const url = googleAuthUrl(state);
  if (!url) return NextResponse.redirect(new URL("/settings?google=not_configured", base));
  const res = NextResponse.redirect(url);
  res.cookies.set("lsr_google_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
