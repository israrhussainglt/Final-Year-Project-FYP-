import { notFound } from "next/navigation";
import Link from "next/link";
import { serverFetch } from "@/lib/server-api";
import { PulseMark } from "@/components/PulseMark";
import { Card } from "@/components/ui";

type EmergencyResponse = {
  fullName: string;
  age: number;
  dateOfBirth?: string;
  isMinor: boolean;
  gender: string;
  bloodGroup: string;
  allergies: string | null;
  chronicConditions: string | null;
  weightKg?: number | null;
  pediatricianName?: string | null;
  pediatricianPhone?: string | null;
  contacts: { fullName: string; relationship: string; phone: string; isPrimary: boolean }[];
};

export default async function EmergencyByCnicPage({ params }: { params: { nationalId: string } }) {
  const result = await serverFetch<EmergencyResponse>(`/api/emergency/cnic/${encodeURIComponent(params.nationalId)}`);

  if (result.status === 429) {
    return (
      <main className="min-h-screen bg-ink text-white flex items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <PulseMark className="w-24 h-5 mx-auto mb-6" tone="alert" />
          <h1 className="font-display text-2xl mb-2">Too many requests</h1>
          <p className="text-white/60 text-sm">Please wait a moment before trying this link again.</p>
        </div>
      </main>
    );
  }

  if (result.status === 404 || !result.data) notFound();
  const patient = result.data;

  return (
    <main className="min-h-screen bg-ink text-white">
      <div className="max-w-lg mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <PulseMark className="w-24 h-5" tone="alert" />
          <span className="eyebrow text-white/60">Emergency access</span>
        </div>

        {patient.isMinor && (
          <div className="mb-6 rounded-lg bg-alert border-2 border-alert px-4 py-3 text-center">
            <p className="text-sm font-bold uppercase tracking-wide text-white">
              ⚠ Minor — pediatric patient
            </p>
            <p className="text-xs text-white/90 mt-0.5">Contact the parent or guardian below first.</p>
          </div>
        )}

        <p className="text-sm text-white/60 mb-1">Scanned CNIC card for</p>
        <h1 className="font-display text-4xl mb-1">{patient.fullName}</h1>
        <p className="text-white/60 text-sm mb-8">
          {patient.age} years old · {patient.gender}
        </p>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <Card className="!bg-white/5 !border-white/10 p-4">
            <div className="eyebrow text-alert mb-1">Blood group</div>
            <div className="font-display text-3xl text-white">{patient.bloodGroup}</div>
          </Card>
          <Card className="!bg-white/5 !border-white/10 p-4">
            <div className="eyebrow text-alert mb-1">Source</div>
            <div className="font-mono text-sm text-white mt-2">CNIC card</div>
          </Card>
        </div>

        <Card className="!bg-white/5 !border-white/10 p-4 mb-4">
          <div className="eyebrow text-alert mb-2">Allergies</div>
          <p className="text-white">{patient.allergies || "None known"}</p>
        </Card>

        <Card className="!bg-white/5 !border-white/10 p-4 mb-4">
          <div className="eyebrow text-alert mb-2">Chronic conditions</div>
          <p className="text-white">{patient.chronicConditions || "None known"}</p>
        </Card>

        {patient.isMinor && (patient.weightKg || patient.pediatricianName) && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            {patient.weightKg ? (
              <Card className="!bg-white/5 !border-white/10 p-4">
                <div className="eyebrow text-alert mb-1">Weight</div>
                <div className="font-display text-3xl text-white">{patient.weightKg} kg</div>
                <p className="text-xs text-white/40 mt-1">For weight-based dosing</p>
              </Card>
            ) : (
              <div />
            )}
            {patient.pediatricianName && (
              <Card className="!bg-white/5 !border-white/10 p-4">
                <div className="eyebrow text-alert mb-1">Pediatrician</div>
                <div className="text-white font-medium">{patient.pediatricianName}</div>
                {patient.pediatricianPhone && (
                  <a href={`tel:${patient.pediatricianPhone}`} className="text-white/80 font-mono text-sm">
                    {patient.pediatricianPhone}
                  </a>
                )}
              </Card>
            )}
          </div>
        )}

        <Card className="!bg-white/5 !border-white/10 p-4 mb-8">
          <div className="eyebrow text-alert mb-3">Emergency contacts</div>
          {patient.isMinor && (
            <p className="text-xs text-white/60 mb-3 leading-relaxed">
              This patient is a minor — contact their parent or guardian below.
            </p>
          )}
          <div className="space-y-3">
            {patient.contacts.length === 0 && <p className="text-white/60 text-sm">None on file.</p>}
            {patient.contacts.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div>
                  <div className="text-white font-medium flex items-center gap-2">
                    {c.fullName}
                    {patient.isMinor && i === 0 && (
                      <span className="inline-flex items-center rounded-full bg-alert px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                        Call first
                      </span>
                    )}
                  </div>
                  <div className="text-white/60">{c.relationship}</div>
                </div>
                <a href={`tel:${c.phone}`} className="text-white font-mono">
                  {c.phone}
                </a>
              </div>
            ))}
          </div>
        </Card>

        <p className="text-xs text-white/40 leading-relaxed">
          This is a scoped emergency view — only life-critical information is shown, sourced
          directly from the CNIC card that was scanned. This access has been logged and{" "}
          {patient.fullName.split(" ")[0]} can see it in their audit log.
        </p>

        <Link href="/" className="inline-block mt-8 text-sm text-white/60 hover:text-white">
          ← Back to PulseID
        </Link>
      </div>
    </main>
  );
}
