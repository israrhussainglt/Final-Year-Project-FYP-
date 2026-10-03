// Server-side fetch helper for Next.js Server Components. Forwards the
// visitor's cookies to the backend so protected endpoints see the same
// session, and lets pages stay server-rendered (fast first paint, no
// client-side loading spinner for the initial view) even though all data
// now lives behind a separate API instead of in-process DB calls.
import { cookies } from "next/headers";

const API_BASE = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function serverFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; data: T | null }> {
  const cookieHeader = cookies().toString();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), cookie: cookieHeader },
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
