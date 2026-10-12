import { z } from "zod";

// Empty strings (e.g. `KEY=` in .env, or an empty Vercel variable) count as "not set".
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optStr = () => z.preprocess(blank, z.string().optional());
const strDefault = (d: string) => z.preprocess(blank, z.string().default(d));
const intDefault = (d: number) =>
  z.preprocess(blank, z.coerce.number().int().positive().catch(d).default(d));

const EnvSchema = z.object({
  APP_URL: strDefault("http://localhost:3000"),
  HOME_CITY: strDefault("Bengaluru"),
  OWNER_NAME: strDefault("Karan"),
  ADMIN_PASSCODE: optStr(),
  TOKEN_ENCRYPTION_KEY: optStr(),
  CRON_SECRET: optStr(),
  DATABASE_URL: optStr(),
  GEMINI_API_KEY: optStr(),
  GEMINI_MODEL: strDefault("gemini-flash-latest"),
  // Used only when GEMINI_MODEL is overloaded (503).
  // Comma-separated; tried in order when GEMINI_MODEL is busy or a model's daily free quota is spent.
  GEMINI_FALLBACK_MODEL: strDefault(
    "gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3-flash-preview",
  ),
  GEMINI_MAX_CALLS_PER_RUN: intDefault(20),
  SCRAPINGBEE_API_KEY: optStr(),
  SCRAPINGBEE_DAILY_CREDIT_BUDGET: intDefault(150),
  GOOGLE_CLIENT_ID: optStr(),
  GOOGLE_CLIENT_SECRET: optStr(),
  GOOGLE_REDIRECT_URI: strDefault("http://localhost:3000/api/auth/google/callback"),
  ALERT_EMAIL_TO: optStr(),
  GMAIL_SMTP_USER: optStr(),
  GMAIL_SMTP_APP_PASSWORD: optStr(),
  TICKETMASTER_API_KEY: optStr(),
  SPOTIFY_CLIENT_ID: optStr(),
  SPOTIFY_CLIENT_SECRET: optStr(),
  SPOTIFY_REDIRECT_URI: strDefault("http://localhost:3000/api/auth/spotify/callback"),
  LASTFM_API_KEY: optStr(),
  CONTACT_EMAIL: optStr(),
  SCAN_BATCH_SIZE: intDefault(4),
  SCAN_TIME_BUDGET_MS: intDefault(45000),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parsed on every access so tests can mutate process.env. Never throws. */
export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  return parsed.success ? parsed.data : EnvSchema.parse({});
}

export const env: Env = new Proxy({} as Env, {
  get: (_t, prop: string) => readEnv()[prop as keyof Env],
  ownKeys: () => Object.keys(readEnv()),
  getOwnPropertyDescriptor: (_t, prop: string) => ({
    enumerable: true,
    configurable: true,
    value: readEnv()[prop as keyof Env],
  }),
});

/** Used in MusicBrainz / Nominatim User-Agent headers. */
export function userAgent(): string {
  const e = readEnv();
  return `LiveShowRadar/1.0 ( ${e.CONTACT_EMAIL ?? e.APP_URL} )`;
}
