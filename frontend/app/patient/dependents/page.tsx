import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { PatientHeader } from "@/components/patient/PatientHeader";
import { DependentsView } from "@/components/patient/DependentsView";

type MeResponse = { role: "patient"; session: { fullName: string } };

type DependentsResponse = {
  dependents: {
    id: string;
    nationalId: string;
    idType: "cnic" | "b_form";
    fullName: string;
    age: number;
    gender: string;
    bloodGroup: string;
  }[];
  pendingRequests: { id: string; minorFullName: string; minorNationalId: string; createdAt: string }[];
};

export default async function DependentsPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "patient") redirect("/patient/login");

  const result = await serverFetch<DependentsResponse>("/api/patient/dependents");
  const dependents = result.data?.dependents || [];
  const pendingRequests = result.data?.pendingRequests || [];

  return (
    <main className="min-h-screen bg-paper">
      <PatientHeader patientName={me.data.session.fullName} />
      <div className="max-w-4xl mx-auto px-6 md:px-10 py-10">
        <div className="eyebrow text-teal mb-2">Family</div>
        <h1 className="font-display text-3xl mb-2">Dependents</h1>
        <p className="text-sm text-sage mb-8 max-w-2xl leading-relaxed">
          See and manage the PulseID records of children you're a parent or guardian for, right
          from your own account.
        </p>
        <DependentsView initialDependents={dependents} initialPending={pendingRequests} />
      </div>
    </main>
  );
}
