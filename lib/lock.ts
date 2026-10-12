import { getDb } from "./db";

export async function acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const { data, error } = await db.rpc("acquire_lock", { p_key: key, p_ttl_seconds: ttlSeconds });
  if (error) return false;
  return data === true;
}

export async function releaseLock(key: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.rpc("release_lock", { p_key: key });
}

export async function addUsage(provider: string, units: number): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const { data } = await db.rpc("add_usage", { p_provider: provider, p_units: units });
  return typeof data === "number" ? data : 0;
}

export async function getUsageToday(provider: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const { data } = await db
    .from("api_usage")
    .select("units")
    .eq("day", today)
    .eq("provider", provider)
    .maybeSingle();
  return (data?.units as number | undefined) ?? 0;
}
