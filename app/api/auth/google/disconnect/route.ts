import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { apiError } from "@/lib/api";
import { deleteTokens } from "@/lib/oauth-store";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await isAdmin())) return apiError("admin_required", "Enter the admin passcode first.", 401);
  await deleteTokens("google");
  return NextResponse.json({ ok: true });
}
