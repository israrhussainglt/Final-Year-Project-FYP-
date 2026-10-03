"use client";

import { useEffect, useState } from "react";
import { Badge, Card } from "@/components/ui";
import { apiUrl } from "@/lib/api";

type AuditEntry = {
  id: string;
  patientId: string;
  patientName: string | null;
  action: string;
  details: string | null;
  createdAt: string;
};

const ACTION_LABELS: Record<string, string> = {
  record_viewed: "Viewed record",
  record_created: "Added a record",
  record_exported: "Exported record",
  patient_registered: "Registered patient",
  patient_details_edited: "Edited patient details",
  qr_scanned: "Scanned QR/CNIC",
  physical_card_issued: "Issued physical card",
  physical_card_reissued: "Reissued physical card",
  physical_card_revoked: "Revoked physical card",
  guardian_linked: "Linked guardian",
  guardian_unlinked: "Unlinked guardian",
  guardian_link_rejected: "Rejected guardian request",
  appointment_status_changed: "Updated appointment",
  appointment_rescheduled: "Rescheduled appointment",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] || action.replace(/_/g, " ");
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso.replace(" ", "T") + "Z").toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Read-only — there is no write path in this modal on purpose. A hospital
// admin can see what a doctor has been doing (which patient, what action,
// when) without being able to open the underlying clinical record, which
// stays doctor-only.
export function DoctorAuditModal({
  doctorId,
  doctorName,
  onClose,
}: {
  doctorId: string;
  doctorName: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/hospital-admin/doctors/${doctorId}/audit-log`), {
          credentials: "include",
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || "Could not load activity.");
          return;
        }
        setEntries(data.entries || []);
      } catch {
        if (!cancelled) setError("Could not reach the server.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doctorId]);

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl border border-line shadow-card w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 border-b border-line shrink-0">
          <h2 className="font-display text-2xl mb-1">{doctorName}'s recent activity</h2>
          <p className="text-sm text-sage">
            View-only — the last 100 actions across every patient this doctor has touched. No
            clinical detail (diagnoses, notes) is shown, only what happened and when.
          </p>
        </div>

        <div className="overflow-y-auto px-6 py-4 flex-1">
          {error && <p className="text-sm text-alert">{error}</p>}
          {!error && entries === null && <p className="text-sm text-sage">Loading…</p>}
          {!error && entries && entries.length === 0 && (
            <p className="text-sm text-sage">No recorded activity yet for this doctor.</p>
          )}
          {!error && entries && entries.length > 0 && (
            <ul className="space-y-2">
              {entries.map((e) => (
                <li key={e.id}>
                  <Card className="p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge tone="teal">{actionLabel(e.action)}</Badge>
                          <span className="text-sm font-medium text-ink truncate">
                            {e.patientName || "Unknown patient"}
                          </span>
                        </div>
                        {e.details && <p className="text-xs text-sage mt-1.5">{e.details}</p>}
                      </div>
                      <span className="text-xs text-sage whitespace-nowrap shrink-0">{formatDateTime(e.createdAt)}</span>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-6 py-4 border-t border-line shrink-0 flex justify-end">
          <button className="focus-ring text-sm font-medium text-sage hover:text-ink" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
