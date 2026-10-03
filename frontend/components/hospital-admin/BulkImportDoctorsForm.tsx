"use client";

import { ChangeEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";

type ParsedRow = { fullName: string; email: string; password: string; licenseNumber: string; specialization: string };
type RowResult = { row: number; ok: boolean; error?: string; doctor?: { id: string; fullName: string; email: string } };

const EXPECTED_HEADERS = ["fullName", "email", "password", "licenseNumber", "specialization"];

const TEMPLATE_CSV =
  "fullName,email,password,licenseNumber,specialization\n" +
  "Dr. Sana Malik,sana.malik@example.com,temporaryPass123,PMC-10234,Pediatrics\n" +
  "Dr. Usman Ali,usman.ali@example.com,temporaryPass123,PMC-10235,";

// Minimal RFC4180-ish CSV parser: handles quoted fields, escaped quotes
// ("" inside a quoted field), and commas/newlines inside quotes. Good
// enough for the small, admin-authored files this form expects — not a
// general-purpose CSV library.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n") {
      pushRow();
    } else if (c === "\r") {
      // skip, \n handles the row break
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

function rowsToParsed(raw: string[][]): { rows: ParsedRow[]; error: string | null } {
  if (raw.length === 0) return { rows: [], error: "The file is empty." };
  const header = raw[0].map((h) => h.trim());
  const missing = EXPECTED_HEADERS.filter((h) => h !== "specialization" && !header.includes(h));
  if (missing.length > 0) {
    return { rows: [], error: `Missing required column(s): ${missing.join(", ")}.` };
  }
  const idx = Object.fromEntries(EXPECTED_HEADERS.map((h) => [h, header.indexOf(h)]));
  const dataRows = raw.slice(1);
  const rows = dataRows.map((r) => ({
    fullName: (r[idx.fullName] || "").trim(),
    email: (r[idx.email] || "").trim(),
    password: (r[idx.password] || "").trim(),
    licenseNumber: (r[idx.licenseNumber] || "").trim(),
    specialization: idx.specialization >= 0 ? (r[idx.specialization] || "").trim() : "",
  }));
  return { rows, error: null };
}

export function BulkImportDoctorsForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [results, setResults] = useState<RowResult[] | null>(null);

  function reset() {
    setParsed(null);
    setParseError(null);
    setFileName(null);
    setSubmitError(null);
    setResults(null);
  }

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResults(null);
    setSubmitError(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const { rows, error } = rowsToParsed(parseCsv(text));
      if (error) {
        setParseError(error);
        setParsed(null);
        return;
      }
      if (rows.length === 0) {
        setParseError("No data rows found below the header.");
        setParsed(null);
        return;
      }
      if (rows.length > 200) {
        setParseError(`This file has ${rows.length} rows — imports are limited to 200 at a time.`);
        setParsed(null);
        return;
      }
      setParseError(null);
      setParsed(rows);
    };
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "doctor-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function submit() {
    if (!parsed) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(apiUrl("/api/hospital-admin/doctors/bulk"), {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": readCsrfCookie() || "" },
        body: JSON.stringify({ rows: parsed }),
      });
      const data = await res.json();
      if (!res.ok && !data.results) {
        setSubmitError(data.error || "Import failed.");
        return;
      }
      setResults(data.results || []);
      if ((data.created || 0) > 0) router.refresh();
    } catch {
      setSubmitError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Import CSV
      </Button>
    );
  }

  const createdCount = results?.filter((r) => r.ok).length ?? 0;

  return (
    <div
      className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4"
      onClick={() => {
        setOpen(false);
        reset();
      }}
    >
      <div
        className="bg-white rounded-xl border border-line shadow-card w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl mb-1">Bulk import doctors</h2>
        <p className="text-sm text-sage mb-5">
          Upload a CSV with columns <code className="text-xs bg-line/60 px-1 py-0.5 rounded">fullName</code>,{" "}
          <code className="text-xs bg-line/60 px-1 py-0.5 rounded">email</code>,{" "}
          <code className="text-xs bg-line/60 px-1 py-0.5 rounded">password</code>,{" "}
          <code className="text-xs bg-line/60 px-1 py-0.5 rounded">licenseNumber</code>, and optionally{" "}
          <code className="text-xs bg-line/60 px-1 py-0.5 rounded">specialization</code>. Every row creates its own
          account at this hospital — rows with a problem are skipped and reported, they won't block the rest.
        </p>

        {!results && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <label className="focus-ring inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm font-medium text-ink cursor-pointer hover:border-teal">
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
                Choose CSV file
              </label>
              {fileName && <span className="text-xs text-sage truncate">{fileName}</span>}
              <button type="button" className="focus-ring text-xs text-teal-dark hover:underline ml-auto" onClick={downloadTemplate}>
                Download template
              </button>
            </div>

            {parseError && <p className="text-sm text-alert mb-4">{parseError}</p>}

            {parsed && (
              <Card className="mb-5 overflow-hidden">
                <div className="px-4 py-2 bg-paper border-b border-line text-xs text-sage">
                  {parsed.length} doctor{parsed.length === 1 ? "" : "s"} ready to import
                </div>
                <div className="max-h-56 overflow-y-auto overflow-x-auto">
                  <table className="w-full min-w-[420px] text-xs">
                    <thead>
                      <tr className="text-left text-sage border-b border-line">
                        <th className="px-4 py-2 font-medium">Name</th>
                        <th className="px-4 py-2 font-medium">Email</th>
                        <th className="px-4 py-2 font-medium">License</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.map((r, i) => (
                        <tr key={i} className="border-b border-line last:border-0">
                          <td className="px-4 py-1.5 text-ink">{r.fullName || <span className="text-alert">missing</span>}</td>
                          <td className="px-4 py-1.5 text-sage">{r.email || <span className="text-alert">missing</span>}</td>
                          <td className="px-4 py-1.5 text-sage">{r.licenseNumber || <span className="text-alert">missing</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {submitError && <p className="text-sm text-alert mb-4">{submitError}</p>}

            <div className="flex justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Cancel
              </Button>
              <Button type="button" onClick={submit} disabled={!parsed || submitting}>
                {submitting ? "Importing…" : `Import ${parsed ? parsed.length : ""} doctor${parsed && parsed.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </>
        )}

        {results && (
          <>
            <Card className="mb-5 overflow-hidden">
              <div className="px-4 py-2 bg-paper border-b border-line text-xs text-sage">
                {createdCount} of {results.length} created
              </div>
              <div className="max-h-72 overflow-y-auto overflow-x-auto">
                <table className="w-full min-w-[320px] text-xs">
                  <thead>
                    <tr className="text-left text-sage border-b border-line">
                      <th className="px-4 py-2 font-medium">Row</th>
                      <th className="px-4 py-2 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.row} className="border-b border-line last:border-0">
                        <td className="px-4 py-1.5 text-sage">{r.row}</td>
                        <td className="px-4 py-1.5">
                          {r.ok ? (
                            <span className="text-teal-dark">Created — {r.doctor?.email}</span>
                          ) : (
                            <span className="text-alert">{r.error}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  reset();
                }}
              >
                Import another file
              </Button>
              <Button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Done
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
