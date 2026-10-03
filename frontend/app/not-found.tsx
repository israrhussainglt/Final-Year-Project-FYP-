import Link from "next/link";
import { PulseMark } from "@/components/PulseMark";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <PulseMark className="w-28 h-6 mb-8" />
      <h1 className="font-display text-3xl mb-2">Nothing found here</h1>
      <p className="text-sage max-w-sm mb-6">
        This National ID, patient or emergency code doesn't match anything on record.
      </p>
      <Link href="/" className="text-teal-dark font-semibold hover:underline">
        ← Back to PulseID
      </Link>
    </main>
  );
}
