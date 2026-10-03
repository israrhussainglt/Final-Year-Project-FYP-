// Splits a visit's clinical notes into labelled report sections.
//
// AI-drafted reports are finalized as one text blob in medical_records.notes
// ("History of Present Illness: ...\n\nExamination Findings: ..."). Every
// rendering surface — timeline cards, the detailed report view, the PDF —
// runs the blob through this splitter so the report displays with real
// section structure instead of a wall of text. Plain hand-written notes
// that don't match any known section label pass through untouched as one
// unsectioned block, exactly as they were written.

export const REPORT_SECTION_LABELS = [
  "History of Present Illness",
  "Examination Findings",
  "Assessment",
  "Treatment Plan",
  "Patient Advice",
  "Follow-up",
] as const;

// Match labels loosely: "follow up", "Followup" and "Follow-up" are the
// same section; case and punctuation never matter.
function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

const LABEL_MAP = new Map<string, string>(REPORT_SECTION_LABELS.map((l) => [normalizeLabel(l), l]));
const LABEL_SET = new Set(LABEL_MAP.keys());

export type ReportSection = { heading: string | null; body: string };

export function splitReportSections(notes: string): ReportSection[] {
  const text = (notes || "").trim();
  if (!text) return [];

  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const out: ReportSection[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const firstLine = (lines[0] || "").trim();

    // Form A — "Heading: body starts on the same line".
    const colonIdx = firstLine.indexOf(":");
    const colonCandidate = colonIdx > 0 ? firstLine.slice(0, colonIdx).trim() : null;
    // Form B — heading sits alone on the block's first line.
    const bareCandidate = !colonCandidate && firstLine.length <= 48 ? firstLine : null;

    const matched =
      (colonCandidate && LABEL_SET.has(normalizeLabel(colonCandidate))
        ? { heading: LABEL_MAP.get(normalizeLabel(colonCandidate)) as string, rest: firstLine.slice(colonIdx + 1).trim() }
        : bareCandidate && LABEL_SET.has(normalizeLabel(bareCandidate))
          ? { heading: LABEL_MAP.get(normalizeLabel(bareCandidate)) as string, rest: "" }
          : null);

    if (matched) {
      const body = [matched.rest, ...lines.slice(1).map((l) => l.trimEnd())].filter(Boolean).join("\n").trim();
      out.push({ heading: matched.heading, body });
      continue;
    }

    // Not a section opener: continue the current section's body, or float
    // as unsectioned preamble before the first labelled section.
    if (out.length > 0 && out[out.length - 1].heading !== null) {
      out[out.length - 1].body = (out[out.length - 1].body + "\n\n" + block).trim();
    } else {
      out.push({ heading: null, body: block });
    }
  }
  return out;
}

// True when the notes look like a structured (AI-drafted, doctor-approved)
// report rather than freeform notes — renderers use this to pick layout.
export function isStructuredReport(notes: string): boolean {
  return splitReportSections(notes).some((s) => s.heading !== null);
}
