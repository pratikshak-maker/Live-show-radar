import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readEnv } from "./env";

function key(raw = readEnv().TOKEN_ENCRYPTION_KEY): Buffer | null {
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

export function encryptionAvailable(raw?: string): boolean {
  return key(raw) !== null;
}

/** AES-256-GCM. Output: base64(iv[12] | tag[16] | ciphertext). */
export function encrypt(plain: string, rawKey?: string): string {
  const k = key(rawKey);
  if (!k) throw new Error("TOKEN_ENCRYPTION_KEY must be a 32-byte base64 string");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

export function decrypt(payload: string, rawKey?: string): string {
  const k = key(rawKey);
  if (!k) throw new Error("TOKEN_ENCRYPTION_KEY must be a 32-byte base64 string");
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", k, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

/** HMAC-signed value for the admin cookie: `value.signature`. */
export function sign(value: string, secret?: string): string | null {
  const s = secret ?? readEnv().TOKEN_ENCRYPTION_KEY ?? readEnv().ADMIN_PASSCODE;
  if (!s) return null;
  const mac = createHmac("sha256", s).update(value).digest("base64url");
  return `${value}.${mac}`;
}

export function verifySigned(signed: string, secret?: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const expected = sign(value, secret);
  if (!expected) return null;
  const a = Buffer.from(expected);
  const b = Buffer.from(signed);
  return a.length === b.length && timingSafeEqual(a, b) ? value : null;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 2)}***@${domain}`;
}
