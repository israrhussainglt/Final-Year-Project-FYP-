import { redirect } from "next/navigation";
import Link from "next/link";
import { serverFetch } from "@/lib/server-api";
import { HospitalAdminHeader } from "@/components/hospital-admin/HospitalAdminHeader";
import { HospitalAdminEditPatientForm } from "@/components/hospital-admin/HospitalAdminEditPatientForm";
import { Card } from "@/components/ui";

type MeResponse = { role: "hospital_admin"; session: { fullName: string; hospitalName?: string } };

export default async function HospitalAdminPatientEditPage({ params }: { params: { id: string } }) {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "hospital_admin") redirect("/hospital-admin/login");
  const session = me.data.session;

  const result = await serverFetch<{ patient: any }>(`/api/hospital-admin/patients/${params.id}`);
  if (result.status === 404 || !result.data?.patient) {
    return (
      <main className="min-h-screen bg-paper">
        <HospitalAdminHeader adminName={session?.fullName || "Admin"} hospitalName={session?.hospitalName} />
        <div className="max-w-2xl mx-auto px-6 md:px-10 py-10">
          <p className="text-sm text-sage">
            Patient not found.{" "}
            <Link href="/hospital-admin/patients" className="text-teal-dark font-medium hover:underline">
              ← Back to search
            </Link>
          </p>
        </div>
      </main>
    );
  }
  const patient = result.data.patient;

  return (
    <main className="min-h-screen bg-paper">
      <HospitalAdminHeader adminName={session?.fullName || "Admin"} hospitalName={session?.hospitalName} />

      <div className="max-w-2xl mx-auto px-6 md:px-10 py-10">
        <Link href="/hospital-admin/patients" className="text-sm text-teal-dark font-medium hover:underline">
          ← Back to search
        </Link>

        <div className="mt-4 mb-6">
          <div className="eyebrow text-teal mb-2">Registration record</div>
          <h1 className="font-display text-3xl mb-1">{patient.full_name}</h1>
          <p className="text-sm text-sage font-mono">{patient.national_id}</p>
        </div>

        <Card className="p-6">
          <p className="text-sm text-sage mb-5">
            National ID and ID type can't be changed here — they're the patient's fixed identity.
            Medical history, diagnoses, and prescriptions aren't shown or editable in this
            console; only a treating doctor can access those.
          </p>
          <HospitalAdminEditPatientForm patient={patient} />
        </Card>
      </div>
    </main>
  );
}
