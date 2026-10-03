"use client";

import { useEffect, useState } from "react";
import { PulseMark } from "@/components/PulseMark";

// Covers the very first paint of the app with the PulseID brand mark while
// the client bundle hydrates, then fades out. This is purely cosmetic (the
// page underneath is already server-rendered and interactive-ready), but it
// avoids a flash of unstyled/unhydrated UI and gives the app a deliberate,
// "everything is ready" feeling on first load rather than a jump-cut.
//
// - Held for a minimum of 450ms so it never flickers on fast connections.
// - Skipped entirely for users who've already seen it this tab session
//   (sessionStorage), so it never re-appears on internal navigation.
// - Respects prefers-reduced-motion (handled globally in globals.css, which
//   collapses all transition/animation durations to ~0).
export function BootSplash() {
  // Start as "not shown" on the server and on first client render (SSR/CSR
  // must match to avoid a hydration mismatch), then decide synchronously
  // whether to actually show it once we're on the client.
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    let alreadyBooted = false;
    try {
      alreadyBooted = sessionStorage.getItem("pulseid-booted") === "1";
    } catch {
      // Private browsing / storage disabled — treat as not-yet-booted.
    }

    if (alreadyBooted) return; // never show the splash again this tab session

    setMounted(true);
    setVisible(true);

    // Begin the fade after the minimum display time.
    const startFade = window.setTimeout(() => {
      setFadingOut(true);
      try {
        sessionStorage.setItem("pulseid-booted", "1");
      } catch {
        // Fine — splash will just replay on next load.
      }
    }, 450);

    // Unmount unconditionally after the fade duration, regardless of
    // whether `transitionend` actually fires. Mobile browsers frequently
    // never dispatch `transitionend` for near-zero-duration transitions
    // (e.g. prefers-reduced-motion collapses transition-duration to
    // 0.01ms), which left this overlay stuck on-screen, fixed and
    // unclickable, forever. A timeout is a reliable fallback that doesn't
    // depend on the browser firing that event.
    const unmount = window.setTimeout(() => {
      setVisible(false);
      setMounted(false);
    }, 450 + 550); // 450ms hold + 500ms fade + buffer

    return () => {
      window.clearTimeout(startFade);
      window.clearTimeout(unmount);
    };
  }, []);

  if (!mounted) return null;

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[999] flex flex-col items-center justify-center gap-6 bg-paper transition-opacity duration-500 ${
        visible && !fadingOut ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <PulseMark className="w-44 h-9" />
      <p className="eyebrow text-sage">National Health Record Network</p>
    </div>
  );
}
