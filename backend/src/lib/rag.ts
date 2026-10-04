// LangChain-powered RAG over one patient's record — the doctor-side AI
// report drafter. Pipeline: patient history + uploaded report PDFs are
// chunked and embedded locally (all-MiniLM-L6-v2, downloaded once into
// data/models) at booking/visit time, persisted as BLOBs in rag_chunks
// (SQLite is the only vector store — brute-force cosine is correct and
// instant at this corpus size), and retrieved per question through a
// LangChain VectorStore + retriever. Generation runs on Groq (OpenAI-
// compatible API via ChatOpenAI) with a structured-output schema, which is
// what keeps every prescription correctly labelled instead of buried in
// prose.
//
// Trust boundaries, in the same spirit as lib/ai.ts:
//  - Retrieval is ALWAYS filtered by patient_id at the SQL layer before any
//    text leaves this module. There is no code path where another patient's
//    chunk can enter a prompt.
//  - The drafted report is a convenience, never a decision: the doctor
//    reviews and approves the editable draft before anything is saved or
//    sent (see the finalize route), and the schema output is a draft, not
//    an authoritative clinical statement.
//  - Embedding model failure never breaks retrieval: chunks persist with
//    NULL embeddings and a FTS5 keyword fallback serves them instead.
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import { Document } from "@langchain/core/documents";
import { Embeddings } from "@langchain/core/embeddings";
import { VectorStore } from "@langchain/core/vectorstores";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { z } from "zod";
import {
  countRagChunksForSource,
  findMedicalRecordById,
  findPatientById,
  findRegistrationById,
  getEmergencyContacts,
  getMedicalRecords,
  getRegistrationAttachments,
  insertRagChunk,
  listAttachmentsForPatient,
  listPrescriptionsForRecord,
  listRagChunksForPatient,
  searchRagChunksFtsForPatient,
  setRagChunkEmbedding,
} from "./repo";
import type { RagChunk } from "./types";

const MODELS_DIR = path.join(process.cwd(), "data", "models");
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

const EMBEDDING_MODEL_ID = process.env.RAG_EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";
export const RAG_MAX_CHUNKS = 5;
export { EMBEDDING_MODEL_ID };

// Generation runs on Groq (https://console.groq.com) — OpenAI-compatible
// wire protocol, so ChatOpenAI pointed at api.groq.com is the whole
// integration. Read at call time so a key added after startup still works
// in dev.
export function isReportDrafterConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

function groqApiKey(): string | undefined {
  return process.env.GROQ_API_KEY;
}

function groqModel(): string {
  return process.env.GROQ_MODEL || "openai/gpt-oss-120b";
}

// ---------------------------------------------------------------------------
// Local embeddings, wrapped as a LangChain Embeddings implementation so the
// whole pipeline (store, retriever) stays framework-native. The model
// downloads once into data/models and is reused forever after.
// ---------------------------------------------------------------------------

type ExtractorFn = (
  texts: string[],
  options: Record<string, unknown>
) => Promise<{ tolist: () => number[][] }>;

class MiniLMEmbeddings extends Embeddings {
  private extractor: ExtractorFn | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    super({});
  }

  private async getExtractor(): Promise<ExtractorFn> {
    if (!this.extractor) {
      this.initPromise ??= (async () => {
        const { pipeline, env } = await import("@huggingface/transformers");
        env.cacheDir = MODELS_DIR;
        this.extractor = (await pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
          dtype: "q8",
        })) as unknown as ExtractorFn;
      })();
      await this.initPromise;
    }
    const extractor = this.extractor;
    if (!extractor) throw new Error("Embedding pipeline failed to initialise.");
    return extractor;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const extractor = await this.getExtractor();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  }

  async embedQuery(text: string): Promise<number[]> {
    return (await this.embedDocuments([text]))[0];
  }
}

let embeddingsInstance: MiniLMEmbeddings | null = null;
let embeddingsState: "uninitialized" | "ready" | "unavailable" = "uninitialized";
let embeddingsInit: Promise<boolean> | null = null;

// One shared instance — the model and its download cache live for the process.
function getEmbeddings(): MiniLMEmbeddings {
  embeddingsInstance ??= new MiniLMEmbeddings();
  return embeddingsInstance;
}

export function embeddingsReady(): boolean {
  return embeddingsState === "ready";
}

// Returns true when the local model is usable. Never throws: any failure
// (no network on first download, corrupt cache, unsupported runtime) flips
// the state to "unavailable" and retrieval falls back to FTS5 keywords.
export async function ensureEmbeddingsReady(): Promise<boolean> {
  if (embeddingsState === "ready") return true;
  if (embeddingsState === "unavailable") return false;
  embeddingsInit ??= (async () => {
    try {
      await getEmbeddings().embedQuery("health check");
      embeddingsState = "ready";
      return true;
    } catch (err) {
      console.error("[pulseid-backend] Local embedding model unavailable — falling back to keyword search:", err);
      embeddingsState = "unavailable";
      return false;
    }
  })();
  return embeddingsInit;
}

// ---------------------------------------------------------------------------
// Chunk text builders (pure — unit-tested). Everything a doctor could ask
// about a patient goes in as plain, labelled text.
// ---------------------------------------------------------------------------

function yearsBetween(dateOfBirth: string, atDate = new Date()): number {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return 0;
  let age = atDate.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    atDate.getMonth() < dob.getMonth() ||
    (atDate.getMonth() === dob.getMonth() && atDate.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function buildProfileChunkText(
  patient: {
    full_name: string;
    date_of_birth: string;
    gender: string;
    blood_group: string | null;
    allergies: string | null;
    chronic_conditions: string | null;
    weight_kg: number | null;
    phone_number: string;
  },
  contacts: { fullName?: string; relationshipType?: string; phoneNumber?: string }[]
): string {
  return [
    `Patient profile (personal details).`,
    `Name: ${patient.full_name}.`,
    `Date of birth: ${patient.date_of_birth} (age ${yearsBetween(patient.date_of_birth)}).`,
    `Gender: ${patient.gender}.`,
    `Blood group: ${patient.blood_group || "unknown"}.`,
    `Known allergies: ${patient.allergies || "none recorded"}.`,
    `Chronic conditions: ${patient.chronic_conditions || "none recorded"}.`,
    patient.weight_kg ? `Weight: ${patient.weight_kg} kg.` : `Weight: not recorded.`,
    `Contact: ${patient.phone_number}.`,
    contacts.length
      ? `Emergency contacts: ${contacts
          .map((c) => `${c.fullName ?? "?"} (${c.relationshipType ?? "?"}, ${c.phoneNumber ?? "?"})`)
          .join("; ")}.`
      : `Emergency contacts: none on file.`,
  ].join(" ");
}

export function buildVisitChunkText(
  record: {
    visit_date: string;
    record_type: string;
    diagnosis: string | null;
    symptoms: string | null;
    notes: string | null;
    systolic_bp: number | null;
    diastolic_bp: number | null;
    blood_sugar_mmol: number | null;
    body_temp_c: number | null;
    heart_rate_bpm: number | null;
  },
  prescriptions: { medications: string; instructions: string | null }[]
): string {
  const parts = [
    `Visit on ${record.visit_date} (${record.record_type.replace(/_/g, " ")}).`,
    `Diagnosis: ${record.diagnosis || "not recorded"}.`,
    `Symptoms: ${record.symptoms || "not recorded"}.`,
    record.systolic_bp && record.diastolic_bp
      ? `Blood pressure: ${record.systolic_bp}/${record.diastolic_bp} mmHg.`
      : null,
    record.blood_sugar_mmol != null ? `Blood sugar: ${record.blood_sugar_mmol} mmol/L.` : null,
    record.body_temp_c != null ? `Temperature: ${record.body_temp_c} °C.` : null,
    record.heart_rate_bpm != null ? `Heart rate: ${record.heart_rate_bpm} bpm.` : null,
    `Notes: ${record.notes || "none"}.`,
  ].filter((p): p is string => p !== null);
  for (const rx of prescriptions) {
    try {
      const meds = JSON.parse(rx.medications) as {
        name?: string;
        dosage?: string;
        frequency?: string;
        duration?: string;
      }[];
      for (const m of meds) {
        parts.push(
          `Prescribed: ${m.name || "unnamed medication"} ${m.dosage || ""} ${m.frequency || ""}${
            m.duration ? ` for ${m.duration}` : ""
          }.`.replace(/\s+/g, " ")
        );
      }
    } catch {
      /* prescription JSON is malformed — skip rather than poison the chunk */
    }
    if (rx.instructions) parts.push(`Prescription instructions: ${rx.instructions}`);
  }
  return parts.join(" ");
}

async function chunkPdfText(text: string): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1200, chunkOverlap: 150 });
  return splitter.splitText(text);
}

// ---------------------------------------------------------------------------
// Persistence-backed LangChain vector store, scoped to exactly one patient.
// Vectors live as BLOBs in rag_chunks; this store loads them into memory for
// the duration of one retrieval (brute-force cosine — the corpus per patient
// is hundreds of chunks at most, so an ANN index would be ceremony, not
// engineering).
// ---------------------------------------------------------------------------

export function packVector(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

export function unpackVector(blob: Buffer): number[] {
  return Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class PatientVectorStore extends VectorStore {
  private chunks: RagChunk[];

  constructor(chunks: RagChunk[]) {
    super(getEmbeddings(), {});
    this.chunks = chunks.filter((c) => c.embedding !== null);
  }

  _vectorstoreType(): string {
    return "sqlite";
  }

  hasVectors(): boolean {
    return this.chunks.length > 0;
  }

  // Index-time path is intentionally closed: chunk rows are written through
  // repo.insertRagChunk (which also mirrors the FTS table), never through
  // the store — so the two indexes can never drift apart.
  async addVectors(): Promise<void> {
    throw new Error("Chunk rows are written through repo.insertRagChunk, not the store.");
  }

  async addDocuments(): Promise<void> {
    throw new Error("Chunk rows are written through repo.insertRagChunk, not the store.");
  }

  async similaritySearchVectorWithScore(
    query: number[],
    k: number
  ): Promise<[Document, number][]> {
    return this.chunks
      .map((c) => ({
        chunk: c,
        score: cosineSimilarity(query, unpackVector(c.embedding as Buffer)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ chunk, score }) => [
        new Document({
          pageContent: chunk.content,
          metadata: {
            label: chunk.label,
            sourceType: chunk.source_type,
            sourceId: chunk.source_id,
            chunkId: chunk.id,
          },
        }),
        score,
      ]);
  }
}

// ---------------------------------------------------------------------------
// Indexing. Chunk rows always persist (content + label); the embedding BLOB
// attaches when the local model is available, and rows without embeddings
// are backfilled by retrievePatientContext on a later ask.
// ---------------------------------------------------------------------------

async function embedAndInsert(input: {
  patientId: string | null;
  registrationId: string | null;
  sourceType: RagChunk["source_type"];
  sourceId: string;
  label: string;
  texts: string[];
}): Promise<void> {
  const ready = await ensureEmbeddingsReady();
  let vectors: number[][] | null = null;
  if (ready) {
    try {
      vectors = await getEmbeddings().embedDocuments(input.texts);
    } catch (err) {
      console.error("[pulseid-backend] Chunk embedding failed (rows kept for FTS fallback):", err);
    }
  }
  input.texts.forEach((content, i) => {
    insertRagChunk({
      id: randomUUID(),
      patientId: input.patientId,
      registrationId: input.registrationId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      chunkIndex: i,
      label: input.texts.length > 1 ? `${input.label} (part ${i + 1})` : input.label,
      content,
      embedding: vectors ? packVector(vectors[i]) : null,
      embeddingModel: vectors ? EMBEDDING_MODEL_ID : null,
    });
  });
}

// Personal details + uploaded reports of a pending booking request. Runs
// right after the public booking POST (fire-and-forget) — chunks are keyed
// to the registration and re-parented to the patient at approval.
export async function indexRegistration(registrationId: string): Promise<void> {
  if (countRagChunksForSource("profile", registrationId) > 0) return;
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
  await embedAndInsert({
    patientId: null,
    registrationId,
    sourceType: "profile",
    sourceId: registrationId,
    label: "Patient profile (from booking request)",
    texts: [
      buildProfileChunkText(
        {
          full_name: reg.full_name,
          date_of_birth: reg.date_of_birth,
          gender: reg.gender,
          blood_group: reg.blood_group,
          allergies: reg.allergies,
          chronic_conditions: reg.chronic_conditions,
          weight_kg: reg.weight_kg,
          phone_number: reg.phone_number,
        },
        contacts
      ),
    ],
  });

  for (const attachment of getRegistrationAttachments(registrationId)) {
    await indexPdfAttachment({
      attachmentId: attachment.id,
      registrationId,
      patientId: null,
      storedName: attachment.stored_name,
      originalName: attachment.original_name,
      mimeType: attachment.mime_type,
    });
  }
}

async function indexPdfAttachment(input: {
  attachmentId: string;
  registrationId: string | null;
  patientId: string | null;
  storedName: string;
  originalName: string;
  mimeType: string;
}): Promise<void> {
  if (countRagChunksForSource("attachment", input.attachmentId) > 0) return;
  // Only text PDFs are indexable. Image uploads (PNG/JPEG/WebP) and scanned
  // image-only PDFs have no extractable text — no OCR in this build, a
  // documented limitation rather than a silent gap.
  if (input.mimeType !== "application/pdf") return;
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), "data", "uploads");
  const file = path.join(uploadDir, input.storedName);
  if (!fs.existsSync(file)) return;
  try {
    const loader = new PDFLoader(file, { splitPages: false });
    const docs = await loader.load();
    const text = docs.map((d) => d.pageContent).join("\n").trim();
    if (!text) return;
    const chunks = await chunkPdfText(text);
    await embedAndInsert({
      patientId: input.patientId,
      registrationId: input.registrationId,
      sourceType: "attachment",
      sourceId: input.attachmentId,
      label: `Report: ${input.originalName}`,
      texts: chunks,
    });
  } catch (err) {
    console.error(`[pulseid-backend] Could not index uploaded report ${input.originalName}:`, err);
  }
}

// One visit + its prescriptions, embedded as a single chunk.
export async function indexPatientVisit(patientId: string, recordId: string): Promise<void> {
  const record = findMedicalRecordById(recordId);
  if (!record || record.patient_id !== patientId) return;
  const prescriptions = listPrescriptionsForRecord(recordId);
  await embedAndInsert({
    patientId,
    registrationId: null,
    sourceType: "visit",
    sourceId: recordId,
    label: `Visit ${record.visit_date}`,
    texts: [buildVisitChunkText(record, prescriptions)],
  });
}

// Lazy self-healing index: profile, every visit, every promoted PDF. Called
// at retrieval time, so a patient whose records predate this feature is
// caught up on first ask, and anything written while the model was down is
// embedded as soon as it's back.
export async function ensurePatientIndexed(patientId: string): Promise<void> {
  const patient = findPatientById(patientId);
  if (!patient) return;

  if (countRagChunksForSource("profile", patientId) === 0) {
    await embedAndInsert({
      patientId,
      registrationId: null,
      sourceType: "profile",
      sourceId: patientId,
      label: "Patient profile",
      texts: [
        buildProfileChunkText(
          patient,
          getEmergencyContacts(patientId).map((c) => ({
            fullName: c.full_name,
            relationshipType: c.relationship_type,
            phoneNumber: c.phone_number,
          }))
        ),
      ],
    });
  }

  for (const record of getMedicalRecords(patientId)) {
    if (countRagChunksForSource("visit", record.id) === 0) {
      await indexPatientVisit(patientId, record.id);
    }
  }

  for (const attachment of listAttachmentsForPatient(patientId)) {
    await indexPdfAttachment({
      attachmentId: attachment.id,
      registrationId: null,
      patientId,
      storedName: attachment.stored_name,
      originalName: attachment.original_name,
      mimeType: attachment.mime_type,
    });
  }
}

// ---------------------------------------------------------------------------
// Retrieval. Load (and lazily complete) the patient's index, then retrieve.
// Falls back to FTS5 keyword search when the embedding model is unavailable
// — the answer degrades, the feature doesn't break.
// ---------------------------------------------------------------------------

export async function retrievePatientContext(
  patientId: string,
  query: string,
  k = RAG_MAX_CHUNKS
): Promise<{ docs: Document[]; mode: "vector" | "keyword" }> {
  await ensurePatientIndexed(patientId);
  const ready = await ensureEmbeddingsReady();

  if (ready) {
    const chunks = listRagChunksForPatient(patientId);
    const missing = chunks.filter((c) => c.embedding === null);
    if (missing.length > 0) {
      try {
        const vectors = await getEmbeddings().embedDocuments(missing.map((c) => c.content));
        vectors.forEach((v, i) => {
          setRagChunkEmbedding(missing[i].id, packVector(v), EMBEDDING_MODEL_ID);
          missing[i].embedding = packVector(v);
        });
      } catch (err) {
        console.error("[pulseid-backend] RAG embedding backfill failed:", err);
      }
    }
    const store = new PatientVectorStore(listRagChunksForPatient(patientId));
    if (store.hasVectors()) {
      const docs = await store.similaritySearch(query, k);
      // Chunks whose embedding could not be backfilled are invisible to the
      // vector search above — serve them through the keyword index so a
      // transient model failure can never silently drop a chunk from a draft.
      const all = listRagChunksForPatient(patientId);
      const stillMissing = new Set(all.filter((c) => c.embedding === null).map((c) => c.id));
      if (stillMissing.size > 0) {
        const seen = new Set(docs.map((d) => d.metadata.chunkId as string));
        for (const c of searchRagChunksFtsForPatient(patientId, query, k)) {
          if (!stillMissing.has(c.id) || seen.has(c.id)) continue;
          seen.add(c.id);
          docs.push(
            new Document({
              pageContent: c.content,
              metadata: { label: c.label, sourceType: c.source_type, sourceId: c.source_id, chunkId: c.id },
            })
          );
        }
      }
      return { docs, mode: "vector" };
    }
  }

  const hits = searchRagChunksFtsForPatient(patientId, query, k);
  return {
    docs: hits.map(
      (c) =>
        new Document({
          pageContent: c.content,
          metadata: { label: c.label, sourceType: c.source_type, sourceId: c.source_id },
        })
    ),
    mode: "keyword",
  };
}

// ---------------------------------------------------------------------------
// Grok-drafted report. The schema IS the labelling guarantee: every
// prescription comes back as structured fields, never prose. Grounding rules
// forbid inventing facts and require retrieval labels to be cited inline.
// ---------------------------------------------------------------------------

export const ReportDraftSchema = z.object({
  history_of_present_illness: z
    .string()
    .describe("Narrative history of present illness synthesised from the visit notes and retrieved context."),
  examination_findings: z
    .string()
    .describe("Clinical examination findings, from the doctor's keywords and prior vitals only."),
  assessment: z.string().describe("Working assessment/diagnosis with brief reasoning."),
  treatment_plan: z.string().describe("Planned management and investigations."),
  prescriptions: z
    .array(
      z.object({
        name: z.string().describe("Medication name"),
        dosage: z.string().describe("Dose per administration, e.g. 500 mg"),
        frequency: z.string().describe("How often, e.g. twice daily"),
        duration: z.string().describe("How long, e.g. 7 days"),
        instructions: z.string().describe("Special instructions, e.g. after meals"),
      })
    )
    .describe("Every prescribed medication as a structured row. Empty array if none."),
  patient_advice: z.string().describe("Plain-language advice for the patient."),
  follow_up: z.string().describe("Follow-up instructions."),
});

export type ReportDraft = z.infer<typeof ReportDraftSchema>;

const DRAFT_SYSTEM_PROMPT = `You are drafting a structured clinical report for a doctor inside PulseID, a national medical-records system.

You are given the treating doctor's own visit notes (keywords or short sentences) and retrieved context from this one patient's record (profile, past visits, uploaded reports). Each context block begins with a citation label like [Visit 2026-01-15] or [Report: lab.pdf].

Rules you always follow:
- Write ONLY from the doctor's notes and the retrieved context. Never invent symptoms, findings, medications, or history that is not present there. If information is missing, write "not documented" rather than guessing.
- Substantive claims in the history and assessment should trace to the doctor's notes or a cited context block. Reference citation labels inline where a claim comes from history, e.g. "(see [Visit 2026-05-02])".
- Prescriptions must list EVERY medication the doctor's notes name, with complete dosage/frequency/duration/instructions — expand standard abbreviations (e.g. "BD" → "twice daily"), but never introduce a medication the notes do not mention.
- You are drafting FOR a doctor who will review every word before it is sent. Clinical register throughout; only patient_advice is plain language.
- This is a drafting aid, not a diagnosis: the assessment refines the doctor's stated impression — never a new diagnosis they did not indicate.
- Output must match the schema exactly.`;

export async function draftPatientReport(input: {
  patientName: string;
  visitDate: string;
  keywords: string;
  docs: Document[];
}): Promise<ReportDraft> {
  if (!isReportDrafterConfigured()) {
    throw new Error("RAG_DRAFTER_NOT_CONFIGURED");
  }
  const context = input.docs.map((d) => `[${d.metadata.label}] ${d.pageContent}`).join("\n\n");
  const model = new ChatOpenAI({
    apiKey: groqApiKey(),
    model: groqModel(),
    // Mirrors the reference Groq payload: temperature 1, top_p 1, and — for
    // gpt-oss models, whose reasoning and output share one token budget —
    // medium reasoning effort. Non-gpt-oss Groq models reject that parameter,
    // so it's only sent for them. The budget is generous because reasoning
    // tokens count toward it; a tight cap truncates the tool call mid-JSON.
    temperature: 1,
    maxTokens: 8192,
    topP: 1,
    ...(groqModel().includes("gpt-oss") ? { modelKwargs: { reasoning_effort: "medium" } } : {}),
    configuration: { baseURL: "https://api.groq.com/openai/v1" },
    maxRetries: 1,
  });
  const structuredModel = model.withStructuredOutput(ReportDraftSchema, { name: "report_draft" });
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", DRAFT_SYSTEM_PROMPT],
    [
      "human",
      `Patient: {patientName}
Visit date: {visitDate}

Doctor's visit notes (keywords / short sentences):
"""
{keywords}
"""

Retrieved patient context:
{context}

Draft the structured report now.`,
    ],
  ]);
  const chain = prompt.pipe(structuredModel);
  try {
    return await chain.invoke({
      patientName: input.patientName,
      visitDate: input.visitDate,
      keywords: input.keywords,
      context: context || "(no additional retrieved context)",
    });
  } catch (err) {
    // A truncated or malformed tool call surfaces as a schema-parse failure.
    // Distinguish it from network/auth errors so the UI can say "try again"
    // instead of implying a system fault.
    if (err instanceof z.ZodError || /parse|schema|invalid tool/i.test(String((err as Error)?.message ?? ""))) {
      throw new Error("RAG_DRAFT_INCOMPLETE");
    }
    throw err;
  }
}
