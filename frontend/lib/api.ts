// Client-side fetch helper. Every call to the PulseID API goes through here
// so the base URL and credentials behaviour live in exactly one place.
//
// NEXT_PUBLIC_API_URL is baked in at build time and points at the backend
// (e.g. http://localhost:4000 locally, https://api.pulseid.example in prod).
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Reads the (intentionally non-httpOnly) CSRF cookie the backend sets
// alongside the session cookie, so it can be echoed back as a header on
// every mutating request. See backend/src/lib/csrf.ts for the full
// rationale — this is the "double-submit cookie" half of that pattern.
// Exported so the handful of call sites that use raw fetch() instead of
// apiFetch() (forms that need direct access to the Response object) can
// still attach it.
export function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)pulseid_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const method = (init.method || "GET").toUpperCase();
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as Record<string, string> || {}) };
    if (MUTATING_METHODS.has(method)) {
      const csrf = readCsrfCookie();
      if (csrf) headers["x-csrf-token"] = csrf;
    }

    const res = await fetch(apiUrl(path), {
      credentials: "include",
      headers,
      ...init,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: body?.error || `Request failed (${res.status}).`, fieldErrors: body?.fieldErrors };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: "Could not reach the PulseID server. Check your connection and try again." };
  }
}
