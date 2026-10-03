/* eslint-disable */
// Creates the SQLite schema (if missing) and seeds demo data (if empty).
// Safe to run repeatedly. Run with --force to wipe and reseed.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "pulseid.db");
const force = process.argv.includes("--force");

if (force && fs.existsSync(DB_PATH)) {
  fs.rmSync(DB_PATH);
  for (const ext of ["-wal", "-shm"]) {
    if (fs.existsSync(DB_PATH + ext)) fs.rmSync(DB_PATH + ext);
  }
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS hospitals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  province TEXT
);

CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  license_number TEXT UNIQUE NOT NULL,
  specialization TEXT,
  hospital_id TEXT REFERENCES hospitals(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A hospital-admin login is scoped to exactly one hospital_id and manages
-- only the doctors at that hospital (see /api/hospital-admin/* routes in
-- server.ts). Peer of doctor auth, not a variant of analyst auth: same
-- bcrypt hash + JWT session pattern as doctors, its own cookie/session type.
CREATE TABLE IF NOT EXISTS hospital_admins (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  hospital_id TEXT NOT NULL REFERENCES hospitals(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hospital_admins_hospital ON hospital_admins(hospital_id);

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  national_id TEXT UNIQUE NOT NULL,
  id_type TEXT NOT NULL DEFAULT 'cnic',
  full_name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  gender TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  email TEXT,
  address TEXT,
  blood_group TEXT NOT NULL DEFAULT 'unknown',
  allergies TEXT,
  chronic_conditions TEXT,
  weight_kg REAL,
  pediatrician_name TEXT,
  pediatrician_phone TEXT,
  guardian_patient_id TEXT REFERENCES patients(id),
  password_hash TEXT,
  emergency_qr_token TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emergency_contacts (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS medical_records (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id TEXT REFERENCES doctors(id),
  record_type TEXT NOT NULL DEFAULT 'checkup',
  visit_date TEXT NOT NULL,
  diagnosis TEXT,
  symptoms TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_medical_records_patient ON medical_records(patient_id);

CREATE TABLE IF NOT EXISTS prescriptions (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id TEXT REFERENCES doctors(id),
  medical_record_id TEXT REFERENCES medical_records(id),
  medications TEXT NOT NULL,
  instructions TEXT,
  issued_date TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  patient_id TEXT REFERENCES patients(id),
  actor_role TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_patient ON audit_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_role, actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS otp_codes (
  national_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

-- Every OTP send (not just the currently-active code) gets a row here, so
-- the per-national-ID daily send cap in repo.ts can count sends over a
-- rolling 24h window even though otp_codes only ever keeps the latest code.
CREATE TABLE IF NOT EXISTS otp_send_log (
  id TEXT PRIMARY KEY,
  national_id TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_otp_send_log_national_id ON otp_send_log(national_id, sent_at);
`);

// ---- Migrations: add columns that support QR rotation to DBs created before this feature ----
const patientColumns = db.prepare("PRAGMA table_info(patients)").all().map((c) => c.name);
if (!patientColumns.includes("qr_rotated_at")) {
  db.exec("ALTER TABLE patients ADD COLUMN qr_rotated_at TEXT");
}
if (!patientColumns.includes("qr_rotation_count")) {
  db.exec("ALTER TABLE patients ADD COLUMN qr_rotation_count INTEGER NOT NULL DEFAULT 0");
}
// qr_is_static: patients whose emergency_qr_token is bound to a physically
// printed card (e.g. a laminated ID / wristband QR) instead of the in-app
// live QR page. The physical artwork can't change itself after printing, so
// for these patients the token is deliberately exempt from the rotate-on-scan
// policy below — every other patient still gets a fresh token on every read.
if (!patientColumns.includes("qr_is_static")) {
  db.exec("ALTER TABLE patients ADD COLUMN qr_is_static INTEGER NOT NULL DEFAULT 0");
}
const doctorColumns = db.prepare("PRAGMA table_info(doctors)").all().map((c) => c.name);
if (!doctorColumns.includes("is_active")) {
  db.exec("ALTER TABLE doctors ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
}
const otpColumns = db.prepare("PRAGMA table_info(otp_codes)").all().map((c) => c.name);
if (!otpColumns.includes("attempts")) {
  db.exec("ALTER TABLE otp_codes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
}
// id_type: NADRA issues a 13-digit CNIC (#####-#######-#) at 18, and the
// same-format B-Form number to children under 18. Both live in the
// existing national_id column (same shape, same uniqueness rules) — this
// column just records which kind of card it is, so the UI can label it
// correctly and doctors/first-responders know a "B-Form" scan means a minor.
// Backfilled to 'cnic' for any pre-existing rows, which were all adults.
if (!patientColumns.includes("id_type")) {
  db.exec("ALTER TABLE patients ADD COLUMN id_type TEXT NOT NULL DEFAULT 'cnic'");
}
// Pediatric-care fields, mainly useful for minors: weight for emergency drug
// dosing, and a pediatrician's contact for a first responder or ER doctor to
// call. Optional and nullable for every patient — adults simply won't have
// them filled in.
if (!patientColumns.includes("weight_kg")) {
  db.exec("ALTER TABLE patients ADD COLUMN weight_kg REAL");
}
if (!patientColumns.includes("pediatrician_name")) {
  db.exec("ALTER TABLE patients ADD COLUMN pediatrician_name TEXT");
}
if (!patientColumns.includes("pediatrician_phone")) {
  db.exec("ALTER TABLE patients ADD COLUMN pediatrician_phone TEXT");
}
// guardian_patient_id: links a minor's record to a parent/guardian's own
// PulseID account (if the guardian has one), so they can see the child
// from their own login instead of only being a phone-number contact.
// Nullable — most minors won't have this set until a doctor or the
// guardian themselves establishes the link.
if (!patientColumns.includes("guardian_patient_id")) {
  db.exec("ALTER TABLE patients ADD COLUMN guardian_patient_id TEXT REFERENCES patients(id)");
}
// Vitals are optional per-visit (nullable) — only used when a doctor fills
// them in, and only then does the backend compute a risk_assessments row.
const medicalRecordColumns = db.prepare("PRAGMA table_info(medical_records)").all().map((c) => c.name);
if (!medicalRecordColumns.includes("systolic_bp")) {
  db.exec("ALTER TABLE medical_records ADD COLUMN systolic_bp INTEGER");
}
if (!medicalRecordColumns.includes("diastolic_bp")) {
  db.exec("ALTER TABLE medical_records ADD COLUMN diastolic_bp INTEGER");
}
if (!medicalRecordColumns.includes("blood_sugar_mmol")) {
  db.exec("ALTER TABLE medical_records ADD COLUMN blood_sugar_mmol REAL");
}
if (!medicalRecordColumns.includes("body_temp_c")) {
  db.exec("ALTER TABLE medical_records ADD COLUMN body_temp_c REAL");
}
if (!medicalRecordColumns.includes("heart_rate_bpm")) {
  db.exec("ALTER TABLE medical_records ADD COLUMN heart_rate_bpm INTEGER");
}

db.exec(`
CREATE TABLE IF NOT EXISTS qr_rotation_log (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  rotated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qr_rotation_log_patient ON qr_rotation_log(patient_id);

-- A guardian's self-service request to be linked to a minor's record.
-- Auto-approved on the backend when the guardian's phone number already
-- matches a Parent/Guardian emergency contact on file for that minor;
-- otherwise sits here until a doctor approves or rejects it.
CREATE TABLE IF NOT EXISTS guardian_link_requests (
  id TEXT PRIMARY KEY,
  minor_patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  guardian_patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_guardian_requests_minor ON guardian_link_requests(minor_patient_id);
CREATE INDEX IF NOT EXISTS idx_guardian_requests_guardian ON guardian_link_requests(guardian_patient_id);

-- Tracks the last time each doctor opened each patient's chart, so the
-- dashboard can offer a "Recently viewed" quick-access list. Upserted on
-- every chart open; not a full audit trail (that's audit_logs) — just a
-- per-doctor MRU cache, so it only ever holds one row per (doctor, patient).
CREATE TABLE IF NOT EXISTS doctor_recent_patients (
  doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (doctor_id, patient_id)
);
CREATE INDEX IF NOT EXISTS idx_doctor_recent_patients_doctor ON doctor_recent_patients(doctor_id, viewed_at DESC);

-- Appointment requests. A patient requests a doctor and a reason only —
-- they never choose the date/time. scheduled_at starts NULL and is set by
-- the doctor/clinic when they confirm (or later change via reschedule).
-- 'requested' -> 'confirmed' -> 'completed' is the happy path; either side
-- can move it to 'cancelled' from 'requested' or 'confirmed'. reason is the
-- patient's free-text reason for the visit; doctor_notes is filled in on
-- completion/cancellation.
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  scheduled_at TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','completed','cancelled')),
  doctor_notes TEXT,
  reminder_sent_at TEXT,
  recurrence_group_id TEXT,
  recurrence_rule TEXT,
  recurrence_index INTEGER,
  recurrence_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id, scheduled_at ASC);
CREATE INDEX IF NOT EXISTS idx_appointments_reminder ON appointments(status, scheduled_at) WHERE reminder_sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_recurrence ON appointments(recurrence_group_id);

-- A patient can ask to be notified when a slot opens with a given doctor,
-- instead of (or in addition to) a normal appointment request — mainly for
-- fully-booked doctors. 'offered' means a doctor picked a slot for them but
-- the patient hasn't been marked booked yet; offered_appointment_id points
-- at the appointment created for that offer once one exists.
CREATE TABLE IF NOT EXISTS appointment_waitlist (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','booked','cancelled')),
  offered_appointment_id TEXT REFERENCES appointments(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_waitlist_doctor ON appointment_waitlist(doctor_id, status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_waitlist_patient ON appointment_waitlist(patient_id, status);

-- AI-drafted epidemiological bulletins. Written by the analytics service
-- (scheduled weekly/monthly, or generated on demand), always created as
-- 'draft' — an analyst has to explicitly approve one before it counts as
-- published. The backend never generates content itself; it only stores
-- what the analytics service posts here.
-- One row per rule-based risk score run (see lib/risk-scoring.ts), usually
-- triggered when a doctor adds a visit with vitals attached. Kept as full
-- history, not a single "current risk" column, so trends over time are
-- visible to both the doctor and the patient.
CREATE TABLE IF NOT EXISTS risk_assessments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  medical_record_id TEXT REFERENCES medical_records(id) ON DELETE SET NULL,
  context TEXT NOT NULL DEFAULT 'general' CHECK (context IN ('general','maternal')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','mid','high')),
  risk_score REAL NOT NULL,
  factors TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_patient ON risk_assessments(patient_id, created_at DESC);

-- A doctor-configured proactive follow-up: recurring check-in prompts sent
-- to one patient at a fixed cadence (see lib/followup-agent.ts and
-- scripts/followup-scheduler.ts).
CREATE TABLE IF NOT EXISTS followup_agents (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  pathology TEXT NOT NULL,
  questions TEXT NOT NULL,
  frequency_days INTEGER NOT NULL DEFAULT 7,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  last_checkin_at TEXT,
  next_checkin_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_followup_agents_doctor ON followup_agents(doctor_id, status);
CREATE INDEX IF NOT EXISTS idx_followup_agents_patient ON followup_agents(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_followup_agents_due ON followup_agents(status, next_checkin_at);

-- One row per check-in prompt actually sent. 'pending' until the patient
-- responds, then 'completed' with a rule-based risk_flag and (when an AI
-- provider is configured) a short doctor-facing summary.
CREATE TABLE IF NOT EXISTS followup_checkins (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES followup_agents(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','missed')),
  responses TEXT,
  risk_flag TEXT CHECK (risk_flag IN ('ok','concern','urgent')),
  ai_summary TEXT,
  doctor_alerted_at TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_followup_checkins_agent ON followup_checkins(agent_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_followup_checkins_patient ON followup_checkins(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_followup_checkins_alerts ON followup_checkins(risk_flag, doctor_alerted_at);

CREATE TABLE IF NOT EXISTS patient_registrations (
  id TEXT PRIMARY KEY,
  national_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  gender TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  email TEXT,
  address TEXT,
  blood_group TEXT NOT NULL DEFAULT 'unknown',
  allergies TEXT,
  chronic_conditions TEXT,
  weight_kg REAL,
  pediatrician_name TEXT,
  pediatrician_phone TEXT,
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  reason TEXT,
  contacts TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  patient_id TEXT REFERENCES patients(id),
  matched_patient_id TEXT REFERENCES patients(id),
  appointment_id TEXT REFERENCES appointments(id),
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_patient_registrations_status
  ON patient_registrations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_registrations_doctor
  ON patient_registrations(doctor_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS registration_attachments (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES patient_registrations(id) ON DELETE CASCADE,
  stored_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_registration_attachments_registration
  ON registration_attachments(registration_id);

CREATE TABLE IF NOT EXISTS bulletins (
  id TEXT PRIMARY KEY,
  period_type TEXT NOT NULL CHECK (period_type IN ('week','month')),
  period_label TEXT NOT NULL,
  title TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','dismissed')),
  generated_by TEXT NOT NULL DEFAULT 'scheduled' CHECK (generated_by IN ('scheduled','manual')),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bulletins_created ON bulletins(created_at DESC);
`);

const patientCount = db.prepare("SELECT COUNT(*) c FROM patients").get().c;
if (patientCount > 0 && !force) {
  console.log(`[seed] DB already has ${patientCount} patients — skipping seed. (use "npm run seed" to force reset)`);
  process.exit(0);
}

const uuid = () => crypto.randomUUID();
const token = () => crypto.randomBytes(16).toString("hex");
const hash = (pw) => bcrypt.hashSync(pw, 12);

const insertHospital = db.prepare("INSERT INTO hospitals (id, name, city, province) VALUES (?, ?, ?, ?)");
const insertDoctor = db.prepare(
  "INSERT INTO doctors (id, full_name, email, password_hash, license_number, specialization, hospital_id, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
);
const insertHospitalAdmin = db.prepare(
  "INSERT INTO hospital_admins (id, full_name, email, password_hash, hospital_id) VALUES (?, ?, ?, ?, ?)"
);

// Auto-creates a hospital-admin login for a hospital as part of seeding —
// every hospital in this script gets one, so no seeded hospital is ever
// left without an admin account. Credentials are collected in
// `hospitalAdminCredentials` and printed at the end, same convention as the
// doctor/patient credential printout below.
const hospitalAdminCredentials = [];
function seedHospitalAdmin(hospitalId, hospitalName, adminName, email) {
  const password = "hospitaladmin123";
  insertHospitalAdmin.run(uuid(), adminName, email, hash(password), hospitalId);
  hospitalAdminCredentials.push({ hospitalName, adminName, email, password });
}
const insertPatient = db.prepare(`INSERT INTO patients
  (id, national_id, id_type, full_name, date_of_birth, gender, phone_number, email, address, blood_group, allergies, chronic_conditions, password_hash, emergency_qr_token, qr_rotated_at, qr_rotation_count)
  VALUES (@id, @national_id, @id_type, @full_name, @date_of_birth, @gender, @phone_number, @email, @address, @blood_group, @allergies, @chronic_conditions, @password_hash, @emergency_qr_token, datetime('now'), 0)`);
const insertContact = db.prepare(
  "INSERT INTO emergency_contacts (id, patient_id, full_name, relationship_type, phone_number, is_primary) VALUES (?, ?, ?, ?, ?, ?)"
);
const insertRecord = db.prepare(`INSERT INTO medical_records
  (id, patient_id, doctor_id, record_type, visit_date, diagnosis, symptoms, notes)
  VALUES (@id, @patient_id, @doctor_id, @record_type, @visit_date, @diagnosis, @symptoms, @notes)`);
const insertRx = db.prepare(`INSERT INTO prescriptions
  (id, patient_id, doctor_id, medical_record_id, medications, instructions, issued_date)
  VALUES (@id, @patient_id, @doctor_id, @medical_record_id, @medications, @instructions, @issued_date)`);
const insertAudit = db.prepare(`INSERT INTO audit_logs
  (id, patient_id, actor_role, actor_name, action, details, created_at)
  VALUES (@id, @patient_id, @actor_role, @actor_name, @action, @details, @created_at)`);

const seedTx = db.transaction(() => {
  const hospitalId = uuid();
  insertHospital.run(hospitalId, "Lahore General Hospital", "Lahore", "Punjab");
  seedHospitalAdmin(hospitalId, "Lahore General Hospital", "Zainab Malik", "admin.lahoregeneral@pulseid.dev");

  const doctorId = uuid();
  insertDoctor.run(
    doctorId,
    "Dr. Ayesha Raza",
    "ayesha.raza@pulseid.dev",
    hash("doctor123"),
    "PMC-48213",
    "Internal Medicine",
    hospitalId
  );

  const doctor2Id = uuid();
  insertDoctor.run(
    doctor2Id,
    "Dr. Bilal Ahmed",
    "bilal.ahmed@pulseid.dev",
    hash("doctor123"),
    "PMC-51902",
    "Emergency Medicine",
    hospitalId
  );

  const patients = [
    {
      id: uuid(),
      national_id: "35202-1234567-1",
      id_type: "cnic",
      full_name: "Hassan Tariq",
      date_of_birth: "1988-03-14",
      gender: "male",
      phone_number: "+92 300 1112233",
      email: "hassan.tariq@example.com",
      address: "House 12, Model Town, Lahore",
      blood_group: "O+",
      allergies: "Penicillin",
      chronic_conditions: "Type 2 Diabetes, Hypertension",
      password_hash: hash("patient123"),
      emergency_qr_token: token(),
      contacts: [["Sara Tariq", "Spouse", "+92 301 2223344", 1]],
      records: [
        {
          record_type: "diagnosis",
          visit_date: "2026-06-02",
          diagnosis: "Type 2 Diabetes Mellitus, newly controlled",
          symptoms: "Fatigue, increased thirst, blurred vision",
          notes: "Started on Metformin 500mg. Advised diet control and follow-up HbA1c in 3 months.",
          doctor: doctorId,
        },
        {
          record_type: "lab_result",
          visit_date: "2026-06-02",
          diagnosis: "HbA1c 8.2% (elevated)",
          symptoms: "",
          notes: "Fasting glucose 176 mg/dL. Lipid panel mildly elevated LDL.",
          doctor: doctorId,
        },
        {
          record_type: "checkup",
          visit_date: "2026-01-10",
          diagnosis: "Essential hypertension, stage 1",
          symptoms: "Occasional headaches",
          notes: "BP 148/92. Started on Amlodipine 5mg once daily.",
          doctor: doctorId,
        },
      ],
      rx: [
        {
          medications: JSON.stringify([
            { name: "Metformin", dosage: "500mg", frequency: "Twice daily", duration: "90 days" },
            { name: "Amlodipine", dosage: "5mg", frequency: "Once daily", duration: "90 days" },
          ]),
          instructions: "Take with food. Monitor blood sugar levels weekly.",
          issued_date: "2026-06-02",
          doctor: doctorId,
        },
      ],
    },
    {
      id: uuid(),
      national_id: "35201-9988776-3",
      id_type: "cnic",
      full_name: "Maria Khan",
      date_of_birth: "1995-11-02",
      gender: "female",
      phone_number: "+92 321 5556677",
      email: "maria.khan@example.com",
      address: "Flat 4B, Gulberg III, Lahore",
      blood_group: "A-",
      allergies: "None known",
      chronic_conditions: "Asthma",
      password_hash: hash("patient123"),
      emergency_qr_token: token(),
      contacts: [
        ["Ahmed Khan", "Father", "+92 322 8889900", 1],
        ["Zara Khan", "Sister", "+92 333 4445566", 0],
      ],
      records: [
        {
          record_type: "emergency_visit",
          visit_date: "2026-04-18",
          diagnosis: "Acute asthma exacerbation",
          symptoms: "Shortness of breath, wheezing, chest tightness",
          notes: "Treated with nebulized Salbutamol in ER. Discharged with inhaler, advised pulmonology follow-up.",
          doctor: doctor2Id,
        },
        {
          record_type: "vaccination",
          visit_date: "2025-09-01",
          diagnosis: "Seasonal influenza vaccine administered",
          symptoms: "",
          notes: "No adverse reaction observed.",
          doctor: doctorId,
        },
      ],
      rx: [
        {
          medications: JSON.stringify([
            { name: "Salbutamol Inhaler", dosage: "100mcg", frequency: "As needed", duration: "Ongoing" },
          ]),
          instructions: "Use before exercise or if wheezing occurs. Seek help if relief lasts under 4 hours.",
          issued_date: "2026-04-18",
          doctor: doctor2Id,
        },
      ],
    },
    {
      id: uuid(),
      national_id: "42101-3344556-9",
      id_type: "cnic",
      full_name: "Imran Sheikh",
      date_of_birth: "1962-07-22",
      gender: "male",
      phone_number: "+92 302 7778899",
      email: "imran.sheikh@example.com",
      address: "House 88, DHA Phase 5, Karachi",
      blood_group: "B+",
      allergies: "Sulfa drugs, Shellfish",
      chronic_conditions: "Coronary artery disease, Atrial fibrillation",
      password_hash: hash("patient123"),
      emergency_qr_token: token(),
      contacts: [["Nadia Sheikh", "Spouse", "+92 303 1231234", 1]],
      records: [
        {
          record_type: "surgery",
          visit_date: "2023-02-11",
          diagnosis: "Triple vessel coronary artery disease",
          symptoms: "Angina on exertion",
          notes: "Underwent CABG (triple bypass). Recovery uneventful. Started on lifelong anticoagulation.",
          doctor: doctorId,
        },
        {
          record_type: "checkup",
          visit_date: "2026-05-20",
          diagnosis: "Atrial fibrillation, rate controlled",
          symptoms: "Occasional palpitations",
          notes: "INR stable at 2.4. Continue Warfarin, review in 6 weeks.",
          doctor: doctorId,
        },
      ],
      rx: [
        {
          medications: JSON.stringify([
            { name: "Warfarin", dosage: "5mg", frequency: "Once daily", duration: "Ongoing" },
            { name: "Atorvastatin", dosage: "40mg", frequency: "Once nightly", duration: "Ongoing" },
          ]),
          instructions: "Avoid vitamin K-rich food swings. Routine INR monitoring every 4 weeks.",
          issued_date: "2026-05-20",
          doctor: doctorId,
        },
      ],
    },
    {
      id: uuid(),
      national_id: "36302-4455667-2",
      id_type: "b_form",
      full_name: "Ayesha Noor",
      date_of_birth: "2019-01-30",
      gender: "female",
      phone_number: "+92 345 6667788",
      email: "",
      address: "House 5, Johar Town, Lahore",
      blood_group: "AB+",
      allergies: "Peanuts (severe)",
      chronic_conditions: "None",
      password_hash: hash("patient123"),
      emergency_qr_token: token(),
      contacts: [
        ["Faisal Noor", "Father", "+92 345 1112222", 1],
        ["Hina Noor", "Mother", "+92 345 3334444", 0],
      ],
      records: [
        {
          record_type: "vaccination",
          visit_date: "2026-01-15",
          diagnosis: "Routine childhood immunization — MMR booster",
          symptoms: "",
          notes: "No adverse reaction. Next dose due in 12 months.",
          doctor: doctorId,
        },
        {
          record_type: "emergency_visit",
          visit_date: "2025-08-09",
          diagnosis: "Anaphylaxis — peanut exposure",
          symptoms: "Facial swelling, hives, difficulty breathing",
          notes: "Treated with IM epinephrine and observation. Family issued epinephrine auto-injector.",
          doctor: doctor2Id,
        },
      ],
      rx: [],
    },
  ];

  for (const p of patients) {
    insertPatient.run({
      id: p.id,
      national_id: p.national_id,
      id_type: p.id_type || "cnic",
      full_name: p.full_name,
      date_of_birth: p.date_of_birth,
      gender: p.gender,
      phone_number: p.phone_number,
      email: p.email,
      address: p.address,
      blood_group: p.blood_group,
      allergies: p.allergies,
      chronic_conditions: p.chronic_conditions,
      password_hash: p.password_hash,
      emergency_qr_token: p.emergency_qr_token,
    });
    for (const c of p.contacts) {
      insertContact.run(uuid(), p.id, c[0], c[1], c[2], c[3]);
    }
    const recordIds = [];
    for (const r of p.records) {
      const rid = uuid();
      recordIds.push(rid);
      insertRecord.run({
        id: rid,
        patient_id: p.id,
        doctor_id: r.doctor,
        record_type: r.record_type,
        visit_date: r.visit_date,
        diagnosis: r.diagnosis,
        symptoms: r.symptoms,
        notes: r.notes,
      });
    }
    for (const rx of p.rx) {
      insertRx.run({
        id: uuid(),
        patient_id: p.id,
        doctor_id: rx.doctor,
        medical_record_id: recordIds[0] || null,
        medications: rx.medications,
        instructions: rx.instructions,
        issued_date: rx.issued_date,
      });
    }
  }

  // A few realistic audit log entries for the first patient (Hassan Tariq)
  const hassan = patients[0];
  const now = Date.now();
  const entries = [
    { role: "doctor", name: "Dr. Ayesha Raza", action: "record_viewed", details: "Viewed full medical history", daysAgo: 2 },
    { role: "doctor", name: "Dr. Ayesha Raza", action: "record_created", details: "Added diagnosis: Type 2 Diabetes Mellitus", daysAgo: 60 },
    { role: "system", name: "PulseID Emergency Access", action: "qr_scanned", details: "Emergency QR scanned at Lahore General Hospital ER", daysAgo: 14 },
  ];
  for (const e of entries) {
    insertAudit.run({
      id: uuid(),
      patient_id: hassan.id,
      actor_role: e.role,
      actor_name: e.name,
      action: e.action,
      details: e.details,
      created_at: new Date(now - e.daysAgo * 86400000).toISOString(),
    });
  }

  // ---------------------------------------------------------------------
  // Extra regions — purely so the analytics service (region comparisons,
  // the outbreak map, forecasting, anomaly alerts) has more than one city
  // to work with. These are lightweight synthetic patients/visits, not
  // part of the "log in as this person" demo cast above.
  // ---------------------------------------------------------------------
  // Each hospital now seeds 2+ doctors across different specializations
  // (never an empty hospital) and gets its own hospital-admin account. Every
  // region in the province list is represented, with two hospitals in
  // Gilgit-Baltistan (DHQ Gilgit + Skardu Civil Hospital) as the worked
  // example for the region -> hospital -> doctor hierarchy documented in
  // the README.
  const regionHospitals = [
    {
      city: "Karachi",
      province: "Sindh",
      name: "Karachi Civic Hospital",
      adminName: "Farah Siddiqui",
      adminEmail: "admin.karachicivic@pulseid.dev",
      doctors: [
        { name: "Dr. Sana Iqbal", email: "sana.iqbal@pulseid.dev", specialization: "General Medicine" },
        { name: "Dr. Omar Farooqi", email: "omar.farooqi@pulseid.dev", specialization: "Cardiologist" },
        { name: "Dr. Rabia Yousuf", email: "rabia.yousuf@pulseid.dev", specialization: "Child Specialist" },
      ],
    },
    {
      city: "Islamabad",
      province: "Islamabad Capital Territory",
      name: "Islamabad Capital Hospital",
      adminName: "Tariq Mehmood",
      adminEmail: "admin.islamabadcapital@pulseid.dev",
      doctors: [
        { name: "Dr. Usman Farooq", email: "usman.farooq@pulseid.dev", specialization: "General Medicine" },
        { name: "Dr. Hira Abbasi", email: "hira.abbasi@pulseid.dev", specialization: "Dermatologist" },
      ],
    },
    {
      city: "Peshawar",
      province: "Khyber Pakhtunkhwa",
      name: "Peshawar City Hospital",
      adminName: "Junaid Shinwari",
      adminEmail: "admin.peshawarcity@pulseid.dev",
      doctors: [
        { name: "Dr. Nadia Khattak", email: "nadia.khattak@pulseid.dev", specialization: "General Medicine" },
        { name: "Dr. Adeel Yousafzai", email: "adeel.yousafzai@pulseid.dev", specialization: "Orthopedic Surgeon" },
      ],
    },
    {
      city: "Quetta",
      province: "Balochistan",
      name: "Quetta Regional Hospital",
      adminName: "Shazia Bugti",
      adminEmail: "admin.quettaregional@pulseid.dev",
      doctors: [
        { name: "Dr. Bilal Marri", email: "bilal.marri@pulseid.dev", specialization: "General Medicine" },
        { name: "Dr. Mahnoor Achakzai", email: "mahnoor.achakzai@pulseid.dev", specialization: "Gynecologist" },
      ],
    },
    // Gilgit-Baltistan — two hospitals, matching the hierarchy example
    // in the README (DHQ Gilgit + Skardu Civil Hospital, each with its
    // own hospital-admin login, distinct from each other and from any
    // doctor's login).
    {
      city: "Gilgit",
      province: "Gilgit-Baltistan",
      name: "DHQ Gilgit",
      adminName: "Rahat Karim",
      adminEmail: "admin.dhqgilgit@pulseid.dev",
      doctors: [
        { name: "Dr. Amina Baig", email: "amina.baig@pulseid.dev", specialization: "Child Specialist" },
        { name: "Dr. Karim Hunzai", email: "karim.hunzai@pulseid.dev", specialization: "General Medicine" },
      ],
    },
    {
      city: "Skardu",
      province: "Gilgit-Baltistan",
      name: "Skardu Civil Hospital",
      adminName: "Bilal Skardu",
      adminEmail: "admin.skarducivil@pulseid.dev",
      doctors: [
        { name: "Dr. Fatima Sheikh", email: "fatima.sheikh@pulseid.dev", specialization: "General Medicine" },
        { name: "Dr. Zubair Baltistani", email: "zubair.baltistani@pulseid.dev", specialization: "Cardiologist" },
      ],
    },
    {
      city: "Muzaffarabad",
      province: "Azad Jammu & Kashmir",
      name: "Muzaffarabad General Hospital",
      adminName: "Imtiaz Raja",
      adminEmail: "admin.muzaffarabadgeneral@pulseid.dev",
      doctors: [
        { name: "Dr. Faiza Chaudhry", email: "faiza.chaudhry@pulseid.dev", specialization: "General Medicine" },
        { name: "Dr. Waqas Mughal", email: "waqas.mughal@pulseid.dev", specialization: "Child Specialist" },
      ],
    },
  ];
  const conditionPool = ["Dengue Fever", "Seasonal Influenza", "Type 2 Diabetes", "Hypertension", "Typhoid Fever"];
  let seededVisits = 0;
  let doctorLicenseSeq = 0;

  regionHospitals.forEach((rh, idx) => {
    const hId = uuid();
    insertHospital.run(hId, rh.name, rh.city, rh.province);
    seedHospitalAdmin(hId, rh.name, rh.adminName, rh.adminEmail);

    const doctorIds = rh.doctors.map((d) => {
      doctorLicenseSeq++;
      const dId = uuid();
      insertDoctor.run(dId, d.name, d.email, hash("doctor123"), `PMC-6${doctorLicenseSeq}812`, d.specialization, hId);
      return dId;
    });

    // A handful of synthetic patients per region so patient-count aggregates
    // aren't just "1 person visited 40 times".
    const synthPatients = [1, 2].map((n) => {
      const pid = uuid();
      insertPatient.run({
        id: pid,
        national_id: `${41000 + idx * 100 + n}-${1000000 + idx * 7 + n}-${n}`,
        id_type: "cnic",
        full_name: `${rh.city} Resident ${n}`,
        date_of_birth: "1990-01-01",
        gender: n % 2 === 0 ? "female" : "male",
        phone_number: "+92 300 0000000",
        email: "",
        address: `${rh.city}, Pakistan`,
        blood_group: "O+",
        allergies: "None known",
        chronic_conditions: "None",
        password_hash: hash("patient123"),
        emergency_qr_token: token(),
      });
      return pid;
    });

    // 10 weeks of visits, split across this hospital's doctors. Karachi
    // gets a deliberate late spike in Dengue so the outbreak-alert/forecast
    // features have something real to flag.
    for (let week = 9; week >= 0; week--) {
      const visitDate = new Date(Date.UTC(2026, 5, 15) - week * 7 * 86400000).toISOString().slice(0, 10);
      let visitsThisWeek = 3 + ((week + idx) % 3);
      const isKarachiSpikeWeek = rh.city === "Karachi" && week === 0;
      if (isKarachiSpikeWeek) visitsThisWeek = 10;
      for (let v = 0; v < visitsThisWeek; v++) {
        const diagnosis = isKarachiSpikeWeek && v < 8 ? "Dengue Fever" : conditionPool[(v + week + idx) % conditionPool.length];
        insertRecord.run({
          id: uuid(),
          patient_id: synthPatients[v % synthPatients.length],
          doctor_id: doctorIds[v % doctorIds.length],
          record_type: "diagnosis",
          visit_date: visitDate,
          diagnosis,
          symptoms: "",
          notes: "Regional surveillance record (synthetic demo data).",
        });
        seededVisits++;
      }
    }
  });

  return { patients, doctorId, doctor2Id, seededVisits };
});

const result = seedTx();

console.log("[seed] Database ready at", DB_PATH);
console.log(`[seed] Seeded ${result.seededVisits} additional regional visits across Karachi, Islamabad, Peshawar, Quetta, Gilgit, Skardu, Muzaffarabad for analytics demo data.`);
console.log("[seed] Demo doctor login: ayesha.raza@pulseid.dev / doctor123");
console.log("[seed] Demo patient login (National ID + any 6-digit OTP shown on screen):");
for (const p of result.patients) {
  console.log(`  - ${p.full_name}: ${p.national_id} (password fallback: patient123)`);
}
console.log("[seed] Hospital-admin logins (one per hospital, password same for every admin in this demo seed):");
for (const a of hospitalAdminCredentials) {
  console.log(`  - ${a.hospitalName}: ${a.email} / ${a.password} (${a.adminName})`);
}
