"use strict";

/*
  Road Discovery AU v81 service worker

  Hidden Discoveries expanded to fourteen.

  Expected frontend versions:
  - app.js?v=80
  - style.css?v=58

  Recent files are also recognised during the update so the site can
  upgrade safely while GitHub files are replaced one at a time.
*/

const CACHE_NAME = "road-discovery-au-v81";

const CORE_APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg"
];

const VERSIONED_APP_FILES = [
  "./style.css?v=58",
  "./app.js?v=80",

  /* Recent fallbacks used during a staged GitHub update. */
  "./style.css?v=57",
  "./app.js?v=79",
  "./style.css?v=56",
  "./app.js?v=78",
  "./style.css?v=55",
  "./app.js?v=77"
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
            .filter(
              (cacheName) =>
                cacheName !== CACHE_NAME
            )
            .map((cacheName) =>
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
    External requests are not intercepted. This includes Leaflet,
    Supabase, map tiles, Overpass road data and OSRM routes.
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
            (await caches.match(
              "./index.html"
            )) ||
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
            (await caches.match(
              "./style.css?v=58"
            )) ||
            (await caches.match(
              "./style.css?v=57"
            )) ||
            (await caches.match(
              "./style.css?v=56"
            )) ||
            (await caches.match(
              "./style.css?v=55"
            )) ||
            Response.error()
          );
        }

        if (
          url.pathname.endsWith(
            "/app.js"
          )
        ) {
          return (
            (await caches.match(
              "./app.js?v=80"
            )) ||
            (await caches.match(
              "./app.js?v=79"
            )) ||
            (await caches.match(
              "./app.js?v=78"
            )) ||
            (await caches.match(
              "./app.js?v=77"
            )) ||
            Response.error()
          );
        }

        if (
          url.pathname.endsWith(
            "/manifest.json"
          )
        ) {
          return (
            (await caches.match(
              "./manifest.json"
            )) ||
            Response.error()
          );
        }

        if (
          url.pathname.endsWith(
            "/icon.svg"
          )
        ) {
          return (
            (await caches.match(
              "./icon.svg"
            )) ||
            Response.error()
          );
        }

        return Response.error();
      })
  );
});
