/* Seeds the starter artist list. Usage: npm run seed (needs SUPABASE_* env vars). */
import { createClient } from "@supabase/supabase-js";
import { SEED_ARTISTS } from "../lib/seed-data";
import { normalizeArtist } from "../lib/normalize";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — nothing to seed.");
    return;
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const rows = SEED_ARTISTS.map((a) => ({
    name: a.name,
    name_normalized: normalizeArtist(a.name),
    origin: a.origin,
    source: "seed",
    is_favorite: a.favorite ?? false,
  }));
  const { error } = await db.from("artists").upsert(rows, {
    onConflict: "name_normalized",
    ignoreDuplicates: true,
  });
  if (error) throw error;
  console.log(`Seeded ${rows.length} artists.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
