import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { DoctorHeader } from "@/components/doctor/DoctorHeader";
import { WeekCalendar } from "@/components/doctor/WeekCalendar";

type MeResponse = { role: "doctor"; session: { fullName: string; hospitalName?: string } };

export default async function DoctorCalendarPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "doctor") redirect("/doctor/login");
  const session = me.data.session;

  return (
    <main className="min-h-screen bg-paper">
      <DoctorHeader doctorName={session?.fullName || "Doctor"} hospitalName={session?.hospitalName} />

      <div className="max-w-6xl mx-auto px-6 md:px-10 py-10">
        <div className="mb-8">
          <div className="eyebrow text-teal mb-2">Calendar</div>
          <h1 className="font-display text-3xl">Your week</h1>
          <p className="text-sm text-sage mt-2">
            Everything with a set time, laid out by day — the flat list at{" "}
            <a href="/doctor/appointments" className="text-teal-dark hover:underline">
              Appointments
            </a>{" "}
            is still there for the request queue and history.
          </p>
        </div>
        <WeekCalendar />
      </div>
    </main>
  );
}
