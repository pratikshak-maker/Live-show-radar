import { Suspense } from "react";
import { dbConfigured } from "@/lib/db";
import { getHomeCity } from "@/lib/settings";
import { listShows } from "@/lib/queries";
import { ensureSampleShows } from "@/lib/sample-mode";
import { RadarView } from "@/components/RadarView";
import { SetupScreen } from "@/components/SetupScreen";

export const dynamic = "force-dynamic";

export default async function RadarPage() {
  if (!dbConfigured()) return <SetupScreen />;
  const hasSamples = await ensureSampleShows();
  const shows = await listShows({ includeHidden: true });
  return (
    <Suspense>
      <RadarView initialShows={shows} homeCity={await getHomeCity()} hasSamples={hasSamples} />
    </Suspense>
  );
}
