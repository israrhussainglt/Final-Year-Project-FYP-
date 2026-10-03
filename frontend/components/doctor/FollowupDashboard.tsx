"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Badge, Button, formatDate } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";
import type { FollowupAgent, FollowupCheckin, FollowupAgentStatus } from "@/lib/types";

function flagTone(flag: string | null): "alert" | "sage" | "teal" {
  if (flag === "urgent") return "alert";
  if (flag === "concern") return "sage";
  return "teal";
}

export function FollowupDashboard({
  initialAlerts,
  initialAgents,
}: {
  initialAlerts: FollowupCheckin[];
  initialAgents: FollowupAgent[];
}) {
  const router = useRouter();
  const [alerts, setAlerts] = useState(initialAlerts);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function acknowledge(checkinId: string) {
    setBusyId(checkinId);
    try {
      const res = await fetch(apiUrl(`/api/doctor/followups/alerts/${checkinId}/acknowledge`), {
        credentials: "include",
        method: "POST",
        headers: { "x-csrf-token": readCsrfCookie() || "" },
      });
      if (res.ok) setAlerts((prev) => prev.filter((a) => a.id !== checkinId));
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(agentId: string, status: FollowupAgentStatus) {
    setBusyId(agentId);
    try {
      const res = await fetch(apiUrl(`/api/doctor/followups/${agentId}/status`), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <div className="eyebrow text-alert mb-4">Needs attention ({alerts.length})</div>
        {alerts.length === 0 && <p className="text-sm text-sage">No unacknowledged check-in alerts right now.</p>}
        <div className="space-y-3">
          {alerts.map((a) => (
            <Card key={a.id} className="p-4 flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge tone={flagTone(a.risk_flag)}>{a.risk_flag}</Badge>
                  <span className="font-medium">{a.patient_name}</span>
                  <span className="text-xs text-sage">· {a.pathology}</span>
                </div>
                {a.ai_summary && <p className="text-sm mt-1">{a.ai_summary}</p>}
                <p className="text-xs text-sage mt-1">
                  {a.responded_at ? `Answered ${formatDate(a.responded_at)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/doctor/patients/${a.patient_id}`}>
                  <Button variant="secondary">View patient</Button>
                </Link>
                <Button onClick={() => acknowledge(a.id)} disabled={busyId === a.id}>
                  {busyId === a.id ? "…" : "Acknowledge"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <div className="eyebrow text-sage mb-4">All follow-ups</div>
        {initialAgents.length === 0 && <p className="text-sm text-sage">No follow-ups started yet.</p>}
        <div className="space-y-3">
          {initialAgents.map((agent) => (
            <Card key={agent.id} className="p-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{agent.patient_name}</span>
                  <span className="text-xs text-sage">· {agent.pathology}</span>
                  <Badge tone={agent.status === "active" ? "teal" : "sage"}>{agent.status}</Badge>
                </div>
                <p className="text-xs text-sage">
                  Every {agent.frequency_days} day(s) · next check-in {formatDate(agent.next_checkin_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/doctor/patients/${agent.patient_id}`}>
                  <Button variant="ghost">View patient</Button>
                </Link>
                {agent.status === "active" && (
                  <Button variant="secondary" onClick={() => setStatus(agent.id, "paused")} disabled={busyId === agent.id}>
                    Pause
                  </Button>
                )}
                {agent.status === "paused" && (
                  <Button variant="secondary" onClick={() => setStatus(agent.id, "active")} disabled={busyId === agent.id}>
                    Resume
                  </Button>
                )}
                {agent.status !== "completed" && (
                  <Button variant="ghost" onClick={() => setStatus(agent.id, "completed")} disabled={busyId === agent.id}>
                    Complete
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
