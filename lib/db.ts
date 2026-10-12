import { neon, types as pgTypes } from "@neondatabase/serverless";
import { readEnv } from "./env";

/** Minimal query interface: Neon's HTTP driver in production, PGlite in tests. */
export type Db = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

// Keep dates as 'YYYY-MM-DD', timestamps as ISO strings and numerics/bigints as numbers,
// so rows look the same as the JSON the UI consumes.
const OID = { int8: 20, numeric: 1700, date: 1082, time: 1083, timestamp: 1114, timestamptz: 1184 };
const parsers: Record<number, (v: string) => unknown> = {
  [OID.int8]: (v) => Number(v),
  [OID.numeric]: (v) => Number(v),
  [OID.date]: (v) => v,
  [OID.time]: (v) => v,
  [OID.timestamp]: (v) => new Date(v.replace(" ", "T") + "Z").toISOString(),
  [OID.timestamptz]: (v) => {
    const d = pgTypes.getTypeParser(OID.timestamptz)(v) as Date;
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : v;
  },
};
const customTypes = {
  getTypeParser: ((oid: number, format?: "text" | "binary") =>
    parsers[oid] ?? pgTypes.getTypeParser(oid, format)) as typeof pgTypes.getTypeParser,
};

let cached: { url: string; db: Db } | null = null;
let override: Db | null = null;

/** Tests inject an in-process Postgres (PGlite) here. */
export function setDbForTests(db: Db | null): void {
  override = db;
}

export function dbConfigured(): boolean {
  return Boolean(override) || Boolean(readEnv().DATABASE_URL);
}

/** Server-only Postgres access. Returns null when DATABASE_URL isn't configured. */
export function getDb(): Db | null {
  if (override) return override;
  const url = readEnv().DATABASE_URL;
  if (!url) return null;
  if (cached?.url === url) return cached.db;
  const sql = neon(url);
  // This driver reads `types` from the per-query options, not from neon(url, …).
  const db: Db = {
    query: async <T>(text: string, params: unknown[] = []) =>
      (await sql.query(text, params, { types: customTypes })) as T[],
  };
  cached = { url, db };
  return db;
}

/** First row or null. */
export async function one<T = Record<string, unknown>>(
  db: Db,
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await db.query<T>(text, params);
  return rows[0] ?? null;
}

/** JSON-encode a value for a `$n::jsonb` parameter. */
export const json = (v: unknown): string => JSON.stringify(v ?? null);

const IDENT = /^[a-z_][a-z0-9_]*$/;

/**
 * `update <table> set <patch> where id = $id`. Column names come from code, never from users,
 * and are still checked. jsonb values must be passed through `json()` by the caller.
 */
export async function updateById(
  db: Db,
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const cols = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (cols.length === 0) return;
  if (!IDENT.test(table) || !cols.every((c) => IDENT.test(c))) throw new Error("bad identifier");
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
  await db.query(`update ${table} set ${sets} where id = $1`, [id, ...cols.map((c) => patch[c])]);
}

/** `insert into <table> (<cols>) values (...) returning *`. Same identifier rules as updateById. */
export async function insertRow<T = Record<string, unknown>>(
  db: Db,
  table: string,
  row: Record<string, unknown>,
  onConflict = "",
): Promise<T | null> {
  const cols = Object.keys(row).filter((k) => row[k] !== undefined);
  if (!IDENT.test(table) || !cols.every((c) => IDENT.test(c))) throw new Error("bad identifier");
  const vals = cols.map((_c, i) => `$${i + 1}`).join(", ");
  return one<T>(
    db,
    `insert into ${table} (${cols.join(", ")}) values (${vals}) ${onConflict} returning *`,
    cols.map((c) => row[c]),
  );
}

/** Same as updateById but returns the updated row. */
export async function updateReturning<T = Record<string, unknown>>(
  db: Db,
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<T | null> {
  const cols = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!IDENT.test(table) || !cols.every((c) => IDENT.test(c))) throw new Error("bad identifier");
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
  return one<T>(db, `update ${table} set ${sets} where id = $1 returning *`, [
    id,
    ...cols.map((c) => patch[c]),
  ]);
}

/** Quick connectivity probe for /api/health. */
export async function dbHealthy(): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    await db.query("select key from settings limit 1");
    return true;
  } catch {
    return false;
  }
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const db = getDb();
  if (!db) return null;
  const row = await one<{ value: T }>(db, "select value from settings where key = $1", [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.query(
    `insert into settings(key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, json(value)],
  );
}
