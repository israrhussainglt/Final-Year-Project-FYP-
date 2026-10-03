// Finds confirmed appointments ~24h out and reminds the patient by email
// and/or SMS, once each. Exported as a plain function (not a script) so it
// can be run from the standalone scheduler (scripts/reminder-scheduler.ts,
// for a real deployment) or called directly/tested without spinning up cron.
import { listAppointmentsNeedingReminder, markReminderSent } from "./repo";
import { sendEmail, EMAIL_CONFIGURED } from "./email";
import { sendReminderSms, SMS_CONFIGURED } from "./sms";

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export interface ReminderSweepResult {
  checked: number;
  emailed: number;
  texted: number;
  skipped: number; // no email and no phone reachable (shouldn't happen — phone is required — but defensive)
}

export async function runReminderSweep(): Promise<ReminderSweepResult> {
  const due = listAppointmentsNeedingReminder();
  const result: ReminderSweepResult = { checked: due.length, emailed: 0, texted: 0, skipped: 0 };

  for (const appt of due) {
    const when = formatWhen(appt.scheduled_at as string);
    const doctorName = (appt as any).doctor_name || "your doctor";
    const hospitalName = (appt as any).hospital_name;
    const email = (appt as any).email as string | null;
    const phone = (appt as any).phone_number as string;

    let sent = false;

    if (email && EMAIL_CONFIGURED) {
      const res = await sendEmail({
        to: email,
        subject: "Appointment reminder — tomorrow",
        text: `Reminder: you have an appointment with ${doctorName}${hospitalName ? ` at ${hospitalName}` : ""} on ${when}. Reply to your clinic if you need to reschedule or cancel.`,
      });
      if (res.ok) {
        sent = true;
        result.emailed++;
      } else {
        console.error(`[pulseid-backend] Reminder email failed for appointment ${appt.id}: ${res.error}`);
      }
    }

    if (phone && SMS_CONFIGURED) {
      const res = await sendReminderSms(phone, `Reminder: appointment with ${doctorName} on ${when}. — PulseID`);
      if (res.ok) {
        sent = true;
        result.texted++;
      } else {
        console.error(`[pulseid-backend] Reminder SMS failed for appointment ${appt.id}: ${res.error}`);
      }
    }

    if (!sent && !EMAIL_CONFIGURED && !SMS_CONFIGURED) {
      // Neither gateway configured — dev/demo environment. Log instead of
      // silently doing nothing, so the reminder flow is still visible while
      // developing without real SMTP/Twilio credentials.
      console.log(`[pulseid-backend] [demo] Would remind ${(appt as any).patient_name} about appointment with ${doctorName} on ${when}`);
      sent = true;
    }

    if (sent) {
      markReminderSent(appt.id);
    } else {
      result.skipped++;
    }
  }

  return result;
}
