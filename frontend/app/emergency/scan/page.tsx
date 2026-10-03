import Link from "next/link";
import { PulseMark } from "@/components/PulseMark";
import { EmergencyScanner } from "@/components/patient/EmergencyScanner";

// Deliberately public — no session check. A first responder or bystander
// will never have a PulseID login, so this route has to work the same way
// the real CNIC-on-a-card flow does: open it, scan, see only the
// life-critical fields. Logged-in patients previewing their own emergency
// view still reach the same component from /patient/emergency-scan.
export default function PublicEmergencyScanPage() {
  return (
    <main className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white">
        <div className="h-1 bg-alert" />
        <div className="max-w-4xl mx-auto px-6 md:px-10 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <PulseMark className="w-24 h-5" tone="alert" />
            <span className="hidden md:inline-flex items-center rounded-full bg-alert/10 px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase text-alert">
              Emergency Scan
            </span>
          </Link>
          <Link href="/" className="text-sm font-medium text-sage hover:text-ink">
            ← Back to PulseID
          </Link>
        </div>
      </header>
      <EmergencyScanner />
    </main>
  );
}
