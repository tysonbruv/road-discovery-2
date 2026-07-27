"use strict";

/* Road Discovery AU v31
   - restores the stable v29 road/GPS engine
   - keeps existing v29 progress keys and saved coordinates
   - safely migrates v30 coordinate-key progress where possible
   - restores the My Location button
   - preloads nearby grey roads before Start Drive
   - keeps the v30 Friends, Settings and Waypoint UI
*/

const STORAGE_KEY = "roadDiscoveryAU.visited.v1";
const SAVED_SEGMENTS_KEY = "roadDiscoveryAU.savedSegments.v1";
const FRIEND_SETTINGS_KEY = "roadDiscoveryAU.friendSettings.v1";
const TODAY_UNLOCKS_KEY = "roadDiscoveryAU.todayUnlocks.v1";

const AU_TOTAL_UNLOCKS_ESTIMATE = 18000000;

const UNLOCK_RADIUS_M = 20;
const MAX_GPS_ACCURACY_M = 35;
const SEGMENT_SIZE_M = 50;

const LOAD_RADIUS_M = 2500;
const AUTO_RELOAD_DISTANCE_M = 1700;
const MIN_AUTO_RELOAD_TIME_MS = 12000;

const ROUTE_ARRIVAL_RADIUS_M = 35;
const ROUTE_REROUTE_DISTANCE_M = 120;
const ROUTE_MIN_REROUTE_TIME_MS = 45000;

const DEFAULT_CENTER = [-33.8688, 151.2093];
const DEFAULT_ZOOM = 14;

const ROAD_GREY = "#4e5563";
const ROAD_ORANGE = "#ff8a18";
const ROAD_CURRENT = "#ffb04a";
const ROUTE_BLUE = "#4bb3ff";

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

  roadsLayer: L.layerGroup(),
  savedLayer: L.layerGroup(),
  tripLayer: L.layerGroup(),
  routeLayer: L.layerGroup(),

  userMarker: null,
  accuracyCircle: null,

  roadSegments: [],
  roadSegmentIds: new Set(),

  visited: {},
  savedSegments: {},
  savedSegmentIds: new Set(),
  savedDrawnIds: new Set(),
  needsSavedSegmentsSave: false,

  todayUnlocks: {
    date: getTodayKey(),
    keys: {}
  },

  watchId: null,
  isRecording: false,
  followUser: true,

  tripUnlocked: new Set(),
  tripDistanceM: 0,
  lastPoint: null,
  currentPoint: null,

  lastRoadLoadCenter: null,
  lastAutoReloadAt: 0,
  isLoadingRoads: false,
  roadLoadPromise: null,

  waypointPoint: null,
  waypointMarker: null,
  routeLine: null,
  routeHalo: null,
  routeDistanceM: 0,
  routeDurationS: 0,
  lastRouteStartPoint: null,
  lastRouteAt: 0,
  isRouting: false,
  awaitingWaypointClick: false,
  routeRequestId: 0,

  activeFriendId: "josh",
  friendSettings: {
    showProfile: false,
    showMap: false
  },

  toastTimer: null
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  ensureLocateButton();
  cacheEls();
  loadSavedState();
  initMap();
  bindEvents();

  renderAllStats();
  renderFriendsList();
  applyFriendSettingsToUI();
  setDriveButtons("idle");
  setDriveStatus("Ready to drive");
  setGpsStatus("Finding GPS");
  setAccuracyStatus("Waiting for location");

  locateUser({
    zoom: false,
    loadRoads: true,
    quiet: true
  });
}

function ensureLocateButton() {
  if ($("locateBtn")) return;

  const toolStack = document.querySelector(".tool-stack");
  if (!toolStack) return;

  const button = document.createElement("button");
  button.id = "locateBtn";
  button.className = "tool-btn";
  button.type = "button";
  button.title = "Centre on me";
  button.setAttribute("aria-label", "Centre map on my location");
  button.textContent = "◎";

  const clearButton = $("clearWaypointBtn");

  if (clearButton && clearButton.parentElement === toolStack) {
    toolStack.insertBefore(button, clearButton);
  } else {
    toolStack.appendChild(button);
  }
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
    "locateBtn",
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
  if (!window.L || !els.map) {
    showToast("Map library did not load");
    return;
  }

  state.map = L.map(els.map, {
    zoomControl: false,
    preferCanvas: true,
    attributionControl: false,
    tap: true
  }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    crossOrigin: true,
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
  }).addTo(state.map);

  state.roadsLayer.addTo(state.map);
  state.savedLayer.addTo(state.map);
  state.tripLayer.addTo(state.map);
  state.routeLayer.addTo(state.map);

  drawSavedSegments();

  state.map.on("click", onMapClickForWaypoint);

  state.map.on("dragstart", () => {
    state.followUser = false;
  });

  setTimeout(() => {
    state.map?.invalidateSize(true);
  }, 250);

  setTimeout(() => {
    state.map?.invalidateSize(true);
  }, 1000);

  window.addEventListener("resize", () => {
    state.map?.invalidateSize(true);
  });
}

/* ---------- Storage ---------- */

function loadSavedState() {
  state.visited = loadVisited();
  state.savedSegments = loadSavedSegments();
  state.savedSegmentIds = new Set(Object.keys(state.savedSegments));

  const today = readJson(TODAY_UNLOCKS_KEY, null);

  if (
    today &&
    today.date === getTodayKey() &&
    today.keys &&
    typeof today.keys === "object" &&
    !Array.isArray(today.keys)
  ) {
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
      showProfile: Boolean(friendSettings.showProfile),
      showMap: Boolean(friendSettings.showMap)
    };
  }
}

function loadVisited() {
  const raw = readJson(STORAGE_KEY, {});
  const visited = {};

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return visited;
  }

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number") {
      visited[key] = value;
      continue;
    }

    if (value && typeof value === "object") {
      const timestamp =
        Number(value.unlockedAt) ||
        Number(value.at) ||
        Number(value.timestamp) ||
        0;

      if (timestamp > 0) {
        visited[key] = timestamp;
      }
    }
  }

  return visited;
}

function loadSavedSegments() {
  const raw = readJson(SAVED_SEGMENTS_KEY, {});
  const saved = {};

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return saved;
  }

  for (const [key, value] of Object.entries(raw)) {
    const normalised = normaliseSavedSegment(key, value);

    if (normalised) {
      saved[normalised.id] = normalised;
    }
  }

  return saved;
}

function normaliseSavedSegment(key, value) {
  if (value && typeof value === "object" && validCoords(value.coords)) {
    return {
      id: String(value.id || key),
      name: String(value.name || "Discovered road"),
      highway: String(value.highway || "road"),
      coords: compactCoords(value.coords),
      lengthM:
        Number(value.lengthM) ||
        Math.round(
          haversine(
            coordToPoint(value.coords[0]),
            coordToPoint(value.coords[1])
          )
        ),
      unlockedAt:
        Number(value.unlockedAt) ||
        Number(value.at) ||
        Number(state.visited[key]) ||
        Date.now()
    };
  }

  const parsedCoords = parseCoordinateSegmentKey(key);

  if (parsedCoords) {
    return {
      id: key,
      name: "Discovered road",
      highway: "road",
      coords: compactCoords(parsedCoords),
      lengthM: Math.round(
        haversine(
          coordToPoint(parsedCoords[0]),
          coordToPoint(parsedCoords[1])
        )
      ),
      unlockedAt:
        Number(value?.unlockedAt) ||
        Number(value?.at) ||
        Number(value) ||
        Date.now()
    };
  }

  return null;
}

function parseCoordinateSegmentKey(key) {
  if (typeof key !== "string" || !key.includes("|")) return null;

  const parts = key.split("|");
  if (parts.length !== 2) return null;

  const a = parts[0].split(",").map(Number);
  const b = parts[1].split(",").map(Number);

  if (
    a.length !== 2 ||
    b.length !== 2 ||
    !a.every(Number.isFinite) ||
    !b.every(Number.isFinite)
  ) {
    return null;
  }

  return [
    [a[0], a[1]],
    [b[0], b[1]]
  ];
}

function validCoords(coords) {
  return (
    Array.isArray(coords) &&
    coords.length >= 2 &&
    coords.every(
      (coord) =>
        Array.isArray(coord) &&
        coord.length >= 2 &&
        Number.isFinite(Number(coord[0])) &&
        Number.isFinite(Number(coord[1]))
    )
  );
}

function saveVisited() {
  writeJson(STORAGE_KEY, state.visited);
}

function saveSavedSegments() {
  try {
    localStorage.setItem(
      SAVED_SEGMENTS_KEY,
      JSON.stringify(state.savedSegments)
    );
  } catch (error) {
    console.error(error);
    showToast("Storage is full. Some orange roads may not save");
  }
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
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(error);
    showToast("Could not save on this device");
  }
}

/* ---------- Events ---------- */

function bindEvents() {
  els.settingsBtn?.addEventListener("click", () => {
    openPanel("settingsPanel");
  });

  els.waypointBtn?.addEventListener("click", () => {
    openPanel("waypointPanel");
  });

  els.friendsBtn?.addEventListener("click", openFriendsPanel);

  els.locateBtn?.addEventListener("click", () => {
    state.followUser = true;

    locateUser({
      zoom: true,
      loadRoads: true,
      quiet: false
    });
  });

  els.panelBackdrop?.addEventListener("click", closePanels);

  els.closeSettingsBtn?.addEventListener("click", closePanels);
  els.closeWaypointBtn?.addEventListener("click", closePanels);
  els.closeFriendsBtn?.addEventListener("click", closePanels);

  els.startBtn?.addEventListener("click", startDrive);
  els.finishBtn?.addEventListener("click", finishDrive);

  els.resetBtn?.addEventListener("click", resetDiscoveredRoads);

  els.friendProfileToggle?.addEventListener("change", () => {
    state.friendSettings.showProfile = Boolean(
      els.friendProfileToggle.checked
    );

    saveFriendSettings();

    showToast(
      state.friendSettings.showProfile
        ? "Road Profile sharing on"
        : "Road Profile sharing off"
    );
  });

  els.friendMapToggle?.addEventListener("change", () => {
    state.friendSettings.showMap = Boolean(
      els.friendMapToggle.checked
    );

    saveFriendSettings();

    showToast(
      state.friendSettings.showMap
        ? "Map overview sharing on"
        : "Map overview sharing off"
    );
  });

  els.setWaypointBtn?.addEventListener("click", () => {
    state.awaitingWaypointClick = true;
    closePanels();
    updateWaypointButtons();
    setDriveStatus("Tap the map for waypoint");
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

    showToast("Real username search needs the backend");
  });

  els.addFriendCodeBtn?.addEventListener("click", () => {
    const value = els.friendCodeInput?.value.trim();

    if (!value) {
      showToast("Enter a friend code");
      return;
    }

    showToast("Friend codes need the backend");
  });

  els.backToFriendsBtn?.addEventListener(
    "click",
    showFriendsListView
  );

  els.openFriendMapBtn?.addEventListener(
    "click",
    openFriendFullMap
  );

  els.closeFriendMapBtn?.addEventListener(
    "click",
    closeFriendFullMap
  );

  els.removeFriendBtn?.addEventListener("click", () => {
    const friend = getActiveFriend();

    showToast(
      `${friend.name} remove button is a placeholder`
    );
  });

  els.blockFriendBtn?.addEventListener("click", () => {
    const friend = getActiveFriend();

    showToast(
      `${friend.name} block button is a placeholder`
    );
  });

  window.addEventListener("online", () => {
    showToast("Online");
  });

  window.addEventListener("offline", () => {
    showToast("Offline");
  });
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
  [
    "settingsPanel",
    "waypointPanel",
    "friendsPanel"
  ].forEach((id) => {
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

/* ---------- GPS / drive ---------- */

async function locateUser(options = {}) {
  const {
    zoom = true,
    loadRoads: shouldLoadRoads = false,
    quiet = false
  } = options;

  if (!navigator.geolocation) {
    setGpsStatus("GPS unavailable");
    setAccuracyStatus(
      "This browser cannot access location"
    );

    if (!quiet) {
      showToast(
        "GPS is not available in this browser"
      );
    }

    return null;
  }

  if (!quiet) {
    setGpsStatus("Finding GPS");
    setAccuracyStatus("Getting your location");
  }

  const position = await getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 5000
  });

  if (!position) {
    setGpsStatus("GPS unavailable");
    setAccuracyStatus(
      "Location permission blocked or unavailable"
    );

    if (!quiet) {
      showToast("Could not get your location");
    }

    return null;
  }

  const point = positionToPoint(position);

  state.currentPoint = point;

  updateUserMarker(point);

  if (state.map) {
    if (zoom) {
      state.map.setView(
        [point.lat, point.lng],
        16
      );
    } else {
      state.map.setView(
        [point.lat, point.lng],
        Math.max(
          state.map.getZoom(),
          DEFAULT_ZOOM
        )
      );
    }
  }

  setGpsStatus(
    point.accuracy <= MAX_GPS_ACCURACY_M
      ? "GPS good"
      : "GPS weak"
  );

  setAccuracyStatus(
    `Accuracy ${Math.round(point.accuracy)} m`
  );

  if (!state.isRecording) {
    setDriveStatus("Ready to drive");
  }

  if (shouldLoadRoads) {
    await ensureRoadsNearPoint(point, {
      replaceIfFar: true,
      quiet
    });
  }

  return point;
}

function getCurrentPosition(options) {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      () => resolve(null),
      options
    );
  });
}

async function startDrive() {
  if (!navigator.geolocation) {
    showToast("GPS is not available");
    return;
  }

  if (state.isRecording) {
    showToast("Drive is already running");
    return;
  }

  stopGpsWatch();
  resetTripState();
  setDriveButtons("loading");
  setDriveStatus("Finding GPS");
  setGpsStatus("GPS starting");
  setAccuracyStatus(
    "Getting a clean location"
  );

  const position = await getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 2000
  });

  if (!position) {
    setDriveButtons("idle");
    setDriveStatus("Could not start");
    setGpsStatus("GPS unavailable");
    setAccuracyStatus(
      "Move outside and check location permission"
    );

    showToast(
      "Could not get GPS. Tap Start Drive to try again"
    );

    return;
  }

  const point = positionToPoint(position);

  state.currentPoint = point;
  state.followUser = true;

  updateUserMarker(point);

  state.map?.setView(
    [point.lat, point.lng],
    16
  );

  setDriveStatus("Loading nearby roads");

  setGpsStatus(
    point.accuracy <= MAX_GPS_ACCURACY_M
      ? "GPS good"
      : "GPS weak"
  );

  setAccuracyStatus(
    `Accuracy ${Math.round(point.accuracy)} m`
  );

  const roadsReady = await ensureRoadsNearPoint(
    point,
    {
      replaceIfFar: true,
      quiet: false
    }
  );

  if (
    !roadsReady ||
    state.roadSegments.length === 0
  ) {
    setDriveButtons("idle");
    setDriveStatus("Roads did not load");

    showToast(
      "Could not load nearby roads. Check reception and try again"
    );

    return;
  }

  beginGpsWatch();
}

function beginGpsWatch() {
  stopGpsWatch();

  state.isRecording = true;

  document.body.classList.add("recording");

  setDriveButtons("recording");
  setDriveStatus("Driving");
  setGpsStatus("GPS active");

  state.watchId =
    navigator.geolocation.watchPosition(
      onGpsPosition,
      onGpsError,
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000
      }
    );

  showToast("Drive started");
}

function finishDrive() {
  if (
    !state.isRecording &&
    state.watchId === null
  ) {
    showToast("No drive is running");
    return;
  }

  stopGpsWatch();

  state.isRecording = false;

  document.body.classList.remove(
    "recording"
  );

  setDriveButtons("idle");

  const travelledKm =
    metersToKm(state.tripDistanceM);

  const discoveredKm =
    sumTripUnlockedKm().toFixed(2);

  const unlocked =
    state.tripUnlocked.size.toLocaleString(
      "en-AU"
    );

  setDriveStatus("Drive finished");
  setGpsStatus("GPS idle");

  setAccuracyStatus(
    `${travelledKm} km travelled • ` +
    `${discoveredKm} km discovered • ` +
    `${unlocked} unlocks`
  );

  renderAllStats();

  showToast("Drive saved on this device");
}

function stopGpsWatch() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(
      state.watchId
    );

    state.watchId = null;
  }
}

function resetTripState() {
  state.tripUnlocked.clear();
  state.tripDistanceM = 0;
  state.lastPoint = null;

  state.tripLayer.clearLayers();

  for (const segment of state.roadSegments) {
    segment.currentTrip = false;
    styleSegment(segment);
  }
}

function onGpsPosition(position) {
  const point = positionToPoint(position);

  state.currentPoint = point;

  updateUserMarker(point);

  if (state.followUser) {
    state.map?.panTo(
      [point.lat, point.lng],
      {
        animate: true,
        duration: 0.3
      }
    );
  }

  maybeAutoLoadMoreRoads(point);

  if (
    point.accuracy >
    MAX_GPS_ACCURACY_M
  ) {
    setGpsStatus("GPS weak");

    setAccuracyStatus(
      `Accuracy ${Math.round(
        point.accuracy
      )} m — waiting for a cleaner signal`
    );

    return;
  }

  setGpsStatus("GPS good");

  setAccuracyStatus(
    `Accuracy ${Math.round(point.accuracy)} m`
  );

  if (state.lastPoint) {
    const distance = haversine(
      state.lastPoint,
      point
    );

    if (distance < 150) {
      state.tripDistanceM += distance;
    }

    drawTripLine(
      state.lastPoint,
      point
    );
  }

  state.lastPoint = point;

  unlockNearbySegments(point);
  maybeUpdateWaypointRoute(point);
  renderAllStats();

  if (
    !state.isLoadingRoads &&
    !state.isRouting
  ) {
    setDriveStatus("Driving");
  }
}

function onGpsError(error) {
  const message =
    error?.code === 1
      ? "GPS permission denied"
      : error?.code === 2
        ? "GPS position unavailable"
        : error?.code === 3
          ? "GPS timed out"
          : "GPS error";

  setDriveStatus("GPS problem");
  setGpsStatus("GPS error");
  setAccuracyStatus(message);
  showToast(message);
}

function updateUserMarker(point) {
  if (!state.map) return;

  const latlng = [
    point.lat,
    point.lng
  ];

  if (!state.userMarker) {
    state.userMarker = L.circleMarker(
      latlng,
      {
        radius: 8,
        color: "#eef7ff",
        weight: 3,
        fillColor: ROUTE_BLUE,
        fillOpacity: 1,
        interactive: false
      }
    ).addTo(state.map);
  } else {
    state.userMarker.setLatLng(latlng);
  }

  if (!state.accuracyCircle) {
    state.accuracyCircle = L.circle(
      latlng,
      {
        radius:
          point.accuracy || 20,
        color: ROUTE_BLUE,
        opacity: 0.35,
        fillColor: ROUTE_BLUE,
        fillOpacity: 0.06,
        weight: 1,
        interactive: false
      }
    ).addTo(state.map);
  } else {
    state.accuracyCircle.setLatLng(
      latlng
    );

    state.accuracyCircle.setRadius(
      point.accuracy || 20
    );
  }
}

/* ---------- Roads / discovery ---------- */

async function ensureRoadsNearPoint(
  point,
  options = {}
) {
  const {
    replaceIfFar = true,
    quiet = false
  } = options;

  if (state.roadLoadPromise) {
    await state.roadLoadPromise;
  }

  const needsRoads =
    state.roadSegments.length === 0;

  const tooFarFromLoadedArea =
    !state.lastRoadLoadCenter ||
    haversine(
      point,
      state.lastRoadLoadCenter
    ) > 1000;

  if (
    !needsRoads &&
    (
      !replaceIfFar ||
      !tooFarFromLoadedArea
    )
  ) {
    return true;
  }

  return loadRoads(
    point.lat,
    point.lng,
    LOAD_RADIUS_M,
    {
      replace: true,
      reason:
        quiet
          ? "preview"
          : "initial"
    }
  );
}

function loadRoads(
  lat,
  lng,
  radiusM,
  options = {}
) {
  if (state.roadLoadPromise) {
    return state.roadLoadPromise;
  }

  const {
    replace = false,
    reason = "manual"
  } = options;

  state.roadLoadPromise = (
    async () => {
      state.isLoadingRoads = true;

      if (replace) {
        state.roadsLayer.clearLayers();
        state.roadSegments = [];
        state.roadSegmentIds.clear();
        state.lastRoadLoadCenter = null;
      }

      if (reason === "auto") {
        setDriveStatus(
          "Loading more roads ahead"
        );
      } else if (reason !== "preview") {
        setDriveStatus(
          "Loading nearby roads"
        );
      }

      const query = `
        [out:json][timeout:25];
        way(around:${Math.round(
          radiusM
        )},${lat},${lng})
          ["highway"]
          ["highway"!~"footway|cycleway|path|steps|pedestrian|bridleway|corridor|elevator|platform|construction|proposed|raceway"];
        out tags geom;
      `;

      try {
        const response = await fetch(
          "https://overpass-api.de/api/interpreter",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body: new URLSearchParams({
              data: query
            })
          }
        );

        if (!response.ok) {
          throw new Error(
            `Overpass returned ${response.status}`
          );
        }

        const data =
          await response.json();

        const ways =
          Array.isArray(data.elements)
            ? data.elements
            : [];

        const before =
          state.roadSegments.length;

        buildSegmentsFromWays(ways);
        drawNewSegments(before);

        if (
          state.needsSavedSegmentsSave
        ) {
          saveSavedSegments();

          state.needsSavedSegmentsSave =
            false;
        }

        state.lastRoadLoadCenter = {
          lat,
          lng,
          timestamp: Date.now()
        };

        renderAllStats();

        if (reason === "auto") {
          setDriveStatus("Driving");
        } else if (
          reason !== "preview" &&
          !state.isRecording
        ) {
          setDriveStatus(
            "Ready to drive"
          );
        }

        return (
          state.roadSegments.length > 0
        );
      } catch (error) {
        console.error(error);

        if (reason === "auto") {
          showToast(
            "Could not auto-load more roads"
          );

          setDriveStatus("Driving");
        } else if (
          reason !== "preview"
        ) {
          showToast(
            "Could not load nearby roads"
          );
        }

        return false;
      } finally {
        state.isLoadingRoads = false;
      }
    }
  )().finally(() => {
    state.roadLoadPromise = null;
  });

  return state.roadLoadPromise;
}

function buildSegmentsFromWays(ways) {
  for (const way of ways) {
    if (
      !Array.isArray(way.geometry) ||
      way.geometry.length < 2
    ) {
      continue;
    }

    const name =
      way.tags?.name || "Unnamed road";

    const highway =
      way.tags?.highway || "road";

    for (
      let i = 0;
      i < way.geometry.length - 1;
      i++
    ) {
      const a = {
        lat: way.geometry[i].lat,
        lng: way.geometry[i].lon
      };

      const b = {
        lat: way.geometry[i + 1].lat,
        lng: way.geometry[i + 1].lon
      };

      const distance =
        haversine(a, b);

      if (distance < 3) continue;

      const pieces = Math.max(
        1,
        Math.ceil(
          distance /
          SEGMENT_SIZE_M
        )
      );

      for (
        let pieceIndex = 0;
        pieceIndex < pieces;
        pieceIndex++
      ) {
        const start = interpolate(
          a,
          b,
          pieceIndex / pieces
        );

        const end = interpolate(
          a,
          b,
          (pieceIndex + 1) / pieces
        );

        const id =
          `${way.id}:${i}:` +
          `${pieceIndex}:` +
          `${SEGMENT_SIZE_M}`;

        if (
          state.roadSegmentIds.has(id)
        ) {
          continue;
        }

        state.roadSegmentIds.add(id);

        const segment = {
          id,
          name,
          highway,
          coords: [
            [start.lat, start.lng],
            [end.lat, end.lng]
          ],
          lengthM:
            haversine(start, end),
          visited:
            Boolean(
              state.visited[id]
            ) ||
            Boolean(
              state.savedSegments[id]
            ),
          currentTrip: false,
          layer: null
        };

        state.roadSegments.push(
          segment
        );

        if (segment.visited) {
          rememberSavedSegment(
            segment,
            false
          );
        }
      }
    }
  }
}

function drawNewSegments(
  startIndex = 0
) {
  for (
    let index = startIndex;
    index < state.roadSegments.length;
    index++
  ) {
    const segment =
      state.roadSegments[index];

    const layer = L.polyline(
      segment.coords,
      getSegmentStyle(segment)
    );

    layer.bindTooltip(
      `${escapeHtml(
        segment.name
      )}<br>${
        segment.visited
          ? "Discovered"
          : "Undiscovered"
      }`,
      {
        sticky: true
      }
    );

    layer.addTo(state.roadsLayer);

    segment.layer = layer;
  }
}

function getSegmentStyle(segment) {
  if (segment.currentTrip) {
    return {
      color: ROAD_CURRENT,
      weight: 6,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round"
    };
  }

  if (segment.visited) {
    return {
      color: ROAD_ORANGE,
      weight: 5,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round"
    };
  }

  return {
    color: ROAD_GREY,
    weight: 4,
    opacity: 0.82,
    lineCap: "round",
    lineJoin: "round"
  };
}

function maybeAutoLoadMoreRoads(
  point
) {
  if (
    !state.isRecording ||
    state.isLoadingRoads
  ) {
    return;
  }

  const now = Date.now();

  if (
    now -
      state.lastAutoReloadAt <
    MIN_AUTO_RELOAD_TIME_MS
  ) {
    return;
  }

  if (!state.lastRoadLoadCenter) {
    state.lastAutoReloadAt = now;

    loadRoads(
      point.lat,
      point.lng,
      LOAD_RADIUS_M,
      {
        replace: false,
        reason: "auto"
      }
    );

    return;
  }

  const distanceFromLoadCenter =
    haversine(
      point,
      state.lastRoadLoadCenter
    );

  if (
    distanceFromLoadCenter >=
    AUTO_RELOAD_DISTANCE_M
  ) {
    state.lastAutoReloadAt = now;

    loadRoads(
      point.lat,
      point.lng,
      LOAD_RADIUS_M,
      {
        replace: false,
        reason: "auto"
      }
    );
  }
}

function unlockNearbySegments(point) {
  let unlocked = 0;

  for (
    const segment of
    state.roadSegments
  ) {
    if (segment.visited) continue;

    const distance =
      pointToSegmentDistance(
        point,
        segment.coords[0],
        segment.coords[1]
      );

    if (
      distance <=
      UNLOCK_RADIUS_M
    ) {
      segment.visited = true;
      segment.currentTrip = true;

      const unlockedAt =
        Date.now();

      state.visited[segment.id] =
        unlockedAt;

      state.tripUnlocked.add(
        segment.id
      );

      state.todayUnlocks.keys[
        segment.id
      ] = Math.max(
        1,
        Math.round(
          segment.lengthM
        )
      );

      rememberSavedSegment(
        segment,
        false
      );

      styleSegment(segment);

      unlocked++;
    }
  }

  if (unlocked > 0) {
    saveVisited();
    saveSavedSegments();
    saveTodayUnlocks();

    state.needsSavedSegmentsSave =
      false;

    showToast(
      unlocked === 1
        ? "Road painted orange"
        : `${unlocked} roads painted orange`
    );
  }

  return unlocked;
}

function rememberSavedSegment(
  segment,
  saveNow = false
) {
  if (
    state.savedSegmentIds.has(
      segment.id
    )
  ) {
    return;
  }

  const saved = {
    id: segment.id,
    name: segment.name,
    highway: segment.highway,
    coords: compactCoords(
      segment.coords
    ),
    lengthM: Math.round(
      segment.lengthM
    ),
    unlockedAt:
      state.visited[segment.id] ||
      Date.now()
  };

  state.savedSegments[
    segment.id
  ] = saved;

  state.savedSegmentIds.add(
    segment.id
  );

  state.needsSavedSegmentsSave =
    true;

  drawSavedSegment(saved);

  if (saveNow) {
    saveSavedSegments();

    state.needsSavedSegmentsSave =
      false;
  }
}

function drawSavedSegments() {
  state.savedLayer.clearLayers();
  state.savedDrawnIds.clear();

  for (
    const segment of
    Object.values(
      state.savedSegments
    )
  ) {
    drawSavedSegment(segment);
  }
}

function drawSavedSegment(segment) {
  if (
    !segment ||
    !segment.id ||
    !validCoords(segment.coords) ||
    state.savedDrawnIds.has(
      segment.id
    )
  ) {
    return;
  }

  L.polyline(
    segment.coords,
    {
      color: ROAD_ORANGE,
      weight: 5,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }
  ).addTo(state.savedLayer);

  state.savedDrawnIds.add(
    segment.id
  );
}

function styleSegment(segment) {
  if (!segment.layer) return;

  segment.layer.setStyle(
    getSegmentStyle(segment)
  );
}

function drawTripLine(a, b) {
  L.polyline(
    [
      [a.lat, a.lng],
      [b.lat, b.lng]
    ],
    {
      color: ROAD_CURRENT,
      weight: 7,
      opacity: 0.35,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }
  ).addTo(state.tripLayer);
}

function resetDiscoveredRoads() {
  const confirmed = confirm(
    "Reset all discovered roads saved on this device?"
  );

  if (!confirmed) return;

  state.visited = {};
  state.savedSegments = {};

  state.savedSegmentIds.clear();
  state.savedDrawnIds.clear();
  state.savedLayer.clearLayers();

  state.todayUnlocks = {
    date: getTodayKey(),
    keys: {}
  };

  saveVisited();
  saveSavedSegments();
  saveTodayUnlocks();

  for (
    const segment of
    state.roadSegments
  ) {
    segment.visited = false;
    segment.currentTrip = false;
    styleSegment(segment);
  }

  state.tripUnlocked.clear();

  renderAllStats();

  showToast(
    "Discovered roads reset"
  );
}

/* ---------- Waypoint ---------- */

function onMapClickForWaypoint(
  event
) {
  if (
    !state.awaitingWaypointClick
  ) {
    return;
  }

  state.awaitingWaypointClick =
    false;

  setWaypoint({
    lat: event.latlng.lat,
    lng: event.latlng.lng
  });
}

async function setWaypoint(point) {
  state.waypointPoint = point;

  drawWaypointMarker(point);
  updateWaypointButtons();

  setDriveStatus(
    "Finding waypoint route"
  );

  showToast("Waypoint set");

  await routeToWaypoint({
    fit: true,
    silent: false
  });
}

function drawWaypointMarker(point) {
  const latlng = [
    point.lat,
    point.lng
  ];

  if (!state.waypointMarker) {
    state.waypointMarker =
      L.circleMarker(
        latlng,
        {
          radius: 9,
          color: "#eef7ff",
          weight: 4,
          fillColor: ROUTE_BLUE,
          fillOpacity: 1
        }
      ).addTo(state.routeLayer);

    state.waypointMarker.bindTooltip(
      "Waypoint",
      {
        sticky: true
      }
    );
  } else {
    state.waypointMarker.setLatLng(
      latlng
    );
  }
}

async function routeToWaypoint(
  options = {}
) {
  const {
    fit = false,
    silent = false
  } = options;

  if (
    !state.waypointPoint ||
    state.isRouting
  ) {
    return;
  }

  const start =
    await getFreshRouteStartPoint();

  if (!start) {
    showToast(
      "Need GPS before routing to waypoint"
    );

    return;
  }

  const requestId =
    ++state.routeRequestId;

  state.isRouting = true;

  if (!silent) {
    setDriveStatus(
      "Finding waypoint route"
    );
  }

  try {
    const route =
      await fetchRoadRoute(
        start,
        state.waypointPoint
      );

    if (
      requestId !==
      state.routeRequestId
    ) {
      return;
    }

    drawRouteLine(route.coords);

    state.routeDistanceM =
      route.distanceM;

    state.routeDurationS =
      route.durationS;

    state.lastRouteStartPoint =
      start;

    state.lastRouteAt =
      Date.now();

    if (
      fit &&
      route.coords.length > 1
    ) {
      state.map?.fitBounds(
        L.latLngBounds(
          route.coords
        ),
        {
          padding: [70, 120],
          maxZoom: 16
        }
      );

      state.followUser = false;
    }

    setDriveStatus(
      state.isRecording
        ? `Driving • waypoint ${metersToKm(
            route.distanceM
          )} km`
        : `Waypoint ${metersToKm(
            route.distanceM
          )} km away`
    );
  } catch (error) {
    console.error(error);

    showToast(
      "Could not find a road route to that waypoint"
    );

    if (state.isRecording) {
      setDriveStatus("Driving");
    } else {
      setDriveStatus(
        "Ready to drive"
      );
    }
  } finally {
    state.isRouting = false;
    updateWaypointButtons();
  }
}

async function fetchRoadRoute(
  start,
  end
) {
  const coords =
    `${start.lng},${start.lat};` +
    `${end.lng},${end.lat}`;

  const url =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    "?overview=full&geometries=geojson&steps=false";

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Routing returned ${response.status}`
    );
  }

  const data =
    await response.json();

  if (
    data.code !== "Ok" ||
    !data.routes?.[0]
  ) {
    throw new Error(
      data.message ||
      "No route found"
    );
  }

  const route = data.routes[0];

  return {
    distanceM:
      route.distance || 0,
    durationS:
      route.duration || 0,
    coords:
      route.geometry.coordinates.map(
        (coord) => [
          coord[1],
          coord[0]
        ]
      )
  };
}

async function getFreshRouteStartPoint() {
  if (
    state.currentPoint &&
    Date.now() -
      state.currentPoint.timestamp <
      30000 &&
    state.currentPoint.accuracy <=
      MAX_GPS_ACCURACY_M
  ) {
    return state.currentPoint;
  }

  const position =
    await getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 9000,
      maximumAge: 5000
    });

  if (!position) {
    return state.currentPoint;
  }

  const point =
    positionToPoint(position);

  state.currentPoint = point;

  updateUserMarker(point);

  return point;
}

function drawRouteLine(coords) {
  clearRouteLine();

  if (
    !Array.isArray(coords) ||
    coords.length < 2
  ) {
    return;
  }

  state.routeHalo = L.polyline(
    coords,
    {
      color: "#eef7ff",
      weight: 9,
      opacity: 0.72,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }
  ).addTo(state.routeLayer);

  state.routeLine = L.polyline(
    coords,
    {
      color: ROUTE_BLUE,
      weight: 5,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }
  ).addTo(state.routeLayer);

  if (state.waypointMarker) {
    state.waypointMarker.bringToFront();
  }
}

function clearRouteLine() {
  if (state.routeHalo) {
    state.routeLayer.removeLayer(
      state.routeHalo
    );

    state.routeHalo = null;
  }

  if (state.routeLine) {
    state.routeLayer.removeLayer(
      state.routeLine
    );

    state.routeLine = null;
  }
}

function clearWaypoint(
  showMessage = true
) {
  state.awaitingWaypointClick =
    false;

  state.waypointPoint = null;
  state.routeDistanceM = 0;
  state.routeDurationS = 0;
  state.lastRouteStartPoint = null;
  state.lastRouteAt = 0;

  state.routeRequestId++;

  clearRouteLine();

  if (state.waypointMarker) {
    state.routeLayer.removeLayer(
      state.waypointMarker
    );

    state.waypointMarker = null;
  }

  updateWaypointButtons();

  if (showMessage) {
    showToast("Waypoint cleared");
  }

  setDriveStatus(
    state.isRecording
      ? "Driving"
      : "Ready to drive"
  );
}

function updateWaypointButtons() {
  if (!els.clearWaypointBtn) return;

  const hasWaypoint =
    Boolean(state.waypointPoint);

  const showClear =
    hasWaypoint ||
    state.awaitingWaypointClick;

  els.clearWaypointBtn.classList.toggle(
    "hidden",
    !showClear
  );
}

function maybeUpdateWaypointRoute(
  point
) {
  if (!state.waypointPoint) return;

  const distanceToWaypoint =
    haversine(
      point,
      state.waypointPoint
    );

  if (
    distanceToWaypoint <=
    ROUTE_ARRIVAL_RADIUS_M
  ) {
    clearWaypoint(false);
    showToast("Waypoint reached");
    return;
  }

  if (
    !state.routeLine ||
    !state.lastRouteStartPoint ||
    state.isRouting
  ) {
    return;
  }

  const now = Date.now();

  if (
    now -
      state.lastRouteAt <
    ROUTE_MIN_REROUTE_TIME_MS
  ) {
    return;
  }

  const movedSinceRoute =
    haversine(
      point,
      state.lastRouteStartPoint
    );

  if (
    movedSinceRoute <
    ROUTE_REROUTE_DISTANCE_M
  ) {
    return;
  }

  routeToWaypoint({
    fit: false,
    silent: true
  });
}

/* ---------- Friends ---------- */

function renderFriendsList() {
  if (!els.friendsList) return;

  els.friendsList.innerHTML = "";

  DEMO_FRIENDS.forEach(
    (friend) => {
      const row =
        document.createElement(
          "button"
        );

      row.className = "friend-row";
      row.type = "button";
      row.dataset.friendId =
        friend.id;

      row.innerHTML = `
        <div class="friend-avatar">
          ${escapeHtml(friend.avatar)}
        </div>

        <div class="friend-main">
          <div class="friend-name">
            ${escapeHtml(friend.name)}
          </div>

          <div class="friend-sub">
            Australia ${escapeHtml(
              friend.australiaPercent
            )}
          </div>
        </div>

        <div class="friend-score">
          <strong>
            ${formatNumber(
              friend.unlocked
            )}
          </strong>

          <span>/ 18M</span>
        </div>
      `;

      row.addEventListener(
        "click",
        () => {
          openFriendProfile(
            friend.id
          );
        }
      );

      els.friendsList.appendChild(
        row
      );
    }
  );

  if (els.friendRequestsList) {
    els.friendRequestsList.innerHTML =
      '<div class="empty-state">No pending requests</div>';
  }
}

function openFriendProfile(
  friendId
) {
  const friend =
    DEMO_FRIENDS.find(
      (item) =>
        item.id === friendId
    ) || DEMO_FRIENDS[0];

  state.activeFriendId =
    friend.id;

  if (els.friendProfileAvatar) {
    els.friendProfileAvatar.textContent =
      friend.avatar;
  }

  if (els.friendProfileName) {
    els.friendProfileName.textContent =
      friend.name;
  }

  if (els.friendProfileHandle) {
    els.friendProfileHandle.textContent =
      friend.handle;
  }

  if (els.friendAustraliaStat) {
    els.friendAustraliaStat.textContent =
      friend.australiaPercent;
  }

  if (els.friendUnlockedStat) {
    els.friendUnlockedStat.textContent =
      `${formatNumber(
        friend.unlocked
      )} / 18M`;
  }

  if (els.friendTodayStat) {
    els.friendTodayStat.textContent =
      `${friend.todayKm.toFixed(
        2
      )} km`;
  }

  if (els.friendWeekStat) {
    els.friendWeekStat.textContent =
      `${friend.weekKm.toFixed(
        1
      )} km`;
  }

  renderFriendPreviewSvg(friend);
  renderFriendFullMapSvg(friend);
  showFriendProfileView();
}

function renderFriendPreviewSvg(
  friend
) {
  if (!els.friendMapPreviewSvg) {
    return;
  }

  els.friendMapPreviewSvg.innerHTML =
    "";

  friend.previewPaths.forEach(
    (pathData) => {
      const path =
        document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path"
        );

      path.setAttribute(
        "d",
        pathData
      );

      els.friendMapPreviewSvg.appendChild(
        path
      );
    }
  );
}

function renderFriendFullMapSvg(
  friend
) {
  if (!els.friendFullMapSvg) {
    return;
  }

  els.friendFullMapSvg.innerHTML =
    "";

  friend.fullPaths.forEach(
    (pathData) => {
      const path =
        document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path"
        );

      path.setAttribute(
        "d",
        pathData
      );

      els.friendFullMapSvg.appendChild(
        path
      );
    }
  );
}

function openFriendFullMap() {
  const friend =
    getActiveFriend();

  if (els.friendMapTitle) {
    els.friendMapTitle.textContent =
      `${friend.name}’s Map`;
  }

  renderFriendFullMapSvg(friend);

  els.friendMapOverlay?.classList.remove(
    "hidden"
  );

  els.friendMapOverlay?.setAttribute(
    "aria-hidden",
    "false"
  );
}

function closeFriendFullMap() {
  els.friendMapOverlay?.classList.add(
    "hidden"
  );

  els.friendMapOverlay?.setAttribute(
    "aria-hidden",
    "true"
  );
}

function getActiveFriend() {
  return (
    DEMO_FRIENDS.find(
      (friend) =>
        friend.id ===
        state.activeFriendId
    ) ||
    DEMO_FRIENDS[0]
  );
}

function applyFriendSettingsToUI() {
  if (els.friendProfileToggle) {
    els.friendProfileToggle.checked =
      Boolean(
        state.friendSettings.showProfile
      );
  }

  if (els.friendMapToggle) {
    els.friendMapToggle.checked =
      Boolean(
        state.friendSettings.showMap
      );
  }
}

/* ---------- Stats ---------- */

function renderAllStats() {
  fixTodayIfNeeded();

  const lifetimeUnlocked =
    Object.keys(
      state.savedSegments
    ).length;

  const australiaPercent =
    (
      lifetimeUnlocked /
      AU_TOTAL_UNLOCKS_ESTIMATE
    ) * 100;

  if (els.australiaStat) {
    els.australiaStat.textContent =
      `${formatAustraliaPercent(
        australiaPercent
      )}%`;
  }

  if (els.todayStat) {
    els.todayStat.textContent =
      `${sumTodayUnlockedKm().toFixed(
        2
      )} km`;
  }

  if (els.unlockedStat) {
    els.unlockedStat.textContent =
      `${formatUnlockedNumber(
        lifetimeUnlocked
      )} / ` +
      `${formatCompactNumber(
        AU_TOTAL_UNLOCKS_ESTIMATE
      )}`;
  }
}

function fixTodayIfNeeded() {
  const today = getTodayKey();

  if (
    state.todayUnlocks.date !==
    today
  ) {
    state.todayUnlocks = {
      date: today,
      keys: {}
    };

    saveTodayUnlocks();
  }
}

function sumTodayUnlockedKm() {
  let meters = 0;

  for (
    const value of
    Object.values(
      state.todayUnlocks.keys
    )
  ) {
    if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      meters += value;
    } else {
      meters += SEGMENT_SIZE_M;
    }
  }

  return meters / 1000;
}

function sumTripUnlockedKm() {
  let meters = 0;

  for (
    const segment of
    state.roadSegments
  ) {
    if (
      state.tripUnlocked.has(
        segment.id
      )
    ) {
      meters += segment.lengthM;
    }
  }

  return meters / 1000;
}

function formatAustraliaPercent(
  percent
) {
  if (
    percent > 0 &&
    percent < 0.0001
  ) {
    return "<0.0001";
  }

  return percent.toFixed(4);
}

function formatUnlockedNumber(
  value
) {
  if (value < 10000) {
    return Number(
      value
    ).toLocaleString("en-AU");
  }

  return formatCompactNumber(value);
}

function formatCompactNumber(
  value
) {
  if (value >= 1000000) {
    return `${trimDecimal(
      value / 1000000
    )}M`;
  }

  if (value >= 1000) {
    return `${trimDecimal(
      value / 1000
    )}K`;
  }

  return Number(
    value
  ).toLocaleString("en-AU");
}

function trimDecimal(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value
    .toFixed(1)
    .replace(".0", "");
}

/* ---------- UI helpers ---------- */

function setDriveButtons(mode) {
  if (
    !els.startBtn ||
    !els.finishBtn
  ) {
    return;
  }

  els.startBtn.style.gridColumn =
    "1 / -1";

  els.finishBtn.style.gridColumn =
    "1 / -1";

  if (mode === "recording") {
    els.startBtn.classList.add(
      "hidden"
    );

    els.finishBtn.classList.remove(
      "hidden"
    );

    els.finishBtn.disabled = false;

    return;
  }

  els.finishBtn.classList.add(
    "hidden"
  );

  els.startBtn.classList.remove(
    "hidden"
  );

  els.startBtn.disabled =
    mode === "loading";

  els.startBtn.textContent =
    mode === "loading"
      ? "Starting Drive..."
      : "Start Drive";
}

function setDriveStatus(text) {
  if (els.driveStatus) {
    els.driveStatus.textContent =
      text;
  }
}

function setGpsStatus(text) {
  if (els.gpsStatus) {
    els.gpsStatus.textContent =
      text;
  }
}

function setAccuracyStatus(text) {
  if (els.accuracyStatus) {
    els.accuracyStatus.textContent =
      text;
  }
}

function showToast(message) {
  if (!els.toast) return;

  els.toast.textContent = message;

  els.toast.classList.remove(
    "hidden"
  );

  clearTimeout(
    state.toastTimer
  );

  state.toastTimer =
    setTimeout(() => {
      els.toast.classList.add(
        "hidden"
      );
    }, 2200);
}

/* ---------- Math / geo ---------- */

function positionToPoint(position) {
  return {
    lat:
      position.coords.latitude,
    lng:
      position.coords.longitude,
    accuracy:
      position.coords.accuracy ||
      999,
    speed:
      position.coords.speed,
    heading:
      position.coords.heading,
    timestamp:
      position.timestamp ||
      Date.now()
  };
}

function haversine(a, b) {
  const earthRadiusM =
    6371000;

  const dLat =
    toRad(b.lat - a.lat);

  const dLng =
    toRad(b.lng - a.lng);

  const lat1 =
    toRad(a.lat);

  const lat2 =
    toRad(b.lat);

  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLng / 2) ** 2;

  return (
    2 *
    earthRadiusM *
    Math.atan2(
      Math.sqrt(value),
      Math.sqrt(1 - value)
    )
  );
}

function interpolate(
  a,
  b,
  amount
) {
  return {
    lat:
      a.lat +
      (b.lat - a.lat) *
        amount,
    lng:
      a.lng +
      (b.lng - a.lng) *
        amount
  };
}

function pointToSegmentDistance(
  point,
  segmentA,
  segmentB
) {
  const latitudeRadians =
    toRad(point.lat);

  const metersPerLatitudeDegree =
    111320;

  const metersPerLongitudeDegree =
    111320 *
    Math.cos(latitudeRadians);

  const ax =
    (segmentA[1] -
      point.lng) *
    metersPerLongitudeDegree;

  const ay =
    (segmentA[0] -
      point.lat) *
    metersPerLatitudeDegree;

  const bx =
    (segmentB[1] -
      point.lng) *
    metersPerLongitudeDegree;

  const by =
    (segmentB[0] -
      point.lat) *
    metersPerLatitudeDegree;

  const dx = bx - ax;
  const dy = by - ay;

  const lengthSquared =
    dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.sqrt(
      ax * ax +
      ay * ay
    );
  }

  const amount = Math.max(
    0,
    Math.min(
      1,
      -(
        ax * dx +
        ay * dy
      ) / lengthSquared
    )
  );

  const closestX =
    ax + amount * dx;

  const closestY =
    ay + amount * dy;

  return Math.sqrt(
    closestX * closestX +
    closestY * closestY
  );
}

function compactCoords(coords) {
  return coords.map(
    (coord) => [
      Number(
        Number(coord[0]).toFixed(6)
      ),
      Number(
        Number(coord[1]).toFixed(6)
      )
    ]
  );
}

function coordToPoint(coord) {
  return {
    lat: Number(coord[0]),
    lng: Number(coord[1])
  };
}

function metersToKm(meters) {
  return (
    meters / 1000
  ).toFixed(2);
}

function toRad(degrees) {
  return (
    degrees *
    Math.PI
  ) / 180;
}

/* ---------- Formatting ---------- */

function getTodayKey() {
  const now = new Date();

  const year =
    now.getFullYear();

  const month = String(
    now.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    now.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatNumber(value) {
  return Number(
    value || 0
  ).toLocaleString("en-AU");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
