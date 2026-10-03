// Proactive follow-up sweep: finds every active follow-up agent whose
// next check-in is due, sends the patient a prompt (email/SMS, mirroring
// reminders.ts), and records a pending followup_checkins row for them to
// answer from the patient portal. Exported as a plain function so it can
// be run from the standalone scheduler (scripts/followup-scheduler.ts) or
// called directly/tested without spinning up cron — same pattern as
// runReminderSweep in lib/reminders.ts.
//
// Risk flagging on a submitted check-in is deterministic and rule-based
// (scaleAnswerFlag below) — it never depends solely on the AI summary, so
// alerting still works correctly with no AI provider configured at all.
// The AI summary (askClaude + FOLLOWUP_SYSTEM_PROMPT) is an optional
// doctor-facing convenience layered on top of that rule-based flag, not a
// replacement for it.
import {
  listFollowupAgentsDueForCheckin,
  createFollowupCheckin,
  advanceFollowupAgentSchedule,
} from "./repo";
import { sendEmail, EMAIL_CONFIGURED } from "./email";
import { sendReminderSms, SMS_CONFIGURED } from "./sms";
import { askClaude, AI_CONFIGURED, FOLLOWUP_SYSTEM_PROMPT } from "./ai";
import type { FollowupQuestion, FollowupRiskFlag } from "./types";

export interface FollowupSweepResult {
  due: number;
  sent: number;
  skipped: number;
}

export async function runFollowupSweep(): Promise<FollowupSweepResult> {
  const dueAgents = listFollowupAgentsDueForCheckin();
  const result: FollowupSweepResult = { due: dueAgents.length, sent: 0, skipped: 0 };

  for (const agent of dueAgents) {
    const email = (agent as any).email as string | null;
    const phone = (agent as any).phone_number as string;
    const patientName = (agent as any).patient_name as string;

    createFollowupCheckin(agent.id, agent.patient_id);

    let sent = false;
    const message = `Hi ${patientName}, your care team would like a quick check-in about your ${agent.pathology} follow-up. Please open PulseID (My Reports > Follow-ups) to answer a few short questions.`;

    if (email && EMAIL_CONFIGURED) {
      const res = await sendEmail({ to: email, subject: "PulseID — a quick follow-up check-in", text: message });
      if (res.ok) sent = true;
      else console.error(`[pulseid-backend] Follow-up email failed for agent ${agent.id}: ${res.error}`);
    }
    if (phone && SMS_CONFIGURED) {
      const res = await sendReminderSms(phone, message);
      if (res.ok) sent = true;
      else console.error(`[pulseid-backend] Follow-up SMS failed for agent ${agent.id}: ${res.error}`);
    }
    if (!sent && !EMAIL_CONFIGURED && !SMS_CONFIGURED) {
      console.log(`[pulseid-backend] [demo] Would send follow-up check-in to ${patientName} for agent ${agent.id}`);
      sent = true;
    }

    if (sent) result.sent++;
    else result.skipped++;

    advanceFollowupAgentSchedule(agent.id, agent.frequency_days);
  }

  return result;
}

// Deterministic rule-based flag from a set of answers against the
// question definitions that were sent. "scale" answers at or above
// concernAt are "concern"; at or above concernAt + 3 (capped at 10) are
// "urgent". Any single urgent answer makes the whole check-in urgent;
// any single concern answer (with no urgent) makes it concern; otherwise ok.
export function flagCheckinResponses(
  questions: FollowupQuestion[],
  responses: Record<string, string>
): FollowupRiskFlag {
  let flag: FollowupRiskFlag = "ok";
  for (const q of questions) {
    if (q.type !== "scale" || q.concernAt === undefined) continue;
    const raw = responses[q.id];
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const urgentAt = Math.min(10, q.concernAt + 3);
    if (value >= urgentAt) {
      flag = "urgent";
    } else if (value >= q.concernAt && flag !== "urgent") {
      flag = "concern";
    }
  }
  return flag;
}

export async function summarizeCheckin(
  pathology: string,
  questions: FollowupQuestion[],
  responses: Record<string, string>
): Promise<string | null> {
  if (!AI_CONFIGURED) return null;
  const qa = questions
    .map((q) => `Q: ${q.text}\nA: ${responses[q.id] ?? "(no answer)"}`)
    .join("\n\n");
  try {
    return await askClaude(
      FOLLOWUP_SYSTEM_PROMPT,
      `Follow-up type: ${pathology}\n\n${qa}`,
      300
    );
  } catch (err) {
    console.error("[pulseid-backend] Follow-up AI summary failed:", err);
    return null;
  }
}

// Sensible default question sets per common pathology, offered by the
// doctor-facing "create follow-up" form when the doctor doesn't want to
// write custom questions. A generic fallback covers anything else.
export function defaultQuestionsFor(pathology: string): FollowupQuestion[] {
  const key = pathology.trim().toLowerCase();
  if (key.includes("postpartum") || key.includes("maternal") || key.includes("pregnan")) {
    return [
      { id: "bleeding", text: "On a scale of 0-10, how heavy is any vaginal bleeding today?", type: "scale", concernAt: 6 },
      { id: "pain", text: "On a scale of 0-10, how would you rate your pain today?", type: "scale", concernAt: 7 },
      { id: "fever", text: "Have you had a fever or chills in the last 24 hours?", type: "yes_no" },
      { id: "mood", text: "On a scale of 0-10, how would you rate your mood/energy today (0 = very low)?", type: "scale", concernAt: 8 },
      { id: "notes", text: "Anything else you'd like your doctor to know?", type: "text" },
    ];
  }
  if (key.includes("post-op") || key.includes("postop") || key.includes("surgery") || key.includes("surgical")) {
    return [
      { id: "pain", text: "On a scale of 0-10, how would you rate your pain today?", type: "scale", concernAt: 7 },
      { id: "wound", text: "On a scale of 0-10, how concerned are you about the incision/wound (redness, swelling, discharge)?", type: "scale", concernAt: 6 },
      { id: "fever", text: "Have you had a fever in the last 24 hours?", type: "yes_no" },
      { id: "mobility", text: "Are you able to move around as expected for your recovery stage?", type: "yes_no" },
      { id: "notes", text: "Anything else you'd like your doctor to know?", type: "text" },
    ];
  }
  if (key.includes("chronic") || key.includes("diabet") || key.includes("hypertension") || key.includes("cardiac")) {
    return [
      { id: "symptoms", text: "On a scale of 0-10, how would you rate your symptoms today?", type: "scale", concernAt: 7 },
      { id: "medication", text: "Have you been able to take your medication as prescribed?", type: "yes_no" },
      { id: "readings", text: "Any recent home readings (blood pressure/blood sugar) you'd like to share?", type: "text" },
      { id: "notes", text: "Anything else you'd like your doctor to know?", type: "text" },
    ];
  }
  return [
    { id: "wellbeing", text: "On a scale of 0-10, how would you rate how you're feeling today?", type: "scale", concernAt: 7 },
    { id: "concern", text: "Is there anything concerning you about your recovery right now?", type: "yes_no" },
    { id: "notes", text: "Anything else you'd like your doctor to know?", type: "text" },
  ];
}
