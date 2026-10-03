// Covers the self-service booking lifecycle in lib/repo.ts: creating a pending
// registration, ownership scoping, the one-pending-request anti-spam rule,
// approval (new patient vs existing patient vs the national-ID race), rejection
// with attachment purge, and the active-doctor lookup the patient-facing routes
// validate against. Approval is the gate that turns an unverified submission
// into a real patient + confirmed appointment, so it's the highest-value place
// to have tests after patient login.
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
let createPatientRegistration: typeof import("../lib/repo").createPatientRegistration;
let approvePatientRegistration: typeof import("../lib/repo").approvePatientRegistration;
let rejectPatientRegistration: typeof import("../lib/repo").rejectPatientRegistration;
let hasPendingRegistrationForDoctor: typeof import("../lib/repo").hasPendingRegistrationForDoctor;
let findRegistrationForDoctor: typeof import("../lib/repo").findRegistrationForDoctor;
let createRegistrationAttachment: typeof import("../lib/repo").createRegistrationAttachment;
let purgeRegistrationAttachments: typeof import("../lib/repo").purgeRegistrationAttachments;
let findActiveDoctorById: typeof import("../lib/repo").findActiveDoctorById;

function createSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS hospitals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT,
      province TEXT
    );
    CREATE TABLE IF NOT EXISTS doctors (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      license_number TEXT UNIQUE NOT NULL,
      specialization TEXT,
      hospital_id TEXT REFERENCES hospitals(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      national_id TEXT UNIQUE NOT NULL,
      id_type TEXT NOT NULL DEFAULT 'cnic',
      full_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      gender TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      email TEXT,
      address TEXT,
      blood_group TEXT NOT NULL DEFAULT 'unknown',
      allergies TEXT,
      chronic_conditions TEXT,
      weight_kg REAL,
      pediatrician_name TEXT,
      pediatrician_phone TEXT,
      guardian_patient_id TEXT REFERENCES patients(id),
      password_hash TEXT,
      emergency_qr_token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS emergency_contacts (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS medical_records (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id TEXT REFERENCES doctors(id),
      record_type TEXT NOT NULL DEFAULT 'checkup',
      visit_date TEXT NOT NULL,
      diagnosis TEXT,
      symptoms TEXT,
      notes TEXT,
      systolic_bp INTEGER,
      diastolic_bp INTEGER,
      blood_sugar_mmol REAL,
      body_temp_c REAL,
      heart_rate_bpm INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      scheduled_at TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','completed','cancelled')),
      doctor_notes TEXT,
      reminder_sent_at TEXT,
      recurrence_group_id TEXT,
      recurrence_rule TEXT,
      recurrence_index INTEGER,
      recurrence_count INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS patient_registrations (
      id TEXT PRIMARY KEY,
      national_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      gender TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      email TEXT,
      address TEXT,
      blood_group TEXT NOT NULL DEFAULT 'unknown',
      allergies TEXT,
      chronic_conditions TEXT,
      weight_kg REAL,
      pediatrician_name TEXT,
      pediatrician_phone TEXT,
      doctor_id TEXT NOT NULL REFERENCES doctors(id),
      reason TEXT,
      contacts TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      patient_id TEXT REFERENCES patients(id),
      matched_patient_id TEXT REFERENCES patients(id),
      appointment_id TEXT REFERENCES appointments(id),
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS registration_attachments (
      id TEXT PRIMARY KEY,
      registration_id TEXT NOT NULL REFERENCES patient_registrations(id) ON DELETE CASCADE,
      stored_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

const ACTIVE_DOCTOR_ID = randomUUID();
const OTHER_DOCTOR_ID = randomUUID();
const EXISTING_PATIENT_ID = randomUUID();
const EXISTING_PATIENT_NATIONAL_ID = "35202-1234567-1";

let uploadDir: string;

function createRegistration(overrides: Record<string, unknown> = {}) {
  return createPatientRegistration({
    nationalId: "42101-7654321-9",
    fullName: "Booked Person",
    dateOfBirth: "1995-06-15",
    gender: "female",
    phoneNumber: "+92 300 1234567",
    bloodGroup: "O+",
    doctorId: ACTIVE_DOCTOR_ID,
    ...overrides,
  });
}

beforeAll(async () => {
  ({ getDb } = await import("../lib/db"));
  ({
    createPatientRegistration,
    approvePatientRegistration,
    rejectPatientRegistration,
    hasPendingRegistrationForDoctor,
    findRegistrationForDoctor,
    createRegistrationAttachment,
    purgeRegistrationAttachments,
    findActiveDoctorById,
  } = await import("../lib/repo"));
  createSchema();

  const db = getDb();
  db.prepare(
    "INSERT INTO doctors (id, full_name, email, password_hash, license_number, is_active) VALUES (?, ?, ?, ?, ?, 1)"
  ).run(ACTIVE_DOCTOR_ID, "Dr. Test Active", "active@test.dev", "x", "L-1");
  db.prepare(
    "INSERT INTO doctors (id, full_name, email, password_hash, license_number, is_active) VALUES (?, ?, ?, ?, ?, 0)"
  ).run(OTHER_DOCTOR_ID, "Dr. Test Inactive", "inactive@test.dev", "x", "L-2");
  db.prepare(
    `INSERT INTO patients (id, national_id, id_type, full_name, date_of_birth, gender, phone_number, emergency_qr_token)
     VALUES (?, ?, 'cnic', 'Existing Patient', '1990-01-01', 'male', '+92 300 0000000', ?)`
  ).run(EXISTING_PATIENT_ID, EXISTING_PATIENT_NATIONAL_ID, "tok-existing");

  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulseid-uploads-"));
});

beforeEach(() => {
  const db = getDb();
  db.exec(
    "DELETE FROM registration_attachments; DELETE FROM patient_registrations; DELETE FROM appointments; DELETE FROM medical_records; DELETE FROM emergency_contacts;"
  );
  // Keep the seeded "existing patient" row; everything else goes.
  db.prepare("DELETE FROM patients WHERE id != ?").run(EXISTING_PATIENT_ID);
});

afterAll(() => {
  // Best-effort: on Windows the sqlite handle can outlive the suite by a tick
  // and lock the file — a failed cleanup shouldn't fail the tests themselves.
  try {
    getDb().close();
  } catch {
    /* already closed */
  }
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      if (fs.existsSync(TEST_DB_PATH + ext)) fs.rmSync(TEST_DB_PATH + ext);
    } catch {
      /* locked or already gone */
    }
  }
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

describe("createPatientRegistration / ownership scoping", () => {
  it("creates a pending registration readable only by the addressed doctor", () => {
    const reg = createRegistration();
    expect(reg.status).toBe("pending");
    expect(findRegistrationForDoctor(reg.id, ACTIVE_DOCTOR_ID)?.id).toBe(reg.id);
    // Another doctor — even with a valid account — gets nothing back.
    expect(findRegistrationForDoctor(reg.id, OTHER_DOCTOR_ID)).toBeUndefined();
  });

  it("stores submitted emergency contacts as JSON for replay at approval", () => {
    const contacts = [{ fullName: "Amma", relationshipType: "Parent", phoneNumber: "+92 301 1111111" }];
    const reg = createRegistration({ contacts });
    expect(JSON.parse(findRegistrationForDoctor(reg.id, ACTIVE_DOCTOR_ID)!.contacts as string)).toEqual(contacts);
  });
});

describe("hasPendingRegistrationForDoctor (anti-spam)", () => {
  it("sees a pending request and clears once it is rejected", () => {
    const reg = createRegistration();
    expect(hasPendingRegistrationForDoctor(reg.national_id, ACTIVE_DOCTOR_ID)).toBe(true);
    rejectPatientRegistration(reg.id, ACTIVE_DOCTOR_ID, "Dr. Test Active");
    // Rejected requests don't block rebooking with the same doctor.
    expect(hasPendingRegistrationForDoctor(reg.national_id, ACTIVE_DOCTOR_ID)).toBe(false);
  });

  it("tracks the cap per doctor independently", () => {
    const reg = createRegistration();
    expect(hasPendingRegistrationForDoctor(reg.national_id, ACTIVE_DOCTOR_ID)).toBe(true);
    expect(hasPendingRegistrationForDoctor(reg.national_id, OTHER_DOCTOR_ID)).toBe(false);
  });
});

describe("approvePatientRegistration", () => {
  it("creates the patient, replays contacts, writes the registration record and confirms the appointment", () => {
    const reg = createRegistration({
      dateOfBirth: "2015-03-10", // minor → B-Form
      contacts: [
        { fullName: "Amma", relationshipType: "Parent", phoneNumber: "+92 301 1111111" },
        { fullName: "Abba", relationshipType: "Parent", phoneNumber: "+92 301 2222222" },
      ],
    });
    const when = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const { registration, patientId, appointmentId } = approvePatientRegistration({
      registrationId: reg.id,
      doctorId: ACTIVE_DOCTOR_ID,
      doctorName: "Dr. Test Active",
      scheduledAtIso: when,
    });

    expect(registration.status).toBe("approved");
    expect(registration.patient_id).toBe(patientId);
    expect(registration.appointment_id).toBe(appointmentId);

    const db = getDb();
    const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(patientId) as any;
    expect(patient.national_id).toBe(reg.national_id);
    // ID type is derived from DOB at approval time: a minor gets a B-Form.
    expect(patient.id_type).toBe("b_form");

    const contacts = db
      .prepare("SELECT full_name, is_primary FROM emergency_contacts WHERE patient_id = ? ORDER BY rowid")
      .all(patientId) as any[];
    expect(contacts.map((c) => c.full_name)).toEqual(["Amma", "Abba"]);
    expect(contacts[0].is_primary).toBe(1);

    const record = db
      .prepare("SELECT record_type FROM medical_records WHERE patient_id = ?")
      .get(patientId) as any;
    expect(record.record_type).toBe("registration");

    const appointment = db.prepare("SELECT * FROM appointments WHERE id = ?").get(appointmentId) as any;
    expect(appointment.status).toBe("confirmed");
    expect(appointment.scheduled_at).toBe(when);
    expect(appointment.patient_id).toBe(patientId);
  });

  it("books onto the existing patient instead of creating a duplicate", () => {
    const reg = createRegistration({
      nationalId: EXISTING_PATIENT_NATIONAL_ID,
      matchedPatientId: EXISTING_PATIENT_ID,
      contacts: [{ fullName: "Someone New", relationshipType: "Friend", phoneNumber: "+92 302 3333333" }],
    });
    const when = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const { patientId, appointmentId } = approvePatientRegistration({
      registrationId: reg.id,
      doctorId: ACTIVE_DOCTOR_ID,
      doctorName: "Dr. Test Active",
      scheduledAtIso: when,
    });

    expect(patientId).toBe(EXISTING_PATIENT_ID);
    const db = getDb();
    // Exactly one patient row for the national ID, untouched contacts, and no
    // second 'registration' medical record.
    expect((db.prepare("SELECT COUNT(*) n FROM patients WHERE national_id = ?").get(EXISTING_PATIENT_NATIONAL_ID) as any).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM emergency_contacts WHERE patient_id = ?").get(EXISTING_PATIENT_ID) as any).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) n FROM medical_records WHERE patient_id = ?").get(EXISTING_PATIENT_ID) as any).n).toBe(0);
    expect((db.prepare("SELECT status FROM appointments WHERE id = ?").get(appointmentId) as any).status).toBe("confirmed");
  });

  it("refuses with NATIONAL_ID_TAKEN when the ID was registered after submission", () => {
    const reg = createRegistration({ nationalId: "42202-9999999-1" });
    // Simulates the race: someone registered this ID between submit and approve.
    getDb()
      .prepare(
        `INSERT INTO patients (id, national_id, id_type, full_name, date_of_birth, gender, phone_number, emergency_qr_token)
         VALUES (?, '42202-9999999-1', 'cnic', 'Raced In', '1990-01-01', 'male', '+92 300 1111111', ?)`
      )
      .run(randomUUID(), "tok-raced");
    expect(() =>
      approvePatientRegistration({
        registrationId: reg.id,
        doctorId: ACTIVE_DOCTOR_ID,
        doctorName: "Dr. Test Active",
        scheduledAtIso: new Date(Date.now() + 3600 * 1000).toISOString(),
      })
    ).toThrowError("NATIONAL_ID_TAKEN");
    // Nothing was half-created: the registration is still pending.
    expect(findRegistrationForDoctor(reg.id, ACTIVE_DOCTOR_ID)?.status).toBe("pending");
  });

  it("cannot approve the same request twice", () => {
    const reg = createRegistration();
    approvePatientRegistration({
      registrationId: reg.id,
      doctorId: ACTIVE_DOCTOR_ID,
      doctorName: "Dr. Test Active",
      scheduledAtIso: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
    expect(() =>
      approvePatientRegistration({
        registrationId: reg.id,
        doctorId: ACTIVE_DOCTOR_ID,
        doctorName: "Dr. Test Active",
        scheduledAtIso: new Date(Date.now() + 3600 * 1000).toISOString(),
      })
    ).toThrowError("ALREADY_REVIEWED");
  });
});

describe("rejectPatientRegistration + attachment purge", () => {
  it("marks the request rejected and removes its uploaded files from disk", () => {
    const reg = createRegistration();
    const fileA = path.join(uploadDir, "a.pdf");
    const fileB = path.join(uploadDir, "b.pdf");
    fs.writeFileSync(fileA, "A");
    fs.writeFileSync(fileB, "B");
    createRegistrationAttachment({ registrationId: reg.id, storedName: "a.pdf", originalName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1 });
    createRegistrationAttachment({ registrationId: reg.id, storedName: "b.pdf", originalName: "b.pdf", mimeType: "application/pdf", sizeBytes: 1 });

    expect(rejectPatientRegistration(reg.id, ACTIVE_DOCTOR_ID, "Dr. Test Active")).toBe(true);
    const removed = purgeRegistrationAttachments(reg.id, uploadDir);
    expect(removed).toBe(2);
    expect(fs.existsSync(fileA)).toBe(false);
    expect(fs.existsSync(fileB)).toBe(false);
    expect(findRegistrationForDoctor(reg.id, ACTIVE_DOCTOR_ID)?.status).toBe("rejected");
  });

  it("ignores attachment files that are already gone", () => {
    const reg = createRegistration();
    createRegistrationAttachment({ registrationId: reg.id, storedName: "missing.pdf", originalName: "m.pdf", mimeType: "application/pdf", sizeBytes: 1 });
    expect(purgeRegistrationAttachments(reg.id, uploadDir)).toBe(0);
  });
});

describe("findActiveDoctorById", () => {
  it("matches active doctors and skips deactivated ones", () => {
    expect(findActiveDoctorById(ACTIVE_DOCTOR_ID)?.id).toBe(ACTIVE_DOCTOR_ID);
    expect(findActiveDoctorById(OTHER_DOCTOR_ID)).toBeUndefined();
  });
});
