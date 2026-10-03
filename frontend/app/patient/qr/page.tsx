import { redirect } from "next/navigation";
import Link from "next/link";
import { serverFetch } from "@/lib/server-api";
import { PatientHeader } from "@/components/patient/PatientHeader";
import { Card, Badge, formatDate } from "@/components/ui";

type MeResponse = { role: "patient"; session: { fullName: string; nationalId: string } };

type QrResponse = {
  emergencyUrl: string;
  dataUrl: string;
  rotatedAt: string | null;
  rotationCount: number;
  rotationLog: { id: string; reason: string; rotated_at: string }[];
};

export default async function PatientEmergencyAccessPage() {
  const me = await serverFetch<MeResponse>("/api/me");
  if (me.status !== 200 || me.data?.role !== "patient") redirect("/patient/login");

  const { fullName, nationalId } = me.data.session;
  const qr = await serverFetch<QrResponse>("/api/patient/qr");

  return (
    <main className="min-h-screen bg-paper">
      <PatientHeader patientName={fullName} />

      <div className="max-w-md mx-auto px-6 md:px-10 py-10">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="eyebrow text-teal">Two ways to be scanned</div>
          <Link
            href="/patient/emergency-scan"
            className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-alert/40 bg-alert/10 px-3 py-1.5 text-xs font-semibold text-alert hover:bg-alert/15 transition-colors whitespace-nowrap"
          >
            🚨 Emergency Scan
          </Link>
        </div>
        <h1 className="font-display text-3xl mb-2 text-center">Your emergency access</h1>
        <p className="text-sm text-sage mb-8 leading-relaxed text-center">
          A doctor or first responder can scan either your CNIC card, or the live QR code below —
          both instantly show your blood group, allergies, chronic conditions and emergency
          contacts. Nothing else is ever shown.
        </p>

        {qr.data ? (
          <Card className="p-6 mb-6 text-center">
            <div className="eyebrow text-sage mb-3">Your PulseID QR</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qr.data.dataUrl}
              alt="Your PulseID emergency QR code"
              className="mx-auto w-56 h-56 rounded-xl border border-line bg-white p-2"
            />
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Badge tone="alert">Rotates on every scan</Badge>
              <Badge tone="sage">Every scan is logged</Badge>
            </div>
            <p className="text-xs text-sage mt-4 leading-relaxed">
              {qr.data.rotatedAt
                ? `Last rotated ${formatDate(qr.data.rotatedAt)} · ${qr.data.rotationCount} rotation${
                    qr.data.rotationCount === 1 ? "" : "s"
                  } total.`
                : "This code hasn't been scanned yet."}{" "}
              A screenshot or photo of this code stops working the moment it's scanned once, so it
              can't be reused later without your knowledge.
            </p>
          </Card>
        ) : (
          <Card className="p-6 mb-6">
            <p className="text-sm text-alert">
              Couldn't load your QR code right now. Your CNIC card below still works as a fallback.
            </p>
          </Card>
        )}

        <Card className="p-6 mb-6">
          <div className="eyebrow text-sage mb-3">Your CNIC on file</div>
          <p className="font-mono text-lg text-ink">{nationalId}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="teal">Always available — no rotation</Badge>
          </div>
          <p className="text-xs text-sage mt-3 leading-relaxed">
            Unlike the QR above, your physical CNIC can't change itself, so scanning it always
            works — useful if your phone isn't available. Every scan is still logged the same way.
          </p>
        </Card>

        <Card className="p-6 mb-6">
          <div className="eyebrow text-sage mb-2">What a scan shows</div>
          <ul className="text-sm text-sage space-y-1.5">
            <li>• Full name, age and gender</li>
            <li>• Blood group</li>
            <li>• Allergies and chronic conditions</li>
            <li>• Emergency contacts, tap-to-call</li>
          </ul>
          <p className="text-sm text-sage mt-3">
            Your full medical history is never shown here — only what's life-critical.
          </p>
        </Card>

        <Link
          href={`/emergency/cnic/${encodeURIComponent(nationalId)}`}
          target="_blank"
          className="focus-ring block text-center w-full rounded-lg border border-line bg-white px-4 py-3 text-sm font-semibold text-ink hover:bg-line/40 transition-colors"
        >
          See what a CNIC scan looks like →
        </Link>
        <p className="text-xs text-sage mt-3 text-center leading-relaxed">
          Opening this yourself is logged the same way a real scan would be — check your{" "}
          <Link href="/patient/audit-log" className="underline hover:no-underline">
            audit log
          </Link>{" "}
          any time to see who has looked at your emergency info.
        </p>
      </div>
    </main>
  );
}
