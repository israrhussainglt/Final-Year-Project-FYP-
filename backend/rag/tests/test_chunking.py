"""Pure chunk-builder + splitter contracts (ported from repo.rag.test.ts).

These pin the exact chunk wording the drafting prompt cites — change a label
here and you change what doctors see quoted in every AI-drafted report.
"""

import datetime
from types import SimpleNamespace

from app.chunking import build_profile_chunk_text, build_visit_chunk_text, split_text, years_between


def profile_source(**overrides):
    base = dict(
        scope="patient",
        scopeId="p1",
        sourceId="p1",
        fullName="Ayesha Khan",
        dateOfBirth="1995-06-15",
        gender="female",
        bloodGroup="B+",
        allergies="Penicillin",
        chronicConditions="Asthma",
        weightKg=60.0,
        phoneNumber="+92 300 1234567",
        contacts=[],
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def visit_source(**overrides):
    base = dict(
        patientId="p1",
        sourceId="r1",
        visitDate="2026-01-15",
        recordType="checkup",
        diagnosis="Hypertension follow-up",
        symptoms="Headache",
        notes="BP elevated",
        systolicBp=150,
        diastolicBp=95,
        bloodSugarMmol=6.1,
        bodyTempC=36.8,
        heartRateBpm=78,
        prescriptions=[],
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class TestYearsBetween:
    def test_whole_years_and_birthday_boundary(self):
        assert years_between("1995-06-15", at=datetime.date(2026, 6, 14)) == 30
        assert years_between("1995-06-15", at=datetime.date(2026, 6, 15)) == 31

    def test_garbage_dates_never_crash(self):
        assert years_between("not-a-date") == 0
        assert years_between("") == 0


class TestProfileChunk:
    def test_full_profile_text(self):
        text = build_profile_chunk_text(profile_source())
        assert text.startswith("Patient profile (personal details). Name: Ayesha Khan.")
        assert "Blood group: B+." in text
        assert "Known allergies: Penicillin." in text
        assert "Weight: 60.0 kg." in text
        assert "Emergency contacts: none on file." in text

    def test_contacts_and_missing_weight(self):
        text = build_profile_chunk_text(
            profile_source(
                weightKg=None,
                allergies=None,
                contacts=[
                    SimpleNamespace(fullName="Bilal", relationshipType="spouse", phoneNumber="+92 301 9999999")
                ],
            )
        )
        assert "Weight: not recorded." in text
        assert "Known allergies: none recorded." in text
        assert "Emergency contacts: Bilal (spouse, +92 301 9999999)." in text


class TestVisitChunk:
    def test_vitals_and_prescriptions(self):
        text = build_visit_chunk_text(
            visit_source(
                prescriptions=[
                    SimpleNamespace(
                        medications='[{"name":"Amlodipine","dosage":"5 mg","frequency":"once daily","duration":"30 days"}]',
                        instructions="After meals",
                    )
                ]
            )
        )
        assert text.startswith("Visit on 2026-01-15 (checkup).")
        assert "Blood pressure: 150/95 mmHg." in text
        assert "Prescribed: Amlodipine 5 mg once daily for 30 days." in text
        assert "Prescription instructions: After meals" in text

    def test_omitted_vitals_and_abbreviation_record_type(self):
        text = build_visit_chunk_text(
            visit_source(
                recordType="emergency_visit",
                systolicBp=None,
                diastolicBp=None,
                bloodSugarMmol=None,
            )
        )
        assert "(emergency visit)" in text
        assert "Blood pressure" not in text
        assert "Blood sugar" not in text

    def test_malformed_prescription_json_is_skipped_not_fatal(self):
        text = build_visit_chunk_text(
            visit_source(prescriptions=[SimpleNamespace(medications="{oops", instructions=None)])
        )
        assert "Prescribed:" not in text


class TestSplitText:
    def test_short_text_stays_one_chunk(self):
        assert split_text("a short note") == ["a short note"]

    def test_long_text_splits_under_the_cap(self):
        text = ". ".join(f"Sentence {i} about diabetes management" for i in range(120))
        chunks = split_text(text, chunk_size=300, chunk_overlap=50)
        assert len(chunks) > 1
        assert all(len(c) <= 400 for c in chunks)

    def test_empty_and_whitespace(self):
        assert split_text("") == []
        assert split_text("   \n  ") == []
