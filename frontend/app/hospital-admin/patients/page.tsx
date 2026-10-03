import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { HospitalAdminHeader } from "@/components/hospital-admin/HospitalAdminHeader";
import { PatientSearch } from "@/components/hospital-admin/PatientSearch";

type MeResponse = { role: "hospital_admin"; session: { fullName: string; hospitalName?: string } };

export default async function HospitalAdminPatientsPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "hospital_admin") redirect("/hospital-admin/login");
  const session = me.data.session;

  return (
    <main className="min-h-screen bg-paper">
      <HospitalAdminHeader adminName={session?.fullName || "Admin"} hospitalName={session?.hospitalName} />

      <div className="max-w-2xl mx-auto px-6 md:px-10 py-10">
        <div className="eyebrow text-teal mb-2">Registration desk</div>
        <h1 className="font-display text-3xl mb-2">Find a patient</h1>
        <p className="text-sm text-sage mb-8 leading-relaxed">
          Search by National ID (CNIC/B-Form) or name to fix a registration mistake — a
          misspelled name, an old phone number, a typo'd blood group. This console can't open a
          patient's medical history; for that, ask the treating doctor.
        </p>
        <PatientSearch />
      </div>
    </main>
  );
}
