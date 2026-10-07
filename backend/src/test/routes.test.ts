// Route-level tests against the exported Express app (server.ts) — the
// first batch covering the paths the unit suites can't see: session auth
// + CSRF enforcement, the public booking flow, patient OTP login, medical
// record creation, and the AI-report finalize route including the
// replace-semantics prescription regression.
//
// The app is imported (not listened on — NODE_ENV=test guards app.listen)
// and backed by an isolated throwaway SQLite file, so nothing here touches
// the dev database or a real port. Requests send unique X-Forwarded-For
// values so the in-memory per-IP rate limiter never cross-triggers.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import supertest from "supertest";

const TEST_DB_PATH = path.join(os.tmpdir(), `pulseid-test-${randomUUID()}.db`);
process.env.PULSEID_DB_PATH = TEST_DB_PATH;

let app: Express;
let getDb: typeof import("../lib/db").getDb;
let createClinicalSchema: typeof import("./helpers/schema").createClinicalSchema;

const DOCTOR = { email: "routes@test.dev", password: "doctor123" };
const PATIENT_NATIONAL_ID = "42101-5550000-5";
let doctorId = "";
let patientId = "";

function cookiesOf(res: supertest.Response): string {
  return ((res.headers["set-cookie"] ?? []) as string[]).map((c) => c.split(";")[0]).join("; ");
}
function csrfOf(res: supertest.Response): string {
  const raw = ((res.headers["set-cookie"] ?? []) as string[]).find((c) => c.startsWith("pulseid_csrf="));
  return raw ? raw.split(";")[0].split("=")[1] : "";
}

beforeAll(async () => {
  ({ getDb } = await import("../lib/db"));
  ({ createClinicalSchema } = await import("./helpers/schema"));
  ({ app } = await import("../server"));
  createClinicalSchema(getDb());

  const db = getDb();
  doctorId = randomUUID();
  patientId = randomUUID();
  db.prepare(
    "INSERT INTO doctors (id, full_name, email, password_hash, license_number, is_active) VALUES (?, ?, ?, ?, ?, 1)"
  ).run(doctorId, "Dr. Routes", DOCTOR.email, bcrypt.hashSync(DOCTOR.password, 4), "L-ROUTE");
  db.prepare(
    `INSERT INTO patients (id, national_id, id_type, full_name, date_of_birth, gender, phone_number, emergency_qr_token)
     VALUES (?, ?, 'cnic', 'Route Patient', '1990-03-03', 'female', '+92 300 4444444', ?)`
  ).run(patientId, PATIENT_NATIONAL_ID, `tok-${patientId}`);
});

afterAll(() => {
  getDb().close();
  // Windows can hold the WAL file a beat past close — cleanup is best-effort.
  try {
    fs.rmSync(TEST_DB_PATH, { force: true });
  } catch {
    /* temp file, OS cleans up */
  }
});

describe("HTTP plumbing", () => {
  it("answers unknown routes with the JSON 404 handler", async () => {
    const res = await supertest(app).get("/api/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found." });
  });

  it("rejects unauthenticated doctor routes with 401", async () => {
    const res = await supertest(app).get("/api/patients");
    expect(res.status).toBe(401);
  });

  it("enforces CSRF on session-bearing POSTs", async () => {
    const login = await supertest(app).post("/api/auth/doctor/login").send(DOCTOR);
    expect(login.status).toBe(200);
    const res = await supertest(app)
      .post(`/api/patients/${patientId}/records`)
      .set("Cookie", cookiesOf(login))
      .send({ diagnosis: "x" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Missing CSRF/);
  });
});

describe("doctor session auth", () => {
  it("rejects a wrong password without issuing cookies", async () => {
    const res = await supertest(app)
      .post("/api/auth/doctor/login")
      .set("X-Forwarded-For", "10.1.0.1")
      .send({ email: DOCTOR.email, password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"] ?? []).toHaveLength(0);
  });

  it("logs in and issues session + csrf cookies", async () => {
    const res = await supertest(app)
      .post("/api/auth/doctor/login")
      .set("X-Forwarded-For", "10.1.0.2")
      .send(DOCTOR);
    expect(res.status).toBe(200);
    const cookies = cookiesOf(res);
    expect(cookies).toContain("pulseid_doctor_session=");
    expect(csrfOf(res)).toMatch(/^[0-9a-f]{48}$/);
  });

  it("serves the patient list for the sessioned doctor", async () => {
    const login = await supertest(app)
      .post("/api/auth/doctor/login")
      .set("X-Forwarded-For", "10.1.0.3")
      .send(DOCTOR);
    const res = await supertest(app)
      .get("/api/patients")
      .set("Cookie", cookiesOf(login))
      .set("x-csrf-token", csrfOf(login));
    expect(res.status).toBe(200);
    const list = res.body.patients ?? res.body;
    expect(list.some((p: { id: string }) => p.id === patientId)).toBe(true);
  });

  it("404s a patient that does not exist", async () => {
    const login = await supertest(app)
      .post("/api/auth/doctor/login")
      .set("X-Forwarded-For", "10.1.0.4")
      .send(DOCTOR);
    const res = await supertest(app)
      .get(`/api/patients/${randomUUID()}`)
      .set("Cookie", cookiesOf(login));
    expect(res.status).toBe(404);
  });
});

describe("public booking flow", () => {
  const bookingBase = {
    fullName: "Booking Route",
    dateOfBirth: "1992-02-02",
    gender: "male",
    phoneNumber: "+92 300 5555555",
    bloodGroup: "O+",
    reason: "route test booking",
    contacts: [] as unknown[],
  };

  it("validates required fields", async () => {
    const res = await supertest(app)
      .post("/api/booking/requests")
      .set("X-Forwarded-For", "10.2.0.1")
      .send({ fullName: "x" });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toHaveProperty("nationalId");
    expect(res.body.fieldErrors).toHaveProperty("doctorId");
  });

  it("creates a pending request and blocks a duplicate for the same doctor", async () => {
    const first = await supertest(app)
      .post("/api/booking/requests")
      .set("X-Forwarded-For", "10.2.0.2")
      .send({ ...bookingBase, nationalId: PATIENT_NATIONAL_ID, doctorId });
    expect(first.status).toBe(201);

    const dup = await supertest(app)
      .post("/api/booking/requests")
      .set("X-Forwarded-For", "10.2.0.3")
      .send({ ...bookingBase, nationalId: PATIENT_NATIONAL_ID, doctorId });
    expect(dup.status).toBe(400);
    expect(dup.body.fieldErrors?.doctorId).toMatch(/pending/);
  });
});

describe("patient OTP flow (demo mode)", () => {
  it("rejects a wrong code and accepts the demo code, exposing notifications", async () => {
    const req = await supertest(app)
      .post("/api/auth/patient/request-otp")
      .set("X-Forwarded-For", "10.3.0.1")
      .send({ nationalId: PATIENT_NATIONAL_ID });
    expect(req.status).toBe(200);
    const code: string = req.body.demoOtp;
    expect(code).toMatch(/^\d{6}$/);

    const bad = await supertest(app)
      .post("/api/auth/patient/verify-otp")
      .set("X-Forwarded-For", "10.3.0.2")
      .send({ nationalId: PATIENT_NATIONAL_ID, code: "000000" });
    expect([400, 401]).toContain(bad.status);

    const good = await supertest(app)
      .post("/api/auth/patient/verify-otp")
      .set("X-Forwarded-For", "10.3.0.3")
      .send({ nationalId: PATIENT_NATIONAL_ID, code });
    expect(good.status).toBe(200);
    const feed = await supertest(app)
      .get("/api/patient/notifications")
      .set("Cookie", cookiesOf(good));
    expect(feed.status).toBe(200);
    expect(Array.isArray(feed.body.notifications)).toBe(true);
  });
});

describe("medical records + report finalize", () => {
  // Monotonic unique IP per login — no cross-test rate-limit collisions.
  let nextAgentIp = 10;
  async function doctorAgent() {
    const login = await supertest(app)
      .post("/api/auth/doctor/login")
      .set("X-Forwarded-For", `10.4.0.${++nextAgentIp}`)
      .send(DOCTOR);
    return {
      post: (url: string, body: unknown) =>
        supertest(app)
          .post(url)
          .set("Cookie", cookiesOf(login))
          .set("x-csrf-token", csrfOf(login))
          .send(body),
      get: (url: string) => supertest(app).get(url).set("Cookie", cookiesOf(login)),
    };
  }

  it("creates a visit and rejects one without a diagnosis", async () => {
    const doc = await doctorAgent();
    const bad = await doc.post(`/api/patients/${patientId}/records`, { symptoms: "cough" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/[Dd]iagnosis/);

    const good = await doc.post(`/api/patients/${patientId}/records`, {
      recordType: "checkup",
      visitDate: "2026-10-04",
      diagnosis: "Acute bronchitis",
      symptoms: "Cough, fever",
      systolicBp: 118,
      heartRateBpm: 88,
    });
    expect(good.status).toBe(200);
    expect(good.body.record.diagnosis).toBe("Acute bronchitis");
  });

  it("404s record creation for an unknown patient", async () => {
    const doc = await doctorAgent();
    const res = await doc.post(`/api/patients/${randomUUID()}/records`, { diagnosis: "x" });
    expect(res.status).toBe(404);
  });

  it("refuses AI drafting when the RAG service isn't enabled (503)", async () => {
    const doc = await doctorAgent();
    const detail = await doc.get(`/api/patients/${patientId}`);
    const record = detail.body.records[0];
    const saved = { url: process.env.RAG_SERVICE_URL, enabled: process.env.RAG_SERVICE_ENABLED };
    delete process.env.RAG_SERVICE_URL;
    delete process.env.RAG_SERVICE_ENABLED;
    try {
      const res = await doc.post(`/api/patients/${patientId}/records/${record.id}/draft`, { keywords: "k" });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/RAG_SERVICE_ENABLED|not configured/i);
    } finally {
      if (saved.url !== undefined) process.env.RAG_SERVICE_URL = saved.url;
      if (saved.enabled !== undefined) process.env.RAG_SERVICE_ENABLED = saved.enabled;
    }
  });

  it("finalize requires diagnosis + notes", async () => {
    const doc = await doctorAgent();
    const detail = await doc.get(`/api/patients/${patientId}`);
    const record = detail.body.records[0];
    const res = await doc.post(`/api/patients/${patientId}/records/${record.id}/finalize`, {
      diagnosis: "Only half of it",
    });
    expect(res.status).toBe(400);
  });

  it("re-finalizing a visit replaces its prescriptions instead of duplicating them", async () => {
    const doc = await doctorAgent();
    const detail = await doc.get(`/api/patients/${patientId}`);
    const record = detail.body.records.find((r: { diagnosis: string }) => r.diagnosis === "Acute bronchitis");
    const notes = "Assessment: bronchitis.\n\nFollow up: one week.";
    const rx = [{ name: "Amoxicillin", dosage: "500 mg", frequency: "three times daily", duration: "7 days", instructions: "After food" }];

    const first = await doc.post(`/api/patients/${patientId}/records/${record.id}/finalize`, {
      diagnosis: "Acute bronchitis",
      notes,
      prescriptions: rx,
    });
    expect(first.status).toBe(200);
    expect(first.body.patientNotified).toBe(true);

    const second = await doc.post(`/api/patients/${patientId}/records/${record.id}/finalize`, {
      diagnosis: "Acute bronchitis",
      notes,
      prescriptions: [{ ...rx[0], name: "Azithromycin" }],
    });
    expect(second.status).toBe(200);

    // Route-level regression guard: exactly one prescription row survives.
    const rows = getDb()
      .prepare("SELECT COUNT(*) c FROM prescriptions WHERE medical_record_id = ?")
      .get(record.id) as { c: number };
    expect(rows.c).toBe(1);
    const stored = JSON.parse(
      (getDb().prepare("SELECT medications FROM prescriptions WHERE medical_record_id = ?").get(record.id) as { medications: string }).medications
    );
    expect(stored[0].name).toBe("Azithromycin");

    // The finalize wrote an audit entry.
    const audit = getDb()
      .prepare("SELECT COUNT(*) c FROM audit_logs WHERE patient_id = ? AND action = 'report_finalized'")
      .get(patientId) as { c: number };
    expect(audit.c).toBeGreaterThan(0);
  });
});
