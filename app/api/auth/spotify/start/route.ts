import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { spotifyAuthUrl } from "@/lib/integrations/spotify";
import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = randomBytes(32).toString("hex");
  const url = spotifyAuthUrl(state);
  if (!url) return NextResponse.redirect(new URL("/artists?spotify=not_configured", readEnv().APP_URL));
  const res = NextResponse.redirect(url);
  res.cookies.set("lsr_spotify_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
