import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { PatientHeader } from "@/components/patient/PatientHeader";
import { Card, Badge } from "@/components/ui";
import type { AuditLog } from "@/lib/types";

const ACTION_LABEL: Record<string, string> = {
  record_viewed: "Viewed your records",
  record_created: "Added a new visit",
  qr_scanned: "Scanned your CNIC / emergency QR",
  login: "Signed in",
};

function actionTone(action: string): "teal" | "alert" | "sage" {
  if (action === "qr_scanned") return "alert";
  if (action === "record_created") return "teal";
  return "sage";
}

type MeResponse = { role: "patient"; session: { fullName: string } };

export default async function PatientAuditLogPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "patient") redirect("/patient/login");

  const result = await serverFetch<{ logs: AuditLog[] }>("/api/patient/audit-log");
  const logs = result.data?.logs || [];

  return (
    <main className="min-h-screen bg-paper">
      <PatientHeader patientName={me.data.session.fullName} />

      <div className="max-w-3xl mx-auto px-6 md:px-10 py-10">
        <div className="eyebrow text-teal mb-2">Transparency</div>
        <h1 className="font-display text-3xl mb-2">Who's accessed your records</h1>
        <p className="text-sm text-sage mb-8">
          Every time a clinician opens your file or someone scans your CNIC card for emergency
          access, it's logged here.
        </p>

        <div className="space-y-3">
          {logs.length === 0 && (
            <Card className="p-6 text-center text-sm text-sage">No access has been logged yet.</Card>
          )}
          {logs.map((log) => (
            <Card key={log.id} className="p-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge tone={actionTone(log.action)}>{ACTION_LABEL[log.action] || log.action}</Badge>
                </div>
                <div className="text-sm font-medium">{log.actor_name}</div>
                <div className="text-xs text-sage capitalize">{log.actor_role.replace("_", " ")}</div>
                {log.details && <p className="text-sm text-sage mt-1">{log.details}</p>}
              </div>
              <time className="text-xs text-sage whitespace-nowrap">
                {new Date(log.created_at).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
