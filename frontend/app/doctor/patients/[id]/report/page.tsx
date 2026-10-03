import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { DoctorHeader } from "@/components/doctor/DoctorHeader";
import { MedicalReportView } from "@/components/report/MedicalReportView";
import { PrintButton } from "@/components/report/PrintButton";
import { DownloadButton } from "@/components/report/DownloadButton";
import type { MedicalReport } from "@/lib/types";

type MeResponse = { role: "doctor"; session: { fullName: string; hospitalName?: string } };

export default async function DoctorPatientReportPage({ params }: { params: { id: string } }) {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "doctor") redirect("/doctor/login");
  const session = me.data.session;

  const result = await serverFetch<{ report: MedicalReport; generatedBy: { name: string; hospitalName: string | null } }>(
    `/api/patients/${params.id}/report`
  );
  if (result.status === 404 || !result.data?.report) notFound();
  const { report, generatedBy } = result.data;

  return (
    <main className="min-h-screen bg-paper">
      <div className="no-print">
        <DoctorHeader doctorName={session?.fullName || "Doctor"} hospitalName={session?.hospitalName} />
      </div>

      <div className="max-w-4xl mx-auto px-6 md:px-10 py-10">
        <div className="no-print flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <Link href={`/doctor/patients/${params.id}`} className="text-sm font-medium text-sage hover:text-ink">
              ← Back to patient
            </Link>
            <h1 className="font-display text-3xl mt-3">Full clinical report</h1>
          </div>
          <div className="flex flex-col items-end gap-2">
            <PrintButton />
            <DownloadButton endpoint={`/api/patients/${params.id}/report/export`} filenamePrefix={`pulseid-${report.patient.fullName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`} />
          </div>
        </div>

        <MedicalReportView report={report} audience="doctor" hospitalName={generatedBy.hospitalName} />
      </div>
    </main>
  );
}
