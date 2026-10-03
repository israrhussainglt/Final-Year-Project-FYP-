import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { DoctorHeader } from "@/components/doctor/DoctorHeader";
import { Card, Badge, Button, formatDate, age, recordTypeLabel, recordTypeTone } from "@/components/ui";
import { AddRecordForm } from "@/components/doctor/AddRecordForm";
import { StartFollowupForm } from "@/components/doctor/StartFollowupForm";
import { GuardianPanel } from "@/components/doctor/GuardianPanel";
import { EditPatientForm } from "@/components/doctor/EditPatientForm";
import type { Medication, PatientFullRecord, RiskAssessment, FollowupAgent } from "@/lib/types";

type MeResponse = { role: "doctor"; session: { fullName: string; hospitalName?: string } };

type GuardianResponse = {
  guardian: { id: string; fullName: string; nationalId: string; phone: string } | null;
  pendingRequests: { id: string; guardianFullName: string; guardianNationalId: string; guardianPhone: string; createdAt: string }[];
};

export default async function PatientDetailPage({ params }: { params: { id: string } }) {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "doctor") redirect("/doctor/login");
  const session = me.data.session;

  const full = await serverFetch<PatientFullRecord>(`/api/patients/${params.id}`);
  if (full.status === 404 || !full.data) notFound();
  const { patient, contacts, records, prescriptions } = full.data;
  const isMinor = age(patient.date_of_birth) < 18;

  const guardianResult = isMinor ? await serverFetch<GuardianResponse>(`/api/patients/${patient.id}/guardian`) : null;

  const riskResult = await serverFetch<{ latest: RiskAssessment | null; disclaimer: string }>(`/api/patients/${patient.id}/risk`);
  const latestRisk = riskResult.data?.latest ?? null;
  const riskFactors: string[] = latestRisk ? JSON.parse(latestRisk.factors || "[]") : [];

  const followupResult = await serverFetch<{ agents: FollowupAgent[] }>("/api/doctor/followups");
  const patientAgents = (followupResult.data?.agents ?? []).filter((a) => a.patient_id === patient.id);

  return (
    <main className="min-h-screen bg-paper">
      <DoctorHeader doctorName={session?.fullName || "Doctor"} hospitalName={session?.hospitalName} />

      <div className="max-w-6xl mx-auto px-6 md:px-10 pt-10 pb-4 flex items-center justify-between">
        <Link href="/doctor/patients" className="text-sm font-medium text-sage hover:text-ink">
          ← All patients
        </Link>
        <div className="flex gap-3">
          <EditPatientForm patient={patient} />
          <Link href={`/doctor/patients/${patient.id}/report`}>
            <Button variant="secondary">📄 Full detailed report</Button>
          </Link>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 md:px-10 pb-10 grid lg:grid-cols-[320px_1fr] gap-8">
        <aside className="space-y-6">
          <Card className="p-5">
            <h1 className="font-display text-2xl">{patient.full_name}</h1>
            <div className="text-sm text-sage font-mono mt-1">{patient.national_id}</div>
            <div className="flex flex-wrap gap-2 mt-4">
              <Badge tone="alert">{patient.blood_group}</Badge>
              <Badge tone="sage">
                {age(patient.date_of_birth)} yrs, {patient.gender}
              </Badge>
              {latestRisk && (
                <Badge tone={latestRisk.risk_level === "high" ? "alert" : latestRisk.risk_level === "mid" ? "sage" : "teal"}>
                  Risk: {latestRisk.risk_level}
                </Badge>
              )}
            </div>
            {latestRisk && (
              <div className="mt-4 pt-4 border-t border-line">
                <dt className="text-xs text-sage uppercase tracking-wide mb-1.5">Latest risk factors</dt>
                <ul className="space-y-1">
                  {riskFactors.map((f, i) => (
                    <li key={i} className="text-sm">
                      • {f}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-sage mt-2">
                  Rule-based flag only, from recorded vitals — not a diagnosis.
                </p>
              </div>
            )}

            <dl className="mt-5 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-sage uppercase tracking-wide">Allergies</dt>
                <dd className="mt-0.5">{patient.allergies || "None recorded"}</dd>
              </div>
              <div>
                <dt className="text-xs text-sage uppercase tracking-wide">Chronic conditions</dt>
                <dd className="mt-0.5">{patient.chronic_conditions || "None recorded"}</dd>
              </div>
              <div>
                <dt className="text-xs text-sage uppercase tracking-wide">Phone</dt>
                <dd className="mt-0.5">{patient.phone_number}</dd>
              </div>
              {patient.address && (
                <div>
                  <dt className="text-xs text-sage uppercase tracking-wide">Address</dt>
                  <dd className="mt-0.5">{patient.address}</dd>
                </div>
              )}
            </dl>
          </Card>

          <Card className="p-5">
            <div className="eyebrow text-sage mb-3">Emergency contacts</div>
            <div className="space-y-3">
              {contacts.length === 0 && <p className="text-sm text-sage">None on file.</p>}
              {contacts.map((c) => (
                <div key={c.id} className="text-sm">
                  <div className="font-medium">
                    {c.full_name}{" "}
                    {c.is_primary === 1 && <span className="text-xs text-teal-dark font-normal">· primary</span>}
                  </div>
                  <div className="text-sage">
                    {c.relationship_type} · {c.phone_number}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {isMinor && (
            <GuardianPanel
              patientId={patient.id}
              initialGuardian={guardianResult?.data?.guardian ?? null}
              initialPending={guardianResult?.data?.pendingRequests ?? []}
            />
          )}

          <Card className="p-5">
            <div className="eyebrow text-sage mb-3">Proactive follow-up</div>
            <StartFollowupForm patientId={patient.id} existingAgents={patientAgents} />
          </Card>
        </aside>

        <section className="space-y-8">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="eyebrow text-sage">Medical timeline</div>
              <AddRecordForm patientId={patient.id} />
            </div>

            <ol className="relative border-l border-line ml-2 space-y-6">
              {records.length === 0 && <p className="text-sm text-sage ml-6">No visits recorded yet.</p>}
              {records.map((r) => (
                <li key={r.id} className="ml-6">
                  <span className="absolute -translate-x-[calc(0.375rem+1px)] mt-1.5 w-3 h-3 rounded-full bg-teal border-2 border-white shadow" />
                  <Card className="p-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={recordTypeTone(r.record_type)}>{recordTypeLabel(r.record_type)}</Badge>
                        <span className="text-xs text-sage">{formatDate(r.visit_date)}</span>
                      </div>
                      {r.doctor_name && <span className="text-xs text-sage">{r.doctor_name}</span>}
                    </div>
                    {r.diagnosis && <p className="font-medium mt-2">{r.diagnosis}</p>}
                    {r.symptoms && <p className="text-sm text-sage mt-1">Symptoms: {r.symptoms}</p>}
                    {r.notes && <p className="text-sm mt-2 leading-relaxed">{r.notes}</p>}
                  </Card>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <div className="eyebrow text-sage mb-4">Prescriptions</div>
            <div className="space-y-3">
              {prescriptions.length === 0 && <p className="text-sm text-sage">No prescriptions on file.</p>}
              {prescriptions.map((rx) => {
                const meds = JSON.parse(rx.medications) as Medication[];
                return (
                  <Card key={rx.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-sage">
                        Issued {formatDate(rx.issued_date)}
                        {rx.doctor_name ? ` · ${rx.doctor_name}` : ""}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {meds.map((m, i) => (
                        <li key={i} className="text-sm">
                          <span className="font-medium">{m.name}</span> — {m.dosage}, {m.frequency} for {m.duration}
                        </li>
                      ))}
                    </ul>
                    {rx.instructions && <p className="text-sm text-sage mt-2">{rx.instructions}</p>}
                  </Card>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
