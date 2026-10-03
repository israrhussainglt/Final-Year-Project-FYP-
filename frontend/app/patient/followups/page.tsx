import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { PatientHeader } from "@/components/patient/PatientHeader";
import { CheckinForm } from "@/components/patient/CheckinForm";
import { Card, Badge, formatDate } from "@/components/ui";
import type { PatientFullRecord, PendingFollowupCheckin, FollowupAgent } from "@/lib/types";

export default async function PatientFollowupsPage() {
  const full = await serverFetch<PatientFullRecord>("/api/patient/me");
  if (full.status === 401 || !full.data) redirect("/patient/login");
  const { patient } = full.data;

  const followupsResult = await serverFetch<{ agents: FollowupAgent[]; pendingCheckins: PendingFollowupCheckin[] }>(
    "/api/patient/followups"
  );
  const agents = followupsResult.data?.agents ?? [];
  const pendingCheckins = followupsResult.data?.pendingCheckins ?? [];

  return (
    <main className="min-h-screen bg-paper">
      <PatientHeader patientName={patient.full_name} />

      <div className="max-w-3xl mx-auto px-6 md:px-10 py-10">
        <div className="eyebrow text-teal mb-2">Proactive care</div>
        <h1 className="font-display text-3xl mb-8">Follow-ups</h1>

        {pendingCheckins.length > 0 && (
          <div className="space-y-4 mb-10">
            <div className="eyebrow text-sage">Waiting for your answer</div>
            {pendingCheckins.map((c) => (
              <CheckinForm key={c.id} checkin={c} />
            ))}
          </div>
        )}

        <div className="eyebrow text-sage mb-4">Your active follow-ups</div>
        {agents.length === 0 && (
          <p className="text-sm text-sage">
            Your care team hasn't started a proactive follow-up for you yet — this is where check-in prompts will
            appear if they do.
          </p>
        )}
        <div className="space-y-3">
          {agents.map((a) => (
            <Card key={a.id} className="p-4 flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.pathology}</span>
                  <Badge tone={a.status === "active" ? "teal" : "sage"}>{a.status}</Badge>
                </div>
                <p className="text-xs text-sage mt-1">
                  {a.doctor_name ? `${a.doctor_name} · ` : ""}Every {a.frequency_days} day(s)
                </p>
              </div>
              {a.last_checkin_at && <span className="text-xs text-sage">Last check-in {formatDate(a.last_checkin_at)}</span>}
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
