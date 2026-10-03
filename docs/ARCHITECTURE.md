# PulseID — Architecture

One sentence: **one National ID, one lifelong medical record, four surfaces built around who's allowed to see what.**

## The four surfaces, and why they're separated

| Surface | Who | Can see |
|---|---|---|
| **Patient portal** | Patients & guardians | Their own full record, dependents, appointments, audit log of who accessed their data |
| **Doctor dashboard** | Clinicians | Full record of any patient they look up — diagnoses, prescriptions, visit history |
| **Hospital admin** | Hospital administrators | Their hospital's doctors, appointments, oversight — not patient medical detail |
| **Emergency scan** | Anyone (no login) | Blood group, allergies, chronic conditions, emergency contacts — **nothing else** |
| **Analytics** | Public-health analysts | De-identified, aggregated population data — never a named patient's record |

The emergency scan and analytics rows are the two that matter most architecturally, because they're the two places PulseID deliberately shows *less* than it could:

- The emergency page returns only life-critical fields, scoped at the API layer, not hidden in the UI — a first responder or a stranger scanning a printed card can never pull diagnoses or visit history through it, even by guessing a URL.
- Analytics never touches patient-identifiable data. It's a fully separate service with its own database, its own login system, and its own secret (`ANALYTICS_SESSION_SECRET`, distinct from the patient/doctor `SESSION_SECRET`). It reaches the backend only over Docker's internal network, authenticated with a service-to-service key (`ANALYTICS_SERVICE_KEY`) that's never exposed to a browser.

## Services

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  frontend   │────▶│   backend   │◀────│  analytics   │
│  (Next.js)  │     │  (Express)  │     │  (Next.js)   │
│  :3000      │     │  :4000      │     │  :3100       │
└─────────────┘     └──────┬──────┘     └───────┬──────┘
                            │                    │
                     ┌──────▼──────┐    ┌────────▼────────┐
                     │ pulseid.db  │    │  analytics.db    │
                     │  (SQLite)   │    │   (SQLite)       │
                     └─────────────┘    └──────────────────┘

Also running: backend-reminders (appointment SMS/email), backend-followups
(proactive follow-up check-in prompts) and analytics-scheduler
(weekly/monthly public-health bulletins) — all background workers, no
public port.
```

- **frontend** — the patient, doctor, hospital-admin, and emergency-scan UIs live in one Next.js app, gated by role-based auth and route, not by separate deployments. A patient and a doctor never share a session, but they do share infrastructure — one thing to build, test, and deploy.
- **backend** — the single source of truth. Owns auth for patients, doctors, and hospital admins; owns the emergency-scan scoping logic; owns the rotating-QR anti-replay mechanism; owns the rule-based vitals risk scorer and the proactive follow-up check-in sweep.
- **analytics** — intentionally a separate app, separate database, separate login. This is the trust-boundary decision worth explaining out loud: population-health reporting and a named patient's chart should never be one query away from each other, even internally.

## Two features worth knowing cold

**Risk scoring is rule-based, not a trained model.** `lib/risk-scoring.ts` turns a visit's optional vitals (blood pressure, blood sugar, temperature, heart rate) into a low/mid/high flag via fixed clinical thresholds, always returning the plain-language factors that produced it plus a disclaimer that it's a flag, not a diagnosis. That's a deliberate choice over an opaque ML classifier — every score a doctor or patient sees can be fully explained and audited.

**Follow-up alerting never depends on AI.** The proactive follow-up sweep (`lib/followup-agent.ts`, run by the standalone `backend-followups` worker) prompts patients for scheduled check-ins and flags concerning answers with a deterministic threshold check (`flagCheckinResponses`). An AI-written doctor-facing summary is layered on top when a provider is configured, but it's a convenience the alert never waits on — a `concern`/`urgent` flag fires correctly with zero AI configured.

## Two details worth knowing cold

**Rotating QR, with one deliberate exception.** Every patient's in-app emergency QR rotates on each scan, so a photo of someone's screen can't be replayed later. A *printed* card can't rotate itself — so printed cards are explicitly flagged `qr_is_static` in the schema and exempted from rotation, while everything else still rotates. That's a real constraint (physical cards are static objects) handled as a deliberate exception, not an oversight.

**Scoped, not hidden.** The emergency endpoint doesn't return a full patient object with fields hidden in the UI — it queries and returns only the emergency-relevant columns at the API layer. Someone reading network traffic instead of the rendered page sees the same restricted set a first responder does. It goes one step further for minors specifically: their exact date of birth is withheld from the emergency response (age alone is enough for triage), one fewer identifying detail exposed to whoever scanned the card.

## Running it

See `DEMO.md` for the demo script and login cheat-sheet, or `docker-compose.yml` for the full production-shaped setup (healthchecks, background workers, persistent volumes).
