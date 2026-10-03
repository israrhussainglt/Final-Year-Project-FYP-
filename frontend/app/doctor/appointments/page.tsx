import Link from "next/link";
import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { DoctorHeader } from "@/components/doctor/DoctorHeader";
import { AppointmentActions } from "@/components/doctor/AppointmentActions";
import { DoctorWaitlistPanel } from "@/components/doctor/DoctorWaitlistPanel";
import { Card, Badge } from "@/components/ui";

type MeResponse = { role: "doctor"; session: { fullName: string; hospitalName?: string } };

type AppointmentRow = {
  id: string;
  patientId: string;
  patientName: string;
  scheduledAt: string | null;
  reason: string | null;
  status: "requested" | "confirmed" | "completed" | "cancelled";
  doctorNotes: string | null;
  recurrenceRule: "weekly" | "biweekly" | "monthly" | null;
  recurrenceIndex: number | null;
  recurrenceCount: number | null;
};

function statusTone(status: AppointmentRow["status"]): "teal" | "alert" | "sage" {
  if (status === "confirmed") return "teal";
  if (status === "cancelled") return "alert";
  return "sage";
}

function statusLabel(status: AppointmentRow["status"]): string {
  return { requested: "Requested", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" }[status];
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "No date set yet — pick one below";
  try {
    return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default async function DoctorAppointmentsPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "doctor") redirect("/doctor/login");
  const session = me.data.session;

  const list = await serverFetch<{ appointments: AppointmentRow[] }>("/api/doctor/appointments");
  const appointments = list.data?.appointments || [];
  const pending = appointments.filter((a) => a.status === "requested");
  const confirmed = appointments.filter((a) => a.status === "confirmed");
  const history = appointments.filter((a) => a.status === "completed" || a.status === "cancelled").slice(0, 20);

  return (
    <main className="min-h-screen bg-paper">
      <DoctorHeader doctorName={session?.fullName || "Doctor"} hospitalName={session?.hospitalName} />

      <div className="max-w-5xl mx-auto px-6 md:px-10 py-10">
        <div className="mb-8">
          <div className="eyebrow text-teal mb-2">Queue</div>
          <h1 className="font-display text-3xl">Appointments</h1>
        </div>

        <div className="eyebrow text-sage mb-4">Awaiting your confirmation ({pending.length})</div>
        {pending.length === 0 ? (
          <p className="text-sm text-sage mb-10">Nothing waiting on you right now.</p>
        ) : (
          <div className="space-y-3 mb-10">
            {pending.map((a) => (
              <AppointmentRowCard key={a.id} a={a} />
            ))}
          </div>
        )}

        <DoctorWaitlistPanel />

        <div className="eyebrow text-sage mb-4">Confirmed, upcoming ({confirmed.length})</div>
        {confirmed.length === 0 ? (
          <p className="text-sm text-sage mb-10">No confirmed appointments yet.</p>
        ) : (
          <div className="space-y-3 mb-10">
            {confirmed.map((a) => (
              <AppointmentRowCard key={a.id} a={a} />
            ))}
          </div>
        )}

        {history.length > 0 && (
          <>
            <div className="eyebrow text-sage mb-4">Recent history</div>
            <div className="space-y-3">
              {history.map((a) => (
                <Card key={a.id} className="p-4 flex items-start justify-between gap-4 flex-wrap opacity-80">
                  <div>
                    <Link href={`/doctor/patients/${a.patientId}`} className="font-medium text-ink hover:text-teal-dark">
                      {a.patientName}
                    </Link>
                    <div className="text-sm text-sage mt-1">{formatDateTime(a.scheduledAt)}</div>
                  </div>
                  <Badge tone={statusTone(a.status)}>{statusLabel(a.status)}</Badge>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function AppointmentRowCard({ a }: { a: AppointmentRow }) {
  return (
    <Card className="p-4 flex items-start justify-between gap-4 flex-wrap">
      <div>
        <Link href={`/doctor/patients/${a.patientId}`} className="font-medium text-ink hover:text-teal-dark">
          {a.patientName}
        </Link>
        <div className={`text-sm mt-1 ${a.scheduledAt ? "text-sage" : "text-alert"}`}>{formatDateTime(a.scheduledAt)}</div>
        {a.reason && <div className="text-sm text-sage mt-1">“{a.reason}”</div>}
      </div>
      <div className="flex items-center gap-3">
        <Badge tone={statusTone(a.status)}>{statusLabel(a.status)}</Badge>
        {a.recurrenceRule && (
          <Badge tone="sage">
            {a.recurrenceIndex}/{a.recurrenceCount}
          </Badge>
        )}
        <AppointmentActions appointmentId={a.id} status={a.status} scheduledAt={a.scheduledAt} />
      </div>
    </Card>
  );
}
