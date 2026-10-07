// Node-side RAG client. The entire RAG pipeline — chunk text building, PDF
// text extraction, embeddings, the vector index, keyword fallback, and Groq
// generation — now lives in the Python service at backend/rag/ (FastAPI,
// see its README). This module is deliberately thin: it gathers data the
// server already has (repo lookups + uploaded files), posts it to the RAG
// service, and maps the service's error contracts onto the ones server.ts
// has always handled.
//
// Trust boundaries, unchanged from when the pipeline lived here:
//  - Retrieval is always scoped by patient_id on the service side, and the
//    service only ever sees records this module explicitly sends for that
//    one patient (or one pending registration).
//  - The drafted report is a convenience, never a decision: the doctor
//    reviews and approves the editable draft before anything is saved or
//    sent (the finalize route is the human gate).
//  - Every ingest here is fire-and-forget at the call sites: a RAG service
//    outage degrades the AI drafter, never the clinical flow.
import fs from "fs";
import path from "path";
import {
  findMedicalRecordById,
  findPatientById,
  findRegistrationById,
  getEmergencyContacts,
  getMedicalRecords,
  getRegistrationAttachments,
  listAttachmentsForPatient,
  listPrescriptionsForRecord,
} from "./repo";

// 127.0.0.1, not localhost — localhost can resolve to ::1 first and miss a
// service bound to IPv4 only.
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || "http://127.0.0.1:8100";
const RAG_SERVICE_TOKEN = process.env.RAG_SERVICE_TOKEN || "";
const RAG_TIMEOUT_MS = Number(process.env.RAG_TIMEOUT_MS || 120_000);

export type RagDoc = { label: string; content: string };
export type RagSourceType = "profile" | "visit" | "attachment";

// Retrieval top-k default — mirrored by the service's own RAG_MAX_CHUNKS.
export const RAG_MAX_CHUNKS = 5;

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(RAG_SERVICE_TOKEN ? { "x-rag-token": RAG_SERVICE_TOKEN } : {}),
  };
}

async function ragFetch(route: string, init: RequestInit): Promise<Response> {
  return fetch(`${RAG_SERVICE_URL}${route}`, {
    ...init,
    headers: { ...headers(), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(RAG_TIMEOUT_MS),
  });
}

async function postJson(route: string, body: unknown): Promise<Response> {
  return ragFetch(route, { method: "POST", body: JSON.stringify(body) });
}

function fail(message: string, err: unknown): never {
  console.error(`[pulseid-backend] RAG service call failed (${message}):`, err);
  throw new Error(`RAG_SERVICE_UNREACHABLE: ${message}`);
}

// The RAG feature is opt-in per deployment: set RAG_SERVICE_ENABLED=1 (and
// optionally RAG_SERVICE_URL) once the Python service is running. Until then
// every client call is a no-op and the AI drafter answers 503 — exactly as a
// missing Groq key used to behave, with no log spam from dead services.
export function isReportDrafterConfigured(): boolean {
  return ragEnabled();
}

function ragEnabled(): boolean {
  return process.env.RAG_SERVICE_ENABLED === "1" || Boolean(process.env.RAG_SERVICE_URL);
}

// ---------------------------------------------------------------------------
// Ingest. Each source is idempotent on the service side (replace-by-source),
// so pushing the same source twice — booking POST, lazy self-heal, retry —
// converges instead of duplicating.
// ---------------------------------------------------------------------------

function uploadDir(): string {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), "data", "uploads");
}

function readPdfB64(storedName: string): string | null {
  const file = path.join(uploadDir(), storedName);
  try {
    return fs.readFileSync(file).toString("base64");
  } catch {
    return null;
  }
}

export async function indexRegistration(registrationId: string): Promise<void> {
  if (!ragEnabled()) return;
  const reg = findRegistrationById(registrationId);
  if (!reg) return;

  const contacts = (() => {
    try {
      const parsed = reg.contacts ? JSON.parse(reg.contacts) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const res = await postJson("/index/profile", {
    scope: "registration",
    scopeId: registrationId,
    sourceId: registrationId,
    fullName: reg.full_name,
    dateOfBirth: reg.date_of_birth,
    gender: reg.gender,
    bloodGroup: reg.blood_group,
    allergies: reg.allergies,
    chronicConditions: reg.chronic_conditions,
    weightKg: reg.weight_kg,
    phoneNumber: reg.phone_number,
    contacts,
  }).catch((err) => fail("indexRegistration(profile)", err));
  if (!res.ok) fail("indexRegistration(profile)", await res.text());

  // Booking-time attachments: only text PDFs are indexable (no OCR in this
  // build — a documented limitation, enforced again on the service side).
  for (const attachment of getRegistrationAttachments(registrationId)) {
    if (attachment.mime_type !== "application/pdf") continue;
    const contentB64 = readPdfB64(attachment.stored_name);
    if (!contentB64) continue;
    const res2 = await postJson("/index/attachment", {
      registrationId,
      sourceId: attachment.id,
      filename: attachment.original_name,
      contentB64,
      mimeType: attachment.mime_type,
    }).catch((err) => fail("indexRegistration(attachment)", err));
    if (!res2.ok) fail("indexRegistration(attachment)", await res2.text());
  }
}

export async function indexPatientVisit(patientId: string, recordId: string): Promise<void> {
  if (!ragEnabled()) return;
  const record = findMedicalRecordById(recordId);
  if (!record || record.patient_id !== patientId) return;
  const res = await postJson("/index/visit", {
    patientId,
    sourceId: recordId,
    visitDate: record.visit_date,
    recordType: record.record_type,
    diagnosis: record.diagnosis,
    symptoms: record.symptoms,
    notes: record.notes,
    systolicBp: record.systolic_bp,
    diastolicBp: record.diastolic_bp,
    bloodSugarMmol: record.blood_sugar_mmol,
    bodyTempC: record.body_temp_c,
    heartRateBpm: record.heart_rate_bpm,
    prescriptions: listPrescriptionsForRecord(recordId).map((rx) => ({
      medications: rx.medications,
      instructions: rx.instructions,
    })),
  }).catch((err) => fail("indexPatientVisit", err));
  if (!res.ok) fail("indexPatientVisit", await res.text());
}

// Lazy self-healing index: ask the service which sources it already has for
// this patient, then push anything missing — a patient whose records predate
// the feature is caught up on first ask, and anything written while the
// service was down is indexed as soon as it's back.
export async function ensurePatientIndexed(patientId: string): Promise<void> {
  if (!ragEnabled()) return;
  const patient = findPatientById(patientId);
  if (!patient) return;

  let have = new Set<string>();
  try {
    const res = await ragFetch(`/sources/${patientId}`, { method: "GET" });
    if (res.ok) {
      const body = (await res.json()) as { sources: { sourceType: string; sourceId: string }[] };
      have = new Set(body.sources.map((s) => `${s.sourceType}:${s.sourceId}`));
    }
  } catch {
    // Service unreachable — skip the catch-up quietly; retrieval below will
    // surface its own (mapped) error.
    return;
  }
  const missing = (type: RagSourceType, id: string) => !have.has(`${type}:${id}`);

  if (missing("profile", patientId)) {
    const res = await postJson("/index/profile", {
      scope: "patient",
      scopeId: patientId,
      sourceId: patientId,
      fullName: patient.full_name,
      dateOfBirth: patient.date_of_birth,
      gender: patient.gender,
      bloodGroup: patient.blood_group,
      allergies: patient.allergies,
      chronicConditions: patient.chronic_conditions,
      weightKg: patient.weight_kg,
      phoneNumber: patient.phone_number,
      contacts: getEmergencyContacts(patientId).map((c) => ({
        fullName: c.full_name,
        relationshipType: c.relationship_type,
        phoneNumber: c.phone_number,
      })),
    }).catch((err) => fail("ensurePatientIndexed(profile)", err));
    if (!res.ok) fail("ensurePatientIndexed(profile)", await res.text());
  }

  for (const record of getMedicalRecords(patientId)) {
    if (missing("visit", record.id)) await indexPatientVisit(patientId, record.id);
  }

  for (const attachment of listAttachmentsForPatient(patientId)) {
    if (missing("attachment", attachment.id)) {
      if (attachment.mime_type !== "application/pdf") continue;
      const contentB64 = readPdfB64(attachment.stored_name);
      if (!contentB64) continue;
      const res = await postJson("/index/attachment", {
        patientId,
        sourceId: attachment.id,
        filename: attachment.original_name,
        contentB64,
        mimeType: attachment.mime_type,
      }).catch((err) => fail("ensurePatientIndexed(attachment)", err));
      if (!res.ok) fail("ensurePatientIndexed(attachment)", await res.text());
    }
  }
}

// ---------------------------------------------------------------------------
// Retrieval + drafting. Error contracts preserved: RAG_DRAFT_INCOMPLETE maps
// from the service's 502 so the UI's "try again, it usually succeeds on
// retry" messaging still works; an unconfigured deployment still refuses
// before any network call.
// ---------------------------------------------------------------------------

export async function retrievePatientContext(
  patientId: string,
  query: string,
  k?: number
): Promise<{ docs: RagDoc[]; mode: "vector" | "keyword" }> {
  if (!ragEnabled()) return { docs: [], mode: "keyword" };
  await ensurePatientIndexed(patientId);
  const res = await postJson("/retrieve", { patientId, query, k }).catch((err) =>
    fail("retrievePatientContext", err)
  );
  if (!res.ok) fail("retrievePatientContext", `${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    mode: "vector" | "keyword";
    chunks: { label: string; content: string }[];
  };
  return { docs: body.chunks.map((c) => ({ label: c.label, content: c.content })), mode: body.mode };
}

export async function draftPatientReport(input: {
  patientName: string;
  visitDate: string;
  keywords: string;
  docs: RagDoc[];
}): Promise<Record<string, unknown>> {
  if (!isReportDrafterConfigured()) {
    throw new Error("RAG_DRAFTER_NOT_CONFIGURED");
  }
  const res = await postJson("/draft", {
    patientName: input.patientName,
    visitDate: input.visitDate,
    keywords: input.keywords,
    docs: input.docs,
  }).catch((err) => fail("draftPatientReport", err));
  if (res.status === 502) throw new Error("RAG_DRAFT_INCOMPLETE");
  if (res.status === 503) throw new Error("RAG_DRAFTER_NOT_CONFIGURED");
  if (!res.ok) fail("draftPatientReport", `${res.status} ${await res.text()}`);
  const body = (await res.json()) as { draft: Record<string, unknown> };
  return body.draft;
}

// Lifecycle hooks mirroring what used to be repo.ts SQL: the booking approval
// re-parent and the booking-rejection purge. Both are best-effort — the
// clinical transaction has already committed by the time these run.

export async function reparentRagIndex(registrationId: string, patientId: string): Promise<void> {
  if (!ragEnabled()) return;
  const res = await postJson("/reparent", { registrationId, patientId }).catch((err) =>
    fail("reparentRagIndex", err)
  );
  if (!res.ok) fail("reparentRagIndex", await res.text());
}

export async function deleteRagSource(sourceType: RagSourceType, sourceId: string): Promise<void> {
  if (!ragEnabled()) return;
  const res = await ragFetch(`/sources/${sourceType}/${sourceId}`, { method: "DELETE" }).catch(
    (err) => fail("deleteRagSource", err)
  );
  if (!res.ok) fail("deleteRagSource", await res.text());
}
