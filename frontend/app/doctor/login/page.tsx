"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PulseMark } from "@/components/PulseMark";
import { Card, Button, Field, inputClass } from "@/components/ui";
import { apiUrl } from "@/lib/api";

export default function DoctorLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("ayesha.raza@pulseid.dev");
  const [password, setPassword] = useState("doctor123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/auth/doctor/login"), { credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      router.push("/doctor/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <div className="h-1.5 bg-teal" />
      <div className="flex-1 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="inline-block mb-8">
          <PulseMark className="w-28 h-6" />
        </Link>
        <span className="inline-flex items-center rounded-full bg-teal-light px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase text-teal-dark mb-3">
          Hospital / Clinician Portal
        </span>
        <div className="eyebrow text-teal mb-2">Doctors &amp; hospital staff</div>
        <h1 className="font-display text-3xl mb-8">Sign in to PulseID</h1>
        <p className="text-sm text-sage -mt-6 mb-8 leading-relaxed">
          For doctors, nurses, and front-desk clerks registering new patients on a hospital's
          behalf.
        </p>

        <Card className="p-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Email">
              <input
                className={inputClass}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field label="Password">
              <input
                className={inputClass}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            {error && <p className="text-sm text-alert">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Card>

        <p className="text-xs text-sage mt-4">
          Demo credentials are pre-filled. Second demo account:{" "}
          <span className="font-mono">bilal.ahmed@pulseid.dev</span> /{" "}
          <span className="font-mono">doctor123</span>.
        </p>
        <p className="text-sm mt-6">
          <Link href="/patient/login" className="text-teal-dark font-medium hover:underline">
            Looking for My Reports? →
          </Link>
        </p>
      </div>
      </div>
    </main>
  );
}
