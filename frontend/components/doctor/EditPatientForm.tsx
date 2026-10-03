"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, inputClass } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";
import type { Patient } from "@/lib/types";

const BLOOD_GROUPS = ["unknown", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// Doctor-only: patients can never reach this component, and the backend
// route it calls (PATCH /api/patients/:id) is gated the same way.
export function EditPatientForm({ patient }: { patient: Patient }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    fullName: patient.full_name,
    dateOfBirth: patient.date_of_birth?.slice(0, 10) || "",
    gender: patient.gender || "female",
    phoneNumber: patient.phone_number || "",
    email: patient.email || "",
    address: patient.address || "",
    bloodGroup: (patient.blood_group || "unknown") as string,
    allergies: patient.allergies || "",
    chronicConditions: patient.chronic_conditions || "",
    weightKg: patient.weight_kg != null ? String(patient.weight_kg) : "",
    pediatricianName: patient.pediatrician_name || "",
    pediatricianPhone: patient.pediatrician_phone || "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(apiUrl(`/api/patients/${patient.id}`), {
        credentials: "include",
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not save these changes.");
        setFieldErrors(data.fieldErrors || {});
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        ✎ Edit details
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
      <div
        className="bg-white rounded-xl border border-line shadow-card w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl mb-1">Edit patient details</h2>
        <p className="text-sm text-sage mb-5">
          National ID and ID type can't be changed here — they're the patient's fixed identity.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Full name">
              <input
                className={inputClass}
                value={form.fullName}
                onChange={(e) => set("fullName", e.target.value)}
                required
              />
              {fieldErrors.fullName && <p className="text-xs text-alert mt-1">{fieldErrors.fullName}</p>}
            </Field>
            <Field label="Date of birth">
              <input
                type="date"
                className={inputClass}
                value={form.dateOfBirth}
                onChange={(e) => set("dateOfBirth", e.target.value)}
                required
              />
              {fieldErrors.dateOfBirth && <p className="text-xs text-alert mt-1">{fieldErrors.dateOfBirth}</p>}
            </Field>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Gender">
              <select className={inputClass} value={form.gender} onChange={(e) => set("gender", e.target.value)}>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Blood group">
              <select className={inputClass} value={form.bloodGroup} onChange={(e) => set("bloodGroup", e.target.value)}>
                {BLOOD_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g === "unknown" ? "Unknown" : g}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Weight (kg)" hint="Optional">
              <input
                type="number"
                min={0}
                max={300}
                step="0.1"
                className={inputClass}
                value={form.weightKg}
                onChange={(e) => set("weightKg", e.target.value)}
              />
              {fieldErrors.weightKg && <p className="text-xs text-alert mt-1">{fieldErrors.weightKg}</p>}
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Phone number">
              <input
                type="tel"
                inputMode="tel"
                className={inputClass}
                value={form.phoneNumber}
                onChange={(e) => set("phoneNumber", e.target.value)}
                required
              />
              {fieldErrors.phoneNumber && <p className="text-xs text-alert mt-1">{fieldErrors.phoneNumber}</p>}
            </Field>
            <Field label="Email" hint="Optional">
              <input
                type="email"
                className={inputClass}
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
              {fieldErrors.email && <p className="text-xs text-alert mt-1">{fieldErrors.email}</p>}
            </Field>
          </div>

          <Field label="Address" hint="Optional — for this patient's record only. It doesn't feed the analytics dashboard, which groups cases by the hospital's city instead of a patient's home address.">
            <input className={inputClass} value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Allergies" hint="Optional">
              <textarea
                className={`${inputClass} min-h-[70px]`}
                value={form.allergies}
                onChange={(e) => set("allergies", e.target.value)}
              />
            </Field>
            <Field label="Chronic conditions" hint="Optional">
              <textarea
                className={`${inputClass} min-h-[70px]`}
                value={form.chronicConditions}
                onChange={(e) => set("chronicConditions", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Pediatrician name" hint="Optional">
              <input
                className={inputClass}
                value={form.pediatricianName}
                onChange={(e) => set("pediatricianName", e.target.value)}
              />
            </Field>
            <Field label="Pediatrician phone" hint="Optional">
              <input
                type="tel"
                inputMode="tel"
                className={inputClass}
                value={form.pediatricianPhone}
                onChange={(e) => set("pediatricianPhone", e.target.value)}
              />
            </Field>
          </div>

          {error && <p className="text-sm text-alert">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
