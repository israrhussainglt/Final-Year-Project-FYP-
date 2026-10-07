// Unit coverage for the small, pure lib modules: session signing/verifying,
// CSRF double-submit enforcement, the sliding-window rate limiter, the
// city->province lookup, the rule-based risk scorer, the Twilio SMS wrapper
// (fetch stubbed), and the RAG drafter's not-configured guard.
//
// No database — everything here runs against module state or stubs.

import { afterAll, describe, expect, it, vi } from "vitest";

// nodemailer is mocked file-wide (only email.ts consumes it) so the SMTP
// wrapper can be exercised without a server.
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn() },
}));

// ---------------------------------------------------------------------------
// auth.ts
// ---------------------------------------------------------------------------

import {
  DOCTOR_COOKIE,
  HOSPITAL_ADMIN_COOKIE,
  PATIENT_COOKIE,
  sessionCookieOptions,
  signSession,
  verifySession,
  type DoctorSession,
  type HospitalAdminSession,
  type PatientSession,
} from "../lib/auth";

describe("session signing (auth.ts)", () => {
  const doctor: DoctorSession = {
    role: "doctor",
    doctorId: "doc-1",
    fullName: "Dr. Test",
    email: "t@pulseid.dev",
    hospitalName: "Lahore General",
  };

  it("round-trips a doctor session through sign + verify", async () => {
    const token = await signSession(doctor);
    expect(await verifySession<DoctorSession>(token)).toMatchObject(doctor);
  });

  it("round-trips patient and hospital-admin session shapes", async () => {
    const patient: PatientSession = { role: "patient", patientId: "p-1", fullName: "A", nationalId: "42101-1-1" };
    const admin: HospitalAdminSession = {
      role: "hospital_admin",
      hospitalAdminId: "h-1",
      fullName: "B",
      email: "b@pulseid.dev",
      hospitalId: "hosp-1",
      hospitalName: "Lahore General",
    };
    expect(await verifySession<PatientSession>(await signSession(patient))).toMatchObject(patient);
    expect(await verifySession<HospitalAdminSession>(await signSession(admin))).toMatchObject(admin);
  });

  it("returns null for missing, empty, or garbage tokens", async () => {
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession(null)).toBeNull();
    expect(await verifySession("")).toBeNull();
    expect(await verifySession("not-a-jwt")).toBeNull();
    // Signed with a different secret → signature check fails.
    const foreign = await signSession(doctor);
    process.env.SESSION_SECRET = "another-secret";
    vi.resetModules();
    const fresh = await import("../lib/auth");
    expect(await fresh.verifySession(foreign)).toBeNull();
    delete process.env.SESSION_SECRET;
    vi.resetModules();
  });

  it("returns null for an expired token", async () => {
    const expired = await signSession(doctor, "-1s");
    expect(await verifySession(expired)).toBeNull();
  });

  it("names the three independent session cookies", () => {
    expect(DOCTOR_COOKIE).toBe("pulseid_doctor_session");
    expect(PATIENT_COOKIE).toBe("pulseid_patient_session");
    expect(HOSPITAL_ADMIN_COOKIE).toBe("pulseid_hospital_admin_session");
  });

  it("uses lax/non-secure cookies in dev and none/secure in production", async () => {
    const dev = sessionCookieOptions(1000);
    expect(dev).toMatchObject({ httpOnly: true, sameSite: "lax", secure: false, path: "/" });

    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const prodAuth = await import("../lib/auth");
    const prod = prodAuth.sessionCookieOptions(1000);
    expect(prod).toMatchObject({ httpOnly: true, sameSite: "none", secure: true, path: "/" });
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// csrf.ts
// ---------------------------------------------------------------------------

import { CSRF_COOKIE, CSRF_HEADER, csrfCookieOptions, csrfProtection, newCsrfToken } from "../lib/csrf";

function csrfReq(method: string, path: string, cookies: Record<string, string> = {}, header?: string) {
  return {
    method,
    path,
    cookies,
    get: (h: string) => (h.toLowerCase() === CSRF_HEADER ? header : undefined),
  } as never;
}

function csrfRes() {
  const res: { code?: number; body?: unknown; status: (c: number) => unknown; json: (b: unknown) => unknown } = {
    status(code: number) {
      this.code = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

describe("csrf double-submit (csrf.ts)", () => {
  it("mints 24-byte hex tokens", () => {
    const a = newCsrfToken();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(newCsrfToken()).not.toBe(a);
  });

  it("cookie is readable by JS (not httpOnly) with dev flags", () => {
    expect(csrfCookieOptions()).toMatchObject({ httpOnly: false, sameSite: "lax", secure: false });
  });

  it("passes safe methods, exempt paths, and sessionless requests", () => {
    const next = vi.fn();
    csrfProtection(csrfReq("GET", "/api/patients"), csrfRes(), next);
    csrfProtection(csrfReq("POST", "/api/auth/doctor/login"), csrfRes(), next);
    csrfProtection(csrfReq("POST", "/api/booking/requests"), csrfRes(), next);
    csrfProtection(csrfReq("POST", "/api/patients/x/records"), csrfRes(), next); // no session cookie
    expect(next).toHaveBeenCalledTimes(4);
  });

  it("rejects a session request with missing or mismatched tokens", () => {
    const token = newCsrfToken();
    const missing = csrfRes();
    csrfProtection(csrfReq("POST", "/api/patients", { pulseid_doctor_session: "s" }), missing, vi.fn());
    expect(missing.code).toBe(403);
    expect((missing.body as { error: string }).error).toMatch(/Missing/);

    const cookieOnly = csrfRes();
    csrfProtection(
      csrfReq("DELETE", "/api/x", { pulseid_patient_session: "s", [CSRF_COOKIE]: token }),
      cookieOnly,
      vi.fn()
    );
    expect(cookieOnly.code).toBe(403);

    const mismatch = csrfRes();
    csrfProtection(
      csrfReq("POST", "/api/x", { pulseid_doctor_session: "s", [CSRF_COOKIE]: token }, newCsrfToken()),
      mismatch,
      vi.fn()
    );
    expect(mismatch.code).toBe(403);
    expect((mismatch.body as { error: string }).error).toMatch(/Invalid/);
  });

  it("accepts a matching cookie+header pair", () => {
    const token = newCsrfToken();
    const next = vi.fn();
    csrfProtection(
      csrfReq("POST", "/api/patients", { pulseid_doctor_session: "s", [CSRF_COOKIE]: token }, token),
      csrfRes(),
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// rate-limit.ts
// ---------------------------------------------------------------------------

import { rateLimit, requestIp } from "../lib/rate-limit";
import type { Request } from "express";

describe("sliding-window rate limiter (rate-limit.ts)", () => {
  it("allows the first request and counts up to the limit", () => {
    expect(rateLimit("test-a", 2, 60_000)).toEqual({ ok: true });
    expect(rateLimit("test-a", 2, 60_000)).toEqual({ ok: true });
    const blocked = rateLimit("test-a", 2, 60_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets when the window elapses", async () => {
    expect(rateLimit("test-b", 1, 30).ok).toBe(true);
    expect(rateLimit("test-b", 1, 30).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 40));
    expect(rateLimit("test-b", 1, 30)).toEqual({ ok: true });
  });

  it("keeps keys independent", () => {
    expect(rateLimit("test-c-1", 1, 60_000).ok).toBe(true);
    expect(rateLimit("test-c-2", 1, 60_000).ok).toBe(true);
  });

  it("extracts the client IP: forwarded first, then req.ip, then socket, then unknown", () => {
    expect(requestIp({ headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } } as Request)).toBe("1.2.3.4");
    expect(requestIp({ headers: {}, ip: "9.9.9.9" } as unknown as Request)).toBe("9.9.9.9");
    expect(requestIp({ headers: {}, socket: { remoteAddress: "7.7.7.7" } } as unknown as Request)).toBe("7.7.7.7");
    expect(requestIp({ headers: {} } as Request)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// provinces.ts
// ---------------------------------------------------------------------------

import { PROVINCES, provinceForCity } from "../lib/provinces";

describe("city -> province lookup (provinces.ts)", () => {
  it("maps cities case- and whitespace-insensitively", () => {
    expect(provinceForCity("Lahore")).toBe("Punjab");
    expect(provinceForCity("  KARACHI ")).toBe("Sindh");
    expect(provinceForCity("peshawar")).toBe("Khyber Pakhtunkhwa");
    expect(provinceForCity("islamabad")).toBe("Islamabad Capital Territory");
  });

  it("returns null for unknown, empty, or missing input", () => {
    expect(provinceForCity("Atlantis")).toBeNull();
    expect(provinceForCity("")).toBeNull();
    expect(provinceForCity(null)).toBeNull();
    expect(provinceForCity(undefined)).toBeNull();
  });

  it("covers all seven administrative units", () => {
    expect(PROVINCES).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// risk-scoring.ts
// ---------------------------------------------------------------------------

import { RISK_DISCLAIMER, computeRiskAssessment, hasAnyVitals, type RiskInput } from "../lib/risk-scoring";

const base: RiskInput = {
  ageYears: null,
  systolicBp: null,
  diastolicBp: null,
  bloodSugarMmol: null,
  bodyTempC: null,
  heartRateBpm: null,
  context: "general",
};

describe("vital presence check (risk-scoring.ts)", () => {
  it("is false only when every vital is null", () => {
    expect(hasAnyVitals(base)).toBe(false);
    expect(hasAnyVitals({ ...base, bodyTempC: 36.8 })).toBe(true);
    expect(hasAnyVitals({ ...base, systolicBp: 120 })).toBe(true);
    expect(hasAnyVitals({ ...base, diastolicBp: 80 })).toBe(true);
    expect(hasAnyVitals({ ...base, bloodSugarMmol: 5 })).toBe(true);
    expect(hasAnyVitals({ ...base, heartRateBpm: 70 })).toBe(true);
  });
});

describe("rule-based risk score (risk-scoring.ts)", () => {
  it("scores a fully normal panel as low with a no-factors note", () => {
    const r = computeRiskAssessment({
      ...base,
      ageYears: 30,
      systolicBp: 120,
      diastolicBp: 80,
      bloodSugarMmol: 5.0,
      bodyTempC: 36.8,
      heartRateBpm: 75,
    });
    expect(r.level).toBe("low");
    expect(r.score).toBe(0);
    expect(r.factors).toEqual(["No risk factors flagged from the vitals provided."]);
    expect(RISK_DISCLAIMER).toMatch(/not a diagnosis/i);
  });

  it("flags severely elevated BP — crisis range for adults, pre-eclampsia range for maternal", () => {
    const adult = computeRiskAssessment({ ...base, systolicBp: 185, diastolicBp: 95 });
    expect(adult.score).toBe(40);
    expect(adult.factors[0]).toMatch(/hypertensive crisis/);

    const maternal = computeRiskAssessment({ ...base, systolicBp: 162, context: "maternal" });
    expect(maternal.score).toBe(50);
    expect(maternal.factors[0]).toMatch(/pre-eclampsia/);
  });

  it("flags elevated BP at the 140/90 band and low BP under 90 systolic", () => {
    expect(computeRiskAssessment({ ...base, systolicBp: 145 }).score).toBe(20);
    expect(computeRiskAssessment({ ...base, diastolicBp: 95, context: "maternal" }).score).toBe(30);
    expect(computeRiskAssessment({ ...base, systolicBp: 88, diastolicBp: 50 }).factors[0]).toMatch(/Low blood pressure/);
    // A zero systolic is treated as "not recorded", not as low BP.
    expect(computeRiskAssessment({ ...base, systolicBp: 0, diastolicBp: 50 }).score).toBe(0);
  });

  it("covers all three blood-sugar bands", () => {
    expect(computeRiskAssessment({ ...base, bloodSugarMmol: 12 }).factors[0]).toMatch(/diabetic range/);
    expect(computeRiskAssessment({ ...base, bloodSugarMmol: 7.5 }).score).toBe(15);
    expect(computeRiskAssessment({ ...base, bloodSugarMmol: 7.5, context: "maternal" }).score).toBe(25);
    expect(computeRiskAssessment({ ...base, bloodSugarMmol: 3.2 }).factors[0]).toMatch(/hypoglycaemic/);
  });

  it("covers all three temperature bands", () => {
    expect(computeRiskAssessment({ ...base, bodyTempC: 40 }).factors[0]).toMatch(/High fever/);
    expect(computeRiskAssessment({ ...base, bodyTempC: 38.2 }).factors[0]).toMatch(/^Fever/);
    expect(computeRiskAssessment({ ...base, bodyTempC: 35 }).factors[0]).toMatch(/hypothermia/);
  });

  it("covers both heart-rate bands", () => {
    expect(computeRiskAssessment({ ...base, heartRateBpm: 130 }).score).toBe(20);
    expect(computeRiskAssessment({ ...base, heartRateBpm: 40 }).score).toBe(20);
    expect(computeRiskAssessment({ ...base, heartRateBpm: 110 }).score).toBe(10);
    expect(computeRiskAssessment({ ...base, heartRateBpm: 47 }).score).toBe(10);
  });

  it("applies age rules per context", () => {
    expect(computeRiskAssessment({ ...base, ageYears: 70 }).factors[0]).toMatch(/vulnerability/);
    // Maternal flags only the extremes: <18 or >35. In-range ages add nothing.
    expect(computeRiskAssessment({ ...base, ageYears: 25, context: "maternal" }).score).toBe(0);
    expect(computeRiskAssessment({ ...base, ageYears: 16, context: "maternal" }).score).toBe(10);
    expect(computeRiskAssessment({ ...base, ageYears: 40, context: "maternal" }).score).toBe(10);
    expect(computeRiskAssessment({ ...base, ageYears: 25 }).score).toBe(0);
  });

  it("clamps the score at 100 and grades low/mid/high", () => {
    const extreme = computeRiskAssessment({
      ...base,
      systolicBp: 200,
      diastolicBp: 130,
      bloodSugarMmol: 20,
      bodyTempC: 41,
      heartRateBpm: 150,
      ageYears: 80,
    });
    expect(extreme.score).toBe(100);
    expect(extreme.level).toBe("high");

    // 30 (sugar in the diabetic range) lands exactly on the mid boundary.
    expect(computeRiskAssessment({ ...base, bloodSugarMmol: 11.1 }).level).toBe("mid");
    // 20 stays low.
    expect(computeRiskAssessment({ ...base, bloodSugarMmol: 3.0 }).level).toBe("low");
    // BP crisis (40) + fever (25) crosses 60 → high.
    expect(computeRiskAssessment({ ...base, systolicBp: 190, bodyTempC: 39.6 }).level).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// sms.ts (Twilio wrapper, fetch stubbed)
// ---------------------------------------------------------------------------

describe("Twilio SMS wrapper (sms.ts)", () => {
  it("reports not-configured when the TWILIO_* env vars are absent", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("TWILIO_FROM_NUMBER", "");
    vi.resetModules();
    const sms = await import("../lib/sms");
    expect(sms.SMS_CONFIGURED).toBe(false);
    expect(await sms.sendOtpSms("+92 300 0000000", "123456")).toEqual({
      ok: false,
      error: expect.stringMatching(/not configured/),
    });
    expect(await sms.sendReminderSms("+92 300 0000000", "Reminder")).toMatchObject({ ok: false });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sends via the Twilio REST API when configured", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+15550001");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const sms = await import("../lib/sms");
    expect(sms.SMS_CONFIGURED).toBe(true);
    expect(await sms.sendOtpSms("+92 300 0000000", "123456")).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/Accounts/ACtest/Messages.json");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("maps HTTP failures and network throws to a soft failure", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+15550001");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad" }));
    vi.resetModules();
    let sms = await import("../lib/sms");
    expect(await sms.sendReminderSms("+92 300 0000000", "x")).toEqual({ ok: false, error: "Failed to send SMS." });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.resetModules();
    sms = await import("../lib/sms");
    expect(await sms.sendOtpSms("+92 300 0000000", "1")).toEqual({ ok: false, error: "Failed to send SMS." });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// email.ts (SMTP wrapper, nodemailer mocked)
// ---------------------------------------------------------------------------

import nodemailer from "nodemailer";

describe("SMTP email wrapper (email.ts)", () => {
  it("reports not-configured when the SMTP_* env vars are absent", async () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_PASS", "");
    vi.resetModules();
    const email = await import("../lib/email");
    expect(email.EMAIL_CONFIGURED).toBe(false);
    expect(await email.sendEmail({ to: "a@b.dev", subject: "s", text: "t" })).toEqual({
      ok: false,
      error: expect.stringMatching(/not configured/),
    });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sends through the transporter when configured, and soft-fails on error", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.test.dev");
    vi.stubEnv("SMTP_USER", "u");
    vi.stubEnv("SMTP_PASS", "p");
    const sendMail = vi.fn().mockResolvedValue({});
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as never);
    vi.resetModules();
    const email = await import("../lib/email");
    expect(email.EMAIL_CONFIGURED).toBe(true);
    expect(await email.sendEmail({ to: "a@b.dev", subject: "Hello", text: "Body" })).toEqual({ ok: true });
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: "a@b.dev", subject: "Hello", text: "Body" });

    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail: vi.fn().mockRejectedValue(new Error("relay down")),
    } as never);
    vi.resetModules();
    const email2 = await import("../lib/email");
    expect(await email2.sendEmail({ to: "a@b.dev", subject: "s", text: "t" })).toEqual({
      ok: false,
      error: "Failed to send email.",
    });
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// rag.ts (Node client) — configuration guard + error-contract mapping. The
// pipeline itself lives in the Python service (backend/rag, pytest there);
// what's testable here without that process is the opt-in gate and the way
// the client maps the service's 502/503 onto its own error names.
// ---------------------------------------------------------------------------

describe("rag client configuration guard + error mapping", () => {
  const savedUrl = process.env.RAG_SERVICE_URL;
  const savedEnabled = process.env.RAG_SERVICE_ENABLED;

  afterAll(() => {
    if (savedUrl !== undefined) process.env.RAG_SERVICE_URL = savedUrl;
    else delete process.env.RAG_SERVICE_URL;
    if (savedEnabled !== undefined) process.env.RAG_SERVICE_ENABLED = savedEnabled;
    else delete process.env.RAG_SERVICE_ENABLED;
  });

  it("refuses to draft when the RAG service isn't enabled", async () => {
    delete process.env.RAG_SERVICE_URL;
    delete process.env.RAG_SERVICE_ENABLED;
    const { draftPatientReport } = await import("../lib/rag");
    await expect(
      draftPatientReport({ patientName: "P", visitDate: "2026-10-04", keywords: "k", docs: [] })
    ).rejects.toThrow("RAG_DRAFTER_NOT_CONFIGURED");
  });

  it("maps the service's 502 onto RAG_DRAFT_INCOMPLETE (no network: fetch stubbed)", async () => {
    process.env.RAG_SERVICE_URL = "http://127.0.0.1:59999";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("RAG_DRAFT_INCOMPLETE", { status: 502 }))
    );
    const { draftPatientReport } = await import("../lib/rag");
    await expect(
      draftPatientReport({
        patientName: "P",
        visitDate: "2026-10-04",
        keywords: "k",
        docs: [{ label: "Visit 2026-10-01", content: "Stable." }],
      })
    ).rejects.toThrow("RAG_DRAFT_INCOMPLETE");
    vi.unstubAllGlobals();
  });

  it("keeps the retrieval cap", async () => {
    const { RAG_MAX_CHUNKS } = await import("../lib/rag");
    expect(RAG_MAX_CHUNKS).toBe(5);
  });
});
