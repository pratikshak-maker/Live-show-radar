import { NextResponse } from "next/server";
import { dbHealthy } from "@/lib/db";
import { getConfiguredMap } from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const map = getConfiguredMap();
  const db = await dbHealthy();
  const summary = Object.fromEntries(Object.values(map).map((s) => [s.key, s.configured]));
  return NextResponse.json({ ok: true, db, integrations: summary, version: "1.0.0" });
}
