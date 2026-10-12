import { dbConfigured } from "@/lib/db";
import { SetupScreen } from "@/components/SetupScreen";
import { listArtists } from "@/lib/queries";
import { getConfiguredMap } from "@/lib/integrations/registry";
import { ArtistsView } from "@/components/ArtistsView";

export const dynamic = "force-dynamic";

export default async function ArtistsPage() {
  if (!dbConfigured()) return <SetupScreen />;
  const [artists] = await Promise.all([listArtists()]);
  const map = getConfiguredMap();
  return (
    <ArtistsView
      initial={artists}
      lastfmEnabled={map.lastfm.configured}
      spotifyEnabled={map.spotify.configured}
    />
  );
}
