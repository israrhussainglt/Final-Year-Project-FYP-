"use client";

import { useEffect, useState } from "react";

// A patient's medical record and a doctor's dashboard are exactly the kind
// of thing you don't want to silently fail on flaky wifi — this makes
// connectivity loss visible instead of leaving someone staring at a form
// that just won't submit.
export function OfflineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-[998] bg-alert text-white text-sm font-medium text-center py-2 px-4"
    >
      You're offline — changes won't save until your connection is back.
    </div>
  );
}
