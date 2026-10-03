"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, inputClass, Badge } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";
import type { FollowupAgent } from "@/lib/types";

const PATHOLOGY_PRESETS = ["Postpartum", "Post-operative", "Chronic condition", "Other"];

// Doctor-facing "start a proactive follow-up" form, embedded on the
// patient detail page. Question sets are picked by the backend from
// followup-agent.ts's defaultQuestionsFor() based on the pathology text —
// the doctor only chooses what to monitor and how often, not the exact
// questions, keeping this quick to fill in during a visit.
export function StartFollowupForm({ patientId, existingAgents }: { patientId: string; existingAgents: FollowupAgent[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathology, setPathology] = useState("Postpartum");
  const [customPathology, setCustomPathology] = useState("");
  const [frequencyDays, setFrequencyDays] = useState(3);

  const activeAgents = existingAgents.filter((a) => a.status === "active");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const finalPathology = pathology === "Other" ? customPathology.trim() : pathology;
    if (!finalPathology) {
      setError("Please describe the follow-up type.");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(apiUrl("/api/doctor/followups"), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify({ patientId, pathology: finalPathology, frequencyDays }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not start the follow-up.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {activeAgents.length > 0 && (
        <div className="space-y-2 mb-3">
          {activeAgents.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-sm">
              <span>{a.pathology}</span>
              <Badge tone="teal">every {a.frequency_days}d</Badge>
            </div>
          ))}
        </div>
      )}

      {!open ? (
        <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
          + Start follow-up
        </Button>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Follow-up type">
            <select className={inputClass} value={pathology} onChange={(e) => setPathology(e.target.value)}>
              {PATHOLOGY_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          {pathology === "Other" && (
            <Field label="Describe it">
              <input
                className={inputClass}
                value={customPathology}
                onChange={(e) => setCustomPathology(e.target.value)}
                placeholder="e.g. Wound care monitoring"
              />
            </Field>
          )}
          <Field label="Check in every" hint="Days">
            <input
              type="number"
              min={1}
              max={90}
              className={inputClass}
              value={frequencyDays}
              onChange={(e) => setFrequencyDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
            />
          </Field>
          {error && <p className="text-sm text-alert">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Starting…" : "Start"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
