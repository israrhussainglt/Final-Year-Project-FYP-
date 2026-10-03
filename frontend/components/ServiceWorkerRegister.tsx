"use client";

import { useEffect } from "react";

// Registers /sw.js on mount. This is what makes PulseID installable as a
// PWA (Chrome/Edge "Install app", iOS Safari "Add to Home Screen") and
// gives it a minimal offline fallback — see public/sw.js for what it does
// and, just as importantly, what it deliberately doesn't cache.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    // Registered after load so it never competes with the initial page
    // load for bandwidth/CPU.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installability just degrades gracefully — nothing user-facing to
        // do here, the app still works fully online without it.
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
