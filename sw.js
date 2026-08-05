"use strict";

/*
  Road Discovery AU v64 service worker

  Private local My Places map icons.

  Expected frontend versions:
  - app.js?v=63
  - style.css?v=47

  Previous files are recognised during the update so the site can
  upgrade safely while GitHub files are replaced one at a time.
*/

const CACHE_NAME = "road-discovery-au-v64";

const CORE_APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg"
];

const VERSIONED_APP_FILES = [
  "./style.css?v=47",
  "./app.js?v=63",
  "./style.css?v=46",
  "./app.js?v=62",
  "./app.js?v=61",
  "./app.js?v=60",
  "./app.js?v=59",
  "./style.css?v=45",
  "./app.js?v=58",
  "./style.css?v=44",
  "./app.js?v=57",
  "./app.js?v=56",
  "./app.js?v=55",
  "./app.js?v=54",
  "./style.css?v=43",
  "./app.js?v=53",
  "./style.css?v=42",
  "./app.js?v=52",
  "./app.js?v=51",
  "./app.js?v=50",
  "./style.css?v=41",
  "./app.js?v=49",
  "./app.js?v=48",
  "./style.css?v=40",
  "./app.js?v=47",

  /* Previous Hide & Seek version. */
  "./style.css?v=39",
  "./app.js?v=46",

  /* Previous checkpoint fallback. */
  "./style.css?v=38",
  "./app.js?v=45",

  /* Temporary fallbacks during a one-file-at-a-time upload. */
  "./app.js?v=44",
  "./style.css?v=37",
  "./app.js?v=43",
  "./style.css?v=36",
  "./app.js?v=42"
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
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName))
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

  /* Do not intercept external tiles, road data, routing or Supabase. */
  if (url.origin !== self.location.origin) {
    return;
  }

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
        const exactCachedResponse = await caches.match(request);

        if (exactCachedResponse) {
          return exactCachedResponse;
        }

        if (url.pathname.endsWith("/style.css")) {
          return (
            (await caches.match("./style.css?v=47")) ||
            (await caches.match("./style.css?v=46")) ||
            (await caches.match("./style.css?v=45")) ||
            (await caches.match("./style.css?v=44")) ||
            (await caches.match("./style.css?v=43")) ||
            (await caches.match("./style.css?v=42")) ||
            (await caches.match("./style.css?v=41")) ||
            (await caches.match("./style.css?v=40")) ||
            (await caches.match("./style.css?v=39")) ||
            (await caches.match("./style.css?v=38")) ||
            (await caches.match("./style.css?v=37")) ||
            (await caches.match("./style.css?v=36")) ||
            Response.error()
          );
        }

        if (url.pathname.endsWith("/app.js")) {
          return (
            (await caches.match("./app.js?v=63")) ||
            (await caches.match("./app.js?v=62")) ||
            (await caches.match("./app.js?v=61")) ||
            (await caches.match("./app.js?v=60")) ||
            (await caches.match("./app.js?v=59")) ||
            (await caches.match("./app.js?v=58")) ||
            (await caches.match("./app.js?v=57")) ||
            (await caches.match("./app.js?v=56")) ||
            (await caches.match("./app.js?v=55")) ||
            (await caches.match("./app.js?v=54")) ||
            (await caches.match("./app.js?v=53")) ||
            (await caches.match("./app.js?v=52")) ||
            (await caches.match("./app.js?v=51")) ||
            (await caches.match("./app.js?v=50")) ||
            (await caches.match("./app.js?v=49")) ||
            (await caches.match("./app.js?v=48")) ||
            (await caches.match("./app.js?v=47")) ||
            (await caches.match("./app.js?v=46")) ||
            (await caches.match("./app.js?v=45")) ||
            (await caches.match("./app.js?v=44")) ||
            (await caches.match("./app.js?v=43")) ||
            (await caches.match("./app.js?v=42")) ||
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
