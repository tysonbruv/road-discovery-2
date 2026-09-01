"use strict";

/*
  Road Discovery AU v127 service worker

  Expected frontend versions:
  - app.js?v=124
  - style.css?v=67
*/

const CACHE_NAME =
  "road-discovery-au-v127";

const CORE_APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg"
];

const VERSIONED_APP_FILES = [
  "./style.css?v=67",
  "./app.js?v=124",
  "./app.js?v=123",
  "./style.css?v=66",
  "./app.js?v=122",
  "./app.js?v=121",
  "./app.js?v=120",
  "./app.js?v=119",
  "./app.js?v=118",
  "./app.js?v=117",
  "./app.js?v=116",
  "./app.js?v=115",
  "./app.js?v=114",

  /* Recent deployment fallbacks. */
  "./app.js?v=113",
  "./app.js?v=112",
  "./app.js?v=111",
  "./app.js?v=110",
  "./style.css?v=65",
  "./style.css?v=64",
  "./style.css?v=63"
];


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


self.addEventListener(
  "activate",
  (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((cacheNames) =>
          Promise.all(
            cacheNames
              .filter(
                (cacheName) =>
                  cacheName !==
                    CACHE_NAME
              )
              .map((cacheName) =>
                caches.delete(cacheName)
              )
          )
        )
        .then(() =>
          self.clients.claim()
        )
    );
  }
);


self.addEventListener(
  "fetch",
  (event) => {
    const request = event.request;

    if (request.method !== "GET") {
      return;
    }

    const url = new URL(request.url);

    /*
      Leaflet, Supabase, map tiles, Overpass,
      OSRM and other external requests remain
      controlled by their own network services.
    */
    if (
      url.origin !==
        self.location.origin
    ) {
      return;
    }


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

              void caches
                .open(CACHE_NAME)
                .then((cache) =>
                  cache.put(
                    "./index.html",
                    responseCopy
                  )
                );
            }

            return networkResponse;
          })
          .catch(async () =>
            (
              await caches.match(
                "./index.html"
              )
            ) ||
            (
              await caches.match("./")
            ) ||
            Response.error()
          )
      );

      return;
    }


    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.ok
          ) {
            const responseCopy =
              networkResponse.clone();

            void caches
              .open(CACHE_NAME)
              .then((cache) =>
                cache.put(
                  request,
                  responseCopy
                )
              );
          }

          return networkResponse;
        })
        .catch(async () => {
          const exact =
            await caches.match(request);

          if (exact) return exact;


          if (
            url.pathname.endsWith(
              "/app.js"
            )
          ) {
            return (
              await caches.match(
                "./app.js?v=124"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=123"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=122"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=121"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=120"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=119"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=118"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=117"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=116"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=115"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=114"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=113"
              )
            ) ||
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
            Response.error();
          }


          if (
            url.pathname.endsWith(
              "/style.css"
            )
          ) {
            return (
                  await caches.match(
                    "./style.css?v=67"
                  )
                ) ||
                (
                  await caches.match(
                    "./style.css?v=66"
                  )
                ) ||
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
            Response.error();
          }


          if (
            url.pathname.endsWith(
              "/manifest.json"
            )
          ) {
            return (
              await caches.match(
                "./manifest.json"
              )
            ) ||
            Response.error();
          }


          if (
            url.pathname.endsWith(
              "/icon.svg"
            )
          ) {
            return (
              await caches.match(
                "./icon.svg"
              )
            ) ||
            Response.error();
          }


          return Response.error();
        })
    );
  }
);
