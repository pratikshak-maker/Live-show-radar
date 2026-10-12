/* npm run check:integrations — one cheap real call per configured integration. */
import { existsSync } from "node:fs";
import { getDb, dbConfigured } from "../lib/db";
import { readEnv } from "../lib/env";
import { artistImage } from "../lib/integrations/deezer";
import { ping as geminiPing } from "../lib/integrations/gemini";
import { topArtists } from "../lib/integrations/lastfm";
import { searchArtists } from "../lib/integrations/musicbrainz";
import { geocodeVenue } from "../lib/integrations/nominatim";
import { smtpConfigured } from "../lib/integrations/smtp";
import { searchEvents } from "../lib/integrations/ticketmaster";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) {
    process.loadEnvFile(f);
    break;
  }
}

type Row = { name: string; status: string; ms: number | null; note: string };
const rows: Row[] = [];

async function check(
  name: string,
  configured: boolean,
  fn: () => Promise<{ ok: boolean; note: string }>,
) {
  if (!configured) {
    rows.push({ name, status: "skipped (not configured)", ms: null, note: "" });
    return;
  }
  const t = Date.now();
  try {
    const r = await fn();
    rows.push({ name, status: r.ok ? "✅" : "❌", ms: Date.now() - t, note: r.note });
  } catch (e) {
    rows.push({
      name,
      status: "❌",
      ms: Date.now() - t,
      note: e instanceof Error ? e.message.slice(0, 80) : String(e),
    });
  }
}

const e = readEnv();

await check("Database (Supabase)", dbConfigured(), async () => {
  const { error } = await getDb()!.from("settings").select("key").limit(1);
  return { ok: !error, note: error?.message ?? "settings table reachable" };
});
await check("Gemini", Boolean(e.GEMINI_API_KEY), async () => {
  const r = await geminiPing();
  return { ok: r.ok, note: r.ok ? `model ${e.GEMINI_MODEL}` : r.message };
});
await check("ScrapingBee (1 credit)", Boolean(e.SCRAPINGBEE_API_KEY), async () => {
  const res = await fetch(
    "https://app.scrapingbee.com/api/v1/?url=https%3A%2F%2Fexample.com&render_js=false",
    {
      headers: { Authorization: `Bearer ${e.SCRAPINGBEE_API_KEY}` },
    },
  );
  return { ok: res.ok, note: `HTTP ${res.status}` };
});
await check("Ticketmaster", Boolean(e.TICKETMASTER_API_KEY), async () => {
  const r = await searchEvents("Coldplay");
  return {
    ok: r.ok,
    note: r.ok ? `${r.data.length} events (empty is normal for India)` : r.message,
  };
});
await check("Last.fm", Boolean(e.LASTFM_API_KEY), async () => {
  const r = await topArtists("rj");
  return {
    ok: r.ok || r.reason === "invalid_response",
    note: r.ok ? `${r.data.length} artists` : r.message,
  };
});
await check(
  "Spotify (credentials present)",
  Boolean(e.SPOTIFY_CLIENT_ID && e.SPOTIFY_CLIENT_SECRET),
  async () => ({
    ok: true,
    note: "needs a user sign-in to test further",
  }),
);
await check(
  "Google OAuth (credentials present)",
  Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET),
  async () => ({
    ok: Boolean(e.TOKEN_ENCRYPTION_KEY),
    note: e.TOKEN_ENCRYPTION_KEY
      ? "connect from Settings to finish"
      : "TOKEN_ENCRYPTION_KEY is missing",
  }),
);
await check("Gmail SMTP (credentials present)", smtpConfigured(), async () => ({
  ok: true,
  note: "app password set",
}));
await check("MusicBrainz", true, async () => {
  const r = await searchArtists("Prateek Kuhad", 1);
  return { ok: r.ok, note: r.ok ? (r.data[0]?.name ?? "no result") : r.message };
});
await check("Deezer", true, async () => {
  const r = await artistImage("Prateek Kuhad");
  return { ok: r.ok, note: r.ok ? (r.data ? "image found" : "no confident match") : r.message };
});
await check("Nominatim (OpenStreetMap)", true, async () => {
  const r = await geocodeVenue("Phoenix Marketcity", "Bengaluru");
  return {
    ok: r.ok,
    note: r.ok
      ? r.data
        ? `${r.data.lat.toFixed(3)}, ${r.data.lng.toFixed(3)}`
        : "no result"
      : r.message,
  };
});

const w = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) {
  console.log(
    `${r.name.padEnd(w)}  ${r.status.padEnd(26)} ${r.ms === null ? "      " : `${String(r.ms).padStart(5)}ms`}  ${r.note}`,
  );
}
process.exit(rows.some((r) => r.status === "❌") ? 1 : 0);
