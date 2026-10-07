export type BloodGroup = "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-" | "unknown";

// cnic: NADRA's 13-digit adult ID (issued at 18).
// b_form: NADRA's 13-digit ID for minors, same #####-#######-# shape as a
// CNIC — issued from birth, replaced by a CNIC once the holder turns 18.
export type IdType = "cnic" | "b_form";

export type RecordType =
  | "checkup"
  | "diagnosis"
  | "lab_result"
  | "vaccination"
  | "surgery"
  | "emergency_visit"
  | "prescription";

export interface Patient {
  id: string;
  national_id: string;
  id_type: IdType;
  full_name: string;
  date_of_birth: string;
  gender: string;
  phone_number: string;
  email: string | null;
  address: string | null;
  blood_group: BloodGroup;
  allergies: string | null;
  chronic_conditions: string | null;
  weight_kg: number | null;
  pediatrician_name: string | null;
  pediatrician_phone: string | null;
  guardian_patient_id: string | null;
  password_hash: string | null;
  emergency_qr_token: string;
  qr_rotated_at: string | null;
  qr_rotation_count: number;
  qr_is_static: number;
  created_at: string;
}

export interface QrRotationLog {
  id: string;
  patient_id: string;
  reason: string;
  rotated_at: string;
}

export interface EmergencyContact {
  id: string;
  patient_id: string;
  full_name: string;
  relationship_type: string;
  phone_number: string;
  is_primary: number;
}

export interface MedicalRecord {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  doctor_name?: string;
  record_type: RecordType;
  visit_date: string;
  diagnosis: string | null;
  symptoms: string | null;
  notes: string | null;
  // Optional per-visit vitals (nullable) — feed the risk scorer when present
  // and the RAG service's visit chunk text (backend/rag).
  systolic_bp: number | null;
  diastolic_bp: number | null;
  blood_sugar_mmol: number | null;
  body_temp_c: number | null;
  heart_rate_bpm: number | null;
  created_at: string;
}

export interface Medication {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
}

export interface Prescription {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  doctor_name?: string;
  medical_record_id: string | null;
  medications: string; // JSON string of Medication[]
  instructions: string | null;
  issued_date: string;
}

export interface AuditLog {
  id: string;
  patient_id: string;
  actor_role: string;
  actor_name: string;
  // Nullable: only populated for entries logged after actor_id was added
  // (see migrateAuditLogsActorId in db.ts) — older rows identify the actor
  // by actor_name only.
  actor_id: string | null;
  action: string;
  details: string | null;
  created_at: string;
}

// One entry in a doctor's own activity trail, as shown to a hospital admin
// (see getDoctorAuditLog) — same shape as AuditLog plus the patient's name,
// since an admin reading "record_viewed" needs to know whose record it was
// without a second lookup.
export interface DoctorAuditEntry {
  id: string;
  patient_id: string;
  patient_name: string | null;
  action: string;
  details: string | null;
  created_at: string;
}

export interface HospitalAdminStats {
  doctors: { total: number; active: number; deactivated: number };
  patients: { totalSeen: number; newLast30Days: number };
  appointments: {
    byStatus: Record<AppointmentStatus, number>;
    upcomingNext7Days: number;
    today: number;
  };
  doctorActivity: {
    doctorId: string;
    fullName: string;
    isActive: boolean;
    visitCount: number;
    appointmentCount: number;
    lastActiveAt: string | null;
  }[];
}

export interface Doctor {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
  license_number: string;
  specialization: string | null;
  hospital_id: string | null;
  is_active: number;
}

export interface Hospital {
  id: string;
  name: string;
  city: string | null;
  province: string | null;
}

// A hospital-admin account is scoped to exactly one hospital (hospital_id).
// It is a peer of doctor auth (same password-hash/session pattern in
// lib/auth.ts) — a hospital admin can only ever see/manage doctors within
// their own hospital_id, and has no visibility into other hospitals or
// patient data.
export interface HospitalAdmin {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
  hospital_id: string;
}

export interface PatientFullRecord {
  patient: Patient;
  contacts: EmergencyContact[];
  records: MedicalRecord[];
  prescriptions: Prescription[];
}

export interface GuardianLinkRequest {
  id: string;
  minor_patient_id: string;
  guardian_patient_id: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export type AppointmentStatus = "requested" | "confirmed" | "completed" | "cancelled";

export interface Appointment {
  id: string;
  patient_id: string;
  patient_name?: string;
  doctor_id: string;
  doctor_name?: string;
  hospital_name?: string;
  // Null until a doctor/clinic sets it — patients can only request an
  // appointment with a doctor, never pick the date/time themselves.
  scheduled_at: string | null;
  reason: string | null;
  status: AppointmentStatus;
  doctor_notes: string | null;
  // Set once a 24h-ahead reminder has actually gone out (see
  // reminders.ts's sweep) — prevents sending the same reminder twice.
  reminder_sent_at: string | null;
  // All null for a one-off appointment. For a recurring series, every
  // occurrence (including the first) shares recurrence_group_id and
  // recurrence_rule; recurrence_index/recurrence_count are that
  // occurrence's 1-based position and the series length ("2 of 6").
  recurrence_group_id: string | null;
  recurrence_rule: RecurrenceRule | null;
  recurrence_index: number | null;
  recurrence_count: number | null;
  created_at: string;
  updated_at: string;
}

export type RecurrenceRule = "weekly" | "biweekly" | "monthly";

// ---------- Risk assessments ----------
// See lib/risk-scoring.ts for how these are computed (deterministic,
// rule-based — not a trained ML model).

export type RiskLevel = "low" | "mid" | "high";
export type RiskContext = "general" | "maternal";

export interface RiskAssessment {
  id: string;
  patient_id: string;
  medical_record_id: string | null;
  context: RiskContext;
  risk_level: RiskLevel;
  risk_score: number;
  factors: string; // JSON string of string[]
  created_at: string;
}

// ---------- Proactive follow-up agents ----------

export type FollowupQuestionType = "scale" | "yes_no" | "text";

export interface FollowupQuestion {
  id: string;
  text: string;
  type: FollowupQuestionType;
  // For "scale" (0-10) questions only: an answer at or above this value is
  // treated as "concern", and at or above concernAt + 3 (capped at 10) as
  // "urgent". Ignored for other question types.
  concernAt?: number;
}

export type FollowupAgentStatus = "active" | "paused" | "completed";

export interface FollowupAgent {
  id: string;
  patient_id: string;
  patient_name?: string;
  doctor_id: string;
  doctor_name?: string;
  pathology: string;
  questions: string; // JSON string of FollowupQuestion[]
  frequency_days: number;
  status: FollowupAgentStatus;
  last_checkin_at: string | null;
  next_checkin_at: string;
  created_at: string;
  updated_at: string;
}

export type FollowupCheckinStatus = "pending" | "completed" | "missed";
export type FollowupRiskFlag = "ok" | "concern" | "urgent";

export interface FollowupCheckin {
  id: string;
  agent_id: string;
  patient_id: string;
  patient_name?: string;
  pathology?: string;
  status: FollowupCheckinStatus;
  responses: string | null; // JSON string of Record<questionId, string>
  risk_flag: FollowupRiskFlag | null;
  ai_summary: string | null;
  doctor_alerted_at: string | null;
  sent_at: string;
  responded_at: string | null;
}

// ---------- Self-service booking ----------
//
// A patient-submitted request to be registered and seen. Deliberately NOT a
// Patient row: nothing here is trusted until a doctor approves it (see
// approvePatientRegistration in repo.ts), which is what stops anyone from
// attaching fabricated history to a real person's National ID, or occupying
// an ID before the genuine holder registers.
//
// `national_id` is intentionally NOT unique here — a pending request is
// unverified, and the uniqueness check that matters (nationalIdExists) runs
// again at approval time against the real patients table.

export type RegistrationStatus = "pending" | "approved" | "rejected";

export interface PatientRegistration {
  id: string;
  national_id: string;
  full_name: string;
  date_of_birth: string;
  gender: string;
  phone_number: string;
  email: string | null;
  address: string | null;
  blood_group: BloodGroup;
  allergies: string | null;
  chronic_conditions: string | null;
  weight_kg: number | null;
  pediatrician_name: string | null;
  pediatrician_phone: string | null;
  doctor_id: string;
  doctor_name: string | null;
  reason: string | null;
  // Emergency contacts the patient supplied up front, JSON-encoded. Held here
  // rather than in emergency_contacts because that table has a patient_id
  // FK and no patient exists until approval.
  contacts: string | null;
  status: RegistrationStatus;
  patient_id: string | null;
  // Set at submit time when the submitted National ID already belongs to a
  // registered patient. Their booking is then a follow-up appointment on that
  // existing record, not a new registration — approvePatientRegistration books
  // onto this patient instead of creating a duplicate, and leaves their
  // existing details and emergency contacts untouched. NULL for a genuine new
  // registration, which is also why this can't simply reuse patient_id: that
  // column means "patient created when this was approved".
  matched_patient_id: string | null;
  appointment_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  attachment_count?: number;
}

export interface RegistrationAttachment {
  id: string;
  registration_id: string;
  // Stamped by approvePatientRegistration — until then the uploaded report
  // belongs to the booking *request*, not to any patient.
  patient_id: string | null;
  stored_name: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

// In-app-only patient notification (no email/SMS — those are separate
// configured channels). 'report' = an AI-drafted clinical report was saved
// and sent; 'system' is reserved for future in-app messages.
export interface Notification {
  id: string;
  patient_id: string;
  type: "report" | "system";
  title: string;
  body: string;
  link: string | null;
  is_read: number;
  created_at: string;
}

export interface AppointmentWaitlistEntry {
  id: string;
  patient_id: string;
  patient_name?: string;
  doctor_id: string;
  doctor_name?: string;
  reason: string | null;
  status: "waiting" | "offered" | "booked" | "cancelled";
  offered_appointment_id: string | null;
  created_at: string;
  updated_at: string;
}
