import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { sign, verifySigned } from "./crypto";
import { readEnv } from "./env";

export const ADMIN_COOKIE = "lsr_admin";

export function adminRequired(): boolean {
  return Boolean(readEnv().ADMIN_PASSCODE);
}

function eq(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

export function passcodeMatches(input: string): boolean {
  const p = readEnv().ADMIN_PASSCODE;
  return Boolean(p) && eq(input, p as string);
}

export function adminCookieValue(): string | null {
  return sign("admin");
}

/** True when no passcode is configured, or the signed admin cookie is valid. */
export async function isAdmin(): Promise<boolean> {
  if (!adminRequired()) return true;
  const jar = await cookies();
  const raw = jar.get(ADMIN_COOKIE)?.value;
  return raw ? verifySigned(raw) === "admin" : false;
}
