"use strict";

/* Road Discovery AU · Quartz Outback Time Studios · pitched driving camera */
(() => {
  function installDriveView() {
    const map = state.map;
    const shell = document.getElementById("appShell");
    const locate = document.getElementById("locateBtn");
    const north = document.getElementById("mapNorthIndicator");
    if (!map || !shell || !north || !locate) return;

    const phone = matchMedia("(max-width: 759px), (pointer: coarse) and (max-height: 600px)");
    const plane = map.getContainer();
    const style = document.createElement("style");
    style.textContent = `
      #rdDriveView {
        position: absolute; z-index: 1070; font-size: 15px; font-weight: 800;
        min-width: 44px; min-height: 44px;
      }
      #rdDriveView[hidden], #rdBrowseMap[hidden] { display: none; }
      #rdDriveView[aria-pressed="true"] { color: #ffb04a; border-color: #ff8a18; }
      #map.rd-pitched {
        /* Keep the real Leaflet centre at 68% of the screen height.
           Overscan covers the two far corners after projection. */
        position: absolute; inset: auto; left: -21%; top: -68%;
        width: 142%; height: 272%; transform-origin: center;
        transform: perspective(var(--rd-camera-distance)) rotateX(47deg) scale(1.30);
      }
      #rdBrowseMap {
        position: absolute; inset: 0; z-index: 2; background: transparent;
        width: 100%; height: 100%; padding: 0; border: 0; touch-action: manipulation;
      }
    `;
    document.head.append(style);

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
    // Reuse the app's compass/GPS heading even during a parked preview.
    const navigationActive = hs47NavigationIsActive;
    hs47NavigationIsActive = () => pitched || navigationActive();

    function updateButton() {
      button.hidden = !phone.matches;
      button.textContent = pitched ? "2D" : "3D";
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
      plane.style.setProperty("--rd-camera-distance", (shell.clientHeight * 1.8) + "px");
    }

    function setPitch(enabled) {
      if (enabled === pitched) return;
      const current = state.currentPoint;
      const hasPosition = current && Number.isFinite(current.lat) && Number.isFinite(current.lng);
      map.stop();
      const centre = enabled && hasPosition ? [current.lat, current.lng] : map.getCenter();
      const zoom = enabled && hasPosition ? Math.max(16, map.getZoom()) : map.getZoom();
      pitched = enabled;
      sizeCamera();
      plane.classList.toggle("rd-pitched", enabled);
      browse.hidden = !enabled;
      map.invalidateSize({animate: false, pan: false});
      map.setView(centre, zoom, {animate: false, reset: true});
      if (enabled) {
        state.followUser = true;
        state.mapHeadingMode = "heading";
        if (state.customConquest) state.customConquest.followBotId = null;
        void hs48RequestCompassPermission();
        if (hasPosition) hs47ApplyHeadingView(current);
        hs48ApplySelectedHeading();
        if (!hasPosition) void locateUser({zoom: true, quiet: true});
      }
      hs48RefreshCompassListener();
      hs47UpdateNorthIndicator();
      updateButton();
    }

    function onLayout() {
      if (!phone.matches) setPitch(false);
      if (pitched) sizeCamera();
      updateButton();
    }

    button.addEventListener("click", () => setPitch(!pitched));
    // Leaflet expects a flat hit plane for dragging and selecting waypoints.
    // A tap on the driving view returns the rider to the interactive 2D map.
    browse.addEventListener("click", () => setPitch(false));
    north.addEventListener("click", () => setPitch(false), true);
    document.getElementById("setWaypointBtn")?.addEventListener("click", () => setPitch(false), true);
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(onLayout);
      observer.observe(shell);
      observer.observe(locate);
    }
    window.addEventListener("resize", onLayout);
    phone.addEventListener("change", onLayout);
    onLayout();
  }
  document.addEventListener("DOMContentLoaded", installDriveView, {once: true});
})();
