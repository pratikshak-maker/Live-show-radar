import { getOAuthState } from "../integrations/registry";
import { sendViaGmail } from "../integrations/gmail";
import { sendViaSmtp, smtpConfigured } from "../integrations/smtp";
import { fail, type Result } from "../result";
import { getAppSettings } from "../settings";
import type { EmailContent } from "./templates";

export type SendOutcome = { channel: "gmail" | "smtp"; to: string };

/** Resolve the recipient: setting → ALERT_EMAIL_TO (inside settings) → connected Google account. */
export async function resolveRecipient(): Promise<string | null> {
  const s = await getAppSettings();
  if (s.alertEmail) return s.alertEmail;
  const g = await getOAuthState("google");
  return g.email;
}

/** Gmail API first; SMTP fallback; otherwise a clean `not_configured` failure. */
export async function sendAlertEmail(content: EmailContent): Promise<Result<SendOutcome>> {
  const to = await resolveRecipient();
  if (!to) return fail("not_configured", "No alert email address is set yet.");
  const msg = { to, subject: content.subject, html: content.html, text: content.text };

  const g = await getOAuthState("google");
  if (g.connected) {
    const r = await sendViaGmail(msg);
    if (r.ok) return { ok: true, data: { channel: "gmail", to } };
    if (!smtpConfigured()) return r;
  }
  if (smtpConfigured()) {
    const r = await sendViaSmtp(msg);
    return r.ok ? { ok: true, data: { channel: "smtp", to } } : r;
  }
  return fail("not_configured", "Connect Google to get email alerts.");
}
