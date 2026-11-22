"use strict";

/* Road Discovery AU · Quartz Outback Time Studios · pitched driving camera */
(() => {
  function installDriveView() {
    const map = state.map;
    const shell = document.getElementById("appShell");
    const locate = document.getElementById("locateBtn");
    const north = document.getElementById("mapNorthIndicator");
    if (!map || !shell || !north || !locate || document.getElementById("rdDriveView")) return;

    const phone = matchMedia("(max-width: 759px), (pointer: coarse) and (max-height: 600px)");
    const plane = map.getContainer();
    const lens = document.createElement("div");
    lens.id = "rdDriveLens";
    const style = document.createElement("style");
    style.textContent = `
      #rdDriveView {
        position: absolute; z-index: 1070; font-size: 15px; font-weight: 800;
        min-width: 44px; min-height: 44px;
      }
      #rdDriveView[hidden], #rdBrowseMap[hidden] { display: none; }
      #rdDriveView[aria-pressed="true"] { color: #ffb04a; border-color: #ff8a18; }
      #rdDriveLens { display: contents; }
      #rdDriveLens.rd-pitched {
        display: block; position: absolute; z-index: 1; overflow: hidden;
        left: calc(50% - var(--rd-lens-half)); top: calc(65% - var(--rd-horizon-depth));
        transform-origin: 50% var(--rd-horizon-depth);
        transform: perspective(var(--rd-distance)) rotateX(40deg) scale(var(--rd-scale));
        pointer-events: none;
      }
      #rdDriveLens.rd-pitched #map {
        position: absolute; inset: auto; transform-origin: center;
        left: calc(50% - var(--rd-map-half)); top: calc(var(--rd-horizon-depth) - var(--rd-map-half));
        width: var(--rd-side); height: var(--rd-side);
      }
      #rdDriveLens.rd-pitched .road-user-combined { transform: scale(var(--rd-marker-scale)); }
      #rdDriveLens.rd-pitched .road-user-combined-heading { transition: none; }
      #mapNorthIndicator.rd-pitched-north .map-north-arrow {
        transform: rotate(var(--rd-camera-bearing, 0deg)) !important; transition: none;
      }
      #rdBrowseMap {
        position: absolute; inset: 0; z-index: 2; background: transparent;
        width: 100%; height: 100%; padding: 0; border: 0; touch-action: manipulation;
      }
    `;
    document.head.append(style);
    plane.before(lens);
    lens.append(plane);

    const button = document.createElement("button");
    button.id = "rdDriveView";
    button.type = "button";
    button.className = "tool-btn";
    const browse = document.createElement("button");
    browse.id = "rdBrowseMap";
    browse.type = "button";
    browse.hidden = true;
    browse.setAttribute("aria-label", "Return to 2D to explore the map");
    shell.append(browse, button);

    let pitched = false;
    let flatZoom = 0;
    let originalTransform = "";
    let targetBearing = 0;
    let paintedBearing = null;
    let headingFrame = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    const savedPadding = new Map();
    // Reuse the app's compass/GPS heading even during a parked preview.
    const navigationActive = hs47NavigationIsActive;
    hs47NavigationIsActive = () => pitched || navigationActive();

    // A sensor turn rotates the already-drawn map. Leave Leaflet's projection
    // north-up for the whole 3D session, including its GPS and waypoint layers.
    const flatSetBearing = hs47SetMapBearing;
    hs47SetMapBearing = function (target, ...rest) {
      if (!pitched) return flatSetBearing(target, ...rest);
      if (!Number.isFinite(target)) return;
      targetBearing = ((target % 360) + 360) % 360;
      if (!headingFrame && !document.hidden) headingFrame = requestAnimationFrame(paintBearing);
    };

    function paintBearing() {
      headingFrame = 0;
      if (!pitched || document.hidden) return;
      if (paintedBearing !== null &&
          Math.abs(hs47ShortestBearingTurn(paintedBearing, targetBearing)) < 0.75) return;
      paintedBearing = targetBearing;
      plane.style.transform = "rotate(" + paintedBearing + "deg)";
      north.style.setProperty("--rd-camera-bearing", paintedBearing + "deg");
    }

    // A route may finish loading after the rider already chose 3D follow.
    // Keep the route chooser and selected lines, with the camera on the rider.
    const commitRoute = rd120CommitNormalRoute;
    rd120CommitNormalRoute = function (route, start, options) {
      return commitRoute(route, start, pitched && options?.fit ? {...options, fit: false} : options);
    };
    const fitChoices = rd120FitRouteChoices;
    rd120FitRouteChoices = function () {
      if (pitched && state.rd120RouteChoice.context === "normal") return;
      return fitChoices();
    };

    function updateButton() {
      button.hidden = !phone.matches;
      const label = pitched ? "2D" : "3D";
      if (button.textContent !== label) button.textContent = label;
      button.setAttribute("aria-label", "3D driving view");
      button.setAttribute("aria-pressed", String(pitched));
      button.title = pitched ? "Return to 2D" : "Look ahead in 3D";
      const base = shell.getBoundingClientRect();
      const anchor = locate.getBoundingClientRect();
      button.style.left = (anchor.right - base.left + 8) + "px";
      button.style.bottom = (base.bottom - anchor.bottom) + "px";
      button.style.height = anchor.height + "px";
    }

    function sizeCamera() {
      const width = shell.clientWidth;
      const height = shell.clientHeight;
      if (!width || !height || (width === lastWidth && height === lastHeight)) return;
      lastWidth = width;
      lastHeight = height;

      // Invert the perspective at the screen edges. Only this rectangle needs
      // compositing; far corners fit inside the square map at every bearing.
      const pitch = 40 * Math.PI / 180;
      const distance = 2.4 * height;
      const forward = 0.65 * height;
      const behind = height - forward;
      const farY = forward / (Math.cos(pitch) - forward * Math.sin(pitch) / distance);
      const nearY = behind / (Math.cos(pitch) + behind * Math.sin(pitch) / distance);
      const farX = width / 2 * (1 + farY * Math.sin(pitch) / distance);
      const side = Math.max(8, Math.floor(Math.min(704, Math.sqrt(width * height * 1.25))));
      const scale = 2 * Math.hypot(farX, farY) / (side - 4);
      const halfWidth = Math.ceil(farX / scale) + 1;
      const horizonDepth = Math.ceil(farY / scale) + 1;
      const css = lens.style;
      css.width = 2 * halfWidth + "px";
      css.height = horizonDepth + Math.ceil(nearY / scale) + 1 + "px";
      css.setProperty("--rd-side", side + "px");
      css.setProperty("--rd-map-half", side / 2 + "px");
      css.setProperty("--rd-lens-half", halfWidth + "px");
      css.setProperty("--rd-horizon-depth", horizonDepth + "px");
      css.setProperty("--rd-distance", distance + "px");
      css.setProperty("--rd-scale", String(scale));
      css.setProperty("--rd-marker-scale", String(1.3 / scale));
    }

    function setPitch(enabled, northUp = false) {
      if (enabled === pitched) return;
      const current = state.currentPoint;
      const hasPosition = current && Number.isFinite(current.lat) && Number.isFinite(current.lng);
      map.stop();
      const centre = enabled && hasPosition ? [current.lat, current.lng] : map.getCenter();
      let zoom;
      if (enabled) {
        flatZoom = map.getZoom();
        zoom = Math.max(map.getMinZoom(), (hasPosition ? Math.max(16, flatZoom) : flatZoom) - 1);
        originalTransform = plane.style.transform;
        targetBearing = hs47MapBearing();
        if (targetBearing) map.setBearing?.(0);
        paintedBearing = null;
        lastWidth = lastHeight = 0;
        sizeCamera();
        for (const renderer of [state.navigationSvgRenderer, state.userAccuracySvgRenderer,
                                state.userLocationSvgRenderer]) {
          if (!renderer || savedPadding.has(renderer)) continue;
          savedPadding.set(renderer, renderer.options.padding);
          renderer.options.padding = Math.min(renderer.options.padding, 0.1);
        }
      } else {
        zoom = flatZoom;
        cancelAnimationFrame(headingFrame);
        headingFrame = 0;
        plane.style.transform = originalTransform;
        for (const [renderer, padding] of savedPadding) renderer.options.padding = padding;
        savedPadding.clear();
      }
      pitched = enabled;
      lens.classList.toggle("rd-pitched", enabled);
      north.classList.toggle("rd-pitched-north", enabled);
      browse.hidden = !enabled;
      map.invalidateSize({animate: false, pan: false});
      map.setView(centre, zoom, {animate: false, reset: true});
      if (enabled) {
        paintBearing();
        state.followUser = true;
        state.mapHeadingMode = "heading";
        if (state.customConquest) state.customConquest.followBotId = null;
        void hs48RequestCompassPermission();
        if (hasPosition) hs47ApplyHeadingView(current);
        hs48ApplySelectedHeading();
        if (!hasPosition) void locateUser({zoom: false, quiet: true});
      } else {
        flatSetBearing(northUp ? 0 : targetBearing);
      }
      hs48RefreshCompassListener();
      hs47UpdateNorthIndicator();
      updateButton();
    }

    function onLayout() {
      if (!phone.matches) setPitch(false);
      if (pitched && (lastWidth !== shell.clientWidth || lastHeight !== shell.clientHeight)) {
        sizeCamera();
        map.invalidateSize({animate: false});
      }
      updateButton();
    }

    button.addEventListener("click", () => setPitch(!pitched));
    // Leaflet expects a flat hit plane for dragging and selecting waypoints.
    // A tap on the driving view returns the rider to the interactive 2D map.
    browse.addEventListener("click", () => setPitch(false));
    north.addEventListener("click", () => setPitch(false, true), true);
    document.getElementById("setWaypointBtn")?.addEventListener("click", () => setPitch(false), true);
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(onLayout);
      observer.observe(shell);
      observer.observe(locate);
    }
    window.addEventListener("resize", onLayout);
    phone.addEventListener("change", onLayout);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        cancelAnimationFrame(headingFrame);
        headingFrame = 0;
      } else if (pitched) {
        hs48ApplySelectedHeading();
        if (!headingFrame) headingFrame = requestAnimationFrame(paintBearing);
      }
    });
    onLayout();
  }
  document.addEventListener("DOMContentLoaded", installDriveView, {once: true});
})();
