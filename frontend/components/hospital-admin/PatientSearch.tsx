"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, inputClass } from "@/components/ui";
import { apiUrl } from "@/lib/api";

type Result = {
  id: string;
  nationalId: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  bloodGroup: string;
};

// Hospital-admin variant of the doctor PatientSearch — same search
// experience, but hits the hospital-admin route (which never returns
// medical history) and links into the hospital-admin edit page instead of
// the doctor's full clinical chart.
export function PatientSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/hospital-admin/patients/search?q=${encodeURIComponent(query.trim())}`), {
          credentials: "include",
        });
        const data = await res.json();
        setResults(data.patients || []);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="relative">
      <input
        className={`${inputClass} text-base py-3.5`}
        placeholder="Search by National ID or name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      {query.trim().length >= 2 && (
        <Card className="absolute z-10 mt-2 w-full overflow-hidden">
          {loading && <div className="p-4 text-sm text-sage">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="p-4 text-sm text-sage">No patient matches “{query}”.</div>
          )}
          {!loading &&
            results.map((r) => (
              <button
                key={r.id}
                onClick={() => router.push(`/hospital-admin/patients/${r.id}`)}
                className="w-full text-left px-4 py-3 hover:bg-teal-light/60 transition-colors border-b border-line last:border-0 flex items-center justify-between"
              >
                <div>
                  <div className="font-medium text-ink">{r.fullName}</div>
                  <div className="text-xs text-sage font-mono mt-0.5">{r.nationalId}</div>
                </div>
                <span className="text-xs text-sage">{r.bloodGroup}</span>
              </button>
            ))}
        </Card>
      )}
    </div>
  );
}
