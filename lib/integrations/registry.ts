import { readEnv } from "../env";
import { getDb, one } from "../db";
import { encryptionAvailable } from "../crypto";
import { SPOTIFY_COMING_SOON } from "../constants";

export type IntegrationKey =
  | "database"
  | "gemini"
  | "scrapingbee"
  | "googleOAuth"
  | "gmailSmtp"
  | "ticketmaster"
  | "spotify"
  | "lastfm"
  | "musicbrainz"
  | "deezer"
  | "nominatim";

export type IntegrationStatus = {
  key: IntegrationKey;
  label: string;
  configured: boolean;
  connected?: boolean;
  /** Google only: a refresh token exists but Google rejected it. */
  needsReconnect?: boolean;
  required: boolean;
  /** Shown as "Coming soon"; not offered and not counted as missing. */
  comingSoon?: boolean;
  purpose: string;
  setupDocAnchor: string;
};

export type OAuthState = { connected: boolean; needsReconnect: boolean; email: string | null };

/** Synchronous, env-only view (no DB lookups). Safe to call anywhere. */
export function getConfiguredMap(): Record<IntegrationKey, IntegrationStatus> {
  const e = readEnv();
  const mk = (
    key: IntegrationKey,
    label: string,
    configured: boolean,
    required: boolean,
    purpose: string,
    setupDocAnchor: string,
  ): IntegrationStatus => ({ key, label, configured, required, purpose, setupDocAnchor });

  const map: Record<IntegrationKey, IntegrationStatus> = {
    database: mk(
      "database",
      "Database (Neon)",
      Boolean(e.DATABASE_URL),
      true,
      "Stores your artists, shows and alerts.",
      "neon",
    ),
    gemini: mk(
      "gemini",
      "Gemini AI",
      Boolean(e.GEMINI_API_KEY),
      true,
      "Searches the web for announcements and turns pages into structured show details.",
      "gemini",
    ),
    scrapingbee: mk(
      "scrapingbee",
      "Live ticket pages",
      Boolean(e.SCRAPINGBEE_API_KEY),
      false,
      "Reads ticketing pages for early-bird tiers and deadlines (ScrapingBee).",
      "scrapingbee",
    ),
    googleOAuth: mk(
      "googleOAuth",
      "Gmail alerts & Calendar",
      Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && encryptionAvailable()),
      false,
      "Connect Google to get email alerts and add shows to your calendar.",
      "google-cloud",
    ),
    gmailSmtp: mk(
      "gmailSmtp",
      "Gmail SMTP fallback",
      Boolean(e.GMAIL_SMTP_USER && e.GMAIL_SMTP_APP_PASSWORD),
      false,
      "Sends alert emails with an app password if Google isn't connected.",
      "gmail-smtp-fallback",
    ),
    ticketmaster: mk(
      "ticketmaster",
      "Ticketmaster",
      Boolean(e.TICKETMASTER_API_KEY),
      false,
      "An extra source for official event listings.",
      "ticketmaster",
    ),
    spotify: mk(
      "spotify",
      "Spotify",
      Boolean(e.SPOTIFY_CLIENT_ID && e.SPOTIFY_CLIENT_SECRET),
      false,
      "Imports the artists you follow (only for accounts the app owner has added).",
      "spotify",
    ),
    lastfm: mk(
      "lastfm",
      "Last.fm",
      Boolean(e.LASTFM_API_KEY),
      false,
      "Imports your top artists from a Last.fm username.",
      "lastfm",
    ),
    musicbrainz: mk(
      "musicbrainz",
      "MusicBrainz",
      true,
      false,
      "Artist search and disambiguation. No key needed.",
      "no-key-sources",
    ),
    deezer: mk(
      "deezer",
      "Deezer images",
      true,
      false,
      "Artist photos. No key needed.",
      "no-key-sources",
    ),
    nominatim: mk(
      "nominatim",
      "OpenStreetMap",
      true,
      false,
      "Venue locations for the map. No key needed.",
      "no-key-sources",
    ),
  };
  map.spotify.comingSoon = SPOTIFY_COMING_SOON;
  map.spotify.purpose = "Import the artists you follow on Spotify in one tap.";
  return map;
}

export async function getOAuthState(provider: "google" | "spotify"): Promise<OAuthState> {
  const db = getDb();
  if (!db) return { connected: false, needsReconnect: false, email: null };
  try {
    const row = await one<{ account_email: string | null; needs: unknown }>(
      db,
      `select t.account_email, s.value as needs
         from oauth_tokens t
         left join settings s on s.key = $2
        where t.provider = $1`,
      [provider, `${provider}_needs_reconnect`],
    );
    if (!row) return { connected: false, needsReconnect: false, email: null };
    const needs = row.needs === true;
    return { connected: !needs, needsReconnect: needs, email: row.account_email ?? null };
  } catch {
    return { connected: false, needsReconnect: false, email: null };
  }
}

/** Full status incl. stored OAuth tokens. */
export async function getIntegrationStatus(): Promise<Record<IntegrationKey, IntegrationStatus>> {
  const map = getConfiguredMap();
  const [google, spotify] = await Promise.all([getOAuthState("google"), getOAuthState("spotify")]);
  map.googleOAuth.connected = google.connected;
  map.googleOAuth.needsReconnect = google.needsReconnect;
  map.spotify.connected = spotify.connected;
  return map;
}

export function missingConnectionsCount(map: Record<IntegrationKey, IntegrationStatus>): number {
  return Object.values(map).filter((s) => !s.configured && !s.comingSoon).length;
}
