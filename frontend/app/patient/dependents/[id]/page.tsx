import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { PatientHeader } from "@/components/patient/PatientHeader";
import { Card, Badge, Button } from "@/components/ui";

type MeResponse = { role: "patient"; session: { fullName: string } };

type DependentDetail = {
  id: string;
  fullName: string;
  nationalId: string;
  idType: "cnic" | "b_form";
  age: number;
  isMinor: boolean;
  gender: string;
  bloodGroup: string;
  allergies: string | null;
  chronicConditions: string | null;
  weightKg: number | null;
  pediatricianName: string | null;
  pediatricianPhone: string | null;
  contacts: { fullName: string; relationship: string; phone: string; isPrimary: boolean }[];
};

export default async function DependentDetailPage({ params }: { params: { id: string } }) {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "patient") redirect("/patient/login");

  const result = await serverFetch<DependentDetail>(`/api/patient/dependents/${params.id}`);
  if (result.status === 404 || !result.data) notFound();
  const dependent = result.data;

  return (
    <main className="min-h-screen bg-paper">
      <PatientHeader patientName={me.data.session.fullName} />
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-10">
        <Link href="/patient/dependents" className="text-sm font-medium text-sage hover:text-ink">
          ← All dependents
        </Link>

        <div className="flex items-center justify-between mt-4 mb-8 flex-wrap gap-3">
          <div>
            <div className="eyebrow text-teal mb-1">Dependent</div>
            <h1 className="font-display text-3xl">{dependent.fullName}</h1>
            <p className="text-sm text-sage mt-1">
              {dependent.age} yrs · {dependent.gender} · {dependent.idType === "b_form" ? "B-Form" : "CNIC"}{" "}
              <span className="font-mono">{dependent.nationalId}</span>
            </p>
          </div>
          <Link href={`/patient/dependents/${dependent.id}/report`}>
            <Button variant="secondary">📄 Full report</Button>
          </Link>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mb-6">
          <Card className="p-5">
            <div className="eyebrow text-sage mb-1">Blood group</div>
            <div className="font-display text-3xl">{dependent.bloodGroup}</div>
          </Card>
          {dependent.weightKg ? (
            <Card className="p-5">
              <div className="eyebrow text-sage mb-1">Weight</div>
              <div className="font-display text-3xl">{dependent.weightKg} kg</div>
            </Card>
          ) : (
            <Card className="p-5">
              <div className="eyebrow text-sage mb-1">Weight</div>
              <div className="text-sm text-sage mt-2">Not on file</div>
            </Card>
          )}
          <Card className="p-5">
            <div className="eyebrow text-sage mb-1">Pediatrician</div>
            {dependent.pediatricianName ? (
              <>
                <div className="font-medium mt-1">{dependent.pediatricianName}</div>
                {dependent.pediatricianPhone && (
                  <a href={`tel:${dependent.pediatricianPhone}`} className="text-sm text-teal-dark font-mono">
                    {dependent.pediatricianPhone}
                  </a>
                )}
              </>
            ) : (
              <div className="text-sm text-sage mt-2">Not on file</div>
            )}
          </Card>
        </div>

        <Card className="p-5 mb-4">
          <div className="eyebrow text-sage mb-2">Allergies</div>
          <p>{dependent.allergies || "None known"}</p>
        </Card>

        <Card className="p-5 mb-4">
          <div className="eyebrow text-sage mb-2">Chronic conditions</div>
          <p>{dependent.chronicConditions || "None known"}</p>
        </Card>

        <Card className="p-5 mb-4">
          <div className="eyebrow text-sage mb-3">Emergency contacts</div>
          <div className="space-y-3">
            {dependent.contacts.length === 0 && <p className="text-sm text-sage">None on file.</p>}
            {dependent.contacts.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium">{c.fullName}</div>
                  <div className="text-sage">{c.relationship}</div>
                </div>
                <a href={`tel:${c.phone}`} className="font-mono text-teal-dark">
                  {c.phone}
                </a>
              </div>
            ))}
          </div>
        </Card>

        <p className="text-xs text-sage leading-relaxed">
          You're seeing this because your PulseID account is linked as {dependent.fullName.split(" ")[0]}
          's guardian. Every time you open this record, it's logged to their audit trail like any
          other access.
        </p>
      </div>
    </main>
  );
}
