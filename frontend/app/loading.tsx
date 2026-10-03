import { PulseMark } from "@/components/PulseMark";

// Next.js renders this automatically as the Suspense fallback for any route
// segment that's still fetching data (e.g. the emergency page resolving a
// QR token, or a doctor dashboard pulling patient data) — no wiring needed
// beyond this file existing.
export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-paper">
      <PulseMark className="w-40 h-8" />
      <p className="eyebrow text-sage">Securing connection…</p>
    </div>
  );
}
