"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, inputClass } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";

// Hospital-admin only: creates a doctor account scoped to the admin's own
// hospital (the backend derives hospital_id from the admin's session, never
// from anything sent here — see POST /api/hospital-admin/doctors).
export function CreateDoctorForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    licenseNumber: "",
    specialization: "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function reset() {
    setForm({ fullName: "", email: "", password: "", licenseNumber: "", specialization: "" });
    setError(null);
    setFieldErrors({});
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(apiUrl("/api/hospital-admin/doctors"), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create this account.");
        setFieldErrors(data.fieldErrors || {});
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ Add doctor</Button>;
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
      <div
        className="bg-white rounded-xl border border-line shadow-card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl mb-1">Add a doctor</h2>
        <p className="text-sm text-sage mb-5">
          They'll sign in at the Clinician Portal with the email and password below. You can
          deactivate this account at any time without losing their past records.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Full name">
            <input
              className={inputClass}
              value={form.fullName}
              onChange={(e) => set("fullName", e.target.value)}
              required
              autoFocus
            />
            {fieldErrors.fullName && <p className="text-xs text-alert mt-1">{fieldErrors.fullName}</p>}
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Email">
              <input
                type="email"
                className={inputClass}
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                required
              />
              {fieldErrors.email && <p className="text-xs text-alert mt-1">{fieldErrors.email}</p>}
            </Field>
            <Field label="Temporary password" hint="At least 8 characters">
              <input
                type="text"
                className={inputClass}
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                required
                minLength={8}
              />
              {fieldErrors.password && <p className="text-xs text-alert mt-1">{fieldErrors.password}</p>}
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="License number">
              <input
                className={inputClass}
                value={form.licenseNumber}
                onChange={(e) => set("licenseNumber", e.target.value)}
                required
              />
              {fieldErrors.licenseNumber && <p className="text-xs text-alert mt-1">{fieldErrors.licenseNumber}</p>}
            </Field>
            <Field label="Specialization" hint="Optional">
              <input
                className={inputClass}
                value={form.specialization}
                onChange={(e) => set("specialization", e.target.value)}
              />
            </Field>
          </div>

          {error && <p className="text-sm text-alert">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create account"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
