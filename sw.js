"use strict";

/*
  Road Discovery AU v114
  service worker

  Expected frontend:
  - app.js?v=112
  - style.css?v=65
*/

const CACHE_NAME =
  "road-discovery-au-v114";

const CORE_APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg"
];

const VERSIONED_APP_FILES = [
  "./style.css?v=65",
  "./app.js?v=112",

  /*
    Recent deployment fallbacks.
  */
  "./app.js?v=111",
  "./app.js?v=110",
  "./app.js?v=109",
  "./style.css?v=64",
  "./style.css?v=63"
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
                    `Could not pre-cache ${file}.`,
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
                (cacheName) => {
                  return (
                    cacheName !==
                    CACHE_NAME
                  );
                }
              )
              .map((cacheName) => {
                return caches.delete(
                  cacheName
                );
              })
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
    const request =
      event.request;

    if (
      request.method !== "GET"
    ) {
      return;
    }

    const url =
      new URL(request.url);

    /*
      External services are not intercepted.

      This includes Leaflet, Supabase,
      map tiles, Overpass and OSRM.
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
              ) ||
              Response.error()
            );
          })
      );

      return;
    }


    /* ---------------------------------------------- */
    /* Local application files                        */
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
              "/app.js"
            )
          ) {
            return (
              (
                await caches.match(
                  "./app.js?v=112"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=111"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=110"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=109"
                )
              ) ||
              Response.error()
            );
          }


          if (
            url.pathname.endsWith(
              "/style.css"
            )
          ) {
            return (
              (
                await caches.match(
                  "./style.css?v=65"
                )
              ) ||
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
