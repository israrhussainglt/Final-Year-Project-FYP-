"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Field, inputClass, Badge } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";

type Dependent = {
  id: string;
  nationalId: string;
  idType: "cnic" | "b_form";
  fullName: string;
  age: number;
  gender: string;
  bloodGroup: string;
};

type PendingRequest = {
  id: string;
  minorFullName: string;
  minorNationalId: string;
  createdAt: string;
};

function formatId(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 13);
  const part1 = digits.slice(0, 5);
  const part2 = digits.slice(5, 12);
  const part3 = digits.slice(12, 13);
  return [part1, part2, part3].filter(Boolean).join("-");
}

export function DependentsView({
  initialDependents,
  initialPending,
}: {
  initialDependents: Dependent[];
  initialPending: PendingRequest[];
}) {
  const router = useRouter();
  const [dependents] = useState(initialDependents);
  const [pending, setPending] = useState(initialPending);
  const [nationalId, setNationalId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(apiUrl("/api/patient/dependents/request"), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify({ nationalId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not send that request.");
        return;
      }
      if (data.status === "linked") {
        setMessage("Linked! This dependent now shows up below.");
        setNationalId("");
        router.refresh();
      } else {
        setMessage(data.message || "Request sent — a hospital needs to approve it before this shows up here.");
        setNationalId("");
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow text-sage mb-4">Your dependents</div>
        {dependents.length === 0 ? (
          <p className="text-sm text-sage">No dependents linked yet — request one below.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {dependents.map((d) => (
              <Link key={d.id} href={`/patient/dependents/${d.id}`}>
                <Card className="p-5 h-full hover:border-teal transition-colors group">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{d.fullName}</h3>
                    <Badge tone="alert">{d.bloodGroup}</Badge>
                  </div>
                  <p className="text-sm text-sage mt-1">
                    {d.age} yrs · {d.gender} · {d.idType === "b_form" ? "B-Form" : "CNIC"} {d.nationalId}
                  </p>
                  <span className="text-sm font-semibold text-teal-dark mt-3 inline-block group-hover:translate-x-1 transition-transform">
                    View record →
                  </span>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {pending.length > 0 && (
        <div>
          <div className="eyebrow text-sage mb-4">Pending requests</div>
          <div className="space-y-3">
            {pending.map((r) => (
              <Card key={r.id} className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{r.minorFullName}</div>
                  <div className="text-xs text-sage font-mono">{r.minorNationalId}</div>
                </div>
                <Badge tone="sage">Waiting for hospital approval</Badge>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Card className="p-5">
        <div className="eyebrow text-sage mb-2">Link a dependent</div>
        <p className="text-sm text-sage mb-4 leading-relaxed">
          Enter your child's CNIC or B-Form number. If your phone number already matches a
          parent/guardian contact on their file, you'll be linked immediately — otherwise a
          hospital will need to approve the request.
        </p>
        <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <Field label="Child's CNIC or B-Form number">
              <input
                className={`${inputClass} font-mono`}
                placeholder="12345-1234567-1"
                value={nationalId}
                onChange={(e) => setNationalId(formatId(e.target.value))}
                required
                inputMode="numeric"
              />
            </Field>
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? "Sending…" : "Request link"}
          </Button>
        </form>
        {message && <p className="text-sm text-teal-dark mt-3">{message}</p>}
        {error && <p className="text-sm text-alert mt-3">{error}</p>}
      </Card>
    </div>
  );
}
