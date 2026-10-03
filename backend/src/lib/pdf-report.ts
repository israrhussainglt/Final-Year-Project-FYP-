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
    if (t.notes) doc.fillColor(INK).text(t.notes, { indent: 0 });
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
