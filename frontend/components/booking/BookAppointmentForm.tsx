"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { apiUrl } from "@/lib/api";
import { isMinorDob } from "@/lib/identity";

// Mirrors the field set and validation rules of the doctor-side registration
// route (POST /api/patients) so the two paths behave identically from a
// patient's point of view — plus the three things that only exist here:
// choosing a doctor, attaching existing reports, and NOT choosing a date. The
// date is the doctor's to allocate; see the note above the reason field.
const BLOOD_GROUPS = ["unknown", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const RELATIONSHIPS = ["Parent", "Spouse", "Sibling", "Child", "Guardian", "Friend", "Other"];
const MAX_FILES = 5;
const MAX_FILE_MB = 10;

type Contact = { fullName: string; relationshipType: string; phoneNumber: string };
type Doctor = { id: string; fullName: string; specialization: string | null; hospitalName: string | null };

const emptyContact = (): Contact => ({ fullName: "", relationshipType: "Parent", phoneNumber: "" });

// 12345-1234567-1, auto-inserting the dashes as they type.
function formatNationalId(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 13);
  return [digits.slice(0, 5), digits.slice(5, 12), digits.slice(12, 13)].filter(Boolean).join("-");
}

export function BookAppointmentForm() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorsError, setDoctorsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [done, setDone] = useState<{ doctorName: string; attachments: number } | null>(null);

  const [form, setForm] = useState({
    nationalId: "",
    fullName: "",
    dateOfBirth: "",
    gender: "female",
    phoneNumber: "",
    email: "",
    address: "",
    bloodGroup: "unknown",
    allergies: "",
    chronicConditions: "",
    weightKg: "",
    pediatricianName: "",
    pediatricianPhone: "",
    doctorId: "",
    reason: "",
  });
  const [contacts, setContacts] = useState<Contact[]>([emptyContact()]);

  const isMinor = useMemo(() => isMinorDob(form.dateOfBirth), [form.dateOfBirth]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/booking/doctors"));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't load doctors.");
        setDoctors(data.doctors || []);
      } catch (e: any) {
        setDoctorsError(e?.message || "Couldn't load the doctor list.");
      }
    })();
  }, []);

  function updateContact(i: number, patch: Partial<Contact>) {
    setContacts((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function addFile(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    setFiles((prev) => {
      const next = [...prev];
      for (const f of incoming) {
        if (next.length >= MAX_FILES) break;
        // Mirrors the server's ALLOWED_UPLOAD_MIME — checked here too purely to
        // save the user a round trip, the server is what actually enforces it.
        const ok = ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(f.type);
        if (!ok) {
          setError(`${f.name} isn't a PDF or image — only PDF, PNG, JPEG and WebP can be attached.`);
          continue;
        }
        if (f.size > MAX_FILE_MB * 1024 * 1024) {
          setError(`${f.name} is larger than ${MAX_FILE_MB} MB.`);
          continue;
        }
        next.push(f);
      }
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      // multipart/form-data so the report files can ride along. The browser
      // must set the Content-Type boundary itself, so this deliberately does
      // NOT go through apiFetch (which hardcodes application/json).
      const fd = new FormData();
      fd.append("nationalId", form.nationalId);
      fd.append("fullName", form.fullName);
      fd.append("dateOfBirth", form.dateOfBirth);
      fd.append("gender", form.gender);
      fd.append("phoneNumber", form.phoneNumber);
      fd.append("email", form.email);
      fd.append("address", form.address);
      fd.append("bloodGroup", form.bloodGroup);
      fd.append("allergies", form.allergies);
      fd.append("chronicConditions", form.chronicConditions);
      fd.append("weightKg", form.weightKg);
      fd.append("pediatricianName", form.pediatricianName);
      fd.append("pediatricianPhone", form.pediatricianPhone);
      fd.append("doctorId", form.doctorId);
      fd.append("reason", form.reason);
      contacts.forEach((c, i) => {
        if (c.fullName.trim() && c.phoneNumber.trim()) {
          fd.append(`contacts[${i}].fullName`, c.fullName);
          fd.append(`contacts[${i}].relationshipType`, c.relationshipType);
          fd.append(`contacts[${i}].phoneNumber`, c.phoneNumber);
        }
      });
      files.forEach((f) => fd.append("reports", f));

      const res = await fetch(apiUrl("/api/booking/requests"), {
        credentials: "include",
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Could not send your request.");
        setFieldErrors(data?.fieldErrors || {});
        return;
      }
      setDone({ doctorName: data.request.doctorName, attachments: data.request.attachments });
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <Card className="p-6 max-w-md">
        <div className="eyebrow text-teal mb-2">Request sent</div>
        <h2 className="font-display text-xl mb-3">That's with {done.doctorName} now</h2>
        <p className="text-sm text-sage leading-relaxed">
          Your request has been sent{done.attachments > 0 ? ` with ${done.attachments} report${done.attachments === 1 ? "" : "s"} attached` : ""}.
          The doctor will review it and allocate a date and time for you — you'll see it on your
          appointments once they confirm.
        </p>
        <p className="text-sm text-sage leading-relaxed mt-4">
          You can sign in any time with your National ID to check on it.
        </p>
        <div className="mt-6 flex gap-3">
          <Link href="/patient/login">
            <Button>Go to My Reports</Button>
          </Link>
          <Link href="/">
            <Button variant="ghost">Back to home</Button>
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-2xl">
      <Card className="p-5 space-y-4">
        <div className="eyebrow text-sage">Your details</div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Full name" hint={fieldErrors.fullName}>
            <input
              className={inputClass}
              placeholder="e.g. Hassan Tariq"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
              autoFocus
            />
          </Field>
          <Field label="Date of birth" hint={fieldErrors.dateOfBirth}>
            <input
              type="date"
              className={inputClass}
              value={form.dateOfBirth}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
              required
            />
          </Field>
          <Field
            label={isMinor ? "B-Form number" : "CNIC / National ID"}
            hint={fieldErrors.nationalId}
          >
            <input
              className={`${inputClass} font-mono`}
              placeholder="12345-1234567-1"
              value={form.nationalId}
              onChange={(e) => setForm({ ...form, nationalId: formatNationalId(e.target.value) })}
              required
              inputMode="numeric"
            />
          </Field>
          <Field label="Gender" hint={fieldErrors.gender}>
            <select
              className={inputClass}
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value })}
            >
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Phone number" hint={fieldErrors.phoneNumber}>
            <input
              type="tel"
              inputMode="tel"
              className={inputClass}
              placeholder="03xx-xxxxxxx"
              value={form.phoneNumber}
              onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
              required
            />
          </Field>
          <Field label="Email" hint={fieldErrors.email || "Optional"}>
            <input
              type="email"
              className={inputClass}
              placeholder="name@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Address" hint="Optional">
          <input
            className={inputClass}
            placeholder="Street, city"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </Field>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="eyebrow text-sage">Medical profile</div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Blood group" hint={fieldErrors.bloodGroup}>
            <select
              className={`${inputClass} max-w-[160px]`}
              value={form.bloodGroup}
              onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })}
            >
              {BLOOD_GROUPS.map((bg) => (
                <option key={bg} value={bg}>
                  {bg === "unknown" ? "Unknown" : bg}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Weight (kg)" hint={fieldErrors.weightKg || "Optional — helps emergency dosing"}>
            <input
              type="number"
              step="0.1"
              min="0"
              className={inputClass}
              placeholder="e.g. 68"
              value={form.weightKg}
              onChange={(e) => setForm({ ...form, weightKg: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Allergies" hint="Optional — shown to anyone who scans your ID in an emergency">
          <input
            className={inputClass}
            placeholder="e.g. Penicillin, peanuts"
            value={form.allergies}
            onChange={(e) => setForm({ ...form, allergies: e.target.value })}
          />
        </Field>
        <Field label="Ongoing conditions" hint="Optional">
          <input
            className={inputClass}
            placeholder="e.g. Type 2 diabetes, hypertension"
            value={form.chronicConditions}
            onChange={(e) => setForm({ ...form, chronicConditions: e.target.value })}
          />
        </Field>
        {isMinor && (
          <>
            <div className="eyebrow text-sage pt-2">Pediatric care (optional)</div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Pediatrician's name">
                <input
                  className={inputClass}
                  placeholder="e.g. Dr. Ayesha Malik"
                  value={form.pediatricianName}
                  onChange={(e) => setForm({ ...form, pediatricianName: e.target.value })}
                />
              </Field>
              <Field label="Pediatrician's phone">
                <input
                  className={inputClass}
                  placeholder="03xx-xxxxxxx"
                  value={form.pediatricianPhone}
                  onChange={(e) => setForm({ ...form, pediatricianPhone: e.target.value })}
                />
              </Field>
            </div>
          </>
        )}
      </Card>

      <Card className="p-5 space-y-4">
        <div className="eyebrow text-sage">Emergency contact</div>
        {fieldErrors.contacts && <p className="text-sm text-alert">{fieldErrors.contacts}</p>}
        <div className="grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
          <Field label="Name">
            <input
              className={inputClass}
              placeholder="Contact name"
              value={contacts[0].fullName}
              onChange={(e) => updateContact(0, { fullName: e.target.value })}
            />
          </Field>
          <Field label="Relationship">
            <select
              className={inputClass}
              value={contacts[0].relationshipType}
              onChange={(e) => updateContact(0, { relationshipType: e.target.value })}
            >
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              inputMode="tel"
              className={inputClass}
              placeholder="03xx-xxxxxxx"
              value={contacts[0].phoneNumber}
              onChange={(e) => updateContact(0, { phoneNumber: e.target.value })}
            />
          </Field>
          <div className="pb-2.5" />
        </div>
        {contacts.length < 3 && (
          <button
            type="button"
            onClick={() => setContacts((cs) => [...cs, emptyContact()])}
            className="focus-ring text-sm font-medium text-teal-dark hover:underline"
          >
            + Add another
          </button>
        )}
        {contacts.length > 1 && (
          <div className="space-y-3">
            {contacts.slice(1).map((c, idx) => (
              <div key={idx} className="grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
                <Field label="Name">
                  <input
                    className={inputClass}
                    value={c.fullName}
                    onChange={(e) => updateContact(idx + 1, { fullName: e.target.value })}
                  />
                </Field>
                <Field label="Relationship">
                  <select
                    className={inputClass}
                    value={c.relationshipType}
                    onChange={(e) => updateContact(idx + 1, { relationshipType: e.target.value })}
                  >
                    {RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Phone">
                  <input
                    type="tel"
                    inputMode="tel"
                    className={inputClass}
                    value={c.phoneNumber}
                    onChange={(e) => updateContact(idx + 1, { phoneNumber: e.target.value })}
                  />
                </Field>
                <button
                  type="button"
                  onClick={() => setContacts((cs) => cs.filter((_, i) => i !== idx + 1))}
                  className="focus-ring text-sm text-sage hover:text-alert pb-2.5"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-4">
        <div className="eyebrow text-sage">Existing reports (optional)</div>
        <p className="text-xs text-sage leading-relaxed">
          Anything you already have — lab results, discharge summaries, a referral letter. The
          doctor sees these alongside your request. PDF, PNG, JPEG or WebP, up to {MAX_FILE_MB} MB
          each, {MAX_FILES} files max.
        </p>
        <input
          type="file"
          multiple
          accept="application/pdf,image/png,image/jpeg,image/webp"
          onChange={(e) => addFile(e.target.files)}
          className="focus-ring block w-full text-sm text-sage file:mr-3 file:rounded-lg file:border file:border-line file:bg-white file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-ink hover:file:border-teal"
        />
        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-ink">{f.name}</span>
                <span className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-sage">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="focus-ring text-xs text-sage hover:text-alert"
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5 space-y-4">
        <div className="eyebrow text-sage">Who would you like to see?</div>
        {doctorsError ? (
          <p className="text-sm text-alert">{doctorsError}</p>
        ) : (
          <Field label="Doctor" hint={fieldErrors.doctorId}>
            <select
              className={inputClass}
              value={form.doctorId}
              onChange={(e) => setForm({ ...form, doctorId: e.target.value })}
              required
            >
              <option value="">{doctors.length ? "Choose a doctor…" : "Loading doctors…"}</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                  {d.specialization ? ` — ${d.specialization}` : ""}
                  {d.hospitalName ? ` (${d.hospitalName})` : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field
          label="Reason for the visit"
          hint="Optional — helps the doctor prepare"
        >
          <textarea
            className={`${inputClass} min-h-[80px]`}
            placeholder="e.g. Persistent cough for three weeks, worse at night"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </Field>
        <div className="rounded-lg bg-teal-light px-3.5 py-2.5 text-sm text-teal-dark">
          You pick the doctor — they pick the date and time. Once they confirm a slot it appears on
          your appointments, and you'll get a reminder the day before.
        </div>
      </Card>

      {error && <p className="text-sm text-alert">{error}</p>}

      <div className="flex justify-end gap-3">
        <Link href="/">
          <Button variant="ghost" type="button">
            Cancel
          </Button>
        </Link>
        <Button type="submit" disabled={loading || doctors.length === 0}>
          {loading ? "Sending…" : "Send request"}
        </Button>
      </div>
    </form>
  );
}