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
  | "prescription"
  | "registration";

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
  action: string;
  details: string | null;
  created_at: string;
}

export interface Doctor {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
  license_number: string;
  specialization: string | null;
  hospital_id: string | null;
}

// A hospital admin's own account — scoped to exactly one hospital. Never
// carries password_hash on the client; the backend strips it before this
// shape reaches the frontend. See backend/src/lib/types.ts for the
// server-side counterpart (which does carry the hash, for auth checks).
export interface HospitalAdmin {
  id: string;
  fullName: string;
  hospitalId: string;
  hospitalName: string | null;
}

export interface PatientFullRecord {
  patient: Patient;
  contacts: EmergencyContact[];
  records: MedicalRecord[];
  prescriptions: Prescription[];
}

// ---------------------------------------------------------------------------
// Shape returned by GET /api/patient/report and GET /api/patients/:id/report.
// Mirrors backend/src/lib/report.ts — kept in sync manually since frontend
// and backend are independent deployable packages.
// ---------------------------------------------------------------------------
export interface MedicalReport {
  reportId: string;
  generatedAt: string;
  generatedFor: "patient" | "doctor";
  generatedByName: string;
  patient: {
    id: string;
    fullName: string;
    nationalId: string;
    dateOfBirth: string;
    age: number;
    gender: string;
    bloodGroup: BloodGroup;
    phoneNumber: string;
    email: string | null;
    address: string | null;
    allergies: string | null;
    chronicConditions: string | null;
    recordCreatedAt: string;
  };
  summary: {
    totalVisits: number;
    totalPrescriptions: number;
    recordsByType: Record<string, number>;
    mostRecentVisit: { date: string; type: string; diagnosis: string | null } | null;
    currentMedicationCount: number;
    riskFlags: string[];
  };
  emergencyContacts: { fullName: string; relationship: string; phone: string; isPrimary: boolean }[];
  timeline: {
    id: string;
    type: string;
    visitDate: string;
    diagnosis: string | null;
    symptoms: string | null;
    notes: string | null;
    clinician: string | null;
    recordedAt: string;
  }[];
  prescriptions: {
    id: string;
    issuedDate: string;
    clinician: string | null;
    instructions: string | null;
    isCurrent: boolean;
    medications: Medication[];
  }[];
  currentMedications: (Medication & { prescribedBy: string; issuedDate: string })[];
  accessLog: { actorRole: string; actorName: string; action: string; details: string | null; at: string }[];
}

// ---------- Risk assessments (see backend/src/lib/risk-scoring.ts) ----------

export type ClinicalRiskLevel = "low" | "mid" | "high";
export type RiskContext = "general" | "maternal";

export interface RiskAssessment {
  id: string;
  patient_id: string;
  medical_record_id: string | null;
  context: RiskContext;
  risk_level: ClinicalRiskLevel;
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
  responses: string | null;
  risk_flag: FollowupRiskFlag | null;
  ai_summary: string | null;
  doctor_alerted_at: string | null;
  sent_at: string;
  responded_at: string | null;
}

export interface PendingFollowupCheckin extends Omit<FollowupCheckin, "responses"> {
  questions: FollowupQuestion[];
}
