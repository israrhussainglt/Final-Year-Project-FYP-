import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { PatientHeader } from "@/components/patient/PatientHeader";
import { BookAppointmentForm } from "@/components/patient/BookAppointmentForm";
import { CancelAppointmentButton } from "@/components/patient/CancelAppointmentButton";
import { JoinWaitlistForm } from "@/components/patient/JoinWaitlistForm";
import { LeaveWaitlistButton } from "@/components/patient/LeaveWaitlistButton";
import { Card, Badge } from "@/components/ui";
import type { PatientFullRecord } from "@/lib/types";

type AppointmentRow = {
  id: string;
  doctorName: string;
  hospitalName: string | null;
  scheduledAt: string | null;
  reason: string | null;
  status: "requested" | "confirmed" | "completed" | "cancelled";
  doctorNotes: string | null;
  recurrenceRule: "weekly" | "biweekly" | "monthly" | null;
  recurrenceIndex: number | null;
  recurrenceCount: number | null;
};

type WaitlistRow = {
  id: string;
  doctorName: string;
  reason: string | null;
  status: "waiting" | "offered" | "booked" | "cancelled";
  createdAt: string;
};

function statusTone(status: AppointmentRow["status"]): "teal" | "alert" | "sage" {
  if (status === "confirmed") return "teal";
  if (status === "cancelled") return "alert";
  return "sage";
}

function statusLabel(status: AppointmentRow["status"]): string {
  return { requested: "Awaiting confirmation", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" }[status];
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "Date to be set by the clinic";
  try {
    return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default async function PatientAppointmentsPage() {
  const me = await serverFetch<PatientFullRecord>("/api/patient/me");
  if (me.status === 401 || !me.data) redirect("/patient/login");
  const { patient } = me.data;

  const list = await serverFetch<{ appointments: AppointmentRow[] }>("/api/patient/appointments");
  const appointments = list.data?.appointments || [];
  const upcoming = appointments.filter((a) => a.status === "requested" || a.status === "confirmed");
  const past = appointments.filter((a) => a.status === "completed" || a.status === "cancelled");

  const waitlistRes = await serverFetch<{ entries: WaitlistRow[] }>("/api/patient/waitlist");
  const waitlist = waitlistRes.data?.entries || [];

  return (
    <main className="min-h-screen bg-paper">
      <PatientHeader patientName={patient.full_name} />

      <div className="max-w-3xl mx-auto px-6 md:px-10 py-10">
        <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
          <div>
            <div className="eyebrow text-teal mb-2">Appointments</div>
            <h1 className="font-display text-3xl">Your appointments</h1>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <JoinWaitlistForm />
            <BookAppointmentForm />
          </div>
        </div>

        {waitlist.length > 0 && (
          <>
            <div className="eyebrow text-sage mb-4">Waitlisted</div>
            <div className="space-y-3 mb-12">
              {waitlist.map((w) => (
                <Card key={w.id} className="p-4 flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="font-medium text-ink">{w.doctorName}</div>
                    {w.reason && <div className="text-sm text-sage mt-1">“{w.reason}”</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone="sage">{w.status === "offered" ? "Slot offered" : "Waiting"}</Badge>
                    {w.status === "waiting" && <LeaveWaitlistButton entryId={w.id} />}
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        <div className="eyebrow text-sage mb-4">Upcoming</div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-sage mb-12">No upcoming appointments. Request one to get started.</p>
        ) : (
          <div className="space-y-3 mb-12">
            {upcoming.map((a) => (
              <Card key={a.id} className="p-4 flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="font-medium text-ink">{a.doctorName}{a.hospitalName ? ` · ${a.hospitalName}` : ""}</div>
                  <div className={`text-sm mt-1 ${a.scheduledAt ? "text-sage" : "text-sage italic"}`}>{formatDateTime(a.scheduledAt)}</div>
                  {a.reason && <div className="text-sm text-sage mt-1">“{a.reason}”</div>}
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={statusTone(a.status)}>{statusLabel(a.status)}</Badge>
                  {a.recurrenceRule && (
                    <Badge tone="sage">
                      Follow-up {a.recurrenceIndex}/{a.recurrenceCount}
                    </Badge>
                  )}
                  <CancelAppointmentButton appointmentId={a.id} />
                </div>
              </Card>
            ))}
          </div>
        )}

        {past.length > 0 && (
          <>
            <div className="eyebrow text-sage mb-4">Past</div>
            <div className="space-y-3">
              {past.map((a) => (
                <Card key={a.id} className="p-4 flex items-start justify-between gap-4 flex-wrap opacity-80">
                  <div>
                    <div className="font-medium text-ink">{a.doctorName}{a.hospitalName ? ` · ${a.hospitalName}` : ""}</div>
                    <div className="text-sm text-sage mt-1">{formatDateTime(a.scheduledAt)}</div>
                    {a.doctorNotes && <div className="text-sm text-sage mt-1">Note: {a.doctorNotes}</div>}
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
