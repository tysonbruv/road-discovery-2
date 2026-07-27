"use strict";

/* Road Discovery AU v37
   Checkpoint 4: safe aggregate friend stats only.
   This keeps the road/GPS/Overpass/waypoint/localStorage engine local.
   It does not upload live GPS, current drive paths, segment IDs, coordinates, road geometry, speed, heading, blue marker, start point, or finish point.
*/

const STORAGE_KEY = "roadDiscoveryAU.visited.v1";
const SAVED_SEGMENTS_KEY = "roadDiscoveryAU.savedSegments.v1";
const FRIEND_SETTINGS_KEY = "roadDiscoveryAU.friendSettings.v1";
const TODAY_UNLOCKS_KEY = "roadDiscoveryAU.todayUnlocks.v1";
const ROAD_PROFILE_CACHE_KEY = "roadDiscoveryAU.roadProfile.v1";

const SUPABASE_URL = "https://tancfzqmzvaalqotmvks.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_LnMT-vhl4xvj4idb91dNdA_EdQMJutI";

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

const PROFILE_STATS_SYNC_MIN_MS = 60000;
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_CENTER = [-33.8688, 151.2093];
const DEFAULT_ZOOM = 14;

const ROAD_GREY = "#4e5563";
const ROAD_ORANGE = "#ff8a18";
const ROAD_CURRENT = "#ffb04a";
const ROUTE_BLUE = "#4bb3ff";

const $ = (id) => document.getElementById(id);
const els = {};

const state = {
  map: null,

  roadsLayer: null,
  savedLayer: null,
  tripLayer: null,
  routeLayer: null,

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

  activeFriendId: null,

  friendSettings: {
    showProfile: false,
    showMap: false
  },

  auth: {
    client: null,
    session: null,
    user: null,
    profile: null,
    loading: false,
    checkingSession: false,
    submitting: false,
    passwordRecovery: false
  },

  friends: {
    incomingRequests: [],
    acceptedFriends: [],
    loadingRequests: false,
    loadingFriends: false,
    sendingRequest: false,
    respondingRequestId: null,
    respondingAction: null
  },

  statsSync: {
    syncing: false,
    lastSyncAt: 0,
    lastPayloadKey: ""
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
  initSupabase();

  renderAllStats();
  renderFriendsList();
  renderAuthState();
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
  [
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

    "signedOutProfileCard",
    "signedInProfileCard",
    "authCreateModeBtn",
    "authSignInModeBtn",
    "createAuthForm",
    "signInAuthForm",
    "createEmailInput",
    "createPasswordInput",
    "createProfileBtn",
    "signInEmailInput",
    "signInPasswordInput",
    "signInBtn",
    "forgotPasswordBtn",
    "resetPasswordBox",
    "newPasswordInput",
    "updatePasswordBtn",
    "authMessage",
    "profileEmailValue",
    "profileUsernameValue",
    "profileFriendCodeValue",
    "copyFriendCodeBtn",
    "profileProfileToggle",
    "profileMapToggle",
    "signOutBtn",

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
  ].forEach((id) => {
    els[id] = $(id);
  });
}

function initMap() {
  if (!window.L || !els.map) {
    showToast("Map library did not load");
    return;
  }

  state.roadsLayer = L.layerGroup();
  state.savedLayer = L.layerGroup();
  state.tripLayer = L.layerGroup();
  state.routeLayer = L.layerGroup();

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

  setTimeout(() => state.map?.invalidateSize(true), 250);
  setTimeout(() => state.map?.invalidateSize(true), 1000);

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
  els.settingsBtn?.addEventListener("click", () => openPanel("settingsPanel"));
  els.waypointBtn?.addEventListener("click", () => openPanel("waypointPanel"));
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

  els.authCreateModeBtn?.addEventListener("click", () => setAuthMode("create"));
  els.authSignInModeBtn?.addEventListener("click", () => setAuthMode("signin"));

  els.createProfileBtn?.addEventListener("click", createRoadProfileAccount);
  els.signInBtn?.addEventListener("click", signInRoadProfile);
  els.forgotPasswordBtn?.addEventListener("click", sendPasswordReset);
  els.updatePasswordBtn?.addEventListener("click", updateRecoveredPassword);
  els.copyFriendCodeBtn?.addEventListener("click", copyFriendCode);
  els.signOutBtn?.addEventListener("click", signOutRoadProfile);

  els.createPasswordInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") createRoadProfileAccount();
  });

  els.signInPasswordInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") signInRoadProfile();
  });

  els.profileProfileToggle?.addEventListener("change", () => {
    handleProfilePrivacyToggle(
      "show_profile",
      Boolean(els.profileProfileToggle.checked)
    );
  });

  els.profileMapToggle?.addEventListener("change", () => {
    handleProfilePrivacyToggle(
      "show_map",
      Boolean(els.profileMapToggle.checked)
    );
  });

  els.friendProfileToggle?.addEventListener("change", () => {
    handleProfilePrivacyToggle(
      "show_profile",
      Boolean(els.friendProfileToggle.checked)
    );
  });

  els.friendMapToggle?.addEventListener("change", () => {
    handleProfilePrivacyToggle(
      "show_map",
      Boolean(els.friendMapToggle.checked)
    );
  });

  els.startBtn?.addEventListener("click", startDrive);
  els.finishBtn?.addEventListener("click", finishDrive);
  els.resetBtn?.addEventListener("click", resetDiscoveredRoads);

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

    showToast("Username search comes in a later checkpoint. Use friend codes next.");
  });

  els.addFriendCodeBtn?.addEventListener("click", sendFriendRequestByCode);

  els.friendCodeInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendFriendRequestByCode();
  });

  els.friendRequestsList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-request-action]");

    if (!button || !els.friendRequestsList.contains(button)) return;

    const requestId = button.dataset.requestId || "";
    const action = button.dataset.requestAction || "";

    if (action === "accept") {
      acceptIncomingFriendRequest(requestId);
    } else if (action === "decline") {
      declineIncomingFriendRequest(requestId);
    }
  });

  els.friendsList?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-friend-id]");

    if (!row || !els.friendsList.contains(row)) return;

    openFriendProfile(row.dataset.friendId || "");
  });

  els.backToFriendsBtn?.addEventListener("click", showFriendsListView);
  els.openFriendMapBtn?.addEventListener("click", openFriendFullMap);
  els.closeFriendMapBtn?.addEventListener("click", closeFriendFullMap);

  els.removeFriendBtn?.addEventListener("click", () => {
    const friend = getActiveFriend();
    showToast(`${friend?.username || "Friend"} remove button comes in a later checkpoint`);
  });

  els.blockFriendBtn?.addEventListener("click", () => {
    const friend = getActiveFriend();
    showToast(`${friend?.username || "Friend"} block button comes in a later checkpoint`);
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

  if (state.auth.user) {
    refreshFriendData({ quiet: true });
  }
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
    setAccuracyStatus("This browser cannot access location");

    if (!quiet) {
      showToast("GPS is not available in this browser");
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
    setAccuracyStatus("Location permission blocked or unavailable");

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
      state.map.setView([point.lat, point.lng], 16);
    } else {
      state.map.setView(
        [point.lat, point.lng],
        Math.max(state.map.getZoom(), DEFAULT_ZOOM)
      );
    }
  }

  setGpsStatus(
    point.accuracy <= MAX_GPS_ACCURACY_M
      ? "GPS good"
      : "GPS weak"
  );

  setAccuracyStatus(`Accuracy ${Math.round(point.accuracy)} m`);

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
  setAccuracyStatus("Getting a clean location");

  const position = await getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 2000
  });

  if (!position) {
    setDriveButtons("idle");
    setDriveStatus("Could not start");
    setGpsStatus("GPS unavailable");
    setAccuracyStatus("Move outside and check location permission");
    showToast("Could not get GPS. Tap Start Drive to try again");
    return;
  }

  const point = positionToPoint(position);

  state.currentPoint = point;
  state.followUser = true;

  updateUserMarker(point);

  state.map?.setView([point.lat, point.lng], 16);

  setDriveStatus("Loading nearby roads");

  setGpsStatus(
    point.accuracy <= MAX_GPS_ACCURACY_M
      ? "GPS good"
      : "GPS weak"
  );

  setAccuracyStatus(`Accuracy ${Math.round(point.accuracy)} m`);

  const roadsReady = await ensureRoadsNearPoint(point, {
    replaceIfFar: true,
    quiet: false
  });

  if (!roadsReady || state.roadSegments.length === 0) {
    setDriveButtons("idle");
    setDriveStatus("Roads did not load");
    showToast("Could not load nearby roads. Check reception and try again");
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

  state.watchId = navigator.geolocation.watchPosition(
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
  if (!state.isRecording && state.watchId === null) {
    showToast("No drive is running");
    return;
  }

  stopGpsWatch();

  state.isRecording = false;

  document.body.classList.remove("recording");

  setDriveButtons("idle");

  const travelledKm = metersToKm(state.tripDistanceM);
  const discoveredKm = sumTripUnlockedKm().toFixed(2);
  const unlocked = state.tripUnlocked.size.toLocaleString("en-AU");

  setDriveStatus("Drive finished");
  setGpsStatus("GPS idle");
  setAccuracyStatus(
    `${travelledKm} km travelled • ${discoveredKm} km discovered • ${unlocked} unlocks`
  );

  renderAllStats();
  void maybeSyncProfileStats({ force: true, quiet: true });

  showToast("Drive saved on this device");
}

function stopGpsWatch() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
}

function resetTripState() {
  state.tripUnlocked.clear();
  state.tripDistanceM = 0;
  state.lastPoint = null;

  state.tripLayer?.clearLayers();

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
    state.map?.panTo([point.lat, point.lng], {
      animate: true,
      duration: 0.3
    });
  }

  maybeAutoLoadMoreRoads(point);

  if (point.accuracy > MAX_GPS_ACCURACY_M) {
    setGpsStatus("GPS weak");
    setAccuracyStatus(
      `Accuracy ${Math.round(point.accuracy)} m — waiting for a cleaner signal`
    );
    return;
  }

  setGpsStatus("GPS good");
  setAccuracyStatus(`Accuracy ${Math.round(point.accuracy)} m`);

  if (state.lastPoint) {
    const distance = haversine(state.lastPoint, point);

    if (distance < 150) {
      state.tripDistanceM += distance;
    }

    drawTripLine(state.lastPoint, point);
  }

  state.lastPoint = point;

  unlockNearbySegments(point);
  maybeUpdateWaypointRoute(point);
  renderAllStats();

  if (!state.isLoadingRoads && !state.isRouting) {
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

  const latlng = [point.lat, point.lng];

  if (!state.userMarker) {
    state.userMarker = L.circleMarker(latlng, {
      radius: 8,
      color: "#eef7ff",
      weight: 3,
      fillColor: ROUTE_BLUE,
      fillOpacity: 1,
      interactive: false
    }).addTo(state.map);
  } else {
    state.userMarker.setLatLng(latlng);
  }

  if (!state.accuracyCircle) {
    state.accuracyCircle = L.circle(latlng, {
      radius: point.accuracy || 20,
      color: ROUTE_BLUE,
      opacity: 0.35,
      fillColor: ROUTE_BLUE,
      fillOpacity: 0.06,
      weight: 1,
      interactive: false
    }).addTo(state.map);
  } else {
    state.accuracyCircle.setLatLng(latlng);
    state.accuracyCircle.setRadius(point.accuracy || 20);
  }
}

/* ---------- Roads / discovery ---------- */

async function ensureRoadsNearPoint(point, options = {}) {
  const {
    replaceIfFar = true,
    quiet = false
  } = options;

  if (state.roadLoadPromise) {
    await state.roadLoadPromise;
  }

  const needsRoads = state.roadSegments.length === 0;
  const tooFarFromLoadedArea =
    !state.lastRoadLoadCenter ||
    haversine(point, state.lastRoadLoadCenter) > 1000;

  if (
    !needsRoads &&
    (!replaceIfFar || !tooFarFromLoadedArea)
  ) {
    return true;
  }

  return loadRoads(point.lat, point.lng, LOAD_RADIUS_M, {
    replace: true,
    reason: quiet ? "preview" : "initial"
  });
}

function loadRoads(lat, lng, radiusM, options = {}) {
  if (state.roadLoadPromise) {
    return state.roadLoadPromise;
  }

  const {
    replace = false,
    reason = "manual"
  } = options;

  state.roadLoadPromise = (async () => {
    state.isLoadingRoads = true;

    if (replace) {
      state.roadsLayer?.clearLayers();
      state.roadSegments = [];
      state.roadSegmentIds.clear();
      state.lastRoadLoadCenter = null;
    }

    if (reason === "auto") {
      setDriveStatus("Loading more roads ahead");
    } else if (reason !== "preview") {
      setDriveStatus("Loading nearby roads");
    }

    const query = `
      [out:json][timeout:25];
      way(around:${Math.round(radiusM)},${lat},${lng})
        ["highway"]
        ["highway"!~"footway|cycleway|path|steps|pedestrian|bridleway|corridor|elevator|platform|construction|proposed|raceway"];
      out tags geom;
    `;

    try {
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: new URLSearchParams({
          data: query
        })
      });

      if (!response.ok) {
        throw new Error(`Overpass returned ${response.status}`);
      }

      const data = await response.json();
      const ways = Array.isArray(data.elements) ? data.elements : [];
      const before = state.roadSegments.length;

      buildSegmentsFromWays(ways);
      drawNewSegments(before);

      if (state.needsSavedSegmentsSave) {
        saveSavedSegments();
        state.needsSavedSegmentsSave = false;
      }

      state.lastRoadLoadCenter = {
        lat,
        lng,
        timestamp: Date.now()
      };

      renderAllStats();

      if (reason === "auto") {
        setDriveStatus("Driving");
      } else if (reason !== "preview" && !state.isRecording) {
        setDriveStatus("Ready to drive");
      }

      return state.roadSegments.length > 0;
    } catch (error) {
      console.error(error);

      if (reason === "auto") {
        showToast("Could not auto-load more roads");
        setDriveStatus("Driving");
      } else if (reason !== "preview") {
        showToast("Could not load nearby roads");
      }

      return false;
    } finally {
      state.isLoadingRoads = false;
    }
  })().finally(() => {
    state.roadLoadPromise = null;
  });

  return state.roadLoadPromise;
}

function buildSegmentsFromWays(ways) {
  for (const way of ways) {
    if (!Array.isArray(way.geometry) || way.geometry.length < 2) {
      continue;
    }

    const name = way.tags?.name || "Unnamed road";
    const highway = way.tags?.highway || "road";

    for (let i = 0; i < way.geometry.length - 1; i++) {
      const a = {
        lat: way.geometry[i].lat,
        lng: way.geometry[i].lon
      };

      const b = {
        lat: way.geometry[i + 1].lat,
        lng: way.geometry[i + 1].lon
      };

      const distance = haversine(a, b);

      if (distance < 3) continue;

      const pieces = Math.max(1, Math.ceil(distance / SEGMENT_SIZE_M));

      for (let pieceIndex = 0; pieceIndex < pieces; pieceIndex++) {
        const start = interpolate(a, b, pieceIndex / pieces);
        const end = interpolate(a, b, (pieceIndex + 1) / pieces);

        const id = `${way.id}:${i}:${pieceIndex}:${SEGMENT_SIZE_M}`;

        if (state.roadSegmentIds.has(id)) {
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
          lengthM: haversine(start, end),
          visited:
            Boolean(state.visited[id]) ||
            Boolean(state.savedSegments[id]),
          currentTrip: false,
          layer: null
        };

        state.roadSegments.push(segment);

        if (segment.visited) {
          rememberSavedSegment(segment, false);
        }
      }
    }
  }
}

function drawNewSegments(startIndex = 0) {
  if (!state.roadsLayer) return;

  for (let index = startIndex; index < state.roadSegments.length; index++) {
    const segment = state.roadSegments[index];

    const layer = L.polyline(segment.coords, getSegmentStyle(segment));

    layer.bindTooltip(
      `${escapeHtml(segment.name)}<br>${segment.visited ? "Discovered" : "Undiscovered"}`,
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

function maybeAutoLoadMoreRoads(point) {
  if (!state.isRecording || state.isLoadingRoads) {
    return;
  }

  const now = Date.now();

  if (now - state.lastAutoReloadAt < MIN_AUTO_RELOAD_TIME_MS) {
    return;
  }

  if (!state.lastRoadLoadCenter) {
    state.lastAutoReloadAt = now;

    loadRoads(point.lat, point.lng, LOAD_RADIUS_M, {
      replace: false,
      reason: "auto"
    });

    return;
  }

  const distanceFromLoadCenter = haversine(point, state.lastRoadLoadCenter);

  if (distanceFromLoadCenter >= AUTO_RELOAD_DISTANCE_M) {
    state.lastAutoReloadAt = now;

    loadRoads(point.lat, point.lng, LOAD_RADIUS_M, {
      replace: false,
      reason: "auto"
    });
  }
}

function unlockNearbySegments(point) {
  let unlocked = 0;

  for (const segment of state.roadSegments) {
    if (segment.visited) continue;

    const distance = pointToSegmentDistance(
      point,
      segment.coords[0],
      segment.coords[1]
    );

    if (distance <= UNLOCK_RADIUS_M) {
      segment.visited = true;
      segment.currentTrip = true;

      const unlockedAt = Date.now();

      state.visited[segment.id] = unlockedAt;
      state.tripUnlocked.add(segment.id);

      state.todayUnlocks.keys[segment.id] = Math.max(
        1,
        Math.round(segment.lengthM)
      );

      rememberSavedSegment(segment, false);
      styleSegment(segment);

      unlocked++;
    }
  }

  if (unlocked > 0) {
    saveVisited();
    saveSavedSegments();
    saveTodayUnlocks();

    state.needsSavedSegmentsSave = false;

    showToast(
      unlocked === 1
        ? "Road painted orange"
        : `${unlocked} roads painted orange`
    );

    void maybeSyncProfileStats({ quiet: true });
  }

  return unlocked;
}

function rememberSavedSegment(segment, saveNow = false) {
  if (state.savedSegmentIds.has(segment.id)) {
    return;
  }

  const saved = {
    id: segment.id,
    name: segment.name,
    highway: segment.highway,
    coords: compactCoords(segment.coords),
    lengthM: Math.round(segment.lengthM),
    unlockedAt: state.visited[segment.id] || Date.now()
  };

  state.savedSegments[segment.id] = saved;
  state.savedSegmentIds.add(segment.id);
  state.needsSavedSegmentsSave = true;

  drawSavedSegment(saved);

  if (saveNow) {
    saveSavedSegments();
    state.needsSavedSegmentsSave = false;
  }
}

function drawSavedSegments() {
  state.savedLayer?.clearLayers();
  state.savedDrawnIds.clear();

  for (const segment of Object.values(state.savedSegments)) {
    drawSavedSegment(segment);
  }
}

function drawSavedSegment(segment) {
  if (
    !state.savedLayer ||
    !segment ||
    !segment.id ||
    !validCoords(segment.coords) ||
    state.savedDrawnIds.has(segment.id)
  ) {
    return;
  }

  L.polyline(segment.coords, {
    color: ROAD_ORANGE,
    weight: 5,
    opacity: 0.95,
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  }).addTo(state.savedLayer);

  state.savedDrawnIds.add(segment.id);
}

function styleSegment(segment) {
  if (!segment.layer) return;
  segment.layer.setStyle(getSegmentStyle(segment));
}

function drawTripLine(a, b) {
  if (!state.tripLayer) return;

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
  const confirmed = confirm("Reset all discovered roads saved on this device?");

  if (!confirmed) return;

  state.visited = {};
  state.savedSegments = {};

  state.savedSegmentIds.clear();
  state.savedDrawnIds.clear();
  state.savedLayer?.clearLayers();

  state.todayUnlocks = {
    date: getTodayKey(),
    keys: {}
  };

  saveVisited();
  saveSavedSegments();
  saveTodayUnlocks();

  for (const segment of state.roadSegments) {
    segment.visited = false;
    segment.currentTrip = false;
    styleSegment(segment);
  }

  state.tripUnlocked.clear();

  renderAllStats();
  void maybeSyncProfileStats({ force: true, quiet: true });

  showToast("Discovered roads reset");
}

/* ---------- Waypoint ---------- */

function onMapClickForWaypoint(event) {
  if (!state.awaitingWaypointClick) return;

  state.awaitingWaypointClick = false;

  setWaypoint({
    lat: event.latlng.lat,
    lng: event.latlng.lng
  });
}

async function setWaypoint(point) {
  state.waypointPoint = point;

  drawWaypointMarker(point);
  updateWaypointButtons();

  setDriveStatus("Finding waypoint route");
  showToast("Waypoint set");

  await routeToWaypoint({
    fit: true,
    silent: false
  });
}

function drawWaypointMarker(point) {
  if (!state.routeLayer) return;

  const latlng = [point.lat, point.lng];

  if (!state.waypointMarker) {
    state.waypointMarker = L.circleMarker(latlng, {
      radius: 9,
      color: "#eef7ff",
      weight: 4,
      fillColor: ROUTE_BLUE,
      fillOpacity: 1
    }).addTo(state.routeLayer);

    state.waypointMarker.bindTooltip("Waypoint", {
      sticky: true
    });
  } else {
    state.waypointMarker.setLatLng(latlng);
  }
}

async function routeToWaypoint(options = {}) {
  const {
    fit = false,
    silent = false
  } = options;

  if (!state.waypointPoint || state.isRouting) {
    return;
  }

  const start = await getFreshRouteStartPoint();

  if (!start) {
    showToast("Need GPS before routing to waypoint");
    return;
  }

  const requestId = ++state.routeRequestId;

  state.isRouting = true;

  if (!silent) {
    setDriveStatus("Finding waypoint route");
  }

  try {
    const route = await fetchRoadRoute(start, state.waypointPoint);

    if (requestId !== state.routeRequestId) {
      return;
    }

    drawRouteLine(route.coords);

    state.routeDistanceM = route.distanceM;
    state.routeDurationS = route.durationS;
    state.lastRouteStartPoint = start;
    state.lastRouteAt = Date.now();

    if (fit && route.coords.length > 1) {
      state.map?.fitBounds(L.latLngBounds(route.coords), {
        padding: [70, 120],
        maxZoom: 16
      });

      state.followUser = false;
    }

    setDriveStatus(
      state.isRecording
        ? `Driving • waypoint ${metersToKm(route.distanceM)} km`
        : `Waypoint ${metersToKm(route.distanceM)} km away`
    );
  } catch (error) {
    console.error(error);

    showToast("Could not find a road route to that waypoint");

    setDriveStatus(state.isRecording ? "Driving" : "Ready to drive");
  } finally {
    state.isRouting = false;
    updateWaypointButtons();
  }
}

async function fetchRoadRoute(start, end) {
  const coords = `${start.lng},${start.lat};${end.lng},${end.lat}`;
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    "?overview=full&geometries=geojson&steps=false";

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Routing returned ${response.status}`);
  }

  const data = await response.json();

  if (data.code !== "Ok" || !data.routes?.[0]) {
    throw new Error(data.message || "No route found");
  }

  const route = data.routes[0];

  return {
    distanceM: route.distance || 0,
    durationS: route.duration || 0,
    coords: route.geometry.coordinates.map((coord) => [
      coord[1],
      coord[0]
    ])
  };
}

async function getFreshRouteStartPoint() {
  if (
    state.currentPoint &&
    Date.now() - state.currentPoint.timestamp < 30000 &&
    state.currentPoint.accuracy <= MAX_GPS_ACCURACY_M
  ) {
    return state.currentPoint;
  }

  const position = await getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 9000,
    maximumAge: 5000
  });

  if (!position) {
    return state.currentPoint;
  }

  const point = positionToPoint(position);

  state.currentPoint = point;
  updateUserMarker(point);

  return point;
}

function drawRouteLine(coords) {
  clearRouteLine();

  if (
    !state.routeLayer ||
    !Array.isArray(coords) ||
    coords.length < 2
  ) {
    return;
  }

  state.routeHalo = L.polyline(coords, {
    color: "#eef7ff",
    weight: 9,
    opacity: 0.72,
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  }).addTo(state.routeLayer);

  state.routeLine = L.polyline(coords, {
    color: ROUTE_BLUE,
    weight: 5,
    opacity: 1,
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  }).addTo(state.routeLayer);

  if (state.waypointMarker) {
    state.waypointMarker.bringToFront();
  }
}

function clearRouteLine() {
  if (state.routeHalo && state.routeLayer) {
    state.routeLayer.removeLayer(state.routeHalo);
    state.routeHalo = null;
  }

  if (state.routeLine && state.routeLayer) {
    state.routeLayer.removeLayer(state.routeLine);
    state.routeLine = null;
  }
}

function clearWaypoint(showMessage = true) {
  state.awaitingWaypointClick = false;

  state.waypointPoint = null;
  state.routeDistanceM = 0;
  state.routeDurationS = 0;
  state.lastRouteStartPoint = null;
  state.lastRouteAt = 0;

  state.routeRequestId++;

  clearRouteLine();

  if (state.waypointMarker && state.routeLayer) {
    state.routeLayer.removeLayer(state.waypointMarker);
    state.waypointMarker = null;
  }

  updateWaypointButtons();

  if (showMessage) {
    showToast("Waypoint cleared");
  }

  setDriveStatus(state.isRecording ? "Driving" : "Ready to drive");
}

function updateWaypointButtons() {
  if (!els.clearWaypointBtn) return;

  const hasWaypoint = Boolean(state.waypointPoint);
  const showClear = hasWaypoint || state.awaitingWaypointClick;

  els.clearWaypointBtn.classList.toggle("hidden", !showClear);
}

function maybeUpdateWaypointRoute(point) {
  if (!state.waypointPoint) return;

  const distanceToWaypoint = haversine(point, state.waypointPoint);

  if (distanceToWaypoint <= ROUTE_ARRIVAL_RADIUS_M) {
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

  if (now - state.lastRouteAt < ROUTE_MIN_REROUTE_TIME_MS) {
    return;
  }

  const movedSinceRoute = haversine(point, state.lastRouteStartPoint);

  if (movedSinceRoute < ROUTE_REROUTE_DISTANCE_M) {
    return;
  }

  routeToWaypoint({
    fit: false,
    silent: true
  });
}

/* ---------- Supabase Road Profile / Auth ---------- */

function initSupabase() {
  renderAuthState();

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    setAuthMessage(
      "Supabase did not load. Map still works locally, but Road Profile is unavailable.",
      "error"
    );
    return;
  }

  state.auth.client = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  state.auth.client.auth.onAuthStateChange(async (event, session) => {
    state.auth.session = session || null;
    state.auth.user = session?.user || null;

    if (event === "PASSWORD_RECOVERY") {
      state.auth.passwordRecovery = true;
      showPasswordRecoveryBox();
      setAuthMessage("Enter a new password to finish the reset.", "info");
    }

    if (state.auth.user) {
      await ensureRoadProfile({ quiet: true });
      await maybeSyncProfileStats({ force: true, quiet: true });
      await refreshFriendData({ quiet: true });
    } else {
      state.auth.profile = null;
      state.auth.loading = false;
      clearFriendData();
    }

    renderAuthState();
  });

  loadInitialAuthSession();
}

async function loadInitialAuthSession() {
  if (!state.auth.client) return;

  state.auth.checkingSession = true;
  renderAuthState();

  const { data, error } = await state.auth.client.auth.getSession();

  if (error) {
    console.error(error);
    setAuthMessage("Could not check sign-in status.", "error");
    state.auth.loading = false;
    state.auth.checkingSession = false;
    renderAuthState();
    return;
  }

  state.auth.session = data?.session || null;
  state.auth.user = data?.session?.user || null;

  if (state.auth.user) {
    await ensureRoadProfile({ quiet: true });
    await maybeSyncProfileStats({ force: true, quiet: true });
    await refreshFriendData({ quiet: true });
  } else {
    state.auth.profile = null;
    state.auth.loading = false;
    clearFriendData();
  }

  state.auth.checkingSession = false;
  renderAuthState();
}

async function ensureRoadProfile(options = {}) {
  const { quiet = false } = options;

  if (!state.auth.client || !state.auth.user) {
    return null;
  }

  state.auth.loading = true;

  if (!quiet) {
    setAuthMessage("Loading Road Profile...", "info");
  }

  renderAuthState();

  const { data, error } = await state.auth.client.rpc("create_road_profile");

  if (error) {
    console.error(error);
    state.auth.loading = false;
    setAuthMessage("Could not load or create Road Profile.", "error");
    renderAuthState();
    return null;
  }

  const profile = normaliseProfile(data);

  if (!profile) {
    state.auth.loading = false;
    setAuthMessage("Road Profile response was empty.", "error");
    renderAuthState();
    return null;
  }

  state.auth.profile = profile;
  state.friendSettings.showProfile = Boolean(profile.show_profile);
  state.friendSettings.showMap = Boolean(profile.show_map);

  writeJson(ROAD_PROFILE_CACHE_KEY, profile);
  saveFriendSettings();

  state.auth.loading = false;
  renderAuthState();

  return profile;
}

function normaliseProfile(data) {
  if (Array.isArray(data)) {
    return data[0] || null;
  }

  if (data && typeof data === "object") {
    return data;
  }

  return null;
}

async function createRoadProfileAccount() {
  if (!state.auth.client) {
    setAuthMessage("Supabase is not connected.", "error");
    return;
  }

  if (state.auth.submitting) return;

  const email = els.createEmailInput?.value.trim();
  const password = els.createPasswordInput?.value || "";

  if (!email) {
    setAuthMessage("Enter your email address.", "error");
    return;
  }

  if (password.length < 6) {
    setAuthMessage("Password must be at least 6 characters.", "error");
    return;
  }

  state.auth.loading = true;
  state.auth.submitting = true;
  renderAuthState();
  setAuthMessage("Creating Road Profile...", "info");

  const { data, error } = await state.auth.client.auth.signUp({
    email,
    password
  });

  if (error) {
    console.error(error);
    state.auth.loading = false;
    state.auth.submitting = false;
    setAuthMessage(error.message || "Could not create account.", "error");
    renderAuthState();
    return;
  }

  state.auth.session = data?.session || null;
  state.auth.user = data?.user || data?.session?.user || null;

  if (state.auth.session && state.auth.user) {
    await ensureRoadProfile({ quiet: false });
    await maybeSyncProfileStats({ force: true, quiet: true });
    state.auth.loading = false;
    state.auth.submitting = false;
    setAuthMessage("Road Profile created.", "success");
    renderAuthState();
    showToast("Road Profile created");
    return;
  }

  state.auth.loading = false;
  state.auth.submitting = false;
  setAuthMessage(
    "Account created. Check your email to confirm it, then sign in.",
    "success"
  );
  renderAuthState();
}

async function signInRoadProfile() {
  if (!state.auth.client) {
    setAuthMessage("Supabase is not connected.", "error");
    return;
  }

  if (state.auth.submitting) return;

  const email = els.signInEmailInput?.value.trim();
  const password = els.signInPasswordInput?.value || "";

  if (!email || !password) {
    setAuthMessage("Enter your email and password.", "error");
    return;
  }

  state.auth.loading = true;
  state.auth.submitting = true;
  renderAuthState();
  setAuthMessage("Signing in...", "info");

  const { data, error } = await state.auth.client.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    console.error(error);
    state.auth.loading = false;
    state.auth.submitting = false;
    setAuthMessage(error.message || "Could not sign in.", "error");
    renderAuthState();
    return;
  }

  state.auth.session = data?.session || null;
  state.auth.user = data?.user || data?.session?.user || null;

  if (state.auth.user) {
    await ensureRoadProfile({ quiet: false });
    await maybeSyncProfileStats({ force: true, quiet: true });
    await refreshFriendData({ quiet: true });
    state.auth.loading = false;
    state.auth.submitting = false;
    setAuthMessage("Signed in.", "success");
    renderAuthState();
    showToast("Signed in");
  } else {
    state.auth.loading = false;
    state.auth.submitting = false;
    setAuthMessage("Could not read signed-in user.", "error");
    renderAuthState();
  }
}

async function signOutRoadProfile() {
  if (!state.auth.client) return;

  state.auth.loading = true;
  renderAuthState();

  const { error } = await state.auth.client.auth.signOut();

  if (error) {
    console.error(error);
    state.auth.loading = false;
    setAuthMessage(error.message || "Could not sign out.", "error");
    renderAuthState();
    return;
  }

  state.auth.session = null;
  state.auth.user = null;
  state.auth.profile = null;
  state.auth.loading = false;

  clearFriendData();

  renderAuthState();
  showToast("Signed out");
}

async function sendPasswordReset() {
  if (!state.auth.client) {
    setAuthMessage("Supabase is not connected.", "error");
    return;
  }

  const email =
    els.signInEmailInput?.value.trim() ||
    els.createEmailInput?.value.trim();

  if (!email) {
    setAuthMessage("Enter your email first.", "error");
    return;
  }

  state.auth.loading = true;
  renderAuthState();

  const { error } = await state.auth.client.auth.resetPasswordForEmail(
    email,
    {
      redirectTo: getAuthRedirectUrl()
    }
  );

  state.auth.loading = false;

  if (error) {
    console.error(error);
    setAuthMessage(error.message || "Could not send reset email.", "error");
    renderAuthState();
    return;
  }

  setAuthMessage("Password reset email sent.", "success");
  renderAuthState();
}

async function updateRecoveredPassword() {
  if (!state.auth.client) return;

  const password = els.newPasswordInput?.value || "";

  if (password.length < 6) {
    setAuthMessage("New password must be at least 6 characters.", "error");
    return;
  }

  state.auth.loading = true;
  renderAuthState();

  const { error } = await state.auth.client.auth.updateUser({
    password
  });

  state.auth.loading = false;

  if (error) {
    console.error(error);
    setAuthMessage(error.message || "Could not update password.", "error");
    renderAuthState();
    return;
  }

  state.auth.passwordRecovery = false;

  els.resetPasswordBox?.classList.add("hidden");

  if (els.newPasswordInput) {
    els.newPasswordInput.value = "";
  }

  setAuthMessage("Password updated.", "success");
  showToast("Password updated");
  renderAuthState();
}

async function handleProfilePrivacyToggle(field, checked) {
  const localKey =
    field === "show_profile"
      ? "showProfile"
      : "showMap";

  state.friendSettings[localKey] = checked;

  if (state.auth.profile) {
    state.auth.profile[field] = checked;
  }

  applyFriendSettingsToUI();

  if (!state.auth.client || !state.auth.user || !state.auth.profile) {
    saveFriendSettings();
    showToast("Create a Road Profile before sharing");
    return;
  }

  const update = {};
  update[field] = checked;

  const { data, error } = await state.auth.client
    .from("profiles")
    .update(update)
    .eq("id", state.auth.user.id)
    .select()
    .single();

  if (error) {
    console.error(error);

    state.friendSettings[localKey] = !checked;

    if (state.auth.profile) {
      state.auth.profile[field] = !checked;
    }

    applyFriendSettingsToUI();
    showToast("Could not update privacy");
    return;
  }

  const profile = normaliseProfile(data);

  if (profile) {
    state.auth.profile = profile;
    state.friendSettings.showProfile = Boolean(profile.show_profile);
    state.friendSettings.showMap = Boolean(profile.show_map);
    writeJson(ROAD_PROFILE_CACHE_KEY, profile);
  }

  saveFriendSettings();
  applyFriendSettingsToUI();

  if (field === "show_profile" && checked) {
    void maybeSyncProfileStats({ force: true, quiet: true });
  }

  if (field === "show_profile") {
    showToast(checked ? "Road Profile sharing on" : "Road Profile sharing off");
  } else {
    showToast(checked ? "Map overview sharing on" : "Map overview sharing off");
  }
}

async function copyFriendCode() {
  const code = state.auth.profile?.friend_code;

  if (!code) {
    showToast("No friend code yet");
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      copyTextFallback(code);
    }

    showToast("Friend code copied");
  } catch (error) {
    console.error(error);
    copyTextFallback(code);
    showToast("Friend code copied");
  }
}

function copyTextFallback(text) {
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function getAuthRedirectUrl() {
  return window.location.href.split("#")[0].split("?")[0];
}

function setAuthMode(mode) {
  const isCreate = mode === "create";

  els.authCreateModeBtn?.classList.toggle("active", isCreate);
  els.authSignInModeBtn?.classList.toggle("active", !isCreate);
  els.createAuthForm?.classList.toggle("hidden", !isCreate);
  els.signInAuthForm?.classList.toggle("hidden", isCreate);

  setAuthMessage("", "info");
}

function showPasswordRecoveryBox() {
  els.resetPasswordBox?.classList.remove("hidden");
}

function renderAuthState() {
  const signedIn = Boolean(state.auth.user);
  const loading = Boolean(state.auth.loading);
  const submitting = Boolean(state.auth.submitting);
  const profile = state.auth.profile;

  els.signedOutProfileCard?.classList.toggle("hidden", signedIn);
  els.signedInProfileCard?.classList.toggle("hidden", !signedIn);

  if (signedIn) {
    setText(els.profileEmailValue, state.auth.user?.email || "Signed in");
    setText(els.profileUsernameValue, profile?.username || "Creating profile...");
    setText(els.profileFriendCodeValue, profile?.friend_code || "Creating code...");
  }

  if (state.auth.passwordRecovery) {
    showPasswordRecoveryBox();
  }

  if (els.createProfileBtn) {
    els.createProfileBtn.disabled = signedIn || submitting;
  }

  if (els.signInBtn) {
    els.signInBtn.disabled = signedIn || submitting;
  }

  if (els.forgotPasswordBtn) {
    els.forgotPasswordBtn.disabled = submitting;
  }

  if (els.updatePasswordBtn) {
    els.updatePasswordBtn.disabled = submitting;
  }

  [
    els.signOutBtn,
    els.profileProfileToggle,
    els.profileMapToggle,
    els.friendProfileToggle,
    els.friendMapToggle
  ].forEach((element) => {
    if (element) {
      element.disabled = loading || submitting;
    }
  });

  if (els.copyFriendCodeBtn) {
    els.copyFriendCodeBtn.disabled =
      loading ||
      submitting ||
      !profile?.friend_code;
  }

  applyFriendSettingsToUI();
  renderFriendsList();
}

function setText(element, text) {
  if (element) {
    element.textContent = text;
  }
}

function setAuthMessage(message, type = "info") {
  if (!els.authMessage) return;

  if (!message) {
    els.authMessage.classList.add("hidden");
    els.authMessage.textContent = "";
    return;
  }

  els.authMessage.textContent = message;
  els.authMessage.className = `auth-message ${type}`;
}

/* ---------- Friends ---------- */

function clearFriendData() {
  state.friends.incomingRequests = [];
  state.friends.acceptedFriends = [];
  state.friends.loadingRequests = false;
  state.friends.loadingFriends = false;
  state.friends.sendingRequest = false;
  state.friends.respondingRequestId = null;
  state.friends.respondingAction = null;
  state.activeFriendId = null;
  state.statsSync.syncing = false;
  state.statsSync.lastSyncAt = 0;
  state.statsSync.lastPayloadKey = "";
}

async function refreshFriendData(options = {}) {
  const { quiet = false } = options;

  if (!state.auth.client || !state.auth.user) {
    clearFriendData();
    renderFriendsList();
    return;
  }

  await Promise.all([
    loadIncomingFriendRequests({ quiet: true }),
    loadFriends({ quiet: true })
  ]);

  if (!quiet) {
    showToast("Friends updated");
  }

  renderFriendsList();
}

function renderFriendsList() {
  const signedIn = Boolean(state.auth.user && state.auth.profile);

  const busy =
    Boolean(state.auth.loading) ||
    Boolean(state.auth.submitting) ||
    Boolean(state.friends.sendingRequest) ||
    Boolean(state.friends.respondingRequestId);

  if (els.showAddFriendBtn) {
    els.showAddFriendBtn.disabled = !signedIn || busy;
    els.showAddFriendBtn.textContent = signedIn
      ? "+ Add Friend"
      : "+ Add Friend (sign in first)";
  }

  if (els.addFriendBox && !signedIn) {
    els.addFriendBox.classList.add("hidden");
  }

  if (els.friendCodeInput) {
    els.friendCodeInput.disabled = !signedIn || busy;
  }

  if (els.addFriendCodeBtn) {
    els.addFriendCodeBtn.disabled = !signedIn || busy;
    els.addFriendCodeBtn.textContent = state.friends.sendingRequest
      ? "Sending..."
      : "Add";
  }

  if (els.searchFriendBtn) {
    els.searchFriendBtn.disabled = true;
  }

  renderIncomingFriendRequests(signedIn);
  renderAcceptedFriends(signedIn);
}

async function sendFriendRequestByCode() {
  if (!state.auth.client) {
    showToast("Supabase is not connected");
    return;
  }

  if (!state.auth.user || !state.auth.profile) {
    showToast("Sign in to add friends");
    return;
  }

  if (state.friends.sendingRequest) {
    return;
  }

  const rawCode = els.friendCodeInput?.value || "";
  const friendCode = normaliseFriendCodeInput(rawCode);

  if (!friendCode) {
    showToast("Enter a friend code");
    return;
  }

  const ownCode = normaliseFriendCodeInput(state.auth.profile.friend_code || "");

  if (ownCode && friendCode === ownCode) {
    showToast("That is your own friend code");
    return;
  }

  state.friends.sendingRequest = true;
  renderFriendsList();

  const { data, error } = await state.auth.client.rpc(
    "send_friend_request_by_code",
    {
      target_friend_code: friendCode
    }
  );

  state.friends.sendingRequest = false;

  if (error) {
    console.error(error);
    showToast(friendRequestErrorMessage(error));
    renderFriendsList();
    return;
  }

  const result = normaliseFriendRequestRpcResult(data);

  if (result.status === "already_sent") {
    showToast("Friend request already sent");
  } else if (result.status === "already_received") {
    showToast("They already sent you a request");
  } else if (result.status === "already_friends") {
    showToast("You are already friends");
  } else {
    showToast("Friend request sent");
  }

  if (els.friendCodeInput) {
    els.friendCodeInput.value = "";
  }

  await refreshFriendData({ quiet: true });
  renderFriendsList();
}

async function loadIncomingFriendRequests(options = {}) {
  const { quiet = false } = options;

  if (!state.auth.client || !state.auth.user) {
    state.friends.incomingRequests = [];
    renderFriendsList();
    return [];
  }

  if (state.friends.loadingRequests) {
    return state.friends.incomingRequests;
  }

  state.friends.loadingRequests = true;

  if (!quiet) {
    renderFriendsList();
  }

  const { data, error } = await state.auth.client.rpc(
    "get_incoming_friend_requests"
  );

  state.friends.loadingRequests = false;

  if (error) {
    console.error(error);

    if (!quiet) {
      showToast(friendRequestErrorMessage(error));
    }

    renderFriendsList();
    return state.friends.incomingRequests;
  }

  state.friends.incomingRequests = Array.isArray(data) ? data : [];

  renderFriendsList();
  return state.friends.incomingRequests;
}

async function loadFriends(options = {}) {
  const { quiet = false } = options;

  if (!state.auth.client || !state.auth.user) {
    state.friends.acceptedFriends = [];
    renderFriendsList();
    return [];
  }

  if (state.friends.loadingFriends) {
    return state.friends.acceptedFriends;
  }

  state.friends.loadingFriends = true;

  if (!quiet) {
    renderFriendsList();
  }

  let { data, error } = await state.auth.client.rpc("get_friends_with_stats");

  if (error && isMissingRpcError(error)) {
    const fallback = await state.auth.client.rpc("get_friends");
    data = fallback.data;
    error = fallback.error;
  }

  state.friends.loadingFriends = false;

  if (error) {
    console.error(error);

    if (!quiet) {
      showToast(friendRequestErrorMessage(error));
    }

    renderFriendsList();
    return state.friends.acceptedFriends;
  }

  state.friends.acceptedFriends = Array.isArray(data) ? data : [];

  renderFriendsList();
  return state.friends.acceptedFriends;
}

async function acceptIncomingFriendRequest(requestId) {
  await respondToIncomingFriendRequest("accept", requestId);
}

async function declineIncomingFriendRequest(requestId) {
  await respondToIncomingFriendRequest("decline", requestId);
}

async function respondToIncomingFriendRequest(action, requestId) {
  if (!state.auth.client || !state.auth.user) {
    showToast("Sign in to manage friend requests");
    return;
  }

  if (!requestId) {
    showToast("Friend request was missing an ID");
    return;
  }

  if (state.friends.respondingRequestId) {
    return;
  }

  const rpcName =
    action === "accept"
      ? "accept_friend_request"
      : "decline_friend_request";

  state.friends.respondingRequestId = requestId;
  state.friends.respondingAction = action;
  renderFriendsList();

  const { error } = await state.auth.client.rpc(rpcName, {
    request_id: requestId
  });

  state.friends.respondingRequestId = null;
  state.friends.respondingAction = null;

  if (error) {
    console.error(error);
    showToast(friendRequestErrorMessage(error));
    renderFriendsList();
    return;
  }

  showToast(
    action === "accept"
      ? "Friend request accepted"
      : "Friend request declined"
  );

  await refreshFriendData({ quiet: true });
  renderFriendsList();
}

function renderIncomingFriendRequests(signedIn) {
  if (!els.friendRequestsList) return;

  if (!signedIn) {
    els.friendRequestsList.innerHTML =
      '<div class="empty-state">Create or sign in to a Road Profile before friend requests.</div>';
    return;
  }

  if (state.friends.loadingRequests) {
    els.friendRequestsList.innerHTML =
      '<div class="empty-state">Loading friend requests...</div>';
    return;
  }

  const requests = state.friends.incomingRequests || [];

  if (requests.length === 0) {
    els.friendRequestsList.innerHTML =
      '<div class="empty-state">No incoming friend requests yet.</div>';
    return;
  }

  els.friendRequestsList.innerHTML = requests
    .map((request) => renderIncomingFriendRequestRow(request))
    .join("");
}

function renderIncomingFriendRequestRow(request) {
  const username = request.requester_username || "Road Profile";
  const friendCode = request.requester_friend_code || "Friend code hidden";
  const requestId = String(request.request_id || "");
  const initial = username.slice(0, 1).toUpperCase() || "R";
  const isBusy = state.friends.respondingRequestId === requestId;
  const accepting = isBusy && state.friends.respondingAction === "accept";
  const declining = isBusy && state.friends.respondingAction === "decline";

  return `
    <div class="friend-row request-row" data-request-id="${escapeHtml(requestId)}">
      <div class="friend-avatar">${escapeHtml(initial)}</div>

      <div class="friend-main">
        <div class="friend-name">${escapeHtml(username)}</div>
        <div class="friend-sub">${escapeHtml(friendCode)} sent a request</div>
      </div>

      <div class="request-actions">
        <button
          class="request-action-btn accept-request-btn"
          type="button"
          data-request-action="accept"
          data-request-id="${escapeHtml(requestId)}"
          ${isBusy ? "disabled" : ""}
        >${accepting ? "Accepting..." : "Accept"}</button>

        <button
          class="request-action-btn decline-request-btn"
          type="button"
          data-request-action="decline"
          data-request-id="${escapeHtml(requestId)}"
          ${isBusy ? "disabled" : ""}
        >${declining ? "Declining..." : "Decline"}</button>
      </div>
    </div>
  `;
}

function renderAcceptedFriends(signedIn) {
  if (!els.friendsList) return;

  if (!signedIn) {
    els.friendsList.innerHTML =
      '<div class="empty-state">Sign in to use real friends. The app still works locally without an account.</div>';
    return;
  }

  if (state.friends.loadingFriends) {
    els.friendsList.innerHTML =
      '<div class="empty-state">Loading friends...</div>';
    return;
  }

  const friends = state.friends.acceptedFriends || [];

  if (friends.length === 0) {
    els.friendsList.innerHTML =
      '<div class="empty-state">No accepted friends yet. Accept a friend request to add one here.</div>';
    return;
  }

  els.friendsList.innerHTML = friends
    .map((friend) => renderAcceptedFriendRow(friend))
    .join("");
}

function renderAcceptedFriendRow(friend) {
  const friendId = String(friend.friend_id || friend.id || "");
  const username = friend.username || "Road Profile";
  const friendCode = friend.friend_code || "Friend code hidden";
  const initial = username.slice(0, 1).toUpperCase() || "R";

  const profileStatus = friend.show_profile
    ? "Profile sharing on"
    : "Profile private";

  const mapStatus = friend.show_map
    ? "Map overview on"
    : "Map private";

  const stats = normaliseFriendStats(friend);

  const score = !friend.show_profile
    ? "Private"
    : stats.hasStats
      ? `${formatAustraliaPercent(stats.australiaPercent)}%`
      : "No stats";

  const scoreSub = !friend.show_profile
    ? "Profile"
    : stats.hasStats
      ? "Australia"
      : "Waiting";

  const syncedText =
    friend.show_profile && stats.hasStats
      ? ` • ${formatSyncedTime(stats.lastSyncedAt)}`
      : "";

  return `
    <button class="friend-row real-friend-row" type="button" data-friend-id="${escapeHtml(friendId)}">
      <div class="friend-avatar">${escapeHtml(initial)}</div>

      <div class="friend-main">
        <div class="friend-name">${escapeHtml(username)}</div>
        <div class="friend-sub">${escapeHtml(friendCode)} • ${escapeHtml(profileStatus)} • ${escapeHtml(mapStatus)}${escapeHtml(syncedText)}</div>
      </div>

      <div class="friend-score">
        <strong>${escapeHtml(score)}</strong>
        <span>${escapeHtml(scoreSub)}</span>
      </div>
    </button>
  `;
}

function normaliseFriendCodeInput(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normaliseFriendRequestRpcResult(data) {
  if (Array.isArray(data)) {
    return data[0] || {};
  }

  if (data && typeof data === "object") {
    return data;
  }

  return {};
}

function isMissingRpcError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("function") && message.includes("does not exist");
}

function friendRequestErrorMessage(error) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("friend code not found")) {
    return "Friend code not found";
  }

  if (message.includes("own friend code")) {
    return "That is your own friend code";
  }

  if (message.includes("already friends")) {
    return "You are already friends";
  }

  if (message.includes("already sent")) {
    return "Friend request already sent";
  }

  if (message.includes("already sent you")) {
    return "They already sent you a request";
  }

  if (message.includes("not found") || message.includes("not pending")) {
    return "Friend request is no longer pending";
  }

  if (message.includes("function") && message.includes("does not exist")) {
    return "Checkpoint SQL has not been installed yet";
  }

  return error?.message || "Friend action failed";
}

function openFriendProfile(friendId) {
  const friend = getFriendById(friendId);

  if (!friend) {
    showToast("Friend could not be found");
    renderFriendsList();
    return;
  }

  state.activeFriendId = String(friend.friend_id || friend.id || "");

  const username = friend.username || "Road Profile";
  const friendCode = friend.friend_code || "Friend code hidden";
  const initial = username.slice(0, 1).toUpperCase() || "R";
  const profileShared = Boolean(friend.show_profile);
  const mapShared = Boolean(friend.show_map);
  const stats = normaliseFriendStats(friend);

  if (els.friendProfileAvatar) {
    els.friendProfileAvatar.textContent = initial;
  }

  if (els.friendProfileName) {
    els.friendProfileName.textContent = username;
  }

  if (els.friendProfileHandle) {
    if (!profileShared) {
      els.friendProfileHandle.textContent = `${friendCode} • profile private`;
    } else if (stats.hasStats) {
      els.friendProfileHandle.textContent = `${friendCode} • ${formatSyncedTime(stats.lastSyncedAt)}`;
    } else {
      els.friendProfileHandle.textContent = `${friendCode} • not synced yet`;
    }
  }

  if (!profileShared) {
    setText(els.friendAustraliaStat, "Private");
    setText(els.friendUnlockedStat, "Private");
    setText(els.friendTodayStat, "Private");
    setText(els.friendWeekStat, "Private");
  } else if (!stats.hasStats) {
    setText(els.friendAustraliaStat, "Not synced yet");
    setText(els.friendUnlockedStat, "Road sync off");
    setText(els.friendTodayStat, "Not synced yet");
    setText(els.friendWeekStat, "Not synced yet");
  } else {
    setText(
      els.friendAustraliaStat,
      `${formatAustraliaPercent(stats.australiaPercent)}%`
    );

    setText(
      els.friendUnlockedStat,
      `${formatUnlockedNumber(stats.unlockedCount)} • ${stats.unlockedKm.toFixed(2)} km`
    );

    setText(
      els.friendTodayStat,
      `${stats.todayKm.toFixed(2)} km`
    );

    setText(
      els.friendWeekStat,
      `${stats.weekKm.toFixed(2)} km`
    );
  }

  if (els.openFriendMapBtn) {
    els.openFriendMapBtn.disabled = !mapShared;
  }

  renderFriendPreviewSvg(friend);
  renderFriendFullMapSvg(friend);
  showFriendProfileView();
}

function renderFriendPreviewSvg(friend) {
  if (!els.friendMapPreviewSvg) return;

  els.friendMapPreviewSvg.innerHTML = "";

  const text = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "text"
  );

  text.setAttribute("x", "160");
  text.setAttribute("y", "96");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("fill", "rgba(244, 247, 251, 0.58)");
  text.setAttribute("font-size", "14");
  text.setAttribute("font-weight", "800");

  text.textContent = friend?.show_map
    ? "Map sync comes later"
    : "Map overview private";

  els.friendMapPreviewSvg.appendChild(text);
}

function renderFriendFullMapSvg(friend) {
  if (!els.friendFullMapSvg) return;

  els.friendFullMapSvg.innerHTML = "";

  const text = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "text"
  );

  text.setAttribute("x", "450");
  text.setAttribute("y", "310");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("fill", "rgba(244, 247, 251, 0.58)");
  text.setAttribute("font-size", "28");
  text.setAttribute("font-weight", "900");

  text.textContent = friend?.show_map
    ? "Road syncing is not built yet"
    : "Map overview is private";

  els.friendFullMapSvg.appendChild(text);
}

function openFriendFullMap() {
  const friend = getActiveFriend();

  if (!friend) {
    showToast("Open an accepted friend first");
    return;
  }

  if (!friend.show_map) {
    showToast("This friend has map overview sharing off");
    return;
  }

  if (els.friendMapTitle) {
    els.friendMapTitle.textContent = `${friend.username || "Friend"}’s Map`;
  }

  renderFriendFullMapSvg(friend);

  els.friendMapOverlay?.classList.remove("hidden");
  els.friendMapOverlay?.setAttribute("aria-hidden", "false");
}

function closeFriendFullMap() {
  els.friendMapOverlay?.classList.add("hidden");
  els.friendMapOverlay?.setAttribute("aria-hidden", "true");
}

function getFriendById(friendId) {
  const id = String(friendId || "");

  return (
    state.friends.acceptedFriends.find((friend) => {
      return String(friend.friend_id || friend.id || "") === id;
    }) || null
  );
}

function getActiveFriend() {
  return getFriendById(state.activeFriendId);
}

function applyFriendSettingsToUI() {
  const showProfile = state.auth.profile
    ? Boolean(state.auth.profile.show_profile)
    : Boolean(state.friendSettings.showProfile);

  const showMap = state.auth.profile
    ? Boolean(state.auth.profile.show_map)
    : Boolean(state.friendSettings.showMap);

  state.friendSettings.showProfile = showProfile;
  state.friendSettings.showMap = showMap;

  if (els.friendProfileToggle) {
    els.friendProfileToggle.checked = showProfile;
  }

  if (els.friendMapToggle) {
    els.friendMapToggle.checked = showMap;
  }

  if (els.profileProfileToggle) {
    els.profileProfileToggle.checked = showProfile;
  }

  if (els.profileMapToggle) {
    els.profileMapToggle.checked = showMap;
  }
}

/* ---------- Checkpoint 4 safe profile stats sync ---------- */

async function maybeSyncProfileStats(options = {}) {
  const {
    force = false,
    quiet = true
  } = options;

  if (!state.auth.client || !state.auth.user || !state.auth.profile) {
    return false;
  }

  if (state.statsSync.syncing) {
    return false;
  }

  fixTodayIfNeeded();

  const stats = calculateLocalProfileStats();

  const payloadKey = JSON.stringify({
    unlockedCount: stats.unlockedCount,
    unlockedKm: stats.unlockedKm,
    todayKm: stats.todayKm,
    weekKm: stats.weekKm,
    australiaPercent: stats.australiaPercent
  });

  const now = Date.now();

  if (
    !force &&
    state.statsSync.lastPayloadKey === payloadKey &&
    now - state.statsSync.lastSyncAt < PROFILE_STATS_SYNC_MIN_MS
  ) {
    return false;
  }

  state.statsSync.syncing = true;

  const syncedAt = new Date().toISOString();

  const { error } = await state.auth.client.rpc("sync_my_profile_stats", {
  p_unlocked_count: stats.unlockedCount,
  p_unlocked_km: stats.unlockedKm,
  p_today_km: stats.todayKm,
  p_week_km: stats.weekKm,
  p_australia_percent: stats.australiaPercent
});

  state.statsSync.syncing = false;

  if (error) {
    console.error(error);

    if (!quiet) {
      showToast(checkpoint4ErrorMessage(error));
    }

    return false;
  }

  state.statsSync.lastSyncAt = now;
  state.statsSync.lastPayloadKey = payloadKey;

  if (!quiet) {
    showToast("Safe Road Profile stats synced");
  }

  return true;
}

function calculateLocalProfileStats() {
  const unlockedCount = Object.keys(state.savedSegments).length;
  const unlockedKm = roundKm(sumSavedSegmentsMeters() / 1000);
  const todayKm = roundKm(sumTodayUnlockedKm());
  const weekKm = roundKm(
    sumSavedSegmentsMetersSince(Date.now() - 7 * DAY_MS) / 1000
  );

  const australiaPercent = Number(
    ((unlockedCount / AU_TOTAL_UNLOCKS_ESTIMATE) * 100).toFixed(6)
  );

  return {
    unlockedCount,
    unlockedKm,
    todayKm,
    weekKm,
    australiaPercent
  };
}

function sumSavedSegmentsMeters() {
  let meters = 0;

  for (const segment of Object.values(state.savedSegments)) {
    meters += safeSegmentLengthM(segment);
  }

  return meters;
}

function sumSavedSegmentsMetersSince(timestamp) {
  let meters = 0;

  for (const segment of Object.values(state.savedSegments)) {
    const unlockedAt = Number(segment?.unlockedAt) || 0;

    if (unlockedAt >= timestamp) {
      meters += safeSegmentLengthM(segment);
    }
  }

  return meters;
}

function safeSegmentLengthM(segment) {
  const length = Number(segment?.lengthM);

  return Number.isFinite(length) && length > 0
    ? length
    : SEGMENT_SIZE_M;
}

function roundKm(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function normaliseFriendStats(friend) {
  const lastSyncedAt =
    friend?.last_synced_at ||
    friend?.stats_last_synced_at ||
    null;

  return {
    hasStats: Boolean(lastSyncedAt),
    unlockedCount: Math.max(0, Math.round(Number(friend?.unlocked_count) || 0)),
    unlockedKm: Math.max(0, Number(friend?.unlocked_km) || 0),
    todayKm: Math.max(0, Number(friend?.today_km) || 0),
    weekKm: Math.max(0, Number(friend?.week_km) || 0),
    australiaPercent: Math.max(0, Number(friend?.australia_percent) || 0),
    lastSyncedAt
  };
}

function formatSyncedTime(value) {
  if (!value) {
    return "not synced yet";
  }

  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) {
    return "synced recently";
  }

  const ageSeconds = Math.max(0, Math.round((Date.now() - time) / 1000));

  if (ageSeconds < 60) {
    return "synced just now";
  }

  const ageMinutes = Math.round(ageSeconds / 60);

  if (ageMinutes < 60) {
    return `synced ${ageMinutes} min ago`;
  }

  const ageHours = Math.round(ageMinutes / 60);

  if (ageHours < 24) {
    return `synced ${ageHours} hr ago`;
  }

  const ageDays = Math.round(ageHours / 24);

  if (ageDays < 8) {
    return `synced ${ageDays} day${ageDays === 1 ? "" : "s"} ago`;
  }

  return `synced ${new Date(value).toLocaleDateString("en-AU")}`;
}

function checkpoint4ErrorMessage(error) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("profile_stats") || message.includes("does not exist")) {
    return "Checkpoint 4 SQL has not been installed yet";
  }

  return error?.message || "Could not sync safe stats";
}

/* ---------- Stats ---------- */

function renderAllStats() {
  fixTodayIfNeeded();

  const lifetimeUnlocked = Object.keys(state.savedSegments).length;
  const australiaPercent =
    (lifetimeUnlocked / AU_TOTAL_UNLOCKS_ESTIMATE) * 100;

  if (els.australiaStat) {
    els.australiaStat.textContent = `${formatAustraliaPercent(australiaPercent)}%`;
  }

  if (els.todayStat) {
    els.todayStat.textContent = `${sumTodayUnlockedKm().toFixed(2)} km`;
  }

  if (els.unlockedStat) {
    els.unlockedStat.textContent =
      `${formatUnlockedNumber(lifetimeUnlocked)} / ` +
      `${formatCompactNumber(AU_TOTAL_UNLOCKS_ESTIMATE)}`;
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

function sumTodayUnlockedKm() {
  let meters = 0;

  for (const value of Object.values(state.todayUnlocks.keys)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      meters += value;
    } else {
      meters += SEGMENT_SIZE_M;
    }
  }

  return meters / 1000;
}

function sumTripUnlockedKm() {
  let meters = 0;

  for (const segment of state.roadSegments) {
    if (state.tripUnlocked.has(segment.id)) {
      meters += segment.lengthM;
    }
  }

  return meters / 1000;
}

function formatAustraliaPercent(percent) {
  const value = Number(percent) || 0;

  if (value > 0 && value < 0.0001) {
    return "<0.0001";
  }

  return value.toFixed(4);
}

function formatUnlockedNumber(value) {
  if (value < 10000) {
    return Number(value).toLocaleString("en-AU");
  }

  return formatCompactNumber(value);
}

function formatCompactNumber(value) {
  if (value >= 1000000) {
    return `${trimDecimal(value / 1000000)}M`;
  }

  if (value >= 1000) {
    return `${trimDecimal(value / 1000)}K`;
  }

  return Number(value).toLocaleString("en-AU");
}

function trimDecimal(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(1).replace(".0", "");
}

/* ---------- UI helpers ---------- */

function setDriveButtons(mode) {
  if (!els.startBtn || !els.finishBtn) return;

  els.startBtn.style.gridColumn = "1 / -1";
  els.finishBtn.style.gridColumn = "1 / -1";

  if (mode === "recording") {
    els.startBtn.classList.add("hidden");
    els.finishBtn.classList.remove("hidden");
    els.finishBtn.disabled = false;
    return;
  }

  els.finishBtn.classList.add("hidden");
  els.startBtn.classList.remove("hidden");
  els.startBtn.disabled = mode === "loading";
  els.startBtn.textContent =
    mode === "loading"
      ? "Starting Drive..."
      : "Start Drive";
}

function setDriveStatus(text) {
  if (els.driveStatus) {
    els.driveStatus.textContent = text;
  }
}

function setGpsStatus(text) {
  if (els.gpsStatus) {
    els.gpsStatus.textContent = text;
  }
}

function setAccuracyStatus(text) {
  if (els.accuracyStatus) {
    els.accuracyStatus.textContent = text;
  }
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

function positionToPoint(position) {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy || 999,
    speed: position.coords.speed,
    heading: position.coords.heading,
    timestamp: position.timestamp || Date.now()
  };
}

function haversine(a, b) {
  const earthRadiusM = 6371000;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

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

function interpolate(a, b, amount) {
  return {
    lat: a.lat + (b.lat - a.lat) * amount,
    lng: a.lng + (b.lng - a.lng) * amount
  };
}

function pointToSegmentDistance(point, segmentA, segmentB) {
  const latitudeRadians = toRad(point.lat);

  const metersPerLatitudeDegree = 111320;
  const metersPerLongitudeDegree =
    111320 * Math.cos(latitudeRadians);

  const ax =
    (segmentA[1] - point.lng) *
    metersPerLongitudeDegree;

  const ay =
    (segmentA[0] - point.lat) *
    metersPerLatitudeDegree;

  const bx =
    (segmentB[1] - point.lng) *
    metersPerLongitudeDegree;

  const by =
    (segmentB[0] - point.lat) *
    metersPerLatitudeDegree;

  const dx = bx - ax;
  const dy = by - ay;

  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.sqrt(ax * ax + ay * ay);
  }

  const amount = Math.max(
    0,
    Math.min(
      1,
      -((ax * dx + ay * dy) / lengthSquared)
    )
  );

  const closestX = ax + amount * dx;
  const closestY = ay + amount * dy;

  return Math.sqrt(
    closestX * closestX +
    closestY * closestY
  );
}

function compactCoords(coords) {
  return coords.map((coord) => [
    Number(Number(coord[0]).toFixed(6)),
    Number(Number(coord[1]).toFixed(6))
  ]);
}

function coordToPoint(coord) {
  return {
    lat: Number(coord[0]),
    lng: Number(coord[1])
  };
}

function metersToKm(meters) {
  return (meters / 1000).toFixed(2);
}

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

/* ---------- Formatting ---------- */

function getTodayKey() {
  const now = new Date();

  const year = now.getFullYear();

  const month = String(
    now.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    now.getDate()
  ).padStart(2, "0");

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
