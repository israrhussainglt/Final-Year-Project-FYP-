// CSRF protection via the double-submit cookie pattern.
//
// Session cookies are httpOnly (JS can never read them) and SameSite
// Lax/None, so they alone don't stop a cross-site form/fetch from riding
// along with a signed-in user's session. The fix: a second, *non*-httpOnly
// cookie holding a random token. Legitimate same-origin JS can read that
// cookie and echo it back as a header; a cross-site attacker can trigger
// the cookie to be sent automatically, but can't read its value to put it
// in a header (browsers don't allow cross-origin cookie reads). If the
// header and cookie don't match, the request is rejected.
import { randomBytes, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";

export const CSRF_COOKIE = "pulseid_csrf";
export const CSRF_HEADER = "x-csrf-token";

const isProd = process.env.NODE_ENV === "production";

export function newCsrfToken(): string {
  return randomBytes(24).toString("hex");
}

// Not httpOnly — the frontend needs to read this to send it back as a
// header. That's safe: it's useless to an attacker without also forging
// the header, which same-origin-only browser rules prevent.
export function csrfCookieOptions() {
  return {
    httpOnly: false,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 12 * 1000,
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Endpoints that establish a brand-new session are exempt from CSRF outright
// — they're the very thing that mints the CSRF cookie, so requiring one in
// advance is circular. This also fixes a real failure mode: if a browser
// still has a leftover doctor/patient session cookie from an earlier,
// expired or otherwise invalid session, the old "only check if a session
// cookie exists" heuristic would wrongly demand a CSRF token that was never
// issued for this attempt, blocking login entirely with "Missing CSRF
// token." Login-type requests are inherently low-risk for CSRF (rate-limited,
// and a forged one just logs the attacker's victim into the attacker's own
// account) and don't need this protection at all.
const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/doctor/login",
  "/api/auth/hospital-admin/login",
  "/api/auth/patient/request-otp",
  "/api/auth/patient/verify-otp",
  // The public self-service booking form. Exempt for the same reason as the
  // endpoints above: it authorizes nothing. It reads no session, takes every
  // identity field from the request body, and only ever creates a *pending*
  // registration for a doctor to review — so a forged request can't act in
  // anyone's name, read anything back, or escalate any privilege. Forcing a
  // token here was actively broken: the "only check when a session cookie
  // exists" rule meant the form was gated only for visitors who happened to
  // have a leftover doctor/patient session on the same browser, and it failed
  // them with "Missing CSRF token" on a public, logged-out page. The 5/hour
  // per-IP rate limit is what bounds spam here.
  "/api/booking/requests",
]);

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();

  const hasSession = Boolean(
    req.cookies?.pulseid_doctor_session ||
      req.cookies?.pulseid_patient_session ||
      req.cookies?.pulseid_hospital_admin_session
  );
  if (!hasSession) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);

  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: "Missing CSRF token." });
  }

  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(403).json({ error: "Invalid CSRF token." });
  }

  next();
}
