"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";

export function CancelAppointmentButton({ appointmentId }: { appointmentId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCancel() {
    if (!confirm("Cancel this appointment request?")) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/patient/appointments/${appointmentId}/cancel`), {
        credentials: "include",
        method: "POST",
        headers: { "x-csrf-token": readCsrfCookie() || "" },
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not cancel this appointment.");
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="ghost" className="text-alert hover:bg-alert-light" onClick={onCancel} disabled={loading}>
        {loading ? "Cancelling…" : "Cancel"}
      </Button>
      {error && <p className="text-xs text-alert">{error}</p>}
    </div>
  );
}
