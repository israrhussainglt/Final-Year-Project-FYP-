// A small, standalone process — run separately from the main API server
// (`npm run followups`, or its own container/systemd timer/host cron) —
// that sweeps for active follow-up agents whose next check-in is due and
// prompts the patient by email/SMS. Mirrors scripts/reminder-scheduler.ts
// exactly: shares lib/followup-agent.ts with any future manual "send
// check-in now" trigger, so a scheduled run and a manual one go through
// the same code path.
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
import { runFollowupSweep } from "../src/lib/followup-agent";

// Once an hour by default — follow-up cadences are measured in days, not
// minutes, so this comfortably catches every agent close to its due time
// without hammering the DB.
const FOLLOWUP_CRON = process.env.FOLLOWUP_CRON || "0 * * * *";

async function runSweep() {
  console.log(`[followup-scheduler] Running follow-up sweep at ${new Date().toISOString()}...`);
  try {
    const result = await runFollowupSweep();
    console.log(
      `[followup-scheduler] ${result.due} agent(s) due, ${result.sent} check-in(s) sent, ${result.skipped} skipped.`
    );
  } catch (err) {
    console.error("[followup-scheduler] Sweep failed:", err);
  }
}

console.log(`[followup-scheduler] PulseID follow-up check-in scheduler starting.`);
console.log(`[followup-scheduler] Schedule: "${FOLLOWUP_CRON}"`);

cron.schedule(FOLLOWUP_CRON, runSweep);

if (process.argv.includes("--run-now")) {
  // Handy for testing: `npm run followups -- --run-now` fires a sweep
  // immediately instead of waiting for the next cron tick.
  runSweep();
}

console.log("[followup-scheduler] Waiting for next scheduled run. Press Ctrl+C to stop.");
