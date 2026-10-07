// Covers repo functions no other suite touches: the doctor-side patient
// demographics update (updatePatient) and the audit trail (logAudit /
// getAuditLog). Isolated throwaway SQLite file + the shared clinical schema.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";

const TEST_DB_PATH = path.join(os.tmpdir(), `pulseid-test-${randomUUID()}.db`);
process.env.PULSEID_DB_PATH = TEST_DB_PATH;

let getDb: typeof import("../lib/db").getDb;
let createClinicalSchema: typeof import("./helpers/schema").createClinicalSchema;
let updatePatient: typeof import("../lib/repo").updatePatient;
let findPatientById: typeof import("../lib/repo").findPatientById;
let logAudit: typeof import("../lib/repo").logAudit;
let getAuditLog: typeof import("../lib/repo").getAuditLog;

const PATIENT_ID = randomUUID();
const OTHER_PATIENT_ID = randomUUID();

function seedPatient(id: string, name: string, nationalId: string) {
  getDb()
    .prepare(
      `INSERT INTO patients (id, national_id, id_type, full_name, date_of_birth, gender, phone_number, emergency_qr_token)
       VALUES (?, ?, 'cnic', ?, '1990-01-01', 'male', '+92 300 0000000', ?)`
    )
    .run(id, nationalId, name, `tok-${id}`);
}

beforeAll(async () => {
  ({ getDb } = await import("../lib/db"));
  ({ createClinicalSchema } = await import("./helpers/schema"));
  ({
    updatePatient,
    findPatientById,
    logAudit,
    getAuditLog,
  } = await import("../lib/repo"));
  createClinicalSchema(getDb());
  seedPatient(PATIENT_ID, "Original Name", "41000-1212121-1");
  seedPatient(OTHER_PATIENT_ID, "Other Patient", "41000-1313131-3");
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

const fullEdit = {
  fullName: "Edited Name",
  dateOfBirth: "1991-06-15",
  gender: "female",
  phoneNumber: "+92 301 7654321",
  email: "edited@test.dev",
  address: "12 Test Road, Lahore",
  bloodGroup: "O+",
  allergies: "Sulfa drugs",
  chronicConditions: "Asthma",
  weightKg: 62.5,
  pediatricianName: null,
  pediatricianPhone: null,
};

describe("patient demographics update (repo.updatePatient)", () => {
  it("updates every editable field and returns the fresh row", () => {
    const updated = updatePatient(PATIENT_ID, fullEdit);
    expect(updated).toBeDefined();
    expect(updated!.full_name).toBe("Edited Name");
    expect(updated!.date_of_birth).toBe("1991-06-15");
    expect(updated!.gender).toBe("female");
    expect(updated!.phone_number).toBe("+92 301 7654321");
    expect(updated!.email).toBe("edited@test.dev");
    expect(updated!.address).toBe("12 Test Road, Lahore");
    expect(updated!.blood_group).toBe("O+");
    expect(updated!.allergies).toBe("Sulfa drugs");
    expect(updated!.chronic_conditions).toBe("Asthma");
    expect(updated!.weight_kg).toBe(62.5);
  });

  it("treats blank optional fields as null, not empty strings", () => {
    const updated = updatePatient(PATIENT_ID, { ...fullEdit, email: "", address: "", allergies: "" });
    expect(updated!.email).toBeNull();
    expect(updated!.address).toBeNull();
    expect(updated!.allergies).toBeNull();
    expect(updatePatient(PATIENT_ID, { ...fullEdit, weightKg: undefined })!.weight_kg).toBeNull();
  });

  it("returns undefined for an unknown patient", () => {
    expect(updatePatient(randomUUID(), fullEdit)).toBeUndefined();
  });

  it("is scoped to the targeted patient only", () => {
    updatePatient(PATIENT_ID, fullEdit);
    expect(findPatientById(OTHER_PATIENT_ID)!.full_name).toBe("Other Patient");
  });
});

describe("audit trail (repo.logAudit / getAuditLog)", () => {
  it("stores entries and reads them newest-first, scoped to the patient", async () => {
    logAudit({ patientId: PATIENT_ID, actorRole: "doctor", actorName: "Dr. A", actorId: "doc-1", action: "record_viewed", details: "first" });
    // created_at has 1-second granularity — space the rows so newest-first is observable.
    await new Promise((r) => setTimeout(r, 1100));
    logAudit({ patientId: PATIENT_ID, actorRole: "doctor", actorName: "Dr. B", action: "patient_details_edited" });
    logAudit({ patientId: OTHER_PATIENT_ID, actorRole: "doctor", actorName: "Dr. C", action: "record_viewed" });

    const feed = getAuditLog(PATIENT_ID);
    expect(feed).toHaveLength(2);
    expect(feed[0].actor_name).toBe("Dr. B"); // newest first
    expect(feed[1].details).toBe("first");
    // actor_id is optional — absent stays NULL, present is stored
    expect(feed[0].actor_id).toBeNull();
    expect(feed[1].actor_id).toBe("doc-1");
    expect(getAuditLog(OTHER_PATIENT_ID)).toHaveLength(1);
  });

  it("returns an empty trail for a patient with no activity", () => {
    expect(getAuditLog(randomUUID())).toEqual([]);
  });
});
