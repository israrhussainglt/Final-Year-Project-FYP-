"use client";

// AI-drafted report panel for one visit (see backend /draft + /finalize
// routes). The doctor's keywords — already saved as the visit's fields —
// are expanded by Grok (xAI) into a structured report grounded in this
// patient's RAG index. Nothing is saved until the doctor reviews the
// editable draft and presses "Approve & send", which is the human gate:
// the draft is a convenience, never an automatic clinical decision.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl, readCsrfCookie } from "@/lib/api";
import { inputClass } from "@/components/ui";

type DraftPrescription = {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
};

type ReportDraft = {
  history_of_present_illness: string;
  examination_findings: string;
  assessment: string;
  treatment_plan: string;
  prescriptions: DraftPrescription[];
  patient_advice: string;
  follow_up: string;
};

type DraftResponse = {
  draft: ReportDraft;
  retrieval: { mode: "vector" | "keyword"; sources: string[] };
  disclaimer: string;
};

const SECTION_FIELDS: { key: keyof ReportDraft; label: string }[] = [
  { key: "history_of_present_illness", label: "History of present illness" },
  { key: "examination_findings", label: "Examination findings" },
  { key: "assessment", label: "Assessment" },
  { key: "treatment_plan", label: "Treatment plan" },
  { key: "patient_advice", label: "Patient advice" },
  { key: "follow_up", label: "Follow-up" },
];

export function AiReportDraft({
  patientId,
  record,
}: {
  patientId: string;
  record: { id: string; visit_date: string; diagnosis: string | null; symptoms: string | null; notes: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "drafting" | "editing" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [diagnosis, setDiagnosis] = useState(record.diagnosis || "");
  const [sources, setSources] = useState<string[]>([]);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);

  async function requestDraft() {
    setPhase("drafting");
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/patients/${patientId}/records/${record.id}/draft`), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Couldn't draft the report.");
        setPhase("idle");
        return;
      }
      const payload = data as DraftResponse;
      setDraft(payload.draft);
      setSources(payload.retrieval.sources || []);
      setDisclaimer(payload.disclaimer || null);
      setDiagnosis((prev) => prev || payload.draft.assessment.split(/[.;]/)[0] || "");
      setPhase("editing");
    } catch {
      setError("Could not reach the server.");
      setPhase("idle");
    }
  }

  function setField(key: keyof ReportDraft, value: string) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function setRx(index: number, patch: Partial<DraftPrescription>) {
    setDraft((d) =>
      d ? { ...d, prescriptions: d.prescriptions.map((rx, i) => (i === index ? { ...rx, ...patch } : rx)) } : d
    );
  }

  async function approveAndSend() {
    if (!draft) return;
    setPhase("saving");
    setError(null);
    // The full report is stored as the visit's clinical text, composed from
    // the reviewed sections so the patient portal and PDF report render it.
    const notes = SECTION_FIELDS.map(({ key, label }) => `${label}: ${draft[key] as string}`).join("\n\n");
    try {
      const res = await fetch(apiUrl(`/api/patients/${patientId}/records/${record.id}/finalize`), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify({ diagnosis, notes, prescriptions: draft.prescriptions }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Couldn't save the report.");
        setPhase("editing");
        return;
      }
      setPhase("saved");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setPhase("editing");
    }
  }

  if (phase === "saved") {
    return <p className="text-xs text-teal-dark mt-3">✓ Report approved and sent to the patient.</p>;
  }

  if (!open && phase !== "editing") {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            requestDraft();
          }}
          disabled={phase === "drafting"}
          className="focus-ring text-xs font-medium text-teal-dark hover:underline disabled:text-sage"
        >
          {phase === "drafting" ? "Drafting with AI…" : "✦ Draft full report with AI"}
        </button>
        {error && <p className="text-xs text-alert mt-1">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-line space-y-4">
      <div className="flex items-center justify-between">
        <div className="eyebrow text-sage">AI-drafted report — review every line before sending</div>
      </div>
      {disclaimer && <p className="text-xs text-sage">{disclaimer}</p>}
      {sources.length > 0 && (
        <p className="text-xs text-sage">
          Retrieved from: {sources.join(" · ")}
        </p>
      )}
      {error && <p className="text-sm text-alert">{error}</p>}

      {phase === "drafting" || !draft ? (
        <p className="text-sm text-sage">Drafting with AI… this usually takes a few seconds.</p>
      ) : (
        <>
          <div>
            <label className="text-xs text-sage uppercase tracking-wide">Diagnosis (one line)</label>
            <input
              className={`${inputClass} mt-1`}
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
            />
          </div>

          {SECTION_FIELDS.map(({ key, label }) => (
            <div key={key}>
              <label className="text-xs text-sage uppercase tracking-wide">{label}</label>
              <textarea
                className={`${inputClass} min-h-[64px] mt-1`}
                value={draft[key] as string}
                onChange={(e) => setField(key, e.target.value)}
              />
            </div>
          ))}

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-sage uppercase tracking-wide">Prescriptions (labelled)</label>
              <button
                type="button"
                onClick={() =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          prescriptions: [...d.prescriptions, { name: "", dosage: "", frequency: "", duration: "", instructions: "" }],
                        }
                      : d
                  )
                }
                className="focus-ring text-xs font-medium text-teal-dark hover:underline"
              >
                + Add medication
              </button>
            </div>
            {draft.prescriptions.length === 0 && <p className="text-sm text-sage mt-1">None.</p>}
            <div className="space-y-2 mt-2">
              {draft.prescriptions.map((rx, i) => (
                <div key={i} className="grid sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-center">
                  <input
                    className={inputClass}
                    placeholder="Medication"
                    value={rx.name}
                    onChange={(e) => setRx(i, { name: e.target.value })}
                  />
                  <input
                    className={inputClass}
                    placeholder="Dosage"
                    value={rx.dosage}
                    onChange={(e) => setRx(i, { dosage: e.target.value })}
                  />
                  <input
                    className={inputClass}
                    placeholder="Frequency"
                    value={rx.frequency}
                    onChange={(e) => setRx(i, { frequency: e.target.value })}
                  />
                  <input
                    className={inputClass}
                    placeholder="Duration"
                    value={rx.duration}
                    onChange={(e) => setRx(i, { duration: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => setDraft((d) => (d ? { ...d, prescriptions: d.prescriptions.filter((_, j) => j !== i) } : d))}
                    className="focus-ring text-xs text-sage hover:text-alert px-1"
                    aria-label={`Remove ${rx.name || "medication"}`}
                  >
                    ✕
                  </button>
                  {rx.instructions && <p className="text-xs text-sage sm:col-span-5">Instructions: {rx.instructions}</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={approveAndSend}
              disabled={phase === "saving" || !diagnosis}
              className="focus-ring rounded-full bg-teal px-5 py-2 text-sm font-semibold text-white hover:bg-teal-dark transition-colors disabled:opacity-60"
            >
              {phase === "saving" ? "Saving…" : "Approve & send to patient"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPhase("idle");
                setDraft(null);
              }}
              className="focus-ring text-sm font-medium text-sage hover:text-ink"
            >
              Discard draft
            </button>
          </div>
        </>
      )}
    </div>
  );
}
