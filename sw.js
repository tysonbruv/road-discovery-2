"use strict";

/*
  Road Discovery AU v42 service worker

  Checkpoint 8:
  Private friend nicknames.

  Expected frontend versions:
  - app.js?v=42
  - style.css?v=36

  The previous app.js?v=41 and style.css?v=35 files are also
  recognised during the update so the site can be upgraded safely.
*/

const CACHE_NAME = "road-discovery-au-v42";

const CORE_APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg"
];

const VERSIONED_APP_FILES = [
  "./style.css?v=36",
  "./app.js?v=42",

  /*
    Temporary fallback files used while the GitHub files are being
    replaced one at a time.
  */
  "./style.css?v=35",
  "./app.js?v=41"
];

/* -------------------------------------------------- */
/* Install                                            */
/* -------------------------------------------------- */

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        /*
          These files should always exist.
        */
        await cache.addAll(CORE_APP_SHELL);

        /*
          Cache each versioned file separately.

          If app.js?v=42 or style.css?v=36 has not been uploaded yet,
          installation can still complete using the previous version.
        */
        await Promise.all(
          VERSIONED_APP_FILES.map(async (file) => {
            try {
              await cache.add(file);
            } catch (error) {
              console.warn(
                `Could not pre-cache ${file}. It will be cached when available.`,
                error
              );
            }
          })
        );
      })
      .then(() => self.skipWaiting())
  );
});

/* -------------------------------------------------- */
/* Activate                                           */
/* -------------------------------------------------- */

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

/* -------------------------------------------------- */
/* Fetch                                              */
/* -------------------------------------------------- */

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

  /* ------------------------------------------------ */
  /* Page navigation                                  */
  /* ------------------------------------------------ */

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const responseCopy = networkResponse.clone();

            caches.open(CACHE_NAME).then((cache) => {
              cache.put("./index.html", responseCopy);
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

  /* ------------------------------------------------ */
  /* Local JavaScript, CSS, manifest and icon files   */
  /* ------------------------------------------------ */

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const responseCopy = networkResponse.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseCopy);
          });
        }

        return networkResponse;
      })
      .catch(async () => {
        /*
          First try the exact requested file.
        */
        const exactCachedResponse = await caches.match(request);

        if (exactCachedResponse) {
          return exactCachedResponse;
        }

        /*
          Handles cases where the browser requests a file without its
          version query string.
        */
        if (url.pathname.endsWith("/style.css")) {
          return (
            (await caches.match("./style.css?v=36")) ||
            (await caches.match("./style.css?v=35")) ||
            Response.error()
          );
        }

        if (url.pathname.endsWith("/app.js")) {
          return (
            (await caches.match("./app.js?v=42")) ||
            (await caches.match("./app.js?v=41")) ||
            Response.error()
          );
        }

        if (url.pathname.endsWith("/manifest.json")) {
          return (
            (await caches.match("./manifest.json")) ||
            Response.error()
          );
        }

        if (url.pathname.endsWith("/icon.svg")) {
          return (
            (await caches.match("./icon.svg")) ||
            Response.error()
          );
        }

        return Response.error();
      })
  );
});
