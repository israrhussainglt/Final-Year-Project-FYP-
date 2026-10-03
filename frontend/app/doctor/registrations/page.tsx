import { redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import { DoctorHeader } from "@/components/doctor/DoctorHeader";
import { RegistrationsQueue, type RegistrationRow } from "@/components/doctor/RegistrationsQueue";
import Link from "next/link";
import { Button } from "@/components/ui";

type MeResponse = { role: "doctor"; session: { fullName: string; hospitalName?: string } };
type QueueResponse = { pendingCount: number; registrations: RegistrationRow[] };

// Self-service booking review queue — requests submitted through the public
// /book page and addressed to this doctor. Server-rendered so the pending
// count and list are correct on first paint; actions (allocate / reject /
// download) happen client-side inside RegistrationsQueue.
export default async function DoctorRegistrationsPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "doctor") redirect("/doctor/login");
  const session = me.data.session;

  const queue = await serverFetch<QueueResponse>("/api/doctor/registrations");
  const registrations = queue.data?.registrations || [];
  const pendingCount = queue.data?.pendingCount ?? 0;

  return (
    <main className="min-h-screen bg-paper">
      <DoctorHeader doctorName={session?.fullName || "Doctor"} hospitalName={session?.hospitalName} />

      <div className="max-w-4xl mx-auto px-6 md:px-10 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <div className="eyebrow text-teal mb-2">Booking requests</div>
            <h1 className="font-display text-3xl">
              New patients{" "}
              {pendingCount > 0 && (
                <span className="text-sage font-sans text-xl font-normal">({pendingCount} pending)</span>
              )}
            </h1>
            <p className="text-sm text-sage mt-2 max-w-xl leading-relaxed">
              Requests sent through the public “Book a meeting” page and addressed to you. Confirming
              one creates the patient record and books the appointment at the time you pick.
            </p>
          </div>
          <Link href="/doctor/dashboard">
            <Button variant="secondary">Back to dashboard</Button>
          </Link>
        </div>

        <RegistrationsQueue registrations={registrations} />
      </div>
    </main>
  );
}