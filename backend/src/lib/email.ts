// Minimal SMTP email sender via nodemailer, used for appointment reminders
// (and anywhere else a "send an email" need shows up). Mirrors sms.ts: if
// the SMTP env vars aren't set, EMAIL_CONFIGURED is false and callers fall
// back to their own demo/dev behavior instead of failing hard.
import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || "PulseID <no-reply@pulseid.dev>";

export const EMAIL_CONFIGURED = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!EMAIL_CONFIGURED) {
    return { ok: false, error: "Email is not configured (SMTP_* env vars missing)." };
  }
  try {
    await getTransporter().sendMail({ from: SMTP_FROM, to: input.to, subject: input.subject, text: input.text });
    return { ok: true };
  } catch (err) {
    console.error("[pulseid-backend] SMTP send threw:", err);
    return { ok: false, error: "Failed to send email." };
  }
}
