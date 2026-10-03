import Link from "next/link";
import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { PatientHeader } from "@/components/patient/PatientHeader";
import { MedicalReportView } from "@/components/report/MedicalReportView";
import { PrintButton } from "@/components/report/PrintButton";
import { DownloadButton } from "@/components/report/DownloadButton";
import type { MedicalReport } from "@/lib/types";

type MeResponse = { role: "patient"; session: { fullName: string } };

export default async function PatientReportPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "patient") redirect("/patient/login");

  const result = await serverFetch<{ report: MedicalReport }>("/api/patient/report");
  if (!result.data?.report) redirect("/patient/home");
  const { report } = result.data;

  return (
    <main className="min-h-screen bg-paper">
      <div className="no-print">
        <PatientHeader patientName={me.data.session.fullName} />
      </div>

      <div className="max-w-4xl mx-auto px-6 md:px-10 py-10">
        <div className="no-print flex items-center justify-between mb-6">
          <div>
            <div className="eyebrow text-teal mb-2">My Reports</div>
            <h1 className="font-display text-3xl">Your full medical report</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/patient/emergency-scan"
              className="focus-ring inline-flex items-center gap-2 rounded-lg border border-alert/40 bg-alert/10 px-4 py-2.5 text-sm font-semibold text-alert hover:bg-alert/15 transition-colors"
            >
              🚨 Emergency Scan
            </Link>
            <PrintButton />
          </div>
        </div>
        <div className="no-print flex justify-end -mt-3 mb-6">
          <DownloadButton endpoint="/api/patient/report/export" filenamePrefix={`pulseid-${me.data.session.fullName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`} />
        </div>
        <p className="no-print text-sm text-sage mb-8 max-w-2xl leading-relaxed">
          Everything on your PulseID record in one document — visit history, medications, emergency
          contacts and who has accessed your record. Print it or save it as a PDF to hand to a new
          doctor, or for your own records.{" "}
          <Link href="/patient/records" className="text-teal-dark font-medium hover:underline">
            Back to timeline view
          </Link>
        </p>

        <MedicalReportView report={report} audience="patient" />
      </div>
    </main>
  );
}
