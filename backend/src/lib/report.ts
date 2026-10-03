import { randomUUID } from "crypto";
import { getPatientFullRecord, getEmergencyContacts, getAuditLog } from "./repo";
import type { Medication, RecordType } from "./types";

export type MedicalReport = ReturnType<typeof buildMedicalReport>;

function calcAge(dob: string): number {
  const b = new Date(dob);
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a;
}

/**
 * Builds one comprehensive, self-contained medical report for a patient.
 * The same object powers both the patient-facing report and the
 * doctor/hospital-facing report — only the presentation layer (letterhead,
 * signature block, styling) differs on the frontend. Keeping a single
 * source of truth for the underlying numbers means a patient and a
 * clinician looking at "the same report" always see the same facts.
 */
export function buildMedicalReport(patientId: string, generatedFor: "patient" | "doctor", generatedByName: string) {
  const full = getPatientFullRecord(patientId);
  if (!full) return null;
  const { patient, records, prescriptions } = full;
  const contacts = getEmergencyContacts(patientId);
  const auditLog = getAuditLog(patientId).slice(0, 15);

  const recordsByType = records.reduce<Record<string, number>>((acc, r) => {
    acc[r.record_type] = (acc[r.record_type] || 0) + 1;
    return acc;
  }, {});

  const mostRecentVisit = records[0] || null;

  // A prescription is treated as "current" if it was issued within the last
  // 30 days OR its longest medication duration text mentions "ongoing" /
  // "continuous" — a light heuristic since this demo schema has no explicit
  // end-date field, but it's enough to separate active meds from history.
  const now = Date.now();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const prescriptionsExpanded = prescriptions.map((rx) => {
    const meds = JSON.parse(rx.medications) as Medication[];
    const issuedMs = new Date(rx.issued_date).getTime();
    const recentlyIssued = !Number.isNaN(issuedMs) && now - issuedMs <= THIRTY_DAYS;
    const soundsOngoing = meds.some((m) => /ongoing|continuous|lifelong|indefinite/i.test(m.duration || ""));
    return { ...rx, medications: meds, isCurrent: recentlyIssued || soundsOngoing };
  });

  const currentMedications = prescriptionsExpanded
    .filter((rx) => rx.isCurrent)
    .flatMap((rx) => rx.medications.map((m) => ({ ...m, prescribedBy: rx.doctor_name || "Unknown", issuedDate: rx.issued_date })));

  const riskFlags: string[] = [];
  if (patient.allergies && patient.allergies.trim().length > 0) riskFlags.push(`Allergy alert: ${patient.allergies}`);
  if (patient.chronic_conditions && patient.chronic_conditions.trim().length > 0) {
    riskFlags.push(`Chronic condition: ${patient.chronic_conditions}`);
  }
  if (records.some((r) => r.record_type === "emergency_visit")) {
    riskFlags.push("Has one or more prior emergency-department visits on file");
  }
  if (records.some((r) => r.record_type === "surgery")) {
    riskFlags.push("Has surgical history on file");
  }

  return {
    reportId: randomUUID(),
    generatedAt: new Date().toISOString(),
    generatedFor,
    generatedByName,
    patient: {
      id: patient.id,
      fullName: patient.full_name,
      nationalId: patient.national_id,
      dateOfBirth: patient.date_of_birth,
      age: calcAge(patient.date_of_birth),
      gender: patient.gender,
      bloodGroup: patient.blood_group,
      phoneNumber: patient.phone_number,
      email: patient.email,
      address: patient.address,
      allergies: patient.allergies,
      chronicConditions: patient.chronic_conditions,
      recordCreatedAt: patient.created_at,
    },
    summary: {
      totalVisits: records.length,
      totalPrescriptions: prescriptions.length,
      recordsByType: recordsByType as Record<RecordType, number> | Record<string, number>,
      mostRecentVisit: mostRecentVisit
        ? { date: mostRecentVisit.visit_date, type: mostRecentVisit.record_type, diagnosis: mostRecentVisit.diagnosis }
        : null,
      currentMedicationCount: currentMedications.length,
      riskFlags,
    },
    emergencyContacts: contacts.map((c) => ({
      fullName: c.full_name,
      relationship: c.relationship_type,
      phone: c.phone_number,
      isPrimary: c.is_primary === 1,
    })),
    timeline: records.map((r) => ({
      id: r.id,
      type: r.record_type,
      visitDate: r.visit_date,
      diagnosis: r.diagnosis,
      symptoms: r.symptoms,
      notes: r.notes,
      clinician: r.doctor_name || null,
      recordedAt: r.created_at,
    })),
    prescriptions: prescriptionsExpanded.map((rx) => ({
      id: rx.id,
      issuedDate: rx.issued_date,
      clinician: rx.doctor_name || null,
      instructions: rx.instructions,
      isCurrent: rx.isCurrent,
      medications: rx.medications,
    })),
    currentMedications,
    accessLog: auditLog.map((a) => ({
      actorRole: a.actor_role,
      actorName: a.actor_name,
      action: a.action,
      details: a.details,
      at: a.created_at,
    })),
  };
}
