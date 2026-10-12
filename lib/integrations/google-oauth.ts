import { google } from "googleapis";
import { encryptionAvailable } from "../crypto";
import { readEnv } from "../env";
import { loadTokens, markNeedsReconnect, saveTokens } from "../oauth-store";
import { errMessage, fail, notConfigured, ok, type Result } from "../result";

/** Derived from googleapis so the type matches its bundled google-auth-library. */
export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
];

export function googleConfigured(): boolean {
  const e = readEnv();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) && encryptionAvailable();
}

export function newOAuthClient(): OAuth2Client | null {
  const e = readEnv();
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) return null;
  return new google.auth.OAuth2(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET, e.GOOGLE_REDIRECT_URI);
}

export function googleAuthUrl(state: string): string | null {
  const c = newOAuthClient();
  if (!c || !encryptionAvailable()) return null;
  return c.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  });
}

export function isInvalidGrant(e: unknown): boolean {
  const msg = errMessage(e);
  const data = (e as { response?: { data?: { error?: string } } })?.response?.data;
  return data?.error === "invalid_grant" || /invalid_grant/.test(msg);
}

/** An OAuth client loaded with the stored (decrypted) tokens; refreshed tokens are persisted. */
export async function authedClient(): Promise<Result<{ client: OAuth2Client; email: string | null }>> {
  const client = newOAuthClient();
  if (!client || !encryptionAvailable()) return notConfigured("Google");
  const t = await loadTokens("google");
  if (!t) return fail("not_configured", "Google isn't connected yet.");
  client.setCredentials({
    refresh_token: t.refreshToken,
    access_token: t.accessToken ?? undefined,
    expiry_date: t.expiresAt?.getTime(),
  });
  client.on("tokens", (tokens) => {
    void saveTokens("google", {
      refreshToken: tokens.refresh_token ?? null,
      accessToken: tokens.access_token ?? null,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    });
  });
  return ok({ client, email: t.email });
}

/** Run a Google API call; maps invalid_grant to a "needs reconnect" state. */
export async function withGoogle<T>(fn: (client: OAuth2Client, email: string | null) => Promise<T>): Promise<Result<T>> {
  const a = await authedClient();
  if (!a.ok) return a;
  try {
    return ok(await fn(a.data.client, a.data.email));
  } catch (e) {
    if (isInvalidGrant(e)) {
      await markNeedsReconnect("google");
      return fail("upstream_error", "Google needs to be reconnected.");
    }
    const status = (e as { code?: number; status?: number })?.code ?? (e as { status?: number })?.status;
    if (status === 429 || status === 403) return fail("rate_limited", "Google is limiting requests right now.", 5000);
    return fail("upstream_error", errMessage(e).slice(0, 200));
  }
}
