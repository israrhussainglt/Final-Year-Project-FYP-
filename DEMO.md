# PulseID — Hackathon Demo Guide

Verified working end-to-end (backend + frontend booted together, every route
below hit and confirmed, including risk scoring and the follow-up sweep)
before this was packaged.

## 1. Start it (two terminals)

```bash
# Terminal 1 — backend
cd backend
cp .env.example .env        # defaults are fine for a local demo
npm install
npm run dev                  # seeds the DB on first run, starts on :4000

# Terminal 2 — frontend
cd frontend
cp .env.example .env   # defaults are fine for a local demo
npm install
npm run dev                  # starts on :3000
```

Open **http://localhost:3000**.

## 2. Demo script (~4 minutes core, ~5 with the optional Beat 6)

**Beat 1 — the pitch (30s)**
Land on `/`. One National ID, one lifelong record, instantly readable by a
doctor and safely by a stranger via QR.

**Beat 2 — the emergency scan (60s)**
Open `/emergency/11082970` directly, or physically scan your printed QR card
(bound to Dildidar Hussain). Point out: only blood group, allergies, chronic
conditions, and emergency contacts are shown — no diagnoses, no visit
history. This is the "unconscious patient, first responder" scenario.

**Beat 3 — doctor login → scan → full record (90s)**
Go to `/doctor/login` → `ayesha.raza@pulseid.dev` / `doctor123`.
Use **Scan** in the dashboard and enter/scan `11082970` — it jumps straight
to Dildidar's full record: visit history, prescriptions, everything.
Point out the letterhead **Report** button — printable/PDF-ready.

**Beat 4 — register a new patient live (60s)**
From the dashboard, **Register patient** — fill it out live on stage. This
proves the "add anyone in seconds" story, and gives every new patient their
own live, rotating QR immediately.

**Beat 5 — the security story (30s)**
Open `/patient/login`, sign in with National ID `35202-1234567-1` + the
on-screen demo OTP (no real SMS gateway needed for the demo). Show
`/patient/qr` — note the token is different every time it's scanned
(rotates), and `/patient/audit-log` — every single access to their record,
logged and visible to them.

**The one twist worth calling out explicitly**: a *physical, printed* QR
card can't rotate itself the way an in-app one does — so Dildar's card is
deliberately exempted from the anti-replay rotation (`qr_is_static`) while
every other patient's live QR still rotates on every scan. That's the kind
of edge case that separates "made an app" from "thought about how it's
actually used."

**Beat 6 — optional: proactive care (60s)**
Back in the doctor dashboard, open a patient and add a visit with vitals
filled in (e.g. blood pressure 165/112) — the risk flag appears immediately
with plain-language factors, not a black-box score. Then, from the same
patient's page, **Start follow-up** (pick "Postpartum", every 3 days). Run
`npm run followups -- --run-now` in a spare terminal to fire the sweep,
sign in as the patient, and answer the check-in on `/patient/followups`
with a concerning value — it shows up on the doctor's `/doctor/followups`
alerts list right away. Point out: both the risk score and the alert flag
are plain rule-based thresholds, not opaque ML — whoever's looking at
either one can see exactly why it fired.

**Beat 7 — optional: AI-drafted report (RAG) (90s, needs `GROQ_API_KEY`)**

On the same patient's page, add a visit typing ONLY keywords in the notes
("fever 4 days, headache, ?dengue, paracetamol, CBC test"). On that visit's
timeline card click **✦ Draft full report with AI** — in seconds the RAG
pipeline retrieves this patient's profile, past visits and any uploaded
report PDFs, and Groq drafts a structured report with every prescription
labelled (dose, frequency, duration, instructions). Edit anything, then
**Approve & send to patient** — the patient's bell badge lights up
instantly. Point out: the AI never saves anything by itself (doctor
approves), the retrieval is local embeddings on SQLite, and the citations
name the visits/reports each claim came from.

## 3. Login cheat-sheet

| Role | Identifier | Password / Code |
|---|---|---|
| Doctor | `ayesha.raza@pulseid.dev` | `doctor123` |
| Doctor (2nd) | `bilal.ahmed@pulseid.dev` | `doctor123` |
| Patient | National ID `35202-1234567-1` (Hassan Tariq) | OTP shown on screen (demo mode) |
| Physical card | scan / visit `/emergency/11082970` | — (Dildidar Hussain, public page) |

## 4. If something doesn't come up

- **Blank patient list / 401s** → backend and frontend `SESSION_SECRET` must
  match exactly (both `.env` files, same value).
- **CORS error in console** → backend `CORS_ORIGIN` must include the exact
  frontend origin (`http://localhost:3000` by default).
- **"Too many requests"** → the rate limiter is intentionally strict for a
  security demo; wait ~60s or restart the backend to clear it.
- **Static QR card doesn't resolve** → confirm `qr_is_static = 1` for that
  patient: `sqlite3 backend/data/pulseid.db "SELECT full_name, qr_is_static FROM patients;"`
- **"Draft report with AI" says not configured** → `backend/.env` has no
  `GROQ_API_KEY`. Paste a key from <https://console.groq.com/keys> and
  restart the backend (`.env` is read at startup). The first draft also
  downloads the local embedding model (~25 MB, once, into
  `backend/data/models`) — every draft after that is instant-warm.
