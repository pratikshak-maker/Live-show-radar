import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readEnv } from "@/lib/env";
import { GOOGLE_SCOPES, newOAuthClient } from "@/lib/integrations/google-oauth";
import { saveTokens } from "@/lib/oauth-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const env = readEnv();
  const go = (q: string) => NextResponse.redirect(new URL(`/settings?${q}`, env.APP_URL));
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("lsr_google_state")?.value;

  if (url.searchParams.get("error")) return go("google=denied");
  if (!code || !state || !expected || state !== expected) return go("google=bad_state");

  const client = newOAuthClient();
  if (!client) return go("google=not_configured");
  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) return go("google=no_refresh_token"); // user must re-consent
    let email: string | null = null;
    if (tokens.id_token && env.GOOGLE_CLIENT_ID) {
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: env.GOOGLE_CLIENT_ID,
      });
      email = ticket.getPayload()?.email ?? null;
    }
    const saved = await saveTokens("google", {
      email,
      scopes: tokens.scope?.split(" ") ?? GOOGLE_SCOPES,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token ?? null,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    });
    if (!saved) return go("google=error");
    const res = go("connected=google");
    res.cookies.delete("lsr_google_state");
    return res;
  } catch {
    return go("google=error");
  }
}
