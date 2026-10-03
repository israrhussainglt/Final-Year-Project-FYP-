"use client";

import { Card, Badge, formatDate, recordTypeLabel, recordTypeTone } from "@/components/ui";
import { PulseMark } from "@/components/PulseMark";
import type { MedicalReport } from "@/lib/types";

const ACTION_LABEL: Record<string, string> = {
  record_viewed: "Viewed the record",
  record_created: "Added a new visit",
  qr_scanned: "Scanned the CNIC / emergency QR",
  login: "Signed in",
  patient_registered: "Registered the patient",
};

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
    return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

/**
 * One report, two audiences. `audience="patient"` renders a personal-copy
 * framing (their own record, plain language); `audience="doctor"` renders an
 * official clinical letterhead suitable for printing and filing at a
 * hospital, with a signature block. The underlying data is identical either
 * way — nothing is hidden or added between the two, only the framing.
 */
export function MedicalReportView({
  report,
  audience,
  hospitalName,
}: {
  report: MedicalReport;
  audience: "patient" | "doctor";
  hospitalName?: string | null;
}) {
  const { patient, summary } = report;

  return (
    <div className="print-page max-w-4xl mx-auto bg-white border border-line rounded-xl shadow-card p-6 md:p-10 print:shadow-none print:border-none">
      {/* ---------- Letterhead ---------- */}
      <div className="flex items-start justify-between border-b border-line pb-6 mb-6">
        <div>
          <PulseMark className="w-32 h-7 mb-3" />
          {audience === "doctor" ? (
            <>
              <div className="eyebrow text-teal">Official clinical report</div>
              <div className="text-sm text-sage mt-1">{hospitalName || "PulseID Network Hospital"}</div>
            </>
          ) : (
            <>
              <div className="eyebrow text-teal">Your personal medical report</div>
              <div className="text-sm text-sage mt-1">Generated from your PulseID record</div>
            </>
          )}
        </div>
        <div className="text-right text-xs text-sage font-mono leading-relaxed">
          <div>Report ID: {report.reportId.slice(0, 8)}</div>
          <div>Generated: {formatDateTime(report.generatedAt)}</div>
          <div>By: {report.generatedByName}</div>
        </div>
      </div>

      {/* ---------- Patient identification ---------- */}
      <div className="grid sm:grid-cols-2 gap-6 mb-6">
        <div>
          <h1 className="font-display text-2xl">{patient.fullName}</h1>
          <div className="text-sm text-sage font-mono mt-1">National ID: {patient.nationalId}</div>
          <div className="flex flex-wrap gap-2 mt-3">
            <Badge tone="alert">{patient.bloodGroup}</Badge>
            <Badge tone="sage">
              {patient.age} yrs · {patient.gender}
            </Badge>
            <Badge tone="sage">DOB {formatDate(patient.dateOfBirth)}</Badge>
          </div>
        </div>
        <dl className="text-sm space-y-2">
          <div className="flex justify-between border-b border-dotted border-line pb-1">
            <dt className="text-sage">Phone</dt>
            <dd>{patient.phoneNumber}</dd>
          </div>
          {patient.email && (
            <div className="flex justify-between border-b border-dotted border-line pb-1">
              <dt className="text-sage">Email</dt>
              <dd>{patient.email}</dd>
            </div>
          )}
          {patient.address && (
            <div className="flex justify-between gap-4 border-b border-dotted border-line pb-1">
              <dt className="text-sage shrink-0">Address</dt>
              <dd className="text-right">{patient.address}</dd>
            </div>
          )}
          <div className="flex justify-between border-b border-dotted border-line pb-1">
            <dt className="text-sage">On PulseID since</dt>
            <dd>{formatDate(patient.recordCreatedAt)}</dd>
          </div>
        </dl>
      </div>

      {/* ---------- Risk / alert banner ---------- */}
      {summary.riskFlags.length > 0 && (
        <div className="rounded-lg bg-alert-light border border-alert/30 p-4 mb-6">
          <div className="eyebrow text-alert mb-2">Clinical alerts</div>
          <ul className="text-sm text-alert space-y-1">
            {summary.riskFlags.map((f, i) => (
              <li key={i}>⚠ {f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------- Summary stats ---------- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <StatBox label="Total visits" value={summary.totalVisits} />
        <StatBox label="Prescriptions issued" value={summary.totalPrescriptions} />
        <StatBox label="Current medications" value={summary.currentMedicationCount} />
        <StatBox
          label="Most recent visit"
          value={summary.mostRecentVisit ? formatDate(summary.mostRecentVisit.date) : "—"}
          small
        />
      </div>

      {/* ---------- Allergies & conditions ---------- */}
      <Section title="Allergies & chronic conditions">
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-sage uppercase tracking-wide mb-1">Allergies</div>
            <div>{patient.allergies || "None recorded"}</div>
          </div>
          <div>
            <div className="text-xs text-sage uppercase tracking-wide mb-1">Chronic conditions</div>
            <div>{patient.chronicConditions || "None recorded"}</div>
          </div>
        </div>
      </Section>

      {/* ---------- Current medications ---------- */}
      <Section title={`Current medications (${report.currentMedications.length})`}>
        {report.currentMedications.length === 0 ? (
          <p className="text-sm text-sage">No medications currently marked as active.</p>
        ) : (
          // Horizontal scroll on narrow screens instead of clipping columns
          // or forcing the whole page to scroll sideways. `-mx-1 px-1` keeps
          // the scroll shadow/edge from looking clipped against the card
          // padding. Printing still renders the full table (print styles
          // ignore overflow), so the letterhead PDF/print view is unaffected.
          <div className="overflow-x-auto -mx-1 px-1 print:overflow-visible">
            <table className="w-full min-w-[480px] text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs text-sage uppercase tracking-wide border-b border-line">
                  <th className="py-2 pr-2">Medication</th>
                  <th className="py-2 pr-2">Dosage</th>
                  <th className="py-2 pr-2">Frequency</th>
                  <th className="py-2 pr-2">Duration</th>
                  <th className="py-2">Prescribed by</th>
                </tr>
              </thead>
              <tbody>
                {report.currentMedications.map((m, i) => (
                  <tr key={i} className="border-b border-line/60">
                    <td className="py-2 pr-2 font-medium">{m.name}</td>
                    <td className="py-2 pr-2">{m.dosage}</td>
                    <td className="py-2 pr-2">{m.frequency}</td>
                    <td className="py-2 pr-2">{m.duration}</td>
                    <td className="py-2">{m.prescribedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---------- Full visit timeline ---------- */}
      <Section title={`Complete visit history (${report.timeline.length})`}>
        {report.timeline.length === 0 ? (
          <p className="text-sm text-sage">No visits recorded yet.</p>
        ) : (
          <ol className="relative border-l border-line ml-2 space-y-5">
            {report.timeline.map((r) => (
              <li key={r.id} className="ml-5">
                <span className="absolute -translate-x-[calc(0.3125rem+1px)] mt-1.5 w-2.5 h-2.5 rounded-full bg-teal border-2 border-white shadow" />
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={recordTypeTone(r.type)}>{recordTypeLabel(r.type)}</Badge>
                    <span className="text-xs text-sage">{formatDate(r.visitDate)}</span>
                  </div>
                  {r.clinician && <span className="text-xs text-sage">{r.clinician}</span>}
                </div>
                {r.diagnosis && <p className="font-medium mt-1.5 text-sm">{r.diagnosis}</p>}
                {r.symptoms && <p className="text-sm text-sage mt-1">Symptoms: {r.symptoms}</p>}
                {r.notes && <p className="text-sm mt-1 leading-relaxed">{r.notes}</p>}
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* ---------- Prescription history ---------- */}
      <Section title={`Prescription history (${report.prescriptions.length})`}>
        {report.prescriptions.length === 0 ? (
          <p className="text-sm text-sage">No prescriptions on file.</p>
        ) : (
          <div className="space-y-3">
            {report.prescriptions.map((rx) => (
              <Card key={rx.id} className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs text-sage">
                    Issued {formatDate(rx.issuedDate)}
                    {rx.clinician ? ` · ${rx.clinician}` : ""}
                  </span>
                  {rx.isCurrent && <Badge tone="teal">Current</Badge>}
                </div>
                <ul className="mt-2 space-y-1">
                  {rx.medications.map((m, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{m.name}</span> — {m.dosage}, {m.frequency} for {m.duration}
                    </li>
                  ))}
                </ul>
                {rx.instructions && <p className="text-sm text-sage mt-2">{rx.instructions}</p>}
              </Card>
            ))}
          </div>
        )}
      </Section>

      {/* ---------- Emergency contacts ---------- */}
      <Section title="Emergency contacts">
        {report.emergencyContacts.length === 0 ? (
          <p className="text-sm text-sage">None on file.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {report.emergencyContacts.map((c, i) => (
              <div key={i} className="text-sm border border-line rounded-lg p-3">
                <div className="font-medium">
                  {c.fullName} {c.isPrimary && <span className="text-xs text-teal-dark font-normal">· primary</span>}
                </div>
                <div className="text-sage">
                  {c.relationship} · {c.phone}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ---------- Access / audit trail ---------- */}
      <Section title="Recent record access (audit trail)">
        {report.accessLog.length === 0 ? (
          <p className="text-sm text-sage">No access events logged yet.</p>
        ) : (
          <ul className="text-sm divide-y divide-line/60">
            {report.accessLog.map((a, i) => (
              <li key={i} className="py-2 flex items-center justify-between gap-4">
                <span>
                  <span className="font-medium">{a.actorName}</span>{" "}
                  <span className="text-sage">({a.actorRole.replace("_", " ")})</span> —{" "}
                  {ACTION_LABEL[a.action] || a.action}
                </span>
                <span className="text-xs text-sage font-mono shrink-0">{formatDateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ---------- Footer ---------- */}
      <div className="mt-10 pt-6 border-t border-line">
        {audience === "doctor" ? (
          <div className="grid sm:grid-cols-2 gap-8 text-sm">
            <div>
              <div className="text-xs text-sage uppercase tracking-wide mb-8">Reviewing clinician signature</div>
              <div className="border-t border-ink w-48" />
              <div className="text-xs text-sage mt-1">{report.generatedByName}</div>
            </div>
            <div className="sm:text-right text-xs text-sage leading-relaxed">
              This report reflects the PulseID record at the time it was generated and is provided
              for continuity-of-care purposes. Verify identity against National ID before relying on
              it for clinical decisions.
            </div>
          </div>
        ) : (
          <p className="text-xs text-sage leading-relaxed">
            This is your personal copy of your PulseID medical record, generated on{" "}
            {formatDateTime(report.generatedAt)}. You can share it with any clinician — it contains
            the same information a doctor would see when they open your record on PulseID.
          </p>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <div className="eyebrow text-sage mb-3">{title}</div>
      {children}
    </div>
  );
}

function StatBox({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-paper p-3">
      <div className={small ? "text-sm font-semibold" : "text-2xl font-display"}>{value}</div>
      <div className="text-xs text-sage mt-0.5">{label}</div>
    </div>
  );
}
