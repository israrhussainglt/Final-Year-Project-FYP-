// Covers the OTP lifecycle in lib/repo.ts: issuing, verifying, expiry,
// wrong-code lockout, and the per-national-ID daily send cap. These are the
// functions guarding patient login, so they're the highest-value place to
// have tests even though the rest of the codebase has none yet.
//
// Uses an isolated throwaway SQLite file (via PULSEID_DB_PATH) so this
// never touches the real dev database in data/pulseid.db.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";

const TEST_DB_PATH = path.join(os.tmpdir(), `pulseid-test-${randomUUID()}.db`);
process.env.PULSEID_DB_PATH = TEST_DB_PATH;

// Imported *after* PULSEID_DB_PATH is set, since db.ts reads it at import
// time — done inside beforeAll (not top-level await) for broader tooling
// compatibility.
let getDb: typeof import("../lib/db").getDb;
let issueOtp: typeof import("../lib/repo").issueOtp;
let verifyOtp: typeof import("../lib/repo").verifyOtp;
let canSendOtp: typeof import("../lib/repo").canSendOtp;

function createSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      national_id TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      phone_number TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS otp_codes (
      national_id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS otp_send_log (
      id TEXT PRIMARY KEY,
      national_id TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

const NATIONAL_ID = "35202-1234567-1";

beforeAll(async () => {
  ({ getDb } = await import("../lib/db"));
  ({ issueOtp, verifyOtp, canSendOtp } = await import("../lib/repo"));
  createSchema();
});

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM otp_codes; DELETE FROM otp_send_log;");
});

afterAll(() => {
  for (const ext of ["", "-wal", "-shm"]) {
    if (fs.existsSync(TEST_DB_PATH + ext)) fs.rmSync(TEST_DB_PATH + ext);
  }
});

describe("issueOtp / verifyOtp", () => {
  it("accepts the correct code", () => {
    const code = issueOtp(NATIONAL_ID);
    const result = verifyOtp(NATIONAL_ID, code);
    expect(result.ok).toBe(true);
  });

  it("rejects a wrong code and decrements remaining attempts", () => {
    issueOtp(NATIONAL_ID);
    const result = verifyOtp(NATIONAL_ID, "000000");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/attempt/i);
  });

  it("locks out after too many wrong attempts", () => {
    issueOtp(NATIONAL_ID);
    for (let i = 0; i < 5; i++) verifyOtp(NATIONAL_ID, "000000");
    const result = verifyOtp(NATIONAL_ID, "000000");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too many/i);
  });

  it("rejects an expired code", () => {
    issueOtp(NATIONAL_ID);
    // Force expiry directly in the DB rather than waiting 5 real minutes.
    const db = getDb();
    db.prepare("UPDATE otp_codes SET expires_at = ? WHERE national_id = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      NATIONAL_ID
    );
    const row = db.prepare("SELECT code FROM otp_codes WHERE national_id = ?").get(NATIONAL_ID) as { code: string };
    const result = verifyOtp(NATIONAL_ID, row.code);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  it("rejects verification when no code was ever requested", () => {
    const result = verifyOtp("99999-9999999-9", "123456");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no code/i);
  });

  it("a successfully verified code cannot be reused", () => {
    const code = issueOtp(NATIONAL_ID);
    expect(verifyOtp(NATIONAL_ID, code).ok).toBe(true);
    expect(verifyOtp(NATIONAL_ID, code).ok).toBe(false);
  });
});

describe("canSendOtp (daily abuse cap)", () => {
  it("allows sends under the daily cap", () => {
    for (let i = 0; i < 7; i++) {
      expect(canSendOtp(NATIONAL_ID).ok).toBe(true);
      issueOtp(NATIONAL_ID);
    }
  });

  it("blocks sends once the daily cap is hit", () => {
    for (let i = 0; i < 8; i++) issueOtp(NATIONAL_ID);
    const result = canSendOtp(NATIONAL_ID);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too many/i);
  });

  it("tracks the cap per national ID independently", () => {
    for (let i = 0; i < 8; i++) issueOtp(NATIONAL_ID);
    expect(canSendOtp(NATIONAL_ID).ok).toBe(false);
    expect(canSendOtp("11111-1111111-1").ok).toBe(true);
  });
});
