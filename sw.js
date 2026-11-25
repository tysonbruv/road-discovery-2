"use strict";

/*
  Road Discovery AU v227 service worker
  Copyright © 2026 Quartz Outback Time Studios. All rights reserved.
  Build signature: QOTS-RDA-2026-V227-ROAD-BRIGHTNESS

  Expected frontend versions:
  - app.js?v=227
  - style.css?v=68
*/

const CACHE_NAME =
  "road-discovery-au-v227-drive-view-4";

const CORE_APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./style.css?v=68",
  "./app.js?v=227",
  "./drive-view.js?v=4"
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

          // Older URLs remain eligible for the network-first runtime cache.
          // Preloading every historical query downloads the same app repeatedly.
          try {
            await cache.add("./sponsor-admin.html");
          } catch (error) {
            console.warn("Could not pre-cache sponsor admin.", error);
          }
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
                  cacheName.startsWith("road-discovery-au-") &&
                  cacheName !== CACHE_NAME
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
      const isSponsorAdmin =
        url.pathname.endsWith(
          "/sponsor-admin.html"
        );

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
                    isSponsorAdmin
                      ? "./sponsor-admin.html"
                      : "./index.html",
                    responseCopy
                  )
                );
            }

            return networkResponse;
          })
          .catch(async () =>
            (
              await caches.match(
                isSponsorAdmin
                  ? "./sponsor-admin.html"
                  : "./index.html"
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

          if (url.pathname.endsWith("/drive-view.js")) {
            return (await caches.match("./drive-view.js?v=4")) || Response.error();
          }

          if (
            url.pathname.endsWith(
              "/app.js"
            )
          ) {
            return (
              await caches.match(
                "./app.js?v=227"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=226"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=225"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=224"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=223"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=222"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=221"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=218"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=217"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=216"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=215"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=214"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=213"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=212"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=211"
              )
            ) ||
              (
              await caches.match(
                "./app.js?v=210"
              )
            ) ||
              (
                await caches.match(
                  "./app.js?v=209"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=208"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=207"
                )
              ) ||
              (
                await caches.match(
                "./app.js?v=202"
              )
            ) ||
              (
                await caches.match(
                  "./app.js?v=201"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=199"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=198"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=197"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=196"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=195"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=194"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=193"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=192"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=191"
                )
              ) ||
              (
                await caches.match(
                  "./app.js?v=190"
                )
              ) ||
            (
              await caches.match(
                "./app.js?v=189"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=188"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=187"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=186"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=185"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=184"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=183"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=182"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=181"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=180"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=179"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=178"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=177"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=174"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=173"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=172"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=171"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=170"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=169"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=168"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=167"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=166"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=165"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=159"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=157"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=156"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=155"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=154"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=153"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=152"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=151"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=150"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=149"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=148"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=147"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=146"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=145"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=144"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=143"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=141"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=140"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=139"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=138"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=137"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=136"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=135"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=134"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=133"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=132"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=131"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=130"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=129"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=128"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=127"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=126"
              )
            ) ||
            (
              await caches.match(
                "./app.js?v=125"
              )
            ) ||
            (
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
            return (await caches.match("./style.css?v=68")) ||
                (await caches.match("./style.css?v=67")) ||
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
