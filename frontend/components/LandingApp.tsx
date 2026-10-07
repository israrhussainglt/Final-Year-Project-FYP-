"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PulseMark } from "@/components/PulseMark";
import { landingCopy, type Lang, type LandingCopy } from "@/lib/landing-i18n";

type View = "launcher" | "website";

const VIEW_KEY = "pulseid-landing-view";
const LANG_KEY = "pulseid-landing-lang";

export function LandingApp() {
  // null = "not decided yet" (avoids a flash of the wrong view before we
  // can read display-mode / localStorage on mount).
  const [standalone, setStandalone] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("website");
  const [lang, setLang] = useState<Lang>("en");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
    const isStandalone = mq.matches || iosStandalone;
    setStandalone(isStandalone);

    const savedView = window.localStorage.getItem(VIEW_KEY) as View | null;
    const savedLang = window.localStorage.getItem(LANG_KEY) as Lang | null;
    // Default: standalone (installed) launches open on the app launcher,
    // browser tabs open on the marketing site — unless the person already
    // picked a view themselves, in which case that choice always wins.
    setView(savedView ?? (isStandalone ? "launcher" : "website"));
    setLang(savedLang ?? "en");
    setReady(true);

    const onChange = (e: MediaQueryListEvent) => setStandalone(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function toggleView() {
    const next: View = view === "launcher" ? "website" : "launcher";
    setView(next);
    window.localStorage.setItem(VIEW_KEY, next);
  }

  function toggleLang() {
    const next: Lang = lang === "en" ? "ur" : "en";
    setLang(next);
    window.localStorage.setItem(LANG_KEY, next);
  }

  const t = landingCopy[lang];

  // Nothing rendered on the very first tick — prevents a flash of the
  // wrong view/language before localStorage + display-mode are read.
  if (!ready) return null;

  return (
    <div dir={t.dir} className={lang === "ur" ? "lang-ur" : undefined}>
      {view === "launcher" && (
        <FloatingControls
          standalone={standalone}
          view={view}
          onToggleView={toggleView}
          lang={lang}
          onToggleLang={toggleLang}
          t={t}
        />
      )}
      {view === "launcher" ? <Launcher t={t} /> : <Website t={t} onToggleView={toggleView} onToggleLang={toggleLang} />}
    </div>
  );
}

function FloatingControls({
  standalone,
  view,
  onToggleView,
  onToggleLang,
  t,
}: {
  standalone: boolean | null;
  view: View;
  onToggleView: () => void;
  lang: Lang;
  onToggleLang: () => void;
  t: LandingCopy;
}) {
  void standalone;
  void view;
  return (
    <div className="fixed top-0 inset-x-0 z-50 safe-top safe-x pointer-events-none">
      <div className="max-w-6xl mx-auto px-4 pt-3 flex items-center justify-between">
        <div className="pointer-events-auto">
          {/* Lets anyone switch between the app-style launcher and the full
              marketing site, whether they're in a browser tab or the
              installed PWA — not just once installed. */}
          <button
            onClick={onToggleView}
            className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur border border-line shadow-card px-3.5 py-2 text-xs font-semibold text-ink hover:bg-paper transition-colors"
          >
            <ToggleIcon />
            {view === "launcher" ? t.viewToggleToWebsite : t.viewToggleToApp}
          </button>
        </div>
        <button
          onClick={onToggleLang}
          className="pointer-events-auto focus-ring inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur border border-line shadow-card px-3.5 py-2 text-xs font-semibold text-teal-dark hover:bg-paper transition-colors"
          lang={t.dir === "rtl" ? "en" : "ur"}
          dir={t.dir === "rtl" ? "ltr" : "rtl"}
        >
          <GlobeIcon />
          {t.langToggle}
        </button>
      </div>
    </div>
  );
}

function ToggleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M6 3.5L2.5 7l3.5 3.5M14 16.5l3.5-3.5-3.5-3.5M2.5 7h11M6.5 13.5h11"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 10h14M10 3c2 2 3 4.5 3 7s-1 5-3 7c-2-2-3-4.5-3-7s1-5 3-7z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

// ---------- App-style launcher (installed / standalone default) ----------

function Launcher({ t }: { t: LandingCopy }) {
  const portals = [
    // Booking sits first: it's the only portal a brand-new member of the public
    // can actually use without an existing record, so it's the action most
    // people arriving for the first time are looking for.
    { href: "/book", label: t.bookLauncherLabel, sub: t.bookLauncherSub, tone: "teal" as const },
    { href: "/patient/login", label: t.launcherPatientLabel, sub: t.launcherPatientSub, tone: "teal" as const },
    { href: "/doctor/login", label: t.launcherDoctorLabel, sub: t.launcherDoctorSub, tone: "sage" as const },
    { href: "/hospital-admin/login", label: t.launcherAdminLabel, sub: t.launcherAdminSub, tone: "sage" as const },
    { href: "/emergency/scan", label: t.launcherEmergencyLabel, sub: t.launcherEmergencySub, tone: "alert" as const },
  ];
  const toneClasses: Record<"teal" | "sage" | "alert", string> = {
    teal: "border-teal/30 bg-teal-light active:bg-teal-light/70",
    sage: "border-line bg-white active:bg-paper",
    alert: "border-alert/30 bg-alert/5 active:bg-alert/10",
  };
  const arrow = t.dir === "rtl" ? "←" : "→";

  return (
    <main className="min-h-screen flex flex-col justify-center px-6 py-10 pt-20 safe-bottom safe-x bg-paper">
      <div className="flex flex-col items-center mb-10">
        <PulseMark className="w-32 h-7 mb-3" />
        <p className="text-sage text-sm text-center">{t.launcherSub}</p>
      </div>

      <div className="flex flex-col gap-3 max-w-sm w-full mx-auto">
        {portals.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className={`focus-ring rounded-2xl border p-5 flex items-center justify-between transition-colors ${toneClasses[p.tone]}`}
          >
            <span>
              <span className="block font-display text-lg">{p.label}</span>
              <span className="block text-sm text-sage mt-0.5">{p.sub}</span>
            </span>
            <span aria-hidden className="text-sage text-xl">
              {arrow}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}

// ---------- Full marketing website ----------

// Tiny inline icon set (stroke icons, currentColor) — kept local to the
// landing page since only this view uses them.
function I({ d, className = "w-[22px] h-[22px]" }: { d: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d.split("|").map((path, i) => (
        <path key={i} d={path} />
      ))}
    </svg>
  );
}

const ICONS = {
  lock: "M5 11h14v9H5z|M8 11V8a4 4 0 0 1 8 0v3",
  shield: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z|M9 12l2 2 4-4",
  log: "M5 4h14v16H5z|M9 9h6M9 13h6M9 17h3",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16",
  users: "M9 8a3 3 0 1 0 0-.01M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3 3 0 0 1 0 6M18 14c2 .7 3 2.6 3 5",
  clock: "M12 12a9 9 0 1 0 0-.01M12 7v5l3 2",
  cross: "M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z",
  user: "M12 8a4 4 0 1 0 0-.01M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8",
  chev: "M6 9l6 6 6-6",
};

// Deterministic decorative QR pattern for the hero card (same algorithm as
// the design mockup) — purely illustrative, never a real token.
function QrPattern() {
  const n = 13;
  const cell = (x: number, y: number) => {
    const finder = (x < 4 && y < 4) || (x > 8 && y < 4) || (x < 4 && y > 8);
    if (finder) {
      const a = x < 4 ? x : x - 9;
      const b = y < 4 ? y : y - 9;
      return a === 0 || a === 3 || b === 0 || b === 3 || (a === 1 && b === 1) || (a === 2 && b === 2) || (a === 1 && b === 2) || (a === 2 && b === 1);
    }
    return (x * 7 + y * 13 + x * y) % 5 < 2;
  };
  const rects: string[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (cell(x, y)) rects.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return (
    <svg viewBox="0 0 13 13" className="w-full h-full" shapeRendering="crispEdges" aria-hidden="true">
      <path d={rects.join(" ")} fill="#12262B" />
    </svg>
  );
}

function LoginDropdown({ t }: { t: LandingCopy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [
    { href: "/doctor/login", icon: ICONS.cross, title: t.navDoctor, desc: t.loginDescDoctor },
    { href: "/hospital-admin/login", icon: ICONS.users, title: t.navAdmin, desc: t.loginDescAdmin },
    { href: "/patient/login", icon: ICONS.user, title: t.navPatient, desc: t.loginDescPatient },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="focus-ring inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink/90 transition-colors"
      >
        <I d={ICONS.user} className="w-[18px] h-[18px]" />
        {t.navLogin}
        <I d={ICONS.chev} className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        className={`absolute top-full end-0 mt-3 w-[350px] max-w-[calc(100vw-2.5rem)] rounded-3xl border border-line bg-white p-2 shadow-[0_36px_80px_-24px_rgba(11,32,39,0.3),0_2px_8px_rgba(11,32,39,0.06)] transition-all duration-150 ${
          open ? "opacity-100 translate-y-0 visible" : "opacity-0 -translate-y-2 invisible"
        }`}
        role="menu"
      >
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="focus-ring flex items-center gap-3.5 p-3.5 rounded-2xl hover:bg-teal-light transition-colors"
          >
            <span className="w-11 h-11 rounded-2xl bg-teal-light text-teal grid place-items-center shrink-0">
              <I d={item.icon} />
            </span>
            <span>
              <b className="block font-semibold text-ink leading-snug">{item.title}</b>
              <small className="block text-sage text-sm leading-snug mt-0.5">{item.desc}</small>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function Website({ t, onToggleView, onToggleLang }: { t: LandingCopy; onToggleView: () => void; onToggleLang: () => void }) {
  const btnTeal = "inline-flex items-center justify-center gap-2 rounded-full bg-teal px-7 py-3 text-sm font-semibold text-white hover:bg-teal-dark transition-colors";
  const btnLine = "inline-flex items-center justify-center gap-2 rounded-full border-[1.5px] border-ink px-7 py-3 text-sm font-semibold text-ink hover:bg-ink hover:text-white transition-colors";
  const btnAlertSm = "inline-flex items-center gap-2 rounded-full bg-alert px-5 py-2.5 text-sm font-semibold text-white hover:bg-alert/90 transition-colors";

  return (
    <main id="top">
      {/* ---------- Sticky nav ---------- */}
      <nav className="sticky top-0 z-40 safe-top bg-paper/90 backdrop-blur-md border-b border-line">
        <div className="max-w-6xl mx-auto px-6 md:px-10 h-[68px] md:h-[76px] flex items-center gap-4 md:gap-8">
          <Link href="/" className="flex items-center gap-2.5 me-auto focus-ring rounded-md" aria-label="PulseID home">
            <PulseMark className="w-9 h-6" />
            <span className="font-display text-[22px]">{t.brand}</span>
          </Link>
          <button
            type="button"
            onClick={onToggleLang}
            lang={t.dir === "rtl" ? "en" : "ur"}
            dir={t.dir === "rtl" ? "ltr" : "rtl"}
            className="focus-ring text-sm font-medium text-sage hover:text-ink transition-colors py-2"
          >
            {t.langToggle}
          </button>
          <Link href="/emergency/scan" className={`${btnAlertSm} hidden sm:inline-flex`}>
            <I d={ICONS.scan} className="w-[18px] h-[18px]" />
            {t.navEmergency}
          </Link>
          <LoginDropdown t={t} />
          <button
            type="button"
            onClick={onToggleView}
            title={t.viewToggleToApp}
            aria-label={t.viewToggleToApp}
            className="focus-ring hidden lg:inline-grid place-items-center w-9 h-9 rounded-full border border-line text-sage hover:text-ink transition-colors"
          >
            <ToggleIcon />
          </button>
        </div>
      </nav>

      {/* ---------- Hero ---------- */}
      <section className="bg-[radial-gradient(55%_75%_at_82%_35%,#E4F2F1_0,rgba(255,255,255,0)_70%)]">
        <div className="max-w-6xl mx-auto px-6 md:px-10 pt-14 md:pt-20 pb-16 md:pb-24 grid lg:grid-cols-[1.08fr_0.92fr] gap-12 lg:gap-16 items-center">
          <div>
            <h1 className="font-display text-[clamp(38px,5.5vw,72px)] leading-[1.05] tracking-tight">
              {t.heroTitlePre}
              <span className="text-teal">{t.heroTitleHighlight}</span>
              {t.heroTitlePost}
            </h1>
            <p className="text-sage text-lg md:text-xl max-w-[44ch] mt-7 mb-9 leading-relaxed">{t.heroLede}</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/patient/login" className={btnTeal}>
                {t.heroCtaRecords}
              </Link>
              <Link href="/doctor/login" className={btnLine}>
                {t.heroCtaDoctor}
              </Link>
            </div>
            <p className="text-sage text-[15px] mt-6">
              {t.quietNew}{" "}
              <Link href="/book" className="text-teal font-semibold hover:underline">
                {t.bookLink}
              </Link>
            </p>
          </div>

          {/* Illustrative stage: a CNIC-style card + the responder's phone view */}
          <div className="relative h-[470px] hidden sm:block" aria-hidden="true">
            <div className="absolute start-0 top-8 w-[380px] max-w-[94%] aspect-[1.586] rounded-[20px] p-6 text-white bg-[linear-gradient(135deg,#0E7C7B,#0A5F5E)] shadow-[0_40px_70px_-30px_rgba(10,95,94,0.7)] -rotate-3 flex flex-col justify-between transition-all duration-300 ease-out hover:-translate-y-2 hover:rotate-0 hover:shadow-[0_56px_90px_-30px_rgba(10,95,94,0.85)] hover:z-10">
              <div className="flex justify-between text-xs font-medium opacity-80">
                <span>{t.stageCardTop1}</span>
                <span>{t.stageCardTop2}</span>
              </div>
              <div>
                <div className="w-[42px] h-[32px] rounded-lg bg-[linear-gradient(135deg,#E9D9A6,#BFA45F)] mt-3.5 mb-2.5" />
                <div className="font-display text-2xl font-medium">{t.stageCardName}</div>
                <div className="text-[15px] tracking-widest opacity-90 tabular-nums">{t.stageCardNid}</div>
              </div>
              <div className="flex justify-between items-end">
                <span className="text-xs opacity-60">{t.stageLinked}</span>
                <div className="relative w-[88px] h-[88px] bg-white rounded-[10px] p-2">
                  {/* corner brackets */}
                  <span className="absolute -top-2 -start-2 w-5 h-5 border-s-[3px] border-t-[3px] border-alert" />
                  <span className="absolute -bottom-2 -end-2 w-5 h-5 border-e-[3px] border-b-[3px] border-alert" />
                  <div className="relative overflow-hidden h-full">
                    <QrPattern />
                    <div className="scanline absolute inset-x-0 h-[2px] bg-alert shadow-[0_0_8px_#D64550]" />
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute end-0 bottom-0 w-[248px] bg-white border border-line rounded-[28px] p-5 shadow-[0_40px_80px_-30px_rgba(11,32,39,0.55)] transition-all duration-300 ease-out hover:-translate-y-2 hover:shadow-[0_56px_100px_-30px_rgba(11,32,39,0.65)] hover:z-10">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-alert">
                <span className="w-2 h-2 rounded-full bg-alert" />
                {t.emergencyView}
              </div>
              <div className="font-display text-6xl leading-none text-alert mt-3">{t.bloodValue}</div>
              <small className="text-sage text-[13px]">{t.bloodLabel}</small>
              <dl className="mt-3 text-sm leading-snug">
                <dt className="text-sage mt-3 text-[13px]">{t.allergiesLabel}</dt>
                <dd className="font-semibold">{t.allergiesValue}</dd>
                <dt className="text-sage mt-3 text-[13px]">{t.conditionsLabel}</dt>
                <dd className="font-semibold">{t.conditionsValue}</dd>
                <dt className="text-sage mt-3 text-[13px]">{t.contactLabel}</dt>
                <dd className="font-semibold">{t.contactValue}</dd>
              </dl>
              <div className="mt-4 pt-3.5 border-t border-line text-[13px] text-sage flex items-center gap-2">
                <I d={ICONS.lock} className="w-[18px] h-[18px]" />
                {t.privacyLine}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Trust strip ---------- */}
      <section className="max-w-6xl mx-auto px-6 md:px-10">
        <div className="grid grid-cols-2 lg:grid-cols-4 border-y border-line">
          {[
            { icon: ICONS.log, label: t.trust1, cls: "" },
            { icon: ICONS.users, label: t.trust2, cls: "border-s border-line" },
            { icon: ICONS.clock, label: t.trust3, cls: "lg:border-s border-line max-lg:border-t max-lg:border-line" },
            { icon: ICONS.shield, label: t.trust4, cls: "border-s border-line max-lg:border-t max-lg:border-line" },
          ].map((item, i) => (
            <div key={i} className={`flex items-center gap-3.5 px-5 py-6 font-medium text-[15px] leading-snug ${item.cls}`}>
              <I d={item.icon} className="w-[26px] h-[26px] text-teal shrink-0" />
              {item.label}
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Responder ledger ---------- */}
      <section className="max-w-6xl mx-auto px-6 md:px-10 py-20 md:py-28">
        <div className="grid lg:grid-cols-[0.85fr_1.15fr] gap-10 lg:gap-20 items-center">
          <div>
            <h2 className="font-display text-[clamp(30px,4vw,52px)] leading-[1.08] tracking-tight">{t.responderTitle}</h2>
            <p className="text-sage text-lg md:text-xl mt-5 max-w-[40ch] leading-relaxed">{t.responderBody}</p>
          </div>
          <div className="bg-white border border-line rounded-3xl px-7 md:px-9 pb-6 pt-1 shadow-[0_30px_60px_-40px_rgba(11,32,39,0.35)]">
            <div className="flex justify-between py-4 border-b border-line font-semibold">
              <span>{t.stageCardName}</span>
              <span className="text-sage font-medium tabular-nums">{t.ledgerNid}</span>
            </div>
            {[
              { label: t.allowedBlood, value: t.bloodValue, big: true },
              { label: t.allowedAllergies, value: t.allergiesValue },
              { label: t.allowedConditions, value: t.conditionsValue },
              { label: t.allowedContacts, value: t.contactsValue },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 py-4 border-b border-line">
                <span className="text-sage text-[15px]">{row.label}</span>
                <b className={`font-semibold ${row.big ? "font-display text-[26px] text-alert" : ""}`}>{row.value}</b>
              </div>
            ))}
            <div className="relative my-5 border-t-2 border-dashed border-alert text-center">
              <span className="relative -top-[15px] inline-flex items-center gap-2 bg-white px-3.5 text-alert font-semibold text-sm">
                <I d={ICONS.scan} className="w-[18px] h-[18px]" />
                {t.stopLabel}
              </span>
            </div>
            {[
              { label: t.lockedDiagnoses, w: 55 },
              { label: t.lockedPrescriptions, w: 70 },
              { label: t.lockedVisits, w: 45 },
              { label: t.lockedReports, w: 60 },
            ].map((row) => (
              <div key={row.label} className="group flex items-center justify-between gap-4 py-3.5 border-b border-line last:border-b-0">
                <span className="text-sage text-[15px]">{row.label}</span>
                <span className="flex items-center gap-3 flex-1 justify-end">
                  <i
                    className="relative h-2.5 rounded-full max-w-[60%] flex-none w-full overflow-hidden"
                    style={{
                      maxWidth: `${row.w}%`,
                      background: "repeating-linear-gradient(90deg,#DCE4E3 0 8px,transparent 8px 11px)",
                    }}
                  >
                    {/* Hover: the record "unlocks" — a green sweep fills the track. */}
                    <i
                      className="absolute inset-y-0 left-0 w-0 group-hover:w-full transition-all duration-700 ease-out"
                      style={{
                        background: "repeating-linear-gradient(90deg,#0E7C7B 0 8px,transparent 8px 11px)",
                      }}
                    />
                  </i>
                  <I d={ICONS.lock} className="w-[18px] h-[18px] text-sage shrink-0" />
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Portals ---------- */}
      <section className="max-w-6xl mx-auto px-6 md:px-10 pb-20 md:pb-28">
        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-[28px] p-8 md:p-12 flex flex-col gap-5 min-h-[340px] bg-paper border border-line shadow-[0_40px_70px_-55px_rgba(10,60,56,0.5)]">
            <div className="w-[52px] h-[52px] rounded-2xl grid place-items-center border-[1.5px] border-current text-ink opacity-90">
              <I d={ICONS.cross} />
            </div>
            <h3 className="font-display text-[clamp(26px,3vw,38px)] leading-[1.1]">{t.portalDoctorTitle}</h3>
            <p className="text-[17px] max-w-[38ch] flex-1 opacity-80 leading-relaxed">{t.portalDoctorBody}</p>
            <Link href="/doctor/login" className={`${btnTeal} self-start`}>
              {t.portalDoctorCta}
            </Link>
          </div>
          <div className="rounded-[28px] p-8 md:p-12 flex flex-col gap-5 min-h-[340px] bg-teal-light border border-line shadow-[0_40px_70px_-55px_rgba(10,60,56,0.5)]">
            <div className="w-[52px] h-[52px] rounded-2xl grid place-items-center border-[1.5px] border-current text-teal-dark opacity-90">
              <I d={ICONS.user} />
            </div>
            <h3 className="font-display text-[clamp(26px,3vw,38px)] leading-[1.1]">{t.portalPatientTitle}</h3>
            <p className="text-[17px] max-w-[38ch] flex-1 opacity-80 leading-relaxed">{t.portalPatientBody}</p>
            <Link href="/patient/login" className={`${btnTeal} self-start`}>
              {t.portalPatientCta}
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- Steps ---------- */}
      <section className="max-w-6xl mx-auto px-6 md:px-10 pb-20 md:pb-28">
        <h2 className="font-display text-[clamp(30px,4vw,52px)] leading-[1.08] tracking-tight mb-14 max-w-[24ch]">
          {t.stepsTitle}
        </h2>
        <div className="grid md:grid-cols-3 gap-10 relative">
          <div className="hidden md:block absolute top-7 inset-x-0 border-t-[1.5px] border-line" aria-hidden="true" />
          {[
            { n: 1, title: t.step1Title, body: t.step1Body },
            { n: 2, title: t.step2Title, body: t.step2Body },
            { n: 3, title: t.step3Title, body: t.step3Body },
          ].map((s) => (
            <div key={s.n} className="relative">
              <i className="relative grid place-items-center w-14 h-14 rounded-full bg-paper border-[1.5px] border-teal text-teal font-display text-2xl not-italic">
                {s.n}
              </i>
              <h3 className="font-display text-[26px] mt-6 mb-2.5 leading-tight">{s.title}</h3>
              <p className="text-sage leading-relaxed max-w-[36ch]">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Security panel ---------- */}
      <section className="max-w-6xl mx-auto px-6 md:px-10 pb-20 md:pb-28">
        <div className="bg-paper border border-line rounded-[32px] p-8 md:p-[72px]">
          <h2 className="font-display text-[clamp(30px,4vw,52px)] leading-[1.06] tracking-tight max-w-[18ch]">
            {t.securityTitle}
          </h2>
          <div className="grid md:grid-cols-2 gap-x-16 mt-14">
            {[
              { icon: ICONS.users, title: t.security1Title, body: t.security1Body },
              { icon: ICONS.log, title: t.security2Title, body: t.security2Body },
              { icon: ICONS.clock, title: t.security3Title, body: t.security3Body },
              { icon: ICONS.shield, title: t.security4Title, body: t.security4Body },
            ].map((item) => (
              <div key={item.title} className="border-t border-line py-7 pb-9">
                <I d={item.icon} className="w-8 h-8 text-teal mb-4" />
                <h3 className="font-semibold text-lg text-ink mb-2">{item.title}</h3>
                <p className="text-sage text-[16px] leading-relaxed max-w-[42ch]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="max-w-6xl mx-auto px-6 md:px-10 pb-24 md:pb-16 text-sage text-[15px]">
        <div className="flex flex-wrap gap-5 md:gap-10 items-center justify-between">
          <span>{t.footerLine}</span>
          <details className="border border-line rounded-xl px-4 py-2 text-sm bg-white">
            <summary className="cursor-pointer font-semibold text-ink">{t.footerDemoLabel}</summary>
            <p className="mt-2 font-mono text-xs leading-relaxed">{t.footerDemoBody}</p>
          </details>
        </div>
      </footer>

      {/* Sticky mobile emergency scan — a responder or bystander on a phone
          should never have to hunt for the one action that needs no login. */}
      <Link
        href="/emergency/scan"
        className={`sm:hidden fixed inset-x-4 bottom-[calc(14px+env(safe-area-inset-bottom,0px))] z-40 justify-center ${btnAlertSm} shadow-[0_12px_30px_rgba(214,69,80,0.5)]`}
      >
        <I d={ICONS.scan} className="w-5 h-5" />
        {t.navEmergency}
      </Link>
    </main>
  );
}
