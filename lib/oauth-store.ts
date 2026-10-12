import { decrypt, encrypt, encryptionAvailable } from "./crypto";
import { getDb } from "./db";

export type StoredTokens = {
  email: string | null;
  scopes: string[];
  refreshToken: string;
  accessToken: string | null;
  expiresAt: Date | null;
};

export async function saveTokens(
  provider: "google" | "spotify",
  t: { email?: string | null; scopes?: string[]; refreshToken?: string | null; accessToken?: string | null; expiresAt?: Date | null },
): Promise<boolean> {
  const db = getDb();
  if (!db || !encryptionAvailable()) return false;
  const { data: prev } = await db.from("oauth_tokens").select("refresh_token_enc, account_email, scopes").eq("provider", provider).maybeSingle();
  const refreshEnc = t.refreshToken ? encrypt(t.refreshToken) : (prev?.refresh_token_enc as string | undefined);
  if (!refreshEnc) return false;
  const { error } = await db.from("oauth_tokens").upsert(
    {
      provider,
      account_email: t.email ?? (prev?.account_email as string | null | undefined) ?? null,
      scopes: t.scopes ?? (prev?.scopes as string[] | undefined) ?? [],
      refresh_token_enc: refreshEnc,
      access_token_enc: t.accessToken ? encrypt(t.accessToken) : null,
      expires_at: t.expiresAt ? t.expiresAt.toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" },
  );
  if (!error) await db.from("settings").upsert({ key: `${provider}_needs_reconnect`, value: false }, { onConflict: "key" });
  return !error;
}

export async function loadTokens(provider: "google" | "spotify"): Promise<StoredTokens | null> {
  const db = getDb();
  if (!db || !encryptionAvailable()) return null;
  const { data } = await db.from("oauth_tokens").select("*").eq("provider", provider).maybeSingle();
  if (!data) return null;
  try {
    return {
      email: (data.account_email as string | null) ?? null,
      scopes: (data.scopes as string[] | null) ?? [],
      refreshToken: decrypt(data.refresh_token_enc as string),
      accessToken: data.access_token_enc ? decrypt(data.access_token_enc as string) : null,
      expiresAt: data.expires_at ? new Date(data.expires_at as string) : null,
    };
  } catch {
    return null;
  }
}

export async function deleteTokens(provider: "google" | "spotify"): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.from("oauth_tokens").delete().eq("provider", provider);
  await db.from("settings").delete().eq("key", `${provider}_needs_reconnect`);
}

export async function markNeedsReconnect(provider: "google" | "spotify"): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.from("settings").upsert({ key: `${provider}_needs_reconnect`, value: true }, { onConflict: "key" });
}
