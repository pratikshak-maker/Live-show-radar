import { dbConfigured, getDb } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { getUsageToday } from "@/lib/lock";
import { SetupScreen } from "@/components/SetupScreen";
import { ActivityView, type RunSummary } from "@/components/ActivityView";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  if (!dbConfigured()) return <SetupScreen />;
  const db = getDb();
  const [runs, gemini, sb] = await Promise.all([
    db!
      .query<RunSummary>(
        "select id, trigger, status, artist_ids, stats, error, started_at, finished_at from scan_runs order by started_at desc limit 20",
      )
      .catch(() => [] as RunSummary[]),
    getUsageToday("gemini"),
    getUsageToday("scrapingbee"),
  ]);
  return (
    <ActivityView
      runs={runs}
      usage={{
        gemini,
        scrapingbee: sb,
        scrapingbeeBudget: readEnv().SCRAPINGBEE_DAILY_CREDIT_BUDGET,
      }}
    />
  );
}
