import { google } from "googleapis";
import { ok, type Result } from "../result";
import { withGoogle } from "./google-oauth";

export type MailMessage = { from: string; to: string; subject: string; html: string; text: string };

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const wrap76 = (s: string) => s.replace(/(.{76})/g, "$1\r\n");

/** RFC 2822 multipart/alternative message with a UTF-8 encoded subject. */
export function buildMime(m: MailMessage, boundary = `lsr_${Date.now().toString(36)}`): string {
  const safe = (v: string) => v.replace(/[\r\n]+/g, " ");
  return [
    `From: ${safe(m.from)}`,
    `To: ${safe(m.to)}`,
    `Subject: =?UTF-8?B?${b64(safe(m.subject))}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(m.text)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(m.html)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64url");
}

/** Sends through the Gmail API as the connected account (gmail.send scope). */
export async function sendViaGmail(
  m: Omit<MailMessage, "from">,
): Promise<Result<{ from: string }>> {
  const r = await withGoogle(async (auth, email) => {
    const from = email ?? "me";
    const gmail = google.gmail({ version: "v1", auth });
    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: toBase64Url(buildMime({ ...m, from })) },
    });
    return { from };
  });
  return r.ok ? ok(r.data) : r;
}
