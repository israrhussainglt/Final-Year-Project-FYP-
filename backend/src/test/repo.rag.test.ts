// Covers the SQLite side of the RAG report flow (lib/rag.ts is the retrieval
// and drafting logic; the embedding model itself is exercised by the live
// demo, not unit tests — no network or model download here):
//   - vector packing/cosine math (pure functions),
//   - chunk text builders (pure functions),
//   - chunk persistence + FTS mirror + patient scoping,
//   - the keyword fallback path that serves chunks with NULL embeddings,
//   - attachment promotion + chunk re-parenting at approval time,
//   - the in-app notification feed with ownership-scoped read marking.
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
let cosineSimilarity: typeof import("../lib/rag").cosineSimilarity;
let packVector: typeof import("../lib/rag").packVector;
let unpackVector: typeof import("../lib/rag").unpackVector;
let buildProfileChunkText: typeof import("../lib/rag").buildProfileChunkText;
let buildVisitChunkText: typeof import("../lib/rag").buildVisitChunkText;
let insertRagChunk: typeof import("../lib/repo").insertRagChunk;
let deleteRagChunksForSource: typeof import("../lib/repo").deleteRagChunksForSource;
let countRagChunksForSource: typeof import("../lib/repo").countRagChunksForSource;
let listRagChunksForPatient: typeof import("../lib/repo").listRagChunksForPatient;
let searchRagChunksFtsForPatient: typeof import("../lib/repo").searchRagChunksFtsForPatient;
let listAttachmentsForPatient: typeof import("../lib/repo").listAttachmentsForPatient;
let approvePatientRegistration: typeof import("../lib/repo").approvePatientRegistration;
let createPatientRegistration: typeof import("../lib/repo").createPatientRegistration;
let createRegistrationAttachment: typeof import("../lib/repo").createRegistrationAttachment;
let createNotification: typeof import("../lib/repo").createNotification;
let listNotificationsForPatient: typeof import("../lib/repo").listNotificationsForPatient;
let countUnreadNotificationsForPatient: typeof import("../lib/repo").countUnreadNotificationsForPatient;
let markNotificationRead: typeof import("../lib/repo").markNotificationRead;
let markAllNotificationsRead: typeof import("../lib/repo").markAllNotificationsRead;
let createClinicalSchema: typeof import("./helpers/schema").createClinicalSchema;

function createSchema() {
  createClinicalSchema(getDb());
}

const DOCTOR_ID = randomUUID();
const PATIENT_A = randomUUID();
const PATIENT_B = randomUUID();

function fakeVector(seed: number): Buffer {
  // 384-dim unit vector pointing mostly at one axis — distinct per seed.
  const v = new Array(384).fill(0.001);
  v[seed % 384] = 1;
  return packVector(v);
}

function chunk(input: Partial<Parameters<typeof insertRagChunk>[0]> = {}) {
  return insertRagChunk({
    id: randomUUID(),
    patientId: PATIENT_A,
    registrationId: null,
    sourceType: "visit",
    sourceId: randomUUID(),
    chunkIndex: 0,
    label: "Visit 2026-01-01",
    content: "Visit on 2026-01-01. Diagnosis: Type 2 Diabetes.",
    embedding: fakeVector(1),
    embeddingModel: "test-model",
    ...input,
  });
}

beforeAll(async () => {
  ({ getDb } = await import("../lib/db"));
  ({ createClinicalSchema } = await import("./helpers/schema"));
  ({
    insertRagChunk,
    deleteRagChunksForSource,
    countRagChunksForSource,
    listRagChunksForPatient,
    searchRagChunksFtsForPatient,
    listAttachmentsForPatient,
    approvePatientRegistration,
    createPatientRegistration,
    createRegistrationAttachment,
    createNotification,
    listNotificationsForPatient,
    countUnreadNotificationsForPatient,
    markNotificationRead,
    markAllNotificationsRead,
  } = await import("../lib/repo"));
  ({ cosineSimilarity, packVector, unpackVector, buildProfileChunkText, buildVisitChunkText } = await import(
    "../lib/rag"
  ));
  createSchema();

  const db = getDb();
  db.prepare(
    "INSERT INTO doctors (id, full_name, email, password_hash, license_number, is_active) VALUES (?, ?, ?, ?, ?, 1)"
  ).run(DOCTOR_ID, "Dr. RAG Test", "rag@test.dev", "x", "L-RAG");
  for (const [id, name, token] of [
    [PATIENT_A, "Patient A", "tok-a"],
    [PATIENT_B, "Patient B", "tok-b"],
  ] as const) {
    db.prepare(
      `INSERT INTO patients (id, national_id, id_type, full_name, date_of_birth, gender, phone_number, emergency_qr_token)
       VALUES (?, ?, 'cnic', ?, '1990-01-01', 'male', '+92 300 0000000', ?)`
    ).run(id, `41000-${name === "Patient A" ? "1111111" : "2222222"}-1`, name, token);
  }
});

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM rag_chunks; DELETE FROM notifications; DELETE FROM registration_attachments;");
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
});

describe("vector math (pure)", () => {
  it("packs and unpacks a vector losslessly", () => {
    const v = [0.1, -0.2, 0.3, 0.4];
    const out = unpackVector(packVector(v)).slice(0, 4);
    // Float32 storage quantises values slightly — closeness is the contract.
    expect(out.map((x) => Math.abs(x))).toEqual(v.map((x) => expect.closeTo(Math.abs(x), 6)));
  });

  it("ranks identical vectors above orthogonal ones", () => {
    const a = [1, 0, 0];
    const identical = [1, 0, 0];
    const orthogonal = [0, 1, 0];
    expect(cosineSimilarity(a, identical)).toBeCloseTo(1);
    expect(cosineSimilarity(a, orthogonal)).toBeCloseTo(0);
  });

  it("returns 0 for zero-norm vectors instead of NaN", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("chunk text builders (pure)", () => {
  it("profile chunk carries personal details and contacts", () => {
    const text = buildProfileChunkText(
      {
        full_name: "Hassan Tariq",
        date_of_birth: "1990-04-01",
        gender: "male",
        blood_group: "O+",
        allergies: "Penicillin",
        chronic_conditions: "Type 2 Diabetes",
        weight_kg: 80,
        phone_number: "+92 300 1234567",
      },
      [{ fullName: "Amma", relationshipType: "Parent", phoneNumber: "0301-1" }]
    );
    expect(text).toContain("Hassan Tariq");
    expect(text).toContain("Penicillin");
    expect(text).toContain("Amma (Parent, 0301-1)");
  });

  it("visit chunk includes vitals and labelled prescriptions, tolerating malformed rx JSON", () => {
    const text = buildVisitChunkText(
      {
        visit_date: "2026-05-02",
        record_type: "checkup",
        diagnosis: "Hypertension",
        symptoms: "Headache",
        notes: "BP recheck",
        systolic_bp: 165,
        diastolic_bp: 112,
        blood_sugar_mmol: null,
        body_temp_c: null,
        heart_rate_bpm: 90,
      },
      [
        { medications: JSON.stringify([{ name: "Amlodipine", dosage: "5 mg", frequency: "once daily", duration: "30 days" }]), instructions: "after food" },
        { medications: "{not json", instructions: null },
      ]
    );
    expect(text).toContain("165/112 mmHg");
    expect(text).toContain("Prescribed: Amlodipine 5 mg once daily for 30 days.");
    expect(text).toContain("after food");
  });
});

describe("chunk persistence + scoping", () => {
  it("persists chunks and mirrors them into FTS", () => {
    const c = chunk({ content: "Visit on 2026-02-02. Diagnosis: Dengue Fever." });
    expect(countRagChunksForSource("visit", c.source_id)).toBe(1);
    const hits = searchRagChunksFtsForPatient(PATIENT_A, "dengue");
    expect(hits.map((h) => h.id)).toContain(c.id);
  });

  it("keeps chunks patient-scoped — registration-scoped and other-patient chunks never leak", async () => {
    const patientOwned = chunk({});
    // A real registration row: the FK on rag_chunks.registration_id must hold.
    const reg = createPatientRegistration({
      nationalId: "42401-9999999-2",
      fullName: "Scope Test",
      dateOfBirth: "1995-06-15",
      gender: "female",
      phoneNumber: "+92 300 4444444",
      bloodGroup: "O+",
      doctorId: DOCTOR_ID,
    });
    const registrationOnly = chunk({ patientId: null, registrationId: reg.id, content: "registration-scoped chunk" });
    const otherPatient = chunk({ patientId: PATIENT_B, content: "Patient B visit chunk" });

    const forA = listRagChunksForPatient(PATIENT_A);
    expect(forA.map((c) => c.id)).toContain(patientOwned.id);
    expect(forA.map((c) => c.id)).not.toContain(registrationOnly.id);
    expect(forA.map((c) => c.id)).not.toContain(otherPatient.id);
  });

  it("keyword fallback respects patient scope and survives malformed queries", () => {
    chunk({ content: "Persistent cough for three weeks, worse at night." });
    chunk({ patientId: PATIENT_B, content: "Persistent cough for Patient B." });

    const hits = searchRagChunksFtsForPatient(PATIENT_A, "persistent cough");
    expect(hits).toHaveLength(1);
    expect(hits[0].patient_id).toBe(PATIENT_A);

    // A syntactically hostile query must return empty, never throw.
    expect(searchRagChunksFtsForPatient(PATIENT_A, '" OR 1=1 --')).toEqual([]);
  });

  it("deleting a source removes its rows and its FTS mirror", () => {
    const c = chunk({ content: "Temporarily indexed visit." });
    deleteRagChunksForSource("visit", c.source_id);
    expect(countRagChunksForSource("visit", c.source_id)).toBe(0);
    expect(searchRagChunksFtsForPatient(PATIENT_A, "Temporarily indexed")).toEqual([]);
  });
});

describe("approval re-parents booking-time chunks and attachments", () => {
  it("chunks indexed against a registration move to the patient on approval", async () => {
    const reg = createPatientRegistration({
      nationalId: "42501-7654321-4",
      fullName: "Chunk Reparent",
      dateOfBirth: "1995-06-15",
      gender: "female",
      phoneNumber: "+92 300 5555555",
      bloodGroup: "O+",
      doctorId: DOCTOR_ID,
    });
    const attachment = createRegistrationAttachment({
      registrationId: reg.id,
      storedName: "lab.pdf",
      originalName: "lab.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
    });
    const regChunk = chunk({ patientId: null, registrationId: reg.id, content: "booking profile chunk" });

    const { patientId } = approvePatientRegistration({
      registrationId: reg.id,
      doctorId: DOCTOR_ID,
      doctorName: "Dr. RAG Test",
      scheduledAtIso: new Date(Date.now() + 3600 * 1000).toISOString(),
    });

    const forPatient = listRagChunksForPatient(patientId);
    expect(forPatient.map((c) => c.id)).toContain(regChunk.id);

    const promoted = listAttachmentsForPatient(patientId);
    expect(promoted.map((a) => a.id)).toContain(attachment.id);
  });
});

describe("in-app notifications", () => {
  it("lists newest-first with an unread count", () => {
    createNotification({ patientId: PATIENT_A, type: "report", title: "First", body: "b" });
    createNotification({ patientId: PATIENT_A, type: "report", title: "Second", body: "b" });
    createNotification({ patientId: PATIENT_B, type: "system", title: "Other patient", body: "b" });

    const feed = listNotificationsForPatient(PATIENT_A);
    expect(feed).toHaveLength(2);
    expect(feed[0].title).toBe("Second");
    expect(countUnreadNotificationsForPatient(PATIENT_A)).toBe(2);
  });

  it("marks one — ownership-scoped — or all as read", () => {
    const n = createNotification({ patientId: PATIENT_A, type: "report", title: "Report ready", body: "b" });
    createNotification({ patientId: PATIENT_A, type: "report", title: "Another", body: "b" });

    // Patient B cannot mark A's notification.
    expect(markNotificationRead(n.id, PATIENT_B)).toBe(false);
    expect(countUnreadNotificationsForPatient(PATIENT_A)).toBe(2);

    expect(markNotificationRead(n.id, PATIENT_A)).toBe(true);
    expect(countUnreadNotificationsForPatient(PATIENT_A)).toBe(1);

    markAllNotificationsRead(PATIENT_A);
    expect(countUnreadNotificationsForPatient(PATIENT_A)).toBe(0);
  });
});
