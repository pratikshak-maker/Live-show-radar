import { dbConfigured } from "@/lib/db";
import { SetupScreen } from "@/components/SetupScreen";

export const dynamic = "force-dynamic";

export default function RadarPage() {
  if (!dbConfigured()) return <SetupScreen />;
  return <p>Radar</p>;
}
