// A small, standalone process — run separately from the main API server
// (`npm run reminders`, or its own container/systemd timer/host cron) —
// that sweeps for confirmed appointments coming up in ~24h and reminds the
// patient by email/SMS. Shares lib/reminders.ts with any future manual
// "send reminders now" trigger, so a scheduled run and a manual one go
// through the same code path.
//
// Next.js auto-loads .env.local in the frontend/analytics apps; this is a
// plain Node script with no such magic, so load env vars explicitly.
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
const envLocal = path.join(__dirname, "..", ".env.local");
const envFallback = path.join(__dirname, "..", ".env");
if (fs.existsSync(envLocal)) dotenv.config({ path: envLocal });
else if (fs.existsSync(envFallback)) dotenv.config({ path: envFallback });

import cron from "node-cron";
import { runReminderSweep } from "../src/lib/reminders";

// Every 15 minutes by default — appointments become "due" in a ~8h window
// (see listAppointmentsNeedingReminder), so this cadence comfortably
// guarantees each one gets exactly one reminder near the 24h mark.
const REMINDER_CRON = process.env.REMINDER_CRON || "*/15 * * * *";

async function runSweep() {
  console.log(`[reminder-scheduler] Running reminder sweep at ${new Date().toISOString()}...`);
  try {
    const result = await runReminderSweep();
    console.log(
      `[reminder-scheduler] Checked ${result.checked} appointment(s): ${result.emailed} emailed, ${result.texted} texted, ${result.skipped} skipped.`
    );
  } catch (err) {
    console.error("[reminder-scheduler] Sweep failed:", err);
  }
}

console.log(`[reminder-scheduler] PulseID appointment reminder scheduler starting.`);
console.log(`[reminder-scheduler] Schedule: "${REMINDER_CRON}"`);

cron.schedule(REMINDER_CRON, runSweep);

if (process.argv.includes("--run-now")) {
  // Handy for testing: `npm run reminders -- --run-now` fires a sweep
  // immediately instead of waiting for the next cron tick.
  runSweep();
}

console.log("[reminder-scheduler] Waiting for next scheduled run. Press Ctrl+C to stop.");
