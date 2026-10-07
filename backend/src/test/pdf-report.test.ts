// Covers buildReportPdf (lib/pdf-report.ts) end-to-end: render a synthetic
// MedicalReport through pdfkit, collect the stream, and assert a real PDF
// comes out — exercising every rendering branch (risk flags, contacts,
// current meds, multi-page timeline with sectioned AND plain notes,
// prescription history, audit trail, empty sections).

import zlib from "zlib";
import { describe, expect, it } from "vitest";
import { buildReportPdf } from "../lib/pdf-report";
import type { MedicalReport } from "../lib/report";

function renderToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

// pdfkit Flate-compresses content streams and draws text as hex TJ runs —
// inflate, then decode every <hex> run so assertions can match the text.
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    let content = m[1];
    try {
      content = zlib.inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      /* uncompressed stream, use as-is */
    }
    const hexRe = /<([0-9A-Fa-f]+)>/g;
    let h: RegExpExecArray | null;
    while ((h = hexRe.exec(content))) {
      out.push(Buffer.from(h[1], "hex").toString("latin1"));
    }
  }
  return out.join("\n");
}

// Kerning splits words mid-string in TJ runs — compare on lowercased
// letters-only text, which preserves order and removes the splits.
function letters(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

const sectionedNotes = [
  "History of present illness: 32-year-old with type 2 diabetes, ongoing fatigue.",
  "",
  "Assessment: Stable on current management (see [Report: lab-panel.pdf]).",
  "",
  "Follow up: Review in 4 weeks.",
].join("\n");

const baseReport = {
  reportId: "11111111-2222-3333-4444-555555555555",
  generatedAt: new Date().toISOString(),
  generatedFor: "doctor",
  generatedByName: "Dr. Test",
  patient: {
    id: "p-1",
    fullName: "PDF Patient",
    nationalId: "42101-1234567-1",
    dateOfBirth: "1994-05-01",
    age: 32,
    gender: "female",
    bloodGroup: "B+",
    phoneNumber: "+92 300 0000000",
    email: null,
    address: "1 Test Street",
    allergies: "Penicillin",
    chronicConditions: null,
    recordCreatedAt: "2026-01-01T00:00:00.000Z",
  },
  summary: {
    totalVisits: 2,
    totalPrescriptions: 1,
    recordsByType: { checkup: 2 },
    mostRecentVisit: null,
    currentMedicationCount: 1,
    riskFlags: ["Allergy alert: Penicillin"],
  },
  emergencyContacts: [{ fullName: "Contact One", relationship: "spouse", phone: "+92 300 1111111", isPrimary: true }],
  timeline: [
    {
      id: "r-1",
      type: "checkup",
      visitDate: "2026-10-01",
      diagnosis: "T2DM follow-up",
      symptoms: "Fatigue",
      notes: sectionedNotes,
      clinician: "Dr. Test",
      recordedAt: "2026-10-01T00:00:00.000Z",
    },
    {
      id: "r-2",
      type: "checkup",
      visitDate: "2026-05-01",
      diagnosis: null,
      symptoms: null,
      notes: "A plain hand-written note with no section labels.",
      clinician: null,
      recordedAt: "2026-05-01T00:00:00.000Z",
    },
  ],
  prescriptions: [
    {
      id: "rx-1",
      issuedDate: "2026-10-01",
      clinician: "Dr. Test",
      instructions: "After meals",
      isCurrent: true,
      medications: [{ name: "Metformin", dosage: "500 mg", frequency: "twice daily", duration: "30 days" }],
    },
  ],
  currentMedications: [
    { name: "Metformin", dosage: "500 mg", frequency: "twice daily", duration: "30 days", prescribedBy: "Dr. Test", issuedDate: "2026-10-01" },
  ],
  accessLog: [{ actorRole: "doctor", actorName: "Dr. Test", action: "record_viewed", details: "x", at: "2026-10-04T00:00:00.000Z" }],
} as unknown as MedicalReport;

describe("buildReportPdf (pdf-report.ts)", () => {
  it("renders a real PDF for a full report", async () => {
    const pdf = await renderToBuffer(buildReportPdf(baseReport));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
    const text = letters(pdfText(pdf));
    expect(text).toContain("pulseid");
    expect(text).toContain("pdfpatient");
    expect(text).toContain("riskalertflags");
    expect(text).toContain("currentmedications");
    expect(text).toContain("prescriptionhistory");
    expect(text).toContain("current");
    expect(text).toContain("metformin");
  });

  it("renders section headings for AI-drafted notes and passes plain notes through", async () => {
    const pdf = await renderToBuffer(buildReportPdf(baseReport));
    const text = letters(pdfText(pdf));
    expect(text).toContain("historyofpresentillness");
    expect(text).toContain("followup");
    expect(text).toContain("aplainhandwrittennotewithnosectionlabels");
  });

  it("renders the empty-state branches without crashing", async () => {
    const empty = {
      ...baseReport,
      patient: { ...baseReport.patient, address: null },
      summary: { ...baseReport.summary, riskFlags: [] },
      emergencyContacts: [],
      currentMedications: [],
      timeline: [],
      prescriptions: [],
      accessLog: [],
    } as unknown as MedicalReport;
    const pdf = await renderToBuffer(buildReportPdf(empty));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(letters(pdfText(pdf))).toContain("novisitsonrecord");
  });

  it("formats unknown dates defensively", async () => {
    const weird = {
      ...baseReport,
      timeline: [
        {
          id: "r-9",
          type: "checkup",
          visitDate: null,
          diagnosis: null,
          symptoms: null,
          notes: null,
          clinician: null,
          recordedAt: null,
        },
      ],
    } as unknown as MedicalReport;
    const pdf = await renderToBuffer(buildReportPdf(weird));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // diagnosis falls back to the record type in the visit row
    expect(letters(pdfText(pdf))).toContain("checkup");
  });
});
