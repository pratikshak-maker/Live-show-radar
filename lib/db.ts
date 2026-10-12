import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readEnv } from "./env";

let cached: { url: string; key: string; client: SupabaseClient } | null = null;

export function dbConfigured(): boolean {
  const e = readEnv();
  return Boolean(e.SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY);
}

/** Server-only Supabase client (service role). Returns null when the DB isn't configured. */
export function getDb(): SupabaseClient | null {
  const e = readEnv();
  if (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) return null;
  if (cached && cached.url === e.SUPABASE_URL && cached.key === e.SUPABASE_SERVICE_ROLE_KEY) {
    return cached.client;
  }
  const client = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cached = { url: e.SUPABASE_URL, key: e.SUPABASE_SERVICE_ROLE_KEY, client };
  return client;
}

/** Quick connectivity probe for /api/health. */
export async function dbHealthy(): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    const { error } = await db.from("settings").select("key").limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const db = getDb();
  if (!db) return null;
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T | undefined) ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .from("settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}
