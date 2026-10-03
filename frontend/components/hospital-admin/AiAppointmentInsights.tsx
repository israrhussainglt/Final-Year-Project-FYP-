"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";

// Same loading/error/render lifecycle as analytics' AiSummaryBox, adapted
// for this backend's POST + CSRF-cookie auth pattern instead of a bare
// same-origin POST. Only ever asks for a briefing over already-aggregated
// appointment counts — see the /insights route for what's actually sent.
export function AiAppointmentInsights() {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/hospital-admin/appointments/insights"), {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": readCsrfCookie() || "" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't generate insights right now.");
      setText(data.summary || "");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-5 mb-6">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="eyebrow text-teal">AI-drafted briefing</div>
        <Button variant="secondary" onClick={generate} disabled={loading}>
          {loading ? "Thinking…" : text ? "Regenerate" : "Summarize load"}
        </Button>
      </div>
      {error && <p className="text-sm text-alert">{error}</p>}
      {!error && !text && !loading && (
        <p className="text-sm text-sage">
          Get a short, AI-written read on today's appointment load — bottlenecks, overloaded doctors, or
          requests that have been waiting too long. Built only from the counts below, never patient details.
        </p>
      )}
      {text && <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>}
    </Card>
  );
}
