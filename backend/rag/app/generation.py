"""Groq-drafted clinical reports — generation, the last pipeline stage.

The schema IS the labelling guarantee: every prescription comes back as
structured fields, never prose. Grounding rules forbid inventing facts and
require retrieval labels to be cited inline. Generation runs on Groq's
OpenAI-compatible endpoint; structured output is enforced with a forced
tool call (the same mechanism LangChain's withStructuredOutput used on the
Node side), then validated with Pydantic — a truncated or malformed tool
call surfaces as DraftIncompleteError so the UI can say "try again" instead
of implying a system fault.

Trust boundary, unchanged: the drafted report is a convenience, never a
decision — the doctor reviews and approves the editable draft before
anything is saved (the Node finalize route is the human gate).
"""

import json
import logging

from . import config
from .schemas import DraftRequest, ReportDraft

logger = logging.getLogger("pulseid.rag.generation")

DRAFT_SYSTEM_PROMPT = """You are drafting a structured clinical report for a doctor inside PulseID, a national medical-records system.

You are given the treating doctor's own visit notes (keywords or short sentences) and retrieved context from this one patient's record (profile, past visits, uploaded reports). Each context block begins with a citation label like [Visit 2026-01-15] or [Report: lab.pdf].

Rules you always follow:
- Write ONLY from the doctor's notes and the retrieved context. Never invent symptoms, findings, medications, or history that is not present there. If information is missing, write "not documented" rather than guessing.
- Substantive claims in the history and assessment should trace to the doctor's notes or a cited context block. Reference citation labels inline where a claim comes from history, e.g. "(see [Visit 2026-05-02])".
- Prescriptions must list EVERY medication the doctor's notes name, with complete dosage/frequency/duration/instructions — expand standard abbreviations (e.g. "BD" → "twice daily"), but never introduce a medication the notes do not mention.
- You are drafting FOR a doctor who will review every word before it is sent. Clinical register throughout; only patient_advice is plain language.
- This is a drafting aid, not a diagnosis: the assessment refines the doctor's stated impression — never a new diagnosis they did not indicate.
- Output must match the schema exactly."""


class DrafterNotConfiguredError(Exception):
    """No GROQ_API_KEY — the deployment hasn't opted into AI drafting."""


class DraftIncompleteError(Exception):
    """The model's tool call was truncated/malformed and failed validation."""


def _tool_schema() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "report_draft",
            "description": "Write the structured clinical report draft.",
            "parameters": ReportDraft.model_json_schema(),
        },
    }


def _extra_kwargs(model: str) -> dict:
    # gpt-oss models share one token budget between reasoning and output, so
    # they take a reasoning_effort knob; other Groq models reject the
    # parameter — only send it for them. Mirrors the Node payload.
    if "gpt-oss" in model:
        return {"extra_body": {"reasoning_effort": "medium"}}
    return {}


def _client():
    from openai import OpenAI  # deferred: only needed when drafting

    return OpenAI(
        api_key=config.GROQ_API_KEY,
        base_url=config.GROQ_BASE_URL,
        max_retries=1,
    )


def _normalize_arguments(raw: str | dict) -> str:
    """Repair the model's near-miss argument JSON before validation. The one
    observed drift is prescriptions[].medication_name for the schema's `name`
    — accept the alias rather than throwing the whole draft away."""
    data = json.loads(raw) if isinstance(raw, str) else raw
    if isinstance(data, dict):
        for rx in data.get("prescriptions") or []:
            if isinstance(rx, dict) and "name" not in rx and "medication_name" in rx:
                rx["name"] = rx.pop("medication_name")
    return json.dumps(data)


def _salvage_arguments(err: Exception) -> str | None:
    """Groq validates tool calls server-side; when the model's arguments drift
    from the schema the request 400s with `tool_use_failed` and the raw
    arguments ride along as `failed_generation`. Pull them back out."""
    body = getattr(err, "body", None)
    failed = None
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            failed = error.get("failed_generation")
    if not isinstance(failed, str):
        return None
    try:
        parsed = json.loads(failed)
    except ValueError:
        return None
    if isinstance(parsed, dict) and "arguments" in parsed:
        arguments = parsed["arguments"]
        try:
            return _normalize_arguments(arguments if isinstance(arguments, str) else json.dumps(arguments))
        except ValueError:
            return None
    return None


def draft_report(request: DraftRequest) -> tuple[ReportDraft, str]:
    """Returns (draft, model_name). Raises DrafterNotConfiguredError when the
    deployment has no Groq key and DraftIncompleteError on schema failure."""
    if not config.groq_configured():
        raise DrafterNotConfiguredError()

    context = "\n\n".join(f"[{d.label}] {d.content}" for d in request.docs)
    user_prompt = f"""Patient: {request.patientName}
Visit date: {request.visitDate}

Doctor's visit notes (keywords / short sentences):
\"\"\"
{request.keywords}
\"\"\"

Retrieved patient context:
{context or "(no additional retrieved context)"}

Draft the structured report now."""

    model = config.GROQ_MODEL
    try:
        completion = _client().chat.completions.create(
            model=model,
            temperature=1,
            top_p=1,
            max_tokens=config.GROQ_MAX_TOKENS,
            messages=[
                {"role": "system", "content": DRAFT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            tools=[_tool_schema()],
            tool_choice={"type": "function", "function": {"name": "report_draft"}},
            **_extra_kwargs(model),
        )
    except Exception as err:  # noqa: BLE001
        # A schema-drifted tool call is recoverable (salvage) or — when it
        # isn't — a draft-quality failure the UI treats as "try again",
        # never a system fault.
        salvaged = _salvage_arguments(err)
        if salvaged is not None:
            try:
                return ReportDraft.model_validate_json(salvaged), model
            except ValueError as parse_err:
                raise DraftIncompleteError("Salvaged tool call failed schema validation.") from parse_err
        if _looks_like_schema_failure(str(getattr(err, "message", err) or err)):
            raise DraftIncompleteError() from err
        raise

    tool_calls = completion.choices[0].message.tool_calls or []
    if not tool_calls:
        raise DraftIncompleteError("Model returned no tool call.")
    try:
        draft = ReportDraft.model_validate_json(_normalize_arguments(tool_calls[0].function.arguments))
    except (ValueError, KeyError, TypeError) as err:
        # A truncated or malformed tool call surfaces here.
        raise DraftIncompleteError("Tool call failed schema validation.") from err
    return draft, model


def _looks_like_schema_failure(message: str) -> bool:
    lowered = message.lower()
    return "parse" in lowered or "schema" in lowered or "invalid tool" in lowered
