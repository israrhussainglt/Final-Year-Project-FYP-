"use client";

// In-app notification bell for the patient header. Polls once on mount (and
// after any read action) for the unread badge; the feed itself is in-app
// only, consistent with every other notification path in the app. Opens a
// small dropdown — no page navigation needed to see what's new.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl, readCsrfCookie } from "@/lib/api";

type NotificationRow = {
  id: string;
  type: "report" | "system";
  title: string;
  body: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
};

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/patient/notifications"), { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications || []);
      setUnread(data.unreadCount || 0);
      setLoaded(true);
    } catch {
      /* offline — the badge simply stays as-is */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Close the dropdown on any outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function markRead(id: string, link: string | null) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try {
      await fetch(apiUrl(`/api/patient/notifications/${id}/read`), {
        credentials: "include",
        method: "POST",
        headers: { "x-csrf-token": readCsrfCookie() || "" },
      });
    } catch {
      /* badge state already optimistic */
    }
    setOpen(false);
    if (link) router.push(link);
  }

  async function markAll() {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnread(0);
    try {
      await fetch(apiUrl("/api/patient/notifications/read-all"), {
        credentials: "include",
        method: "POST",
        headers: { "x-csrf-token": readCsrfCookie() || "" },
      });
    } catch {
      /* badge state already optimistic */
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!loaded) load();
        }}
        className="focus-ring relative p-2 text-ink"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path
            d="M10 2.5a4.5 4.5 0 0 0-4.5 4.5c0 3.5-1.5 5-1.5 5h12s-1.5-1.5-1.5-5A4.5 4.5 0 0 0 10 2.5zM8.5 15a1.5 1.5 0 0 0 3 0"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-alert text-white text-[10px] font-semibold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white shadow-card z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="eyebrow text-sage">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="focus-ring text-xs font-medium text-teal-dark hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 && <p className="text-sm text-sage px-4 py-4">Nothing yet.</p>}
            {items.map((n) => (
              <button
                type="button"
                key={n.id}
                onClick={() => markRead(n.id, n.link)}
                className={`focus-ring block w-full text-left px-4 py-3 border-b border-line last:border-b-0 hover:bg-paper transition-colors ${
                  n.isRead ? "opacity-70" : "bg-teal-light/40"
                }`}
              >
                <span className="block text-sm font-medium text-ink">{n.title}</span>
                <span className="block text-xs text-sage mt-0.5 leading-relaxed">{n.body}</span>
                <span className="block text-[10px] text-sage mt-1">{new Date(n.createdAt).toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
