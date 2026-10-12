import { dbConfigured, getDb } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { getUsageToday } from "@/lib/lock";
import { SetupScreen } from "@/components/SetupScreen";
import { ActivityView, type RunSummary } from "@/components/ActivityView";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  if (!dbConfigured()) return <SetupScreen />;
  const db = getDb();
  const [{ data }, gemini, sb] = await Promise.all([
    db!.from("scan_runs").select("id, trigger, status, artist_ids, stats, error, started_at, finished_at").order("started_at", { ascending: false }).limit(20),
    getUsageToday("gemini"),
    getUsageToday("scrapingbee"),
  ]);
  return (
    <ActivityView
      runs={(data ?? []) as RunSummary[]}
      usage={{ gemini, scrapingbee: sb, scrapingbeeBudget: readEnv().SCRAPINGBEE_DAILY_CREDIT_BUDGET }}
    />
  );
}
