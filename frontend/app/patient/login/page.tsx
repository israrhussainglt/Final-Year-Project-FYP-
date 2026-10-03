"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PulseMark } from "@/components/PulseMark";
import { Card, Button, Field, inputClass } from "@/components/ui";
import { CnicScanner } from "@/components/CnicScanner";
import { apiUrl } from "@/lib/api";

type Step = "scan" | "id" | "not-found" | "otp";

// Auto-inserts the dashes as the person types: 12345-1234567-1
function formatNationalId(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 13);
  const part1 = digits.slice(0, 5);
  const part2 = digits.slice(5, 12);
  const part3 = digits.slice(12, 13);
  return [part1, part2, part3].filter(Boolean).join("-");
}

export default function PatientLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("scan");
  const [nationalId, setNationalId] = useState("");
  const [code, setCode] = useState("");
  const [demoOtp, setDemoOtp] = useState<string | null>(null);
  const [maskedPhone, setMaskedPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Only an existing PulseID can log in here — patients can't create their
  // own record. If the CNIC isn't recognized, they're told to visit a
  // hospital or clinic, where a doctor or front-desk clerk registers them.
  async function requestOtp(id: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/auth/patient/request-otp"), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nationalId: id }),
      });
      const data = await res.json();
      if (res.status === 404) {
        setNationalId(id);
        setStep("not-found");
        return;
      }
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setStep("id");
        return;
      }
      setDemoOtp(data.demoOtp);
      setMaskedPhone(data.maskedPhone);
      setStep("otp");
    } catch {
      setError("Could not reach the server. Please try again.");
      setStep("id");
    } finally {
      setLoading(false);
    }
  }

  function handleScanned(cnic: string) {
    setNationalId(cnic);
    requestOtp(cnic);
  }

  function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nationalId.trim()) return;
    requestOtp(nationalId.trim());
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/auth/patient/verify-otp"), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nationalId, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      router.push("/patient/home");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function startOver() {
    setError(null);
    setCode("");
    setStep("scan");
  }

  return (
    <main className="min-h-screen flex flex-col">
      <div className="h-1.5 bg-ink" />
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Link href="/" className="inline-block mb-8">
            <PulseMark className="w-28 h-6" tone="ink" />
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span className="inline-flex items-center rounded-full bg-line px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase text-ink">
              Patient Portal
            </span>
            <Link
              href="/emergency/scan"
              className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-alert/40 bg-alert/10 px-2.5 py-1 text-[11px] font-semibold text-alert hover:bg-alert/15 transition-colors whitespace-nowrap"
            >
              🚨 Emergency Scan
            </Link>
          </div>
          <div className="eyebrow text-teal mb-2">Patient Access</div>
          <h1 className="font-display text-3xl mb-8">My Reports</h1>

          <Card className="p-6">
            {step === "scan" && (
              <div className="space-y-4">
                <CnicScanner onDetected={handleScanned} />
                {error && <p className="text-sm text-alert">{error}</p>}
                {loading && <p className="text-sm text-sage text-center">One moment…</p>}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep("id");
                  }}
                  className="focus-ring text-sm text-sage hover:text-ink w-full text-center"
                >
                  Can't scan? Enter your CNIC manually →
                </button>
              </div>
            )}

            {step === "id" && (
              <form onSubmit={handleManualSubmit} className="space-y-4">
                <Field label="CNIC / National ID" hint="e.g. 35202-1234567-1">
                  <input
                    className={`${inputClass} font-mono`}
                    value={nationalId}
                    onChange={(e) => setNationalId(formatNationalId(e.target.value))}
                    required
                    autoFocus
                    inputMode="numeric"
                  />
                </Field>
                {error && <p className="text-sm text-alert">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Checking…" : "Continue"}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep("scan");
                  }}
                  className="focus-ring text-sm text-sage hover:text-ink w-full text-center"
                >
                  ← Scan my CNIC instead
                </button>
              </form>
            )}

            {step === "not-found" && (
              <div className="space-y-4">
                <div className="rounded-lg bg-alert-light px-3.5 py-2.5 text-sm text-alert">
                  No PulseID exists yet for <span className="font-mono font-semibold">{nationalId}</span>.
                </div>
                <p className="text-sm text-sage leading-relaxed">
                  Patients can't set up their own PulseID. Visit any partner hospital or clinic and
                  a doctor or front-desk clerk will register you in a few seconds — you'll be able
                  to sign in here right after.
                </p>
                <button type="button" onClick={startOver} className="focus-ring text-sm text-sage hover:text-ink w-full text-center">
                  ← Try a different CNIC
                </button>
              </div>
            )}

            {step === "otp" && (
              <form onSubmit={verifyOtp} className="space-y-4">
                <p className="text-sm text-sage">
                  We sent a 6-digit verification code to <span className="font-mono">{maskedPhone}</span>.
                </p>
                {demoOtp && (
                  <div className="rounded-lg bg-teal-light px-3.5 py-2.5 text-sm text-teal-dark">
                    Demo mode — no SMS gateway is connected. Your code is{" "}
                    <span className="font-mono font-semibold">{demoOtp}</span>.
                  </div>
                )}
                <Field label="6-digit code">
                  <input
                    className={`${inputClass} font-mono tracking-[0.3em] text-center text-lg`}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    maxLength={6}
                    required
                    autoFocus
                  />
                </Field>
                {error && <p className="text-sm text-alert">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Verifying…" : "Verify & view my reports"}
                </Button>
                <button type="button" onClick={startOver} className="focus-ring text-sm text-sage hover:text-ink w-full text-center">
                  ← Start over
                </button>
              </form>
            )}
          </Card>

          <p className="text-sm mt-6">
            <Link href="/doctor/login" className="text-teal-dark font-medium hover:underline">
              Doctor or hospital staff? Sign in here →
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
