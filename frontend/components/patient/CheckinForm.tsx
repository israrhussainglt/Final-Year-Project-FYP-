"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Field, inputClass, Badge } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";
import type { PendingFollowupCheckin } from "@/lib/types";

// One check-in at a time: scale questions render as a labelled 0-10
// slider, yes/no as two buttons, free text as a textarea. Submitting
// posts straight to the backend, which does the rule-based risk flagging
// itself — nothing here decides whether an answer is concerning.
export function CheckinForm({ checkin }: { checkin: PendingFollowupCheckin }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/patient/followups/checkins/${checkin.id}/respond`), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify({ responses: answers }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not submit your answers.");
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <Card className="p-5 border-teal">
        <Badge tone="teal">Submitted</Badge>
        <p className="text-sm mt-2">Thanks — your care team has been notified if anything needs their attention.</p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="eyebrow text-teal mb-1">{checkin.pathology}</div>
      <h2 className="font-display text-xl mb-4">Quick check-in</h2>
      <form onSubmit={onSubmit} className="space-y-4">
        {checkin.questions.map((q) => (
          <Field key={q.id} label={q.text}>
            {q.type === "scale" && (
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={10}
                  value={answers[q.id] ?? "0"}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  className="flex-1"
                />
                <span className="w-8 text-center font-medium">{answers[q.id] ?? "0"}</span>
              </div>
            )}
            {q.type === "yes_no" && (
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant={answers[q.id] === "yes" ? "primary" : "secondary"}
                  onClick={() => setAnswer(q.id, "yes")}
                >
                  Yes
                </Button>
                <Button
                  type="button"
                  variant={answers[q.id] === "no" ? "primary" : "secondary"}
                  onClick={() => setAnswer(q.id, "no")}
                >
                  No
                </Button>
              </div>
            )}
            {q.type === "text" && (
              <textarea
                className={`${inputClass} min-h-[70px]`}
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}
          </Field>
        ))}
        {error && <p className="text-sm text-alert">{error}</p>}
        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={loading}>
            {loading ? "Submitting…" : "Submit"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
