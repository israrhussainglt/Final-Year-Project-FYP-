"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Field, inputClass } from "@/components/ui";
import { CnicScanner, extractScanResult, type ScanResult } from "@/components/CnicScanner";

// Auto-inserts the dashes as the person types: 12345-1234567-1
function formatId(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 13);
  const part1 = digits.slice(0, 5);
  const part2 = digits.slice(5, 12);
  const part3 = digits.slice(12, 13);
  return [part1, part2, part3].filter(Boolean).join("-");
}

export function EmergencyScanner() {
  const router = useRouter();
  const [mode, setMode] = useState<"scan" | "manual">("scan");
  const [manualId, setManualId] = useState("");

  function openResult(result: ScanResult) {
    if (result.type === "cnic") {
      router.push(`/emergency/cnic/${encodeURIComponent(result.value)}`);
    } else {
      // A PulseID emergency QR token is single-use — opening it here rotates
      // it immediately, exactly like a real emergency scan would.
      router.push(`/emergency/${encodeURIComponent(result.value)}`);
    }
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const raw = manualId.trim();
    if (!raw) return;
    const result = extractScanResult(raw);
    if (result) {
      openResult(result);
      return;
    }
    // Not a recognizable shape — most likely a CNIC/B-Form typed without a
    // QR to scan, so just try it as one; the emergency page itself will
    // show "not found" if it doesn't match anyone.
    router.push(`/emergency/cnic/${encodeURIComponent(raw)}`);
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-10">
      <div className="eyebrow text-teal mb-2">Preview the emergency view</div>
      <h1 className="font-display text-3xl mb-2">Emergency Scan</h1>
      <p className="text-sm text-sage mb-6 leading-relaxed">
        Scan any CNIC, B-Form, or PulseID QR code to see exactly what a doctor or first responder
        would see. This is the same scoped emergency view used everywhere else in PulseID — only
        life-critical information, nothing more.
      </p>

      {mode === "scan" ? (
        <>
          <CnicScanner
            onScanResult={openResult}
            hint="Hold a CNIC, B-Form, or PulseID QR code up to the camera."
          />
          <button
            type="button"
            onClick={() => setMode("manual")}
            className="focus-ring text-sm text-sage hover:text-ink w-full text-center mt-4"
          >
            Can't scan? Enter a CNIC or B-Form number manually →
          </button>
        </>
      ) : (
        <Card className="p-6">
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <Field label="CNIC or B-Form number" hint="e.g. 35202-1234567-1">
              <input
                className={`${inputClass} font-mono`}
                value={manualId}
                onChange={(e) => setManualId(formatId(e.target.value))}
                required
                autoFocus
                inputMode="numeric"
              />
            </Field>
            <Button type="submit" className="w-full">
              View emergency info
            </Button>
            <button
              type="button"
              onClick={() => setMode("scan")}
              className="focus-ring text-sm text-sage hover:text-ink w-full text-center"
            >
              ← Scan a QR code instead
            </button>
          </form>
        </Card>
      )}

      <p className="text-xs text-sage mt-6 leading-relaxed">
        Opening someone's emergency info this way is logged exactly like a real scan — the patient
        can see it in their own audit log afterward.
      </p>
    </div>
  );
}
