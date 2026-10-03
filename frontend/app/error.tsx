"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PulseMark } from "@/components/PulseMark";
import { Button } from "@/components/ui";

// Next.js renders this automatically whenever a page (or anything it
// renders) throws during render — a bad response shape, a null reference,
// a third-party script failing, etc. Without this file, the person sees
// Next's default unstyled error screen (or, in production, a blank page).
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // In a real deployment this is where you'd forward to an error-tracking
    // service (Sentry, etc). Logged here so it's still visible in server
    // logs / browser console during the hackathon.
    console.error("[pulseid] unhandled error:", error);
  }, [error]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center bg-paper">
      <PulseMark className="w-28 h-6 mb-8" />
      <h1 className="font-display text-3xl mb-2">Something interrupted this page</h1>
      <p className="text-sage max-w-md mb-2 leading-relaxed">
        Your data is safe — this was a display error, not a data-loss one. Try again, or head back home.
      </p>
      {error.digest && <p className="text-xs text-sage/70 mb-6">Reference: {error.digest}</p>}
      {!error.digest && <div className="mb-6" />}
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/">
          <Button variant="secondary">Back to PulseID</Button>
        </Link>
      </div>
    </main>
  );
}
