"""End-to-end API contracts over the FastAPI surface (fake embedder, no network).

The draft tests stub generation._client so Groq is never contacted; the 503
and 502 contracts are exactly what the Node client maps to its own errors.
"""

import base64
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def no_groq(monkeypatch):
    from app import config

    monkeypatch.setattr(config, "GROQ_API_KEY", "")
    monkeypatch.setattr(config, "RAG_SERVICE_TOKEN", "")


@pytest.fixture()
def with_groq(monkeypatch):
    from app import config

    monkeypatch.setattr(config, "GROQ_API_KEY", "test-key")
    monkeypatch.setattr(config, "RAG_SERVICE_TOKEN", "")


PROFILE = {
    "scope": "registration",
    "scopeId": "reg-1",
    "sourceId": "reg-1",
    "fullName": "Ayesha Khan",
    "dateOfBirth": "1995-06-15",
    "gender": "female",
    "bloodGroup": "B+",
    "allergies": "Penicillin",
    "chronicConditions": "Asthma",
    "weightKg": 60.0,
    "phoneNumber": "+92 300 1234567",
    "contacts": [],
}

VISIT = {
    "patientId": "pat-1",
    "sourceId": "rec-1",
    "visitDate": "2026-01-15",
    "recordType": "checkup",
    "diagnosis": "Hypertension follow-up",
    "symptoms": "Headache",
    "notes": "BP elevated, continue medication",
    "systolicBp": 150,
    "diastolicBp": 95,
    "bloodSugarMmol": None,
    "bodyTempC": None,
    "heartRateBpm": 78,
    "prescriptions": [
        {
            "medications": json.dumps([{"name": "Amlodipine", "dosage": "5 mg", "frequency": "once daily"}]),
            "instructions": "After meals",
        }
    ],
}


def test_health(client, no_groq):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["embeddingReady"] is True  # fake backend
    assert body["groqConfigured"] is False


def test_booking_flow_index_reparent_retrieve(client, no_groq):
    # Booking time: profile indexed against the pending registration.
    res = client.post("/index/profile", json=PROFILE)
    assert res.status_code == 200 and res.json()["chunks"] == 1

    # Until approval, the corpus is invisible to any patient id.
    res = client.post("/retrieve", json={"patientId": "pat-1", "query": "allergies Penicillin"})
    assert res.json()["chunks"] == []

    # Approval: re-parent, then retrieval serves the patient.
    assert client.post("/reparent", json={"registrationId": "reg-1", "patientId": "pat-1"}).json()["reparented"] == 1
    res = client.post("/retrieve", json={"patientId": "pat-1", "query": "allergies Penicillin"})
    body = res.json()
    assert body["mode"] == "vector"
    assert [c["label"] for c in body["chunks"]] == ["Patient profile (from booking request)"]
    assert "Penicillin" in body["chunks"][0]["content"]


def test_visit_index_and_keyword_mode_when_model_down(client, no_groq, monkeypatch):
    client.post("/index/visit", json=VISIT)

    # Model down → the FTS5 keyword fallback answers instead.
    from app import embeddings

    monkeypatch.setattr(embeddings, "ensure_embeddings_ready", lambda: False)
    res = client.post("/retrieve", json={"patientId": "pat-1", "query": "Amlodipine"})
    body = res.json()
    assert body["mode"] == "keyword"
    assert "Amlodipine" in body["chunks"][0]["content"]


def test_attachment_non_pdf_is_skipped_not_failed(client, no_groq):
    res = client.post(
        "/index/attachment",
        json={
            "patientId": "pat-1",
            "sourceId": "att-1",
            "filename": "scan.png",
            "contentB64": base64.b64encode(b"not really a pdf").decode(),
            "mimeType": "image/png",
        },
    )
    assert res.status_code == 200
    assert res.json()["skipped"] is True


def test_reject_route_deletes_attachment_and_profile_chunks(client, no_groq):
    client.post("/index/profile", json=PROFILE)
    res = client.delete("/sources/profile/reg-1")
    assert res.json()["removed"] == 1
    # The profile source is gone; whatever other tests indexed for pat-1 stays.
    remaining = {(s["sourceType"], s["sourceId"]) for s in client.get("/sources/pat-1").json()["sources"]}
    assert ("profile", "reg-1") not in remaining


def test_draft_503_when_not_configured(client, no_groq):
    res = client.post("/draft", json={"patientName": "P", "visitDate": "2026-01-15", "keywords": "k"})
    assert res.status_code == 503
    assert "GROQ_API_KEY" in res.json()["detail"]


def test_draft_502_on_incomplete_tool_call(client, with_groq, monkeypatch):
    from app import generation

    class BrokenCreate:
        @staticmethod
        def create(**_):
            raise RuntimeError("invalid tool use detected")

    class BrokenClient:
        class chat:
            class completions:
                create = BrokenCreate.create

    monkeypatch.setattr(generation, "_client", lambda: BrokenClient())
    res = client.post("/draft", json={"patientName": "P", "visitDate": "2026-01-15", "keywords": "k"})
    assert res.status_code == 502
    assert res.json()["detail"] == "RAG_DRAFT_INCOMPLETE"


class FakeFunction:
    def __init__(self, arguments: str) -> None:
        self.arguments = arguments


class FakeToolCall:
    def __init__(self, function: FakeFunction) -> None:
        self.function = function


class FakeMessage:
    def __init__(self, tool_calls: list) -> None:
        self.tool_calls = tool_calls


class FakeChoice:
    def __init__(self, message: FakeMessage) -> None:
        self.message = message


class FakeCompletion:
    def __init__(self, choices: list) -> None:
        self.choices = choices


VALID_TOOL_ARGS = {
    "history_of_present_illness": "Headache, BP elevated (see [Visit 2026-01-15]).",
    "examination_findings": "BP 150/95 mmHg.",
    "assessment": "Uncontrolled hypertension follow-up.",
    "treatment_plan": "Continue amlodipine, recheck in 2 weeks.",
    "prescriptions": [
        {
            "name": "Amlodipine",
            "dosage": "5 mg",
            "frequency": "once daily",
            "duration": "30 days",
            "instructions": "After meals",
        }
    ],
    "patient_advice": "Reduce salt, walk daily.",
    "follow_up": "Two weeks.",
}


def test_draft_success_returns_structured_report(client, with_groq, monkeypatch):
    from app import generation

    def fake_create(**_):
        tool_call = FakeToolCall(FakeFunction(json.dumps(VALID_TOOL_ARGS)))
        message = FakeMessage([tool_call])
        return FakeCompletion([FakeChoice(message)])

    class FakeClient:
        class chat:
            class completions:
                create = staticmethod(fake_create)

    monkeypatch.setattr(generation, "_client", lambda: FakeClient())
    res = client.post(
        "/draft",
        json={
            "patientName": "Ayesha Khan",
            "visitDate": "2026-01-15",
            "keywords": "BP elevated",
            "docs": [{"label": "Visit 2026-01-15", "content": "Blood pressure 150/95 mmHg."}],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["draft"]["prescriptions"][0]["name"] == "Amlodipine"
    assert body["model"] == "openai/gpt-oss-120b"


def test_token_gate(monkeypatch):
    from app import config

    monkeypatch.setattr(config, "RAG_SERVICE_TOKEN", "secret")
    c = TestClient(app)
    assert c.get("/health").status_code == 401
    assert c.get("/health", headers={"X-RAG-Token": "wrong"}).status_code == 401
    assert c.get("/health", headers={"X-RAG-Token": "secret"}).status_code == 200
