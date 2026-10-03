"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, inputClass } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";

// Local datetime-local input wants "YYYY-MM-DDTHH:mm" with no timezone —
// default to tomorrow at 10:00 so the field never opens on a past minute.
function defaultDateTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AppointmentActions({
  appointmentId,
  status,
  scheduledAt,
}: {
  appointmentId: string;
  status: string;
  scheduledAt?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  // Only the doctor/clinic ever picks the date & time — this is where that
  // happens, either to confirm a bare request or to move an existing slot.
  const [pickingTime, setPickingTime] = useState(false);
  const [time, setTime] = useState(defaultDateTime());
  const [error, setError] = useState<string | null>(null);
  // Recurrence is only offered when confirming a fresh request (not on a
  // reschedule of an already-confirmed slot) — turning an existing series
  // occurrence into a new series isn't supported here.
  const [recurring, setRecurring] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<"weekly" | "biweekly" | "monthly">("weekly");
  const [recurrenceCount, setRecurrenceCount] = useState(4);

  async function setStatus(next: string, withScheduledAt?: string) {
    if (next === "cancelled" && !confirm("Cancel this appointment?")) return;
    setLoading(next);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/doctor/appointments/${appointmentId}/status`), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify({
          status: next,
          ...(withScheduledAt ? { scheduledAt: new Date(withScheduledAt).toISOString() } : {}),
          ...(withScheduledAt && recurring && status === "requested"
            ? { recurrence: { rule: recurrenceRule, count: recurrenceCount } }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPickingTime(false);
        router.refresh();
      } else {
        setError(data.error || "Could not update the appointment.");
      }
    } finally {
      setLoading(null);
    }
  }

  if (pickingTime) {
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <input
            type="datetime-local"
            className={`${inputClass} w-auto`}
            value={time}
            min={defaultDateTime().slice(0, 10) + "T00:00"}
            onChange={(e) => setTime(e.target.value)}
          />
          <Button
            variant="secondary"
            onClick={() => setStatus("confirmed", time)}
            disabled={loading !== null}
          >
            {loading === "confirmed" ? "Confirming…" : status === "confirmed" ? "Save new time" : "Confirm"}
          </Button>
          <Button variant="ghost" onClick={() => setPickingTime(false)} disabled={loading !== null}>
            Cancel
          </Button>
        </div>
        {status === "requested" && (
          <div className="flex items-center gap-2 flex-wrap justify-end text-xs">
            <label className="flex items-center gap-1.5 text-sage">
              <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
              Repeat for follow-ups
            </label>
            {recurring && (
              <>
                <select
                  className="focus-ring rounded-md border border-line bg-white px-2 py-1 text-xs"
                  value={recurrenceRule}
                  onChange={(e) => setRecurrenceRule(e.target.value as typeof recurrenceRule)}
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
                <span className="text-sage">×</span>
                <input
                  type="number"
                  min={2}
                  max={26}
                  className="focus-ring w-14 rounded-md border border-line bg-white px-2 py-1 text-xs"
                  value={recurrenceCount}
                  onChange={(e) => setRecurrenceCount(Math.max(2, Math.min(26, Number(e.target.value) || 2)))}
                />
                <span className="text-sage">occurrences</span>
              </>
            )}
          </div>
        )}
        {error && <p className="text-xs text-alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {status === "requested" && (
        <Button variant="secondary" onClick={() => setPickingTime(true)} disabled={loading !== null}>
          {scheduledAt ? "Confirm" : "Choose time & confirm"}
        </Button>
      )}
      {status === "confirmed" && (
        <>
          <Button variant="ghost" onClick={() => setPickingTime(true)} disabled={loading !== null}>
            Reschedule
          </Button>
          <Button variant="secondary" onClick={() => setStatus("completed")} disabled={loading !== null}>
            {loading === "completed" ? "Saving…" : "Mark completed"}
          </Button>
        </>
      )}
      {(status === "requested" || status === "confirmed") && (
        <Button variant="ghost" className="text-alert hover:bg-alert-light" onClick={() => setStatus("cancelled")} disabled={loading !== null}>
          {loading === "cancelled" ? "Cancelling…" : "Cancel"}
        </Button>
      )}
      {error && <p className="text-xs text-alert">{error}</p>}
    </div>
  );
}
