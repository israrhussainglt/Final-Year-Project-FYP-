"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";

export function LeaveWaitlistButton({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onLeave() {
    if (!confirm("Leave this waitlist?")) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/patient/waitlist/${entryId}/cancel`), {
        credentials: "include",
        method: "POST",
        headers: { "x-csrf-token": readCsrfCookie() || "" },
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not leave the waitlist.");
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="ghost" className="text-alert hover:bg-alert-light" onClick={onLeave} disabled={loading}>
        {loading ? "Leaving…" : "Leave"}
      </Button>
      {error && <p className="text-xs text-alert">{error}</p>}
    </div>
  );
}
