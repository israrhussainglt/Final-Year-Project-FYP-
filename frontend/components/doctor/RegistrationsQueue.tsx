"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, inputClass, formatDate } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";

export type RegistrationRow = {
  id: string;
  nationalId: string;
  fullName: string;
  dateOfBirth: string;
  isMinor: boolean;
  gender: string;
  phoneNumber: string;
  email: string | null;
  bloodGroup: string;
  allergies: string | null;
  chronicConditions: string | null;
  weightKg: number | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  attachmentCount: number;
  patientId: string | null;
  // Set when the submitted National ID already belongs to a registered
  // patient. Approving then books a follow-up appointment onto that record
  // rather than creating a second patient with the same ID.
  matchedPatientId: string | null;
  appointmentId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type Attachment = { id: string; originalName: string; mimeType: string; sizeBytes: number };
type Detail = {
  registration: RegistrationRow & {
    address: string | null;
    pediatricianName: string | null;
    pediatricianPhone: string | null;
    contacts: { fullName?: string; relationshipType?: string; phoneNumber?: string }[];
  };
  attachments: Attachment[];
};

const STATUS_TONES = { pending: "teal", approved: "sage", rejected: "alert" } as const;

// The doctor allocates the slot here — patients never pick a time, so this
// picker defaults to tomorrow 10:00 and is floored at "now", same convention as
// AppointmentActions.
function defaultDateTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RegistrationsQueue({ registrations }: { registrations: RegistrationRow[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [slot, setSlot] = useState(defaultDateTime);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minSlot] = useState(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  async function toggle(row: RegistrationRow) {
    setError(null);
    if (openId === row.id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(row.id);
    setDetail(null);
    setSlot(defaultDateTime());
    setLoadingDetail(true);
    try {
      const res = await fetch(apiUrl(`/api/doctor/registrations/${row.id}`), { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't load that request.");
        return;
      }
      setDetail(data);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function act(id: string, action: "allocate" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/doctor/registrations/${id}/${action}`), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: action === "allocate" ? JSON.stringify({ scheduledAt: new Date(slot).toISOString() }) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Couldn't update that request.");
        return;
      }
      setOpenId(null);
      setDetail(null);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (registrations.length === 0) {
    return (
      <p className="text-sm text-sage">
        No booking requests yet. When someone sends one through the public “Book a meeting” page
        and picks you, it lands here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {registrations.map((r) => (
        <Card key={r.id} className="p-4">
          <button
            type="button"
            onClick={() => toggle(r)}
            className="focus-ring w-full text-left flex flex-wrap items-center justify-between gap-3"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-ink">{r.fullName}</span>
                <Badge tone={STATUS_TONES[r.status]}>{r.status}</Badge>
                {r.isMinor && <Badge tone="sage">minor</Badge>}
                {r.matchedPatientId && <Badge tone="teal">existing patient</Badge>}
                {r.attachmentCount > 0 && (
                  <Badge tone="sage">
                    {r.attachmentCount} report{r.attachmentCount === 1 ? "" : "s"}
                  </Badge>
                )}
              </span>
              <span className="block text-xs text-sage mt-1 font-mono">{r.nationalId}</span>
              {r.reason && <span className="block text-xs text-sage mt-1">“{r.reason}”</span>}
            </span>
            <span className="text-xs text-sage shrink-0">{formatDate(r.createdAt)}</span>
          </button>

          {openId === r.id && (
            <div className="mt-4 pt-4 border-t border-line space-y-4">
              {loadingDetail ? (
                <p className="text-sm text-sage">Loading…</p>
              ) : detail ? (
                <>
                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-sage">Date of birth</div>
                      <div className="text-ink">{detail.registration.dateOfBirth}</div>
                    </div>
                    <div>
                      <div className="text-xs text-sage">Phone</div>
                      <div className="text-ink">{detail.registration.phoneNumber}</div>
                    </div>
                    <div>
                      <div className="text-xs text-sage">Blood group</div>
                      <div className="text-ink">{detail.registration.bloodGroup}</div>
                    </div>
                    <div>
                      <div className="text-xs text-sage">Allergies</div>
                      <div className="text-ink">{detail.registration.allergies || "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-sage">Ongoing conditions</div>
                      <div className="text-ink">{detail.registration.chronicConditions || "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-sage">Emergency contact</div>
                      <div className="text-ink">
                        {detail.registration.contacts.length
                          ? detail.registration.contacts
                              .map((c) => `${c.fullName ?? "?"} (${c.relationshipType ?? "?"})`)
                              .join(", ")
                          : "—"}
                      </div>
                    </div>
                  </div>

                  {detail.attachments.length > 0 && (
                    <div>
                      <div className="eyebrow text-sage mb-2">Attached reports</div>
                      <ul className="space-y-1.5">
                        {detail.attachments.map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                            <span className="truncate text-ink">{a.originalName}</span>
                            <span className="flex items-center gap-3 shrink-0">
                              <span className="text-xs text-sage">
                                {(a.sizeBytes / 1024).toFixed(0)} KB
                              </span>
                              <a
                                href={apiUrl(
                                  `/api/doctor/registrations/${r.id}/attachments/${a.id}`
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="focus-ring text-xs font-medium text-teal-dark hover:underline"
                              >
                                Download
                              </a>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {r.status === "pending" ? (
                    <div className="flex flex-wrap items-end gap-3">
                      {r.matchedPatientId && (
                        <p className="w-full rounded-lg bg-teal-light px-3.5 py-2.5 text-sm text-teal-dark">
                          This National ID already belongs to a registered patient. Confirming books the
                          appointment onto their existing record — their saved details and emergency
                          contacts are left untouched.
                        </p>
                      )}
                      <Field label="Appointment date & time" hint={error || undefined}>
                        <input
                          type="datetime-local"
                          className={`${inputClass} w-auto`}
                          value={slot}
                          min={minSlot}
                          onChange={(e) => setSlot(e.target.value)}
                        />
                      </Field>
                      <Button disabled={busy} onClick={() => act(r.id, "allocate")}>
                        {busy
                          ? "Working…"
                          : r.matchedPatientId
                            ? "Confirm appointment"
                            : "Confirm & create record"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-alert hover:bg-alert-light"
                        disabled={busy}
                        onClick={() => {
                          if (confirm("Reject this request? Their uploaded reports will be deleted.")) {
                            act(r.id, "reject");
                          }
                        }}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-sage">
                      {r.status === "approved" ? "Approved" : "Rejected"} by{" "}
                      {r.reviewedBy || "a doctor"}
                      {r.reviewedAt ? ` on ${formatDate(r.reviewedAt)}` : ""}.
                      {r.patientId && (
                        <a
                          href={`/doctor/patients/${r.patientId}`}
                          className="ml-1 font-medium text-teal-dark hover:underline"
                        >
                          Open the chart →
                        </a>
                      )}
                    </p>
                  )}
                </>
              ) : null}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}