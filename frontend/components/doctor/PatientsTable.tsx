"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Card, age, formatDate, inputClass } from "@/components/ui";

export type PatientRow = {
  id: string;
  nationalId: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  bloodGroup: string;
  createdAt: string;
};

type SortKey = "name" | "age" | "registered";

export function PatientsTable({ patients }: { patients: PatientRow[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("registered");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? patients.filter((p) => p.fullName.toLowerCase().includes(q) || p.nationalId.toLowerCase().includes(q))
      : patients.slice();

    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.fullName.localeCompare(b.fullName);
      else if (sortKey === "age") cmp = age(a.dateOfBirth) - age(b.dateOfBirth);
      else cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [patients, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (key !== sortKey) return null;
    return <span className="text-teal">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <input
          className={`${inputClass} sm:max-w-xs`}
          placeholder="Filter by name or National ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-xs text-sage">
          {filtered.length} of {patients.length} patient{patients.length === 1 ? "" : "s"}
        </span>
      </div>

      {filtered.length === 0 && (
        <Card className="p-8 text-center text-sm text-sage">No patients match “{query}”.</Card>
      )}

      {filtered.length > 0 && (
        <>
          {/* Table on sm+ screens — mirrors the loading skeleton so there's no layout jump. */}
          <Card className="hidden sm:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-paper border-b border-line text-left text-xs text-sage uppercase tracking-wide">
                  <th className="px-5 py-3 font-medium">
                    <button className="focus-ring flex items-center gap-1 hover:text-ink" onClick={() => toggleSort("name")}>
                      Patient {sortIndicator("name")}
                    </button>
                  </th>
                  <th className="px-5 py-3 font-medium">National ID</th>
                  <th className="px-5 py-3 font-medium">
                    <button className="focus-ring flex items-center gap-1 hover:text-ink" onClick={() => toggleSort("age")}>
                      Age / Gender {sortIndicator("age")}
                    </button>
                  </th>
                  <th className="px-5 py-3 font-medium">Blood group</th>
                  <th className="px-5 py-3 font-medium">
                    <button className="focus-ring flex items-center gap-1 hover:text-ink" onClick={() => toggleSort("registered")}>
                      Registered {sortIndicator("registered")}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-teal-light/40 transition-colors">
                    <td className="px-5 py-3">
                      <Link href={`/doctor/patients/${p.id}`} className="font-medium text-ink hover:text-teal-dark">
                        {p.fullName}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-sage">{p.nationalId}</td>
                    <td className="px-5 py-3 text-sage">
                      {age(p.dateOfBirth)} yrs · {p.gender}
                    </td>
                    <td className="px-5 py-3">
                      <Badge>{p.bloodGroup}</Badge>
                    </td>
                    <td className="px-5 py-3 text-sage">{formatDate(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Cards on small screens — a table would need horizontal scrolling that's easy to miss on mobile. */}
          <div className="grid sm:hidden gap-4">
            {filtered.map((p) => (
              <Link key={p.id} href={`/doctor/patients/${p.id}`}>
                <Card className="p-4 hover:border-teal transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-ink truncate">{p.fullName}</div>
                      <div className="text-xs text-sage font-mono mt-1">{p.nationalId}</div>
                    </div>
                    <Badge>{p.bloodGroup}</Badge>
                  </div>
                  <div className="text-xs text-sage mt-3">
                    {age(p.dateOfBirth)} yrs · {p.gender} · registered {formatDate(p.createdAt)}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
