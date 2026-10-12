import nodemailer from "nodemailer";
import { readEnv } from "../env";
import { errMessage, fail, notConfigured, ok, type Result } from "../result";
import type { MailMessage } from "./gmail";

export function smtpConfigured(): boolean {
  const e = readEnv();
  return Boolean(e.GMAIL_SMTP_USER && e.GMAIL_SMTP_APP_PASSWORD);
}

export async function sendViaSmtp(m: Omit<MailMessage, "from">): Promise<Result<{ from: string }>> {
  const e = readEnv();
  if (!e.GMAIL_SMTP_USER || !e.GMAIL_SMTP_APP_PASSWORD) return notConfigured("Gmail SMTP");
  try {
    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: { user: e.GMAIL_SMTP_USER, pass: e.GMAIL_SMTP_APP_PASSWORD },
    });
    await transport.sendMail({ from: e.GMAIL_SMTP_USER, to: m.to, subject: m.subject, text: m.text, html: m.html });
    return ok({ from: e.GMAIL_SMTP_USER });
  } catch (err) {
    return fail("upstream_error", errMessage(err).slice(0, 200));
  }
}
