const CACHE_PREFIX = "mega-gods-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SHELL_FILES = ["/", "/manifest.webmanifest", "/icons/app.svg"];
const CACHEABLE_DESTINATIONS = new Set(["script", "style", "image", "font", "manifest"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET"
    || url.origin !== self.location.origin
    || url.pathname === "/api"
    || url.pathname.startsWith("/api/")
    || url.search
    || request.headers.has("authorization")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put("/", response.clone())),
            );
          }
          return response;
        })
        .catch(async () => (await caches.match("/")) ?? Response.error()),
    );
    return;
  }

  if (!CACHEABLE_DESTINATIONS.has(request.destination)) return;
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())),
          );
        }
        return response;
      });
    }),
  );
});
