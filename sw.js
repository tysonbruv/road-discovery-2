const CACHE_NAME = "road-discovery-au-v24";

const ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=24",
  "./app.js?v=23",
  "./manifest.json",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        const copy = networkResponse.clone();

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, copy);
        });

        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
