/* Seeds the starter artist list. Usage: npm run seed (needs DATABASE_URL). */
import { existsSync } from "node:fs";
import { getDb } from "../lib/db";
import { SEED_ARTISTS } from "../lib/seed-data";
import { normalizeArtist } from "../lib/normalize";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) {
    process.loadEnvFile(f);
    break;
  }
}

const db = getDb();
if (!db) {
  console.log("DATABASE_URL not set — nothing to seed.");
} else {
  for (const a of SEED_ARTISTS) {
    await db.query(
      `insert into artists (name, name_normalized, origin, source, is_favorite)
       values ($1, $2, $3, 'seed', $4) on conflict (name_normalized) do nothing`,
      [a.name, normalizeArtist(a.name), a.origin, a.favorite ?? false],
    );
  }
  console.log(`Seeded ${SEED_ARTISTS.length} artists.`);
}
