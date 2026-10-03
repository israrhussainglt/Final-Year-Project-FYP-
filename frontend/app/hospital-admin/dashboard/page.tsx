import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { HospitalAdminHeader } from "@/components/hospital-admin/HospitalAdminHeader";
import { DoctorsTable, type DoctorRow } from "@/components/hospital-admin/DoctorsTable";
import { CreateDoctorForm } from "@/components/hospital-admin/CreateDoctorForm";
import { BulkImportDoctorsForm } from "@/components/hospital-admin/BulkImportDoctorsForm";
import { AiBriefingCard } from "@/components/hospital-admin/AiBriefingCard";

type MeResponse = { role: "hospital_admin"; session: { fullName: string; hospitalName?: string } };

export default async function HospitalAdminDashboardPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "hospital_admin") redirect("/hospital-admin/login");
  const session = me.data.session;

  const list = await serverFetch<{ doctors: DoctorRow[] }>("/api/hospital-admin/doctors");
  const doctors = list.data?.doctors || [];
  const activeCount = doctors.filter((d) => d.isActive).length;

  return (
    <main className="min-h-screen bg-paper">
      <HospitalAdminHeader adminName={session?.fullName || "Admin"} hospitalName={session?.hospitalName} />

      <div className="max-w-6xl mx-auto px-6 md:px-10 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <div className="eyebrow text-teal mb-2">{session?.hospitalName || "Your hospital"}</div>
            <h1 className="font-display text-3xl">
              Doctors{" "}
              <span className="text-sage font-sans text-xl font-normal">
                ({activeCount} active{doctors.length !== activeCount ? `, ${doctors.length - activeCount} deactivated` : ""})
              </span>
            </h1>
          </div>
          <CreateDoctorForm />
          <BulkImportDoctorsForm />
        </div>

        {doctors.length === 0 ? (
          <div className="text-sm text-sage">No doctor accounts yet. Add the first one above.</div>
        ) : (
          <>
            <AiBriefingCard
              endpoint="/api/hospital-admin/doctors/workload-insights"
              eyebrow="AI-drafted staffing briefing"
              label="Check workload balance"
              regenerateLabel="Regenerate"
              description="Get a short, AI-written read on how load is spread across your active doctors over the last 30 days — who's busiest, who's under-booked, and any cancellation rates worth a look. Built only from the counts below, never patient details."
            />
            <DoctorsTable doctors={doctors} />
          </>
        )}
      </div>
    </main>
  );
}
