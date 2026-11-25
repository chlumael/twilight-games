// Offline support for the web app: network first, cached copy when offline.
// Same-origin GET only; the banner pack on raw.githubusercontent.com is
// cached by the app itself (localStorage), not here.
const CACHE = "twilight-games-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(e.request, { ignoreSearch: true });
        if (hit) return hit;
        if (e.request.mode === "navigate") {
          const shell = await cache.match("./");
          if (shell) return shell;
        }
        throw err;
      }
    })(),
  );
});
