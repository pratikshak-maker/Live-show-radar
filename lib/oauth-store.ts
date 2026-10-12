import { decrypt, encrypt, encryptionAvailable } from "./crypto";
import { getDb, one, setSetting } from "./db";

export type StoredTokens = {
  email: string | null;
  scopes: string[];
  refreshToken: string;
  accessToken: string | null;
  expiresAt: Date | null;
};

type TokenRow = {
  account_email: string | null;
  scopes: string[] | null;
  refresh_token_enc: string;
  access_token_enc: string | null;
  expires_at: string | null;
};

export async function saveTokens(
  provider: "google" | "spotify",
  t: {
    email?: string | null;
    scopes?: string[];
    refreshToken?: string | null;
    accessToken?: string | null;
    expiresAt?: Date | null;
  },
): Promise<boolean> {
  const db = getDb();
  if (!db || !encryptionAvailable()) return false;
  try {
    const prev = await one<TokenRow>(db, "select * from oauth_tokens where provider = $1", [
      provider,
    ]);
    const refreshEnc = t.refreshToken ? encrypt(t.refreshToken) : prev?.refresh_token_enc;
    if (!refreshEnc) return false;
    await db.query(
      `insert into oauth_tokens(provider, account_email, scopes, refresh_token_enc, access_token_enc, expires_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (provider) do update set
         account_email = excluded.account_email, scopes = excluded.scopes,
         refresh_token_enc = excluded.refresh_token_enc, access_token_enc = excluded.access_token_enc,
         expires_at = excluded.expires_at, updated_at = now()`,
      [
        provider,
        t.email ?? prev?.account_email ?? null,
        t.scopes ?? prev?.scopes ?? [],
        refreshEnc,
        t.accessToken ? encrypt(t.accessToken) : null,
        t.expiresAt ? t.expiresAt.toISOString() : null,
      ],
    );
    await setSetting(`${provider}_needs_reconnect`, false);
    return true;
  } catch {
    return false;
  }
}

export async function loadTokens(provider: "google" | "spotify"): Promise<StoredTokens | null> {
  const db = getDb();
  if (!db || !encryptionAvailable()) return null;
  try {
    const row = await one<TokenRow>(db, "select * from oauth_tokens where provider = $1", [
      provider,
    ]);
    if (!row) return null;
    return {
      email: row.account_email ?? null,
      scopes: row.scopes ?? [],
      refreshToken: decrypt(row.refresh_token_enc),
      accessToken: row.access_token_enc ? decrypt(row.access_token_enc) : null,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    };
  } catch {
    return null;
  }
}

export async function deleteTokens(provider: "google" | "spotify"): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.query("delete from oauth_tokens where provider = $1", [provider]);
  await db.query("delete from settings where key = $1", [`${provider}_needs_reconnect`]);
}

export async function markNeedsReconnect(provider: "google" | "spotify"): Promise<void> {
  await setSetting(`${provider}_needs_reconnect`, true);
}
