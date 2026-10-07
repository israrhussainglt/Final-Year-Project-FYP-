import { randomUUID, randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "./db";
import type {
  AuditLog,
  Appointment,
  AppointmentStatus,
  AppointmentWaitlistEntry,
  Doctor,
  DoctorAuditEntry,
  EmergencyContact,
  GuardianLinkRequest,
  Hospital,
  HospitalAdmin,
  HospitalAdminStats,
  MedicalRecord,
  Patient,
  PatientFullRecord,
  Prescription,
  QrRotationLog,
  RiskAssessment,
  RiskContext,
  RiskLevel,
  FollowupAgent,
  FollowupAgentStatus,
  FollowupCheckin,
  FollowupRiskFlag,
  PatientRegistration,
  RegistrationAttachment,
  RegistrationStatus,
  BloodGroup,
  Medication,
  Notification,
} from "./types";

// ---------- Doctors ----------

// Doctor login only ever succeeds for an active doctor — a hospital admin
// deactivating a doctor (see deactivateDoctor below) takes effect
// immediately, without deleting any of that doctor's historical records,
// appointments, or prescriptions (which stay intact so patients keep their
// history).
export function findDoctorByEmail(email: string): Doctor | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM doctors WHERE email = ? AND is_active = 1").get(email) as Doctor | undefined;
}

export function findHospitalById(id: string): Hospital | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM hospitals WHERE id = ?").get(id) as Hospital | undefined;
}

export function listHospitals(): Hospital[] {
  const db = getDb();
  return db.prepare("SELECT * FROM hospitals ORDER BY province, city, name").all() as Hospital[];
}

export function findDoctorById(id: string): Doctor | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM doctors WHERE id = ?").get(id) as Doctor | undefined;
}

// Patient-facing lookups (the public booking form, patient appointment
// requests, waitlist joins) must only ever match an *active* doctor — a
// deactivated doctor can't log in to review what was addressed to them, so
// accepting their id would create a request nobody can ever act on. The
// hospital-admin doctor-management routes deliberately use findDoctorById
// instead, since deactivating/reactivating has to work on inactive rows.
export function findActiveDoctorById(id: string): Doctor | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM doctors WHERE id = ? AND is_active = 1").get(id) as Doctor | undefined;
}

// ---------- Hospital admins ----------
//
// Same auth pattern as doctors (password hash checked with bcrypt by the
// caller, JWT session minted by lib/auth.ts) — a separate session/role from
// doctors and patients, never interchangeable with either.

export function findHospitalAdminByEmail(email: string): HospitalAdmin | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM hospital_admins WHERE email = ?").get(email) as HospitalAdmin | undefined;
}

export function findHospitalAdminById(id: string): HospitalAdmin | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM hospital_admins WHERE id = ?").get(id) as HospitalAdmin | undefined;
}

// Every doctor at the admin's own hospital, active and deactivated alike —
// the admin UI is responsible for showing status; this just never leaks
// doctors from any *other* hospital_id.
export function listDoctorsForHospital(hospitalId: string): Doctor[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM doctors WHERE hospital_id = ? ORDER BY full_name")
    .all(hospitalId) as Doctor[];
}

export function createDoctorForHospital(input: {
  fullName: string;
  email: string;
  passwordHash: string;
  licenseNumber: string;
  specialization: string | null;
  hospitalId: string;
}): Doctor {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO doctors (id, full_name, email, password_hash, license_number, specialization, hospital_id, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(id, input.fullName, input.email, input.passwordHash, input.licenseNumber, input.specialization, input.hospitalId);
  return findDoctorById(id) as Doctor;
}

// Scoped update: the caller (server.ts route) is responsible for checking
// the doctor's hospital_id matches the requesting admin's own hospital_id
// *before* calling this — this function itself only ever touches the one
// row by id, it doesn't re-check hospital scope, so callers must not skip
// that check.
export function updateDoctorSpecialization(doctorId: string, specialization: string | null): void {
  const db = getDb();
  db.prepare("UPDATE doctors SET specialization = ? WHERE id = ?").run(specialization, doctorId);
}

export function setDoctorActive(doctorId: string, isActive: boolean): void {
  const db = getDb();
  db.prepare("UPDATE doctors SET is_active = ? WHERE id = ?").run(isActive ? 1 : 0, doctorId);
}

export function doctorEmailExists(email: string): boolean {
  const db = getDb();
  return Boolean(db.prepare("SELECT 1 FROM doctors WHERE email = ?").get(email));
}

export function licenseNumberExists(licenseNumber: string): boolean {
  const db = getDb();
  return Boolean(db.prepare("SELECT 1 FROM doctors WHERE license_number = ?").get(licenseNumber));
}

// Own-hospital dashboard stats for a hospital admin. Patient records aren't
// siloed per hospital (see the comment above
// the hospital-admin patient routes in server.ts), so "this hospital's
// patients" is defined the only way that's meaningful here: patients this
// hospital's doctors have actually recorded a visit for.
const ALL_APPOINTMENT_STATUSES: AppointmentStatus[] = ["requested", "confirmed", "completed", "cancelled"];

export function getHospitalAdminStats(hospitalId: string): HospitalAdminStats {
  const db = getDb();

  const doctorCounts = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active
       FROM doctors WHERE hospital_id = ?`
    )
    .get(hospitalId) as { total: number; active: number | null };

  const patientsSeen = db
    .prepare(
      `SELECT COUNT(DISTINCT m.patient_id) AS count
       FROM medical_records m JOIN doctors d ON d.id = m.doctor_id
       WHERE d.hospital_id = ?`
    )
    .get(hospitalId) as { count: number };

  const newPatients = db
    .prepare(
      `SELECT COUNT(*) AS count FROM (
         SELECT m.patient_id, MIN(m.created_at) AS first_seen
         FROM medical_records m JOIN doctors d ON d.id = m.doctor_id
         WHERE d.hospital_id = ?
         GROUP BY m.patient_id
       ) WHERE first_seen >= datetime('now', '-30 days')`
    )
    .get(hospitalId) as { count: number };

  const statusRows = db
    .prepare(
      `SELECT a.status, COUNT(*) AS count
       FROM appointments a JOIN doctors d ON d.id = a.doctor_id
       WHERE d.hospital_id = ?
       GROUP BY a.status`
    )
    .all(hospitalId) as { status: AppointmentStatus; count: number }[];
  const byStatus = Object.fromEntries(ALL_APPOINTMENT_STATUSES.map((s) => [s, 0])) as Record<
    AppointmentStatus,
    number
  >;
  for (const row of statusRows) byStatus[row.status] = row.count;

  const upcoming = db
    .prepare(
      `SELECT COUNT(*) AS count FROM appointments a JOIN doctors d ON d.id = a.doctor_id
       WHERE d.hospital_id = ? AND a.status = 'confirmed'
         AND a.scheduled_at BETWEEN datetime('now') AND datetime('now', '+7 days')`
    )
    .get(hospitalId) as { count: number };

  const today = db
    .prepare(
      `SELECT COUNT(*) AS count FROM appointments a JOIN doctors d ON d.id = a.doctor_id
       WHERE d.hospital_id = ? AND a.status IN ('confirmed','completed')
         AND date(a.scheduled_at) = date('now')`
    )
    .get(hospitalId) as { count: number };

  const activityRows = db
    .prepare(
      `SELECT d.id AS doctor_id, d.full_name, d.is_active,
              (SELECT COUNT(*) FROM medical_records m WHERE m.doctor_id = d.id) AS visit_count,
              (SELECT COUNT(*) FROM appointments a WHERE a.doctor_id = d.id) AS appointment_count,
              (SELECT MAX(x) FROM (
                 SELECT MAX(created_at) AS x FROM medical_records WHERE doctor_id = d.id
                 UNION ALL
                 SELECT MAX(updated_at) AS x FROM appointments WHERE doctor_id = d.id
               )) AS last_active_at
       FROM doctors d
       WHERE d.hospital_id = ?
       ORDER BY visit_count DESC, d.full_name ASC`
    )
    .all(hospitalId) as {
    doctor_id: string;
    full_name: string;
    is_active: number;
    visit_count: number;
    appointment_count: number;
    last_active_at: string | null;
  }[];

  return {
    doctors: {
      total: doctorCounts.total,
      active: doctorCounts.active || 0,
      deactivated: doctorCounts.total - (doctorCounts.active || 0),
    },
    patients: { totalSeen: patientsSeen.count, newLast30Days: newPatients.count },
    appointments: { byStatus, upcomingNext7Days: upcoming.count, today: today.count },
    doctorActivity: activityRows.map((r) => ({
      doctorId: r.doctor_id,
      fullName: r.full_name,
      isActive: Boolean(r.is_active),
      visitCount: r.visit_count,
      appointmentCount: r.appointment_count,
      lastActiveAt: r.last_active_at,
    })),
  };
}

// ---------- Patients ----------

export function findPatientByNationalId(nationalId: string): Patient | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM patients WHERE national_id = ?").get(nationalId) as Patient | undefined;
}

export function findPatientById(id: string): Patient | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM patients WHERE id = ?").get(id) as Patient | undefined;
}

export function findPatientByToken(token: string): Patient | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM patients WHERE emergency_qr_token = ?").get(token) as Patient | undefined;
}

export function searchPatients(query: string): Patient[] {
  const db = getDb();
  // Escape LIKE metacharacters so a search string containing % or _ can't be
  // used to widen the match beyond what the user actually typed (a minor
  // enumeration vector otherwise, since this endpoint is reachable by any
  // authenticated doctor).
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  const like = `%${escaped}%`;
  return db
    .prepare(
      "SELECT * FROM patients WHERE national_id LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\' ORDER BY full_name LIMIT 20"
    )
    .all(like, like) as Patient[];
}

export function listRecentPatients(limit = 8): Patient[] {
  const db = getDb();
  return db.prepare("SELECT * FROM patients ORDER BY created_at DESC LIMIT ?").all(limit) as Patient[];
}

// ---------- Doctor's recently-viewed patients (per-doctor MRU) ----------

export function recordPatientView(doctorId: string, patientId: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO doctor_recent_patients (doctor_id, patient_id, viewed_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(doctor_id, patient_id) DO UPDATE SET viewed_at = excluded.viewed_at`
  ).run(doctorId, patientId);
}

export function listRecentlyViewedPatients(doctorId: string, limit = 6): (Patient & { viewed_at: string })[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*, r.viewed_at
       FROM doctor_recent_patients r
       JOIN patients p ON p.id = r.patient_id
       WHERE r.doctor_id = ?
       ORDER BY r.viewed_at DESC
       LIMIT ?`
    )
    .all(doctorId, limit) as (Patient & { viewed_at: string })[];
}

export function listAllPatients(): Patient[] {
  const db = getDb();
  return db.prepare("SELECT * FROM patients ORDER BY full_name ASC").all() as Patient[];
}

export function countPatients(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS n FROM patients").get() as { n: number };
  return row.n;
}

export function nationalIdExists(nationalId: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT 1 FROM patients WHERE national_id = ?").get(nationalId);
  return !!row;
}

export function createPatient(input: {
  nationalId: string;
  idType: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  phoneNumber: string;
  email?: string | null;
  address?: string | null;
  bloodGroup: string;
  allergies?: string | null;
  chronicConditions?: string | null;
  weightKg?: number | null;
  pediatricianName?: string | null;
  pediatricianPhone?: string | null;
}): Patient {
  const db = getDb();
  const id = randomUUID();
  const token = newQrToken();
  db.prepare(
    `INSERT INTO patients
       (id, national_id, id_type, full_name, date_of_birth, gender, phone_number, email, address,
        blood_group, allergies, chronic_conditions, weight_kg, pediatrician_name, pediatrician_phone,
        password_hash, emergency_qr_token)
     VALUES
       (@id, @national_id, @id_type, @full_name, @date_of_birth, @gender, @phone_number, @email, @address,
        @blood_group, @allergies, @chronic_conditions, @weight_kg, @pediatrician_name, @pediatrician_phone,
        NULL, @emergency_qr_token)`
  ).run({
    id,
    national_id: input.nationalId,
    id_type: input.idType,
    full_name: input.fullName,
    date_of_birth: input.dateOfBirth,
    gender: input.gender,
    phone_number: input.phoneNumber,
    email: input.email || null,
    address: input.address || null,
    blood_group: input.bloodGroup,
    allergies: input.allergies || null,
    chronic_conditions: input.chronicConditions || null,
    weight_kg: input.weightKg ?? null,
    pediatrician_name: input.pediatricianName || null,
    pediatrician_phone: input.pediatricianPhone || null,
    emergency_qr_token: token,
  });
  return findPatientById(id) as Patient;
}

// Doctor-only edit of a patient's core details. National ID / ID type are
// intentionally excluded — those are the patient's fixed legal identity and
// changing them here would silently disconnect their history, so that stays
// out of scope for this endpoint.
export function updatePatient(
  id: string,
  input: {
    fullName: string;
    dateOfBirth: string;
    gender: string;
    phoneNumber: string;
    email?: string | null;
    address?: string | null;
    bloodGroup: string;
    allergies?: string | null;
    chronicConditions?: string | null;
    weightKg?: number | null;
    pediatricianName?: string | null;
    pediatricianPhone?: string | null;
  }
): Patient | undefined {
  const db = getDb();
  db.prepare(
    `UPDATE patients SET
       full_name = @full_name,
       date_of_birth = @date_of_birth,
       gender = @gender,
       phone_number = @phone_number,
       email = @email,
       address = @address,
       blood_group = @blood_group,
       allergies = @allergies,
       chronic_conditions = @chronic_conditions,
       weight_kg = @weight_kg,
       pediatrician_name = @pediatrician_name,
       pediatrician_phone = @pediatrician_phone
     WHERE id = @id`
  ).run({
    id,
    full_name: input.fullName,
    date_of_birth: input.dateOfBirth,
    gender: input.gender,
    phone_number: input.phoneNumber,
    email: input.email || null,
    address: input.address || null,
    blood_group: input.bloodGroup,
    allergies: input.allergies || null,
    chronic_conditions: input.chronicConditions || null,
    weight_kg: input.weightKg ?? null,
    pediatrician_name: input.pediatricianName || null,
    pediatrician_phone: input.pediatricianPhone || null,
  });
  return findPatientById(id);
}

// ---------- QR rotation ----------
//
// Every time a patient's emergency QR is scanned — either by the public
// emergency-access page or by a doctor's scanner — the token backing that QR
// is rotated to a fresh, unguessable value. This means a screenshot or photo
// of a PulseID QR is only ever valid for a single read: replaying an old scan
// (e.g. from a photo found later, or a shoulder-surfed screen) can't be used
// to pull up someone's record. The patient's own QR page always reflects the
// current live token, and rotations are logged for transparency.
export function rotatePatientQrToken(
  patientId: string,
  reason: string
): { token: string; rotatedAt: string; rotationCount: number } {
  const db = getDb();

  // Patients whose token is bound to a physically printed card (qr_is_static)
  // are exempt: the artwork can't change after printing, so rotating the
  // token would just brick the card. We still return the current state so
  // callers don't need a special case, but we skip the mutation + log entry.
  const current = findPatientById(patientId);
  if (current?.qr_is_static) {
    return {
      token: current.emergency_qr_token,
      rotatedAt: current.qr_rotated_at as string,
      rotationCount: current.qr_rotation_count,
    };
  }

  const newToken = newQrToken();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE patients
         SET emergency_qr_token = @token,
             qr_rotated_at = datetime('now'),
             qr_rotation_count = qr_rotation_count + 1
       WHERE id = @id`
    ).run({ token: newToken, id: patientId });
    db.prepare(
      `INSERT INTO qr_rotation_log (id, patient_id, reason) VALUES (?, ?, ?)`
    ).run(randomUUID(), patientId, reason);
  });
  tx();
  const patient = findPatientById(patientId) as Patient;
  return {
    token: patient.emergency_qr_token,
    rotatedAt: patient.qr_rotated_at as string,
    rotationCount: patient.qr_rotation_count,
  };
}

export function getQrRotationLog(patientId: string, limit = 20): QrRotationLog[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM qr_rotation_log WHERE patient_id = ? ORDER BY rotated_at DESC LIMIT ?")
    .all(patientId, limit) as QrRotationLog[];
}

// Issues, reissues, or revokes a patient's "physical card" status.
//   makeStatic=true, reissueToken=false  -> freeze the CURRENT token (issue)
//   makeStatic=true, reissueToken=true   -> mint a NEW frozen token (reissue,
//                                            e.g. replacing a lost/stolen card)
//   makeStatic=false                     -> drop back to normal rotation
//                                            (revoke) and mint a fresh token
//                                            so the old printed code is dead
//                                            immediately
export function setPatientQrStatic(
  patientId: string,
  makeStatic: boolean,
  reissueToken: boolean
): { token: string; isStatic: boolean } {
  const db = getDb();
  const patient = findPatientById(patientId);
  if (!patient) throw new Error("Patient not found.");

  const needsNewToken = reissueToken || !makeStatic;
  const token = needsNewToken ? newQrToken() : patient.emergency_qr_token;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE patients
         SET emergency_qr_token = @token,
             qr_is_static = @is_static,
             qr_rotated_at = datetime('now'),
             qr_rotation_count = qr_rotation_count + 1
       WHERE id = @id`
    ).run({ token, is_static: makeStatic ? 1 : 0, id: patientId });
    if (needsNewToken) {
      db.prepare(
        `INSERT INTO qr_rotation_log (id, patient_id, reason) VALUES (?, ?, ?)`
      ).run(
        randomUUID(),
        patientId,
        makeStatic ? "Physical card reissued" : "Physical card revoked — reverted to rotating token"
      );
    }
  });
  tx();
  return { token, isStatic: makeStatic };
}

export function addEmergencyContact(input: {
  patientId: string;
  fullName: string;
  relationshipType: string;
  phoneNumber: string;
  isPrimary: boolean;
}): EmergencyContact {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO emergency_contacts (id, patient_id, full_name, relationship_type, phone_number, is_primary)
     VALUES (@id, @patient_id, @full_name, @relationship_type, @phone_number, @is_primary)`
  ).run({
    id,
    patient_id: input.patientId,
    full_name: input.fullName,
    relationship_type: input.relationshipType,
    phone_number: input.phoneNumber,
    is_primary: input.isPrimary ? 1 : 0,
  });
  return db.prepare("SELECT * FROM emergency_contacts WHERE id = ?").get(id) as EmergencyContact;
}

export function getEmergencyContacts(patientId: string): EmergencyContact[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM emergency_contacts WHERE patient_id = ? ORDER BY is_primary DESC")
    .all(patientId) as EmergencyContact[];
}

export function getMedicalRecords(patientId: string): MedicalRecord[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT mr.*, d.full_name AS doctor_name
       FROM medical_records mr
       LEFT JOIN doctors d ON d.id = mr.doctor_id
       WHERE mr.patient_id = ?
       ORDER BY mr.visit_date DESC, mr.created_at DESC`
    )
    .all(patientId) as MedicalRecord[];
}

export function getPrescriptions(patientId: string): Prescription[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*, d.full_name AS doctor_name
       FROM prescriptions p
       LEFT JOIN doctors d ON d.id = p.doctor_id
       WHERE p.patient_id = ?
       ORDER BY p.issued_date DESC`
    )
    .all(patientId) as Prescription[];
}

export function getPatientFullRecord(patientId: string): PatientFullRecord | undefined {
  const patient = findPatientById(patientId);
  if (!patient) return undefined;
  // Never send the password hash or the raw emergency QR token to the
  // browser here — this record backs both the patient's own portal and the
  // doctor's patient-detail view, and neither client needs either field.
  // (The QR token is served separately, over an authenticated route, by
  // GET /api/patient/qr, which is the only place it should ever leave the
  // server.)
  const { password_hash, emergency_qr_token, ...safePatient } = patient as typeof patient & {
    password_hash?: string;
    emergency_qr_token?: string;
  };
  return {
    patient: safePatient as typeof patient,
    contacts: getEmergencyContacts(patientId),
    records: getMedicalRecords(patientId),
    prescriptions: getPrescriptions(patientId),
  };
}

export function createMedicalRecord(input: {
  patientId: string;
  doctorId: string;
  recordType: string;
  visitDate: string;
  diagnosis: string;
  symptoms: string;
  notes: string;
  // Optional per-visit vitals — nullable, only feed the risk scorer when
  // present (see hasAnyVitals/computeRiskAssessment in lib/risk-scoring.ts).
  systolicBp?: number | null;
  diastolicBp?: number | null;
  bloodSugarMmol?: number | null;
  bodyTempC?: number | null;
  heartRateBpm?: number | null;
}): MedicalRecord {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO medical_records
       (id, patient_id, doctor_id, record_type, visit_date, diagnosis, symptoms, notes,
        systolic_bp, diastolic_bp, blood_sugar_mmol, body_temp_c, heart_rate_bpm)
     VALUES (@id, @patient_id, @doctor_id, @record_type, @visit_date, @diagnosis, @symptoms, @notes,
             @systolic_bp, @diastolic_bp, @blood_sugar_mmol, @body_temp_c, @heart_rate_bpm)`
  ).run({
    id,
    patient_id: input.patientId,
    doctor_id: input.doctorId,
    record_type: input.recordType,
    visit_date: input.visitDate,
    diagnosis: input.diagnosis,
    symptoms: input.symptoms,
    notes: input.notes,
    systolic_bp: input.systolicBp ?? null,
    diastolic_bp: input.diastolicBp ?? null,
    blood_sugar_mmol: input.bloodSugarMmol ?? null,
    body_temp_c: input.bodyTempC ?? null,
    heart_rate_bpm: input.heartRateBpm ?? null,
  });
  const row = db
    .prepare(
      `SELECT mr.*, d.full_name AS doctor_name FROM medical_records mr
       LEFT JOIN doctors d ON d.id = mr.doctor_id WHERE mr.id = ?`
    )
    .get(id) as MedicalRecord;
  return row;
}

// ---------- Audit log ----------

export function logAudit(input: {
  patientId: string;
  actorRole: string;
  actorName: string;
  // Stable id of the actor (e.g. a doctor's id), when there is one — lets
  // getDoctorAuditLog below filter reliably instead of matching on
  // free-text actor_name. Omitted for actors with no durable id (patients
  // acting on their own record already scope by patientId; unauthenticated
  // first-responder scans have no session at all).
  actorId?: string;
  action: string;
  details?: string;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_logs (id, patient_id, actor_role, actor_name, actor_id, action, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    input.patientId,
    input.actorRole,
    input.actorName,
    input.actorId || null,
    input.action,
    input.details || null
  );
}

export function getAuditLog(patientId: string): AuditLog[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM audit_logs WHERE patient_id = ? ORDER BY created_at DESC LIMIT 100")
    .all(patientId) as AuditLog[];
}

// Read-only activity trail for one doctor, across every patient they've
// touched — this is what backs the hospital-admin "view a doctor's recent
// activity" screen. Deliberately separate from getAuditLog above: that one
// is scoped to a single patient's chart, this one is scoped to a single
// actor. Only matches entries logged with actor_id set (see logAudit) —
// pre-migration rows have no actor_id and won't appear here.
export function getDoctorAuditLog(doctorId: string, limit = 100): DoctorAuditEntry[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT a.id, a.patient_id, p.full_name AS patient_name, a.action, a.details, a.created_at
       FROM audit_logs a
       LEFT JOIN patients p ON p.id = a.patient_id
       WHERE a.actor_role = 'doctor' AND a.actor_id = ?
       ORDER BY a.created_at DESC
       LIMIT ?`
    )
    .all(doctorId, limit) as DoctorAuditEntry[];
}

// ---------- OTP (demo-mode "SMS") ----------

// The existing per-IP rate limit (see rate-limit.ts) stops one IP from
// hammering the endpoint, but does nothing to stop someone rotating IPs (or
// a botnet) from repeatedly requesting codes for the *same* national ID —
// which, once a real SMS gateway is wired up, directly costs money per
// send. This caps how many codes any single national ID can have sent to
// it in a rolling 24h window, independent of IP.
const MAX_OTP_SENDS_PER_DAY = 8;

export function canSendOtp(nationalId: string): { ok: boolean; error?: string } {
  const db = getDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = db
    .prepare("SELECT COUNT(*) as count FROM otp_send_log WHERE national_id = ? AND sent_at > ?")
    .get(nationalId, since) as { count: number };
  if (row.count >= MAX_OTP_SENDS_PER_DAY) {
    return { ok: false, error: "Too many codes requested for this National ID today. Please try again tomorrow." };
  }
  return { ok: true };
}

export function issueOtp(nationalId: string): string {
  const db = getDb();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO otp_codes (national_id, code, expires_at, attempts) VALUES (?, ?, ?, 0)
     ON CONFLICT(national_id) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, attempts = 0`
  ).run(nationalId, code, expiresAt);
  db.prepare("INSERT INTO otp_send_log (id, national_id) VALUES (?, ?)").run(randomBytes(8).toString("hex"), nationalId);
  return code;
}

const MAX_OTP_ATTEMPTS = 5;

export function verifyOtp(nationalId: string, code: string): { ok: boolean; error?: string } {
  const db = getDb();
  const row = db.prepare("SELECT * FROM otp_codes WHERE national_id = ?").get(nationalId) as
    | { code: string; expires_at: string; attempts: number }
    | undefined;
  if (!row) return { ok: false, error: "No code was requested for this National ID." };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM otp_codes WHERE national_id = ?").run(nationalId);
    return { ok: false, error: "That code has expired. Request a new one." };
  }
  if (row.attempts >= MAX_OTP_ATTEMPTS) {
    db.prepare("DELETE FROM otp_codes WHERE national_id = ?").run(nationalId);
    return { ok: false, error: "Too many incorrect attempts. Request a new code." };
  }
  if (row.code !== code) {
    db.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE national_id = ?").run(nationalId);
    const remaining = MAX_OTP_ATTEMPTS - (row.attempts + 1);
    return {
      ok: false,
      error: remaining > 0 ? `Incorrect code. ${remaining} attempt(s) left.` : "Too many incorrect attempts. Request a new code.",
    };
  }
  db.prepare("DELETE FROM otp_codes WHERE national_id = ?").run(nationalId);
  return { ok: true };
}

export function newQrToken(): string {
  return randomBytes(16).toString("hex");
}

// ---------- Guardian ↔ dependent links ----------

export function setGuardian(minorPatientId: string, guardianPatientId: string | null): void {
  const db = getDb();
  db.prepare("UPDATE patients SET guardian_patient_id = ? WHERE id = ?").run(guardianPatientId, minorPatientId);
}

export function findDependents(guardianPatientId: string): Patient[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM patients WHERE guardian_patient_id = ? ORDER BY full_name ASC")
    .all(guardianPatientId) as Patient[];
}

export function createGuardianLinkRequest(input: { minorPatientId: string; guardianPatientId: string }): GuardianLinkRequest {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO guardian_link_requests (id, minor_patient_id, guardian_patient_id, status)
     VALUES (?, ?, ?, 'pending')`
  ).run(id, input.minorPatientId, input.guardianPatientId);
  return db.prepare("SELECT * FROM guardian_link_requests WHERE id = ?").get(id) as GuardianLinkRequest;
}

export function findPendingGuardianRequest(minorPatientId: string, guardianPatientId: string): GuardianLinkRequest | undefined {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM guardian_link_requests WHERE minor_patient_id = ? AND guardian_patient_id = ? AND status = 'pending'"
    )
    .get(minorPatientId, guardianPatientId) as GuardianLinkRequest | undefined;
}

export function listPendingGuardianRequestsForMinor(minorPatientId: string): GuardianLinkRequest[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM guardian_link_requests WHERE minor_patient_id = ? AND status = 'pending' ORDER BY created_at ASC")
    .all(minorPatientId) as GuardianLinkRequest[];
}

export function listPendingGuardianRequestsForGuardian(guardianPatientId: string): GuardianLinkRequest[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM guardian_link_requests WHERE guardian_patient_id = ? AND status = 'pending' ORDER BY created_at ASC")
    .all(guardianPatientId) as GuardianLinkRequest[];
}

export function findGuardianRequestById(id: string): GuardianLinkRequest | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM guardian_link_requests WHERE id = ?").get(id) as GuardianLinkRequest | undefined;
}

export function resolveGuardianRequest(id: string, status: "approved" | "rejected", resolvedBy: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE guardian_link_requests SET status = ?, resolved_at = datetime('now'), resolved_by = ? WHERE id = ?"
  ).run(status, resolvedBy, id);
}

// Any other still-pending requests for the same minor become moot once one
// is approved (a minor can only have one linked guardian at a time) — this
// closes them out so a doctor doesn't later approve a second, conflicting
// request against a stale list.
export function rejectOtherPendingGuardianRequests(minorPatientId: string, exceptRequestId: string, resolvedBy: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE guardian_link_requests
     SET status = 'rejected', resolved_at = datetime('now'), resolved_by = ?
     WHERE minor_patient_id = ? AND id != ? AND status = 'pending'`
  ).run(resolvedBy, minorPatientId, exceptRequestId);
}

// ---------- Appointments ----------

export function createAppointment(input: {
  patientId: string;
  doctorId: string;
  reason: string | null;
}): Appointment {
  const db = getDb();
  const id = randomUUID();
  // scheduled_at starts NULL — only a doctor/clinic sets the date & time,
  // via setAppointmentSchedule below.
  db.prepare(
    `INSERT INTO appointments (id, patient_id, doctor_id, scheduled_at, reason, status)
     VALUES (?, ?, ?, NULL, ?, 'requested')`
  ).run(id, input.patientId, input.doctorId, input.reason);
  return findAppointmentById(id)!;
}

export function findAppointmentById(id: string): Appointment | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT a.*, p.full_name AS patient_name, d.full_name AS doctor_name, h.name AS hospital_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
       LEFT JOIN hospitals h ON h.id = d.hospital_id
       WHERE a.id = ?`
    )
    .get(id) as Appointment | undefined;
}

// Upcoming-first, but still returns past/cancelled ones further down so a
// patient can see their full appointment history in one list.
export function listAppointmentsForPatient(patientId: string): Appointment[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT a.*, d.full_name AS doctor_name, h.name AS hospital_name
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       LEFT JOIN hospitals h ON h.id = d.hospital_id
       WHERE a.patient_id = ?
       ORDER BY a.scheduled_at DESC`
    )
    .all(patientId) as Appointment[];
}

// Soonest-first for the doctor's queue — that's the order they'll actually
// work through their day in.
export function listAppointmentsForDoctor(doctorId: string, statusFilter?: AppointmentStatus): Appointment[] {
  const db = getDb();
  if (statusFilter) {
    return db
      .prepare(
        `SELECT a.*, p.full_name AS patient_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE a.doctor_id = ? AND a.status = ?
         ORDER BY a.scheduled_at ASC`
      )
      .all(doctorId, statusFilter) as Appointment[];
  }
  return db
    .prepare(
      `SELECT a.*, p.full_name AS patient_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       WHERE a.doctor_id = ?
       ORDER BY a.scheduled_at ASC`
    )
    .all(doctorId) as Appointment[];
}

// Hospital-wide appointment list for the admin console — joins in the
// doctor's name (never medical_records/prescriptions, so this never leaks
// clinical data, consistent with every other hospital-admin query in this
// file). Optional status/doctor filters keep the query one round trip
// instead of the admin paging through everything client-side.
export function listAppointmentsForHospital(
  hospitalId: string,
  filters?: { status?: AppointmentStatus; doctorId?: string }
): Appointment[] {
  const db = getDb();
  const clauses = ["d.hospital_id = ?"];
  const params: (string | undefined)[] = [hospitalId];
  if (filters?.status) {
    clauses.push("a.status = ?");
    params.push(filters.status);
  }
  if (filters?.doctorId) {
    clauses.push("a.doctor_id = ?");
    params.push(filters.doctorId);
  }
  return db
    .prepare(
      `SELECT a.*, p.full_name AS patient_name, d.full_name AS doctor_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY
         CASE a.status WHEN 'requested' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END,
         a.scheduled_at IS NULL DESC,
         a.scheduled_at ASC`
    )
    .all(...params) as Appointment[];
}

// Aggregate-only figures for the AI insights endpoint below: counts by
// status and by doctor, plus how long the oldest unconfirmed request has
// been waiting. Deliberately returns nothing patient-identifying — no
// names, no reasons — so this is safe to hand to an LLM prompt.
export function getHospitalAppointmentLoadSummary(hospitalId: string): {
  byStatus: Record<AppointmentStatus, number>;
  byDoctor: { doctorName: string; requested: number; confirmed: number }[];
  oldestUnconfirmedHours: number | null;
} {
  const db = getDb();

  const statusRows = db
    .prepare(
      `SELECT a.status, COUNT(*) AS count
       FROM appointments a JOIN doctors d ON d.id = a.doctor_id
       WHERE d.hospital_id = ?
       GROUP BY a.status`
    )
    .all(hospitalId) as { status: AppointmentStatus; count: number }[];
  const byStatus = Object.fromEntries(ALL_APPOINTMENT_STATUSES.map((s) => [s, 0])) as Record<
    AppointmentStatus,
    number
  >;
  for (const row of statusRows) byStatus[row.status] = row.count;

  const doctorRows = db
    .prepare(
      `SELECT d.full_name AS doctor_name,
              SUM(CASE WHEN a.status = 'requested' THEN 1 ELSE 0 END) AS requested,
              SUM(CASE WHEN a.status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed
       FROM doctors d LEFT JOIN appointments a ON a.doctor_id = d.id
       WHERE d.hospital_id = ? AND d.is_active = 1
       GROUP BY d.id
       ORDER BY requested DESC, confirmed DESC`
    )
    .all(hospitalId) as { doctor_name: string; requested: number; confirmed: number }[];

  const oldest = db
    .prepare(
      `SELECT MIN(a.created_at) AS oldest
       FROM appointments a JOIN doctors d ON d.id = a.doctor_id
       WHERE d.hospital_id = ? AND a.status = 'requested'`
    )
    .get(hospitalId) as { oldest: string | null };
  const oldestUnconfirmedHours = oldest.oldest
    ? Math.round((Date.now() - new Date(oldest.oldest).getTime()) / (1000 * 60 * 60))
    : null;

  return {
    byStatus,
    byDoctor: doctorRows.map((r) => ({ doctorName: r.doctor_name, requested: r.requested, confirmed: r.confirmed })),
    oldestUnconfirmedHours,
  };
}

// Aggregate-only workload/quality figures per active doctor over a trailing
// window — completion rate, cancellation rate, and visit volume — so the
// hospital-admin AI briefing can speak to *staffing balance*, not just raw
// today's-queue counts (getHospitalAppointmentLoadSummary above). Same
// no-patient-identifying-data boundary as that function.
export function getDoctorWorkloadBalance(
  hospitalId: string,
  lookbackDays = 30
): {
  windowDays: number;
  doctors: {
    doctorName: string;
    specialization: string | null;
    visitsInWindow: number;
    appointmentsTotal: number;
    completed: number;
    cancelled: number;
    noShowRate: number | null;
    completionRate: number | null;
  }[];
} {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         d.id AS doctor_id,
         d.full_name AS doctor_name,
         d.specialization AS specialization,
         (SELECT COUNT(*) FROM medical_records m
            WHERE m.doctor_id = d.id AND m.created_at >= datetime('now', ?)) AS visits_in_window,
         COUNT(a.id) AS appointments_total,
         SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
       FROM doctors d
       LEFT JOIN appointments a ON a.doctor_id = d.id AND a.created_at >= datetime('now', ?)
       WHERE d.hospital_id = ? AND d.is_active = 1
       GROUP BY d.id
       ORDER BY visits_in_window DESC`
    )
    .all(`-${lookbackDays} days`, `-${lookbackDays} days`, hospitalId) as {
    doctor_id: string;
    doctor_name: string;
    specialization: string | null;
    visits_in_window: number;
    appointments_total: number;
    completed: number;
    cancelled: number;
  }[];

  return {
    windowDays: lookbackDays,
    doctors: rows.map((r) => ({
      doctorName: r.doctor_name,
      specialization: r.specialization,
      visitsInWindow: r.visits_in_window,
      appointmentsTotal: r.appointments_total,
      completed: r.completed,
      cancelled: r.cancelled,
      noShowRate: r.appointments_total > 0 ? Math.round((r.cancelled / r.appointments_total) * 1000) / 10 : null,
      completionRate: r.appointments_total > 0 ? Math.round((r.completed / r.appointments_total) * 1000) / 10 : null,
    })),
  };
}

// Aggregate-only week-over-week comparison for the hospital admin dashboard:
// new patients, completed visits, and appointment volume this trailing
// 7-day window vs the 7 days before it. Feeds the "weekly digest" AI
// briefing so it can talk about trend direction, not just a single
// snapshot. No patient-identifying data leaves this function.
export function getHospitalWeeklyDigestFigures(hospitalId: string): {
  thisWeek: { newPatients: number; completedVisits: number; appointmentsCreated: number; cancelled: number };
  lastWeek: { newPatients: number; completedVisits: number; appointmentsCreated: number; cancelled: number };
} {
  const db = getDb();

  function windowFigures(startExpr: string, endExpr: string) {
    const newPatients = db
      .prepare(
        `SELECT COUNT(*) AS count FROM (
           SELECT m.patient_id, MIN(m.created_at) AS first_seen
           FROM medical_records m JOIN doctors d ON d.id = m.doctor_id
           WHERE d.hospital_id = ?
           GROUP BY m.patient_id
         ) WHERE first_seen >= datetime('now', ?) AND first_seen < datetime('now', ?)`
      )
      .get(hospitalId, startExpr, endExpr) as { count: number };

    const completedVisits = db
      .prepare(
        `SELECT COUNT(*) AS count FROM medical_records m JOIN doctors d ON d.id = m.doctor_id
         WHERE d.hospital_id = ? AND m.created_at >= datetime('now', ?) AND m.created_at < datetime('now', ?)`
      )
      .get(hospitalId, startExpr, endExpr) as { count: number };

    const appt = db
      .prepare(
        `SELECT
           COUNT(*) AS created,
           SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
         FROM appointments a JOIN doctors d ON d.id = a.doctor_id
         WHERE d.hospital_id = ? AND a.created_at >= datetime('now', ?) AND a.created_at < datetime('now', ?)`
      )
      .get(hospitalId, startExpr, endExpr) as { created: number; cancelled: number };

    return {
      newPatients: newPatients.count,
      completedVisits: completedVisits.count,
      appointmentsCreated: appt.created,
      cancelled: appt.cancelled ?? 0,
    };
  }

  return {
    thisWeek: windowFigures("-7 days", "now"),
    lastWeek: windowFigures("-14 days", "-7 days"),
  };
}

export function updateAppointmentStatus(
  id: string,
  status: AppointmentStatus,
  doctorNotes?: string | null
): void {
  const db = getDb();
  db.prepare(
    `UPDATE appointments SET status = ?, doctor_notes = COALESCE(?, doctor_notes), updated_at = datetime('now') WHERE id = ?`
  ).run(status, doctorNotes ?? null, id);
}

export function rescheduleAppointment(id: string, scheduledAt: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE appointments SET scheduled_at = ?, status = 'requested', updated_at = datetime('now') WHERE id = ?`
  ).run(scheduledAt, id);
}

// Sets the date/time (and, usually in the same click, the status) for an
// appointment a patient has requested — this is how a doctor/clinic turns a
// bare "requested" row into a "confirmed" one with an actual slot. Only
// ever called from the doctor side; patients have no path to this.
export function setAppointmentSchedule(id: string, scheduledAt: string, status: AppointmentStatus, doctorNotes?: string | null): void {
  const db = getDb();
  db.prepare(
    `UPDATE appointments SET scheduled_at = ?, status = ?, doctor_notes = COALESCE(?, doctor_notes), updated_at = datetime('now') WHERE id = ?`
  ).run(scheduledAt, status, doctorNotes ?? null, id);
}

// Appointments with a set time within a date window — what the doctor
// calendar/agenda view renders. Deliberately date-window-only (not
// status-filtered): a day view wants to show a cancelled slot too, greyed
// out, not silently omit it.
export function listAppointmentsForDoctorInRange(doctorId: string, startIso: string, endIso: string): Appointment[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT a.*, p.full_name AS patient_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       WHERE a.doctor_id = ? AND a.scheduled_at IS NOT NULL AND a.scheduled_at BETWEEN ? AND ?
       ORDER BY a.scheduled_at ASC`
    )
    .all(doctorId, startIso, endIso) as Appointment[];
}

function addRecurrenceInterval(date: Date, rule: "weekly" | "biweekly" | "monthly"): Date {
  const next = new Date(date.getTime());
  if (rule === "weekly") next.setDate(next.getDate() + 7);
  else if (rule === "biweekly") next.setDate(next.getDate() + 14);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

// Turns a single confirmed appointment into the first occurrence of a
// recurring series — used for chronic-condition follow-ups where the same
// patient/doctor pairing repeats on a fixed cadence. The original
// appointment row is reused as occurrence 1 (its id doesn't change, so
// anything already referencing it stays valid); occurrences 2..count are
// newly created, already 'confirmed', at the same time-of-day spaced out
// by the rule. Each occurrence is independently reschedulable/cancellable
// afterwards — this only sets up the initial series, it doesn't keep them
// linked for cascading edits.
export function createRecurringSeries(input: {
  firstAppointmentId: string;
  rule: "weekly" | "biweekly" | "monthly";
  count: number; // total occurrences, including the first
}): Appointment[] {
  const db = getDb();
  const first = findAppointmentById(input.firstAppointmentId);
  if (!first || !first.scheduled_at) {
    throw new Error("Cannot create a recurring series from an appointment with no scheduled time.");
  }
  const groupId = randomUUID();
  const count = Math.max(1, Math.min(input.count, 26)); // cap a series at 26 occurrences (~6 months weekly)

  const updateFirst = db.prepare(
    `UPDATE appointments
     SET recurrence_group_id = ?, recurrence_rule = ?, recurrence_index = 1, recurrence_count = ?, updated_at = datetime('now')
     WHERE id = ?`
  );
  const insertOccurrence = db.prepare(
    `INSERT INTO appointments
       (id, patient_id, doctor_id, scheduled_at, reason, status, recurrence_group_id, recurrence_rule, recurrence_index, recurrence_count)
     VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`
  );

  const created = db.transaction(() => {
    updateFirst.run(groupId, input.rule, count, first.id);
    let cursor = new Date(first.scheduled_at as string);
    for (let i = 2; i <= count; i++) {
      cursor = addRecurrenceInterval(cursor, input.rule);
      insertOccurrence.run(randomUUID(), first.patient_id, first.doctor_id, cursor.toISOString(), first.reason, groupId, input.rule, i, count);
    }
  });
  created();

  return db
    .prepare(`SELECT a.*, p.full_name AS patient_name FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.recurrence_group_id = ? ORDER BY a.recurrence_index ASC`)
    .all(groupId) as Appointment[];
}

// Confirmed appointments scheduled 20-28h from now that haven't had a
// reminder sent yet — the reminder sweep (see reminders.ts) runs every 15
// minutes, so this ~8h-wide window guarantees every appointment gets
// exactly one reminder somewhere around the 24h mark even if a run is
// occasionally delayed, without ever sending two.
export function listAppointmentsNeedingReminder(): Appointment[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT a.*, p.full_name AS patient_name, p.phone_number, p.email, d.full_name AS doctor_name, h.name AS hospital_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
       LEFT JOIN hospitals h ON h.id = d.hospital_id
       WHERE a.status = 'confirmed'
         AND a.reminder_sent_at IS NULL
         AND a.scheduled_at BETWEEN datetime('now', '+20 hours') AND datetime('now', '+28 hours')`
    )
    .all() as (Appointment & { phone_number: string; email: string | null })[];
}

export function markReminderSent(id: string): void {
  const db = getDb();
  db.prepare(`UPDATE appointments SET reminder_sent_at = datetime('now') WHERE id = ?`).run(id);
}

// Doctors on a given hospital, or all doctors if the patient has no
// hospital preference on file — used to populate the "choose a doctor"
// picker when a patient books an appointment.
export function listDoctorsForBooking(): { id: string; full_name: string; specialization: string | null; hospital_name: string | null }[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT d.id, d.full_name, d.specialization, h.name AS hospital_name
       FROM doctors d
       LEFT JOIN hospitals h ON h.id = d.hospital_id
       WHERE d.is_active = 1
       ORDER BY h.name, d.full_name`
    )
    .all() as { id: string; full_name: string; specialization: string | null; hospital_name: string | null }[];
}

// ---------- Appointment waitlist ----------

export function joinWaitlist(input: { patientId: string; doctorId: string; reason: string | null }): AppointmentWaitlistEntry {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO appointment_waitlist (id, patient_id, doctor_id, reason, status) VALUES (?, ?, ?, ?, 'waiting')`
  ).run(id, input.patientId, input.doctorId, input.reason);
  return findWaitlistEntryById(id)!;
}

export function findWaitlistEntryById(id: string): AppointmentWaitlistEntry | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT w.*, d.full_name AS doctor_name, p.full_name AS patient_name
       FROM appointment_waitlist w
       JOIN doctors d ON d.id = w.doctor_id
       JOIN patients p ON p.id = w.patient_id
       WHERE w.id = ?`
    )
    .get(id) as AppointmentWaitlistEntry | undefined;
}

// Oldest-first — first come, first offered, matching how a real waitlist
// works. Only 'waiting' entries: once a doctor has offered or booked a
// slot, or the patient's cancelled, it drops off the active queue (still
// readable via the patient's own list, just not here).
export function listWaitlistForDoctor(doctorId: string): AppointmentWaitlistEntry[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT w.*, p.full_name AS patient_name
       FROM appointment_waitlist w
       JOIN patients p ON p.id = w.patient_id
       WHERE w.doctor_id = ? AND w.status = 'waiting'
       ORDER BY w.created_at ASC`
    )
    .all(doctorId) as AppointmentWaitlistEntry[];
}

export function listWaitlistForPatient(patientId: string): AppointmentWaitlistEntry[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT w.*, d.full_name AS doctor_name
       FROM appointment_waitlist w
       JOIN doctors d ON d.id = w.doctor_id
       WHERE w.patient_id = ? AND w.status IN ('waiting','offered')
       ORDER BY w.created_at DESC`
    )
    .all(patientId) as AppointmentWaitlistEntry[];
}

export function cancelWaitlistEntry(id: string): void {
  const db = getDb();
  db.prepare(`UPDATE appointment_waitlist SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(id);
}

// A doctor turning a waitlist entry into a real, already-confirmed
// appointment for that patient — one action instead of the patient having
// to separately request one and the doctor separately confirming it, since
// the whole point of a waitlist is the doctor already knows this patient
// wants the next open slot.
export function offerWaitlistSlot(waitlistId: string, scheduledAtIso: string): Appointment {
  const db = getDb();
  const entry = findWaitlistEntryById(waitlistId);
  if (!entry) throw new Error("Waitlist entry not found.");

  const appointmentId = randomUUID();
  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO appointments (id, patient_id, doctor_id, scheduled_at, reason, status)
       VALUES (?, ?, ?, ?, ?, 'confirmed')`
    ).run(appointmentId, entry.patient_id, entry.doctor_id, scheduledAtIso, entry.reason);
    db.prepare(
      `UPDATE appointment_waitlist SET status = 'booked', offered_appointment_id = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(appointmentId, waitlistId);
  });
  create();

  return findAppointmentById(appointmentId)!;
}

// ---------- Risk assessments (see lib/risk-scoring.ts) ----------

export function saveRiskAssessment(input: {
  patientId: string;
  medicalRecordId: string | null;
  context: RiskContext;
  riskLevel: RiskLevel;
  riskScore: number;
  factors: string[];
}): RiskAssessment {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO risk_assessments (id, patient_id, medical_record_id, context, risk_level, risk_score, factors)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.patientId,
    input.medicalRecordId,
    input.context,
    input.riskLevel,
    input.riskScore,
    JSON.stringify(input.factors)
  );
  return db.prepare("SELECT * FROM risk_assessments WHERE id = ?").get(id) as RiskAssessment;
}

export function getLatestRiskAssessment(patientId: string): RiskAssessment | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM risk_assessments WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(patientId) as RiskAssessment | undefined;
}

export function listRiskAssessmentsForPatient(patientId: string): RiskAssessment[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM risk_assessments WHERE patient_id = ? ORDER BY created_at DESC")
    .all(patientId) as RiskAssessment[];
}

// ---------- Proactive follow-up agents ----------

export function createFollowupAgent(input: {
  patientId: string;
  doctorId: string;
  pathology: string;
  questions: string; // JSON string of FollowupQuestion[]
  frequencyDays: number;
}): FollowupAgent {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO followup_agents (id, patient_id, doctor_id, pathology, questions, frequency_days, next_checkin_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(id, input.patientId, input.doctorId, input.pathology, input.questions, input.frequencyDays);
  return db.prepare("SELECT * FROM followup_agents WHERE id = ?").get(id) as FollowupAgent;
}

export function findFollowupAgentById(id: string): FollowupAgent | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM followup_agents WHERE id = ?").get(id) as FollowupAgent | undefined;
}

// Only agents belonging to this doctor — used to enforce ownership before
// any doctor-side mutation (status change, viewing check-ins).
export function findFollowupAgentForDoctor(id: string, doctorId: string): FollowupAgent | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM followup_agents WHERE id = ? AND doctor_id = ?")
    .get(id, doctorId) as FollowupAgent | undefined;
}

export function listFollowupAgentsForDoctor(doctorId: string): FollowupAgent[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT fa.*, p.full_name AS patient_name
       FROM followup_agents fa JOIN patients p ON p.id = fa.patient_id
       WHERE fa.doctor_id = ? ORDER BY fa.created_at DESC`
    )
    .all(doctorId) as FollowupAgent[];
}

export function listFollowupAgentsForPatient(patientId: string): FollowupAgent[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT fa.*, d.full_name AS doctor_name
       FROM followup_agents fa JOIN doctors d ON d.id = fa.doctor_id
       WHERE fa.patient_id = ? ORDER BY fa.created_at DESC`
    )
    .all(patientId) as FollowupAgent[];
}

export function updateFollowupAgentStatus(id: string, status: FollowupAgentStatus): FollowupAgent {
  const db = getDb();
  db.prepare("UPDATE followup_agents SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  return db.prepare("SELECT * FROM followup_agents WHERE id = ?").get(id) as FollowupAgent;
}

// Agents the scheduler sweep (lib/followup-agent.ts) should send a new
// check-in prompt for right now.
export function listFollowupAgentsDueForCheckin(): FollowupAgent[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT fa.*, p.full_name AS patient_name, p.phone_number, p.email
       FROM followup_agents fa JOIN patients p ON p.id = fa.patient_id
       WHERE fa.status = 'active' AND fa.next_checkin_at <= datetime('now')`
    )
    .all() as (FollowupAgent & { phone_number: string; email: string | null })[];
}

export function advanceFollowupAgentSchedule(agentId: string, frequencyDays: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE followup_agents
     SET last_checkin_at = datetime('now'), next_checkin_at = datetime('now', '+' || ? || ' days'), updated_at = datetime('now')
     WHERE id = ?`
  ).run(frequencyDays, agentId);
}

export function createFollowupCheckin(agentId: string, patientId: string): FollowupCheckin {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`INSERT INTO followup_checkins (id, agent_id, patient_id) VALUES (?, ?, ?)`).run(id, agentId, patientId);
  return db.prepare("SELECT * FROM followup_checkins WHERE id = ?").get(id) as FollowupCheckin;
}

export function findFollowupCheckinById(id: string): FollowupCheckin | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM followup_checkins WHERE id = ?").get(id) as FollowupCheckin | undefined;
}

// Only a checkin that (a) belongs to this patient and (b) is still pending
// can be responded to — prevents re-answering a completed checkin or
// answering someone else's.
export function findPendingCheckinForPatient(id: string, patientId: string): FollowupCheckin | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM followup_checkins WHERE id = ? AND patient_id = ? AND status = 'pending'")
    .get(id, patientId) as FollowupCheckin | undefined;
}

export function listPendingCheckinsForPatient(patientId: string): FollowupCheckin[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT fc.*, fa.pathology, fa.questions
       FROM followup_checkins fc JOIN followup_agents fa ON fa.id = fc.agent_id
       WHERE fc.patient_id = ? AND fc.status = 'pending' ORDER BY fc.sent_at ASC`
    )
    .all(patientId) as (FollowupCheckin & { questions: string })[];
}

export function submitFollowupCheckin(input: {
  id: string;
  responses: Record<string, string>;
  riskFlag: FollowupRiskFlag;
  aiSummary: string | null;
}): FollowupCheckin {
  const db = getDb();
  db.prepare(
    `UPDATE followup_checkins
     SET status = 'completed', responses = ?, risk_flag = ?, ai_summary = ?, responded_at = datetime('now')
     WHERE id = ?`
  ).run(JSON.stringify(input.responses), input.riskFlag, input.aiSummary, input.id);
  return db.prepare("SELECT * FROM followup_checkins WHERE id = ?").get(input.id) as FollowupCheckin;
}

export function listCheckinsForAgent(agentId: string): FollowupCheckin[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM followup_checkins WHERE agent_id = ? ORDER BY sent_at DESC")
    .all(agentId) as FollowupCheckin[];
}

// Unacknowledged concerning check-ins across every agent this doctor owns
// — the "needs attention" list on the doctor follow-ups page.
export function listFollowupAlertsForDoctor(doctorId: string): FollowupCheckin[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT fc.*, p.full_name AS patient_name, fa.pathology
       FROM followup_checkins fc
       JOIN followup_agents fa ON fa.id = fc.agent_id
       JOIN patients p ON p.id = fc.patient_id
       WHERE fa.doctor_id = ? AND fc.risk_flag IN ('concern','urgent') AND fc.doctor_alerted_at IS NULL
       ORDER BY fc.responded_at DESC`
    )
    .all(doctorId) as FollowupCheckin[];
}

// Ownership-scoped: only marks the alert acknowledged if it actually
// belongs to an agent this doctor owns.
export function acknowledgeFollowupAlert(checkinId: string, doctorId: string): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE followup_checkins
       SET doctor_alerted_at = datetime('now')
       WHERE id = ? AND agent_id IN (SELECT id FROM followup_agents WHERE doctor_id = ?)`
    )
    .run(checkinId, doctorId);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Self-service booking — patient-submitted registration requests.
//
// Nothing here writes to `patients` until a doctor approves (see
// approvePatientRegistration below). That gate is the whole point: without it,
// anyone could create a PulseID for any National ID and attach fabricated
// history to a real person's medical record.
// ---------------------------------------------------------------------------

// Local whole-years-old helper (server.ts has its own ageInYears; this one is
// needed here because approvePatientRegistration has to derive CNIC vs B-Form
// from the DOB the patient supplied, inside the transaction).
function ageInYearsForRepo(dateOfBirth: string, atDate = new Date()): number {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return 0;
  let age = atDate.getFullYear() - dob.getFullYear();
  const beforeBirthdayThisYear =
    atDate.getMonth() < dob.getMonth() ||
    (atDate.getMonth() === dob.getMonth() && atDate.getDate() < dob.getDate());
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}

// `r.*` prefixed so it can be reused across the three different FROM/JOIN
// shapes below; the doctor name is joined in (never stored twice).
const REGISTRATION_COLUMNS = `
  r.id, r.national_id, r.full_name, r.date_of_birth, r.gender, r.phone_number,
  r.email, r.address, r.blood_group, r.allergies, r.chronic_conditions,
  r.weight_kg, r.pediatrician_name, r.pediatrician_phone, r.doctor_id,
  r.reason, r.contacts, r.status, r.patient_id, r.matched_patient_id, r.appointment_id,
  r.reviewed_by, r.reviewed_at, r.created_at, d.full_name AS doctor_name,
  (SELECT COUNT(*) FROM registration_attachments a WHERE a.registration_id = r.id)
    AS attachment_count
`;

export function createPatientRegistration(input: {
  nationalId: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  phoneNumber: string;
  email?: string | null;
  address?: string | null;
  bloodGroup: string;
  allergies?: string | null;
  chronicConditions?: string | null;
  weightKg?: number | null;
  pediatricianName?: string | null;
  pediatricianPhone?: string | null;
  doctorId: string;
  reason?: string | null;
  contacts?: unknown[] | null;
  // Set when the National ID already belongs to a registered patient — see
  // PatientRegistration.matched_patient_id.
  matchedPatientId?: string | null;
}): PatientRegistration {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO patient_registrations
       (id, national_id, full_name, date_of_birth, gender, phone_number, email, address,
        blood_group, allergies, chronic_conditions, weight_kg, pediatrician_name,
        pediatrician_phone, doctor_id, reason, contacts, matched_patient_id, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending')`
  ).run(
    id,
    input.nationalId,
    input.fullName,
    input.dateOfBirth,
    input.gender,
    input.phoneNumber,
    input.email || null,
    input.address || null,
    input.bloodGroup,
    input.allergies || null,
    input.chronicConditions || null,
    input.weightKg ?? null,
    input.pediatricianName || null,
    input.pediatricianPhone || null,
    input.doctorId,
    input.reason || null,
    input.contacts ? JSON.stringify(input.contacts) : null,
    input.matchedPatientId || null
  );
  return findRegistrationById(id) as PatientRegistration;
}

export function createRegistrationAttachment(input: {
  registrationId: string;
  storedName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}): RegistrationAttachment {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO registration_attachments
       (id, registration_id, stored_name, original_name, mime_type, size_bytes)
     VALUES (?,?,?,?,?,?)`
  ).run(id, input.registrationId, input.storedName, input.originalName, input.mimeType, input.sizeBytes);
  return db.prepare("SELECT * FROM registration_attachments WHERE id = ?").get(id) as RegistrationAttachment;
}

export function getRegistrationAttachments(registrationId: string): RegistrationAttachment[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM registration_attachments WHERE registration_id = ? ORDER BY created_at ASC")
    .all(registrationId) as RegistrationAttachment[];
}

export function findRegistrationAttachmentById(id: string): RegistrationAttachment | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM registration_attachments WHERE id = ?").get(id) as
    | RegistrationAttachment
    | undefined;
}

export function findRegistrationById(id: string): PatientRegistration | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT ${REGISTRATION_COLUMNS}
       FROM patient_registrations r
       LEFT JOIN doctors d ON d.id = r.doctor_id
       WHERE r.id = ?`
    )
    .get(id) as PatientRegistration | undefined;
}

// Ownership-scoped, exactly like findFollowupAgentForDoctor — a doctor can only
// read or act on requests addressed to them, never on another doctor's.
export function findRegistrationForDoctor(id: string, doctorId: string): PatientRegistration | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT ${REGISTRATION_COLUMNS}
       FROM patient_registrations r
       LEFT JOIN doctors d ON d.id = r.doctor_id
       WHERE r.id = ? AND r.doctor_id = ?`
    )
    .get(id, doctorId) as PatientRegistration | undefined;
}

export function listRegistrationsForDoctor(
  doctorId: string,
  statusFilter?: RegistrationStatus
): PatientRegistration[] {
  const db = getDb();
  const params: (string | undefined)[] = [doctorId];
  let where = "r.doctor_id = ?";
  if (statusFilter) {
    where += " AND r.status = ?";
    params.push(statusFilter);
  }
  return db
    .prepare(
      `SELECT ${REGISTRATION_COLUMNS}
       FROM patient_registrations r
       LEFT JOIN doctors d ON d.id = r.doctor_id
       WHERE ${where}
       ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                r.created_at DESC`
    )
    .all(...params) as PatientRegistration[];
}

export function countPendingRegistrationsForDoctor(doctorId: string): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM patient_registrations WHERE doctor_id = ? AND status = 'pending'")
    .get(doctorId) as { n: number };
  return row.n;
}

// Anti-spam: one open (pending) request per National ID per doctor. Without it
// this public, unauthenticated submit endpoint could bury a doctor's queue
// with duplicate rows for the same person.
export function hasPendingRegistrationForDoctor(nationalId: string, doctorId: string): boolean {
  const db = getDb();
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM patient_registrations WHERE national_id = ? AND doctor_id = ? AND status = 'pending'"
      )
      .get(nationalId, doctorId)
  );
}

/**
 * The gate. Turns an unverified patient submission into a real Patient plus a
 * confirmed appointment with the requesting doctor, in a SINGLE transaction —
 * so a failure part-way through can never leave a patient created while the
 * registration is still pending, which would make the request permanently
 * un-approvable (nationalIdExists would then refuse the retry).
 *
 * Re-checks nationalIdExists here rather than trusting the submit-time check:
 * a doctor may have registered that National ID in the meantime, and if that
 * race is lost it's the patient who ends up with the wrong outcome.
 *
 * Mirrors the doctor-side POST /api/patients path (create patient +
 * registration medical_record), plus the appointment.
 */
export function approvePatientRegistration(input: {
  registrationId: string;
  doctorId: string;
  doctorName: string;
  scheduledAtIso: string;
}): { registration: PatientRegistration; patientId: string; appointmentId: string } {
  const db = getDb();

  const run = db.transaction((): { patientId: string; appointmentId: string } => {
    const reg = findRegistrationForDoctor(input.registrationId, input.doctorId);
    if (!reg) throw new Error("NOT_FOUND");
    if (reg.status !== "pending") throw new Error("ALREADY_REVIEWED");

    // Someone who is already registered can book a follow-up through the same
    // public form. matched_patient_id recorded that at submit time; re-resolve
    // it here so a patient deleted in the meantime falls back to being treated
    // as a new registration rather than booking onto a missing record.
    const existingPatient = reg.matched_patient_id
      ? findPatientById(reg.matched_patient_id)
      : undefined;

    // Only refuse when we have no existing record to book onto. This still
    // catches the genuine race the check was written for: a request submitted
    // before the patient existed, where someone registered that ID in between.
    if (!existingPatient && nationalIdExists(reg.national_id)) throw new Error("NATIONAL_ID_TAKEN");

    // A CNIC is the adult document, a B-Form the minor one — same 13-digit
    // shape, so it has to be derived from the DOB the patient supplied, which
    // the doctor can see and correct before approving.
    const idType = ageInYearsForRepo(reg.date_of_birth) < 18 ? "b_form" : "cnic";

    let patient: Patient;
    if (existingPatient) {
      // A follow-up for someone who already has a file. Their record is
      // deliberately left exactly as it is — this request is not allowed to
      // overwrite a name, phone number, allergies or emergency contacts that a
      // clinician may already be relying on. Anything the patient re-typed here
      // is ignored on purpose; the doctor can still correct their record
      // through the normal edit form if it's genuinely out of date.
      patient = existingPatient;
    } else {
      patient = createPatient({
        nationalId: reg.national_id,
        idType,
        fullName: reg.full_name,
        dateOfBirth: reg.date_of_birth,
        gender: reg.gender,
        phoneNumber: reg.phone_number,
        email: reg.email,
        address: reg.address,
        bloodGroup: reg.blood_group as BloodGroup,
        allergies: reg.allergies,
        chronicConditions: reg.chronic_conditions,
        weightKg: reg.weight_kg,
        pediatricianName: reg.pediatrician_name,
        pediatricianPhone: reg.pediatrician_phone,
      });
    }

    // Contacts were collected up front (a minor can't be registered without a
    // parent/guardian reachable), but emergency_contacts has a patient_id FK
    // and no patient existed until this moment — so they're replayed here.
    // Skipped entirely for an existing patient: they already have real
    // contacts on file and re-adding these would create duplicates.
    let contacts: { fullName?: string; phoneNumber?: string; relationshipType?: string }[] = [];
    if (!existingPatient) {
      try {
        const parsed = reg.contacts ? JSON.parse(reg.contacts) : [];
        if (Array.isArray(parsed)) contacts = parsed;
      } catch {
        contacts = [];
      }
      let primarySet = false;
      for (const c of contacts) {
        const name = typeof c?.fullName === "string" ? c.fullName.trim() : "";
        const phone = typeof c?.phoneNumber === "string" ? c.phoneNumber.trim() : "";
        const rel = typeof c?.relationshipType === "string" ? c.relationshipType.trim() : "";
        if (!name || !phone || !rel) continue;
        addEmergencyContact({
          patientId: patient.id,
          fullName: name,
          relationshipType: rel,
          phoneNumber: phone,
          isPrimary: !primarySet,
        });
        primarySet = true;
      }

      // Registration is a real encounter, so it needs a medical_records row —
      // that's what makes the patient's visit timeline start with the
      // registration itself instead of being empty until their next recorded
      // visit. An existing patient is not registering again, so they get no
      // second 'registration' record — the appointment below is the encounter.
      createMedicalRecord({
        patientId: patient.id,
        doctorId: input.doctorId,
        recordType: "registration",
        visitDate: new Date().toISOString().slice(0, 10),
        diagnosis: "",
        symptoms: "",
        notes: `Self-service booking request approved by ${input.doctorName}`,
      });
    }

    // createAppointment always inserts with a NULL scheduled_at and status
    // 'requested'; setting the slot is a separate doctor-authorised step. The
    // exact same two-step the doctor appointment-queue confirm route uses, so
    // patients still never pick their own time — they submit a request that
    // this doctor is now answering.
    const appointment = createAppointment({
      patientId: patient.id,
      doctorId: input.doctorId,
      reason: reg.reason,
    });
    setAppointmentSchedule(appointment.id, input.scheduledAtIso, "confirmed");

    db.prepare(
      `UPDATE patient_registrations
       SET status = 'approved', patient_id = ?, appointment_id = ?,
           reviewed_by = ?, reviewed_at = datetime('now')
       WHERE id = ?`
    ).run(patient.id, appointment.id, input.doctorName, input.registrationId);

    // Uploaded reports become the patient's own documents at the moment the
    // booking is approved. Their RAG chunks (indexed at booking time) are
    // re-parented right after this transaction commits, via the RAG service
    // (lib/rag.ts reparentRagIndex, called from the allocate route) — the
    // vector index now lives outside this database.
    db.prepare(
      `UPDATE registration_attachments SET patient_id = ? WHERE registration_id = ?`
    ).run(patient.id, reg.id);

    return { patientId: patient.id, appointmentId: appointment.id };
  });

  const { patientId, appointmentId } = run();
  const registration = findRegistrationById(input.registrationId) as PatientRegistration;
  return { registration, patientId, appointmentId };
}

export function rejectPatientRegistration(id: string, doctorId: string, doctorName: string): boolean {
  const db = getDb();
  const reg = findRegistrationForDoctor(id, doctorId);
  if (!reg) return false;
  db.prepare(
    `UPDATE patient_registrations
     SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now')
     WHERE id = ?`
  ).run(doctorName, id);
  return true;
}

// Rejection makes the submission worthless, and the bytes are the only part of a
// pending request that can't just be un-inserted — remove them so a rejected
// patient's uploaded reports don't sit on disk indefinitely. A file that's
// already gone is ignored: the metadata row is the source of truth and a
// missing file shouldn't fail the whole reject.
export function purgeRegistrationAttachments(registrationId: string, uploadDir: string): number {
  const db = getDb();
  const attachments = getRegistrationAttachments(registrationId);
  let removed = 0;
  for (const a of attachments) {
    // stored_name is server-generated by multer's random filename, never
    // derived from user input, so this join cannot escape uploadDir.
    const full = path.join(uploadDir, a.stored_name);
    try {
      if (fs.existsSync(full)) {
        fs.rmSync(full);
        removed++;
      }
    } catch (err) {
      console.error(`[pulseid-backend] Could not remove attachment ${a.stored_name}:`, err);
    }
  }
  db.prepare("DELETE FROM registration_attachments WHERE registration_id = ?").run(registrationId);
  return removed;
}

// ---------------------------------------------------------------------------
// Uploaded reports after approval and the notification feed. The RAG vector
// index lives in the Python service (backend/rag) — this file no longer
// persists chunk rows.
// ---------------------------------------------------------------------------

export function findMedicalRecordById(id: string): MedicalRecord | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM medical_records WHERE id = ?").get(id) as MedicalRecord | undefined;
}

// Prescriptions written as part of one specific visit — the visit chunk text
// includes them, and the AI-drafted report finalize flow appends new ones.
export function listPrescriptionsForRecord(medicalRecordId: string): Prescription[] {
  const db = getDb();
  // prescriptions has no created_at column; issued_date + rowid is the order.
  return db
    .prepare("SELECT * FROM prescriptions WHERE medical_record_id = ? ORDER BY issued_date ASC, rowid ASC")
    .all(medicalRecordId) as Prescription[];
}

// Doctor-side finalize of an AI-drafted report: the visit's clinical text is
// replaced by the (doctor-reviewed) full report. Diagnosis stays a single
// field, so the full drafted text lives in notes.
export function finalizeMedicalRecord(
  id: string,
  input: { diagnosis: string; notes: string }
): MedicalRecord | undefined {
  const db = getDb();
  db.prepare(`UPDATE medical_records SET diagnosis = ?, notes = ? WHERE id = ?`).run(
    input.diagnosis,
    input.notes,
    id
  );
  return findMedicalRecordById(id);
}

export function createPrescription(input: {
  patientId: string;
  doctorId: string;
  medicalRecordId: string | null;
  medications: Medication[];
  instructions: string | null;
  issuedDate: string;
}): Prescription {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO prescriptions (id, patient_id, doctor_id, medical_record_id, medications, instructions, issued_date)
     VALUES (?,?,?,?,?,?,?)`
  ).run(
    id,
    input.patientId,
    input.doctorId,
    input.medicalRecordId,
    JSON.stringify(input.medications),
    input.instructions,
    input.issuedDate
  );
  return db.prepare("SELECT * FROM prescriptions WHERE id = ?").get(id) as Prescription;
}

// A finalized report replaces the visit's prescriptions entirely — a
// re-finalize (doctor edits a sent report) must not stack duplicate
// medication rows for the same visit.
export function deletePrescriptionsForRecord(medicalRecordId: string): void {
  getDb().prepare("DELETE FROM prescriptions WHERE medical_record_id = ?").run(medicalRecordId);
}

// ---------- Uploaded reports after approval ----------

export function listAttachmentsForPatient(patientId: string): RegistrationAttachment[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM registration_attachments WHERE patient_id = ? ORDER BY created_at ASC")
    .all(patientId) as RegistrationAttachment[];
}

// ---------- In-app patient notifications ----------

export function createNotification(input: {
  patientId: string;
  type: Notification["type"];
  title: string;
  body: string;
  link?: string | null;
}): Notification {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO notifications (id, patient_id, type, title, body, link) VALUES (?,?,?,?,?,?)`
  ).run(id, input.patientId, input.type, input.title, input.body, input.link ?? null);
  return db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as Notification;
}

export function listNotificationsForPatient(patientId: string, limit = 20): Notification[] {
  const db = getDb();
  return db
    // rowid breaks ties for notifications created in the same second —
    // a random-UUID tiebreak would order them nondeterministically.
    .prepare("SELECT * FROM notifications WHERE patient_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(patientId, limit) as Notification[];
}

export function countUnreadNotificationsForPatient(patientId: string): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM notifications WHERE patient_id = ? AND is_read = 0")
    .get(patientId) as { n: number };
  return row.n;
}

// Ownership-scoped: a patient can only ever mark their own notification read.
export function markNotificationRead(id: string, patientId: string): boolean {
  const db = getDb();
  const result = db
    .prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND patient_id = ?")
    .run(id, patientId);
  return result.changes > 0;
}

export function markAllNotificationsRead(patientId: string): void {
  const db = getDb();
  db.prepare("UPDATE notifications SET is_read = 1 WHERE patient_id = ?").run(patientId);
}
