import Link from "next/link";
import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { DoctorHeader } from "@/components/doctor/DoctorHeader";
import { PatientSearch } from "@/components/doctor/PatientSearch";
import { Card, Badge, Button, formatDate, age } from "@/components/ui";

type MeResponse = { role: "doctor"; session: { fullName: string; hospitalName?: string } };
type PatientRow = {
  id: string;
  nationalId: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  bloodGroup: string;
  createdAt: string;
};
type RecentlyViewedRow = {
  id: string;
  nationalId: string;
  fullName: string;
  dateOfBirth: string;
  isMinor: boolean;
  bloodGroup: string;
  viewedAt: string;
};

export default async function DoctorDashboardPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "doctor") redirect("/doctor/login");
  const session = me.data.session;

  const [list, viewedList, appointmentsList] = await Promise.all([
    serverFetch<{ total: number; patients: PatientRow[] }>("/api/patients"),
    serverFetch<{ patients: RecentlyViewedRow[] }>("/api/patients/recently-viewed"),
    serverFetch<{ appointments: { status: string }[] }>("/api/doctor/appointments?status=requested"),
  ]);
  const patients = list.data?.patients || [];
  const total = list.data?.total ?? patients.length;
  const recent = [...patients].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 8);
  const recentlyViewed = viewedList.data?.patients || [];
  const pendingAppointments = appointmentsList.data?.appointments.length || 0;

  return (
    <main className="min-h-screen bg-paper">
      <DoctorHeader doctorName={session?.fullName || "Doctor"} hospitalName={session?.hospitalName} />

      <div className="max-w-6xl mx-auto px-6 md:px-10 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <div className="eyebrow text-teal mb-2">Welcome back</div>
            <h1 className="font-display text-3xl">
              {greeting()}, {firstName(session?.fullName)}
            </h1>
          </div>
          <div className="flex gap-3">
            <Link href="/doctor/appointments" className="relative">
              <Button variant="secondary">
                Appointments
                {pendingAppointments > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-alert text-white text-[11px] font-semibold">
                    {pendingAppointments}
                  </span>
                )}
              </Button>
            </Link>
            <Link href="/doctor/scan">
              <Button variant="secondary">Scan QR</Button>
            </Link>
          </div>
        </div>

        <div className="max-w-xl mb-12">
          <PatientSearch />
          <p className="text-xs text-sage mt-2">
            Try “35202” or “Hassan” — or{" "}
            <Link href="/doctor/scan" className="text-teal-dark font-medium hover:underline">
              scan a patient's QR code
            </Link>{" "}
            to open their record instantly. New patient? They can request a booking themselves — check your{" "}
            <Link href="/doctor/registrations" className="text-teal-dark font-medium hover:underline">
              booking requests
            </Link>
            .
          </p>
        </div>

        {recentlyViewed.length > 0 && (
          <div className="mb-12">
            <div className="eyebrow text-sage mb-3">Recently viewed</div>
            <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
              {recentlyViewed.map((p) => (
                <Link key={p.id} href={`/doctor/patients/${p.id}`} className="shrink-0 w-56">
                  <Card className="p-4 h-full hover:border-teal transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <div className="font-medium text-ink truncate">{p.fullName}</div>
                        <div className="text-xs text-sage font-mono mt-1">{p.nationalId}</div>
                      </div>
                      <Badge>{p.bloodGroup}</Badge>
                    </div>
                    <div className="text-xs text-sage mt-3">
                      {age(p.dateOfBirth)} yrs{p.isMinor ? " · minor" : ""} · viewed {formatDate(p.viewedAt)}
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-3">
          <div className="eyebrow text-sage">Recently registered</div>
          <Link href="/doctor/patients" className="text-sm font-medium text-teal-dark hover:underline">
            View all {total} patients →
          </Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {recent.map((p) => (
            <Link key={p.id} href={`/doctor/patients/${p.id}`}>
              <Card className="p-4 h-full hover:border-teal transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium text-ink">{p.fullName}</div>
                    <div className="text-xs text-sage font-mono mt-1">{p.nationalId}</div>
                  </div>
                  <Badge>{p.bloodGroup}</Badge>
                </div>
                <div className="text-xs text-sage mt-3">
                  {age(p.dateOfBirth)} yrs · {p.gender} · registered {formatDate(p.createdAt)}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function firstName(full?: string): string {
  if (!full) return "Doctor";
  return full.replace(/^Dr\.?\s*/i, "").split(" ")[0];
}
