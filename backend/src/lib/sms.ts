// Minimal Twilio SMS sender for OTP delivery — uses Twilio's plain REST API
// via the Node 18+ global `fetch`, so no SDK dependency is required. If the
// Twilio env vars aren't set, SMS_CONFIGURED is false and callers should
// fall back to whatever demo/dev behavior they already have.

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

export const SMS_CONFIGURED = Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);

export async function sendOtpSms(toPhone: string, code: string): Promise<{ ok: boolean; error?: string }> {
  if (!SMS_CONFIGURED) {
    return { ok: false, error: "SMS gateway is not configured (TWILIO_* env vars missing)." };
  }

  return sendSms(toPhone, `Your PulseID verification code is ${code}. It expires in 5 minutes. Never share this code with anyone.`);
}

// Generic (non-OTP) SMS send, e.g. appointment reminders — same Twilio
// call, just a caller-supplied body instead of the fixed OTP message.
export async function sendReminderSms(toPhone: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!SMS_CONFIGURED) {
    return { ok: false, error: "SMS gateway is not configured (TWILIO_* env vars missing)." };
  }
  return sendSms(toPhone, body);
}

async function sendSms(toPhone: string, body: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const params = new URLSearchParams({
      To: toPhone,
      From: TWILIO_FROM_NUMBER as string,
      Body: body,
    });

    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      console.error(`[pulseid-backend] Twilio send failed (${resp.status}):`, detail);
      return { ok: false, error: "Failed to send SMS." };
    }

    return { ok: true };
  } catch (err) {
    console.error("[pulseid-backend] Twilio send threw:", err);
    return { ok: false, error: "Failed to send SMS." };
  }
}
