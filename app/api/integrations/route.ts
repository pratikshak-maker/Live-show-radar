import { NextResponse } from "next/server";
import { getIntegrationStatus, getOAuthState } from "@/lib/integrations/registry";
import { maskEmail } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getIntegrationStatus();
  const google = await getOAuthState("google");
  return NextResponse.json({
    integrations: Object.values(status),
    googleEmail: google.email ? maskEmail(google.email) : null,
  });
}
