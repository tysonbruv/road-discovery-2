"use strict";

/*
  Road Discovery AU v99 service worker

  Cleaner Conquest settings and selectable match length.

  Expected frontend versions:
  - app.js?v=98
  - style.css?v=65
*/

const CACHE_NAME = "road-discovery-au-v99";

const CORE_APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg"
];

const VERSIONED_APP_FILES = [
  "./style.css?v=65",
  "./app.js?v=98",
  "./app.js?v=97",
  "./app.js?v=96",
  "./app.js?v=95",

  /* Recent fallbacks used during a staged GitHub update. */
  "./app.js?v=94",
  "./app.js?v=93",
  "./style.css?v=64",
  "./style.css?v=63"
];

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

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  /*
    Leaflet, Supabase, map tiles, Overpass and OSRM remain
    network-managed and are not intercepted here.
  */
  if (url.origin !== self.location.origin) {
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
            (await caches.match("./index.html")) ||
            (await caches.match("./"))
          );
        })
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

          caches
            .open(CACHE_NAME)
            .then((cache) => {
              cache.put(request, responseCopy);
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

        if (url.pathname.endsWith("/style.css")) {
          return (
            (await caches.match("./style.css?v=65")) ||
            (await caches.match("./style.css?v=64")) ||
            (await caches.match("./style.css?v=63")) ||
            Response.error()
          );
        }

        if (url.pathname.endsWith("/app.js")) {
          return (
            (await caches.match("./app.js?v=98")) ||
            (await caches.match("./app.js?v=97")) ||
            (await caches.match("./app.js?v=96")) ||
            (await caches.match("./app.js?v=95")) ||
            (await caches.match("./app.js?v=94")) ||
            (await caches.match("./app.js?v=93")) ||
            Response.error()
          );
        }

        if (
          url.pathname.endsWith("/manifest.json")
        ) {
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
