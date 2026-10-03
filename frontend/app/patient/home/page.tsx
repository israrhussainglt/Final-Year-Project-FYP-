import Link from "next/link";
import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { PatientHeader } from "@/components/patient/PatientHeader";
import { Card, Badge, formatDate, age, recordTypeLabel, recordTypeTone } from "@/components/ui";
import type { PatientFullRecord, PendingFollowupCheckin } from "@/lib/types";

export default async function PatientHomePage() {
  const full = await serverFetch<PatientFullRecord>("/api/patient/me");
  if (full.status === 401 || !full.data) redirect("/patient/login");

  const { patient, records } = full.data;
  const recent = records.slice(0, 3);

  const followupsResult = await serverFetch<{ pendingCheckins: PendingFollowupCheckin[] }>("/api/patient/followups");
  const pendingCheckins = followupsResult.data?.pendingCheckins ?? [];

  return (
    <main className="min-h-screen bg-paper">
      <PatientHeader patientName={patient.full_name} />

      <div className="max-w-4xl mx-auto px-6 md:px-10 py-10">
        <div className="eyebrow text-teal mb-2">Your PulseID</div>
        <h1 className="font-display text-3xl mb-8">Hi {patient.full_name.split(" ")[0]}</h1>

        {pendingCheckins.length > 0 && (
          <Link href="/patient/followups">
            <Card className="p-5 mb-8 border-teal !bg-teal-light/40 hover:border-teal-dark transition-colors group">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="font-medium">
                    {pendingCheckins.length === 1 ? "You have a follow-up check-in" : `You have ${pendingCheckins.length} follow-up check-ins`}
                  </h2>
                  <p className="text-sm text-sage mt-1">
                    Your care team would like a quick update — it only takes a minute.
                  </p>
                </div>
                <span className="text-sm font-semibold text-teal-dark inline-block group-hover:translate-x-1 transition-transform">
                  Answer now →
                </span>
              </div>
            </Card>
          </Link>
        )}

        <div className="grid sm:grid-cols-3 gap-4 mb-10">
          <Card className="p-5">
            <div className="eyebrow text-sage mb-1">Blood group</div>
            <div className="font-display text-3xl">{patient.blood_group}</div>
          </Card>
          <Card className="p-5">
            <div className="eyebrow text-sage mb-1">Age</div>
            <div className="font-display text-3xl">{age(patient.date_of_birth)}</div>
          </Card>
          <Card className="p-5">
            <div className="eyebrow text-sage mb-1">Total visits on file</div>
            <div className="font-display text-3xl">{records.length}</div>
          </Card>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          <Link href="/patient/qr">
            <Card className="p-5 h-full hover:border-teal transition-colors group">
              <h2 className="font-medium">Emergency access</h2>
              <p className="text-sm text-sage mt-1">
                Your live QR code or your CNIC card — either one reveals only blood group,
                allergies, conditions and emergency contacts to whoever scans it.
              </p>
              <span className="text-sm font-semibold text-teal-dark mt-3 inline-block group-hover:translate-x-1 transition-transform">
                How it works →
              </span>
            </Card>
          </Link>
          <Link href="/patient/audit-log">
            <Card className="p-5 h-full hover:border-teal transition-colors group">
              <h2 className="font-medium">Who's viewed your records</h2>
              <p className="text-sm text-sage mt-1">
                Every clinician login and emergency scan is logged here, with who and when.
              </p>
              <span className="text-sm font-semibold text-teal-dark mt-3 inline-block group-hover:translate-x-1 transition-transform">
                View audit log →
              </span>
            </Card>
          </Link>
          <Link href="/patient/report">
            <Card className="p-5 h-full hover:border-teal transition-colors group">
              <h2 className="font-medium">My Reports</h2>
              <p className="text-sm text-sage mt-1">
                A complete, printable report — visits, medications, contacts and access history —
                you can view and download any time.
              </p>
              <span className="text-sm font-semibold text-teal-dark mt-3 inline-block group-hover:translate-x-1 transition-transform">
                Open my reports →
              </span>
            </Card>
          </Link>
          <Link href="/patient/emergency-scan">
            <Card className="p-5 h-full hover:border-alert transition-colors group">
              <h2 className="font-medium">Emergency Scan</h2>
              <p className="text-sm text-sage mt-1">
                Scan any CNIC, B-Form or PulseID QR to preview exactly what a doctor or first
                responder would see for that person.
              </p>
              <span className="text-sm font-semibold text-alert mt-3 inline-block group-hover:translate-x-1 transition-transform">
                Open Emergency Scan →
              </span>
            </Card>
          </Link>
        </div>

        <div className="flex items-center justify-between mb-4">
          <div className="eyebrow text-sage">Recent visits</div>
          <Link href="/patient/records" className="text-sm font-medium text-teal-dark hover:underline">
            View full history →
          </Link>
        </div>
        <div className="space-y-3">
          {recent.length === 0 && <p className="text-sm text-sage">No visits recorded yet.</p>}
          {recent.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone={recordTypeTone(r.record_type)}>{recordTypeLabel(r.record_type)}</Badge>
                  <span className="text-xs text-sage">{formatDate(r.visit_date)}</span>
                </div>
                {r.doctor_name && <span className="text-xs text-sage">{r.doctor_name}</span>}
              </div>
              {r.diagnosis && <p className="font-medium mt-2">{r.diagnosis}</p>}
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
