"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Field, inputClass, Badge } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";

type Guardian = { id: string; fullName: string; nationalId: string; phone: string } | null;
type PendingRequest = { id: string; guardianFullName: string; guardianNationalId: string; guardianPhone: string; createdAt: string };

function formatId(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 13);
  const part1 = digits.slice(0, 5);
  const part2 = digits.slice(5, 12);
  const part3 = digits.slice(12, 13);
  return [part1, part2, part3].filter(Boolean).join("-");
}

export function GuardianPanel({
  patientId,
  initialGuardian,
  initialPending,
}: {
  patientId: string;
  initialGuardian: Guardian;
  initialPending: PendingRequest[];
}) {
  const router = useRouter();
  const [guardian, setGuardian] = useState(initialGuardian);
  const [pending, setPending] = useState(initialPending);
  const [nationalId, setNationalId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function linkGuardian(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/patients/${patientId}/guardian`), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify({ guardianNationalId: nationalId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not link this guardian.");
        return;
      }
      setGuardian(data.guardian);
      setNationalId("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function unlinkGuardian() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/patients/${patientId}/guardian`), {
        credentials: "include",
        method: "DELETE",
        headers: { "x-csrf-token": readCsrfCookie() || "" },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Could not remove this link.");
        return;
      }
      setGuardian(null);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function resolveRequest(requestId: string, action: "approve" | "reject") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/patients/${patientId}/guardian-requests/${requestId}/${action}`), {
        credentials: "include",
        method: "POST",
        headers: { "x-csrf-token": readCsrfCookie() || "" },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Could not resolve this request.");
        return;
      }
      setPending((p) => p.filter((r) => r.id !== requestId));
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="eyebrow text-sage mb-3">Guardian</div>

      {guardian ? (
        <div className="text-sm">
          <div className="font-medium">{guardian.fullName}</div>
          <div className="text-sage font-mono">{guardian.nationalId}</div>
          <div className="text-sage">{guardian.phone}</div>
          <button
            type="button"
            onClick={unlinkGuardian}
            disabled={loading}
            className="focus-ring text-xs font-medium text-alert hover:underline mt-2"
          >
            Remove link
          </button>
        </div>
      ) : (
        <form onSubmit={linkGuardian} className="space-y-3">
          <Field label="Guardian's CNIC" hint="Must already have their own PulseID">
            <input
              className={`${inputClass} font-mono`}
              placeholder="12345-1234567-1"
              value={nationalId}
              onChange={(e) => setNationalId(formatId(e.target.value))}
              required
              inputMode="numeric"
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={loading} className="w-full">
            {loading ? "Linking…" : "Link guardian"}
          </Button>
        </form>
      )}

      {error && <p className="text-xs text-alert mt-2">{error}</p>}

      {pending.length > 0 && (
        <div className="mt-5 pt-4 border-t border-line space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-sage">Pending requests</div>
          {pending.map((r) => (
            <div key={r.id} className="text-sm">
              <div className="font-medium">{r.guardianFullName}</div>
              <div className="text-sage font-mono text-xs">{r.guardianNationalId}</div>
              <div className="flex gap-2 mt-1.5">
                <Badge tone="sage">Requested guardian link</Badge>
              </div>
              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => resolveRequest(r.id, "approve")}
                  disabled={loading}
                  className="focus-ring text-xs font-medium text-teal-dark hover:underline"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => resolveRequest(r.id, "reject")}
                  disabled={loading}
                  className="focus-ring text-xs font-medium text-alert hover:underline"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
