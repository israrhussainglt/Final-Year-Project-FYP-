"use client";

import { useState } from "react";
import { Badge, Card } from "@/components/ui";
import { DoctorAuditModal } from "@/components/hospital-admin/DoctorAuditModal";

export type HospitalAdminStats = {
  doctors: { total: number; active: number; deactivated: number };
  patients: { totalSeen: number; newLast30Days: number };
  appointments: {
    byStatus: { requested: number; confirmed: number; completed: number; cancelled: number };
    upcomingNext7Days: number;
    today: number;
  };
  doctorActivity: {
    doctorId: string;
    fullName: string;
    isActive: boolean;
    visitCount: number;
    appointmentCount: number;
    lastActiveAt: string | null;
  }[];
};

function KpiCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-5">
      <div className="eyebrow text-sage">{label}</div>
      <div className="font-display text-3xl mt-1.5">{value}</div>
      {hint && <div className="text-xs text-sage mt-1">{hint}</div>}
    </Card>
  );
}

function formatLastActive(iso: string | null): string {
  if (!iso) return "No activity yet";
  try {
    return new Date(iso.replace(" ", "T") + "Z").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

const STATUS_LABELS: Record<string, string> = {
  requested: "Requested",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function StatsOverview({ stats }: { stats: HospitalAdminStats }) {
  const [auditFor, setAuditFor] = useState<{ id: string; name: string } | null>(null);
  const totalAppointments = Object.values(stats.appointments.byStatus).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Doctors"
          value={stats.doctors.active}
          hint={`${stats.doctors.active} active of ${stats.doctors.total}${
            stats.doctors.deactivated ? `, ${stats.doctors.deactivated} deactivated` : ""
          }`}
        />
        <KpiCard label="Patients seen" value={stats.patients.totalSeen} hint={`${stats.patients.newLast30Days} new in last 30 days`} />
        <KpiCard label="Appointments today" value={stats.appointments.today} hint="Confirmed or completed" />
        <KpiCard label="Upcoming (7 days)" value={stats.appointments.upcomingNext7Days} hint="Confirmed appointments" />
      </div>

      <Card className="p-5 mb-6">
        <div className="eyebrow text-sage mb-3">Appointment load</div>
        {totalAppointments === 0 ? (
          <p className="text-sm text-sage">No appointments recorded yet for this hospital's doctors.</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {(Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]).map((status) => (
              <div key={status} className="flex items-center gap-2">
                <Badge tone={status === "cancelled" ? "alert" : status === "requested" ? "sage" : "teal"}>
                  {STATUS_LABELS[status]}
                </Badge>
                <span className="font-display text-xl">{stats.appointments.byStatus[status as keyof typeof stats.appointments.byStatus]}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="eyebrow text-sage mb-3">Doctor activity</div>
      {stats.doctorActivity.length === 0 ? (
        <Card className="p-8 text-center text-sm text-sage">No doctors at this hospital yet.</Card>
      ) : (
        <>
          <Card className="hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-paper border-b border-line text-left text-xs text-sage uppercase tracking-wide">
                  <th className="px-5 py-3 font-medium">Doctor</th>
                  <th className="px-5 py-3 font-medium">Visits recorded</th>
                  <th className="px-5 py-3 font-medium">Appointments</th>
                  <th className="px-5 py-3 font-medium">Last active</th>
                  <th className="px-5 py-3 font-medium text-right">Activity</th>
                </tr>
              </thead>
              <tbody>
                {stats.doctorActivity.map((d) => (
                  <tr key={d.doctorId} className="border-b border-line last:border-0 hover:bg-teal-light/40 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{d.fullName}</span>
                        {!d.isActive && <Badge tone="sage">Deactivated</Badge>}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-ink">{d.visitCount}</td>
                    <td className="px-5 py-3 text-ink">{d.appointmentCount}</td>
                    <td className="px-5 py-3 text-sage">{formatLastActive(d.lastActiveAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        className="focus-ring text-xs font-medium text-teal-dark hover:underline"
                        onClick={() => setAuditFor({ id: d.doctorId, name: d.fullName })}
                      >
                        View activity
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="grid md:hidden gap-4">
            {stats.doctorActivity.map((d) => (
              <Card key={d.doctorId} className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink truncate">{d.fullName}</span>
                  {!d.isActive && <Badge tone="sage">Deactivated</Badge>}
                </div>
                <div className="mt-2 text-xs text-sage flex gap-4">
                  <span>{d.visitCount} visits</span>
                  <span>{d.appointmentCount} appointments</span>
                </div>
                <div className="mt-1 text-xs text-sage">Last active: {formatLastActive(d.lastActiveAt)}</div>
                <button
                  className="focus-ring mt-3 text-xs font-medium text-teal-dark hover:underline"
                  onClick={() => setAuditFor({ id: d.doctorId, name: d.fullName })}
                >
                  View activity
                </button>
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
