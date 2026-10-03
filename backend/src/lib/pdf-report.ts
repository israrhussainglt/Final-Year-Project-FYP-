// Generates a real, downloadable PDF of a patient's medical report using
// pdfkit (pure JS, no native bindings/headless-browser needed). This is
// distinct from the "Print / save as PDF" button on the report page, which
// relies on the visitor's browser print dialog — this endpoint produces the
// file server-side so it can be fetched, emailed, or archived without a
// browser in the loop.
import PDFDocument from "pdfkit";
import type { MedicalReport } from "./report";

const TEAL = "#0E7C7B";
const INK = "#0B2027";
const SAGE = "#4C6663";
const LINE = "#DCE4E3";

// Mirror of frontend/lib/report-format.ts's splitReportSections (the two
// packages are independent, like ageInYears) — AI-drafted reports are stored
// as one labelled blob in notes and must render with section structure in
// the PDF too. Unknown text passes through as a single unsectioned block.
const REPORT_SECTION_LABELS = [
  "History of Present Illness",
  "Examination Findings",
  "Assessment",
  "Treatment Plan",
  "Patient Advice",
  "Follow-up",
];

function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

function splitReportSections(notes: string): { heading: string | null; body: string }[] {
  const text = (notes || "").trim();
  if (!text) return [];
  const labels = new Map(REPORT_SECTION_LABELS.map((l) => [normalizeLabel(l), l]));
  const out: { heading: string | null; body: string }[] = [];
  for (const block of text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)) {
    const lines = block.split("\n");    const firstLine = (lines[0] || "").trim();
    const colonIdx = firstLine.indexOf(":");
    const colonCandidate = colonIdx > 0 ? firstLine.slice(0, colonIdx).trim() : null;
    const bareCandidate = !colonCandidate && firstLine.length <= 48 ? firstLine : null;
    const matched = colonCandidate && labels.has(normalizeLabel(colonCandidate))
      ? { heading: labels.get(normalizeLabel(colonCandidate)) as string, rest: firstLine.slice(colonIdx + 1).trim() }
      : bareCandidate && labels.has(normalizeLabel(bareCandidate))
        ? { heading: labels.get(normalizeLabel(bareCandidate)) as string, rest: "" }
        : null;
    if (matched) {
      const body = [matched.rest, ...lines.slice(1).map((l) => l.trimEnd())].filter(Boolean).join("\n").trim();
      out.push({ heading: matched.heading, body });
      continue;
    }
    if (out.length > 0 && out[out.length - 1].heading !== null) {
      out[out.length - 1].body = (out[out.length - 1].body + "\n\n" + block).trim();
    } else {
      out.push({ heading: null, body: block });
    }
  }
  return out;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function buildReportPdf(report: NonNullable<MedicalReport>): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: "A4", margin: 48, autoFirstPage: true, info: { Title: `PulseID medical report — ${report.patient.fullName}` } });

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  function heading(text: string) {
    doc.moveDown(0.6);
    doc.fillColor(TEAL).fontSize(11).font("Helvetica-Bold").text(text.toUpperCase(), { characterSpacing: 0.6 });
    doc.moveTo(doc.x, doc.y + 2).lineTo(doc.x + pageWidth, doc.y + 2).strokeColor(LINE).lineWidth(1).stroke();
    doc.moveDown(0.5);
    doc.fillColor(INK).font("Helvetica");
  }

  function kv(label: string, value: string) {
    doc.fontSize(9.5).fillColor(SAGE).font("Helvetica").text(label, { continued: true, width: 140 });
    doc.fillColor(INK).font("Helvetica-Bold").text(`  ${value || "—"}`);
  }

  // ---- Header ----
  doc.fillColor(TEAL).fontSize(20).font("Helvetica-Bold").text("PulseID", { continued: true });
  doc.fillColor(SAGE).fontSize(10).font("Helvetica").text("  National Health Record Network");
  doc.moveDown(0.2);
  doc.fillColor(INK).fontSize(15).font("Helvetica-Bold").text("Medical Report");
  doc.fillColor(SAGE).fontSize(9).font("Helvetica").text(
    `Generated ${fmtDate(report.generatedAt)} for ${report.generatedFor === "doctor" ? "clinical use" : "the patient"} by ${report.generatedByName}  ·  Report ID ${report.reportId.slice(0, 8)}`
  );
  doc.moveTo(doc.page.margins.left, doc.y + 8).lineTo(doc.page.margins.left + pageWidth, doc.y + 8).strokeColor(TEAL).lineWidth(2).stroke();
  doc.moveDown(1);

  // ---- Patient details ----
  heading("Patient");
  kv("Full name", report.patient.fullName);
  kv("National ID", report.patient.nationalId);
  kv("Date of birth", `${fmtDate(report.patient.dateOfBirth)} (age ${report.patient.age})`);
  kv("Gender", report.patient.gender);
  kv("Blood group", report.patient.bloodGroup);
  kv("Phone", report.patient.phoneNumber);
  if (report.patient.address) kv("Address", report.patient.address);

  // ---- Risk flags ----
  if (report.summary.riskFlags.length > 0) {
    heading("Risk & alert flags");
    for (const flag of report.summary.riskFlags) {
      doc.fillColor("#D64550").fontSize(9.5).font("Helvetica-Bold").text(`! ${flag}`);
    }
    doc.fillColor(INK).font("Helvetica");
  }

  // ---- Emergency contacts ----
  if (report.emergencyContacts.length > 0) {
    heading("Emergency contacts");
    for (const c of report.emergencyContacts) {
      doc.fontSize(9.5).fillColor(INK).font("Helvetica-Bold").text(`${c.fullName}${c.isPrimary ? "  (primary)" : ""}`, { continued: true });
      doc.font("Helvetica").fillColor(SAGE).text(`  —  ${c.relationship}  ·  ${c.phone}`);
    }
  }

  // ---- Current medications ----
  if (report.currentMedications.length > 0) {
    heading("Current medications");
    for (const m of report.currentMedications) {
      doc.fontSize(9.5).fillColor(INK).font("Helvetica-Bold").text(`${m.name} — ${m.dosage}, ${m.frequency}`, { continued: true });
      doc.font("Helvetica").fillColor(SAGE).text(`  (${m.duration}, prescribed by ${m.prescribedBy})`);
    }
  }

  // ---- Visit timeline ----
  heading(`Visit history (${report.timeline.length})`);
  if (report.timeline.length === 0) {
    doc.fontSize(9.5).fillColor(SAGE).text("No visits on record.");
  }
  for (const t of report.timeline) {
    doc.fontSize(9.5).fillColor(INK).font("Helvetica-Bold").text(`${fmtDate(t.visitDate)} — ${t.diagnosis || t.type}`);
    doc.fontSize(8.5).fillColor(SAGE).font("Helvetica");
    const meta: string[] = [];
    if (t.clinician) meta.push(`Seen by ${t.clinician}`);
    if (t.symptoms) meta.push(`Symptoms: ${t.symptoms}`);
    if (meta.length) doc.text(meta.join("  ·  "));
    if (t.notes) {
      for (const section of splitReportSections(t.notes)) {
        if (section.heading) {
          doc.fontSize(8).fillColor(SAGE).font("Helvetica-Bold").text(section.heading.toUpperCase(), { characterSpacing: 0.5, indent: 4 });
          doc.font("Helvetica");
        }
        doc.fontSize(9).fillColor(INK).font("Helvetica").text(section.body, { indent: 4 });
      }
    }
    doc.moveDown(0.4);
  }

  // ---- Prescription history ----
  if (report.prescriptions.length > 0) {
    heading(`Prescription history (${report.prescriptions.length})`);
    for (const rx of report.prescriptions) {
      doc.fontSize(9.5).fillColor(INK).font("Helvetica-Bold").text(`${fmtDate(rx.issuedDate)}${rx.isCurrent ? "  (current)" : ""}`);
      doc.fontSize(8.5).font("Helvetica").fillColor(SAGE);
      for (const m of rx.medications) {
        doc.text(`•  ${m.name} — ${m.dosage}, ${m.frequency}, ${m.duration}`);
      }
      if (rx.instructions) doc.fillColor(INK).text(`Instructions: ${rx.instructions}`);
      doc.moveDown(0.4);
    }
  }

  // ---- Access log ----
  if (report.accessLog.length > 0) {
    heading("Recent record access (audit trail)");
    for (const a of report.accessLog.slice(0, 10)) {
      doc.fontSize(8.5).fillColor(SAGE).text(`${fmtDate(a.at)} — ${a.actorName} (${a.actorRole}): ${a.action}${a.details ? " — " + a.details : ""}`);
    }
  }

  // ---- Footer ----
  doc.moveDown(1);
  doc.fontSize(7.5).fillColor(SAGE).font("Helvetica").text(
    "This report was generated by PulseID and reflects the record as of the generation date above. It is not a substitute for direct clinical consultation.",
    { align: "center" }
  );

  return doc;
}
