"use client";

import { Card, Button } from "@/components/ui";
import { useQrScanner } from "@/lib/useQrScanner";

// Pakistani CNIC/B-Form format: 5 digits - 7 digits - 1 digit
// (e.g. 35202-1234567-1). A QR code on a CNIC/B-Form card may encode just
// the 13 raw digits or the dashed form, or embed it inside a longer string
// (e.g. a URL) — this regex pulls the ID out of whatever the code contains.
const CNIC_RE = /(\d{5})-?(\d{7})-?(\d)/;

// A PulseID emergency QR encodes a rotating 32-character hex token, either
// bare or inside an /emergency/:token URL — distinct from a CNIC/B-Form,
// which is why this needs its own check rather than reusing CNIC_RE.
const TOKEN_RE = /^[a-f0-9]{32}$/i;

export function extractCnic(raw: string): string | null {
  const match = raw.match(CNIC_RE);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function extractEmergencyToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (TOKEN_RE.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && TOKEN_RE.test(last)) return last;
  } catch {
    // not a URL — fall through
  }
  return null;
}

// A single scan result: either a CNIC/B-Form number, or a PulseID rotating
// emergency token, whichever the code actually contains. CNIC/B-Form takes
// priority since that's what most people will actually be carrying and
// scanning (their own printed card, or someone else's for first aid).
export type ScanResult = { type: "cnic"; value: string } | { type: "token"; value: string };

export function extractScanResult(raw: string): ScanResult | null {
  const cnic = extractCnic(raw);
  if (cnic) return { type: "cnic", value: cnic };
  const token = extractEmergencyToken(raw);
  if (token) return { type: "token", value: token };
  return null;
}

export function CnicScanner({
  onDetected,
  onScanResult,
  hint,
}: {
  onDetected?: (cnic: string) => void;
  onScanResult?: (result: ScanResult) => void;
  hint?: string;
}) {
  const { videoRef, canvasRef, status, error, retry } = useQrScanner((raw) => {
    const result = extractScanResult(raw);
    if (result) {
      if (result.type === "cnic") onDetected?.(result.value);
      onScanResult?.(result);
    }
    // A QR was read but it didn't contain anything CNIC/B-Form or
    // PulseID-token shaped — the hook already stopped scanning on any
    // detected code, so retry() is offered via the error state pattern
    // below rather than silently looping forever on an unrelated code.
  });

  const statusMessage: Record<string, string> = {
    starting: "Starting camera…",
    found: "Code recognized…",
    denied: error || "Camera access was blocked.",
    "no-camera": error || "No camera available.",
    insecure: error || "Camera needs a secure connection.",
    error: error || "Couldn't access the camera.",
  };

  return (
    <div>
      {/* `!bg-ink` (not plain `bg-ink`) is required here: Card hardcodes
          `bg-white` in its base classes, and Tailwind emits `.bg-*` rules
          alphabetically by colour name — `.bg-ink` lands *before* `.bg-white`
          in the stylesheet, so at equal specificity `bg-white` wins and the
          viewport renders white. That makes the white status text and the
          white reticle border invisible against it. The `!` important
          modifier is the same workaround already used in LandingApp.tsx's
          dark Card. `!border-ink` keeps the hairline border from reading as a
          light frame around the camera feed. */}
      <Card className="overflow-hidden aspect-square relative !bg-ink !border-ink touch-none">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          muted
          playsInline
          autoPlay
        />
        <canvas ref={canvasRef} className="hidden" />
        {status !== "scanning" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 text-sm px-6 text-center gap-3">
            {status === "starting" ? (
              <>
                <span className="h-8 w-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                <span>{statusMessage.starting}</span>
              </>
            ) : (
              <span>{statusMessage[status] || statusMessage.error}</span>
            )}
          </div>
        )}
        {status === "scanning" && (
          <div className="absolute inset-8 border-2 border-white/70 rounded-2xl pointer-events-none [box-shadow:0_0_0_2000px_rgba(0,0,0,0.25)]" />
        )}
      </Card>
      <p className="text-xs text-sage mt-3 text-center leading-relaxed">
        {hint || "Hold the QR code on your CNIC or PulseID card up to the camera."}
      </p>
      {(status === "error" || status === "denied" || status === "no-camera" || status === "insecure") && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={retry} className="min-h-[44px]">
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
