"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PulseMark } from "@/components/PulseMark";
import { apiUrl, readCsrfCookie } from "@/lib/api";
import { BottomTabBar } from "@/components/BottomTabBar";
import { GridIcon, UsersIcon, CalendarIcon, ScanIcon } from "@/components/TabIcons";

const NAV_ITEMS = [
  { href: "/doctor/dashboard", label: "Dashboard" },
  { href: "/doctor/registrations", label: "Requests" },
  { href: "/doctor/patients", label: "Patients" },
  { href: "/doctor/appointments", label: "Appointments" },
  { href: "/doctor/calendar", label: "Calendar" },
  { href: "/doctor/followups", label: "Follow-ups" },
  { href: "/doctor/scan", label: "Scan QR" },
];

// All 5 doctor nav items fit the bottom bar directly — no "More" needed.
// "Scan QR" is placed last/rightmost since it's the thumb-friendliest spot
// on a right-handed grip, and it's the action most likely to be reached for
// mid-conversation with a patient.
const TAB_ITEMS = [
  { href: "/doctor/dashboard", label: "Dashboard", icon: <GridIcon /> },
  { href: "/doctor/patients", label: "Patients", icon: <UsersIcon /> },
  { href: "/doctor/appointments", label: "Appts", icon: <CalendarIcon /> },
  { href: "/doctor/calendar", label: "Calendar", icon: <CalendarIcon /> },
  { href: "/doctor/scan", label: "Scan", icon: <ScanIcon /> },
];

export function DoctorHeader({
  doctorName,
  hospitalName,
}: {
  doctorName: string;
  hospitalName?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Pending self-service booking requests — the in-app "notification" a doctor
  // gets when someone sends them a request through the public /book page.
  // null = not loaded yet, so the nav never flashes a misleading "0".
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/doctor/registrations/pending-count"), {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setPendingCount(data.pendingCount ?? 0);
      } catch {
        /* badge is best-effort — never block the page on it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  async function logout() {
    await fetch(apiUrl("/api/auth/doctor/logout"), { credentials: "include", method: "POST", headers: { "x-csrf-token": readCsrfCookie() || "" } });
    router.push("/doctor/login");
    router.refresh();
  }

  const isActive = (href: string) => (href === "/doctor/dashboard" ? pathname === href : pathname.startsWith(href));

  return (
    <header className="border-b border-line bg-white relative">
      {/* Teal top rail — a quick, consistent visual cue that this is the
          clinician/hospital system, distinct from the patient portal. */}
      <div className="h-1 bg-teal" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-10 h-16 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 md:gap-8 min-w-0">
          <Link
            href="/doctor/dashboard"
            aria-label="PulseID home"
            className="flex items-center gap-3 rounded-md focus-ring transition-opacity hover:opacity-80 shrink-0"
          >
            <PulseMark className="w-24 h-5" />
            <span className="hidden md:inline-flex items-center rounded-full bg-teal-light px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase text-teal-dark whitespace-nowrap">
              Clinician Portal
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
                {item.href === "/doctor/registrations" && pendingCount ? (
                  <span className="ml-1.5 inline-flex min-w-[18px] justify-center rounded-full bg-teal px-1.5 py-0.5 text-[10px] font-semibold text-white align-middle">
                    {pendingCount}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="hidden sm:block text-right leading-tight max-w-[220px]">
            <div className="text-sm text-ink font-medium truncate">{doctorName}</div>
            {hospitalName && <div className="text-xs text-sage truncate">{hospitalName}</div>}
          </div>
          <button onClick={logout} className="focus-ring hidden sm:inline text-sm font-medium text-sage hover:text-alert whitespace-nowrap">
            Sign out
          </button>
          {/* Mobile menu toggle — the doctor's nav needs to work from a phone
              just as well as a desk, since QR scanning happens on a phone. */}
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
              className={`flex items-center gap-2 py-2 text-sm font-medium ${isActive(item.href) ? "text-ink" : "text-sage"}`}
            >
              {item.label}
              {item.href === "/doctor/registrations" && pendingCount ? (
                <span className="inline-flex min-w-[18px] justify-center rounded-full bg-teal px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {pendingCount}
                </span>
              ) : null}
            </Link>
          ))}
          <div className="pt-2 mt-1 border-t border-line">
            <div className="text-sm text-ink font-medium">{doctorName}</div>
            {hospitalName && <div className="text-xs text-sage mb-2">{hospitalName}</div>}
            <button onClick={logout} className="focus-ring text-sm font-medium text-alert py-1">
              Sign out
            </button>
          </div>
        </nav>
      )}

      <BottomTabBar items={TAB_ITEMS} />
    </header>
  );
}
