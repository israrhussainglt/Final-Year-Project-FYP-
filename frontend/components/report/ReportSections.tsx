// Renders a visit's clinical notes with proper report typography.
//
// Finalized AI-drafted reports are stored as one text blob in
// medical_records.notes; this component splits it into its labelled
// clinical sections and renders each with a real heading, so a report
// reads like a document instead of a wall of text. Plain hand-written
// notes contain no known section labels and render unchanged as a single
// paragraph — the component is a no-op for them.
import { splitReportSections } from "@/lib/report-format";

export function ReportSections({ notes, dense = false }: { notes: string; dense?: boolean }) {
  const sections = splitReportSections(notes);
  if (sections.length === 0) return null;

  // Unsectioned notes (or a single unlabelled block): render exactly as before.
  if (sections.length === 1 && sections[0].heading === null) {
    return <p className={`text-sm leading-relaxed ${dense ? "mt-1" : "mt-2"} whitespace-pre-line`}>{sections[0].body}</p>;
  }

  return (
    <div className={dense ? "mt-1" : "mt-2"}>
      {sections.map((s, i) => (
        <div key={i} className={i > 0 ? "mt-3" : ""}>
          {s.heading && (
            <div className="text-[11px] font-semibold uppercase tracking-wide text-sage">{s.heading}</div>
          )}
          <p className={`text-sm leading-relaxed whitespace-pre-line ${s.heading ? "mt-0.5" : ""}`}>{s.body}</p>
        </div>
      ))}
    </div>
  );
}
