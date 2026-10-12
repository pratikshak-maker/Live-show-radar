import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_COOKIE, adminCookieValue, adminRequired, isAdmin, passcodeMatches } from "@/lib/admin";
import { apiError, parseBody } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ required: adminRequired(), unlocked: await isAdmin() });
}

export async function POST(req: Request) {
  const body = await parseBody(req, z.object({ passcode: z.string().min(1).max(200) }));
  if (!body.ok) return body.res;
  if (!adminRequired()) return NextResponse.json({ ok: true });
  if (!passcodeMatches(body.data.passcode)) return apiError("bad_passcode", "That passcode didn't match.", 401);
  const value = adminCookieValue();
  if (!value) return apiError("not_configured", "Set TOKEN_ENCRYPTION_KEY or ADMIN_PASSCODE to sign cookies.", 503);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
  return res;
}
