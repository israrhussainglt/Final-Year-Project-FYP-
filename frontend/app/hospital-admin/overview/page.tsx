import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { HospitalAdminHeader } from "@/components/hospital-admin/HospitalAdminHeader";
import { StatsOverview, type HospitalAdminStats } from "@/components/hospital-admin/StatsOverview";
import { AiBriefingCard } from "@/components/hospital-admin/AiBriefingCard";

type MeResponse = { role: "hospital_admin"; session: { fullName: string; hospitalName?: string } };

export default async function HospitalAdminOverviewPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "hospital_admin") redirect("/hospital-admin/login");
  const session = me.data.session;

  const statsRes = await serverFetch<{ stats: HospitalAdminStats }>("/api/hospital-admin/stats");
  const stats = statsRes.data?.stats || null;

  return (
    <main className="min-h-screen bg-paper">
      <HospitalAdminHeader adminName={session?.fullName || "Admin"} hospitalName={session?.hospitalName} />

      <div className="max-w-6xl mx-auto px-6 md:px-10 py-10">
        <div className="mb-8">
          <div className="eyebrow text-teal mb-2">{session?.hospitalName || "Your hospital"}</div>
          <h1 className="font-display text-3xl">Overview</h1>
          <p className="text-sm text-sage mt-2 leading-relaxed max-w-2xl">
            Patient volume, appointment load, and doctor activity for this hospital only — the
            same kind of numbers the analytics team sees, scoped to your own doctors.
          </p>
        </div>

        <AiBriefingCard
          endpoint="/api/hospital-admin/weekly-digest"
          eyebrow="AI-drafted weekly digest"
          label="Generate digest"
          regenerateLabel="Regenerate"
          description="Get a short, AI-written read on this week vs last week — new patients, completed visits, and appointment volume. Built only from the counts below, never patient details."
        />

        {stats ? (
          <StatsOverview stats={stats} />
        ) : (
          <div className="text-sm text-alert">Couldn't load stats right now. Try refreshing the page.</div>
        )}
      </div>
    </main>
  );
}
