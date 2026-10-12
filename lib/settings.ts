import { getDb } from "./db";
import { readEnv } from "./env";

export type AppSettings = {
  alertEmail: string | null;
  emailAlertsEnabled: boolean;
  minConfidenceForEmail: number;
  homeCity: string;
};

export async function getAppSettings(): Promise<AppSettings> {
  const env = readEnv();
  const defaults: AppSettings = {
    alertEmail: env.ALERT_EMAIL_TO ?? null,
    emailAlertsEnabled: true,
    minConfidenceForEmail: 0.5,
    homeCity: env.HOME_CITY,
  };
  const db = getDb();
  if (!db) return defaults;
  const { data } = await db
    .from("settings")
    .select("key, value")
    .in("key", ["alert_email", "email_alerts_enabled", "min_confidence_for_email", "home_city"]);
  const m = new Map((data ?? []).map((r) => [r.key as string, r.value as unknown]));
  const str = (k: string) =>
    typeof m.get(k) === "string" && (m.get(k) as string).trim()
      ? (m.get(k) as string).trim()
      : null;
  const minC = m.get("min_confidence_for_email");
  return {
    alertEmail: str("alert_email") ?? defaults.alertEmail,
    emailAlertsEnabled:
      typeof m.get("email_alerts_enabled") === "boolean"
        ? (m.get("email_alerts_enabled") as boolean)
        : true,
    minConfidenceForEmail: typeof minC === "number" && minC >= 0 && minC <= 1 ? minC : 0.5,
    homeCity: str("home_city") ?? defaults.homeCity,
  };
}

export async function getHomeCity(): Promise<string> {
  return (await getAppSettings()).homeCity;
}
