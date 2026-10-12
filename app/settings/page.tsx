import { Suspense } from "react";
import { dbConfigured } from "@/lib/db";
import { SetupScreen } from "@/components/SetupScreen";
import { SettingsView } from "@/components/SettingsView";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  if (!dbConfigured()) return <SetupScreen />;
  return (
    <Suspense>
      <SettingsView />
    </Suspense>
  );
}
