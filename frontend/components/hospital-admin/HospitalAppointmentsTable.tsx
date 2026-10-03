"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Card, inputClass } from "@/components/ui";
import { apiUrl } from "@/lib/api";

export type AppointmentStatus = "requested" | "confirmed" | "completed" | "cancelled";

export type HospitalAppointmentRow = {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  scheduledAt: string | null;
  reason: string | null;
  status: AppointmentStatus;
  recurrenceRule: "weekly" | "biweekly" | "monthly" | null;
  recurrenceIndex: number | null;
  recurrenceCount: number | null;
};

export type DoctorOption = { id: string; fullName: string; isActive?: boolean };

const STATUS_TABS: { value: AppointmentStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "requested", label: "Requested" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const DATE_SCOPES = [
  { value: "all", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
] as const;
type DateScope = (typeof DATE_SCOPES)[number]["value"];

function isSameDay(d: Date, ref: Date): boolean {
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

function matchesDateScope(scheduledAt: string | null, scope: DateScope): boolean {
  if (scope === "all") return true;
  if (!scheduledAt) return false;
  const d = new Date(scheduledAt);
  const now = new Date();
  if (scope === "today") return isSameDay(d, now);
  if (scope === "upcoming") return d.getTime() >= now.getTime();
  return d.getTime() < now.getTime();
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(rows: HospitalAppointmentRow[]) {
  const header = ["Patient", "Doctor", "Scheduled at", "Status", "Reason"];
  const lines = rows.map((a) =>
    [a.patientName, a.doctorName, a.scheduledAt || "", statusLabel(a.status), a.reason || ""]
      .map((v) => csvEscape(String(v)))
      .join(",")
  );
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `appointments-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function statusTone(status: AppointmentStatus): "teal" | "alert" | "sage" {
  if (status === "confirmed") return "teal";
  if (status === "cancelled") return "alert";
  return "sage";
}

function statusLabel(status: AppointmentStatus): string {
  return { requested: "Requested", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" }[status];
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "No date set yet";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Fetches fresh from the API on every status/doctor filter change instead of
// filtering an initial server-rendered list client-side — a large
// hospital's full appointment log across every doctor can be a lot of rows,
// so pushing that filter down to the query keeps this to one small response
// instead of shipping everything up front. Date-scope and name search stay
// client-side since they're cheap to apply to whatever page of results is
// already in memory.
export function HospitalAppointmentsTable({
  initialAppointments,
  doctors,
}: {
  initialAppointments: HospitalAppointmentRow[];
  doctors: DoctorOption[];
}) {
  const [status, setStatus] = useState<AppointmentStatus | "all">("all");
  const [doctorId, setDoctorId] = useState<string>("all");
  const [dateScope, setDateScope] = useState<DateScope>("all");
  const [search, setSearch] = useState("");
  const [appointments, setAppointments] = useState(initialAppointments);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    // Skip the redundant fetch on first render — we already have the
    // server-rendered "all" list.
    if (status === "all" && doctorId === "all") {
      setAppointments(initialAppointments);
      setError(null);
      return;
    }
    const thisRequest = ++requestId.current;
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (doctorId !== "all") params.set("doctorId", doctorId);
    setLoading(true);
    setError(null);
    fetch(apiUrl(`/api/hospital-admin/appointments?${params.toString()}`), { credentials: "include" })
      .then(async (res) => {
        // A slower earlier request can resolve after a newer one — ignore
        // anything that isn't the most recent filter change.
        if (thisRequest !== requestId.current) return;
        if (!res.ok) {
          setError("Couldn't load appointments for that filter. Try again.");
          return;
        }
        const data = await res.json();
        setAppointments(data.appointments || []);
      })
      .catch(() => {
        if (thisRequest === requestId.current) setError("Couldn't reach the server. Check your connection.");
      })
      .finally(() => {
        if (thisRequest === requestId.current) setLoading(false);
      });
  }, [status, doctorId, initialAppointments]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return appointments.filter((a) => {
      if (!matchesDateScope(a.scheduledAt, dateScope)) return false;
      if (!q) return true;
      return (
        a.patientName.toLowerCase().includes(q) ||
        a.doctorName.toLowerCase().includes(q) ||
        (a.reason || "").toLowerCase().includes(q)
      );
    });
  }, [appointments, search, dateScope]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: appointments.length };
    for (const a of appointments) c[a.status] = (c[a.status] || 0) + 1;
    return c;
  }, [appointments]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-5">
        <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              role="tab"
              aria-selected={status === tab.value}
              onClick={() => setStatus(tab.value)}
              className={`focus-ring rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                status === tab.value ? "bg-ink text-white" : "bg-white border border-line text-sage hover:text-ink"
              }`}
            >
              {tab.label}
              {tab.value === "all" || counts[tab.value] === undefined ? "" : ` (${counts[tab.value]})`}
            </button>
          ))}
        </div>

        <select
          value={dateScope}
          onChange={(e) => setDateScope(e.target.value as DateScope)}
          aria-label="Filter by date"
          className={`${inputClass} w-auto min-w-[130px]`}
        >
          {DATE_SCOPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <select
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          aria-label="Filter by doctor"
          className={`${inputClass} w-auto min-w-[180px]`}
        >
          <option value="all">All doctors</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
              {d.isActive === false ? " (deactivated)" : ""}
            </option>
          ))}
        </select>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by patient, doctor, or reason…"
          aria-label="Search appointments"
          className={`${inputClass} flex-1 min-w-[220px]`}
        />

        <button
          onClick={() => downloadCsv(visible)}
          disabled={visible.length === 0}
          className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-sage hover:border-teal hover:text-teal-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          ⬇ Export CSV
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-alert/30 bg-alert-light px-4 py-3 text-sm text-alert">
          {error}
        </div>
      )}

      <div className={loading ? "opacity-50 transition-opacity" : "transition-opacity"} aria-busy={loading}>
        {visible.length === 0 && !loading ? (
          <div className="text-sm text-sage py-6">No appointments match these filters.</div>
        ) : (
          <div className="space-y-3">
            {visible.map((a) => (
              <Card key={a.id} className="p-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/hospital-admin/patients/${a.patientId}`}
                      className="font-medium text-ink hover:text-teal-dark"
                    >
                      {a.patientName}
                    </Link>
                    <span className="text-sage text-sm">with</span>
                    <span className="text-sm text-ink">{a.doctorName}</span>
                  </div>
                  <div className={`text-sm mt-1 ${a.scheduledAt ? "text-sage" : "text-alert"}`}>
                    {formatDateTime(a.scheduledAt)}
                  </div>
                  {a.reason && <div className="text-sm text-sage mt-1">“{a.reason}”</div>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {a.recurrenceRule && (
                    <Badge tone="sage">
                      {a.recurrenceIndex}/{a.recurrenceCount}
                    </Badge>
                  )}
                  <Badge tone={statusTone(a.status)}>{statusLabel(a.status)}</Badge>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
