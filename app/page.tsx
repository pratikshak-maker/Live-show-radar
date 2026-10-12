import { Suspense } from "react";
import { dbConfigured } from "@/lib/db";
import { getHomeCity } from "@/lib/settings";
import { listArtists, listShows } from "@/lib/queries";
import { ensureSampleShows } from "@/lib/sample-mode";
import { RadarView } from "@/components/RadarView";
import { SetupScreen } from "@/components/SetupScreen";

export const dynamic = "force-dynamic";

export default async function RadarPage() {
  if (!dbConfigured()) return <SetupScreen />;
  const hasSamples = await ensureSampleShows();
  const [shows, artists] = await Promise.all([listShows({ includeHidden: true }), listArtists()]);
  const heroArtists = artists.map((a) => ({
    id: a.id,
    name: a.name,
    image_url: a.image_url,
    is_favorite: a.is_favorite,
    show_count: a.show_count,
  }));
  return (
    <Suspense>
      <RadarView
        initialShows={shows}
        artists={heroArtists}
        homeCity={await getHomeCity()}
        hasSamples={hasSamples}
      />
    </Suspense>
  );
}
