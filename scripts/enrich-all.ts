/* npm run enrich — fetch photos (Deezer) and MusicBrainz ids for every active artist. */
import { existsSync } from "node:fs";
import { getDb } from "../lib/db";
import { artistImage } from "../lib/integrations/deezer";
import { enrichArtist } from "../lib/artists";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) {
    process.loadEnvFile(f);
    break;
  }
}

const db = getDb();
if (!db) {
  console.log("DATABASE_URL not set.");
  process.exit(0);
}

const artists = await db.query<{ id: string; name: string; image_url: string | null }>(
  "select id, name, image_url from artists where is_active order by name",
);
let photos = 0;
for (const a of artists) {
  // Upgrade small (250px) Deezer images to the 500px version, and fill missing ones.
  const r = await artistImage(a.name);
  if (r.ok && r.data && r.data !== a.image_url) {
    await db.query("update artists set image_url = $2 where id = $1", [a.id, r.data]);
  }
  await enrichArtist(a.id); // MusicBrainz id + disambiguation (throttled to 1 req/s)
  const has = (r.ok && r.data) || a.image_url;
  if (has) photos++;
  console.log(`${has ? "✓" : "·"} ${a.name}`);
}
console.log(`\n${photos}/${artists.length} artists have a photo.`);
