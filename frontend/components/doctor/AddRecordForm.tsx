"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, inputClass } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";

const RECORD_TYPES = [
  ["checkup", "Checkup"],
  ["diagnosis", "Diagnosis"],
  ["lab_result", "Lab Result"],
  ["vaccination", "Vaccination"],
  ["surgery", "Surgery"],
  ["emergency_visit", "Emergency Visit"],
];

export function AddRecordForm({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [riskResult, setRiskResult] = useState<{ level: string; factors: string[] } | null>(null);
  const [form, setForm] = useState({
    recordType: "checkup",
    visitDate: new Date().toISOString().slice(0, 10),
    diagnosis: "",
    symptoms: "",
    notes: "",
    systolicBp: "",
    diastolicBp: "",
    bloodSugarMmol: "",
    bodyTempC: "",
    heartRateBpm: "",
    riskContext: "general",
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/patients/${patientId}/records`), { credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not save the record.");
        return;
      }
      if (data.riskAssessment) {
        // Show the flag inline for a beat before closing, rather than
        // silently dismissing the modal — a high/mid flag is exactly the
        // moment a doctor shouldn't have to go dig for it separately.
        setRiskResult({
          level: data.riskAssessment.risk_level,
          factors: JSON.parse(data.riskAssessment.factors || "[]"),
        });
        setLoading(false);
        return;
      }
      closeAndReset();
    } catch {
      setError("Could not reach the server. Please try again.");
      setLoading(false);
    }
  }

  function closeAndReset() {
    setOpen(false);
    setRiskResult(null);
    setForm({
      recordType: "checkup",
      visitDate: new Date().toISOString().slice(0, 10),
      diagnosis: "",
      symptoms: "",
      notes: "",
      systolicBp: "",
      diastolicBp: "",
      bloodSugarMmol: "",
      bodyTempC: "",
      heartRateBpm: "",
      riskContext: "general",
    });
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + Add visit
      </Button>
    );
  }

  // After a successful save that produced a risk score, show the flag in
  // place of the form instead of just closing the modal — this is the one
  // moment a doctor is looking right at this screen, so a high/mid result
  // shouldn't require a separate trip to the risk tab to notice.
  if (riskResult) {
    const tone = riskResult.level === "high" ? "text-alert" : riskResult.level === "mid" ? "text-amber-600" : "text-teal-dark";
    return (
      <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4" onClick={closeAndReset}>
        <div className="bg-white rounded-xl border border-line shadow-card w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
          <h2 className="font-display text-2xl mb-2">Visit saved</h2>
          <p className={`text-sm font-semibold uppercase tracking-wide mb-3 ${tone}`}>
            Risk flag: {riskResult.level}
          </p>
          <ul className="space-y-1.5 mb-5">
            {riskResult.factors.map((f, i) => (
              <li key={i} className="text-sm text-ink">
                • {f}
              </li>
            ))}
          </ul>
          <p className="text-xs text-sage mb-5">
            Automated, rule-based flag from recorded vitals only — not a diagnosis. Always use clinical judgement.
          </p>
          <div className="flex justify-end">
            <Button onClick={closeAndReset}>Done</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
      <div
        className="bg-white rounded-xl border border-line shadow-card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl mb-5">Add a visit</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Record type">
              <select
                className={inputClass}
                value={form.recordType}
                onChange={(e) => setForm({ ...form, recordType: e.target.value })}
              >
                {RECORD_TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Visit date">
              <input
                type="date"
                className={inputClass}
                value={form.visitDate}
                onChange={(e) => setForm({ ...form, visitDate: e.target.value })}
                required
              />
            </Field>
          </div>
          <Field label="Diagnosis">
            <input
              className={inputClass}
              value={form.diagnosis}
              onChange={(e) => setForm({ ...form, diagnosis: e.target.value })}
              placeholder="e.g. Acute bronchitis"
              required
              autoFocus
            />
          </Field>
          <Field label="Symptoms" hint="Optional">
            <input
              className={inputClass}
              value={form.symptoms}
              onChange={(e) => setForm({ ...form, symptoms: e.target.value })}
              placeholder="e.g. Persistent cough, mild fever"
            />
          </Field>
          <Field label="Notes" hint="Optional">
            <textarea
              className={`${inputClass} min-h-[90px]`}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Treatment plan, follow-up instructions…"
            />
          </Field>

          <div className="pt-2 border-t border-line">
            <p className="eyebrow text-sage mb-3">Vitals (optional — enables an automatic risk flag)</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Blood pressure" hint="Systolic / diastolic, mmHg">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className={inputClass}
                    value={form.systolicBp}
                    onChange={(e) => setForm({ ...form, systolicBp: e.target.value })}
                    placeholder="120"
                  />
                  <span className="text-sage">/</span>
                  <input
                    type="number"
                    className={inputClass}
                    value={form.diastolicBp}
                    onChange={(e) => setForm({ ...form, diastolicBp: e.target.value })}
                    placeholder="80"
                  />
                </div>
              </Field>
              <Field label="Blood sugar" hint="mmol/L">
                <input
                  type="number"
                  step="0.1"
                  className={inputClass}
                  value={form.bloodSugarMmol}
                  onChange={(e) => setForm({ ...form, bloodSugarMmol: e.target.value })}
                  placeholder="5.5"
                />
              </Field>
              <Field label="Body temperature" hint="°C">
                <input
                  type="number"
                  step="0.1"
                  className={inputClass}
                  value={form.bodyTempC}
                  onChange={(e) => setForm({ ...form, bodyTempC: e.target.value })}
                  placeholder="37.0"
                />
              </Field>
              <Field label="Heart rate" hint="bpm">
                <input
                  type="number"
                  className={inputClass}
                  value={form.heartRateBpm}
                  onChange={(e) => setForm({ ...form, heartRateBpm: e.target.value })}
                  placeholder="72"
                />
              </Field>
            </div>
            <Field label="Risk context" hint="Use maternal for pregnancy/postpartum visits">
              <select
                className={`${inputClass} mt-1`}
                value={form.riskContext}
                onChange={(e) => setForm({ ...form, riskContext: e.target.value })}
              >
                <option value="general">General</option>
                <option value="maternal">Maternal / postpartum</option>
              </select>
            </Field>
          </div>

          {error && <p className="text-sm text-alert">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save visit"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
