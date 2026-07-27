"use strict";

/* Road Discovery AU v30
   - keeps existing local progress keys safe
   - adds Friends panel with fake/demo friends
   - adds friend profile and friend map preview
   - adds privacy toggles
   - keeps road progress local until backend is added later
*/

const STORAGE_KEY = "roadDiscoveryAU.visited.v1";
const SAVED_SEGMENTS_KEY = "roadDiscoveryAU.savedSegments.v1";
const FRIEND_SETTINGS_KEY = "roadDiscoveryAU.friendSettings.v1";
const TODAY_UNLOCKS_KEY = "roadDiscoveryAU.todayUnlocks.v1";

const UNLOCK_RADIUS_M = 20;
const MAX_GPS_ACCURACY_M = 35;
const SEGMENT_SIZE_M = 50;
const AU_TOTAL_UNLOCKS_ESTIMATE = 18000000;

const DEFAULT_CENTER = [-33.8688, 151.2093];
const DEFAULT_ZOOM = 14;

const ROAD_GREY = "#5f6975";
const ROAD_ORANGE = "#ff8a1f";
const ROUTE_BLUE = "#4aa3ff";

const DEMO_FRIENDS = [
  {
    id: "josh",
    name: "Josh",
    handle: "@joshroads",
    avatar: "J",
    australiaPercent: "0.0012%",
    unlocked: 210,
    todayKm: 2.31,
    weekKm: 18.4,
    previewPaths: [
      "M28 150 C70 105, 110 120, 148 82 S235 42, 292 62",
      "M64 42 C92 66, 92 96, 122 116 S174 140, 216 126",
      "M112 168 C150 146, 168 104, 195 76 S244 36, 286 28",
      "M34 92 C72 94, 112 76, 150 56 S226 48, 286 96"
    ],
    fullPaths: [
      "M74 492 C150 388, 260 412, 338 310 S542 166, 806 210",
      "M188 118 C270 184, 248 260, 334 336 S462 446, 610 398",
      "M318 554 C422 482, 460 356, 522 258 S660 104, 798 88",
      "M96 298 C214 300, 290 230, 400 176 S620 148, 792 312",
      "M138 420 C242 364, 304 362, 392 392 S580 476, 730 430",
      "M440 72 C430 172, 454 240, 528 318 S622 458, 656 554"
    ]
  },
  {
    id: "dad",
    name: "Dad",
    handle: "@dadroads",
    avatar: "D",
    australiaPercent: "0.0008%",
    unlocked: 144,
    todayKm: 1.12,
    weekKm: 9.7,
    previewPaths: [
      "M34 132 C82 110, 102 72, 150 66 S218 86, 282 44",
      "M54 58 C96 88, 126 120, 174 132 S234 116, 288 146",
      "M96 168 C130 134, 158 96, 184 70 S234 42, 292 84",
      "M26 96 C76 88, 102 102, 140 110 S214 86, 276 104"
    ],
    fullPaths: [
      "M80 430 C174 386, 230 260, 366 240 S568 274, 782 146",
      "M150 138 C254 214, 326 338, 468 376 S650 358, 820 454",
      "M282 544 C380 438, 462 278, 548 168 S682 84, 808 254",
      "M72 286 C214 254, 294 310, 408 336 S638 246, 792 306",
      "M218 486 C350 414, 438 426, 562 450 S680 476, 760 396"
    ]
  }
];

const $ = (id) => document.getElementById(id);

const els = {};

const state = {
  map: null,

  discoveredLayer: null,
  roadLayer: null,
  routeLayer: null,
  driveTrailLayer: null,

  userMarker: null,
  accuracyCircle: null,
  waypointMarker: null,

  watchId: null,
  driveActive: false,
  firstGpsFix: false,
  pickingWaypoint: false,

  currentPosition: null,
  lastTrailPoint: null,
  driveTrail: [],

  savedSegments: {},
  todayUnlocks: {
    date: getTodayKey(),
    keys: {}
  },

  roadSegments: new Map(),
  roadLayers: new Map(),

  lastRoadFetchCenter: null,
  lastRoadFetchAt: 0,
  fetchingRoads: false,

  waypoint: null,
  lastRouteAt: 0,
  lastRouteFrom: null,

  activeFriendId: "josh",

  friendSettings: {
    showProfile: false,
    showMap: false
  },

  toastTimer: null
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheEls();
  loadSavedState();
  initMap();
  bindEvents();
  renderAllStats();
  renderFriendsList();
  applyFriendSettingsToUI();
  setDriveStatus("Ready to drive");
  setGpsStatus("GPS idle");
  setAccuracyStatus("Waiting for location");
  showToast("Road Discovery AU ready");
}

function cacheEls() {
  const ids = [
    "map",
    "driveStatus",
    "gpsStatus",
    "australiaStat",
    "todayStat",
    "unlockedStat",
    "accuracyStatus",

    "settingsBtn",
    "waypointBtn",
    "friendsBtn",
    "clearWaypointBtn",

    "startBtn",
    "finishBtn",

    "panelBackdrop",

    "settingsPanel",
    "closeSettingsBtn",
    "friendProfileToggle",
    "friendMapToggle",
    "resetBtn",

    "waypointPanel",
    "closeWaypointBtn",
    "setWaypointBtn",
    "clearWaypointMenuBtn",

    "friendsPanel",
    "closeFriendsBtn",
    "friendsListView",
    "friendProfileView",
    "showAddFriendBtn",
    "addFriendBox",
    "friendSearchInput",
    "searchFriendBtn",
    "friendCodeInput",
    "addFriendCodeBtn",
    "friendRequestsList",
    "friendsList",
    "backToFriendsBtn",

    "friendProfileAvatar",
    "friendProfileName",
    "friendProfileHandle",
    "friendAustraliaStat",
    "friendUnlockedStat",
    "friendTodayStat",
    "friendWeekStat",
    "friendMapPreviewSvg",
    "openFriendMapBtn",
    "removeFriendBtn",
    "blockFriendBtn",

    "friendMapOverlay",
    "friendMapTitle",
    "friendFullMapSvg",
    "closeFriendMapBtn",

    "toast"
  ];

  ids.forEach((id) => {
    els[id] = $(id);
  });
}

function initMap() {
  if (!window.L) {
    showToast("Map library did not load");
    return;
  }

  state.map = L.map(els.map, {
    zoomControl: false,
    attributionControl: false,
    preferCanvas: true,
    tap: true
  }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    crossOrigin: true
  }).addTo(state.map);

  state.roadLayer = L.layerGroup().addTo(state.map);
  state.discoveredLayer = L.layerGroup().addTo(state.map);
  state.routeLayer = L.layerGroup().addTo(state.map);
  state.driveTrailLayer = L.layerGroup().addTo(state.map);

  state.map.on("moveend", () => {
    maybeFetchRoadsForMap();
  });

  state.map.on("click", (event) => {
    if (!state.pickingWaypoint) return;
    state.pickingWaypoint = false;
    setWaypoint(event.latlng);
  });

  maybeFetchRoadsForMap();
}

/* ---------- Storage ---------- */

function loadSavedState() {
  const savedSegments = readJson(SAVED_SEGMENTS_KEY, null);
  const olderVisited = readJson(STORAGE_KEY, null);

  if (savedSegments && typeof savedSegments === "object" && !Array.isArray(savedSegments)) {
    state.savedSegments = savedSegments;
  } else if (olderVisited && typeof olderVisited === "object" && !Array.isArray(olderVisited)) {
    state.savedSegments = olderVisited;
    saveSegments();
  } else {
    state.savedSegments = {};
  }

  const today = readJson(TODAY_UNLOCKS_KEY, null);
  if (today && today.date === getTodayKey() && today.keys && typeof today.keys === "object") {
    state.todayUnlocks = today;
  } else {
    state.todayUnlocks = {
      date: getTodayKey(),
      keys: {}
    };
    saveTodayUnlocks();
  }

  const friendSettings = readJson(FRIEND_SETTINGS_KEY, null);
  if (friendSettings && typeof friendSettings === "object") {
    state.friendSettings = {
      showProfile: !!friendSettings.showProfile,
      showMap: !!friendSettings.showMap
    };
  }
}

function saveSegments() {
  writeJson(SAVED_SEGMENTS_KEY, state.savedSegments);
  writeJson(STORAGE_KEY, state.savedSegments);
}

function saveTodayUnlocks() {
  writeJson(TODAY_UNLOCKS_KEY, state.todayUnlocks);
}

function saveFriendSettings() {
  writeJson(FRIEND_SETTINGS_KEY, state.friendSettings);
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    showToast("Could not save on this device");
  }
}

/* ---------- Events ---------- */

function bindEvents() {
  els.settingsBtn?.addEventListener("click", () => openPanel("settingsPanel"));
  els.waypointBtn?.addEventListener("click", () => openPanel("waypointPanel"));
  els.friendsBtn?.addEventListener("click", () => openFriendsPanel());

  els.panelBackdrop?.addEventListener("click", closePanels);

  els.closeSettingsBtn?.addEventListener("click", closePanels);
  els.closeWaypointBtn?.addEventListener("click", closePanels);
  els.closeFriendsBtn?.addEventListener("click", closePanels);

  els.startBtn?.addEventListener("click", startDrive);
  els.finishBtn?.addEventListener("click", finishDrive);

  els.resetBtn?.addEventListener("click", resetDiscoveredRoads);

  els.friendProfileToggle?.addEventListener("change", () => {
    state.friendSettings.showProfile = !!els.friendProfileToggle.checked;
    saveFriendSettings();

    if (state.friendSettings.showProfile) {
      showToast("Road Profile sharing on");
    } else {
      showToast("Road Profile sharing off");
    }
  });

  els.friendMapToggle?.addEventListener("change", () => {
    state.friendSettings.showMap = !!els.friendMapToggle.checked;
    saveFriendSettings();

    if (state.friendSettings.showMap) {
      showToast("Map overview sharing on");
    } else {
      showToast("Map overview sharing off");
    }
  });

  els.setWaypointBtn?.addEventListener("click", () => {
    state.pickingWaypoint = true;
    closePanels();
    showToast("Tap the map to set a waypoint");
  });

  els.clearWaypointBtn?.addEventListener("click", clearWaypoint);
  els.clearWaypointMenuBtn?.addEventListener("click", () => {
    clearWaypoint();
    closePanels();
  });

  els.showAddFriendBtn?.addEventListener("click", () => {
    els.addFriendBox?.classList.toggle("hidden");
  });

  els.searchFriendBtn?.addEventListener("click", () => {
    const value = els.friendSearchInput?.value.trim();
    if (!value) {
      showToast("Enter an exact username");
      return;
    }
    showToast("Real username search comes with backend");
  });

  els.addFriendCodeBtn?.addEventListener("click", () => {
    const value = els.friendCodeInput?.value.trim();
    if (!value) {
      showToast("Enter a friend code");
      return;
    }
    showToast("Friend codes come with backend");
  });

  els.backToFriendsBtn?.addEventListener("click", showFriendsListView);
  els.openFriendMapBtn?.addEventListener("click", openFriendFullMap);
  els.closeFriendMapBtn?.addEventListener("click", closeFriendFullMap);

  els.removeFriendBtn?.addEventListener("click", () => {
    const friend = getActiveFriend();
    showToast(`${friend.name} remove button is placeholder`);
  });

  els.blockFriendBtn?.addEventListener("click", () => {
    const friend = getActiveFriend();
    showToast(`${friend.name} block button is placeholder`);
  });

  window.addEventListener("online", () => showToast("Online"));
  window.addEventListener("offline", () => showToast("Offline"));
}

/* ---------- Panels ---------- */

function openPanel(panelId) {
  closePanels(false);

  els.panelBackdrop?.classList.remove("hidden");

  const panel = els[panelId];
  if (panel) {
    panel.classList.remove("hidden");
    panel.setAttribute("aria-hidden", "false");
  }
}

function closePanels(hideBackdrop = true) {
  ["settingsPanel", "waypointPanel", "friendsPanel"].forEach((id) => {
    const panel = els[id];
    if (!panel) return;
    panel.classList.add("hidden");
    panel.setAttribute("aria-hidden", "true");
  });

  if (hideBackdrop) {
    els.panelBackdrop?.classList.add("hidden");
  }
}

function openFriendsPanel() {
  renderFriendsList();
  showFriendsListView();
  openPanel("friendsPanel");
}

function showFriendsListView() {
  els.friendProfileView?.classList.add("hidden");
  els.friendsListView?.classList.remove("hidden");
}

function showFriendProfileView() {
  els.friendsListView?.classList.add("hidden");
  els.friendProfileView?.classList.remove("hidden");
}

/* ---------- Drive / GPS ---------- */

function startDrive() {
  if (!navigator.geolocation) {
    showToast("GPS is not available");
    return;
  }

  if (state.watchId !== null) {
    state.driveActive = true;
    setDriveStatus("Driving");
    showToast("Drive already started");
    return;
  }

  state.driveActive = true;
  state.firstGpsFix = false;
  state.driveTrail = [];
  state.lastTrailPoint = null;

  state.driveTrailLayer?.clearLayers();

  setDriveStatus("Starting GPS");
  setGpsStatus("GPS starting");

  state.watchId = navigator.geolocation.watchPosition(
    handlePosition,
    handlePositionError,
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000
    }
  );

  showToast("Drive started");
}

function finishDrive() {
  state.driveActive = false;
  setDriveStatus("Drive finished");

  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  setGpsStatus("GPS idle");
  showToast("Drive saved on this device");
  renderAllStats();
}

function handlePosition(position) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  const accuracy = position.coords.accuracy || 9999;

  const latlng = L.latLng(lat, lng);

  state.currentPosition = {
    lat,
    lng,
    accuracy,
    at: Date.now()
  };

  updateGpsVisuals(latlng, accuracy);

  if (!state.firstGpsFix) {
    state.firstGpsFix = true;
    state.map?.setView(latlng, Math.max(state.map.getZoom(), 16));
  }

  if (state.driveActive) {
    setDriveStatus("Driving");
    addTrailPoint(latlng, accuracy);
  }

  if (accuracy <= MAX_GPS_ACCURACY_M) {
    setGpsStatus("GPS good");
    setAccuracyStatus(`Accuracy ${Math.round(accuracy)} m`);
    unlockNearbyRoads(latlng);
  } else {
    setGpsStatus("GPS weak");
    setAccuracyStatus(`GPS too weak: ${Math.round(accuracy)} m`);
  }

  maybeFetchRoadsForPosition(latlng);
  maybeUpdateWaypointRoute(latlng);
}

function handlePositionError(error) {
  let message = "GPS error";

  if (error.code === 1) message = "GPS permission denied";
  if (error.code === 2) message = "GPS position unavailable";
  if (error.code === 3) message = "GPS timed out";

  setDriveStatus("GPS problem");
  setGpsStatus("GPS error");
  setAccuracyStatus(message);
  showToast(message);
}

function updateGpsVisuals(latlng, accuracy) {
  if (!state.map) return;

  if (!state.userMarker) {
    state.userMarker = L.circleMarker(latlng, {
      radius: 8,
      color: "#ffffff",
      weight: 2,
      fillColor: ROUTE_BLUE,
      fillOpacity: 1
    }).addTo(state.map);
  } else {
    state.userMarker.setLatLng(latlng);
  }

  if (!state.accuracyCircle) {
    state.accuracyCircle = L.circle(latlng, {
      radius: accuracy,
      color: ROUTE_BLUE,
      weight: 1,
      opacity: 0.35,
      fillColor: ROUTE_BLUE,
      fillOpacity: 0.08
    }).addTo(state.map);
  } else {
    state.accuracyCircle.setLatLng(latlng);
    state.accuracyCircle.setRadius(accuracy);
  }

  if (state.driveActive) {
    state.map.panTo(latlng, {
      animate: true,
      duration: 0.3
    });
  }
}

function addTrailPoint(latlng, accuracy) {
  if (accuracy > MAX_GPS_ACCURACY_M) return;

  if (state.lastTrailPoint) {
    const moved = distanceMeters(state.lastTrailPoint, latlng);
    if (moved < 8) return;
  }

  state.driveTrail.push([latlng.lat, latlng.lng]);
  state.lastTrailPoint = latlng;

  state.driveTrailLayer?.clearLayers();

  if (state.driveTrail.length >= 2) {
    L.polyline(state.driveTrail, {
      color: ROUTE_BLUE,
      weight: 4,
      opacity: 0.8,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(state.driveTrailLayer);
  }
}

/* ---------- Roads / discovery ---------- */

function maybeFetchRoadsForMap() {
  if (!state.map) return;

  const center = state.map.getCenter();

  if (state.map.getZoom() < 13) return;

  if (state.lastRoadFetchCenter) {
    const moved = distanceMeters(state.lastRoadFetchCenter, center);
    const recently = Date.now() - state.lastRoadFetchAt < 25000;
    if (moved < 450 && recently) return;
  }

  fetchRoadsForBounds(state.map.getBounds());
}

function maybeFetchRoadsForPosition(latlng) {
  if (!state.map) return;

  if (state.lastRoadFetchCenter) {
    const moved = distanceMeters(state.lastRoadFetchCenter, latlng);
    const recently = Date.now() - state.lastRoadFetchAt < 20000;
    if (moved < 350 && recently) return;
  }

  fetchRoadsForBounds(state.map.getBounds());
}

async function fetchRoadsForBounds(bounds) {
  if (!bounds || state.fetchingRoads) return;

  state.fetchingRoads = true;
  state.lastRoadFetchAt = Date.now();
  state.lastRoadFetchCenter = bounds.getCenter();

  const south = bounds.getSouth();
  const west = bounds.getWest();
  const north = bounds.getNorth();
  const east = bounds.getEast();

  const query = `
    [out:json][timeout:15];
    (
      way["highway"]
      ["highway"!~"footway|path|steps|cycleway|bridleway|corridor|elevator|escalator|platform|proposed|construction"]
      (${south},${west},${north},${east});
    );
    out geom;
  `;

  const url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Road request failed");

    const data = await response.json();
    addRoadsFromOverpass(data);
  } catch (error) {
    showToast("Could not load nearby roads");
  } finally {
    state.fetchingRoads = false;
  }
}

function addRoadsFromOverpass(data) {
  if (!data || !Array.isArray(data.elements)) return;

  let added = 0;

  data.elements.forEach((element) => {
    if (!element.geometry || element.geometry.length < 2) return;

    for (let i = 0; i < element.geometry.length - 1; i++) {
      const a = element.geometry[i];
      const b = element.geometry[i + 1];

      const from = L.latLng(a.lat, a.lon);
      const to = L.latLng(b.lat, b.lon);

      const pieces = splitSegmentIntoPieces(from, to, SEGMENT_SIZE_M);

      pieces.forEach((piece) => {
        const key = makeSegmentKey(piece[0], piece[1]);

        if (state.roadSegments.has(key)) return;

        state.roadSegments.set(key, {
          key,
          from: piece[0],
          to: piece[1]
        });

        drawRoadSegment(key);
        added++;
      });
    }
  });

  if (added > 0) {
    unlockVisibleAlreadySaved();
  }
}

function splitSegmentIntoPieces(from, to, sizeMeters) {
  const distance = distanceMeters(from, to);

  if (!Number.isFinite(distance) || distance <= 0) {
    return [];
  }

  const count = Math.max(1, Math.ceil(distance / sizeMeters));
  const pieces = [];

  for (let i = 0; i < count; i++) {
    const t1 = i / count;
    const t2 = (i + 1) / count;

    pieces.push([
      L.latLng(
        lerp(from.lat, to.lat, t1),
        lerp(from.lng, to.lng, t1)
      ),
      L.latLng(
        lerp(from.lat, to.lat, t2),
        lerp(from.lng, to.lng, t2)
      )
    ]);
  }

  return pieces;
}

function drawRoadSegment(key) {
  if (!state.roadSegments.has(key) || state.roadLayers.has(key)) return;

  const segment = state.roadSegments.get(key);
  const discovered = !!state.savedSegments[key];

  const layer = L.polyline(
    [
      [segment.from.lat, segment.from.lng],
      [segment.to.lat, segment.to.lng]
    ],
    {
      color: discovered ? ROAD_ORANGE : ROAD_GREY,
      weight: discovered ? 6 : 4,
      opacity: discovered ? 0.95 : 0.38,
      lineCap: "round",
      lineJoin: "round"
    }
  );

  layer.addTo(discovered ? state.discoveredLayer : state.roadLayer);
  state.roadLayers.set(key, layer);
}

function unlockVisibleAlreadySaved() {
  for (const key of state.roadLayers.keys()) {
    if (state.savedSegments[key]) {
      moveSegmentToDiscovered(key);
    }
  }
}

function unlockNearbyRoads(latlng) {
  let unlockedCount = 0;

  for (const [key, segment] of state.roadSegments.entries()) {
    if (state.savedSegments[key]) continue;

    const distance = pointToSegmentDistanceMeters(latlng, segment.from, segment.to);

    if (distance <= UNLOCK_RADIUS_M) {
      state.savedSegments[key] = {
        at: Date.now()
      };

      state.todayUnlocks.keys[key] = true;

      moveSegmentToDiscovered(key);
      unlockedCount++;
    }
  }

  if (unlockedCount > 0) {
    saveSegments();
    saveTodayUnlocks();
    renderAllStats();

    if (unlockedCount === 1) {
      showToast("Road painted orange");
    } else {
      showToast(`${unlockedCount} roads painted orange`);
    }
  }
}

function moveSegmentToDiscovered(key) {
  const existing = state.roadLayers.get(key);

  if (existing) {
    state.roadLayer?.removeLayer(existing);
    state.discoveredLayer?.removeLayer(existing);
    state.roadLayers.delete(key);
  }

  const segment = state.roadSegments.get(key);
  if (!segment) return;

  const layer = L.polyline(
    [
      [segment.from.lat, segment.from.lng],
      [segment.to.lat, segment.to.lng]
    ],
    {
      color: ROAD_ORANGE,
      weight: 6,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round"
    }
  ).addTo(state.discoveredLayer);

  state.roadLayers.set(key, layer);
}

function resetDiscoveredRoads() {
  const ok = confirm("Reset all discovered roads saved on this device?");
  if (!ok) return;

  state.savedSegments = {};
  state.todayUnlocks = {
    date: getTodayKey(),
    keys: {}
  };

  saveSegments();
  saveTodayUnlocks();

  state.discoveredLayer?.clearLayers();
  state.roadLayer?.clearLayers();
  state.roadLayers.clear();

  for (const key of state.roadSegments.keys()) {
    drawRoadSegment(key);
  }

  renderAllStats();
  showToast("Discovered roads reset");
}

/* ---------- Waypoint ---------- */

function setWaypoint(latlng) {
  if (!state.map) return;

  clearWaypoint(false);

  state.waypoint = {
    lat: latlng.lat,
    lng: latlng.lng
  };

  state.waypointMarker = L.marker(latlng).addTo(state.map);

  els.clearWaypointBtn?.classList.remove("hidden");

  showToast("Waypoint set");

  if (state.currentPosition) {
    routeToWaypoint();
  } else {
    showToast("Start GPS to route there");
  }
}

function clearWaypoint(showMessage = true) {
  state.waypoint = null;
  state.lastRouteAt = 0;
  state.lastRouteFrom = null;

  if (state.waypointMarker && state.map) {
    state.map.removeLayer(state.waypointMarker);
  }

  state.waypointMarker = null;
  state.routeLayer?.clearLayers();

  els.clearWaypointBtn?.classList.add("hidden");

  if (showMessage) showToast("Waypoint cleared");
}

function maybeUpdateWaypointRoute(currentLatLng) {
  if (!state.waypoint) return;

  const target = L.latLng(state.waypoint.lat, state.waypoint.lng);
  const distanceToTarget = distanceMeters(currentLatLng, target);

  if (distanceToTarget <= 35) {
    clearWaypoint(false);
    showToast("Arrived at waypoint");
    return;
  }

  if (!state.lastRouteFrom) {
    routeToWaypoint();
    return;
  }

  const movedFromLastRoute = distanceMeters(currentLatLng, state.lastRouteFrom);
  const oldRoute = Date.now() - state.lastRouteAt > 45000;

  if (movedFromLastRoute > 90 || oldRoute) {
    routeToWaypoint();
  }
}

async function routeToWaypoint() {
  if (!state.currentPosition || !state.waypoint) return;

  const from = L.latLng(state.currentPosition.lat, state.currentPosition.lng);
  const to = L.latLng(state.waypoint.lat, state.waypoint.lng);

  state.lastRouteAt = Date.now();
  state.lastRouteFrom = from;

  const url =
    "https://router.project-osrm.org/route/v1/driving/" +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    "?overview=full&geometries=geojson&steps=false";

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Route request failed");

    const data = await response.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;

    if (!Array.isArray(coords) || coords.length < 2) {
      throw new Error("No route");
    }

    const latlngs = coords.map((point) => [point[1], point[0]]);
    drawRoute(latlngs, false);
  } catch (error) {
    drawRoute(
      [
        [from.lat, from.lng],
        [to.lat, to.lng]
      ],
      true
    );
    showToast("Showing straight-line waypoint");
  }
}

function drawRoute(latlngs, dashed) {
  state.routeLayer?.clearLayers();

  L.polyline(latlngs, {
    color: ROUTE_BLUE,
    weight: 5,
    opacity: 0.88,
    lineCap: "round",
    lineJoin: "round",
    dashArray: dashed ? "8 10" : null
  }).addTo(state.routeLayer);
}

/* ---------- Friends ---------- */

function renderFriendsList() {
  if (!els.friendsList) return;

  els.friendsList.innerHTML = "";

  DEMO_FRIENDS.forEach((friend) => {
    const row = document.createElement("button");
    row.className = "friend-row";
    row.type = "button";
    row.dataset.friendId = friend.id;

    row.innerHTML = `
      <div class="friend-avatar">${escapeHtml(friend.avatar)}</div>

      <div class="friend-main">
        <div class="friend-name">${escapeHtml(friend.name)}</div>
        <div class="friend-sub">Australia ${escapeHtml(friend.australiaPercent)}</div>
      </div>

      <div class="friend-score">
        <strong>${formatNumber(friend.unlocked)}</strong>
        <span>/ 18M</span>
      </div>
    `;

    row.addEventListener("click", () => openFriendProfile(friend.id));

    els.friendsList.appendChild(row);
  });

  if (els.friendRequestsList) {
    els.friendRequestsList.innerHTML = `<div class="empty-state">No pending requests</div>`;
  }
}

function openFriendProfile(friendId) {
  const friend = DEMO_FRIENDS.find((item) => item.id === friendId) || DEMO_FRIENDS[0];
  state.activeFriendId = friend.id;

  if (els.friendProfileAvatar) els.friendProfileAvatar.textContent = friend.avatar;
  if (els.friendProfileName) els.friendProfileName.textContent = friend.name;
  if (els.friendProfileHandle) els.friendProfileHandle.textContent = friend.handle;
  if (els.friendAustraliaStat) els.friendAustraliaStat.textContent = friend.australiaPercent;
  if (els.friendUnlockedStat) els.friendUnlockedStat.textContent = `${formatNumber(friend.unlocked)} / 18M`;
  if (els.friendTodayStat) els.friendTodayStat.textContent = `${friend.todayKm.toFixed(2)} km`;
  if (els.friendWeekStat) els.friendWeekStat.textContent = `${friend.weekKm.toFixed(1)} km`;

  renderFriendPreviewSvg(friend);
  renderFriendFullMapSvg(friend);

  showFriendProfileView();
}

function renderFriendPreviewSvg(friend) {
  if (!els.friendMapPreviewSvg) return;

  els.friendMapPreviewSvg.innerHTML = "";

  friend.previewPaths.forEach((pathData) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    els.friendMapPreviewSvg.appendChild(path);
  });
}

function renderFriendFullMapSvg(friend) {
  if (!els.friendFullMapSvg) return;

  els.friendFullMapSvg.innerHTML = "";

  friend.fullPaths.forEach((pathData) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    els.friendFullMapSvg.appendChild(path);
  });
}

function openFriendFullMap() {
  const friend = getActiveFriend();

  if (els.friendMapTitle) {
    els.friendMapTitle.textContent = `${friend.name}’s Map`;
  }

  renderFriendFullMapSvg(friend);

  els.friendMapOverlay?.classList.remove("hidden");
  els.friendMapOverlay?.setAttribute("aria-hidden", "false");
}

function closeFriendFullMap() {
  els.friendMapOverlay?.classList.add("hidden");
  els.friendMapOverlay?.setAttribute("aria-hidden", "true");
}

function getActiveFriend() {
  return DEMO_FRIENDS.find((friend) => friend.id === state.activeFriendId) || DEMO_FRIENDS[0];
}

function applyFriendSettingsToUI() {
  if (els.friendProfileToggle) {
    els.friendProfileToggle.checked = !!state.friendSettings.showProfile;
  }

  if (els.friendMapToggle) {
    els.friendMapToggle.checked = !!state.friendSettings.showMap;
  }
}

/* ---------- Stats ---------- */

function renderAllStats() {
  fixTodayIfNeeded();

  const unlockedCount = Object.keys(state.savedSegments).length;
  const todayCount = Object.keys(state.todayUnlocks.keys).length;

  const australiaPercent = (unlockedCount / AU_TOTAL_UNLOCKS_ESTIMATE) * 100;
  const todayKm = (todayCount * SEGMENT_SIZE_M) / 1000;

  if (els.australiaStat) {
    els.australiaStat.textContent = `${australiaPercent.toFixed(4)}%`;
  }

  if (els.todayStat) {
    els.todayStat.textContent = `${todayKm.toFixed(2)} km`;
  }

  if (els.unlockedStat) {
    els.unlockedStat.textContent = `${formatNumber(unlockedCount)} / 18M`;
  }
}

function fixTodayIfNeeded() {
  const today = getTodayKey();

  if (state.todayUnlocks.date !== today) {
    state.todayUnlocks = {
      date: today,
      keys: {}
    };
    saveTodayUnlocks();
  }
}

/* ---------- UI helpers ---------- */

function setDriveStatus(text) {
  if (els.driveStatus) els.driveStatus.textContent = text;
}

function setGpsStatus(text) {
  if (els.gpsStatus) els.gpsStatus.textContent = text;
}

function setAccuracyStatus(text) {
  if (els.accuracyStatus) els.accuracyStatus.textContent = text;
}

function showToast(message) {
  if (!els.toast) return;

  els.toast.textContent = message;
  els.toast.classList.remove("hidden");

  clearTimeout(state.toastTimer);

  state.toastTimer = setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 2200);
}

/* ---------- Math / geo ---------- */

function distanceMeters(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);

  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function pointToSegmentDistanceMeters(point, a, b) {
  const originLat = point.lat;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(toRad(originLat));

  const px = point.lng * metersPerDegLng;
  const py = point.lat * metersPerDegLat;

  const ax = a.lng * metersPerDegLng;
  const ay = a.lat * metersPerDegLat;

  const bx = b.lng * metersPerDegLng;
  const by = b.lat * metersPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))
  );

  const closestX = ax + t * dx;
  const closestY = ay + t * dy;

  return Math.hypot(px - closestX, py - closestY);
}

function makeSegmentKey(a, b) {
  const p1 = `${roundCoord(a.lat)},${roundCoord(a.lng)}`;
  const p2 = `${roundCoord(b.lat)},${roundCoord(b.lng)}`;

  return p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
}

function roundCoord(value) {
  return Number(value).toFixed(5);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

/* ---------- Formatting ---------- */

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-AU");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
