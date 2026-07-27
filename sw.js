"use strict";

/* Road Discovery AU v36 service worker */

const CACHE_NAME = "road-discovery-au-v37";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=33",
  "./app.js?v=37",
  "./manifest.json",
  "./icon.svg"
];

/* Install the new app files and activate immediately */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

/* Delete all older Road Discovery cache versions */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName))
        );
      })
      .then(() => self.clients.claim())
  );
});

/* Use network-first so updates appear quickly, with cache as backup */
self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  /*
    Do not intercept external requests such as:
    - Leaflet CDN files
    - Supabase client library
    - CARTO map tiles
    - Overpass road data
    - OSRM waypoint routes
  */
  if (url.origin !== self.location.origin) {
    return;
  }

  /* Page navigation */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();

            caches.open(CACHE_NAME).then((cache) => {
              cache.put("./index.html", copy);
            });
          }

          return networkResponse;
        })
        .catch(async () => {
          return (
            (await caches.match("./index.html")) ||
            (await caches.match("./"))
          );
        })
    );

    return;
  }

  /* JavaScript, CSS, manifest and icon files */
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const copy = networkResponse.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, copy);
          });
        }

        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(request);

        if (cachedResponse) {
          return cachedResponse;
        }

        /*
          Handles cases where the browser asks for the file without
          the version query string while the cached copy includes it.
        */
        if (url.pathname.endsWith("/style.css")) {
          return caches.match("./style.css?v=33");
        }

        if (url.pathname.endsWith("/app.js")) {
          return caches.match("./app.js?v=36");
        }

        return Response.error();
      })
  );
});
