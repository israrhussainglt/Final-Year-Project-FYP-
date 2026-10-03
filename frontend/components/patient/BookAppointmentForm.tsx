"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, inputClass } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";

type DoctorOption = { id: string; fullName: string; specialization: string | null; hospitalName: string | null };

export function BookAppointmentForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Patients only pick a doctor and (optionally) a reason. The date/time is
  // never chosen here — the doctor/clinic sets it once they confirm.
  const [form, setForm] = useState({ doctorId: "", reason: "" });

  useEffect(() => {
    if (!open || doctors.length > 0) return;
    setLoadingDoctors(true);
    fetch(apiUrl("/api/patient/doctors"), { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        const list: DoctorOption[] = data.doctors || [];
        setDoctors(list);
        if (list.length > 0) setForm((f) => ({ ...f, doctorId: list[0].id }));
      })
      .finally(() => setLoadingDoctors(false));
  }, [open, doctors.length]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/patient/appointments"), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not request the appointment.");
        return;
      }
      setOpen(false);
      setForm({ doctorId: doctors[0]?.id || "", reason: "" });
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ Request appointment</Button>;
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
      <div
        className="bg-white rounded-xl border border-line shadow-card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl mb-1">Request an appointment</h2>
        <p className="text-sm text-sage mb-5">
          Choose a doctor and, if you like, why you're coming in — the clinic will set the date &amp; time and
          confirm it.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Doctor">
            <select
              className={inputClass}
              value={form.doctorId}
              onChange={(e) => setForm({ ...form, doctorId: e.target.value })}
              disabled={loadingDoctors}
              required
            >
              {loadingDoctors && <option>Loading doctors…</option>}
              {!loadingDoctors && doctors.length === 0 && <option value="">No doctors available</option>}
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                  {d.specialization ? ` — ${d.specialization}` : ""}
                  {d.hospitalName ? ` (${d.hospitalName})` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason for visit" hint="Optional — helps the doctor prepare">
            <textarea
              className={`${inputClass} min-h-[80px]`}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="e.g. Follow-up on blood pressure medication"
            />
          </Field>
          {error && <p className="text-sm text-alert">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || doctors.length === 0}>
              {loading ? "Requesting…" : "Request appointment"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
