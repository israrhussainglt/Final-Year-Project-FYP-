"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Button } from "@/components/ui";
import { apiUrl } from "@/lib/api";
import { extractCnic } from "@/components/CnicScanner";
import { useQrScanner } from "@/lib/useQrScanner";

type Status = "looking-up" | "found" | "not-found" | "error";

export function Scanner() {
  const router = useRouter();
  const [lookupStatus, setLookupStatus] = useState<Status | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");

  const { videoRef, canvasRef, status: camStatus, error: camError, retry: retryCamera } = useQrScanner(
    (raw) => handleResult(raw)
  );

  async function handleResult(raw: string) {
    // A real CNIC card takes priority — that's the card most patients will
    // actually be carrying. Fall back to a PulseID-issued token/QR link for
    // patients using a printed PulseID card instead.
    const cnic = extractCnic(raw);
    if (cnic) {
      await lookupByCnic(cnic);
    } else {
      const token = extractToken(raw);
      await lookup(token);
    }
  }

  async function lookupByCnic(nationalId: string) {
    setLookupStatus("looking-up");
    setLookupError(null);
    try {
      const res = await fetch(apiUrl(`/api/patients/by-national-id/${encodeURIComponent(nationalId)}`), { credentials: "include" });
      if (res.status === 404) {
        setManualToken(nationalId);
        setLookupStatus("not-found");
        return;
      }
      if (!res.ok) throw new Error("lookup failed");
      const data = await res.json();
      setLookupStatus("found");
      router.push(`/doctor/patients/${data.id}`);
    } catch {
      setLookupError("Couldn't look up that CNIC. Try again or enter it manually.");
      setLookupStatus("error");
    }
  }

  async function lookup(token: string) {
    setLookupStatus("looking-up");
    setLookupError(null);
    try {
      const res = await fetch(apiUrl(`/api/patients/by-token/${encodeURIComponent(token)}`), { credentials: "include" });
      if (res.status === 404) {
        setManualToken(token);
        setLookupStatus("not-found");
        return;
      }
      if (!res.ok) throw new Error("lookup failed");
      const data = await res.json();
      setLookupStatus("found");
      router.push(`/doctor/patients/${data.id}`);
    } catch {
      setLookupError("Couldn't look up that code. Try again or enter it manually.");
      setLookupStatus("error");
    }
  }

  function extractToken(raw: string): string {
    try {
      const url = new URL(raw);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts[parts.length - 1];
    } catch {
      return raw.trim();
    }
  }

  function retry() {
    setLookupStatus(null);
    setLookupError(null);
    retryCamera();
  }

  const cameraMessage: Record<string, string> = {
    starting: "Starting camera…",
    denied: camError || "Camera access was blocked.",
    "no-camera": camError || "No camera available.",
    insecure: camError || "Camera needs a secure connection.",
    error: camError || "Couldn't access the camera.",
  };

  const overlayStatus = lookupStatus ?? (camStatus !== "scanning" ? camStatus : null);

  return (
    <div className="max-w-lg mx-auto px-6 py-10">
      <div className="eyebrow text-teal mb-2">Fast patient lookup</div>
      <h1 className="font-display text-3xl mb-2">Scan a patient's QR</h1>
      <p className="text-sm text-sage mb-6 leading-relaxed">
        Scan a patient's CNIC card (or their PulseID card if they have one) to open their full
        record instantly. If they're not in the system yet, you'll be able to register them in a
        few seconds.
      </p>

      {/* `!bg-ink` (not plain `bg-ink`) is required here: Card hardcodes
          `bg-white` in its base classes, and Tailwind emits `.bg-*` rules
          alphabetically by colour name — `.bg-ink` lands *before* `.bg-white`
          in the stylesheet, so at equal specificity `bg-white` wins and the
          viewport renders white, making the white overlay text and reticle
          border invisible. Same fix as CnicScanner.tsx. */}
      <Card className="overflow-hidden aspect-square relative !bg-ink !border-ink touch-none">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline autoPlay />
        <canvas ref={canvasRef} className="hidden" />
        {overlayStatus && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 text-sm px-6 text-center gap-3">
            {camStatus === "starting" && !lookupStatus && (
              <span className="h-8 w-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            )}
            {lookupStatus === "looking-up" && <span>Looking up patient…</span>}
            {lookupStatus === "found" && <span>Found — opening record…</span>}
            {lookupStatus === "error" && <span>{lookupError}</span>}
            {lookupStatus === "not-found" && (
              <>
                <span className="text-white font-medium">No patient found for that code.</span>
                <span className="text-white/70">This QR isn't linked to anyone in PulseID yet.</span>
              </>
            )}
            {!lookupStatus && camStatus !== "starting" && camStatus !== "found" && (
              <span>{cameraMessage[camStatus] || cameraMessage.error}</span>
            )}
          </div>
        )}
        {camStatus === "scanning" && !lookupStatus && (
          <div className="absolute inset-8 border-2 border-white/70 rounded-2xl pointer-events-none [box-shadow:0_0_0_2000px_rgba(0,0,0,0.25)]" />
        )}
      </Card>

      {lookupStatus === "not-found" && (
        <div className="mt-4 flex flex-col sm:flex-row gap-3">
          {/* Registration is self-service now — the patient books themselves and
              the request lands in the doctor's /doctor/registrations queue,
              where confirming it creates the chart. */}
          <p className="text-sm text-sage flex items-center">
            This code isn&apos;t registered yet. Ask them to request a booking at{" "}
            <span className="font-mono text-ink">/book</span> — it&apos;ll appear in your booking
            requests.
          </p>
          <Button variant="secondary" className="min-h-[44px]" onClick={retry}>
            Scan again
          </Button>
        </div>
      )}

      {(lookupStatus === "error" ||
        camStatus === "error" ||
        camStatus === "denied" ||
        camStatus === "no-camera" ||
        camStatus === "insecure") && (
        <div className="mt-4">
          <Button variant="secondary" onClick={retry} className="min-h-[44px]">
            Try again
          </Button>
        </div>
      )}

      <div className="mt-6">
        <p className="text-sm text-sage mb-2">Or enter a CNIC or PulseID code manually:</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const raw = manualToken.trim();
            if (!raw) return;
            const cnic = extractCnic(raw);
            if (cnic) lookupByCnic(cnic);
            else lookup(raw);
          }}
          className="flex gap-2"
        >
          <input
            className="focus-ring flex-1 rounded-lg border border-line bg-white px-3.5 py-2.5 text-base font-mono"
            placeholder="CNIC or PulseID QR code"
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
          />
          <Button type="submit" variant="secondary" className="min-h-[44px]">
            Go
          </Button>
        </form>
      </div>
    </div>
  );
}
