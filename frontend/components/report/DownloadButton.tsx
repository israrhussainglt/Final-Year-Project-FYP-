"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { apiUrl, readCsrfCookie } from "@/lib/api";

// Triggers a real file download of the server-rendered export (PDF or
// JSON), as opposed to PrintButton which just opens the browser's print
// dialog on the on-screen HTML. Downloads via fetch + blob rather than a
// plain <a href> so the browser sends the session cookie and we can show a
// loading/error state — a direct link to an API route wouldn't carry auth.
export function DownloadButton({ endpoint, filenamePrefix }: { endpoint: string; filenamePrefix: string }) {
  const [busy, setBusy] = useState<"pdf" | "json" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: "pdf" | "json") {
    setBusy(format);
    setError(null);
    try {
      const res = await fetch(apiUrl(`${endpoint}?format=${format}`), {
        credentials: "include",
        headers: { "x-csrf-token": readCsrfCookie() || "" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Download failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filenamePrefix}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => download("pdf")} disabled={busy !== null}>
          {busy === "pdf" ? "Preparing…" : "⬇ Download PDF"}
        </Button>
        <Button variant="ghost" onClick={() => download("json")} disabled={busy !== null}>
          {busy === "json" ? "Preparing…" : "Export JSON"}
        </Button>
      </div>
      {error && <p className="text-xs text-alert">{error}</p>}
    </div>
  );
}
