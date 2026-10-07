"""Chunk text builders + text splitting — the pure, unit-tested core.

Everything a doctor could ask about a patient goes into the index as plain,
labelled text. These builders are a direct port of the ones that used to live
in backend/src/lib/rag.ts; the wording is kept byte-compatible so drafts cite
the same labels as before ([Visit 2026-01-15], [Report: lab.pdf], ...).
"""

import json
import re
from datetime import date
from typing import List, Optional

from . import config


def years_between(date_of_birth: str, at: Optional[date] = None) -> int:
    """Age in whole years from an ISO date string; 0 when unparseable."""
    at = at or date.today()
    try:
        y, m, d = (int(p) for p in date_of_birth.strip().split("-")[:3])
    except (ValueError, AttributeError):
        return 0
    age = at.year - y
    if (at.month, at.day) < (m, d):
        age -= 1
    return max(age, 0)


def build_profile_chunk_text(source) -> str:
    """One chunk: the patient's personal details + emergency contacts."""
    contacts = source.contacts or []
    lines = [
        "Patient profile (personal details).",
        f"Name: {source.fullName}.",
        f"Date of birth: {source.dateOfBirth} (age {years_between(source.dateOfBirth)}).",
        f"Gender: {source.gender}.",
        f"Blood group: {source.bloodGroup or 'unknown'}.",
        f"Known allergies: {source.allergies or 'none recorded'}.",
        f"Chronic conditions: {source.chronicConditions or 'none recorded'}.",
        f"Contact: {source.phoneNumber}.",
    ]
    lines.insert(7, f"Weight: {source.weightKg} kg." if source.weightKg else "Weight: not recorded.")
    if contacts:
        joined = "; ".join(
            f"{c.fullName} ({c.relationshipType}, {c.phoneNumber})" for c in contacts
        )
        lines.append(f"Emergency contacts: {joined}.")
    else:
        lines.append("Emergency contacts: none on file.")
    return " ".join(lines)


def build_visit_chunk_text(source) -> str:
    """One chunk: a visit's vitals/diagnosis/notes + every prescription row."""
    record_type = source.recordType.replace("_", " ")
    parts: List[str] = [
        f"Visit on {source.visitDate} ({record_type}).",
        f"Diagnosis: {source.diagnosis or 'not recorded'}.",
        f"Symptoms: {source.symptoms or 'not recorded'}.",
    ]
    if source.systolicBp and source.diastolicBp:
        parts.append(f"Blood pressure: {source.systolicBp}/{source.diastolicBp} mmHg.")
    if source.bloodSugarMmol is not None:
        parts.append(f"Blood sugar: {source.bloodSugarMmol} mmol/L.")
    if source.bodyTempC is not None:
        parts.append(f"Temperature: {source.bodyTempC} °C.")
    if source.heartRateBpm is not None:
        parts.append(f"Heart rate: {source.heartRateBpm} bpm.")
    parts.append(f"Notes: {source.notes or 'none'}.")

    for rx in source.prescriptions or []:
        try:
            meds = json.loads(rx.medications)
            if not isinstance(meds, list):
                meds = []
        except (ValueError, TypeError):
            # prescription JSON is malformed — skip rather than poison the chunk
            meds = []
        for m in meds:
            name = m.get("name") or "unnamed medication"
            dosage = m.get("dosage") or ""
            frequency = m.get("frequency") or ""
            duration = m.get("duration") or ""
            text = f"Prescribed: {name} {dosage} {frequency}"
            if duration:
                text += f" for {duration}"
            parts.append(re.sub(r"\s+", " ", text).strip() + ".")
        if rx.instructions:
            parts.append(f"Prescription instructions: {rx.instructions}")
    return " ".join(parts)


_SEPARATORS = ["\n\n", "\n", ". ", " ", ""]


def split_text(
    text: str,
    chunk_size: Optional[int] = None,
    chunk_overlap: Optional[int] = None,
    separators: Optional[List[str]] = None,
) -> List[str]:
    """Recursive character text splitter (the LangChain algorithm, no
    LangChain): split on the coarsest separator that produces sub-chunk-sized
    pieces, merge neighbours back up to chunk_size, keep chunk_overlap of
    context between merged chunks."""
    chunk_size = chunk_size or config.CHUNK_SIZE
    chunk_overlap = chunk_overlap if chunk_overlap is not None else config.CHUNK_OVERLAP
    separators = separators if separators is not None else _SEPARATORS

    if not text.strip():
        return []

    def _split(seps: List[str], s: str) -> List[str]:
        if len(s) <= chunk_size:
            return [s]
        sep = ""
        remaining: List[str] = []
        for i, candidate in enumerate(seps):
            if candidate == "":
                remaining = [""]
                sep = ""
                break
            if candidate in s:
                sep = candidate
                remaining = seps[i + 1 :]
                break
        if sep == "":
            # Nothing left to split on — hard-cut with overlap.
            out, i = [], 0
            step = max(chunk_size - chunk_overlap, 1)
            while i < len(s):
                out.append(s[i : i + chunk_size])
                i += step
            return out
        pieces = s.split(sep)
        # Re-attach the separator so merged text reads naturally.
        pieces = [p + sep for p in pieces[:-1]] + [pieces[-1]]
        merged: List[str] = []
        buf = ""
        for piece in pieces:
            if buf and len(buf) + len(piece) > chunk_size:
                merged.append(buf)
                tail = buf[-chunk_overlap:] if chunk_overlap > 0 else ""
                buf = tail + piece
            else:
                buf += piece
        if buf.strip():
            merged.append(buf)
        refined: List[str] = []
        for m in merged:
            if len(m) > chunk_size and remaining and remaining != [""]:
                refined.extend(_split(remaining, m))
            else:
                refined.append(m)
        return refined

    return [c.strip() for c in _split(list(separators), text) if c.strip()]
