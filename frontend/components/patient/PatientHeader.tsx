"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { PulseMark } from "@/components/PulseMark";
import { apiUrl, readCsrfCookie } from "@/lib/api";
import { BottomTabBar } from "@/components/BottomTabBar";
import { HomeIcon, RecordsIcon, CalendarIcon, ShieldIcon, GridIcon } from "@/components/TabIcons";

const NAV_ITEMS = [
  { href: "/patient/home", label: "Home" },
  { href: "/patient/records", label: "Records" },
  { href: "/patient/appointments", label: "Appts" },
  { href: "/patient/report", label: "My Reports" },
  { href: "/patient/dependents", label: "Dependents" },
  { href: "/patient/emergency-scan", label: "Emergency Scan" },
  { href: "/patient/qr", label: "Emergency Access" },
  { href: "/patient/audit-log", label: "Audit log" },
];

// Only the 5 most time-critical actions make the bottom tab bar — everything
// else stays one tap away behind the hamburger menu. "Emergency Access" (the
// patient's own QR) beats "Emergency Scan" (previewing someone else's) for
// the bar since it's the thing a patient is far more likely to need in a
// hurry.
const TAB_ITEMS = [
  { href: "/patient/home", label: "Home", icon: <HomeIcon /> },
  { href: "/patient/records", label: "Records", icon: <RecordsIcon /> },
  { href: "/patient/qr", label: "Emergency", icon: <ShieldIcon /> },
  { href: "/patient/appointments", label: "Appts", icon: <CalendarIcon /> },
  { href: "/patient/dependents", label: "More", icon: <GridIcon /> },
];

export function PatientHeader({ patientName }: { patientName: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  async function logout() {
    await fetch(apiUrl("/api/auth/patient/logout"), { credentials: "include", method: "POST", headers: { "x-csrf-token": readCsrfCookie() || "" } });
    router.push("/patient/login");
    router.refresh();
  }

  return (
    <header className="border-b border-line bg-white relative">
      {/* Ink top rail — deliberately different from the teal clinician rail,
          so it's immediately obvious you're in the patient system. */}
      <div className="h-1 bg-ink" />
      {/* Eight nav items plus the logo, name and sign-out button need more
          room than max-w-6xl leaves once the badge is also showing — that
          combination was overflowing the flex row and, because the nav
          could still shrink while its text stayed nowrap, the text spilled
          out and visually overlapped the patient name next to it. Fixed by:
          widening the container, dropping the now-redundant "Patient
          Portal" badge once the full nav is visible (the nav itself already
          makes that context obvious), and pinning the nav's own width so it
          can never be compressed below its content. */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 h-16 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 xl:gap-8 min-w-0">
          <Link
            href="/patient/home"
            aria-label="PulseID home"
            className="flex items-center gap-3 rounded-md focus-ring transition-opacity hover:opacity-80 shrink-0"
          >
            <PulseMark className="w-24 h-5" tone="ink" />
            <span className="hidden md:inline-flex xl:hidden items-center rounded-full bg-line px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase text-ink whitespace-nowrap">
              Patient Portal
            </span>
          </Link>
          <nav className="hidden xl:flex items-center gap-4 shrink-0">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm font-medium transition-colors whitespace-nowrap ${
                  pathname === item.href ? "text-ink" : "text-sage hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <span className="text-sm text-sage hidden xl:inline whitespace-nowrap truncate max-w-[160px]">{patientName}</span>
          <button onClick={logout} className="focus-ring hidden xl:inline text-sm font-medium text-sage hover:text-alert whitespace-nowrap">
            Sign out
          </button>
          {/* Mobile/tablet menu — patients carry their QR on their phone, so
              the nav has to be fully usable there, not just on desktop. */}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="focus-ring xl:hidden p-2 -mr-2 text-ink"
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
        <nav className="xl:hidden border-t border-line bg-white px-4 sm:px-6 py-3 flex flex-col gap-1 max-h-[70vh] overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className={`py-2 text-sm font-medium ${pathname === item.href ? "text-ink" : "text-sage"}`}
            >
              {item.label}
            </Link>
          ))}
          <div className="pt-2 mt-1 border-t border-line">
            <div className="text-sm text-ink font-medium mb-2">{patientName}</div>
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
