"""PulseID RAG service — request/response models.

Every endpoint's payload is declared here with Pydantic, the same role
lib/types.ts + zod play on the Node side. The ReportDraft model doubles as
the JSON schema handed to Groq for structured output, which is what keeps
every prescription a structured row instead of prose buried in a paragraph.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

SourceType = Literal["profile", "visit", "attachment"]


# --- Ingest payloads -----------------------------------------------------------
# The Node client gathers the raw data from its own SQLite and posts structured
# fields; this service builds chunk text, embeds, and persists. The service
# never touches the clinical database — it only ever sees what the Node client
# explicitly sends for one patient (or one pending registration).


class ContactIn(BaseModel):
    fullName: str = "?"
    relationshipType: str = "?"
    phoneNumber: str = "?"


class ProfileSource(BaseModel):
    """Personal details — from a booking request or an approved patient."""

    scope: Literal["patient", "registration"]
    scopeId: str = Field(..., description="patients.id or patient_registrations.id")
    sourceId: str = Field(..., description="Chunk source key — equals scopeId in practice")
    fullName: str
    dateOfBirth: str
    gender: str
    bloodGroup: Optional[str] = None
    allergies: Optional[str] = None
    chronicConditions: Optional[str] = None
    weightKg: Optional[float] = None
    phoneNumber: str
    contacts: List[ContactIn] = []


class PrescriptionIn(BaseModel):
    medications: str  # JSON string exactly as stored in the prescriptions table
    instructions: Optional[str] = None


class VisitSource(BaseModel):
    """One medical record plus its prescriptions — one chunk."""

    patientId: str
    sourceId: str
    visitDate: str
    recordType: str
    diagnosis: Optional[str] = None
    symptoms: Optional[str] = None
    notes: Optional[str] = None
    systolicBp: Optional[int] = None
    diastolicBp: Optional[int] = None
    bloodSugarMmol: Optional[float] = None
    bodyTempC: Optional[float] = None
    heartRateBpm: Optional[int] = None
    prescriptions: List[PrescriptionIn] = []


class AttachmentSource(BaseModel):
    """An uploaded report PDF, sent as base64 — text is extracted here."""

    patientId: Optional[str] = None
    registrationId: Optional[str] = None
    sourceId: str
    filename: str  # display name only, e.g. "lab-report.pdf"
    contentB64: str
    mimeType: str


class ReparentRequest(BaseModel):
    """Booking approval: re-parent a registration's chunks to the patient."""

    registrationId: str
    patientId: str


# --- Retrieval / drafting --------------------------------------------------------


class RetrieveRequest(BaseModel):
    patientId: str
    query: str
    k: Optional[int] = None


class RetrievedChunk(BaseModel):
    chunkId: str
    label: str
    content: str
    sourceType: SourceType
    sourceId: str
    score: Optional[float] = None


class RetrieveResponse(BaseModel):
    mode: Literal["vector", "keyword"]
    chunks: List[RetrievedChunk]


class DraftDoc(BaseModel):
    label: str
    content: str


class DraftRequest(BaseModel):
    patientName: str
    visitDate: str
    keywords: str
    docs: List[DraftDoc] = []


class PrescriptionDraft(BaseModel):
    name: str = Field(..., description="Medication name")
    dosage: str = Field(..., description="Dose per administration, e.g. 500 mg")
    frequency: str = Field(..., description="How often, e.g. twice daily")
    duration: str = Field(..., description="How long, e.g. 7 days")
    instructions: str = Field(..., description="Special instructions, e.g. after meals")


class ReportDraft(BaseModel):
    """The structured clinical draft. The schema IS the labelling guarantee:
    every prescription comes back as structured fields, never prose."""

    history_of_present_illness: str = Field(
        ..., description="Narrative history of present illness synthesised from the visit notes and retrieved context."
    )
    examination_findings: str = Field(
        ..., description="Clinical examination findings, from the doctor's keywords and prior vitals only."
    )
    assessment: str = Field(..., description="Working assessment/diagnosis with brief reasoning.")
    treatment_plan: str = Field(..., description="Planned management and investigations.")
    prescriptions: List[PrescriptionDraft] = Field(
        ..., description="Every prescribed medication as a structured row. Empty list if none."
    )
    patient_advice: str = Field(..., description="Plain-language advice for the patient.")
    follow_up: str = Field(..., description="Follow-up instructions.")


class DraftResponse(BaseModel):
    draft: ReportDraft
    model: str
