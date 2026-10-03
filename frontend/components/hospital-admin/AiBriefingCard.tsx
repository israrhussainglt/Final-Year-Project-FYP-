"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";

// Generalized version of the loading/error/render lifecycle originally
// written for AiAppointmentInsights — now shared by every hospital-admin AI
// briefing (today's load, doctor workload balance, weekly digest) so adding
// a new one is a config object, not a new component. Each of these calls a
// backend route that only ever receives already-aggregated counts (see the
// route comments in server.ts) — never patient names or clinical details.
export function AiBriefingCard({
  endpoint,
  eyebrow,
  label,
  regenerateLabel,
  description,
  accent = "teal",
}: {
  endpoint: string;
  eyebrow: string;
  label: string;
  regenerateLabel?: string;
  description: string;
  accent?: "teal" | "amber" | "sage";
}) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(endpoint), {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": readCsrfCookie() || "" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't generate this briefing right now.");
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
        <div className={`eyebrow text-${accent}`}>{eyebrow}</div>
        <Button variant="secondary" onClick={generate} disabled={loading}>
          {loading ? "Thinking…" : text ? regenerateLabel || "Regenerate" : label}
        </Button>
      </div>
      {error && <p className="text-sm text-alert">{error}</p>}
      {!error && !text && !loading && <p className="text-sm text-sage">{description}</p>}
      {text && <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>}
    </Card>
  );
}
