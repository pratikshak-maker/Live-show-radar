import { NextResponse } from "next/server";
import { getAppStatus } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getAppStatus());
}
