import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { PatientHeader } from "@/components/patient/PatientHeader";
import { MedicalReportView } from "@/components/report/MedicalReportView";
import { PrintButton } from "@/components/report/PrintButton";
import { DownloadButton } from "@/components/report/DownloadButton";
import type { MedicalReport } from "@/lib/types";

type MeResponse = { role: "patient"; session: { fullName: string } };

export default async function DependentReportPage({ params }: { params: { id: string } }) {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "patient") redirect("/patient/login");

  const result = await serverFetch<{ report: MedicalReport }>(`/api/patient/dependents/${params.id}/report`);
  if (result.status === 404 || !result.data?.report) notFound();
  const { report } = result.data;

  return (
    <main className="min-h-screen bg-paper">
      <div className="no-print">
        <PatientHeader patientName={me.data.session.fullName} />
      </div>

      <div className="max-w-4xl mx-auto px-6 md:px-10 py-10">
        <div className="no-print flex items-center justify-between mb-6">
          <div>
            <Link href={`/patient/dependents/${params.id}`} className="text-sm font-medium text-sage hover:text-ink">
              ← Back to {report.patient.fullName.split(" ")[0]}
            </Link>
            <h1 className="font-display text-3xl mt-2">{report.patient.fullName}'s full report</h1>
          </div>
          <PrintButton />
        </div>
        <div className="no-print flex justify-end -mt-3 mb-6">
          <DownloadButton
            endpoint={`/api/patient/dependents/${params.id}/report/export`}
            filenamePrefix={`pulseid-${report.patient.fullName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
          />
        </div>

        <MedicalReportView report={report} audience="patient" />
      </div>
    </main>
  );
}
