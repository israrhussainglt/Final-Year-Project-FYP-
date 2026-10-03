// End-to-end exercise of the self-service booking workflow against a RUNNING
// backend — the public form POST, the doctor review queue, allocate (new +
// existing patient), reject with attachment purge, ownership scoping, the
// active-doctor validation, and the upload-hygiene rules.
//
// Prerequisites:
//   npm run seed -- --force      (demo data: Dr. Ayesha Raza, Dr. Bilal Ahmed,
//                                 patient 35202-1234567-1, one hospital admin)
//   npm run dev                  (or npm start) — server on :4000
// Run:
//   node scripts/booking-e2e.mjs [baseUrl]     (default http://localhost:4000)
//
// Every request sends a unique X-Forwarded-For unless one is given, so the
// per-IP rate limits can't bleed between scenarios; the limiter itself gets
// its own scenario at the end.

import fs from "fs";
import path from "path";

const BASE = process.argv[2] || "http://localhost:4000";
const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");
const DOCTOR_LOGIN = { email: "ayesha.raza@pulseid.dev", password: "doctor123" };
const DOCTOR2_LOGIN = { email: "bilal.ahmed@pulseid.dev", password: "doctor123" };
const ADMIN_LOGIN = { email: "admin.lahoregeneral@pulseid.dev", password: "hospitaladmin123" };
const EXISTING_PATIENT_NATIONAL_ID = "35202-1234567-1";

// Minimal valid 1x1 PNG.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

let passed = 0;
let failed = 0;
function ok(cond, label, extra = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

let ipCounter = 0;
const nextIp = () => `10.77.0.${++ipCounter}`;

function jar() {
  const map = new Map();
  return {
    capture(res) {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    header() {
      return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    csrf() {
      return map.get("pulseid_csrf") || "";
    },
  };
}

async function http(method, apiPath, { jar: cookieJar, body, form, ip } = {}) {
  const headers = {};
  if (cookieJar?.header()) headers.cookie = cookieJar.header();
  if (ip) headers["x-forwarded-for"] = ip;
  if (form) {
    // Leave Content-Type to fetch (multipart boundary).
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  // Double-submit CSRF: echo the jar's cookie back as the header on mutations.
  if (method !== "GET" && cookieJar?.csrf()) headers["x-csrf-token"] = cookieJar.csrf();
  const res = await fetch(`${BASE}${apiPath}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  cookieJar?.capture(res);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function bookingForm(overrides = {}) {
  return {
    nationalId: "42301-1234567-8",
    fullName: "E2E Booking Person",
    dateOfBirth: "1995-06-15",
    gender: "female",
    phoneNumber: "0300-1234567",
    email: "",
    address: "",
    bloodGroup: "O+",
    allergies: "",
    chronicConditions: "",
    weightKg: "",
    pediatricianName: "",
    pediatricianPhone: "",
    reason: "e2e booking test",
    ...overrides,
  };
}

function bookingPayload(form, doctorId, contacts = [], files = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, String(v));
  fd.append("doctorId", doctorId);
  contacts.forEach((c, i) => {
    fd.append(`contacts[${i}].fullName`, c.fullName);
    fd.append(`contacts[${i}].relationshipType`, c.relationshipType);
    fd.append(`contacts[${i}].phoneNumber`, c.phoneNumber);
  });
  for (const f of files) {
    fd.append("reports", f.blob, f.name);
  }
  return fd;
}

const png = () => ({ blob: new Blob([PNG_BYTES], { type: "image/png" }), name: `report-${Math.random().toString(36).slice(2)}.png` });
const bigPng = () => ({ blob: new Blob([Buffer.alloc(11 * 1024 * 1024)], { type: "image/png" }), name: "huge.png" });

const uploadCount = () => (fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).length : 0);
const futureIso = (hours = 24) => new Date(Date.now() + hours * 3600 * 1000).toISOString();

// ---------------------------------------------------------------------------

const doctorList = (await http("GET", "/api/booking/doctors")).data.doctors;
const ayesha = doctorList.find((d) => /Ayesha/.test(d.fullName));
let bilal = doctorList.find((d) => /Bilal/.test(d.fullName));
ok(ayesha && bilal, "doctor directory lists both demo doctors");

// --- Hospital admin: deactivate Bilal so the active-doctor checks can be
// exercised before he's restored for the ownership scenarios.
const adminJar = jar();
const adminLogin = await http("POST", "/api/auth/hospital-admin/login", { jar: adminJar, body: ADMIN_LOGIN, ip: nextIp() });
ok(adminLogin.status === 200, "hospital-admin login");
const deact = await http("POST", `/api/hospital-admin/doctors/${bilal.id}/deactivate`, { jar: adminJar, ip: nextIp() });
ok(deact.status === 200, "admin can deactivate a doctor");

console.log("\nPublic booking form (POST /api/booking/requests)");
{
  const before = uploadCount();
  const r1 = await http("POST", "/api/booking/requests", {
    form: bookingPayload(bookingForm(), ayesha.id, [{ fullName: "Guardian One", relationshipType: "Parent", phoneNumber: "0301-1111111" }], [png()]),
    ip: nextIp(),
  });
  ok(r1.status === 201 && r1.data.request?.id, "happy path: 201 with a request id");
  ok(r1.data.request.attachments === 1, "happy path: reports the attachment count");
  var regA = r1.data.request.id;

  const r2 = await http("POST", "/api/booking/requests", {
    form: bookingPayload(bookingForm(), ayesha.id),
    ip: nextIp(),
  });
  ok(r2.status === 400 && /pending/i.test(r2.data.fieldErrors?.doctorId || ""), "duplicate pending request for the same doctor is refused");

  const r3 = await http("POST", "/api/booking/requests", {
    form: bookingPayload(bookingForm({ nationalId: "nope", dateOfBirth: "2099-01-01" }), ayesha.id),
    ip: nextIp(),
  });
  ok(r3.status === 400 && !!r3.data.fieldErrors?.nationalId && !!r3.data.fieldErrors?.dateOfBirth, "invalid CNIC and future DOB are both flagged");

  const threeContacts = [
    { fullName: "A", relationshipType: "Parent", phoneNumber: "1" },
    { fullName: "B", relationshipType: "Parent", phoneNumber: "2" },
    { fullName: "C", relationshipType: "Parent", phoneNumber: "3" },
    { fullName: "D", relationshipType: "Parent", phoneNumber: "4" },
    { fullName: "E", relationshipType: "Parent", phoneNumber: "5" },
    { fullName: "F", relationshipType: "Parent", phoneNumber: "6" },
  ];
  const r4 = await http("POST", "/api/booking/requests", {
    form: bookingPayload(bookingForm(), ayesha.id, threeContacts),
    ip: nextIp(),
  });
  ok(r4.status === 400 && /at most 3/i.test(r4.data.fieldErrors?.contacts || ""), "more than 3 emergency contacts is refused");

  const r5 = await http("POST", "/api/booking/requests", { form: bookingPayload(bookingForm(), bilal.id), ip: nextIp() });
  ok(r5.status === 400 && /no longer available/i.test(r5.data.fieldErrors?.doctorId || ""), "a deactivated doctor can't be booked (would sit pending forever)");

  const mid = uploadCount();
  const r6 = await http("POST", "/api/booking/requests", {
    form: bookingPayload(bookingForm(), ayesha.id, [], [png(), png(), bigPng()]),
    ip: nextIp(),
  });
  ok(r6.status === 400 && /under 10 MB/i.test(r6.data.error || ""), "an oversized file among valid ones rejects the submission");
  ok(uploadCount() === mid, "no files are orphaned on disk after the multer error", `before=${mid} after=${uploadCount()}`);
  ok(uploadCount() === before + 1, "exactly one file (the happy path's) exists on disk");

  const r7 = await http("POST", "/api/booking/requests", {
    form: bookingPayload(bookingForm({ nationalId: EXISTING_PATIENT_NATIONAL_ID, fullName: "Existing Patient" }), ayesha.id),
    ip: nextIp(),
  });
  ok(r7.status === 201, "an existing patient can book a follow-up (no enumeration leak)");
  var regE = r7.data.request.id;
}

console.log("\nDoctor review queue (ayesha)");
const doctorJar = jar();
{
  const login = await http("POST", "/api/auth/doctor/login", { jar: doctorJar, body: DOCTOR_LOGIN, ip: nextIp() });
  ok(login.status === 200, "doctor login");

  const list = await http("GET", "/api/doctor/registrations", { jar: doctorJar, ip: nextIp() });
  const rowA = list.data.registrations?.find((r) => r.id === regA);
  const rowE = list.data.registrations?.find((r) => r.id === regE);
  ok(!!rowA && rowA.status === "pending" && rowA.attachmentCount === 1, "queue lists the pending request with its attachment");
  ok(rowE?.matchedPatientId, "queue flags the existing-patient match for the doctor");

  const detail = await http("GET", `/api/doctor/registrations/${regA}`, { jar: doctorJar, ip: nextIp() });
  ok(detail.status === 200 && detail.data.attachments?.length === 1, "detail shows the attachment metadata");

  const dl = await fetch(`${BASE}/api/doctor/registrations/${regA}/attachments/${detail.data.attachments[0].id}`, {
    headers: { cookie: doctorJar.header(), "x-forwarded-for": nextIp() },
  });
  const dlBytes = Buffer.from(await dl.arrayBuffer());
  ok(dl.status === 200 && dlBytes.equals(PNG_BYTES), "attachment download returns the original bytes");

  const alloc = await http("POST", `/api/doctor/registrations/${regA}/allocate`, {
    jar: doctorJar,
    body: { scheduledAt: futureIso() },
    ip: nextIp(),
  });
  ok(alloc.status === 200 && alloc.data.patientId && alloc.data.appointmentId, "allocate creates the patient + appointment");
  var newPatientId = alloc.data.patientId;

  const again = await http("POST", `/api/doctor/registrations/${regA}/allocate`, {
    jar: doctorJar,
    body: { scheduledAt: futureIso() },
    ip: nextIp(),
  });
  ok(again.status === 400 && /already/i.test(again.data.error || ""), "allocating twice is refused");

  const allocE = await http("POST", `/api/doctor/registrations/${regE}/allocate`, {
    jar: doctorJar,
    body: { scheduledAt: futureIso() },
    ip: nextIp(),
  });
  ok(
    allocE.status === 200 && allocE.data.patientId === rowE.matchedPatientId,
    "allocating an existing patient books onto their record (no duplicate)"
  );

  const chart = await http("GET", `/api/patients/${newPatientId}`, { jar: doctorJar, ip: nextIp() });
  ok(
    chart.status === 200 &&
      chart.data.patient?.national_id === "42301-1234567-8" &&
      (chart.data.records || []).some((r) => r.record_type === "registration") &&
      (chart.data.contacts || []).length > 0,
    "the new patient's chart exists with registration visit + emergency contacts"
  );
}

console.log("\nReject flow with attachment purge");
{
  const r = await http("POST", "/api/booking/requests", {
    form: bookingPayload(bookingForm({ nationalId: "42401-1234567-6" }), ayesha.id, [], [png()]),
    ip: nextIp(),
  });
  const rejectableId = r.data.request.id;
  const before = uploadCount();

  const detail = await http("GET", `/api/doctor/registrations/${rejectableId}`, { jar: doctorJar, ip: nextIp() });
  ok(detail.data.attachments?.length === 1, "rejectable request has its attachment");

  const rej = await http("POST", `/api/doctor/registrations/${rejectableId}/reject`, { jar: doctorJar, ip: nextIp() });
  ok(rej.status === 200 && rej.data.attachmentsRemoved === 1, "reject reports the purged attachment");
  ok(uploadCount() === before - 1, "the rejected request's file is gone from disk");
}

console.log("\nOwnership scoping + live-session deactivation");
const doctor2Jar = jar();
{
  const react = await http("POST", `/api/hospital-admin/doctors/${bilal.id}/reactivate`, { jar: adminJar, ip: nextIp() });
  ok(react.status === 200, "admin can reactivate a doctor");

  const login = await http("POST", "/api/auth/doctor/login", { jar: doctor2Jar, body: DOCTOR2_LOGIN, ip: nextIp() });
  ok(login.status === 200, "second doctor login");

  const foreign = await http("GET", `/api/doctor/registrations/${regA}`, { jar: doctor2Jar, ip: nextIp() });
  ok(foreign.status === 404, "one doctor cannot read another doctor's request (404, not 403)");

  const foreignAlloc = await http("POST", `/api/doctor/registrations/${regE}/allocate`, {
    jar: doctor2Jar,
    body: { scheduledAt: futureIso() },
    ip: nextIp(),
  });
  ok(foreignAlloc.status === 404, "one doctor cannot allocate another doctor's request");

  await http("POST", `/api/hospital-admin/doctors/${bilal.id}/deactivate`, { jar: adminJar, ip: nextIp() });
  const blocked = await http("GET", "/api/doctor/registrations", { jar: doctor2Jar, ip: nextIp() });
  ok(blocked.status === 401, "deactivation takes effect immediately on the doctor's live session");
  bilal = { id: bilal.id };
}

console.log("\nPatient-side booking paths");
const patientJar = jar();
{
  const otp = await http("POST", "/api/auth/patient/request-otp", {
    jar: patientJar,
    body: { nationalId: EXISTING_PATIENT_NATIONAL_ID },
    ip: nextIp(),
  });
  ok(otp.status === 200 && otp.data.demoOtp, "patient OTP arrives on-screen in demo mode");
  const verify = await http("POST", "/api/auth/patient/verify-otp", {
    jar: patientJar,
    body: { nationalId: EXISTING_PATIENT_NATIONAL_ID, code: otp.data.demoOtp },
    ip: nextIp(),
  });
  ok(verify.status === 200, "patient OTP verify");

  const toDeactivated = await http("POST", "/api/patient/appointments", {
    jar: patientJar,
    body: { doctorId: bilal.id, reason: "e2e" },
    ip: nextIp(),
  });
  ok(toDeactivated.status === 404 && /no longer available/i.test(toDeactivated.data.error || ""), "patient can't request an appointment with a deactivated doctor");

  const fine = await http("POST", "/api/patient/appointments", {
    jar: patientJar,
    body: { doctorId: ayesha.id, reason: "e2e request" },
    ip: nextIp(),
  });
  ok(fine.status === 201 && fine.data.appointment?.status === "requested", "patient appointment request works and starts as 'requested'");
}

console.log("\nRate limiting (5/hour per IP on the public form)");
{
  const sharedIp = nextIp();
  let last;
  for (let i = 0; i < 6; i++) {
    last = await http("POST", "/api/booking/requests", { form: bookingPayload(bookingForm(), ayesha.id), ip: sharedIp });
    if (last.status === 429) break;
  }
  ok(last.status === 429, "the 6th booking request from one IP in an hour is rate-limited");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
