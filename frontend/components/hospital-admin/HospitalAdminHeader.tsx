"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { PulseMark } from "@/components/PulseMark";
import { apiUrl, readCsrfCookie } from "@/lib/api";

const NAV_ITEMS = [
  { href: "/hospital-admin/overview", label: "Overview" },
  { href: "/hospital-admin/dashboard", label: "Doctors" },
  { href: "/hospital-admin/patients", label: "Patients" },
  { href: "/hospital-admin/appointments", label: "Appointments" },
];

export function HospitalAdminHeader({
  adminName,
  hospitalName,
}: {
  adminName: string;
  hospitalName?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  async function logout() {
    await fetch(apiUrl("/api/auth/hospital-admin/logout"), {
      credentials: "include",
      method: "POST",
      headers: { "x-csrf-token": readCsrfCookie() || "" },
    });
    router.push("/hospital-admin/login");
    router.refresh();
  }

  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <header className="border-b border-line bg-white relative">
      {/* Same teal top rail as the clinician portal — this console lives in
          the same visual family, just under a different role. */}
      <div className="h-1 bg-teal" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-10 h-16 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 md:gap-8 min-w-0">
          <Link
            href="/hospital-admin/dashboard"
            aria-label="PulseID home"
            className="flex items-center gap-3 rounded-md focus-ring transition-opacity hover:opacity-80 shrink-0"
          >
            <PulseMark className="w-24 h-5" />
            <span className="hidden md:inline-flex items-center rounded-full bg-teal-light px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase text-teal-dark whitespace-nowrap">
              Hospital Admin
            </span>
          </Link>
          <nav className="hidden sm:flex items-center gap-6 shrink-0">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm font-medium transition-colors ${
                  isActive(item.href) ? "text-ink" : "text-sage hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="hidden sm:block text-right leading-tight max-w-[220px]">
            <div className="text-sm text-ink font-medium truncate">{adminName}</div>
            {hospitalName && <div className="text-xs text-sage truncate">{hospitalName}</div>}
          </div>
          <button onClick={logout} className="focus-ring hidden sm:inline text-sm font-medium text-sage hover:text-alert whitespace-nowrap">
            Sign out
          </button>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="focus-ring sm:hidden p-2 -mr-2 text-ink"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              {menuOpen ? (
                <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              ) : (
                <path d="M2 5h16M2 10h16M2 15h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="sm:hidden border-t border-line bg-white px-6 py-3 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className={`py-2 text-sm font-medium ${isActive(item.href) ? "text-ink" : "text-sage"}`}
            >
              {item.label}
            </Link>
          ))}
          <div className="pt-2 mt-1 border-t border-line">
            <div className="text-sm text-ink font-medium">{adminName}</div>
            {hospitalName && <div className="text-xs text-sage mb-2">{hospitalName}</div>}
            <button onClick={logout} className="focus-ring text-sm font-medium text-alert py-1">
              Sign out
            </button>
          </div>
        </nav>
      )}
    </header>
  );
}
