// PulseID service worker — enables "Install app" / "Add to Home Screen" and
// a minimal offline fallback. It deliberately does NOT cache API responses
// (those are cross-origin, session-cookie-gated, and change constantly —
// caching medical data here would be both stale and a privacy risk).
// It only caches the static app shell so the UI itself still loads offline;
// the OfflineBanner component tells the user their data may be stale.

const CACHE_VERSION = "pulseid-shell-v1";
const OFFLINE_URL = "/offline.html";

const SHELL_ASSETS = [
  "/",
  OFFLINE_URL,
  "/site.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Only handle same-origin requests — never intercept calls to the API
  // origin, so auth cookies / fresh data always flow straight through.
  if (url.origin !== self.location.origin) return;

  // Page navigations: try the network first (so users always see fresh
  // content when online), fall back to the cached shell/offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((res) => res || caches.match("/")))
    );
    return;
  }

  // Static assets (icons, manifest, Next's own build output): cache-first,
  // refreshing the cache in the background when possible.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
