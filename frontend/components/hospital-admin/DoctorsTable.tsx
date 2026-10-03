"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, inputClass } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";
import { DoctorAuditModal } from "@/components/hospital-admin/DoctorAuditModal";

export type DoctorRow = {
  id: string;
  fullName: string;
  email: string;
  licenseNumber: string;
  specialization: string | null;
  isActive: boolean;
};

function SpecializationCell({ doctor }: { doctor: DoctorRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(doctor.specialization || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/hospital-admin/doctors/${doctor.id}`), {
        credentials: "include",
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify({ specialization: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not save.");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        className="focus-ring text-left text-sage hover:text-ink underline decoration-dotted underline-offset-4"
        onClick={() => setEditing(true)}
        title="Edit specialization"
      >
        {doctor.specialization || "— add specialization —"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        className={`${inputClass} py-1.5 text-sm`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <button className="focus-ring text-xs font-medium text-teal-dark" onClick={save} disabled={saving}>
        {saving ? "…" : "Save"}
      </button>
      <button className="focus-ring text-xs text-sage" onClick={() => setEditing(false)}>
        Cancel
      </button>
      {error && <span className="text-xs text-alert">{error}</span>}
    </div>
  );
}

function ActiveToggle({ doctor }: { doctor: DoctorRow }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    try {
      const action = doctor.isActive ? "deactivate" : "reactivate";
      const res = await fetch(apiUrl(`/api/hospital-admin/doctors/${doctor.id}/${action}`), {
        credentials: "include",
        method: "POST",
        headers: { "x-csrf-token": readCsrfCookie() || "" },
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant={doctor.isActive ? "secondary" : "primary"} className="text-xs px-3 py-1.5" onClick={toggle} disabled={loading}>
      {loading ? "…" : doctor.isActive ? "Deactivate" : "Reactivate"}
    </Button>
  );
}

export function DoctorsTable({ doctors }: { doctors: DoctorRow[] }) {
  const [query, setQuery] = useState("");
  const [auditFor, setAuditFor] = useState<{ id: string; name: string } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return doctors;
    return doctors.filter(
      (d) => d.fullName.toLowerCase().includes(q) || d.email.toLowerCase().includes(q) || d.licenseNumber.toLowerCase().includes(q)
    );
  }, [doctors, query]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <input
          className={`${inputClass} sm:max-w-xs`}
          placeholder="Filter by name, email, or license…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-xs text-sage">
          {filtered.length} of {doctors.length} doctor{doctors.length === 1 ? "" : "s"}
        </span>
      </div>

      {filtered.length === 0 && <Card className="p-8 text-center text-sm text-sage">No doctors match “{query}”.</Card>}

      {filtered.length > 0 && (
        <>
          <Card className="hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-paper border-b border-line text-left text-xs text-sage uppercase tracking-wide">
                  <th className="px-5 py-3 font-medium">Doctor</th>
                  <th className="px-5 py-3 font-medium">License</th>
                  <th className="px-5 py-3 font-medium">Specialization</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id} className="border-b border-line last:border-0 hover:bg-teal-light/40 transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-medium text-ink">{d.fullName}</div>
                      <div className="text-xs text-sage">{d.email}</div>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-sage">{d.licenseNumber}</td>
                    <td className="px-5 py-3">
                      <SpecializationCell doctor={d} />
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={d.isActive ? "teal" : "sage"}>{d.isActive ? "Active" : "Deactivated"}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          className="focus-ring text-xs font-medium text-teal-dark hover:underline"
                          onClick={() => setAuditFor({ id: d.id, name: d.fullName })}
                        >
                          View activity
                        </button>
                        <ActiveToggle doctor={d} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="grid md:hidden gap-4">
            {filtered.map((d) => (
              <Card key={d.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-ink truncate">{d.fullName}</div>
                    <div className="text-xs text-sage truncate">{d.email}</div>
                    <div className="text-xs text-sage font-mono mt-0.5">{d.licenseNumber}</div>
                  </div>
                  <Badge tone={d.isActive ? "teal" : "sage"}>{d.isActive ? "Active" : "Deactivated"}</Badge>
                </div>
                <div className="mt-3 text-sm">
                  <SpecializationCell doctor={d} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    className="focus-ring text-xs font-medium text-teal-dark hover:underline"
                    onClick={() => setAuditFor({ id: d.id, name: d.fullName })}
                  >
                    View activity
                  </button>
                  <ActiveToggle doctor={d} />
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {auditFor && (
        <DoctorAuditModal doctorId={auditFor.id} doctorName={auditFor.name} onClose={() => setAuditFor(null)} />
      )}
    </div>
  );
}
