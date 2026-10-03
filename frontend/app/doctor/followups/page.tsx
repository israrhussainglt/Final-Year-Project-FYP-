import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { DoctorHeader } from "@/components/doctor/DoctorHeader";
import { FollowupDashboard } from "@/components/doctor/FollowupDashboard";
import type { FollowupAgent, FollowupCheckin } from "@/lib/types";

type MeResponse = { role: "doctor"; session: { fullName: string; hospitalName?: string } };

export default async function DoctorFollowupsPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "doctor") redirect("/doctor/login");
  const session = me.data.session;

  const [alertsResult, agentsResult] = await Promise.all([
    serverFetch<{ alerts: FollowupCheckin[] }>("/api/doctor/followups/alerts"),
    serverFetch<{ agents: FollowupAgent[] }>("/api/doctor/followups"),
  ]);

  return (
    <main className="min-h-screen bg-paper">
      <DoctorHeader doctorName={session?.fullName || "Doctor"} hospitalName={session?.hospitalName} />

      <div className="max-w-5xl mx-auto px-6 md:px-10 py-10">
        <div className="eyebrow text-teal mb-2">Proactive care</div>
        <h1 className="font-display text-3xl mb-8">Follow-ups</h1>

        <FollowupDashboard
          initialAlerts={alertsResult.data?.alerts ?? []}
          initialAgents={agentsResult.data?.agents ?? []}
        />
      </div>
    </main>
  );
}
