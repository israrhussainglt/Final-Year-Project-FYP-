import { SignJWT, jwtVerify } from "jose";

const secretString = process.env.SESSION_SECRET || "pulseid-dev-secret-change-me";
const secret = new TextEncoder().encode(secretString);

export const DOCTOR_COOKIE = "pulseid_doctor_session";
export const PATIENT_COOKIE = "pulseid_patient_session";
// Hospital-admin auth is a peer of doctor auth (same hashing/session
// mechanics below), so it gets its own independent cookie rather than
// being layered onto either the doctor or patient session shape.
export const HOSPITAL_ADMIN_COOKIE = "pulseid_hospital_admin_session";

export type DoctorSession = {
  role: "doctor";
  doctorId: string;
  fullName: string;
  email: string;
  hospitalName?: string;
};

export type PatientSession = {
  role: "patient";
  patientId: string;
  fullName: string;
  nationalId: string;
};

export type HospitalAdminSession = {
  role: "hospital_admin";
  hospitalAdminId: string;
  fullName: string;
  email: string;
  hospitalId: string;
  hospitalName: string;
};

export type Session = DoctorSession | PatientSession | HospitalAdminSession;

// Shared cookie flags: httpOnly (no JS access ever, on either side), and
// secure + sameSite=none in production so the cookie can travel from the
// frontend origin to this API's origin when they're deployed on different
// domains. Locally (same "site" — just different ports) `lax` is enough and
// keeps things working without HTTPS.
const isProd = process.env.NODE_ENV === "production";
export function sessionCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    secure: isProd,
    path: "/",
    maxAge: maxAgeMs,
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}

export async function signSession(payload: Session, expiresIn = "12h"): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

export async function verifySession<T extends Session>(token: string | undefined | null): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as T;
  } catch {
    return null;
  }
}
