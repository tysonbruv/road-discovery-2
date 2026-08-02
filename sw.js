"use strict";

/*
  Road Discovery AU v48 service worker

  Checkpoint 10:
  Hide & Seek navigation, heading, map pings,
  and bottom-left navigation controls.

  Expected frontend versions:
  - app.js?v=47
  - style.css?v=41

  Previous files are recognised during the update so
  the site can upgrade safely while GitHub files are
  replaced one at a time.
*/

const CACHE_NAME = "road-discovery-au-v48";

const CORE_APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg"
];

const VERSIONED_APP_FILES = [
  "./style.css?v=41",
  "./style.css?v=40",
  "./app.js?v=47",

  /* Previous Hide & Seek version. */
  "./style.css?v=39",
  "./app.js?v=46",

  /* Previous checkpoint fallback. */
  "./style.css?v=38",
  "./app.js?v=45",

  /*
    Temporary fallbacks during a one-file-at-a-time
    upload.
  */
  "./app.js?v=44",
  "./style.css?v=37",
  "./app.js?v=43",
  "./style.css?v=36",
  "./app.js?v=42"
];

/* -------------------------------------------------- */
/* Install                                            */
/* -------------------------------------------------- */

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(CORE_APP_SHELL);

        await Promise.all(
          VERSIONED_APP_FILES.map(
            async (file) => {
              try {
                await cache.add(file);
              } catch (error) {
                console.warn(
                  `Could not pre-cache ${file}. ` +
                  "It will be cached when available.",
                  error
                );
              }
            }
          )
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
            .filter(
              (cacheName) =>
                cacheName !== CACHE_NAME
            )
            .map(
              (cacheName) =>
                caches.delete(cacheName)
            )
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

    - Leaflet files
    - Leaflet rotation extension
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
          if (
            networkResponse &&
            networkResponse.ok
          ) {
            const responseCopy =
              networkResponse.clone();

            caches
              .open(CACHE_NAME)
              .then((cache) => {
                cache.put(
                  "./index.html",
                  responseCopy
                );
              });
          }

          return networkResponse;
        })
        .catch(async () => {
          return (
            (
              await caches.match(
                "./index.html"
              )
            ) ||
            (await caches.match("./"))
          );
        })
    );

    return;
  }

  /* ------------------------------------------------ */
  /* Local application files                          */
  /* ------------------------------------------------ */

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.ok
        ) {
          const responseCopy =
            networkResponse.clone();

          caches
            .open(CACHE_NAME)
            .then((cache) => {
              cache.put(
                request,
                responseCopy
              );
            });
        }

        return networkResponse;
      })
      .catch(async () => {
        const exactCachedResponse =
          await caches.match(request);

        if (exactCachedResponse) {
          return exactCachedResponse;
        }

        if (
          url.pathname.endsWith(
            "/style.css"
          )
        ) {
          return (
            (
              await caches.match(
                "./style.css?v=41"
              )
            ) ||
            (
              await caches.match(
                "./style.css?v=40"
              )
            ) ||
            (
              await caches.match(
                "./style.css?v=39"
              )
            ) ||
            (
              await caches.match(
                "./style.css?v=38"
              )
            ) ||
            (
              await caches.match(
                "./style.css?v=37"
              )
            ) ||
            (
              await caches.match(
                "./style.css?v=36"
              )
            ) ||
            Response.error()
          );
        }

        if (
          url.pathname.endsWith(
            "/app.js"
          )
        ) {
          return (
            (
              await caches.match(
                "./app.js?v=47"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=46"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=45"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=44"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=43"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=42"
              )
            ) ||
            Response.error()
          );
        }

        if (
          url.pathname.endsWith(
            "/manifest.json"
          )
        ) {
          return (
            (
              await caches.match(
                "./manifest.json"
              )
            ) ||
            Response.error()
          );
        }

        if (
          url.pathname.endsWith(
            "/icon.svg"
          )
        ) {
          return (
            (
              await caches.match(
                "./icon.svg"
              )
            ) ||
            Response.error()
          );
        }

        return Response.error();
      })
  );
});
