import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { HospitalAdminHeader } from "@/components/hospital-admin/HospitalAdminHeader";
import { AiAppointmentInsights } from "@/components/hospital-admin/AiAppointmentInsights";
import {
  HospitalAppointmentsTable,
  type HospitalAppointmentRow,
  type DoctorOption,
} from "@/components/hospital-admin/HospitalAppointmentsTable";

type MeResponse = { role: "hospital_admin"; session: { fullName: string; hospitalName?: string } };
type DoctorRow = { id: string; fullName: string; isActive: boolean };

export default async function HospitalAdminAppointmentsPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "hospital_admin") redirect("/hospital-admin/login");
  const session = me.data.session;

  const [appointmentsRes, doctorsRes] = await Promise.all([
    serverFetch<{ appointments: HospitalAppointmentRow[] }>("/api/hospital-admin/appointments"),
    serverFetch<{ doctors: DoctorRow[] }>("/api/hospital-admin/doctors"),
  ]);

  const appointments = appointmentsRes.data?.appointments || [];
  const doctors: DoctorOption[] = (doctorsRes.data?.doctors || []).map((d) => ({
    id: d.id,
    fullName: d.fullName,
    isActive: d.isActive,
  }));

  const pendingCount = appointments.filter((a) => a.status === "requested").length;

  return (
    <main className="min-h-screen bg-paper">
      <HospitalAdminHeader adminName={session?.fullName || "Admin"} hospitalName={session?.hospitalName} />

      <div className="max-w-6xl mx-auto px-6 md:px-10 py-10">
        <div className="mb-8">
          <div className="eyebrow text-teal mb-2">{session?.hospitalName || "Your hospital"}</div>
          <h1 className="font-display text-3xl">
            Appointments{" "}
            <span className="text-sage font-sans text-xl font-normal">
              ({appointments.length} total{pendingCount > 0 ? `, ${pendingCount} awaiting confirmation` : ""})
            </span>
          </h1>
          <p className="text-sm text-sage mt-2 leading-relaxed max-w-2xl">
            Every appointment across every doctor at this hospital, in one place — filter by status or
            doctor to find what you need. This view never shows clinical notes or medical history.
          </p>
        </div>

        {doctors.length === 0 ? (
          <div className="text-sm text-sage">Add a doctor first — appointments will show up here once they do.</div>
        ) : appointmentsRes.status !== 200 ? (
          <div className="text-sm text-alert">Couldn't load appointments right now. Try refreshing the page.</div>
        ) : (
          <>
            <AiAppointmentInsights />
            <HospitalAppointmentsTable initialAppointments={appointments} doctors={doctors} />
          </>
        )}
      </div>
    </main>
  );
}
