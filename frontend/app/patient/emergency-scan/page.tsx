import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { PatientHeader } from "@/components/patient/PatientHeader";
import { EmergencyScanner } from "@/components/patient/EmergencyScanner";

type MeResponse = { role: "patient"; session: { fullName: string } };

export default async function EmergencyScanPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "patient") redirect("/patient/login");

  return (
    <main className="min-h-screen bg-paper">
      <PatientHeader patientName={me.data.session?.fullName || "Patient"} />
      <EmergencyScanner />
    </main>
  );
}
