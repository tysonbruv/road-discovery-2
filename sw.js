"use strict";

/*
  Road Discovery AU v89 service worker

  Road Conquest five-zone update:
  A, B, C, D and E.

  Expected frontend versions:
  - app.js?v=88
  - style.css?v=64

  Recent files are also recognised during staged updates.
*/

const CACHE_NAME =
  "road-discovery-au-v89";

const CORE_APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg"
];

const VERSIONED_APP_FILES = [
  "./style.css?v=64",
  "./app.js?v=88",

  /* Recent staged-update fallbacks. */
  "./app.js?v=87",
  "./style.css?v=63",
  "./app.js?v=86",
  "./style.css?v=62",
  "./app.js?v=85"
];


/* -------------------------------------------------- */
/* Install                                            */
/* -------------------------------------------------- */

self.addEventListener(
  "install",
  (event) => {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then(async (cache) => {
          await cache.addAll(
            CORE_APP_SHELL
          );

          await Promise.all(
            VERSIONED_APP_FILES.map(
              async (file) => {
                try {
                  await cache.add(file);
                } catch (error) {
                  console.warn(
                    `Could not pre-cache ${file}. It will be cached when available.`,
                    error
                  );
                }
              }
            )
          );
        })
        .then(() =>
          self.skipWaiting()
        )
    );
  }
);


/* -------------------------------------------------- */
/* Activate                                           */
/* -------------------------------------------------- */

self.addEventListener(
  "activate",
  (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((cacheNames) => {
          return Promise.all(
            cacheNames
              .filter(
                (cacheName) =>
                  cacheName !==
                  CACHE_NAME
              )
              .map(
                (cacheName) =>
                  caches.delete(
                    cacheName
                  )
              )
          );
        })
        .then(() =>
          self.clients.claim()
        )
    );
  }
);


/* -------------------------------------------------- */
/* Fetch                                              */
/* -------------------------------------------------- */

self.addEventListener(
  "fetch",
  (event) => {
    const request = event.request;

    if (request.method !== "GET") {
      return;
    }

    const url =
      new URL(request.url);

    /*
      External requests are not intercepted.
      This includes Leaflet, Supabase, map
      tiles, Overpass and OSRM routes.
    */
    if (
      url.origin !==
      self.location.origin
    ) {
      return;
    }


    /* ---------------------------------------------- */
    /* Page navigation                                */
    /* ---------------------------------------------- */

    if (
      request.mode === "navigate"
    ) {
      event.respondWith(
        fetch(request)
          .then(
            (networkResponse) => {
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
            }
          )
          .catch(async () => {
            return (
              (
                await caches.match(
                  "./index.html"
                )
              ) ||
              (
                await caches.match(
                  "./"
                )
              )
            );
          })
      );

      return;
    }


    /* ---------------------------------------------- */
    /* Local app files                                */
    /* ---------------------------------------------- */

    event.respondWith(
      fetch(request)
        .then(
          (networkResponse) => {
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
          }
        )
        .catch(async () => {
          const exactCachedResponse =
            await caches.match(
              request
            );

          if (
            exactCachedResponse
          ) {
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
                  "./style.css?v=64"
                )
              ) ||
              (
                await caches.match(
                  "./style.css?v=63"
                )
              ) ||
              (
                await caches.match(
                  "./style.css?v=62"
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
                  "./app.js?v=88"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=87"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=86"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=85"
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
  }
);
