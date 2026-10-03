import Link from "next/link";
import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { PatientHeader } from "@/components/patient/PatientHeader";
import { Card, Badge, Button, formatDate, recordTypeLabel, recordTypeTone } from "@/components/ui";
import type { Medication, PatientFullRecord } from "@/lib/types";

export default async function PatientRecordsPage() {
  const full = await serverFetch<PatientFullRecord>("/api/patient/me");
  if (full.status === 401 || !full.data) redirect("/patient/login");

  const { patient, records, prescriptions } = full.data;

  return (
    <main className="min-h-screen bg-paper">
      <PatientHeader patientName={patient.full_name} />

      <div className="max-w-3xl mx-auto px-6 md:px-10 py-10">
        <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
          <div>
            <div className="eyebrow text-teal mb-2">Lifelong record</div>
            <h1 className="font-display text-3xl">Your medical history</h1>
          </div>
          <Link href="/patient/report">
            <Button variant="secondary">📄 Full detailed report</Button>
          </Link>
        </div>

        <div className="eyebrow text-sage mb-4">Timeline</div>
        <ol className="relative border-l border-line ml-2 space-y-6 mb-12">
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

        <div className="eyebrow text-sage mb-4">Prescriptions</div>
        <div className="space-y-3">
          {prescriptions.length === 0 && <p className="text-sm text-sage">No prescriptions on file.</p>}
          {prescriptions.map((rx) => {
            const meds = JSON.parse(rx.medications) as Medication[];
            return (
              <Card key={rx.id} className="p-4">
                <span className="text-xs text-sage">
                  Issued {formatDate(rx.issued_date)}
                  {rx.doctor_name ? ` · ${rx.doctor_name}` : ""}
                </span>
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
    </main>
  );
}
