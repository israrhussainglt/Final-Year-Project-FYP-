"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PulseMark } from "@/components/PulseMark";
import { Card, Badge } from "@/components/ui";
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
      <FloatingControls
        standalone={standalone}
        view={view}
        onToggleView={toggleView}
        lang={lang}
        onToggleLang={toggleLang}
        t={t}
      />
      {view === "launcher" ? <Launcher t={t} /> : <Website t={t} />}
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

function Website({ t }: { t: LandingCopy }) {
  const arrow = t.dir === "rtl" ? "←" : "→";
  const bulletPrefix = t.dir === "rtl" ? "" : "• ";
  const bulletSuffix = t.dir === "rtl" ? " •" : "";

  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-6 md:px-10 pt-20 pb-6 flex flex-wrap items-center justify-between gap-4 max-w-6xl mx-auto w-full">
        <Link
          href="/"
          aria-label="PulseID home"
          className="flex items-center gap-3 rounded-md focus-ring transition-opacity hover:opacity-80"
        >
          <span className="font-display italic text-xl">{t.brand}</span>
        </Link>
        <div className="flex items-center gap-6">
          <span className="eyebrow text-sage hidden md:inline">{t.eyebrowNetwork}</span>
          <div className="flex flex-wrap items-center gap-3 text-sm font-medium">
            <Link href="/doctor/login" className="text-sage hover:text-teal-dark transition-colors">
              {t.navDoctor}
            </Link>
            <span className="text-line">·</span>
            <Link href="/hospital-admin/login" className="text-sage hover:text-teal-dark transition-colors">
              {t.navAdmin}
            </Link>
            <span className="text-line">·</span>
            <Link href="/patient/login" className="text-sage hover:text-ink transition-colors">
              {t.navPatient}
            </Link>
            <span className="text-line">·</span>
            <Link href="/emergency/scan" className="text-alert hover:text-alert/80 transition-colors">
              {t.navEmergency}
            </Link>
          </div>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="px-6 md:px-10 max-w-5xl mx-auto w-full pt-8 pb-16">
        <PulseMark className="w-40 h-8 mb-8" />
        <h1 className="font-display text-4xl md:text-6xl leading-[1.15] max-w-3xl">
          {t.heroTitlePre}
          <span className="italic text-teal">{t.heroTitleHighlight}</span>
          {t.heroTitlePost}
        </h1>
        <p className="mt-6 text-sage text-lg max-w-xl leading-relaxed">{t.heroBody}</p>

        <div className="mt-8 flex flex-wrap gap-2">
          <Badge tone="teal">{t.badge1}</Badge>
          <Badge tone="sage">{t.badge2}</Badge>
          <Badge tone="sage">{t.badge3}</Badge>
        </div>

        <div className="mt-8 flex flex-wrap items-start gap-3">
          <Link
            href="/book"
            className="inline-flex items-center gap-2 rounded-full bg-teal px-6 py-3 text-sm font-semibold text-white hover:bg-teal-dark transition-colors"
          >
            {t.bookCta}
          </Link>
          <Link
            href="/emergency/scan"
            className="inline-flex items-center gap-2 rounded-full bg-alert px-6 py-3 text-sm font-semibold text-white hover:bg-alert/90 transition-colors"
          >
            {t.scanCta}
          </Link>
        </div>
        <p className="mt-3 text-xs text-sage max-w-xl leading-relaxed">{t.bookCtaSub}</p>
        <p className="mt-1 text-xs text-sage">{t.scanCtaSub}</p>
      </section>

      {/* ---------- Two systems, one record ---------- */}
      <section className="px-6 md:px-10 max-w-5xl mx-auto w-full pb-16">
        <div className="eyebrow text-sage mb-3">{t.twoSystemsEyebrow}</div>
        <h2 className="font-display text-2xl md:text-3xl mb-8 max-w-2xl">{t.twoSystemsTitle}</h2>

        <div className="grid sm:grid-cols-2 gap-5">
          <Link href="/doctor/login" className="block">
            <Card className="h-full hover:border-teal transition-colors group cursor-pointer overflow-hidden">
              <div className="h-1.5 bg-teal" />
              <div className="p-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center rounded-full bg-teal-light px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase text-teal-dark">
                    {t.doctorPortalTag}
                  </span>
                </div>
                <h3 className="font-display text-2xl mt-2">{t.doctorPortalTitle}</h3>
                <p className="text-sm text-sage mt-2 leading-relaxed">{t.doctorPortalBody}</p>
                <ul className="mt-4 space-y-1.5 text-sm text-sage">
                  {t.doctorPortalList.map((item) => (
                    <li key={item}>
                      {bulletPrefix}
                      {item}
                      {bulletSuffix}
                    </li>
                  ))}
                </ul>
                <span className="mt-5 inline-block text-sm font-semibold text-teal-dark group-hover:translate-x-1 transition-transform">
                  {t.doctorPortalCta}
                </span>
              </div>
            </Card>
          </Link>

          <Link href="/patient/login" className="block">
            <Card className="h-full hover:border-ink transition-colors group cursor-pointer overflow-hidden">
              <div className="h-1.5 bg-ink" />
              <div className="p-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center rounded-full bg-line px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase text-ink">
                    {t.patientPortalTag}
                  </span>
                </div>
                <h3 className="font-display text-2xl mt-2">{t.patientPortalTitle}</h3>
                <p className="text-sm text-sage mt-2 leading-relaxed">{t.patientPortalBody}</p>
                <ul className="mt-4 space-y-1.5 text-sm text-sage">
                  {t.patientPortalList.map((item) => (
                    <li key={item}>
                      {bulletPrefix}
                      {item}
                      {bulletSuffix}
                    </li>
                  ))}
                </ul>
                <span className="mt-5 inline-block text-sm font-semibold text-ink group-hover:translate-x-1 transition-transform">
                  {t.patientPortalCta}
                </span>
              </div>
            </Card>
          </Link>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="px-6 md:px-10 max-w-5xl mx-auto w-full pb-16">
        <div className="eyebrow text-sage mb-3">{t.howItWorksEyebrow}</div>
        <div className="grid sm:grid-cols-3 gap-5">
          {t.steps.map((s) => (
            <Card key={s.step} className="p-6">
              <div className="font-mono text-xs text-teal mb-3">{s.step}</div>
              <h3 className="font-display text-lg mb-2">{s.title}</h3>
              <p className="text-sm text-sage leading-relaxed">{s.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ---------- Security ---------- */}
      <section className="px-6 md:px-10 max-w-5xl mx-auto w-full pb-20">
        <Card className="p-8 !bg-ink !border-ink text-white">
          <div className="eyebrow text-white/60 mb-3">{t.securityEyebrow}</div>
          <h2 className="font-display text-2xl md:text-3xl mb-6 max-w-2xl">{t.securityTitle}</h2>
          <div className="grid sm:grid-cols-2 gap-4 text-sm text-white/80">
            {t.securityList.map((item) => (
              <div key={item}>
                {bulletPrefix}
                {item}
                {bulletSuffix}
              </div>
            ))}
          </div>
        </Card>
      </section>

      <footer className="px-6 md:px-10 pb-12 max-w-5xl mx-auto w-full">
        <p className="text-xs text-sage max-w-xl">{t.footer}</p>
      </footer>
    </main>
  );
}
