// Covers buildMedicalReport (lib/report.ts) — the single source of truth
// behind the patient- and doctor-facing report views. Uses an isolated
// throwaway SQLite file (via PULSEID_DB_PATH) plus the shared clinical test
// schema, seeded directly through SQL so the test pins the report's
// aggregation rules: record counts, current-vs-history medication
// classification, risk flags, the 15-entry access-log cap, and age
// calculation.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";

const TEST_DB_PATH = path.join(os.tmpdir(), `pulseid-test-${randomUUID()}.db`);
process.env.PULSEID_DB_PATH = TEST_DB_PATH;

let getDb: typeof import("../lib/db").getDb;
let createClinicalSchema: typeof import("./helpers/schema").createClinicalSchema;
let buildMedicalReport: typeof import("../lib/report").buildMedicalReport;

const DOCTOR_ID = randomUUID();
const PATIENT_ID = randomUUID();

// Date helpers relative to "now" so the current-medication heuristic holds
// regardless of when the suite runs.
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function dobYearsAgo(years: number, dayOffset = 0): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  ({ getDb } = await import("../lib/db"));
  ({ createClinicalSchema } = await import("./helpers/schema"));
  ({ buildMedicalReport } = await import("../lib/report"));
  createClinicalSchema(getDb());

  const db = getDb();
  db.prepare(
    "INSERT INTO doctors (id, full_name, email, password_hash, license_number, is_active) VALUES (?, ?, ?, ?, ?, 1)"
  ).run(DOCTOR_ID, "Dr. Report", "report@test.dev", "x", "L-REP");
  db.prepare(
    `INSERT INTO patients (id, national_id, id_type, full_name, date_of_birth, gender, phone_number,
       blood_group, allergies, chronic_conditions, emergency_qr_token)
     VALUES (?, '41000-7777777-7', 'cnic', 'Report Patient', ?, 'female', '+92 300 1111111',
       'A+', 'Penicillin', 'Type 2 Diabetes', 'tok-report')`
  ).run(PATIENT_ID, dobYearsAgo(30));

  db.prepare(
    `INSERT INTO emergency_contacts (id, patient_id, full_name, relationship_type, phone_number, is_primary)
     VALUES (?, ?, 'Spouse Name', 'spouse', '+92 300 2222222', 1)`
  ).run(randomUUID(), PATIENT_ID);

  const record = (id: string, type: string, visitDate: string, diagnosis: string) =>
    db.prepare(
      `INSERT INTO medical_records (id, patient_id, doctor_id, record_type, visit_date, diagnosis)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, PATIENT_ID, DOCTOR_ID, type, visitDate, diagnosis);

  const rEmergency = randomUUID();
  const rSurgery = randomUUID();
  const rCheckup = randomUUID();
  record(rEmergency, "emergency_visit", daysAgo(90), "Fracture");
  record(rSurgery, "surgery", daysAgo(60), "Appendectomy");
  record(rCheckup, "checkup", daysAgo(1), "Type 2 diabetes follow-up");

  const rx = (meds: unknown, issued: string) =>
    db.prepare(
      `INSERT INTO prescriptions (id, patient_id, doctor_id, medical_record_id, medications, instructions, issued_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), PATIENT_ID, DOCTOR_ID, rCheckup, JSON.stringify(meds), "After meals", issued);

  // Recent → current. Old but "ongoing" → current. Old and finite → history.
  rx([{ name: "Metformin", dosage: "500 mg", frequency: "twice daily", duration: "30 days" }], daysAgo(2));
  rx([{ name: "Warfarin", dosage: "5 mg", frequency: "once daily", duration: "ongoing" }], daysAgo(120));
  rx([{ name: "Ibuprofen", dosage: "400 mg", frequency: "as needed", duration: "5 days" }], daysAgo(60));

  // 20 audit rows — the report caps its access log at 15.
  for (let i = 0; i < 20; i++) {
    db.prepare(
      `INSERT INTO audit_logs (id, patient_id, actor_role, actor_name, actor_id, action, details)
       VALUES (?, ?, 'doctor', 'Dr. Report', ?, 'record_viewed', ?)`
    ).run(randomUUID(), PATIENT_ID, DOCTOR_ID, `view ${i}`);
  }
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

describe("buildMedicalReport (report.ts)", () => {
  it("returns null for an unknown patient", () => {
    expect(buildMedicalReport(randomUUID(), "doctor", "Dr. X")).toBeNull();
  });

  it("builds the full patient view: identity, age, summary counts, risk flags", () => {
    const report = buildMedicalReport(PATIENT_ID, "patient", "PulseID Patient Portal");
    expect(report).not.toBeNull();
    expect(report!.patient).toMatchObject({
      id: PATIENT_ID,
      fullName: "Report Patient",
      gender: "female",
      bloodGroup: "A+",
      allergies: "Penicillin",
      chronicConditions: "Type 2 Diabetes",
    });
    // password hash and raw QR token never reach the report payload
    expect(report!.patient).not.toHaveProperty("passwordHash");
    expect(report!.patient).not.toHaveProperty("emergencyQrToken");
    expect(report!.patient.age).toBe(30);
    expect(report!.generatedFor).toBe("patient");
    expect(report!.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(report!.summary.totalVisits).toBe(3);
    expect(report!.summary.totalPrescriptions).toBe(3);
    expect(report!.summary.recordsByType).toEqual({ emergency_visit: 1, surgery: 1, checkup: 1 });
    // records come newest-first, so the checkup from yesterday is most recent
    expect(report!.summary.mostRecentVisit).toMatchObject({
      date: daysAgo(1),
      type: "checkup",
      diagnosis: "Type 2 diabetes follow-up",
    });

    expect(report!.summary.riskFlags).toEqual(
      expect.arrayContaining([
        "Allergy alert: Penicillin",
        "Chronic condition: Type 2 Diabetes",
        "Has one or more prior emergency-department visits on file",
        "Has surgical history on file",
      ])
    );
  });

  it("classifies current medications: recent OR flagged ongoing, never expired finite courses", () => {
    const report = buildMedicalReport(PATIENT_ID, "doctor", "Dr. Report")!;
    const names = report.currentMedications.map((m) => m.name).sort();
    expect(names).toEqual(["Metformin", "Warfarin"]); // Ibuprofen (60d, finite) is history
    for (const med of report.currentMedications) {
      expect(med.prescribedBy).toBe("Dr. Report");
      expect(med.issuedDate).toBeTruthy();
    }
    const byName = Object.fromEntries(report.prescriptions.map((rx) => [rx.medications[0].name, rx.isCurrent]));
    expect(byName).toEqual({ Metformin: true, Warfarin: true, Ibuprofen: false });
  });

  it("maps emergency contacts and caps the access log at 15 entries", () => {
    const report = buildMedicalReport(PATIENT_ID, "doctor", "Dr. Report")!;
    expect(report.emergencyContacts).toEqual([
      { fullName: "Spouse Name", relationship: "spouse", phone: "+92 300 2222222", isPrimary: true },
    ]);
    expect(report.accessLog).toHaveLength(15);
    expect(report.accessLog[0]).toMatchObject({ actorRole: "doctor", action: "record_viewed" });
  });

  it("reports an empty state cleanly: no records, no prescriptions, no flags", () => {
    const db = getDb();
    const emptyId = randomUUID();
    db.prepare(
      `INSERT INTO patients (id, national_id, id_type, full_name, date_of_birth, gender, phone_number, emergency_qr_token)
       VALUES (?, '41000-8888888-8', 'cnic', 'Empty Patient', '1990-01-01', 'male', '+92 300 3333333', 'tok-empty')`
    ).run(emptyId);
    const report = buildMedicalReport(emptyId, "doctor", "Dr. Report")!;
    expect(report.summary.totalVisits).toBe(0);
    expect(report.summary.mostRecentVisit).toBeNull();
    expect(report.summary.riskFlags).toEqual([]);
    expect(report.currentMedications).toEqual([]);
    expect(report.timeline).toEqual([]);
    expect(report.accessLog).toEqual([]);
  });
});
