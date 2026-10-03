import Link from "next/link";
import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { DoctorHeader } from "@/components/doctor/DoctorHeader";
import { PatientsTable, type PatientRow } from "@/components/doctor/PatientsTable";
import { Button } from "@/components/ui";
import { apiUrl } from "@/lib/api";

type MeResponse = { role: "doctor"; session: { fullName: string; hospitalName?: string } };

export default async function PatientsIndexPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "doctor") redirect("/doctor/login");
  const session = me.data.session;

  const list = await serverFetch<{ total: number; patients: PatientRow[] }>("/api/patients");
  const rows = list.data?.patients || [];
  const total = list.data?.total ?? rows.length;

  return (
    <main className="min-h-screen bg-paper">
      <DoctorHeader doctorName={session?.fullName || "Doctor"} hospitalName={session?.hospitalName} />

      <div className="max-w-6xl mx-auto px-6 md:px-10 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <div className="eyebrow text-teal mb-2">Directory</div>
            <h1 className="font-display text-3xl">
              All patients <span className="text-sage font-sans text-xl font-normal">({total})</span>
            </h1>
          </div>
          <div className="flex gap-3">
            <a href={apiUrl("/api/patients/export.csv")} target="_blank" rel="noopener noreferrer">
              <Button variant="secondary">⬇ Export CSV</Button>
            </a>
            <Link href="/doctor/scan">
              <Button variant="secondary">Scan QR</Button>
            </Link>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="text-sm text-sage">
            No patients registered yet. New patients now request an appointment themselves and land
            in your{" "}
            <Link href="/doctor/registrations" className="text-teal-dark font-medium hover:underline">
              booking requests
            </Link>{" "}
            for you to confirm.
          </div>
        ) : (
          <PatientsTable patients={rows} />
        )}
      </div>
    </main>
  );
}
