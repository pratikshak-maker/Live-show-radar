import { getDb, one } from "./db";

export async function acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    const row = await one<{ ok: boolean }>(db, "select acquire_lock($1, $2) as ok", [
      key,
      ttlSeconds,
    ]);
    return row?.ok === true;
  } catch {
    return false;
  }
}

export async function releaseLock(key: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.query("select release_lock($1)", [key]).catch(() => undefined);
}

export async function addUsage(provider: string, units: number): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  try {
    const row = await one<{ units: number }>(db, "select add_usage($1, $2) as units", [
      provider,
      units,
    ]);
    return Number(row?.units ?? 0);
  } catch {
    return 0;
  }
}

export async function getUsageToday(provider: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  try {
    const row = await one<{ units: number }>(
      db,
      "select units from api_usage where day = (now() at time zone 'Asia/Kolkata')::date and provider = $1",
      [provider],
    );
    return Number(row?.units ?? 0);
  } catch {
    return 0;
  }
}
