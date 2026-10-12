import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the real migration on an in-process Postgres (WASM) to prove the SQL functions behave.
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  // pgcrypto isn't bundled with PGlite; gen_random_uuid() is built in on PG13+.
  const sql = readFileSync(
    new URL("../db/migrations/0001_init.sql", import.meta.url),
    "utf8",
  ).replace('create extension if not exists "pgcrypto";', "");
  await db.exec(sql);
}, 60_000);

afterAll(async () => {
  await db.close();
});

const one = async <T>(q: string, params: unknown[] = []) => (await db.query<T>(q, params)).rows[0];

describe("acquire_lock", () => {
  it("first call wins, second within TTL loses, expired lock can be taken", async () => {
    expect(
      (await one<{ acquire_lock: boolean }>("select acquire_lock('scan', 120)")).acquire_lock,
    ).toBe(true);
    expect(
      (await one<{ acquire_lock: boolean }>("select acquire_lock('scan', 120)")).acquire_lock,
    ).toBe(false);
    await db.exec("update locks set expires_at = now() - interval '1 second' where key = 'scan'");
    expect(
      (await one<{ acquire_lock: boolean }>("select acquire_lock('scan', 120)")).acquire_lock,
    ).toBe(true);
    await db.exec("select release_lock('scan')");
    expect(
      (await one<{ acquire_lock: boolean }>("select acquire_lock('scan', 120)")).acquire_lock,
    ).toBe(true);
  });
});

describe("add_usage", () => {
  it("increments atomically per IST day + provider", async () => {
    expect((await one<{ add_usage: number }>("select add_usage('scrapingbee', 5)")).add_usage).toBe(
      5,
    );
    expect(
      (await one<{ add_usage: number }>("select add_usage('scrapingbee', 15)")).add_usage,
    ).toBe(20);
    expect((await one<{ add_usage: number }>("select add_usage('gemini', 1)")).add_usage).toBe(1);
  });
});

describe("hit_rate_limit", () => {
  it("counts within the window and resets after it", async () => {
    const hit = () =>
      one<{ out_count: number }>("select * from hit_rate_limit('scan_manual:global', 180)");
    expect((await hit()).out_count).toBe(1);
    expect((await hit()).out_count).toBe(2);
    await db.exec(
      "update rate_limits set window_start = now() - interval '4 minutes' where key = 'scan_manual:global'",
    );
    expect((await hit()).out_count).toBe(1);
  });
});

describe("schema constraints", () => {
  it("alerts are idempotent per (show, type, channel)", async () => {
    const a = await one<{ id: string }>(
      "insert into artists(name, name_normalized, source) values ('A','a','seed') returning id",
    );
    const s = await one<{ id: string }>(
      "insert into shows(artist_id, dedupe_key, city, city_slug, start_date) values ($1,'a|bengaluru|2027-01-01','Bengaluru','bengaluru','2027-01-01') returning id",
      [a.id],
    );
    await db.query(
      "insert into alerts(show_id, channel, alert_type) values ($1,'in_app','new_show')",
      [s.id],
    );
    await db.query(
      "insert into alerts(show_id, channel, alert_type) values ($1,'in_app','new_show') on conflict do nothing",
      [s.id],
    );
    expect((await one<{ n: string }>("select count(*)::text n from alerts")).n).toBe("1");
    await expect(
      db.query("insert into alerts(show_id, channel, alert_type) values ($1,'in_app','new_show')", [
        s.id,
      ]),
    ).rejects.toThrow();
  });
  it("calendar events are unique per (show, kind)", async () => {
    const s = await one<{ id: string }>("select id from shows limit 1");
    await db.query("insert into calendar_events(show_id, kind) values ($1,'concert')", [s.id]);
    await expect(
      db.query("insert into calendar_events(show_id, kind) values ($1,'concert')", [s.id]),
    ).rejects.toThrow();
  });
  it("rejects bad enum values and enables RLS everywhere", async () => {
    await expect(
      db.query("insert into artists(name, name_normalized, source) values ('B','b','nope')"),
    ).rejects.toThrow();
    const r = await db.query<{ relname: string }>(
      "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity",
    );
    expect(r.rows).toEqual([]);
  });
  it("seed.sql loads cleanly and is re-runnable", async () => {
    const seed = readFileSync(new URL("../db/seed.sql", import.meta.url), "utf8");
    await db.exec(seed);
    await db.exec(seed);
    expect(
      Number(
        (
          await one<{ n: string }>(
            "select count(*)::text n from artists where source='seed' and name <> 'A'",
          )
        ).n,
      ),
    ).toBe(40);
  });
});
