import { Suspense } from "react";
import { notFound } from "next/navigation";
import { RadarView } from "@/components/RadarView";
import { cardFixtures } from "@/lib/fixtures";

export const dynamic = "force-dynamic";

/** Dev-only: the full Radar UI against fixture data (no database needed). */
export default function DevRadarPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const shows = cardFixtures().map((c) => ({ ...c.show, is_sample: false }));
  return (
    <Suspense>
      <RadarView initialShows={shows} homeCity="Bengaluru" hasSamples={false} />
    </Suspense>
  );
}
