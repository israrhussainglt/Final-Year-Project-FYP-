import { NextRequest, NextResponse } from "next/server";
import {
  verifySession,
  DOCTOR_COOKIE,
  PATIENT_COOKIE,
  HOSPITAL_ADMIN_COOKIE,
  type DoctorSession,
  type PatientSession,
  type HospitalAdminSession,
} from "./lib/auth";

const DOCTOR_PUBLIC = ["/doctor/login"];
const PATIENT_PUBLIC = ["/patient/login"];
const HOSPITAL_ADMIN_PUBLIC = ["/hospital-admin/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/doctor") && !DOCTOR_PUBLIC.includes(pathname)) {
    const token = req.cookies.get(DOCTOR_COOKIE)?.value;
    const session = await verifySession<DoctorSession>(token);
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/doctor/login";
      return NextResponse.redirect(url);
    }
  }

  if (pathname.startsWith("/patient") && !PATIENT_PUBLIC.includes(pathname)) {
    const token = req.cookies.get(PATIENT_COOKIE)?.value;
    const session = await verifySession<PatientSession>(token);
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/patient/login";
      return NextResponse.redirect(url);
    }
  }

  if (pathname.startsWith("/hospital-admin") && !HOSPITAL_ADMIN_PUBLIC.includes(pathname)) {
    const token = req.cookies.get(HOSPITAL_ADMIN_COOKIE)?.value;
    const session = await verifySession<HospitalAdminSession>(token);
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/hospital-admin/login";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/doctor/:path*", "/patient/:path*", "/hospital-admin/:path*"],
};
