"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, inputClass } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";

type WaitlistEntry = { id: string; patientId: string; patientName: string; reason: string | null; createdAt: string };

function defaultDateTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DoctorWaitlistPanel() {
  const router = useRouter();
  const [entries, setEntries] = useState<WaitlistEntry[] | null>(null);
  const [offeringFor, setOfferingFor] = useState<string | null>(null);
  const [time, setTime] = useState(defaultDateTime());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/doctor/waitlist"), { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setEntries(data.entries || []))
      .catch(() => setEntries([]));
  }, []);

  async function offer(entryId: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/doctor/waitlist/${entryId}/offer`), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify({ scheduledAt: new Date(time).toISOString() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEntries((prev) => (prev || []).filter((e) => e.id !== entryId));
        setOfferingFor(null);
        router.refresh();
      } else {
        setError(data.error || "Could not offer this slot.");
      }
    } finally {
      setLoading(false);
    }
  }

  if (entries === null || entries.length === 0) return null;

  return (
    <div className="mb-10">
      <div className="eyebrow text-sage mb-4">Waitlist ({entries.length})</div>
      <div className="space-y-3">
        {entries.map((e) => (
          <Card key={e.id} className="p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <Link href={`/doctor/patients/${e.patientId}`} className="font-medium text-ink hover:text-teal-dark">
                  {e.patientName}
                </Link>
                {e.reason && <div className="text-sm text-sage mt-1">“{e.reason}”</div>}
              </div>
              {offeringFor !== e.id && (
                <Button variant="secondary" onClick={() => setOfferingFor(e.id)}>
                  Offer a slot
                </Button>
              )}
            </div>
            {offeringFor === e.id && (
              <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-line">
                <input
                  type="datetime-local"
                  className={`${inputClass} w-auto`}
                  value={time}
                  min={defaultDateTime().slice(0, 10) + "T00:00"}
                  onChange={(ev) => setTime(ev.target.value)}
                />
                <Button onClick={() => offer(e.id)} disabled={loading}>
                  {loading ? "Booking…" : "Confirm slot"}
                </Button>
                <Button variant="ghost" onClick={() => setOfferingFor(null)} disabled={loading}>
                  Cancel
                </Button>
                {error && <p className="text-xs text-alert w-full">{error}</p>}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
