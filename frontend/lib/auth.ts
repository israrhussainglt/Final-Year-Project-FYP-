// Frontend copy of the session verifier used ONLY by middleware.ts to guard
// page routes without an extra network round-trip on every navigation.
// It never signs tokens — signing happens exclusively on the backend. Both
// services must share the same SESSION_SECRET for this to work.
import { jwtVerify } from "jose";

const secretString = process.env.SESSION_SECRET || "pulseid-dev-secret-change-me";
const secret = new TextEncoder().encode(secretString);

export const DOCTOR_COOKIE = "pulseid_doctor_session";
export const PATIENT_COOKIE = "pulseid_patient_session";
// Mirrors backend/src/lib/auth.ts — hospital-admin auth is a peer of doctor
// auth (same cookie/JWT mechanics), so it gets its own cookie rather than
// being layered onto either the doctor or patient session shape.
export const HOSPITAL_ADMIN_COOKIE = "pulseid_hospital_admin_session";

export type DoctorSession = { role: "doctor"; doctorId: string; fullName: string; email: string; hospitalName?: string };
export type PatientSession = { role: "patient"; patientId: string; fullName: string; nationalId: string };
export type HospitalAdminSession = {
  role: "hospital_admin";
  hospitalAdminId: string;
  fullName: string;
  email: string;
  hospitalId: string;
  hospitalName: string;
};

export async function verifySession<T>(token: string | undefined | null): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as T;
  } catch {
    return null;
  }
}
