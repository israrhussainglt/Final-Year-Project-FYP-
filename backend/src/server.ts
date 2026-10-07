import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import multer from "multer";
import { randomUUID, randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import "dotenv/config";

import {
  DOCTOR_COOKIE,
  PATIENT_COOKIE,
  HOSPITAL_ADMIN_COOKIE,
  signSession,
  verifySession,
  sessionCookieOptions,
  type DoctorSession,
  type PatientSession,
  type HospitalAdminSession,
} from "./lib/auth";
import { rateLimit, requestIp } from "./lib/rate-limit";
import {
  indexRegistration,
  indexPatientVisit,
  retrievePatientContext,
  draftPatientReport,
  isReportDrafterConfigured,
  deleteRagSource,
  reparentRagIndex,
} from "./lib/rag";
import { sendOtpSms, SMS_CONFIGURED } from "./lib/sms";
import { csrfProtection, newCsrfToken, csrfCookieOptions, CSRF_COOKIE } from "./lib/csrf";
import { buildMedicalReport } from "./lib/report";
import { buildReportPdf } from "./lib/pdf-report";
import { askClaude, AI_CONFIGURED, OPS_SYSTEM_PROMPT } from "./lib/ai";
import type { BloodGroup, Medication, RegistrationStatus } from "./lib/types";
import type { AppointmentStatus } from "./lib/types";
import {
  addEmergencyContact,
  canSendOtp,
  createGuardianLinkRequest,
  createMedicalRecord,
  createPatient,
  findDependents,
  findDoctorByEmail,
  findDoctorById,
  findGuardianRequestById,
  findHospitalById,
  findPatientByNationalId,
  findPatientById,
  findPatientByToken,
  findPendingGuardianRequest,
  getAuditLog,
  getEmergencyContacts,
  getPatientFullRecord,
  getQrRotationLog,
  issueOtp,
  listAllPatients,
  listPendingGuardianRequestsForGuardian,
  listPendingGuardianRequestsForMinor,
  countPatients,
  logAudit,
  nationalIdExists,
  recordPatientView,
  listRecentlyViewedPatients,
  createAppointment,
  findAppointmentById,
  listAppointmentsForPatient,
  listAppointmentsForDoctor,
  listAppointmentsForHospital,
  getHospitalAppointmentLoadSummary,
  getDoctorWorkloadBalance,
  getHospitalWeeklyDigestFigures,
  updateAppointmentStatus,
  rescheduleAppointment,
  setAppointmentSchedule,
  listDoctorsForBooking,
  rejectOtherPendingGuardianRequests,
  resolveGuardianRequest,
  rotatePatientQrToken,
  setGuardian,
  setPatientQrStatic,
  searchPatients,
  updatePatient,
  verifyOtp,
  findActiveDoctorById,
  findHospitalAdminByEmail,
  findHospitalAdminById,
  listDoctorsForHospital,
  createDoctorForHospital,
  updateDoctorSpecialization,
  setDoctorActive,
  doctorEmailExists,
  licenseNumberExists,
  getHospitalAdminStats,
  getDoctorAuditLog,
  listAppointmentsForDoctorInRange,
  createRecurringSeries,
  findMedicalRecordById,
  listPrescriptionsForRecord,
  finalizeMedicalRecord,
  createPrescription,
  deletePrescriptionsForRecord,
  createNotification,
  listNotificationsForPatient,
  countUnreadNotificationsForPatient,
  markNotificationRead,
  markAllNotificationsRead,
  joinWaitlist,
  findWaitlistEntryById,
  listWaitlistForDoctor,
  listWaitlistForPatient,
  cancelWaitlistEntry,
  offerWaitlistSlot,
  saveRiskAssessment,
  getLatestRiskAssessment,
  listRiskAssessmentsForPatient,
  createFollowupAgent,
  findFollowupAgentById,
  findFollowupAgentForDoctor,
  listFollowupAgentsForDoctor,
  listFollowupAgentsForPatient,
  updateFollowupAgentStatus,
  listCheckinsForAgent,
  listFollowupAlertsForDoctor,
  acknowledgeFollowupAlert,
  listPendingCheckinsForPatient,
  findPendingCheckinForPatient,
  submitFollowupCheckin,
  createPatientRegistration,
  createRegistrationAttachment,
  getRegistrationAttachments,
  findRegistrationAttachmentById,
  findRegistrationForDoctor,
  listRegistrationsForDoctor,
  countPendingRegistrationsForDoctor,
  hasPendingRegistrationForDoctor,
  approvePatientRegistration,
  rejectPatientRegistration,
  purgeRegistrationAttachments,
} from "./lib/repo";
import { computeRiskAssessment, hasAnyVitals, RISK_DISCLAIMER, type RiskContext } from "./lib/risk-scoring";
import { defaultQuestionsFor, flagCheckinResponses, summarizeCheckin } from "./lib/followup-agent";
import type { FollowupQuestion, FollowupAgentStatus } from "./lib/types";

export const app = express();
const PORT = Number(process.env.PORT || 4000);
const ORIGINS = (process.env.CORS_ORIGIN || "http://localhost:3000").split(",").map((s) => s.trim());
const isProd = process.env.NODE_ENV === "production";
const DEMO_MODE = process.env.DEMO_MODE ? process.env.DEMO_MODE === "true" : !isProd;

// Fail fast rather than silently running an unauthenticated-feeling API in
// production with the placeholder secret checked into .env.example.
if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === "pulseid-dev-secret-change-me")) {
  console.error("[pulseid-backend] FATAL: SESSION_SECRET is missing or still the default dev value.");
  console.error("[pulseid-backend] Set a long random SESSION_SECRET before running in production.");
  process.exit(1);
}
if (isProd && DEMO_MODE) {
  console.error("[pulseid-backend] FATAL: DEMO_MODE must not be enabled in production (it leaks OTP codes in API responses).");
  process.exit(1);
}
// getBaseUrl() below falls back to the request's Host header when
// PUBLIC_APP_URL isn't set — that header is attacker-controlled and is what
// gets embedded as the domain in every patient's emergency QR code, so an
// unset PUBLIC_APP_URL in production would let a forged Host header point
// freshly-generated QR codes at a phishing domain instead of the real app.
if (isProd && !process.env.PUBLIC_APP_URL) {
  console.error("[pulseid-backend] FATAL: PUBLIC_APP_URL is not set.");
  console.error("[pulseid-backend] Without it, QR code links fall back to the request's Host header, which a client can forge.");
  process.exit(1);
}
// Not fatal (some deployments may intentionally stage rollout of real SMS),
// but this is loud on purpose: with DEMO_MODE off and no SMS gateway wired
// up, patients can request a code but will never actually receive one.
if (!DEMO_MODE && !SMS_CONFIGURED) {
  console.warn("[pulseid-backend] WARNING: DEMO_MODE is off but no SMS gateway is configured (TWILIO_* env vars).");
  console.warn("[pulseid-backend] Patients will be able to request an OTP but will never receive it by SMS.");
}

app.set("trust proxy", true);
app.use(helmet());
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(
  cors({
    origin: ORIGINS,
    credentials: true,
  })
);
app.use(csrfProtection);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizedPhone(v: string): string {
  return v.replace(/\D/g, "");
}

// Whole-years-old calculation that's correct on the person's birthday (not
// just year subtraction, which is wrong for anyone who hasn't had this
// year's birthday yet).
function ageInYears(dateOfBirth: string, atDate = new Date()): number {
  const dob = new Date(dateOfBirth);
  let age = atDate.getFullYear() - dob.getFullYear();
  const beforeBirthdayThisYear =
    atDate.getMonth() < dob.getMonth() ||
    (atDate.getMonth() === dob.getMonth() && atDate.getDate() < dob.getDate());
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}

// For a minor, a first responder should call the parent/guardian before
// anyone else on file — this reorders (never drops) contacts so a
// Parent/Guardian-relationship entry leads, falling back to whatever was
// already marked primary if there isn't one.
function guardianFirst<T extends { relationship: string; isPrimary: boolean }>(contacts: T[]): T[] {
  const isGuardian = (c: T) => /^(parent|guardian)$/i.test(c.relationship);
  const guardians = contacts.filter(isGuardian);
  const rest = contacts.filter((c) => !isGuardian(c));
  return [...guardians, ...rest];
}

// ---------------------------------------------------------------------------
// Auth helpers (Express middleware equivalents of the old Next.js session
// getters). Every protected route re-verifies the JWT on every request —
// doctor and patient sessions are fully independent cookies/tokens.
// ---------------------------------------------------------------------------

async function requireDoctor(req: Request, res: Response, next: NextFunction) {
  const session = await verifySession<DoctorSession>(req.cookies?.[DOCTOR_COOKIE]);
  if (!session) return res.status(401).json({ error: "Not authenticated." });
  // Deactivation has to take effect immediately, not just at next login —
  // the session JWT is stateless and lives up to 12h, so without this
  // re-check a doctor the admin just deactivated would keep full access
  // (patient records, booking allocation, everything) until the cookie
  // expired on its own. One indexed primary-key lookup per request.
  const doctor = findDoctorById(session.doctorId);
  if (!doctor || !doctor.is_active) return res.status(401).json({ error: "Not authenticated." });
  (req as any).doctor = session;
  next();
}

async function requirePatient(req: Request, res: Response, next: NextFunction) {
  const session = await verifySession<PatientSession>(req.cookies?.[PATIENT_COOKIE]);
  if (!session) return res.status(401).json({ error: "Not authenticated." });
  (req as any).patient = session;
  next();
}

async function requireHospitalAdmin(req: Request, res: Response, next: NextFunction) {
  const session = await verifySession<HospitalAdminSession>(req.cookies?.[HOSPITAL_ADMIN_COOKIE]);
  if (!session) return res.status(401).json({ error: "Not authenticated." });
  (req as any).hospitalAdmin = session;
  next();
}

function rateLimited(req: Request, res: Response, key: string, limit: number, windowMs: number): boolean {
  const limited = rateLimit(`${key}:${requestIp(req)}`, limit, windowMs);
  if (!limited.ok) {
    res.set("Retry-After", String(limited.retryAfterSeconds));
    res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
    return true;
  }
  return false;
}

function getBaseUrl(req: Request): string {
  return process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get("host")?.replace(/:\d+$/, "")}:3000`;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "pulseid-backend", time: new Date().toISOString() }));

// ---------------------------------------------------------------------------
// Self-service booking — the public "Book a meeting" flow.
//
// This is the one place a member of the public can write clinical-shaped data,
// so it's the most carefully bounded surface in the app:
//
//   * It creates a PENDING request, never a Patient. A doctor has to approve
//     (see POST /api/doctor/registrations/:id/allocate) before anything reaches
//     the patients table — that's what stops someone attaching fabricated
//     history to a real National ID, or squatting on one before its holder
//     registers.
//   * Rate limited per IP like every other public route.
//   * One open request per National ID per doctor, so the queue can't be
//     flooded with duplicates for the same person.
//   * Uploaded files are stored under random server-generated names in
//     data/uploads/; the client-supplied filename is kept only as metadata and
//     is never used to build a path.
// ---------------------------------------------------------------------------

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "data", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Only document/image types a patient would plausibly attach as a report.
// Anything else is rejected at the multer layer rather than stored and
// validated later.
const ALLOWED_UPLOAD_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_UPLOAD_FILES = 5;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    // Random name + extension from the (already allow-listed) mime type — the
    // client's filename never reaches the filesystem, so there's no path
    // traversal or double-extension vector here.
    filename: (_req, file, cb) => {
      const ext = file.mimetype === "application/pdf" ? ".pdf" : file.mimetype.split("/")[1] || ".bin";
      cb(null, `${Date.now()}-${randomBytes(12).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_UPLOAD_FILES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_UPLOAD_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error("Only PDF, PNG, JPEG or WebP files can be attached."));
  },
});

// Public doctor directory for the booking form. Same data the logged-in
// patient booking picker already exposes (name / specialization / hospital) and
// nothing patient-identifying — it has to be reachable without a session now
// that registration itself is self-service.
app.get("/api/booking/doctors", (_req, res) => {
  const doctors = listDoctorsForBooking();
  res.json({
    doctors: doctors.map((d) => ({
      id: d.id,
      fullName: d.full_name,
      specialization: d.specialization,
      hospitalName: d.hospital_name,
    })),
  });
});

// Wraps the multer middleware so its errors surface as clean JSON instead of
// Express's default HTML error page, and so a rejected file never leaves a
// half-written request behind.
function handleUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve) => {
    upload.array("reports", MAX_UPLOAD_FILES)(req, res, (err: any) => {
      if (err) {
        // Multer streams each accepted file to disk as it goes, so an error
        // part-way through (an oversized file 3 of 5, a disallowed type, too
        // many files) leaves the earlier files already sitting in UPLOAD_DIR.
        // Delete them here — the same cleanup the field-validation path below
        // does — or a rejected submission would orphan the patient's reports.
        const partial = (req.files as Express.Multer.File[] | undefined) || [];
        for (const f of partial) {
          try {
            fs.rmSync(f.path, { force: true });
          } catch {
            /* best effort */
          }
        }
        const tooBig = err?.code === "LIMIT_FILE_SIZE";
        const tooMany = err?.code === "LIMIT_FILE_COUNT" || err?.code === "LIMIT_UNEXPECTED_FILE";
        res.status(400).json({
          error: tooBig
            ? `Each file must be under ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`
            : tooMany
              ? `You can attach at most ${MAX_UPLOAD_FILES} files.`
              : err?.message || "That file could not be uploaded.",
        });
        return;
      }
      resolve();
    });
  });
}

// POST /api/booking/requests — multipart/form-data.
//
// Fields mirror the doctor-side registration form (same validation rules and
// same fieldErrors shape, so the two forms behave identically) plus doctorId,
// reason, contacts[] and up to MAX_UPLOAD_FILES files under "reports".
app.post("/api/booking/requests", async (req, res) => {
  if (rateLimited(req, res, "booking-request", 5, 60 * 60_000)) return;
  await handleUpload(req, res);
  if (res.headersSent) return;

  // Everything multer wrote to disk before the body validated is ours to clean
  // up — otherwise a rejected submission leaves the patient's uploaded reports
  // sitting on disk with no row pointing at them.
  const uploaded = (req.files as Express.Multer.File[] | undefined) || [];
  const discardUploads = () => {
    for (const f of uploaded) {
      try {
        fs.rmSync(f.path, { force: true });
      } catch {
        /* best effort */
      }
    }
  };

  const body = (req.body || {}) as Record<string, unknown>;
  const nationalId = str(body.nationalId);
  const fullName = str(body.fullName);
  const dateOfBirth = str(body.dateOfBirth);
  const gender = str(body.gender);
  const phoneNumber = str(body.phoneNumber);
  const email = str(body.email);
  const address = str(body.address);
  const bloodGroup = (str(body.bloodGroup) || "unknown") as BloodGroup;
  const allergies = str(body.allergies);
  const chronicConditions = str(body.chronicConditions);
  const weightKgRaw = str(body.weightKg);
  const pediatricianName = str(body.pediatricianName);
  const pediatricianPhone = str(body.pediatricianPhone);
  const doctorId = str(body.doctorId);
  const reason = str(body.reason);

  const BLOOD_GROUPS: BloodGroup[] = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"];
  const errors: Record<string, string> = {};

  if (!NATIONAL_ID_RE.test(nationalId)) {
    errors.nationalId = "Enter a valid ID in the format 12345-1234567-1.";
  }

  // Someone who is already registered is welcome to book a follow-up here, so
  // this deliberately does NOT reject a known National ID. Two reasons:
  //
  //  * Telling an anonymous caller "this ID is already registered" turns this
  //    public form into an oracle for enumerating which CNICs exist at this
  //    clinic. The request is accepted either way, so the response no longer
  //    depends on whether the ID is known.
  //  * Blocking it dead-ended an existing patient who wanted an appointment,
  //    even though the doctor queue handles this case perfectly well — see
  //    matched_patient_id and approvePatientRegistration.
  const matchedPatientId = NATIONAL_ID_RE.test(nationalId)
    ? findPatientByNationalId(nationalId)?.id ?? null
    : null;
  if (!doctorId) {
    errors.doctorId = "Please choose a doctor.";
  } else if (!findActiveDoctorById(doctorId)) {
    // Active-only: a request addressed to a deactivated doctor would sit
    // pending forever, since they can't log in to review it.
    errors.doctorId = "That doctor is no longer available. Please choose another.";
  } else if (nationalId && !errors.nationalId && hasPendingRegistrationForDoctor(nationalId, doctorId)) {
    errors.doctorId = "You already have a request pending with this doctor.";
  }

  const dobValid = Boolean(dateOfBirth) && !Number.isNaN(Date.parse(dateOfBirth));
  const isMinor = dobValid && ageInYears(dateOfBirth) < 18;

  if (!fullName || fullName.length < 2) errors.fullName = "Full name is required.";
  if (!dobValid) {
    errors.dateOfBirth = "Enter a valid date of birth.";
  } else if (new Date(dateOfBirth).getTime() > Date.now()) {
    errors.dateOfBirth = "Date of birth can't be in the future.";
  }
  if (!gender) errors.gender = "Select a gender.";
  if (!phoneNumber || phoneNumber.replace(/\D/g, "").length < 7) {
    errors.phoneNumber = isMinor
      ? "Enter a valid phone number (a parent or guardian's number is fine)."
      : "Enter a valid phone number.";
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address, or leave it blank.";
  if (!BLOOD_GROUPS.includes(bloodGroup)) errors.bloodGroup = "Select a valid blood group.";

  let weightKg: number | null = null;
  if (weightKgRaw) {
    const parsed = Number(weightKgRaw);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 300) {
      errors.weightKg = "Enter a weight in kg, or leave it blank.";
    } else {
      weightKg = parsed;
    }
  }

  // Same emergency-contact rule as doctor-side registration: a minor must have
  // someone reachable. Parsed from repeated multipart text fields.
  const contacts = parseRepeatedFields(body, "contacts");
  const usableContacts = contacts.filter(
    (c) => str(c.fullName) && str(c.phoneNumber) && str(c.relationshipType)
  );
  for (const c of contacts) {
    if (!str(c.fullName) || !str(c.phoneNumber) || !str(c.relationshipType)) {
      errors.contacts = "Each emergency contact needs a name, relationship and phone number.";
      break;
    }
  }
  // The form offers three contact slots, and this endpoint is public and
  // unauthenticated — every usable contact becomes an emergency_contacts row
  // when a doctor approves, so an unbounded list would be unbounded rows.
  if (!errors.contacts && contacts.length > 3) {
    errors.contacts = "You can list at most 3 emergency contacts.";
  }
  if (isMinor && !errors.contacts && usableContacts.length === 0) {
    errors.contacts = "A parent or guardian's contact is required for patients under 18.";
  }

  if (Object.keys(errors).length > 0) {
    discardUploads();
    return res.status(400).json({ error: "Please fix the highlighted fields.", fieldErrors: errors });
  }

  const registration = createPatientRegistration({
    nationalId,
    fullName,
    dateOfBirth,
    gender,
    phoneNumber,
    email: email || null,
    address: address || null,
    bloodGroup,
    allergies: allergies || null,
    chronicConditions: chronicConditions || null,
    weightKg,
    pediatricianName: pediatricianName || null,
    pediatricianPhone: pediatricianPhone || null,
    doctorId,
    reason: reason || null,
    contacts: usableContacts,
    matchedPatientId,
  });

  for (const f of uploaded) {
    createRegistrationAttachment({
      registrationId: registration.id,
      storedName: f.filename,
      // Client-supplied, so it's only ever used as a display/download name.
      originalName: path.basename(f.originalname || "report"),
      mimeType: f.mimetype,
      sizeBytes: f.size,
    });
  }

  // Fire-and-forget RAG indexing of the booking's own details + uploaded
  // reports (lib/rag.ts). Chunks are keyed to the registration and
  // re-parented to the patient inside the approval transaction; the
  // embedding model is local, so this never blocks or fails the request.
  void indexRegistration(registration.id).catch((err) =>
    console.error("[pulseid-backend] RAG registration indexing failed:", err)
  );

  res.status(201).json({
    request: {
      id: registration.id,
      fullName: registration.full_name,
      doctorName: registration.doctor_name,
      attachments: uploaded.length,
      createdAt: registration.created_at,
      // Deliberately says nothing about whether the National ID matched an
      // existing patient — that difference is what the doctor sees in their
      // queue, and echoing it here would rebuild the enumeration oracle this
      // route just stopped having. The confirmation copy below is true either
      // way: the request lands with the doctor and the appointment shows up on
      // the patient's appointments once it's allocated.
    },
  });
});

// Repeated multipart fields (contacts[0].fullName, contacts[0].phoneNumber, …)
// arrive as separate scalar fields. Walks them back into the same array-of-
// objects shape the doctor form posts as JSON.
function parseRepeatedFields(
  body: Record<string, unknown>,
  prefix: string
): { fullName: string; phoneNumber: string; relationshipType: string }[] {
  const out: { fullName: string; phoneNumber: string; relationshipType: string }[] = [];
  const indexes = new Set<string>();
  for (const key of Object.keys(body)) {
    const m = key.match(new RegExp(`^${prefix}\\[(\\d+)\\]\\.`));
    if (m) indexes.add(m[1]);
  }
  for (const i of [...indexes].sort((a, b) => Number(a) - Number(b))) {
    out.push({
      fullName: str(body[`${prefix}[${i}].fullName`]),
      phoneNumber: str(body[`${prefix}[${i}].phoneNumber`]),
      relationshipType: str(body[`${prefix}[${i}].relationshipType`]),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Auth — doctor
// ---------------------------------------------------------------------------
const DUMMY_HASH = bcrypt.hashSync("no-such-doctor", 12);

app.post("/api/auth/doctor/login", async (req, res) => {
  if (rateLimited(req, res, "doctor-login", 8, 60_000)) return;

  const email = str(req.body?.email).toLowerCase();
  const password = str(req.body?.password);
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  const doctor = findDoctorByEmail(email);
  const passwordOk = bcrypt.compareSync(password, doctor?.password_hash || DUMMY_HASH);
  if (!doctor || !passwordOk) return res.status(401).json({ error: "Invalid email or password." });

  const token = await signSession({
    role: "doctor",
    doctorId: doctor.id,
    fullName: doctor.full_name,
    email: doctor.email,
    hospitalName: doctor.hospital_id ? findHospitalById(doctor.hospital_id)?.name : undefined,
  });

  res.cookie(DOCTOR_COOKIE, token, sessionCookieOptions(60 * 60 * 12 * 1000));
  res.cookie(CSRF_COOKIE, newCsrfToken(), csrfCookieOptions());
  res.json({ doctor: { id: doctor.id, fullName: doctor.full_name, specialization: doctor.specialization } });
});

app.post("/api/auth/doctor/logout", (_req, res) => {
  res.clearCookie(DOCTOR_COOKIE, sessionCookieOptions(0));
  res.clearCookie(CSRF_COOKIE, csrfCookieOptions());
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Auth — hospital admin
//
// Same pattern as doctor login above (rate limit, constant-time-ish compare
// against a dummy hash so a nonexistent email doesn't respond faster than a
// wrong password, signed JWT session, its own cookie) — hospital-admin auth
// is a peer of doctor auth, not a variant of anything else.
// ---------------------------------------------------------------------------
app.post("/api/auth/hospital-admin/login", async (req, res) => {
  if (rateLimited(req, res, "hospital-admin-login", 8, 60_000)) return;

  const email = str(req.body?.email).toLowerCase();
  const password = str(req.body?.password);
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  const admin = findHospitalAdminByEmail(email);
  const passwordOk = bcrypt.compareSync(password, admin?.password_hash || DUMMY_HASH);
  if (!admin || !passwordOk) return res.status(401).json({ error: "Invalid email or password." });

  const hospital = findHospitalById(admin.hospital_id);

  const token = await signSession({
    role: "hospital_admin",
    hospitalAdminId: admin.id,
    fullName: admin.full_name,
    email: admin.email,
    hospitalId: admin.hospital_id,
    hospitalName: hospital?.name ?? "Unknown hospital",
  });

  res.cookie(HOSPITAL_ADMIN_COOKIE, token, sessionCookieOptions(60 * 60 * 12 * 1000));
  res.cookie(CSRF_COOKIE, newCsrfToken(), csrfCookieOptions());
  res.json({
    hospitalAdmin: { id: admin.id, fullName: admin.full_name, hospitalId: admin.hospital_id, hospitalName: hospital?.name ?? null },
  });
});

app.post("/api/auth/hospital-admin/logout", (_req, res) => {
  res.clearCookie(HOSPITAL_ADMIN_COOKIE, sessionCookieOptions(0));
  res.clearCookie(CSRF_COOKIE, csrfCookieOptions());
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Auth — patient (National ID + OTP)
// ---------------------------------------------------------------------------
app.post("/api/auth/patient/request-otp", async (req, res) => {
  if (rateLimited(req, res, "otp-request", 6, 60_000)) return;

  const nationalId = str(req.body?.nationalId);
  if (!nationalId) return res.status(400).json({ error: "National ID is required." });

  const patient = findPatientByNationalId(nationalId);
  if (!patient) return res.status(404).json({ error: "No patient found with that National ID." });

  // Per-national-ID daily cap — separate from the per-IP limit above, so
  // rotating IPs can't be used to keep sending (and costing money on) codes
  // for one specific patient.
  const cap = canSendOtp(nationalId);
  if (!cap.ok) return res.status(429).json({ error: cap.error });

  const code = issueOtp(nationalId);

  let smsSent = false;
  if (!DEMO_MODE && SMS_CONFIGURED) {
    const result = await sendOtpSms(patient.phone_number, code);
    smsSent = result.ok;
    if (!result.ok) {
      console.error(`[pulseid-backend] Failed to deliver OTP SMS to patient ${patient.id}: ${result.error}`);
    }
  }

  // Demo mode only: no SMS gateway wired up, so the code is returned directly
  // so testers can log in without a real phone number. This branch is
  // hard-disabled in production (see the startup check above) so a real
  // deployment never leaks OTP codes back over the API.
  res.json({
    ok: true,
    demoOtp: DEMO_MODE ? code : undefined,
    smsSent,
    maskedPhone: patient.phone_number.replace(/\d(?=\d{3})/g, "•"),
  });
});

app.post("/api/auth/patient/verify-otp", async (req, res) => {
  if (rateLimited(req, res, "otp-verify", 10, 60_000)) return;

  const nationalId = str(req.body?.nationalId);
  const code = str(req.body?.code);
  if (!nationalId || !code) return res.status(400).json({ error: "National ID and code are required." });

  const patient = findPatientByNationalId(nationalId);
  if (!patient) return res.status(404).json({ error: "No patient found with that National ID." });

  const result = verifyOtp(nationalId, code);
  if (!result.ok) return res.status(401).json({ error: result.error || "That code is incorrect or has expired." });

  const token = await signSession({
    role: "patient",
    patientId: patient.id,
    fullName: patient.full_name,
    nationalId: patient.national_id,
  });

  logAudit({ patientId: patient.id, actorRole: "patient", actorName: patient.full_name, action: "login", details: "Signed in with National ID + OTP" });

  res.cookie(PATIENT_COOKIE, token, sessionCookieOptions(60 * 60 * 12 * 1000));
  res.cookie(CSRF_COOKIE, newCsrfToken(), csrfCookieOptions());
  res.json({ patient: { id: patient.id, fullName: patient.full_name } });
});

app.post("/api/auth/patient/logout", (_req, res) => {
  res.clearCookie(PATIENT_COOKIE, sessionCookieOptions(0));
  res.clearCookie(CSRF_COOKIE, csrfCookieOptions());
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Whoami — used by the frontend to render the right header/nav
// ---------------------------------------------------------------------------
app.get("/api/me", async (req, res) => {
  const doctor = await verifySession<DoctorSession>(req.cookies?.[DOCTOR_COOKIE]);
  if (doctor) {
    // Refresh the CSRF cookie on every whoami check (called on every page
    // load) so a session that outlives its original CSRF token — e.g. the
    // browser cleared cookies selectively, or an old client is mid-session
    // during a deploy — always has a valid one for the next mutation.
    if (!req.cookies?.[CSRF_COOKIE]) res.cookie(CSRF_COOKIE, newCsrfToken(), csrfCookieOptions());
    return res.json({ role: "doctor", session: doctor });
  }

  const patient = await verifySession<PatientSession>(req.cookies?.[PATIENT_COOKIE]);
  if (patient) {
    if (!req.cookies?.[CSRF_COOKIE]) res.cookie(CSRF_COOKIE, newCsrfToken(), csrfCookieOptions());
    return res.json({ role: "patient", session: patient });
  }

  const hospitalAdmin = await verifySession<HospitalAdminSession>(req.cookies?.[HOSPITAL_ADMIN_COOKIE]);
  if (hospitalAdmin) {
    if (!req.cookies?.[CSRF_COOKIE]) res.cookie(CSRF_COOKIE, newCsrfToken(), csrfCookieOptions());
    return res.json({ role: "hospital_admin", session: hospitalAdmin });
  }

  res.status(401).json({ role: null });
});

// ---------------------------------------------------------------------------
// Emergency QR — public, rate-limited, minimal data only
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Emergency access via the patient's real CNIC — public, rate-limited,
// minimal data only. Unlike the token below, there's nothing to rotate
// here: a government ID card can't regenerate its own printed QR, so this
// is deliberately the *permanent* lookup path. Every read is still logged
// to the patient's audit trail regardless.
// ---------------------------------------------------------------------------
app.get("/api/emergency/cnic/:nationalId", async (req, res) => {
  if (rateLimited(req, res, "emergency-cnic-api", 20, 60_000)) return;

  const nationalId = str(req.params.nationalId);
  const patient = findPatientByNationalId(nationalId);
  if (!patient) return res.status(404).json({ error: "No PulseID record for this CNIC." });

  const doctorSession = await verifySession<DoctorSession>(req.cookies?.[DOCTOR_COOKIE]);

  logAudit({
    patientId: patient.id,
    actorRole: doctorSession ? "doctor" : "first_responder",
    actorName: doctorSession ? doctorSession.fullName : "CNIC card scan",
    actorId: doctorSession ? doctorSession.doctorId : undefined,
    action: "qr_scanned",
    details: doctorSession ? "Scanned patient's CNIC card while signed in" : "CNIC card scanned for emergency access (no clinician session)",
  });

  const contacts = getEmergencyContacts(patient.id);
  const isMinor = ageInYears(patient.date_of_birth) < 18;
  const orderedContacts = guardianFirst(
    contacts.map((c) => ({
      fullName: c.full_name,
      relationship: c.relationship_type,
      phone: c.phone_number,
      isPrimary: c.is_primary === 1,
    }))
  );
  res.json({
    fullName: patient.full_name,
    age: ageInYears(patient.date_of_birth),
    // A stranger scanning a minor's card doesn't need their exact birth
    // date — age is enough for triage, and withholding it is one less
    // identifying detail exposed to whoever scanned the card.
    dateOfBirth: isMinor ? undefined : patient.date_of_birth,
    isMinor,
    gender: patient.gender,
    bloodGroup: patient.blood_group,
    allergies: patient.allergies,
    chronicConditions: patient.chronic_conditions,
    weightKg: isMinor ? patient.weight_kg : undefined,
    pediatricianName: isMinor ? patient.pediatrician_name : undefined,
    pediatricianPhone: isMinor ? patient.pediatrician_phone : undefined,
    contacts: orderedContacts,
  });
});

app.get("/api/emergency/:token", async (req, res) => {
  if (rateLimited(req, res, "emergency-api", 20, 60_000)) return;

  const patient = findPatientByToken(req.params.token);
  if (!patient) return res.status(404).json({ error: "Invalid or expired emergency code." });

  const doctorSession = await verifySession<DoctorSession>(req.cookies?.[DOCTOR_COOKIE]);

  logAudit({
    patientId: patient.id,
    actorRole: doctorSession ? "doctor" : "first_responder",
    actorName: doctorSession ? doctorSession.fullName : "Emergency QR scan",
    actorId: doctorSession ? doctorSession.doctorId : undefined,
    action: "qr_scanned",
    details: doctorSession ? "Scanned emergency QR while signed in" : "Emergency QR scanned (no clinician session)",
  });

  const contacts = getEmergencyContacts(patient.id);
  rotatePatientQrToken(patient.id, doctorSession ? `Scanned by Dr. ${doctorSession.fullName}` : "Emergency QR scanned");

  const isMinor = ageInYears(patient.date_of_birth) < 18;
  const orderedContacts = guardianFirst(
    contacts.map((c) => ({
      fullName: c.full_name,
      relationship: c.relationship_type,
      phone: c.phone_number,
      isPrimary: c.is_primary === 1,
    }))
  );
  res.json({
    fullName: patient.full_name,
    age: ageInYears(patient.date_of_birth),
    dateOfBirth: isMinor ? undefined : patient.date_of_birth,
    isMinor,
    gender: patient.gender,
    bloodGroup: patient.blood_group,
    allergies: patient.allergies,
    chronicConditions: patient.chronic_conditions,
    weightKg: isMinor ? patient.weight_kg : undefined,
    pediatricianName: isMinor ? patient.pediatrician_name : undefined,
    pediatricianPhone: isMinor ? patient.pediatrician_phone : undefined,
    contacts: orderedContacts,
  });
});

// ---------------------------------------------------------------------------
// Patient-facing routes (require patient session)
// ---------------------------------------------------------------------------
app.get("/api/patient/me", requirePatient, (req, res) => {
  const session = (req as any).patient as PatientSession;
  const full = getPatientFullRecord(session.patientId);
  if (!full) return res.status(404).json({ error: "Patient not found." });
  res.json(full);
});

app.get("/api/patient/qr", requirePatient, async (req, res) => {
  const session = (req as any).patient as PatientSession;
  const patient = findPatientById(session.patientId);
  if (!patient) return res.status(404).json({ error: "Not found." });

  const emergencyUrl = `${getBaseUrl(req)}/emergency/${patient.emergency_qr_token}`;
  const dataUrl = await QRCode.toDataURL(emergencyUrl, {
    margin: 1,
    width: 320,
    color: { dark: "#0B2027", light: "#00000000" },
  });

  res.json({
    emergencyUrl,
    dataUrl,
    rotatedAt: patient.qr_rotated_at,
    rotationCount: patient.qr_rotation_count,
    rotationLog: getQrRotationLog(patient.id, 10),
  });
});

app.get("/api/patient/audit-log", requirePatient, (req, res) => {
  const session = (req as any).patient as PatientSession;
  res.json({ logs: getAuditLog(session.patientId) });
});

// Detailed, self-contained medical report — patient-facing edition.
// The patient's own latest risk assessment, if any exist yet — same
// rule-based score a doctor sees, since it's the patient's own health data.
app.get("/api/patient/risk", requirePatient, (req, res) => {
  const session = (req as any).patient as PatientSession;
  const latest = getLatestRiskAssessment(session.patientId);
  res.json({ latest: latest || null, disclaimer: RISK_DISCLAIMER });
});

app.get("/api/patient/report", requirePatient, (req, res) => {
  const session = (req as any).patient as PatientSession;
  const report = buildMedicalReport(session.patientId, "patient", session.fullName);
  if (!report) return res.status(404).json({ error: "Patient not found." });
  res.json({ report });
});

// ---------------------------------------------------------------------------
// Patient-initiated data export — download your own record as JSON or PDF.
// Rate-limited since PDF rendering isn't free, and this is a good target
// for scraping if left unbounded.
// ---------------------------------------------------------------------------
app.get("/api/patient/report/export", requirePatient, (req, res) => {
  if (rateLimited(req, res, "report-export", 10, 60_000)) return;
  const session = (req as any).patient as PatientSession;
  const report = buildMedicalReport(session.patientId, "patient", session.fullName);
  if (!report) return res.status(404).json({ error: "Patient not found." });

  const format = str(req.query.format as string) || "json";
  const filenameSafe = report.patient.fullName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  logAudit({
    patientId: session.patientId,
    actorRole: "patient",
    actorName: session.fullName,
    action: "record_exported",
    details: `Downloaded own record as ${format.toUpperCase()}`,
  });

  if (format === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="pulseid-${filenameSafe}.pdf"`);
    const doc = buildReportPdf(report);
    doc.pipe(res);
    doc.end();
    return;
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="pulseid-${filenameSafe}.json"`);
  res.send(JSON.stringify(report, null, 2));
});

// ---------------------------------------------------------------------------
// Appointments — patient requests a slot with a doctor; the doctor confirms,
// reschedules, completes, or cancels it from their own queue.
// ---------------------------------------------------------------------------

// Public to any authenticated patient — just names/specializations/hospitals,
// nothing patient-identifying, so it's safe as a booking picker.
app.get("/api/patient/doctors", requirePatient, (_req, res) => {
  const doctors = listDoctorsForBooking();
  res.json({
    doctors: doctors.map((d) => ({
      id: d.id,
      fullName: d.full_name,
      specialization: d.specialization,
      hospitalName: d.hospital_name,
    })),
  });
});

app.get("/api/patient/appointments", requirePatient, (req, res) => {
  const session = (req as any).patient as PatientSession;
  const appointments = listAppointmentsForPatient(session.patientId);
  res.json({
    appointments: appointments.map((a) => ({
      id: a.id,
      doctorName: a.doctor_name,
      hospitalName: a.hospital_name,
      scheduledAt: a.scheduled_at,
      reason: a.reason,
      status: a.status,
      doctorNotes: a.doctor_notes,
      createdAt: a.created_at,
      recurrenceRule: a.recurrence_rule,
      recurrenceIndex: a.recurrence_index,
      recurrenceCount: a.recurrence_count,
    })),
  });
});

app.post("/api/patient/appointments", requirePatient, (req, res) => {
  if (rateLimited(req, res, "appointment-create", 10, 60_000)) return;
  const session = (req as any).patient as PatientSession;

  const doctorId = str(req.body?.doctorId);
  const reason = str(req.body?.reason);

  if (!doctorId) return res.status(400).json({ error: "Please choose a doctor.", fieldErrors: { doctorId: "Required." } });
  const doctor = findActiveDoctorById(doctorId);
  if (!doctor) return res.status(404).json({ error: "That doctor is no longer available. Please choose another." });

  // Patients only request a doctor and (optionally) a reason — the actual
  // date/time is set later by the doctor/clinic, never by the patient.
  const appointment = createAppointment({
    patientId: session.patientId,
    doctorId,
    reason: reason || null,
  });

  logAudit({
    patientId: session.patientId,
    actorRole: "patient",
    actorName: session.fullName,
    action: "appointment_requested",
    details: `Requested an appointment with ${doctor.full_name}`,
  });

  res.status(201).json({
    appointment: {
      id: appointment.id,
      doctorName: doctor.full_name,
      scheduledAt: appointment.scheduled_at,
      reason: appointment.reason,
      status: appointment.status,
    },
  });
});

// A patient can only cancel their own appointment, and only while it's
// still requested/confirmed (not once a doctor has already completed it).
app.post("/api/patient/appointments/:id/cancel", requirePatient, (req, res) => {
  const session = (req as any).patient as PatientSession;
  const appointment = findAppointmentById(req.params.id);
  if (!appointment || appointment.patient_id !== session.patientId) {
    return res.status(404).json({ error: "Appointment not found." });
  }
  if (appointment.status === "completed" || appointment.status === "cancelled") {
    return res.status(400).json({ error: `This appointment is already ${appointment.status}.` });
  }
  updateAppointmentStatus(appointment.id, "cancelled");
  res.json({ ok: true });
});

// ---------- Patient waitlist ----------
// An alternative to (or alongside) a normal request, for a doctor who's
// fully booked — the patient asks to be offered the next opening instead
// of a specific request the doctor then has to say no to.
app.post("/api/patient/waitlist", requirePatient, (req, res) => {
  if (rateLimited(req, res, "waitlist-join", 10, 60_000)) return;
  const session = (req as any).patient as PatientSession;
  const doctorId = str(req.body?.doctorId);
  const reason = str(req.body?.reason);
  if (!doctorId) return res.status(400).json({ error: "Please choose a doctor.", fieldErrors: { doctorId: "Required." } });
  const doctor = findActiveDoctorById(doctorId);
  if (!doctor) return res.status(404).json({ error: "That doctor is no longer available. Please choose another." });

  const entry = joinWaitlist({ patientId: session.patientId, doctorId, reason: reason || null });

  logAudit({
    patientId: session.patientId,
    actorRole: "patient",
    actorName: session.fullName,
    action: "appointment_requested",
    details: `Joined the waitlist for ${doctor.full_name}`,
  });

  res.status(201).json({ entry: { id: entry.id, doctorName: doctor.full_name, reason: entry.reason, status: entry.status } });
});

app.get("/api/patient/waitlist", requirePatient, (req, res) => {
  const session = (req as any).patient as PatientSession;
  const entries = listWaitlistForPatient(session.patientId);
  res.json({
    entries: entries.map((e) => ({
      id: e.id,
      doctorName: e.doctor_name,
      reason: e.reason,
      status: e.status,
      createdAt: e.created_at,
    })),
  });
});

app.post("/api/patient/waitlist/:id/cancel", requirePatient, (req, res) => {
  const session = (req as any).patient as PatientSession;
  const entry = findWaitlistEntryById(req.params.id);
  if (!entry || entry.patient_id !== session.patientId) {
    return res.status(404).json({ error: "Waitlist entry not found." });
  }
  if (entry.status !== "waiting") {
    return res.status(400).json({ error: `This waitlist entry is already ${entry.status}.` });
  }
  cancelWaitlistEntry(entry.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Proactive follow-up agents (patient side)
// ---------------------------------------------------------------------------

app.get("/api/patient/followups", requirePatient, (req, res) => {
  const session = (req as any).patient as PatientSession;
  const agents = listFollowupAgentsForPatient(session.patientId);
  const pending = listPendingCheckinsForPatient(session.patientId).map((c: any) => ({
    ...c,
    questions: JSON.parse(c.questions || "[]"),
  }));
  res.json({ agents, pendingCheckins: pending });
});

app.post("/api/patient/followups/checkins/:checkinId/respond", requirePatient, async (req, res) => {
  const session = (req as any).patient as PatientSession;
  const checkin = findPendingCheckinForPatient(req.params.checkinId, session.patientId);
  if (!checkin) return res.status(404).json({ error: "Check-in not found or already answered." });

  const agent = findFollowupAgentById(checkin.agent_id);
  if (!agent) return res.status(404).json({ error: "Follow-up not found." });

  const questions: FollowupQuestion[] = JSON.parse(agent.questions || "[]");
  const rawResponses = req.body?.responses;
  if (!rawResponses || typeof rawResponses !== "object") {
    return res.status(400).json({ error: "Responses are required." });
  }
  const responses: Record<string, string> = {};
  for (const q of questions) {
    responses[q.id] = str((rawResponses as Record<string, unknown>)[q.id]);
  }

  const riskFlag = flagCheckinResponses(questions, responses);
  const aiSummary = await summarizeCheckin(agent.pathology, questions, responses);

  const updated = submitFollowupCheckin({ id: checkin.id, responses, riskFlag, aiSummary });

  logAudit({
    patientId: session.patientId,
    actorRole: "patient",
    actorName: session.fullName,
    action: "followup_checkin_submitted",
    details: `Answered a ${agent.pathology} follow-up check-in`,
  });

  res.json({ checkin: updated });
});



app.get("/api/patient/dependents", requirePatient, (req, res) => {
  const session = (req as any).patient as PatientSession;
  const dependents = findDependents(session.patientId);
  const pending = listPendingGuardianRequestsForGuardian(session.patientId);

  res.json({
    dependents: dependents.map((p) => ({
      id: p.id,
      nationalId: p.national_id,
      idType: p.id_type,
      fullName: p.full_name,
      age: ageInYears(p.date_of_birth),
      gender: p.gender,
      bloodGroup: p.blood_group,
    })),
    pendingRequests: pending.map((r) => {
      const minor = findPatientById(r.minor_patient_id);
      return {
        id: r.id,
        minorFullName: minor?.full_name || "Unknown",
        minorNationalId: minor?.national_id || "",
        createdAt: r.created_at,
      };
    }),
  });
});

// A guardian requests to be linked to a minor's record by entering the
// minor's CNIC/B-Form number. Auto-approved when the guardian's own phone
// number already matches a Parent/Guardian contact a doctor put on file for
// that minor at registration; otherwise it waits for a doctor to approve it
// from the minor's chart, so a stranger can't self-link to someone else's
// child just by knowing their ID number.
app.post("/api/patient/dependents/request", requirePatient, (req, res) => {
  if (rateLimited(req, res, "dependent-request", 10, 60_000)) return;
  const session = (req as any).patient as PatientSession;
  const nationalId = str(req.body?.nationalId);
  if (!nationalId) return res.status(400).json({ error: "Enter the child's CNIC or B-Form number." });

  const minor = findPatientByNationalId(nationalId);
  if (!minor) return res.status(404).json({ error: "No PulseID record for that CNIC/B-Form number." });

  const guardian = findPatientById(session.patientId);
  if (!guardian) return res.status(404).json({ error: "Your own patient record could not be found." });

  if (!(ageInYears(minor.date_of_birth) < 18)) {
    return res.status(400).json({ error: "That ID belongs to someone 18 or older — dependents must be minors." });
  }
  if (minor.id === guardian.id) {
    return res.status(400).json({ error: "You can't link yourself as your own dependent." });
  }
  if (minor.guardian_patient_id === guardian.id) {
    return res.status(400).json({ error: "This dependent is already linked to your account." });
  }
  if (minor.guardian_patient_id) {
    return res.status(400).json({ error: "This patient is already linked to a different guardian. A hospital can change this." });
  }
  if (findPendingGuardianRequest(minor.id, guardian.id)) {
    return res.json({ status: "pending", message: "Request already sent — waiting for a hospital to approve it." });
  }

  const guardianPhone = normalizedPhone(guardian.phone_number);
  const contacts = getEmergencyContacts(minor.id);
  const autoVerified = contacts.some(
    (c) => /^(parent|guardian)$/i.test(c.relationship_type) && normalizedPhone(c.phone_number) === guardianPhone
  );

  if (autoVerified) {
    setGuardian(minor.id, guardian.id);
    logAudit({
      patientId: minor.id,
      actorRole: "patient",
      actorName: guardian.full_name,
      action: "guardian_linked",
      details: `${guardian.full_name} linked as guardian — auto-verified via matching contact phone number`,
    });
    return res.json({ status: "linked" });
  }

  createGuardianLinkRequest({ minorPatientId: minor.id, guardianPatientId: guardian.id });
  logAudit({
    patientId: minor.id,
    actorRole: "patient",
    actorName: guardian.full_name,
    action: "guardian_link_requested",
    details: `${guardian.full_name} requested to be linked as guardian — pending hospital approval`,
  });
  res.json({ status: "pending" });
});

function requireOwnedDependent(req: Request, res: Response): { session: PatientSession; dependent: ReturnType<typeof findPatientById> } | null {
  const session = (req as any).patient as PatientSession;
  const dependent = findPatientById(req.params.id);
  if (!dependent || dependent.guardian_patient_id !== session.patientId) {
    res.status(404).json({ error: "Not found." });
    return null;
  }
  return { session, dependent };
}

app.get("/api/patient/dependents/:id", requirePatient, (req, res) => {
  const owned = requireOwnedDependent(req, res);
  if (!owned) return;
  const { session, dependent } = owned;
  const contacts = getEmergencyContacts(dependent!.id);
  const isMinor = ageInYears(dependent!.date_of_birth) < 18;

  logAudit({
    patientId: dependent!.id,
    actorRole: "guardian",
    actorName: session.fullName,
    action: "record_viewed",
    details: `Viewed by guardian ${session.fullName}`,
  });

  res.json({
    id: dependent!.id,
    fullName: dependent!.full_name,
    nationalId: dependent!.national_id,
    idType: dependent!.id_type,
    age: ageInYears(dependent!.date_of_birth),
    isMinor,
    gender: dependent!.gender,
    bloodGroup: dependent!.blood_group,
    allergies: dependent!.allergies,
    chronicConditions: dependent!.chronic_conditions,
    weightKg: dependent!.weight_kg,
    pediatricianName: dependent!.pediatrician_name,
    pediatricianPhone: dependent!.pediatrician_phone,
    contacts: contacts.map((c) => ({
      fullName: c.full_name,
      relationship: c.relationship_type,
      phone: c.phone_number,
      isPrimary: c.is_primary === 1,
    })),
  });
});

app.get("/api/patient/dependents/:id/report", requirePatient, (req, res) => {
  const owned = requireOwnedDependent(req, res);
  if (!owned) return;
  const { session, dependent } = owned;
  const report = buildMedicalReport(dependent!.id, "patient", session.fullName);
  if (!report) return res.status(404).json({ error: "Not found." });
  res.json({ report });
});

app.get("/api/patient/dependents/:id/report/export", requirePatient, (req, res) => {
  if (rateLimited(req, res, "report-export", 10, 60_000)) return;
  const owned = requireOwnedDependent(req, res);
  if (!owned) return;
  const { session, dependent } = owned;
  const report = buildMedicalReport(dependent!.id, "patient", session.fullName);
  if (!report) return res.status(404).json({ error: "Not found." });

  const format = str(req.query.format as string) || "json";
  const filenameSafe = report.patient.fullName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  logAudit({
    patientId: dependent!.id,
    actorRole: "guardian",
    actorName: session.fullName,
    action: "record_exported",
    details: `Downloaded dependent's record as ${format.toUpperCase()} (guardian: ${session.fullName})`,
  });

  if (format === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="pulseid-${filenameSafe}.pdf"`);
    const doc = buildReportPdf(report);
    doc.pipe(res);
    doc.end();
    return;
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="pulseid-${filenameSafe}.json"`);
  res.send(JSON.stringify(report, null, 2));
});

// ---------------------------------------------------------------------------
// Doctor-facing routes (require doctor session)
// ---------------------------------------------------------------------------
// CSV export of the full patient directory — for doctors/hospital admins
// who need to hand data to a records office or import it into another
// system. No medical history included, just the directory-level fields
// already visible on the patients list page.
app.get("/api/patients/export.csv", requireDoctor, (_req, res) => {
  const patients = listAllPatients();
  const header = ["Full Name", "National ID", "ID Type", "Date of Birth", "Gender", "Blood Group", "Registered At"];
  // Neutralize CSV/formula injection: if a field starts with =, +, -, @, tab
  // or CR, Excel/Sheets can interpret it as a formula when the file is
  // opened (e.g. a patient name of "=cmd|'/c calc'!A1" or "@SUM(1+1)").
  // Prefixing with a leading apostrophe forces it to be read as plain text
  // in every spreadsheet app, while keeping the value byte-for-byte
  // recoverable for anything that re-parses the CSV programmatically.
  const escapeCsv = (raw: string) => {
    const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${v.replace(/"/g, '""')}"`;
  };
  const rows = patients.map((p) =>
    [p.full_name, p.national_id, p.id_type, p.date_of_birth, p.gender, p.blood_group, p.created_at]
      .map((v) => escapeCsv(String(v ?? "")))
      .join(",")
  );
  const csv = [header.map(escapeCsv).join(","), ...rows].join("\r\n");

  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="pulseid-patients-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

app.get("/api/patients", requireDoctor, (_req, res) => {
  const patients = listAllPatients();
  res.json({
    total: countPatients(),
    patients: patients.map((p) => ({
      id: p.id,
      nationalId: p.national_id,
      idType: p.id_type,
      fullName: p.full_name,
      dateOfBirth: p.date_of_birth,
      isMinor: ageInYears(p.date_of_birth) < 18,
      gender: p.gender,
      bloodGroup: p.blood_group,
      createdAt: p.created_at,
    })),
  });
});

// Recently viewed by *this* doctor — a per-doctor MRU list, distinct from
// "recently registered" (which is global). Lets a doctor jump back into a
// chart they had open earlier today without re-searching for it.
// ---------------------------------------------------------------------------
// Doctor's appointment queue — confirm, complete, cancel, or reschedule a
// patient-requested appointment. ?status= filters (requested/confirmed/
// completed/cancelled); omitted returns everything, soonest first.
// ---------------------------------------------------------------------------
const APPOINTMENT_STATUSES: AppointmentStatus[] = ["requested", "confirmed", "completed", "cancelled"];
const RECURRENCE_RULES = ["weekly", "biweekly", "monthly"];

app.get("/api/doctor/appointments", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const statusParam = str(req.query.status as string);
  const status = APPOINTMENT_STATUSES.includes(statusParam as AppointmentStatus)
    ? (statusParam as AppointmentStatus)
    : undefined;
  const appointments = listAppointmentsForDoctor(session.doctorId, status);
  res.json({
    appointments: appointments.map((a) => ({
      id: a.id,
      patientId: a.patient_id,
      patientName: a.patient_name,
      scheduledAt: a.scheduled_at,
      reason: a.reason,
      status: a.status,
      doctorNotes: a.doctor_notes,
      recurrenceRule: a.recurrence_rule,
      recurrenceIndex: a.recurrence_index,
      recurrenceCount: a.recurrence_count,
    })),
  });
});

// Week/day agenda view — appointments with a set time inside [start, end),
// as opposed to /api/doctor/appointments above which is the flat,
// status-filtered queue view. Both read the same underlying data; this one
// is shaped for a calendar grid instead of a list.
app.get("/api/doctor/calendar", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const start = str(req.query.start as string);
  const end = str(req.query.end as string);
  if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    return res.status(400).json({ error: "start and end query params must be valid dates." });
  }
  const appointments = listAppointmentsForDoctorInRange(session.doctorId, new Date(start).toISOString(), new Date(end).toISOString());
  res.json({
    appointments: appointments.map((a) => ({
      id: a.id,
      patientId: a.patient_id,
      patientName: a.patient_name,
      scheduledAt: a.scheduled_at,
      reason: a.reason,
      status: a.status,
      recurrenceRule: a.recurrence_rule,
      recurrenceIndex: a.recurrence_index,
      recurrenceCount: a.recurrence_count,
    })),
  });
});

app.post("/api/doctor/appointments/:id/status", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const appointment = findAppointmentById(req.params.id);
  if (!appointment || appointment.doctor_id !== session.doctorId) {
    return res.status(404).json({ error: "Appointment not found." });
  }
  const status = str(req.body?.status) as AppointmentStatus;
  if (!APPOINTMENT_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }
  const notes = str(req.body?.doctorNotes);
  const scheduledAt = str(req.body?.scheduledAt);

  // A patient's request has no date/time attached — only the doctor sets
  // one, and it must happen before (or exactly when) the doctor confirms.
  if (status === "confirmed" && !appointment.scheduled_at && !scheduledAt) {
    return res.status(400).json({ error: "Please choose a date and time before confirming." });
  }
  if (scheduledAt) {
    if (Number.isNaN(Date.parse(scheduledAt))) {
      return res.status(400).json({ error: "Please choose a valid date and time." });
    }
    setAppointmentSchedule(appointment.id, new Date(scheduledAt).toISOString(), status, notes || undefined);
  } else {
    updateAppointmentStatus(appointment.id, status, notes || undefined);
  }

  // Optional: turn this appointment into the first occurrence of a
  // recurring series (chronic-condition follow-ups) — only meaningful when
  // confirming with a schedule, since every later occurrence is derived
  // from this one's date/time.
  let recurrenceCreated = 0;
  const recurrence = req.body?.recurrence;
  if (status === "confirmed" && scheduledAt && recurrence && typeof recurrence === "object") {
    const rule = str(recurrence.rule);
    const count = Number(recurrence.count);
    if (!RECURRENCE_RULES.includes(rule as any)) {
      return res.status(400).json({ error: "Invalid recurrence rule." });
    }
    if (!Number.isInteger(count) || count < 2 || count > 26) {
      return res.status(400).json({ error: "Recurrence count must be between 2 and 26 occurrences." });
    }
    const series = createRecurringSeries({ firstAppointmentId: appointment.id, rule: rule as any, count });
    recurrenceCreated = series.length - 1;
  }

  logAudit({
    patientId: appointment.patient_id,
    actorRole: "doctor",
    actorName: session.fullName,
    actorId: session.doctorId,
    action: "appointment_status_changed",
    details: `Appointment ${status}${scheduledAt ? ` for ${scheduledAt}` : ""}${notes ? `: ${notes}` : ""}${
      recurrenceCreated ? ` (recurring, ${recurrenceCreated} more occurrence${recurrenceCreated === 1 ? "" : "s"} created)` : ""
    }`,
  });

  res.json({ ok: true, recurrenceCreated });
});

app.post("/api/doctor/appointments/:id/reschedule", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const appointment = findAppointmentById(req.params.id);
  if (!appointment || appointment.doctor_id !== session.doctorId) {
    return res.status(404).json({ error: "Appointment not found." });
  }
  const scheduledAt = str(req.body?.scheduledAt);
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
    return res.status(400).json({ error: "Please provide a valid date and time." });
  }
  rescheduleAppointment(appointment.id, new Date(scheduledAt).toISOString());

  logAudit({
    patientId: appointment.patient_id,
    actorRole: "doctor",
    actorName: session.fullName,
    actorId: session.doctorId,
    action: "appointment_rescheduled",
    details: `Rescheduled to ${scheduledAt}`,
  });

  res.json({ ok: true });
});

// ---------- Doctor waitlist ----------
// A doctor's view of patients waiting for the next open slot with them —
// separate from the requested/confirmed appointment queue above, since a
// waitlist entry isn't an appointment yet.
app.get("/api/doctor/waitlist", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const entries = listWaitlistForDoctor(session.doctorId);
  res.json({
    entries: entries.map((e) => ({
      id: e.id,
      patientId: e.patient_id,
      patientName: e.patient_name,
      reason: e.reason,
      createdAt: e.created_at,
    })),
  });
});

// Turns a waitlist entry directly into a confirmed appointment at a
// doctor-chosen time — one step instead of the patient separately
// re-requesting and the doctor separately confirming.
app.post("/api/doctor/waitlist/:id/offer", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const entry = findWaitlistEntryById(req.params.id);
  if (!entry || entry.doctor_id !== session.doctorId) {
    return res.status(404).json({ error: "Waitlist entry not found." });
  }
  if (entry.status !== "waiting") {
    return res.status(400).json({ error: `This waitlist entry is already ${entry.status}.` });
  }
  const scheduledAt = str(req.body?.scheduledAt);
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
    return res.status(400).json({ error: "Please provide a valid date and time." });
  }
  const appointment = offerWaitlistSlot(entry.id, new Date(scheduledAt).toISOString());

  logAudit({
    patientId: entry.patient_id,
    actorRole: "doctor",
    actorName: session.fullName,
    actorId: session.doctorId,
    action: "appointment_status_changed",
    details: `Offered a waitlist slot for ${scheduledAt}`,
  });

  res.status(201).json({ ok: true, appointmentId: appointment.id });
});

// ---------------------------------------------------------------------------
// Self-service booking — doctor review queue.
//
// Every route is ownership-scoped off session.doctorId (never a request
// param), so a doctor can only ever see and act on requests addressed to them,
// exactly like the follow-up agent routes below. Approving is what actually
// creates the patient + appointment, in one transaction server-side.
// ---------------------------------------------------------------------------

app.get("/api/doctor/registrations", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const statusParam = str(req.query.status as string);
  const status = ["pending", "approved", "rejected"].includes(statusParam)
    ? (statusParam as RegistrationStatus)
    : undefined;
  const registrations = listRegistrationsForDoctor(session.doctorId, status);
  res.json({
    pendingCount: countPendingRegistrationsForDoctor(session.doctorId),
    registrations: registrations.map((r) => ({
      id: r.id,
      nationalId: r.national_id,
      fullName: r.full_name,
      dateOfBirth: r.date_of_birth,
      isMinor: ageInYears(r.date_of_birth) < 18,
      gender: r.gender,
      phoneNumber: r.phone_number,
      email: r.email,
      bloodGroup: r.blood_group,
      allergies: r.allergies,
      chronicConditions: r.chronic_conditions,
      weightKg: r.weight_kg,
      reason: r.reason,
      status: r.status,
      attachmentCount: r.attachment_count ?? 0,
      patientId: r.patient_id,
      matchedPatientId: r.matched_patient_id,
      appointmentId: r.appointment_id,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
      createdAt: r.created_at,
    })),
  });
});

// Badge feed for the doctor header — keeps the nav item's pending count cheap
// enough to fetch on every doctor page without pulling the whole queue.
app.get("/api/doctor/registrations/pending-count", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  res.json({ pendingCount: countPendingRegistrationsForDoctor(session.doctorId) });
});

app.get("/api/doctor/registrations/:id", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const registration = findRegistrationForDoctor(req.params.id, session.doctorId);
  if (!registration) return res.status(404).json({ error: "Request not found." });

  const contacts = (() => {
    try {
      const parsed = registration.contacts ? JSON.parse(registration.contacts) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  res.json({
    registration: {
      id: registration.id,
      nationalId: registration.national_id,
      fullName: registration.full_name,
      dateOfBirth: registration.date_of_birth,
      gender: registration.gender,
      phoneNumber: registration.phone_number,
      email: registration.email,
      address: registration.address,
      bloodGroup: registration.blood_group,
      allergies: registration.allergies,
      chronicConditions: registration.chronic_conditions,
      weightKg: registration.weight_kg,
      pediatricianName: registration.pediatrician_name,
      pediatricianPhone: registration.pediatrician_phone,
      reason: registration.reason,
      status: registration.status,
      matchedPatientId: registration.matched_patient_id,
      contacts,
      patientId: registration.patient_id,
      appointmentId: registration.appointment_id,
      reviewedBy: registration.reviewed_by,
      reviewedAt: registration.reviewed_at,
      createdAt: registration.created_at,
    },
    attachments: getRegistrationAttachments(registration.id).map((a) => ({
      id: a.id,
      originalName: a.original_name,
      mimeType: a.mime_type,
      sizeBytes: a.size_bytes,
    })),
  });
});

// Attachment download. Gated on the registration being owned by this doctor
// (not just authenticated), so one doctor can never pull another doctor's
// patient's uploaded reports.
app.get("/api/doctor/registrations/:id/attachments/:attachmentId", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const registration = findRegistrationForDoctor(req.params.id, session.doctorId);
  if (!registration) return res.status(404).json({ error: "Request not found." });

  const attachment = findRegistrationAttachmentById(req.params.attachmentId);
  if (!attachment || attachment.registration_id !== registration.id) {
    return res.status(404).json({ error: "Attachment not found." });
  }

  // stored_name is server-generated, so this join stays inside UPLOAD_DIR.
  const full = path.join(UPLOAD_DIR, attachment.stored_name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: "Attachment file is missing." });

  // original_name is user-supplied, so only ever used as a download filename —
  // basename() again, and quoted, so it can't break out of the header.
  const safeName = path.basename(attachment.original_name).replace(/["\r\n]/g, "_");
  res.setHeader("Content-Type", attachment.mime_type);
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  fs.createReadStream(full).pipe(res);
});

// The doctor allocates the date/time. This is the moment the pending request
// becomes a real patient + confirmed appointment (see
// approvePatientRegistration) — the patient chose the doctor, never the time.
app.post("/api/doctor/registrations/:id/allocate", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const registration = findRegistrationForDoctor(req.params.id, session.doctorId);
  if (!registration) return res.status(404).json({ error: "Request not found." });
  if (registration.status !== "pending") {
    return res.status(400).json({ error: `This request has already been ${registration.status}.` });
  }

  const scheduledAt = str(req.body?.scheduledAt);
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
    return res.status(400).json({ error: "Please provide a valid date and time." });
  }
  const when = new Date(scheduledAt);
  if (when.getTime() <= Date.now()) {
    return res.status(400).json({ error: "Please choose a time in the future." });
  }

  try {
    const { patientId, appointmentId } = approvePatientRegistration({
      registrationId: registration.id,
      doctorId: session.doctorId,
      doctorName: session.fullName,
      scheduledAtIso: when.toISOString(),
    });

    logAudit({
      patientId,
      actorRole: "doctor",
      actorName: session.fullName,
      actorId: session.doctorId,
      action: "patient_registered",
      details: `Approved self-service booking request from ${registration.full_name}`,
    });
    logAudit({
      patientId,
      actorRole: "doctor",
      actorName: session.fullName,
      actorId: session.doctorId,
      action: "appointment_status_changed",
      details: `Appointment allocated from booking request for ${when.toISOString()}`,
    });

    // The RAG chunks indexed against the booking request follow the patient.
    // Fire-and-forget: the approval transaction above has already committed,
    // and a RAG service hiccup must never fail an approved registration.
    void reparentRagIndex(registration.id, patientId).catch((err) =>
      console.error("[pulseid-backend] RAG chunk re-parenting failed:", err)
    );

    res.json({ ok: true, patientId, appointmentId });
  } catch (err: any) {
    // The transaction rolls back completely on any throw, so there's no
    // half-approved state to clean up here.
    const code = err?.message;
    if (code === "NATIONAL_ID_TAKEN") {
      return res.status(409).json({
        error: "A patient with this National ID was registered in the meantime. Ask them to sign in instead.",
      });
    }
    if (code === "ALREADY_REVIEWED") {
      return res.status(400).json({ error: "This request has already been reviewed." });
    }
    console.error("[pulseid-backend] Failed to allocate booking request:", err);
    res.status(500).json({ error: "Couldn't allocate this request. Please try again." });
  }
});

app.post("/api/doctor/registrations/:id/reject", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const registration = findRegistrationForDoctor(req.params.id, session.doctorId);
  if (!registration) return res.status(404).json({ error: "Request not found." });
  if (registration.status !== "pending") {
    return res.status(400).json({ error: `This request has already been ${registration.status}.` });
  }
  rejectPatientRegistration(registration.id, session.doctorId, session.fullName);
  // A rejected request's uploaded reports are worthless and can't be
  // un-inserted, so they're removed from disk rather than left to accumulate.
  // Their embedded RAG chunks go too (attachment text + the profile chunk with
  // the applicant's personal details) — the files are gone, so the extracted
  // text must not outlive the rejection.
  for (const attachment of getRegistrationAttachments(registration.id)) {
    void deleteRagSource("attachment", attachment.id).catch((err) =>
      console.error("[pulseid-backend] RAG attachment deletion failed:", err)
    );
  }
  void deleteRagSource("profile", registration.id).catch((err) =>
    console.error("[pulseid-backend] RAG profile deletion failed:", err)
  );
  const removed = purgeRegistrationAttachments(registration.id, UPLOAD_DIR);
  res.json({ ok: true, attachmentsRemoved: removed });
});

// ---------------------------------------------------------------------------
// Proactive follow-up agents (doctor side)
// ---------------------------------------------------------------------------

const FOLLOWUP_STATUSES: FollowupAgentStatus[] = ["active", "paused", "completed"];

app.post("/api/doctor/followups", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const patientId = str(req.body?.patientId);
  const pathology = str(req.body?.pathology);
  const frequencyDaysRaw = Number(req.body?.frequencyDays);
  const frequencyDays = Number.isFinite(frequencyDaysRaw) ? Math.round(frequencyDaysRaw) : 7;

  if (!patientId) return res.status(400).json({ error: "A patient is required." });
  const patient = findPatientById(patientId);
  if (!patient) return res.status(404).json({ error: "Patient not found." });
  if (!pathology) return res.status(400).json({ error: "A follow-up type is required." });
  if (frequencyDays < 1 || frequencyDays > 90) {
    return res.status(400).json({ error: "Check-in frequency must be between 1 and 90 days." });
  }

  let questions: FollowupQuestion[];
  if (Array.isArray(req.body?.questions) && req.body.questions.length > 0) {
    questions = req.body.questions
      .map((q: any) => ({
        id: str(q?.id) || randomUUID(),
        text: str(q?.text),
        type: q?.type === "scale" || q?.type === "yes_no" || q?.type === "text" ? q.type : "text",
        concernAt: Number.isFinite(Number(q?.concernAt)) ? Number(q.concernAt) : undefined,
      }))
      .filter((q: FollowupQuestion) => q.text.length > 0);
  } else {
    questions = defaultQuestionsFor(pathology);
  }
  if (questions.length === 0) return res.status(400).json({ error: "At least one question is required." });

  const agent = createFollowupAgent({
    patientId: patient.id,
    doctorId: session.doctorId,
    pathology,
    questions: JSON.stringify(questions),
    frequencyDays,
  });

  logAudit({
    patientId: patient.id,
    actorRole: "doctor",
    actorName: session.fullName,
    actorId: session.doctorId,
    action: "followup_agent_created",
    details: `Started a ${pathology} follow-up (every ${frequencyDays} day(s))`,
  });

  res.status(201).json({ agent });
});

app.get("/api/doctor/followups", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  res.json({ agents: listFollowupAgentsForDoctor(session.doctorId) });
});

app.get("/api/doctor/followups/:id/checkins", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const agent = findFollowupAgentForDoctor(req.params.id, session.doctorId);
  if (!agent) return res.status(404).json({ error: "Follow-up not found." });
  res.json({ agent, checkins: listCheckinsForAgent(agent.id) });
});

app.post("/api/doctor/followups/:id/status", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const agent = findFollowupAgentForDoctor(req.params.id, session.doctorId);
  if (!agent) return res.status(404).json({ error: "Follow-up not found." });
  const status = str(req.body?.status) as FollowupAgentStatus;
  if (!FOLLOWUP_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status." });

  const updated = updateFollowupAgentStatus(agent.id, status);
  logAudit({
    patientId: agent.patient_id,
    actorRole: "doctor",
    actorName: session.fullName,
    actorId: session.doctorId,
    action: "followup_agent_status_changed",
    details: `${agent.pathology} follow-up set to ${status}`,
  });
  res.json({ agent: updated });
});

// Every unacknowledged 'concern'/'urgent' check-in across this doctor's
// follow-up agents — the "needs attention" list.
app.get("/api/doctor/followups/alerts", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  res.json({ alerts: listFollowupAlertsForDoctor(session.doctorId) });
});

app.post("/api/doctor/followups/alerts/:checkinId/acknowledge", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const ok = acknowledgeFollowupAlert(req.params.checkinId, session.doctorId);
  if (!ok) return res.status(404).json({ error: "Alert not found." });
  res.json({ ok: true });
});


app.get("/api/patients/recently-viewed", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const recent = listRecentlyViewedPatients(session.doctorId, 6);
  res.json({
    patients: recent.map((p) => ({
      id: p.id,
      nationalId: p.national_id,
      fullName: p.full_name,
      dateOfBirth: p.date_of_birth,
      isMinor: ageInYears(p.date_of_birth) < 18,
      bloodGroup: p.blood_group,
      viewedAt: p.viewed_at,
    })),
  });
});

// Both a CNIC and a B-Form use the same #####-#######-# shape — NADRA
// reuses the format, it's the id_type that distinguishes them.
const NATIONAL_ID_RE = /^\d{5}-\d{7}-\d{1}$/;

app.post("/api/patients", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const BLOOD_GROUPS: BloodGroup[] = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"];

  const body = req.body;
  if (!body || typeof body !== "object") return res.status(400).json({ error: "Invalid request body." });

  const nationalId = str(body.nationalId);
  const fullName = str(body.fullName);
  const dateOfBirth = str(body.dateOfBirth);
  const gender = str(body.gender);
  const phoneNumber = str(body.phoneNumber);
  const email = str(body.email);
  const address = str(body.address);
  const bloodGroup = (str(body.bloodGroup) || "unknown") as BloodGroup;
  const allergies = str(body.allergies);
  const chronicConditions = str(body.chronicConditions);
  const weightKgRaw = str(body.weightKg);
  const pediatricianName = str(body.pediatricianName);
  const pediatricianPhone = str(body.pediatricianPhone);
  const contacts = Array.isArray(body.contacts) ? body.contacts : [];

  const errors: Record<string, string> = {};

  const dobValid = Boolean(dateOfBirth) && !Number.isNaN(Date.parse(dateOfBirth));
  const isMinor = dobValid && ageInYears(dateOfBirth) < 18;
  // The B-Form is NADRA's under-18 equivalent of a CNIC — same digit
  // pattern, so the only extra rule is "don't claim to be a CNIC (an
  // adult-only document) for someone whose DOB says they're a minor",
  // and vice versa. If DOB isn't valid yet, skip this cross-check for now;
  // the dateOfBirth error below will surface separately.
  const idType = str(body.idType) === "b_form" ? "b_form" : "cnic";

  if (!NATIONAL_ID_RE.test(nationalId)) {
    errors.nationalId = "Enter a valid ID in the format 12345-1234567-1.";
  } else if (nationalIdExists(nationalId)) {
    errors.nationalId = isMinor
      ? "A patient with this B-Form number is already registered."
      : "A patient with this National ID is already registered.";
  } else if (dobValid && isMinor && idType !== "b_form") {
    errors.nationalId = "This patient is under 18 — use their B-Form number, not a CNIC.";
  } else if (dobValid && !isMinor && idType === "b_form") {
    errors.nationalId = "This patient is 18 or older — use their CNIC, not a B-Form number.";
  }

  if (!fullName || fullName.length < 2) errors.fullName = "Full name is required.";
  if (!dobValid) {
    errors.dateOfBirth = "Enter a valid date of birth.";
  } else if (new Date(dateOfBirth).getTime() > Date.now()) {
    errors.dateOfBirth = "Date of birth can't be in the future.";
  }
  if (!gender) errors.gender = "Select a gender.";
  if (!phoneNumber || phoneNumber.replace(/\D/g, "").length < 7) {
    errors.phoneNumber = isMinor
      ? "Enter a valid phone number (a parent or guardian's number is fine)."
      : "Enter a valid phone number.";
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address, or leave it blank.";
  if (!BLOOD_GROUPS.includes(bloodGroup)) errors.bloodGroup = "Select a valid blood group.";

  const validContacts = contacts.filter(
    (c: any) => c && typeof c === "object" && str(c.fullName) && str(c.phoneNumber) && str(c.relationshipType)
  );
  for (const c of contacts) {
    if (!c || typeof c !== "object") continue;
    if (!str(c.fullName) || !str(c.phoneNumber) || !str(c.relationshipType)) {
      errors.contacts = "Each emergency contact needs a name, relationship and phone number.";
      break;
    }
  }
  // A minor can't be their own point of contact in an emergency — someone
  // with legal responsibility for them needs to be reachable. This is on
  // top of (not instead of) the OTP login number above, which may itself
  // be the guardian's phone since the child usually has no phone of their own.
  if (isMinor && !errors.contacts && validContacts.length === 0) {
    errors.contacts = "A parent or guardian's contact is required for patients under 18.";
  }

  let weightKg: number | null = null;
  if (weightKgRaw) {
    const parsed = Number(weightKgRaw);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 300) {
      errors.weightKg = "Enter a weight in kg, or leave it blank.";
    } else {
      weightKg = parsed;
    }
  }

  // Optional first appointment, requested on the patient's behalf by the
  // doctor doing the registration. Note this does NOT weaken the rule that
  // PATIENTS never pick their own date/time — that invariant lives in
  // createAppointment, which hardcodes scheduled_at = NULL and status
  // 'requested' so the only way a time ever gets set is a requireDoctor
  // route. This one is behind requireDoctor and is the same authorized path
  // as setAppointmentSchedule from the doctor's appointment queue, so the slot
  // goes out already 'confirmed' rather than bouncing back through the
  // request queue for a doctor to confirm a minute later.
  //
  // Validated up here, alongside every other field, rather than after the
  // patient row exists — otherwise a bad date would return 400 *after*
  // createPatient had already committed, leaving an orphaned registration the
  // caller believes failed.
  let appointmentWhen: Date | null = null;
  let appointmentReason: string | null = null;
  const apptRaw = (body as any).appointment;
  if (apptRaw && typeof apptRaw === "object") {
    const apptWhenRaw = str(apptRaw.scheduledAt);
    if (apptWhenRaw) {
      const when = new Date(apptWhenRaw);
      if (Number.isNaN(when.getTime())) {
        errors.appointment = "Enter a valid date and time for the appointment.";
      } else if (when.getTime() <= Date.now()) {
        errors.appointment = "The appointment must be in the future.";
      } else {
        appointmentWhen = when;
        appointmentReason = str(apptRaw.reason) || null;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: "Please fix the highlighted fields.", fieldErrors: errors });
  }

  const patient = createPatient({
    nationalId,
    idType,
    fullName,
    dateOfBirth,
    gender,
    phoneNumber,
    email: email || null,
    address: address || null,
    bloodGroup,
    allergies: allergies || null,
    chronicConditions: chronicConditions || null,
    weightKg,
    pediatricianName: pediatricianName || null,
    pediatricianPhone: pediatricianPhone || null,
  });

  let primarySet = false;
  for (const c of contacts) {
    if (!c || typeof c !== "object") continue;
    const cFullName = str(c.fullName);
    const cPhone = str(c.phoneNumber);
    const cRel = str(c.relationshipType);
    if (!cFullName || !cPhone || !cRel) continue;
    addEmergencyContact({ patientId: patient.id, fullName: cFullName, relationshipType: cRel, phoneNumber: cPhone, isPrimary: !primarySet });
    primarySet = true;
  }

  // Registration is itself a real-world encounter at this doctor's hospital,
  // so it needs its own medical_records row — that's what makes the patient's
  // visit timeline (and their report) start with the registration itself
  // instead of being empty until their next recorded visit.
  createMedicalRecord({
    patientId: patient.id,
    doctorId: session.doctorId,
    recordType: "registration",
    visitDate: new Date().toISOString().slice(0, 10),
    diagnosis: "",
    symptoms: "",
    notes: `Patient registered by ${session.fullName}`,
  });

  logAudit({ patientId: patient.id, actorRole: "doctor", actorName: session.fullName, actorId: session.doctorId, action: "patient_registered", details: `Registered new patient by ${session.fullName}` });

  // Created only after the patient exists and the field validation above has
  // already passed, so this can't leave a half-made appointment behind. The
  // two-step (create as 'requested' with no time, then set the slot) is the
  // exact same sequence the doctor appointment-queue confirm path uses —
  // createAppointment alone can never produce a dated appointment.
  let appointment = null;
  if (appointmentWhen) {
    const created = createAppointment({
      patientId: patient.id,
      doctorId: session.doctorId,
      reason: appointmentReason,
    });
    setAppointmentSchedule(created.id, appointmentWhen.toISOString(), "confirmed");
    appointment = findAppointmentById(created.id);

    logAudit({
      patientId: patient.id,
      actorRole: "doctor",
      actorName: session.fullName,
      actorId: session.doctorId,
      action: "appointment_status_changed",
      details: `First appointment scheduled at registration for ${appointmentWhen.toISOString()}`,
    });
  }

  // Same rule as everywhere else: password_hash and the raw emergency QR
  // token never leave the server in a JSON body — the QR token is only
  // ever served, embedded in a signed image, via GET /api/patient/qr.
  res.status(201).json({
    patient: serializePatientCore(patient),
    appointment: appointment
      ? {
          id: appointment.id,
          scheduledAt: appointment.scheduled_at,
          status: appointment.status,
          reason: appointment.reason,
        }
      : null,
  });
});

app.get("/api/patients/search", requireDoctor, (req, res) => {
  const q = str(req.query.q as string);
  if (q.length < 2) return res.json({ patients: [] });
  const patients = searchPatients(q);
  res.json({
    patients: patients.map((p) => ({
      id: p.id,
      nationalId: p.national_id,
      idType: p.id_type,
      fullName: p.full_name,
      dateOfBirth: p.date_of_birth,
      isMinor: ageInYears(p.date_of_birth) < 18,
      gender: p.gender,
      bloodGroup: p.blood_group,
    })),
  });
});

app.get("/api/patients/by-token/:token", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  if (rateLimited(req, res, "by-token", 30, 60_000)) return;

  const token = str(req.params.token);
  if (!token) return res.status(400).json({ error: "Missing code." });

  const patient = findPatientByToken(token);
  if (!patient) return res.status(404).json({ error: "No patient found for this code." });

  logAudit({ patientId: patient.id, actorRole: "doctor", actorName: session.fullName, actorId: session.doctorId, action: "record_viewed", details: "Opened patient record by scanning their QR code" });
  rotatePatientQrToken(patient.id, `Scanned by Dr. ${session.fullName}`);

  res.json({ id: patient.id, fullName: patient.full_name });
});

// Same lookup, but by the patient's actual CNIC — this is what a doctor's
// scanner hits when it reads a real government CNIC card instead of a
// PulseID-generated QR. Nothing to rotate; the CNIC is permanent.
app.get("/api/patients/by-national-id/:nationalId", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  if (rateLimited(req, res, "by-national-id", 30, 60_000)) return;

  const nationalId = str(req.params.nationalId);
  if (!nationalId) return res.status(400).json({ error: "Missing CNIC." });

  const patient = findPatientByNationalId(nationalId);
  if (!patient) return res.status(404).json({ error: "No patient found for this CNIC.", nationalId });

  logAudit({ patientId: patient.id, actorRole: "doctor", actorName: session.fullName, actorId: session.doctorId, action: "record_viewed", details: "Opened patient record by scanning their CNIC card" });

  res.json({ id: patient.id, fullName: patient.full_name });
});

// ---------------------------------------------------------------------------
// Physical QR card management (printed ID cards / wristbands)
//
// A patient's normal in-app QR rotates on every scan (anti-replay). A
// printed card can't do that — its artwork is fixed forever — so it's
// tracked separately via qr_is_static. This endpoint is the only way to
// mint, transfer, or kill a physical card, and every action is audited.
// ---------------------------------------------------------------------------
app.post("/api/patients/:id/physical-card", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  if (rateLimited(req, res, "physical-card", 20, 60_000)) return;

  const patient = findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: "Patient not found." });

  const action = str(req.body?.action); // "issue" | "reissue" | "revoke"
  if (!["issue", "reissue", "revoke"].includes(action)) {
    return res.status(400).json({ error: "action must be one of: issue, reissue, revoke." });
  }

  if (action === "revoke") {
    // Drop back to a normal rotating token so a lost/stolen card can never
    // be scanned for this patient's data again, even though the printed
    // artwork still exists somewhere.
    const result = setPatientQrStatic(patient.id, false, true);
    logAudit({ patientId: patient.id, actorRole: "doctor", actorName: session.fullName, actorId: session.doctorId, action: "physical_card_revoked", details: `Physical card revoked by Dr. ${session.fullName}. Old code permanently disabled.` });
    return res.json({ ok: true, isStatic: false, token: result.token });
  }

  // issue: bind current token permanently (freeze it so it can be printed).
  // reissue: mint a brand-new frozen token (e.g. replacing a lost card) —
  // the old printed card stops working immediately.
  const reissueToken = action === "reissue";
  const result = setPatientQrStatic(patient.id, true, reissueToken);
  logAudit({
    patientId: patient.id,
    actorRole: "doctor",
    actorName: session.fullName,
    actorId: session.doctorId,
    action: action === "reissue" ? "physical_card_reissued" : "physical_card_issued",
    details: `Physical card ${action === "reissue" ? "reissued" : "issued"} by Dr. ${session.fullName}.`,
  });
  res.json({ ok: true, isStatic: true, token: result.token });
});

app.get("/api/patients/:id", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const full = getPatientFullRecord(req.params.id);
  if (!full) return res.status(404).json({ error: "Patient not found." });

  logAudit({ patientId: full.patient.id, actorRole: "doctor", actorName: session.fullName, actorId: session.doctorId, action: "record_viewed", details: "Viewed full medical history via dashboard search" });
  recordPatientView(session.doctorId, full.patient.id);

  res.json(full);
});

// Doctor-only edit of a patient's core details. Patients can never call
// this route — it's guarded by requireDoctor, and there's no equivalent
// route mounted under requirePatient. National ID / ID type are excluded
// from what can be edited here; those are the patient's fixed identity.
app.patch("/api/patients/:id", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const BLOOD_GROUPS: BloodGroup[] = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"];

  const patient = findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: "Patient not found." });

  const body = req.body;
  if (!body || typeof body !== "object") return res.status(400).json({ error: "Invalid request body." });

  const fullName = str(body.fullName);
  const dateOfBirth = str(body.dateOfBirth);
  const gender = str(body.gender);
  const phoneNumber = str(body.phoneNumber);
  const email = str(body.email);
  const address = str(body.address);
  const bloodGroup = (str(body.bloodGroup) || "unknown") as BloodGroup;
  const allergies = str(body.allergies);
  const chronicConditions = str(body.chronicConditions);
  const weightKgRaw = str(body.weightKg);
  const pediatricianName = str(body.pediatricianName);
  const pediatricianPhone = str(body.pediatricianPhone);

  const errors: Record<string, string> = {};
  const dobValid = Boolean(dateOfBirth) && !Number.isNaN(Date.parse(dateOfBirth));

  if (!fullName || fullName.length < 2) errors.fullName = "Full name is required.";
  if (!dobValid) {
    errors.dateOfBirth = "Enter a valid date of birth.";
  } else if (new Date(dateOfBirth).getTime() > Date.now()) {
    errors.dateOfBirth = "Date of birth can't be in the future.";
  }
  if (!gender) errors.gender = "Select a gender.";
  if (!phoneNumber || phoneNumber.replace(/\D/g, "").length < 7) {
    errors.phoneNumber = "Enter a valid phone number.";
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address, or leave it blank.";
  if (!BLOOD_GROUPS.includes(bloodGroup)) errors.bloodGroup = "Select a valid blood group.";

  let weightKg: number | null = null;
  if (weightKgRaw) {
    const parsed = Number(weightKgRaw);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 300) {
      errors.weightKg = "Enter a weight in kg, or leave it blank.";
    } else {
      weightKg = parsed;
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: "Please fix the highlighted fields.", fieldErrors: errors });
  }

  const updated = updatePatient(patient.id, {
    fullName,
    dateOfBirth,
    gender,
    phoneNumber,
    email: email || null,
    address: address || null,
    bloodGroup,
    allergies: allergies || null,
    chronicConditions: chronicConditions || null,
    weightKg,
    pediatricianName: pediatricianName || null,
    pediatricianPhone: pediatricianPhone || null,
  });

  logAudit({
    patientId: patient.id,
    actorRole: "doctor",
    actorName: session.fullName,
    actorId: session.doctorId,
    action: "patient_details_edited",
    details: `Updated patient details for ${fullName}`,
  });

  res.json({ patient: serializePatientCore(updated) });
});

app.post("/api/patients/:id/records", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const patient = findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: "Patient not found." });

  const recordType = req.body?.recordType || "checkup";
  const visitDate = req.body?.visitDate || new Date().toISOString().slice(0, 10);
  const diagnosis = str(req.body?.diagnosis);
  const symptoms = str(req.body?.symptoms);
  const notes = str(req.body?.notes);

  if (!diagnosis) return res.status(400).json({ error: "Diagnosis is required." });

  // Optional vitals — each parsed independently and left null if absent or
  // not a finite number, so a partially-filled vitals form never blocks
  // saving the visit itself.
  const parseNum = (v: unknown): number | null => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const systolicBp = parseNum(req.body?.systolicBp);
  const diastolicBp = parseNum(req.body?.diastolicBp);
  const bloodSugarMmol = parseNum(req.body?.bloodSugarMmol);
  const bodyTempC = parseNum(req.body?.bodyTempC);
  const heartRateBpm = parseNum(req.body?.heartRateBpm);

  const record = createMedicalRecord({
    patientId: patient.id,
    doctorId: session.doctorId,
    recordType,
    visitDate,
    diagnosis,
    symptoms,
    notes,
    systolicBp,
    diastolicBp,
    bloodSugarMmol,
    bodyTempC,
    heartRateBpm,
  });

  logAudit({ patientId: patient.id, actorRole: "doctor", actorName: session.fullName, actorId: session.doctorId, action: "record_created", details: `Added ${String(recordType).replace("_", " ")}: ${diagnosis}` });

  // Fire-and-forget RAG indexing of the new visit (lib/rag.ts) — the AI
  // report drafter retrieves from these chunks. Local embeddings, so this
  // never blocks or fails the save itself.
  void indexPatientVisit(patient.id, record.id).catch((err) =>
    console.error("[pulseid-backend] RAG visit indexing failed:", err)
  );

  // Only score when at least one vital was actually provided — a visit
  // with no vitals attached simply has nothing to score.
  let riskAssessment = null;
  if (hasAnyVitals({ systolicBp, diastolicBp, bloodSugarMmol, bodyTempC, heartRateBpm })) {
    const requestedContext = str(req.body?.riskContext);
    const context: RiskContext = requestedContext === "maternal" ? "maternal" : "general";
    const ageYears = patient.date_of_birth ? ageInYears(patient.date_of_birth) : null;
    const result = computeRiskAssessment({
      ageYears,
      systolicBp,
      diastolicBp,
      bloodSugarMmol,
      bodyTempC,
      heartRateBpm,
      context,
    });
    riskAssessment = saveRiskAssessment({
      patientId: patient.id,
      medicalRecordId: record.id,
      context,
      riskLevel: result.level,
      riskScore: result.score,
      factors: result.factors,
    });
    if (result.level === "high") {
      logAudit({
        patientId: patient.id,
        actorRole: "system",
        actorName: "PulseID risk scorer",
        action: "risk_flagged_high",
        details: result.factors.join(" "),
      });
    }
  }

  res.json({ record, riskAssessment, riskDisclaimer: riskAssessment ? RISK_DISCLAIMER : undefined });
});

// ---------------------------------------------------------------------------
// AI-drafted clinical reports (RAG over this patient's record, lib/rag.ts).
//
// Two steps, deliberately split: `draft` asks Grok for a structured draft
// grounded in retrieved chunks and the doctor's own visit notes — it writes
// NOTHING to the database. `finalize` saves the doctor-reviewed version as
// the visit's clinical text, stores every prescription as a structured row,
// and sends the patient an in-app notification. The doctor's approval step
// in between is the human gate; the draft is a convenience, never an
// automatic clinical decision.
// ---------------------------------------------------------------------------

const AI_REPORT_DISCLAIMER =
  "AI-drafted from the doctor's notes and this patient's record — reviewed and approved by the doctor before saving. A drafting aid, not a diagnosis.";

app.post("/api/patients/:id/records/:recordId/draft", requireDoctor, async (req, res) => {
  if (rateLimited(req, res, "doctor-ai-draft", 10, 60_000)) return;
  const session = (req as any).doctor as DoctorSession;
  const patient = findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: "Patient not found." });
  const record = findMedicalRecordById(req.params.recordId);
  if (!record || record.patient_id !== patient.id) {
    return res.status(404).json({ error: "Visit not found." });
  }
  if (!isReportDrafterConfigured()) {
    return res.status(503).json({
      error: "AI report drafting isn't configured for this deployment yet. Set RAG_SERVICE_ENABLED=1 in backend/.env and start the RAG service (backend/rag — see its README; the Groq key lives in backend/rag/.env).",
    });
  }

  // Keywords come from the request body when the doctor drafts before
  // saving detailed notes; otherwise the visit's own fields ARE the notes.
  const keywords =
    str(req.body?.keywords) ||
    [record.diagnosis, record.symptoms, record.notes].filter(Boolean).join(". ");
  if (!keywords) {
    return res.status(400).json({ error: "Write a few keywords or short sentences about the visit first." });
  }

  try {
    const { docs, mode } = await retrievePatientContext(
      patient.id,
      `${keywords} ${record.diagnosis ?? ""} ${record.symptoms ?? ""}`.trim()
    );
    const draft = await draftPatientReport({
      patientName: patient.full_name,
      visitDate: record.visit_date,
      keywords,
      docs,
    });
    res.json({
      draft,
      retrieval: { mode, sources: docs.map((d) => d.label) },
      disclaimer: AI_REPORT_DISCLAIMER,
    });
  } catch (err) {
    if ((err as Error)?.message === "RAG_DRAFT_INCOMPLETE") {
      return res
        .status(502)
        .json({ error: "The AI draft came back incomplete. Please try drafting again — it usually succeeds on retry." });
    }
    console.error("[pulseid-backend] AI report drafting failed:", err);
    res.status(500).json({ error: "Couldn't draft the report. Please try again." });
  }
});

app.post("/api/patients/:id/records/:recordId/finalize", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const patient = findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: "Patient not found." });
  const record = findMedicalRecordById(req.params.recordId);
  if (!record || record.patient_id !== patient.id) {
    return res.status(404).json({ error: "Visit not found." });
  }

  const diagnosis = str(req.body?.diagnosis);
  const notes = str(req.body?.notes);
  if (!diagnosis || !notes) {
    return res.status(400).json({ error: "A diagnosis and the report text are both required." });
  }

  const rows = Array.isArray(req.body?.prescriptions) ? req.body.prescriptions : [];
  if (rows.length > 20) {
    return res.status(400).json({ error: "A visit can carry at most 20 prescriptions." });
  }
  const medications: Medication[] = [];
  const rowInstructions: string[] = [];
  for (const row of rows) {
    const name = str(row?.name);
    if (!name) return res.status(400).json({ error: "Every prescription needs a medication name." });
    medications.push({
      name,
      dosage: str(row?.dosage),
      frequency: str(row?.frequency),
      duration: str(row?.duration),
    });
    const instruction = str(row?.instructions);
    if (instruction) rowInstructions.push(`${name}: ${instruction}`);
  }

  const updated = finalizeMedicalRecord(record.id, { diagnosis, notes });
  // Sending is replace-semantics: a re-finalize (doctor edits an already-sent
  // report) rewrites the visit's prescriptions instead of stacking duplicates.
  deletePrescriptionsForRecord(record.id);
  const prescription = medications.length
    ? createPrescription({
        patientId: patient.id,
        doctorId: session.doctorId,
        medicalRecordId: record.id,
        medications,
        instructions: rowInstructions.join("; ") || null,
        issuedDate: new Date().toISOString().slice(0, 10),
      })
    : null;

  // In-app notification to the patient — the "sent" moment of the flow.
  // Deliberately no email/SMS: those are separately configured channels.
  createNotification({
    patientId: patient.id,
    type: "report",
    title: `New report from ${session.fullName}`,
    body: `Your visit report for ${record.visit_date} is ready, including any prescriptions.`,
    link: "/patient/records",
  });

  logAudit({
    patientId: patient.id,
    actorRole: "doctor",
    actorName: session.fullName,
    actorId: session.doctorId,
    action: "report_finalized",
    details: `AI-assisted report finalised for visit ${record.visit_date}${medications.length ? ` (${medications.length} prescription${medications.length === 1 ? "" : "s"} labelled)` : ""}`,
  });

  res.json({ record: updated, prescription, patientNotified: true, disclaimer: AI_REPORT_DISCLAIMER });
});

// Patient-side in-app notification feed. No email/SMS — deliberately in-app
// only, like every other notification path in this app.
app.get("/api/patient/notifications", requirePatient, (req, res) => {
  const session = (req as any).patient as PatientSession;
  res.json({
    notifications: listNotificationsForPatient(session.patientId).map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      isRead: Boolean(n.is_read),
      createdAt: n.created_at,
    })),
    unreadCount: countUnreadNotificationsForPatient(session.patientId),
  });
});

app.post("/api/patient/notifications/:id/read", requirePatient, (req, res) => {
  const session = (req as any).patient as PatientSession;
  if (!markNotificationRead(req.params.id, session.patientId)) {
    return res.status(404).json({ error: "Notification not found." });
  }
  res.json({ ok: true });
});

app.post("/api/patient/notifications/read-all", requirePatient, (req, res) => {
  const session = (req as any).patient as PatientSession;
  markAllNotificationsRead(session.patientId);
  res.json({ ok: true });
});

// Latest risk assessment plus history for a patient — doctor view.
app.get("/api/patients/:id/risk", requireDoctor, (req, res) => {
  const patient = findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: "Patient not found." });
  const history = listRiskAssessmentsForPatient(patient.id);
  res.json({ latest: history[0] || null, history, disclaimer: RISK_DISCLAIMER });
});

// Detailed, self-contained medical report — doctor / hospital edition.
app.get("/api/patients/:id/report", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const report = buildMedicalReport(req.params.id, "doctor", session.fullName);
  if (!report) return res.status(404).json({ error: "Patient not found." });

  logAudit({ patientId: req.params.id, actorRole: "doctor", actorName: session.fullName, actorId: session.doctorId, action: "record_viewed", details: "Generated full detailed medical report" });

  res.json({ report, generatedBy: { name: session.fullName, hospitalName: session.hospitalName || null } });
});

// Doctor-side export of the same report — PDF (e.g. to attach to a referral)
// or JSON (e.g. to hand off to another system).
app.get("/api/patients/:id/report/export", requireDoctor, (req, res) => {
  if (rateLimited(req, res, "report-export", 20, 60_000)) return;
  const session = (req as any).doctor as DoctorSession;
  const report = buildMedicalReport(req.params.id, "doctor", session.fullName);
  if (!report) return res.status(404).json({ error: "Patient not found." });

  const format = str(req.query.format as string) || "pdf";
  const filenameSafe = report.patient.fullName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  logAudit({ patientId: req.params.id, actorRole: "doctor", actorName: session.fullName, actorId: session.doctorId, action: "record_exported", details: `Exported full medical report as ${format.toUpperCase()}` });

  if (format === "json") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="pulseid-${filenameSafe}.json"`);
    return res.send(JSON.stringify(report, null, 2));
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="pulseid-${filenameSafe}.pdf"`);
  const doc = buildReportPdf(report);
  doc.pipe(res);
  doc.end();
});

// ---------------------------------------------------------------------------
// Doctor-side guardian link management — set/unset the direct link, and
// review self-service requests a guardian submitted from their own portal.
// ---------------------------------------------------------------------------

app.get("/api/patients/:id/guardian", requireDoctor, (req, res) => {
  const minor = findPatientById(req.params.id);
  if (!minor) return res.status(404).json({ error: "Patient not found." });

  const guardian = minor.guardian_patient_id ? findPatientById(minor.guardian_patient_id) : undefined;
  const pending = listPendingGuardianRequestsForMinor(minor.id);

  res.json({
    guardian: guardian
      ? { id: guardian.id, fullName: guardian.full_name, nationalId: guardian.national_id, phone: guardian.phone_number }
      : null,
    pendingRequests: pending.map((r) => {
      const g = findPatientById(r.guardian_patient_id);
      return {
        id: r.id,
        guardianFullName: g?.full_name || "Unknown",
        guardianNationalId: g?.national_id || "",
        guardianPhone: g?.phone_number || "",
        createdAt: r.created_at,
      };
    }),
  });
});

// A doctor's direct link carries full clinical authority — no auto-verify
// check needed, unlike the patient self-service path above.
app.post("/api/patients/:id/guardian", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const minor = findPatientById(req.params.id);
  if (!minor) return res.status(404).json({ error: "Patient not found." });

  const guardianNationalId = str(req.body?.guardianNationalId);
  const guardian = findPatientByNationalId(guardianNationalId);
  if (!guardian) return res.status(400).json({ error: "No PulseID record for that CNIC." });
  if (guardian.id === minor.id) return res.status(400).json({ error: "A patient can't be their own guardian." });
  if (ageInYears(guardian.date_of_birth) < 18) {
    return res.status(400).json({ error: "The guardian's own record shows them as under 18 — pick an adult's PulseID." });
  }

  setGuardian(minor.id, guardian.id);
  logAudit({
    patientId: minor.id,
    actorRole: "doctor",
    actorName: session.fullName,
    actorId: session.doctorId,
    action: "guardian_linked",
    details: `Linked guardian ${guardian.full_name} by Dr. ${session.fullName}`,
  });

  res.json({ guardian: { id: guardian.id, fullName: guardian.full_name, nationalId: guardian.national_id, phone: guardian.phone_number } });
});

app.delete("/api/patients/:id/guardian", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const minor = findPatientById(req.params.id);
  if (!minor) return res.status(404).json({ error: "Patient not found." });

  setGuardian(minor.id, null);
  logAudit({ patientId: minor.id, actorRole: "doctor", actorName: session.fullName, actorId: session.doctorId, action: "guardian_unlinked", details: `Guardian link removed by Dr. ${session.fullName}` });
  res.json({ ok: true });
});

app.post("/api/patients/:id/guardian-requests/:requestId/approve", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const minor = findPatientById(req.params.id);
  if (!minor) return res.status(404).json({ error: "Patient not found." });

  const request = findGuardianRequestById(req.params.requestId);
  if (!request || request.minor_patient_id !== minor.id || request.status !== "pending") {
    return res.status(404).json({ error: "Request not found." });
  }
  const guardian = findPatientById(request.guardian_patient_id);
  if (!guardian) return res.status(404).json({ error: "Requesting guardian's record not found." });

  setGuardian(minor.id, guardian.id);
  resolveGuardianRequest(request.id, "approved", `Dr. ${session.fullName}`);
  rejectOtherPendingGuardianRequests(minor.id, request.id, `Dr. ${session.fullName}`);
  logAudit({
    patientId: minor.id,
    actorRole: "doctor",
    actorName: session.fullName,
    actorId: session.doctorId,
    action: "guardian_linked",
    details: `Approved guardian request from ${guardian.full_name} (Dr. ${session.fullName})`,
  });

  res.json({ ok: true });
});

app.post("/api/patients/:id/guardian-requests/:requestId/reject", requireDoctor, (req, res) => {
  const session = (req as any).doctor as DoctorSession;
  const minor = findPatientById(req.params.id);
  if (!minor) return res.status(404).json({ error: "Patient not found." });

  const request = findGuardianRequestById(req.params.requestId);
  if (!request || request.minor_patient_id !== minor.id || request.status !== "pending") {
    return res.status(404).json({ error: "Request not found." });
  }

  resolveGuardianRequest(request.id, "rejected", `Dr. ${session.fullName}`);
  logAudit({
    patientId: minor.id,
    actorRole: "doctor",
    actorName: session.fullName,
    actorId: session.doctorId,
    action: "guardian_link_rejected",
    details: `Rejected guardian request (Dr. ${session.fullName})`,
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Hospital admin — manage doctors at the admin's own hospital only.
//
// Every route here is scoped server-side to `session.hospitalId`, taken
// from the signed JWT, never from a request body/query param — so there is
// no request shape a hospital admin can send that reaches another
// hospital's doctors. Admins cannot transfer a doctor to a different
// hospital (hospital_id is never accepted as writable input here) and
// cannot see or modify patient data at all.
// ---------------------------------------------------------------------------

app.get("/api/hospital-admin/me", requireHospitalAdmin, (req, res) => {
  const session = (req as any).hospitalAdmin as HospitalAdminSession;
  res.json({ hospitalAdmin: session });
});

// Own-hospital dashboard: patient volume, appointment load, and per-doctor
// activity, scoped to exactly the requesting admin's own hospital_id — which
// always comes from the session, never the request body.
app.get("/api/hospital-admin/stats", requireHospitalAdmin, (req, res) => {
  const session = (req as any).hospitalAdmin as HospitalAdminSession;
  res.json({ stats: getHospitalAdminStats(session.hospitalId) });
});

app.get("/api/hospital-admin/doctors", requireHospitalAdmin, (req, res) => {
  const session = (req as any).hospitalAdmin as HospitalAdminSession;
  const doctors = listDoctorsForHospital(session.hospitalId);
  res.json({
    doctors: doctors.map((d) => ({
      id: d.id,
      fullName: d.full_name,
      email: d.email,
      licenseNumber: d.license_number,
      specialization: d.specialization,
      isActive: Boolean(d.is_active),
    })),
  });
});

app.post("/api/hospital-admin/doctors", requireHospitalAdmin, async (req, res) => {
  const session = (req as any).hospitalAdmin as HospitalAdminSession;
  if (rateLimited(req, res, "hospital-admin-create-doctor", 20, 60_000)) return;

  const fullName = str(req.body?.fullName);
  const email = str(req.body?.email).toLowerCase();
  const password = str(req.body?.password);
  const licenseNumber = str(req.body?.licenseNumber);
  const specialization = str(req.body?.specialization) || null;

  if (!fullName || !email || !password || !licenseNumber) {
    return res.status(400).json({ error: "fullName, email, password, and licenseNumber are required." });
  }
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (doctorEmailExists(email)) return res.status(409).json({ error: "A doctor with that email already exists." });
  if (licenseNumberExists(licenseNumber)) return res.status(409).json({ error: "That license number is already registered." });

  // hospital_id is always the admin's own hospital — never taken from the
  // request body, so this can never create a doctor at a different hospital.
  const doctor = createDoctorForHospital({
    fullName,
    email,
    passwordHash: bcrypt.hashSync(password, 12),
    licenseNumber,
    specialization,
    hospitalId: session.hospitalId,
  });

  res.status(201).json({
    doctor: {
      id: doctor.id,
      fullName: doctor.full_name,
      email: doctor.email,
      licenseNumber: doctor.license_number,
      specialization: doctor.specialization,
      isActive: Boolean(doctor.is_active),
    },
  });
});

// Bulk doctor import (CSV, parsed client-side into rows) — the same
// validation as single-create above, just run once per row instead of
// requiring 20+ individual form submissions when a hospital onboards. Each
// row is created independently (not one all-or-nothing transaction): a
// typo in row 14 shouldn't block rows 1-13 and 15-20 from going in, so the
// response reports a per-row outcome and the caller decides what to do
// about failures (e.g. fix and re-upload just those rows).
app.post("/api/hospital-admin/doctors/bulk", requireHospitalAdmin, async (req, res) => {
  const session = (req as any).hospitalAdmin as HospitalAdminSession;
  if (rateLimited(req, res, "hospital-admin-bulk-import", 5, 60_000)) return;

  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows || rows.length === 0) {
    return res.status(400).json({ error: "No rows to import." });
  }
  if (rows.length > 200) {
    return res.status(400).json({ error: "Import is limited to 200 doctors at a time." });
  }

  // Catches duplicate emails/license numbers *within this upload* — the
  // existence checks below only see what's already in the database, so two
  // rows in the same CSV with the same email would otherwise both pass.
  const seenEmails = new Set<string>();
  const seenLicenses = new Set<string>();

  const results: { row: number; ok: boolean; error?: string; doctor?: { id: string; fullName: string; email: string } }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i] || {};
    const fullName = str(raw.fullName);
    const email = str(raw.email).toLowerCase();
    const password = str(raw.password);
    const licenseNumber = str(raw.licenseNumber);
    const specialization = str(raw.specialization) || null;

    const fail = (error: string) => results.push({ row: i + 1, ok: false, error });

    if (!fullName || !email || !password || !licenseNumber) {
      fail("fullName, email, password, and licenseNumber are required.");
      continue;
    }
    if (password.length < 8) {
      fail("Password must be at least 8 characters.");
      continue;
    }
    if (seenEmails.has(email)) {
      fail("Duplicate email within this file.");
      continue;
    }
    if (seenLicenses.has(licenseNumber)) {
      fail("Duplicate license number within this file.");
      continue;
    }
    if (doctorEmailExists(email)) {
      fail("A doctor with that email already exists.");
      continue;
    }
    if (licenseNumberExists(licenseNumber)) {
      fail("That license number is already registered.");
      continue;
    }

    seenEmails.add(email);
    seenLicenses.add(licenseNumber);

    const doctor = createDoctorForHospital({
      fullName,
      email,
      passwordHash: bcrypt.hashSync(password, 12),
      licenseNumber,
      specialization,
      hospitalId: session.hospitalId,
    });
    results.push({ row: i + 1, ok: true, doctor: { id: doctor.id, fullName: doctor.full_name, email: doctor.email } });
  }

  const created = results.filter((r) => r.ok).length;
  res.status(created > 0 ? 201 : 400).json({ results, created, failed: results.length - created });
});

// Edit an existing doctor's specialization. Deliberately the only editable
// field besides active status — full_name/email/license changes and
// (especially) hospital transfers aren't exposed here at all.
app.patch("/api/hospital-admin/doctors/:id", requireHospitalAdmin, (req, res) => {
  const session = (req as any).hospitalAdmin as HospitalAdminSession;
  const doctor = findDoctorById(req.params.id);
  if (!doctor || doctor.hospital_id !== session.hospitalId) {
    return res.status(404).json({ error: "Doctor not found." });
  }

  if (req.body?.specialization !== undefined) {
    const specialization = str(req.body.specialization) || null;
    updateDoctorSpecialization(doctor.id, specialization);
  }

  const updated = findDoctorById(doctor.id)!;
  res.json({
    doctor: {
      id: updated.id,
      fullName: updated.full_name,
      email: updated.email,
      licenseNumber: updated.license_number,
      specialization: updated.specialization,
      isActive: Boolean(updated.is_active),
    },
  });
});

// Deactivate (never delete — history stays intact) a doctor at this
// hospital. A deactivated doctor can no longer log in (see
// findDoctorByEmail) or be offered to patients booking appointments (see
// listDoctorsForBooking), but every past record/prescription/appointment
// they created is untouched.
app.post("/api/hospital-admin/doctors/:id/deactivate", requireHospitalAdmin, (req, res) => {
  const session = (req as any).hospitalAdmin as HospitalAdminSession;
  const doctor = findDoctorById(req.params.id);
  if (!doctor || doctor.hospital_id !== session.hospitalId) {
    return res.status(404).json({ error: "Doctor not found." });
  }
  setDoctorActive(doctor.id, false);
  res.json({ ok: true });
});

app.post("/api/hospital-admin/doctors/:id/reactivate", requireHospitalAdmin, (req, res) => {
  const session = (req as any).hospitalAdmin as HospitalAdminSession;
  const doctor = findDoctorById(req.params.id);
  if (!doctor || doctor.hospital_id !== session.hospitalId) {
    return res.status(404).json({ error: "Doctor not found." });
  }
  setDoctorActive(doctor.id, true);
  res.json({ ok: true });
});

// Read-only view of a doctor's recent activity — what they've been doing
// across patients, without going through the analyst-only audit log or
// exposing the doctor's login. Explicitly view-only: there is no
// corresponding write endpoint here, and this never returns clinical
// content (diagnoses/notes) itself, only the same action/patient/timestamp
// summary a patient sees for their own record in getAuditLog above.
app.get("/api/hospital-admin/doctors/:id/audit-log", requireHospitalAdmin, (req, res) => {
  const session = (req as any).hospitalAdmin as HospitalAdminSession;
  const doctor = findDoctorById(req.params.id);
  if (!doctor || doctor.hospital_id !== session.hospitalId) {
    return res.status(404).json({ error: "Doctor not found." });
  }
  const entries = getDoctorAuditLog(doctor.id);
  res.json({
    doctor: { id: doctor.id, fullName: doctor.full_name },
    entries: entries.map((e) => ({
      id: e.id,
      patientId: e.patient_id,
      patientName: e.patient_name,
      action: e.action,
      details: e.details,
      createdAt: e.created_at,
    })),
  });
});

// ---------------------------------------------------------------------------
// Hospital admin — patient registration/demographic edits.
//
// PulseID's patient records aren't siloed per hospital (a doctor at any
// hospital can already search/treat any patient nationwide — that's the
// whole point of an emergency-access national ID system), so this doesn't
// introduce a new cross-hospital exposure; it gives hospital admins the
// same edit surface a doctor already has, reusing the exact same
// validation as PATCH /api/patients/:id above.
//
// Deliberately narrower than the doctor view, though: this group never
// returns medical history (visit records, diagnoses, prescriptions) or the
// clinical audit trail — only the demographic/registration fields an
// admin or front-desk supervisor would legitimately need to fix (name,
// DOB, contact info, blood group, allergies on file, etc). Clinical
// charting stays doctor-only. Every write is audited with
// actorRole: "hospital_admin" so it's distinguishable from a doctor edit
// in the patient's own audit log.
// ---------------------------------------------------------------------------

// Hospital-wide appointment log for the admin console: every appointment
// across every doctor at this hospital, with optional status/doctor
// filters. Patient/doctor names are included for display, but nothing from
// medical_records or prescriptions ever enters this query — same
// no-clinical-data boundary as every other hospital-admin route.
app.get("/api/hospital-admin/appointments", requireHospitalAdmin, (req, res) => {
  const session = (req as any).hospitalAdmin as HospitalAdminSession;
  const statusParam = str(req.query.status as string);
  const status = APPOINTMENT_STATUSES.includes(statusParam as AppointmentStatus)
    ? (statusParam as AppointmentStatus)
    : undefined;
  const doctorId = str(req.query.doctorId as string) || undefined;
  const appointments = listAppointmentsForHospital(session.hospitalId, { status, doctorId });
  res.json({
    appointments: appointments.map((a) => ({
      id: a.id,
      patientId: a.patient_id,
      patientName: a.patient_name,
      doctorId: a.doctor_id,
      doctorName: a.doctor_name,
      scheduledAt: a.scheduled_at,
      reason: a.reason,
      status: a.status,
      recurrenceRule: a.recurrence_rule,
      recurrenceIndex: a.recurrence_index,
      recurrenceCount: a.recurrence_count,
    })),
  });
});

// AI-drafted operational insight over this hospital's appointment load —
// fed only aggregate counts by status/doctor (see
// getHospitalAppointmentLoadSummary), never patient names or reasons, so
// this stays within the same "aggregate-only" boundary as every other
// hospital-admin route. Rate-limited like the other write-adjacent admin
// actions since each call is a paid LLM request.
app.post("/api/hospital-admin/appointments/insights", requireHospitalAdmin, async (req, res) => {
  if (!AI_CONFIGURED) {
    res.status(503).json({ error: "AI insights aren't configured for this deployment yet." });
    return;
  }
  if (rateLimited(req, res, "hospital-admin-appointment-insights", 10, 60_000)) return;
  const session = (req as any).hospitalAdmin as HospitalAdminSession;
  try {
    const load = getHospitalAppointmentLoadSummary(session.hospitalId);
    const prompt = `Appointment load for this hospital right now:

By status: ${JSON.stringify(load.byStatus)}
By doctor (active doctors only, requested vs confirmed counts): ${JSON.stringify(load.byDoctor)}
Oldest unconfirmed request has been waiting: ${
      load.oldestUnconfirmedHours === null ? "no unconfirmed requests" : `${load.oldestUnconfirmedHours} hours`
    }

Write the briefing.`;
    const summary = await askClaude(OPS_SYSTEM_PROMPT, prompt);
    res.json({ summary });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || "Couldn't generate insights right now." });
  }
});

// AI-drafted staffing-balance briefing over a trailing 30-day window: which
// active doctors are carrying the load, which are under-booked, and where
// cancellation/no-show rates stand out. Same aggregate-only boundary as the
// insights route above (see getDoctorWorkloadBalance) — doctor names are
// staff, not patients, so they're fine to include, but nothing about which
// patients they saw ever enters the prompt.
app.post("/api/hospital-admin/doctors/workload-insights", requireHospitalAdmin, async (req, res) => {
  if (!AI_CONFIGURED) {
    res.status(503).json({ error: "AI insights aren't configured for this deployment yet." });
    return;
  }
  if (rateLimited(req, res, "hospital-admin-workload-insights", 10, 60_000)) return;
  const session = (req as any).hospitalAdmin as HospitalAdminSession;
  try {
    const workload = getDoctorWorkloadBalance(session.hospitalId, 30);
    if (workload.doctors.length === 0) {
      res.json({ summary: "No active doctors have recorded activity in the last 30 days yet." });
      return;
    }
    const prompt = `Doctor workload over the last ${workload.windowDays} days at this hospital (one row per active doctor):

${JSON.stringify(workload.doctors, null, 0)}

Field meanings: visitsInWindow is medical-record visits logged directly (walk-ins/records added), appointmentsTotal is booked appointments regardless of outcome, completionRate/noShowRate are percentages of appointmentsTotal. A null rate means that doctor had zero appointments in the window (not necessarily idle — they may only do walk-in visits).

Write the briefing. Call out the busiest and least-loaded doctors by name, flag anyone with a notably high cancellation/no-show rate (say what "notably high" means relative to their peers here, don't invent an external benchmark), and note if the load looks reasonably balanced instead if it does.`;
    const summary = await askClaude(OPS_SYSTEM_PROMPT, prompt);
    res.json({ summary });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || "Couldn't generate workload insights right now." });
  }
});

// AI-drafted week-over-week operations digest: new patients, completed
// visits, appointment volume and cancellations this week vs last. Broader
// lens than the two routes above (which are both point-in-time snapshots) —
// this is the one that actually speaks to trend direction, which is what a
// hospital admin checking in once a week actually wants to read first.
app.post("/api/hospital-admin/weekly-digest", requireHospitalAdmin, async (req, res) => {
  if (!AI_CONFIGURED) {
    res.status(503).json({ error: "AI insights aren't configured for this deployment yet." });
    return;
  }
  if (rateLimited(req, res, "hospital-admin-weekly-digest", 10, 60_000)) return;
  const session = (req as any).hospitalAdmin as HospitalAdminSession;
  try {
    const figures = getHospitalWeeklyDigestFigures(session.hospitalId);
    const prompt = `Week-over-week figures for this hospital:

This week (last 7 days): ${JSON.stringify(figures.thisWeek)}
Previous week (7 days before that): ${JSON.stringify(figures.lastWeek)}

Write a short weekly digest. Lead with the headline trend (up/down/flat, and by roughly how much) for the figures that moved most, then one or two sentences on what's operationally worth a look this week. If a week has all-zero figures, say plainly that there's no recorded activity in that window rather than inventing a trend.`;
    const summary = await askClaude(OPS_SYSTEM_PROMPT, prompt);
    res.json({ summary, figures });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || "Couldn't generate the weekly digest right now." });
  }
});

app.get("/api/hospital-admin/patients/search", requireHospitalAdmin, (req, res) => {
  const q = str(req.query.q as string);
  if (q.length < 2) return res.json({ patients: [] });
  const patients = searchPatients(q);
  res.json({
    patients: patients.map((p) => ({
      id: p.id,
      nationalId: p.national_id,
      idType: p.id_type,
      fullName: p.full_name,
      dateOfBirth: p.date_of_birth,
      isMinor: ageInYears(p.date_of_birth) < 18,
      gender: p.gender,
      bloodGroup: p.blood_group,
    })),
  });
});

// snake_case, matching the same `Patient` shape the doctor-side patient
// pages use — but deliberately excludes fields a hospital admin has no
// business seeing: password_hash, emergency_qr_token, qr_rotated_at,
// qr_rotation_count, qr_is_static, guardian_patient_id.
function serializePatientCore(patient: ReturnType<typeof findPatientById>) {
  if (!patient) return null;
  return {
    id: patient.id,
    national_id: patient.national_id,
    id_type: patient.id_type,
    full_name: patient.full_name,
    date_of_birth: patient.date_of_birth,
    gender: patient.gender,
    phone_number: patient.phone_number,
    email: patient.email,
    address: patient.address,
    blood_group: patient.blood_group,
    allergies: patient.allergies,
    chronic_conditions: patient.chronic_conditions,
    weight_kg: patient.weight_kg,
    pediatrician_name: patient.pediatrician_name,
    pediatrician_phone: patient.pediatrician_phone,
    created_at: patient.created_at,
  };
}

app.get("/api/hospital-admin/patients/:id", requireHospitalAdmin, (req, res) => {
  const patient = findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: "Patient not found." });
  res.json({ patient: serializePatientCore(patient) });
});

app.patch("/api/hospital-admin/patients/:id", requireHospitalAdmin, (req, res) => {
  const session = (req as any).hospitalAdmin as HospitalAdminSession;
  const BLOOD_GROUPS: BloodGroup[] = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"];

  const patient = findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: "Patient not found." });

  const body = req.body;
  if (!body || typeof body !== "object") return res.status(400).json({ error: "Invalid request body." });

  const fullName = str(body.fullName);
  const dateOfBirth = str(body.dateOfBirth);
  const gender = str(body.gender);
  const phoneNumber = str(body.phoneNumber);
  const email = str(body.email);
  const address = str(body.address);
  const bloodGroup = (str(body.bloodGroup) || "unknown") as BloodGroup;
  const allergies = str(body.allergies);
  const chronicConditions = str(body.chronicConditions);
  const weightKgRaw = str(body.weightKg);
  const pediatricianName = str(body.pediatricianName);
  const pediatricianPhone = str(body.pediatricianPhone);

  const errors: Record<string, string> = {};
  const dobValid = Boolean(dateOfBirth) && !Number.isNaN(Date.parse(dateOfBirth));

  if (!fullName || fullName.length < 2) errors.fullName = "Full name is required.";
  if (!dobValid) {
    errors.dateOfBirth = "Enter a valid date of birth.";
  } else if (new Date(dateOfBirth).getTime() > Date.now()) {
    errors.dateOfBirth = "Date of birth can't be in the future.";
  }
  if (!gender) errors.gender = "Select a gender.";
  if (!phoneNumber || phoneNumber.replace(/\D/g, "").length < 7) {
    errors.phoneNumber = "Enter a valid phone number.";
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address, or leave it blank.";
  if (!BLOOD_GROUPS.includes(bloodGroup)) errors.bloodGroup = "Select a valid blood group.";

  let weightKg: number | null = null;
  if (weightKgRaw) {
    const parsed = Number(weightKgRaw);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 300) {
      errors.weightKg = "Enter a weight in kg, or leave it blank.";
    } else {
      weightKg = parsed;
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: "Please fix the highlighted fields.", fieldErrors: errors });
  }

  const updated = updatePatient(patient.id, {
    fullName,
    dateOfBirth,
    gender,
    phoneNumber,
    email: email || null,
    address: address || null,
    bloodGroup,
    allergies: allergies || null,
    chronicConditions: chronicConditions || null,
    weightKg,
    pediatricianName: pediatricianName || null,
    pediatricianPhone: pediatricianPhone || null,
  });

  logAudit({
    patientId: patient.id,
    actorRole: "hospital_admin",
    actorName: `${session.fullName} (${session.hospitalName})`,
    action: "patient_details_edited",
    details: `Updated patient details for ${fullName} via hospital admin console`,
  });

  res.json({ patient: serializePatientCore(updated) });
});

// ---------------------------------------------------------------------------
// 404 + central error handler.
// ---------------------------------------------------------------------------

app.use((_req, res) => res.status(404).json({ error: "Not found." }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

// Listening is guarded so tests can import the app (supertest binds its own
// ephemeral port); every other environment starts the server as before.
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`[pulseid-backend] listening on http://localhost:${PORT}`);
    console.log(`[pulseid-backend] allowed origins: ${ORIGINS.join(", ")}`);
  });
}
