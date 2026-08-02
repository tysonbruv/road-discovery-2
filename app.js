"use strict";

/* Road Discovery AU v49
   Checkpoint 10: Hide & Seek Mode inside Multiplayer.
   The existing road/GPS/Overpass/waypoint/localStorage engine remains local and unchanged.
   Only deliberately shared historical orange-road endpoint geometry is uploaded.
   Live GPS, current drives, markers, accuracy, speed, heading, waypoints and routes are never uploaded.
*/

const STORAGE_KEY = "roadDiscoveryAU.visited.v1";
const SAVED_SEGMENTS_KEY = "roadDiscoveryAU.savedSegments.v1";
const FRIEND_SETTINGS_KEY = "roadDiscoveryAU.friendSettings.v1";
const TODAY_UNLOCKS_KEY = "roadDiscoveryAU.todayUnlocks.v1";
const ROAD_PROFILE_CACHE_KEY = "roadDiscoveryAU.roadProfile.v1";
const SHARED_ROAD_SYNC_STATE_KEY = "roadDiscoveryAU.sharedRoadSync.v1";

const SHARED_ROAD_UPLOAD_BATCH_SIZE = 300;
const SHARED_ROAD_DOWNLOAD_PAGE_SIZE = 500;
const SHARED_ROAD_MAX_DOWNLOAD_PAGES = 200;
const FRIEND_NICKNAME_MAX_LENGTH = 40;
const MULTIPLAYER_LOCATION_SEND_MIN_MS = 3000;
const MULTIPLAYER_ROOM_POLL_MS = 4000;
const MULTIPLAYER_STALE_DOT_MS = 5 * 60 * 1000;

const HIDE_SEEK_ZONE_RADIUS_M = 1000;
const HIDE_SEEK_ZONE_MIN_START_DISTANCE_M = 1200;
const HIDE_SEEK_ZONE_MAX_START_DISTANCE_M = 3000;
const HIDE_SEEK_ZONE_LOCAL_MAX_DISTANCE_M = 2450;
const HIDE_SEEK_ZONE_MIN_ROAD_CHUNKS = 25;
const HIDE_SEEK_ZONE_MIN_CANDIDATES = 6;
const HIDE_SEEK_ZONE_MAX_CANDIDATES = 18;
const HIDE_SEEK_CANDIDATE_SPACING_M = 240;
const HIDE_SEEK_LOCATION_SEND_MIN_MS = 3000;
const HIDE_SEEK_ROUTE_MIN_REROUTE_TIME_MS = 45000;
const HIDE_SEEK_ROUTE_REROUTE_DISTANCE_M = 120;
const HIDE_SEEK_WOLF_COLOUR = "#ff4d4d";
const HIDE_SEEK_SHEEP_COLOUR = "#4bb3ff";
const HIDE_SEEK_OUT_COLOUR = "#9aa3b2";

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
    outgoingRequests: [],
    acceptedFriends: [],

    loadingRequests: false,
    loadingOutgoingRequests: false,
    loadingFriends: false,

    sendingRequest: false,

    respondingRequestId: null,
    respondingAction: null,

    cancellingOutgoingRequestId: null,
    removingFriendId: null,

    nicknames: new Map(),
    loadingNicknames: false,
    nicknameEditorOpen: false,
    nicknameRequestFriendId: null
  },

  statsSync: {
    syncing: false,
    lastSyncAt: 0,
    lastPayloadKey: ""
  },

  sharedRoadSync: {
    syncing: false,
    clearing: false,
    activeUserId: null,
    privateCleanupChecked: false,
    hashCache: new Map(),
    confirmationResolve: null
  },

    friendMap: {
    friendId: null,
    roads: [],
    loading: false,
    loaded: false,
    error: "",
    requestId: 0,
    fullMap: null,
    fullRoadLayer: null,
    fullRenderer: null
  },

  multiplayer: {
    roomId: null,
    roomCode: "",
    expiresAt: null,
    createdBy: null,
    displayName: "",
    dotColour: ROUTE_BLUE,

    members: [],
    markers: new Map(),
    layer: null,

    creating: false,
    joining: false,
    leaving: false,
    updatingLocation: false,
    polling: false,

    watchId: null,
    pollTimer: null,
    lastLocationSentAt: 0
  },

  hideSeek: {
    roundId: null,
    phase: "",
    viewerRole: "",
    winner: null,
    players: [],

    escapeEndsAt: null,
    huntEndsAt: null,
    serverOffsetMs: 0,

    zonePoint: null,
    zoneRadiusM: HIDE_SEEK_ZONE_RADIUS_M,
    leaveWarningSeconds: 15,
    findDistanceM: 50,
    staleAfterSeconds: 300,
    outsideWarningEndsAt: null,

    starting: false,
    polling: false,
    updatingLocation: false,
    leaving: false,
    preparationText: "",
    unavailableMessage: "",

    layer: null,
    zoneCircle: null,
    routeLine: null,
    routeHalo: null,
    routeRequestId: 0,
    routeLoading: false,
    routeKey: "",
    lastRouteStartPoint: null,
    lastRouteAt: 0,
    markers: new Map(),

    countdownTimer: null,
    lastLocationSentAt: 0
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
    "multiplayerBtn",
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

    "multiplayerPanel",
    "closeMultiplayerBtn",
    "multiplayerSignedOutBox",
    "multiplayerIdleBox",
    "multiplayerActiveBox",
    "createMultiplayerRoomBtn",
    "multiplayerRoomCodeInput",
    "joinMultiplayerRoomBtn",
    "multiplayerRoomCodeValue",
    "copyMultiplayerCodeBtn",
    "multiplayerMembersList",
    "multiplayerStatusText",
    "hideSeekSetupBox",
    "startHideSeekBtn",
    "hideSeekPreparationText",
    "hideSeekGameBox",
    "hideSeekRoleBadge",
    "hideSeekPhaseBadge",
    "hideSeekTimerValue",
    "hideSeekGameStatus",
    "hideSeekZoneWarning",
    "hideSeekPlayersList",
    "leaveHideSeekBtn",
    "leaveMultiplayerRoomBtn",

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
    "friendCodeInput",
    "addFriendCodeBtn",
    "friendRequestsList",
    "outgoingRequestsList",
    "friendsList",
    "backToFriendsBtn",

    "friendProfileAvatar",
    "friendProfileName",
    "friendProfileHandle",
    "friendNicknameBadge",
    "friendNameControls",
    "changeFriendNameBtn",
    "friendNameEditor",
    "friendNicknameInput",
    "friendNameCharacterCount",
    "saveFriendNameBtn",
    "cancelFriendNameBtn",
    "clearFriendNameBtn",
    "friendAustraliaStat",
    "friendUnlockedStat",
    "friendTodayStat",
    "friendWeekStat",
    "friendMapPreviewSvg",
    "openFriendMapBtn",
    "friendMapOpenLabel",
    "removeFriendBtn",

    "friendMapOverlay",
    "friendMapTitle",
    "friendFullMap",
    "friendFullMapStatus",
    "closeFriendMapBtn",

    "mapShareConfirmOverlay",
    "cancelMapShareBtn",
    "confirmMapShareBtn",

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

  state.map.createPane("userAccuracyPane");
  state.map.createPane("multiplayerPane");
  state.map.createPane("userLocationPane");

  const userAccuracyPane = state.map.getPane("userAccuracyPane");
  const multiplayerPane = state.map.getPane("multiplayerPane");
  const userLocationPane = state.map.getPane("userLocationPane");

  if (userAccuracyPane) {
    userAccuracyPane.style.zIndex = "620";
    userAccuracyPane.style.pointerEvents = "none";
  }
   if (multiplayerPane) {
    multiplayerPane.style.zIndex = "630";
    multiplayerPane.style.pointerEvents = "none";
  }

  if (userLocationPane) {
    userLocationPane.style.zIndex = "640";
    userLocationPane.style.pointerEvents = "none";
  }

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    crossOrigin: true,
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
  }).addTo(state.map);

  state.roadsLayer.addTo(state.map);
  state.savedLayer.addTo(state.map);
  state.tripLayer.addTo(state.map);
  state.routeLayer.addTo(state.map);

  state.multiplayer.layer = L.layerGroup().addTo(state.map);
  state.hideSeek.layer = L.layerGroup().addTo(state.map);

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
  els.multiplayerBtn?.addEventListener("click", openMultiplayerPanel);

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
  els.closeMultiplayerBtn?.addEventListener("click", closePanels);
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
     els.createMultiplayerRoomBtn?.addEventListener(
    "click",
    createMultiplayerRoom
  );

  els.joinMultiplayerRoomBtn?.addEventListener(
    "click",
    joinMultiplayerRoom
  );

  els.multiplayerRoomCodeInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinMultiplayerRoom();
  });

  els.copyMultiplayerCodeBtn?.addEventListener(
    "click",
    copyMultiplayerRoomCode
  );

  els.startHideSeekBtn?.addEventListener(
    "click",
    startHideSeekRound
  );

  els.leaveHideSeekBtn?.addEventListener(
    "click",
    leaveHideSeekRound
  );

  els.leaveMultiplayerRoomBtn?.addEventListener(
    "click",
    () => leaveMultiplayerRoom()
  );

  els.showAddFriendBtn?.addEventListener("click", () => {
    els.addFriendBox?.classList.toggle("hidden");
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

  els.outgoingRequestsList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-outgoing-action]");

    if (!button || !els.outgoingRequestsList.contains(button)) {
      return;
    }

    const requestId = button.dataset.requestId || "";
    const action = button.dataset.outgoingAction || "";

    if (action === "cancel") {
      cancelOutgoingFriendRequest(requestId);
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

  els.changeFriendNameBtn?.addEventListener("click", openFriendNameEditor);
  els.saveFriendNameBtn?.addEventListener("click", saveActiveFriendNickname);
  els.cancelFriendNameBtn?.addEventListener("click", cancelFriendNameEditor);
  els.clearFriendNameBtn?.addEventListener("click", clearActiveFriendNickname);

  els.friendNicknameInput?.addEventListener("input", () => {
    enforceFriendNicknameLimit();
    updateFriendNameCharacterCount();
  });

  els.friendNicknameInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveActiveFriendNickname();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelFriendNameEditor();
    }
  });

  els.cancelMapShareBtn?.addEventListener("click", () => {
    resolveMapShareConfirmation(false);
  });

  els.confirmMapShareBtn?.addEventListener("click", () => {
    resolveMapShareConfirmation(true);
  });

  els.mapShareConfirmOverlay?.addEventListener("click", (event) => {
    if (event.target === els.mapShareConfirmOverlay) {
      resolveMapShareConfirmation(false);
    }
  });

  els.removeFriendBtn?.addEventListener("click", removeActiveFriend);

  window.addEventListener("online", handleOnlineReconnect);
  window.addEventListener("offline", () => showToast("Offline"));

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!els.mapShareConfirmOverlay?.classList.contains("hidden")) {
        resolveMapShareConfirmation(false);
      } else if (!els.friendMapOverlay?.classList.contains("hidden")) {
        closeFriendFullMap();
      }
    }
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
  const friendsWasOpen =
    Boolean(els.friendsPanel) &&
    !els.friendsPanel.classList.contains("hidden");

    [
    "settingsPanel",
    "waypointPanel",
    "multiplayerPanel",
    "friendsPanel"
  ].forEach((id) => {
    const panel = els[id];

    if (!panel) return;

    panel.classList.add("hidden");
    panel.setAttribute("aria-hidden", "true");
  });

  if (friendsWasOpen) {
    closeFriendFullMap();
    clearActiveFriendMapData({ keepActiveFriend: false });
  }

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
  closeFriendFullMap();
  clearActiveFriendMapData({ keepActiveFriend: false });
  state.friends.nicknameEditorOpen = false;

  els.friendProfileView?.classList.add("hidden");
  els.friendsListView?.classList.remove("hidden");
}

function showFriendProfileView() {
  els.friendsListView?.classList.add("hidden");
  els.friendProfileView?.classList.remove("hidden");
}
/* ---------- Multiplayer Mode ---------- */

function hasActiveMultiplayerRoom() {
  return Boolean(state.multiplayer.roomId);
}

function hasActiveHideSeekRound() {
  return Boolean(
    state.hideSeek.roundId &&
    ["escape", "hunt"].includes(state.hideSeek.phase)
  );
}

function openMultiplayerPanel() {
  renderMultiplayerState();
  openPanel("multiplayerPanel");
}

function renderMultiplayerState() {
  const signedIn = Boolean(state.auth.user && state.auth.profile);
  const active = hasActiveMultiplayerRoom();

  const busy =
    Boolean(state.multiplayer.creating) ||
    Boolean(state.multiplayer.joining) ||
    Boolean(state.multiplayer.leaving) ||
    Boolean(state.hideSeek.starting) ||
    Boolean(state.hideSeek.leaving);

  els.multiplayerBtn?.classList.toggle("multiplayer-active", active);

  els.multiplayerSignedOutBox?.classList.toggle("hidden", signedIn);
  els.multiplayerIdleBox?.classList.toggle("hidden", !signedIn || active);
  els.multiplayerActiveBox?.classList.toggle("hidden", !signedIn || !active);

  if (els.createMultiplayerRoomBtn) {
    els.createMultiplayerRoomBtn.disabled = !signedIn || busy;
    els.createMultiplayerRoomBtn.textContent = state.multiplayer.creating
      ? "Creating..."
      : "Create room";
  }

  if (els.joinMultiplayerRoomBtn) {
    els.joinMultiplayerRoomBtn.disabled = !signedIn || busy;
    els.joinMultiplayerRoomBtn.textContent = state.multiplayer.joining
      ? "Joining..."
      : "Join";
  }

  if (els.multiplayerRoomCodeInput) {
    els.multiplayerRoomCodeInput.disabled = !signedIn || busy;
  }

  if (els.copyMultiplayerCodeBtn) {
    els.copyMultiplayerCodeBtn.disabled = !active || busy;
  }

  if (els.leaveMultiplayerRoomBtn) {
    els.leaveMultiplayerRoomBtn.disabled = !active || busy;
    els.leaveMultiplayerRoomBtn.textContent = state.multiplayer.leaving
      ? "Leaving..."
      : "Leave room";
  }

  if (els.multiplayerRoomCodeValue) {
    els.multiplayerRoomCodeValue.textContent =
      state.multiplayer.roomCode || "RIDE-00000";
  }

  if (els.multiplayerStatusText) {
    if (!active) {
      els.multiplayerStatusText.textContent =
        "Multiplayer Mode is off.";
    } else if (hasActiveHideSeekRound()) {
      els.multiplayerStatusText.textContent = state.isRecording
        ? "Hide & Seek is active. Start Drive still paints and saves only your own orange roads."
        : "Hide & Seek is active. Normal coloured dots are paused while the secure game view is running.";
    } else if (state.isRecording) {
      els.multiplayerStatusText.textContent =
        "Start Drive is running. Your own roads still paint orange and your temporary dot is shared.";
    } else {
      els.multiplayerStatusText.textContent =
        "Sharing your temporary dot while Multiplayer Mode is on. Press Start Drive if you want to paint roads.";
    }
  }

  renderMultiplayerMembers();
  renderHideSeekState();
}

function renderMultiplayerMembers() {
  if (!els.multiplayerMembersList) return;

  const members = Array.isArray(state.multiplayer.members)
    ? state.multiplayer.members
    : [];

  if (!hasActiveMultiplayerRoom()) {
    els.multiplayerMembersList.innerHTML = `
      <div class="empty-state">
        Riders appear here.
      </div>
    `;
    return;
  }

  if (members.length === 0) {
    els.multiplayerMembersList.innerHTML = `
      <div class="empty-state">
        Waiting for riders.
      </div>
    `;
    return;
  }

  els.multiplayerMembersList.innerHTML = members
    .map((member) => {
      const name = escapeHtml(member.display_name || "Road user");
      const colour = safeMultiplayerColour(member.dot_colour);
      const isMe = Boolean(member.is_me);
      const hasDot =
        member.lat !== null &&
        member.lat !== undefined &&
        member.lng !== null &&
        member.lng !== undefined &&
        Number.isFinite(Number(member.lat)) &&
        Number.isFinite(Number(member.lng));

      const subText = hasActiveHideSeekRound()
        ? isMe
          ? "You • Hide & Seek"
          : "Hide & Seek"
        : isMe
          ? "You"
          : hasDot
            ? `Dot updated ${formatMultiplayerAge(member.updated_at)}`
            : "Waiting for location";

      return `
        <div class="multiplayer-member-row">
          <span
            class="multiplayer-member-dot"
            style="--member-colour: ${colour};"
            aria-hidden="true"
          ></span>

          <div class="multiplayer-member-main">
            <div class="multiplayer-member-name">
              ${name}
            </div>

            <div class="multiplayer-member-sub">
              ${escapeHtml(subText)}
            </div>
          </div>

          <div class="multiplayer-member-pill ${hasDot || hasActiveHideSeekRound() ? "online" : ""}">
            ${hasActiveHideSeekRound() ? "Game" : hasDot ? "Live" : "Wait"}
          </div>
        </div>
      `;
    })
    .join("");
}

async function createMultiplayerRoom() {
  if (!state.auth.client || !state.auth.user || !state.auth.profile) {
    showToast("Sign in to use Multiplayer Mode");
    renderMultiplayerState();
    return;
  }

  if (state.multiplayer.creating || hasActiveMultiplayerRoom()) {
    return;
  }

  state.multiplayer.creating = true;
  renderMultiplayerState();

  const { data, error } = await state.auth.client.rpc(
    "create_multiplayer_room"
  );

  state.multiplayer.creating = false;

  if (error) {
    console.error(error);
    showToast(multiplayerErrorMessage(error));
    renderMultiplayerState();
    return;
  }

  const room = normaliseMultiplayerRoom(data);

  if (!room?.room_id) {
    showToast("Could not read multiplayer room");
    renderMultiplayerState();
    return;
  }

  startMultiplayerMode(room);
  showToast("Multiplayer room created");
}

async function joinMultiplayerRoom() {
  if (!state.auth.client || !state.auth.user || !state.auth.profile) {
    showToast("Sign in to use Multiplayer Mode");
    renderMultiplayerState();
    return;
  }

  if (state.multiplayer.joining || hasActiveMultiplayerRoom()) {
    return;
  }

  const roomCode = normaliseMultiplayerRoomCode(
    els.multiplayerRoomCodeInput?.value || ""
  );

  if (!roomCode) {
    showToast("Enter a room code");
    return;
  }

  state.multiplayer.joining = true;
  renderMultiplayerState();

  const { data, error } = await state.auth.client.rpc(
    "join_multiplayer_room",
    {
      p_room_code: roomCode
    }
  );

  state.multiplayer.joining = false;

  if (error) {
    console.error(error);
    showToast(multiplayerErrorMessage(error));
    renderMultiplayerState();
    return;
  }

  const room = normaliseMultiplayerRoom(data);

  if (!room?.room_id) {
    showToast("Could not join multiplayer room");
    renderMultiplayerState();
    return;
  }

  if (els.multiplayerRoomCodeInput) {
    els.multiplayerRoomCodeInput.value = "";
  }

  startMultiplayerMode(room);
  showToast("Joined multiplayer room");
}

function startMultiplayerMode(room) {
  resetHideSeekState({
    clearRound: true,
    render: false
  });

  state.multiplayer.roomId = String(room.room_id || "");
  state.multiplayer.roomCode = String(room.room_code || "");
  state.multiplayer.expiresAt = room.expires_at || null;
  state.multiplayer.createdBy = room.created_by || null;
  state.multiplayer.displayName = String(room.display_name || "");
  state.multiplayer.dotColour = safeMultiplayerColour(
    room.dot_colour || ROUTE_BLUE
  );
  state.multiplayer.members = [];

  renderMultiplayerState();
  startMultiplayerPolling();
  startMultiplayerLocationWatch();

  if (state.currentPoint) {
    void maybeSendMultiplayerLocation(state.currentPoint, {
      force: true
    });
  }

  void pollMultiplayerRoomState();
}

async function leaveMultiplayerRoom(options = {}) {
  const { quiet = false, leaveServer = true } = options;

  if (!hasActiveMultiplayerRoom()) {
    stopMultiplayerMode({
      clearRoom: true
    });
    return;
  }

  const roomId = state.multiplayer.roomId;

  state.multiplayer.leaving = true;
  renderMultiplayerState();

  stopMultiplayerLocationWatch();
  stopMultiplayerPolling();
  clearMultiplayerMarkers();

  if (hasActiveHideSeekRound()) {
    await leaveHideSeekRound({
      quiet: true,
      render: false
    });
  }

  if (
    leaveServer &&
    state.auth.client &&
    state.auth.user &&
    roomId
  ) {
    const { error } = await state.auth.client.rpc(
      "leave_multiplayer_room",
      {
        p_room_id: roomId
      }
    );

    if (error && !quiet) {
      console.error(error);
      showToast(multiplayerErrorMessage(error));
    }
  }

  state.multiplayer.leaving = false;

  stopMultiplayerMode({
    clearRoom: true
  });

  if (!quiet) {
    showToast("Left multiplayer room");
  }
}

function stopMultiplayerMode(options = {}) {
  const { clearRoom = true } = options;

  stopMultiplayerLocationWatch();
  stopMultiplayerPolling();
  clearMultiplayerMarkers();
  resetHideSeekState({
    clearRound: true,
    render: false
  });

  state.multiplayer.creating = false;
  state.multiplayer.joining = false;
  state.multiplayer.leaving = false;
  state.multiplayer.updatingLocation = false;
  state.multiplayer.polling = false;
  state.multiplayer.lastLocationSentAt = 0;
  state.multiplayer.members = [];

  if (clearRoom) {
    state.multiplayer.roomId = null;
    state.multiplayer.roomCode = "";
    state.multiplayer.expiresAt = null;
    state.multiplayer.createdBy = null;
    state.multiplayer.displayName = "";
    state.multiplayer.dotColour = ROUTE_BLUE;
  }

  renderMultiplayerState();
}

function startMultiplayerPolling() {
  stopMultiplayerPolling();

  if (!hasActiveMultiplayerRoom()) return;

  void pollMultiplayerRoomState();

  state.multiplayer.pollTimer = window.setInterval(() => {
    void pollMultiplayerRoomState();
  }, MULTIPLAYER_ROOM_POLL_MS);
}

function stopMultiplayerPolling() {
  if (state.multiplayer.pollTimer !== null) {
    window.clearInterval(state.multiplayer.pollTimer);
    state.multiplayer.pollTimer = null;
  }
}

async function pollMultiplayerRoomState() {
  if (
    !hasActiveMultiplayerRoom() ||
    !state.auth.client ||
    !state.auth.user ||
    state.multiplayer.polling ||
    !navigator.onLine
  ) {
    return;
  }

  state.multiplayer.polling = true;

  const { data, error } = await state.auth.client.rpc(
    "get_multiplayer_room_state",
    {
      p_room_id: state.multiplayer.roomId
    }
  );

  if (error) {
    state.multiplayer.polling = false;
    console.error(error);

    stopMultiplayerMode({
      clearRoom: true
    });

    showToast(multiplayerErrorMessage(error));
    return;
  }

  state.multiplayer.members = Array.isArray(data) ? data : [];

  const firstRow = state.multiplayer.members[0];

  if (firstRow) {
    state.multiplayer.roomCode = String(
      firstRow.room_code || state.multiplayer.roomCode || ""
    );
    state.multiplayer.expiresAt =
      firstRow.expires_at || state.multiplayer.expiresAt;
    state.multiplayer.createdBy =
      firstRow.created_by || state.multiplayer.createdBy;
  }

  drawMultiplayerMarkers(state.multiplayer.members);

  await pollHideSeekState();

  state.multiplayer.polling = false;
  renderMultiplayerState();
}

function startMultiplayerLocationWatch() {
  if (!hasActiveMultiplayerRoom()) return;

  /*
    If Start Drive is running, do not start a second GPS watch.
    The normal drive GPS watch will call maybeSendMultiplayerLocation(point).
  */
  if (state.isRecording || state.watchId !== null) {
    stopMultiplayerLocationWatch();
    return;
  }

  if (state.multiplayer.watchId !== null) {
    return;
  }

  if (!navigator.geolocation) {
    showToast("GPS is not available for Multiplayer Mode");
    return;
  }

  state.multiplayer.watchId = navigator.geolocation.watchPosition(
    onMultiplayerGpsPosition,
    onMultiplayerGpsError,
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000
    }
  );
}

function stopMultiplayerLocationWatch() {
  if (state.multiplayer.watchId !== null) {
    navigator.geolocation.clearWatch(state.multiplayer.watchId);
    state.multiplayer.watchId = null;
  }
}

function onMultiplayerGpsPosition(position) {
  const point = positionToPoint(position);

  state.currentPoint = point;

  updateUserMarker(point);

  void maybeSendMultiplayerLocation(point);
  maybeUpdateHideSeekRoute(point);
}

function onMultiplayerGpsError(error) {
  const message =
    error?.code === 1
      ? "GPS permission denied"
      : error?.code === 2
        ? "GPS position unavailable"
        : error?.code === 3
          ? "GPS timed out"
          : "GPS error";

  if (hasActiveMultiplayerRoom()) {
    setAccuracyStatus(message);
  }
}

async function maybeSendMultiplayerLocation(point, options = {}) {
  const { force = false } = options;

  if (
    !hasActiveMultiplayerRoom() ||
    !state.auth.client ||
    !state.auth.user ||
    !navigator.onLine
  ) {
    return false;
  }

  if (
    !point ||
    !Number.isFinite(Number(point.lat)) ||
    !Number.isFinite(Number(point.lng))
  ) {
    return false;
  }

  if (hasActiveHideSeekRound()) {
    return maybeSendHideSeekLocation(point, {
      force
    });
  }

  const now = Date.now();

  if (
    !force &&
    now - state.multiplayer.lastLocationSentAt <
      MULTIPLAYER_LOCATION_SEND_MIN_MS
  ) {
    return false;
  }

  if (state.multiplayer.updatingLocation) {
    return false;
  }

  state.multiplayer.lastLocationSentAt = now;
  state.multiplayer.updatingLocation = true;

  const { error } = await state.auth.client.rpc(
    "update_multiplayer_location",
    {
      p_room_id: state.multiplayer.roomId,
      p_lat: Number(point.lat),
      p_lng: Number(point.lng),
      p_accuracy: Number.isFinite(Number(point.accuracy))
        ? Number(point.accuracy)
        : null
    }
  );

  state.multiplayer.updatingLocation = false;

  if (error) {
    console.error(error);
    return false;
  }

  return true;
}

function drawMultiplayerMarkers(members) {
  if (!state.map || !state.multiplayer.layer) return;

  const seenIds = new Set();

  for (const member of members || []) {
    const userId = String(member.user_id || "");

    if (!userId || member.is_me) {
      continue;
    }

    const lat = Number(member.lat);
    const lng = Number(member.lng);

    if (
      member.lat === null ||
      member.lat === undefined ||
      member.lng === null ||
      member.lng === undefined ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      continue;
    }

    seenIds.add(userId);

    const colour = safeMultiplayerColour(member.dot_colour);
    const stale = isMultiplayerDotStale(member.updated_at);
    const name = member.display_name || "Rider";

    const icon = L.divIcon({
      className: "multiplayer-dot-icon",
      html: `
        <div
          class="multiplayer-leaflet-dot ${stale ? "stale" : ""}"
          style="--dot-colour: ${colour};"
        ></div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const existingMarker = state.multiplayer.markers.get(userId);

    if (existingMarker) {
      existingMarker.setLatLng([lat, lng]);
      existingMarker.setIcon(icon);
      existingMarker.setTooltipContent(escapeHtml(name));
    } else {
      const marker = L.marker([lat, lng], {
        icon,
        pane: "multiplayerPane",
        interactive: false
      }).addTo(state.multiplayer.layer);

      marker.bindTooltip(escapeHtml(name), {
        sticky: true
      });

      state.multiplayer.markers.set(userId, marker);
    }
  }

  for (const [userId, marker] of state.multiplayer.markers.entries()) {
    if (!seenIds.has(userId)) {
      state.multiplayer.layer.removeLayer(marker);
      state.multiplayer.markers.delete(userId);
    }
  }
}

function clearMultiplayerMarkers() {
  if (state.multiplayer.layer) {
    state.multiplayer.layer.clearLayers();
  }

  state.multiplayer.markers.clear();
}

async function copyMultiplayerRoomCode() {
  const code = state.multiplayer.roomCode;

  if (!code) {
    showToast("No room code yet");
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      copyTextFallback(code);
    }

    showToast("Room code copied");
  } catch (error) {
    console.error(error);
    copyTextFallback(code);
    showToast("Room code copied");
  }
}

function normaliseMultiplayerRoom(data) {
  if (Array.isArray(data)) {
    return data[0] || null;
  }

  if (data && typeof data === "object") {
    return data;
  }

  return null;
}

function normaliseMultiplayerRoomCode(value) {
  const cleaned = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (!cleaned) return "";

  if (cleaned.startsWith("RIDE-")) {
    return cleaned;
  }

  return `RIDE-${cleaned}`;
}

function safeMultiplayerColour(value) {
  const colour = String(value || "").trim();

  if (/^#[0-9a-f]{6}$/i.test(colour)) {
    return colour;
  }

  return ROUTE_BLUE;
}

function isMultiplayerDotStale(updatedAt) {
  const timestamp = Date.parse(updatedAt || "");

  if (!Number.isFinite(timestamp)) {
    return true;
  }

  return Date.now() - timestamp > MULTIPLAYER_STALE_DOT_MS;
}

function formatMultiplayerAge(updatedAt) {
  const timestamp = Date.parse(updatedAt || "");

  if (!Number.isFinite(timestamp)) {
    return "soon";
  }

  const seconds = Math.max(
    0,
    Math.round((Date.now() - timestamp) / 1000)
  );

  if (seconds < 6) return "now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);

  return `${minutes}m ago`;
}

function multiplayerErrorMessage(error) {
  const message = String(error?.message || "");

  if (!message) {
    return "Multiplayer Mode had a problem";
  }

  return message.replace(/^Error:\s*/i, "");
}

/* ---------- Hide & Seek Mode ---------- */

function resetHideSeekState(options = {}) {
  const {
    clearRound = true,
    render = true
  } = options;

  stopHideSeekCountdown();
  clearHideSeekVisuals();

  state.hideSeek.starting = false;
  state.hideSeek.polling = false;
  state.hideSeek.updatingLocation = false;
  state.hideSeek.leaving = false;
  state.hideSeek.routeLoading = false;
  state.hideSeek.preparationText = "";
  state.hideSeek.unavailableMessage = "";
  state.hideSeek.lastLocationSentAt = 0;

  if (clearRound) {
    state.hideSeek.roundId = null;
    state.hideSeek.phase = "";
    state.hideSeek.viewerRole = "";
    state.hideSeek.winner = null;
    state.hideSeek.players = [];
    state.hideSeek.escapeEndsAt = null;
    state.hideSeek.huntEndsAt = null;
    state.hideSeek.serverOffsetMs = 0;
    state.hideSeek.zonePoint = null;
    state.hideSeek.zoneRadiusM = HIDE_SEEK_ZONE_RADIUS_M;
    state.hideSeek.leaveWarningSeconds = 15;
    state.hideSeek.findDistanceM = 50;
    state.hideSeek.staleAfterSeconds = 300;
    state.hideSeek.outsideWarningEndsAt = null;
  }

  applyHideSeekOwnMarkerStyle();

  if (render) {
    renderMultiplayerState();
  }
}

function clearHideSeekVisuals() {
  clearHideSeekRoute();
  clearHideSeekMarkers();

  if (state.hideSeek.zoneCircle && state.hideSeek.layer) {
    state.hideSeek.layer.removeLayer(state.hideSeek.zoneCircle);
  }

  state.hideSeek.zoneCircle = null;
  state.hideSeek.zonePoint = null;
}

function startHideSeekCountdown() {
  stopHideSeekCountdown();

  if (!hasActiveHideSeekRound()) return;

  state.hideSeek.countdownTimer = window.setInterval(() => {
    renderHideSeekState();
  }, 1000);
}

function stopHideSeekCountdown() {
  if (state.hideSeek.countdownTimer !== null) {
    window.clearInterval(state.hideSeek.countdownTimer);
    state.hideSeek.countdownTimer = null;
  }
}

function renderHideSeekState() {
  const roomActive = hasActiveMultiplayerRoom();
  const roundActive = hasActiveHideSeekRound();
  const hasRound = Boolean(state.hideSeek.roundId);
  const memberCount = state.multiplayer.members.length;

  els.hideSeekSetupBox?.classList.toggle(
    "hidden",
    !roomActive || roundActive
  );

  els.hideSeekGameBox?.classList.toggle(
    "hidden",
    !roomActive || !hasRound
  );

  if (els.startHideSeekBtn) {
    els.startHideSeekBtn.disabled =
      !roomActive ||
      memberCount < 2 ||
      state.hideSeek.starting ||
      state.multiplayer.leaving;

    els.startHideSeekBtn.textContent = state.hideSeek.starting
      ? "Preparing Hide & Seek..."
      : hasRound
        ? "Start another round"
        : "Start Hide & Seek";
  }

  if (els.hideSeekPreparationText) {
    const preparationText =
      state.hideSeek.preparationText ||
      state.hideSeek.unavailableMessage ||
      (memberCount < 2
        ? "At least 2 riders must be in the room."
        : "The app will choose one wolf and a road-based hiding zone.");

    els.hideSeekPreparationText.textContent = preparationText;
  }

  if (!hasRound) {
    renderHideSeekPlayers();
    return;
  }

  if (els.hideSeekRoleBadge) {
    const role = state.hideSeek.viewerRole || "player";

    els.hideSeekRoleBadge.textContent =
      role === "wolf" ? "Wolf" : role === "sheep" ? "Sheep" : "Player";

    els.hideSeekRoleBadge.classList.toggle("wolf", role === "wolf");
    els.hideSeekRoleBadge.classList.toggle("sheep", role === "sheep");
  }

  if (els.hideSeekPhaseBadge) {
    els.hideSeekPhaseBadge.textContent = hideSeekPhaseLabel(
      state.hideSeek.phase
    );
  }

  if (els.hideSeekTimerValue) {
    els.hideSeekTimerValue.textContent = formatHideSeekCountdown();
  }

  if (els.hideSeekGameStatus) {
    els.hideSeekGameStatus.textContent = hideSeekGameStatusText();
  }

  const warningSeconds = hideSeekOutsideWarningSeconds();

  if (els.hideSeekZoneWarning) {
    els.hideSeekZoneWarning.classList.toggle(
      "hidden",
      warningSeconds === null
    );

    if (warningSeconds !== null) {
      els.hideSeekZoneWarning.textContent =
        `Return to the hiding zone in ${warningSeconds}s or you are out.`;
    }
  }

  if (els.leaveHideSeekBtn) {
    const me = getMyHideSeekPlayer();

    els.leaveHideSeekBtn.classList.toggle(
      "hidden",
      !roundActive || me?.player_status !== "active"
    );

    els.leaveHideSeekBtn.disabled = state.hideSeek.leaving;
    els.leaveHideSeekBtn.textContent = state.hideSeek.leaving
      ? "Leaving game..."
      : "Leave Hide & Seek";
  }

  renderHideSeekPlayers();
}

function renderHideSeekPlayers() {
  if (!els.hideSeekPlayersList) return;

  const players = Array.isArray(state.hideSeek.players)
    ? state.hideSeek.players
    : [];

  if (players.length === 0) {
    els.hideSeekPlayersList.innerHTML = `
      <div class="empty-state">
        Roles appear when the round starts.
      </div>
    `;
    return;
  }

  els.hideSeekPlayersList.innerHTML = players
    .map((player) => {
      const role = player.role === "wolf" ? "wolf" : "sheep";
      const status = String(player.player_status || "active");
      const name = escapeHtml(player.display_name || "Road user");
      const isMe = Boolean(player.is_me);
      const statusLabel = hideSeekPlayerStatusLabel(player);

      return `
        <div class="hide-seek-player-row">
          <span
            class="hide-seek-player-dot ${role} ${escapeHtml(status)}"
            aria-hidden="true"
          ></span>

          <div class="hide-seek-player-main">
            <div class="hide-seek-player-name">
              ${name}${isMe ? " <span>You</span>" : ""}
            </div>

            <div class="hide-seek-player-sub">
              ${role === "wolf" ? "Wolf" : "Sheep"}
            </div>
          </div>

          <div class="hide-seek-player-status ${escapeHtml(status)}">
            ${escapeHtml(statusLabel)}
          </div>
        </div>
      `;
    })
    .join("");
}

function hideSeekPlayerStatusLabel(player) {
  const status = String(player?.player_status || "active");

  if (status === "found") return "Found";
  if (status === "out") return "Out";
  if (status === "survived") return "Safe";

  if (player?.role === "wolf") {
    return state.hideSeek.phase === "escape" ? "Waiting" : "Hunting";
  }

  return "Hidden";
}

function hideSeekPhaseLabel(phase) {
  if (phase === "escape") return "Escape";
  if (phase === "hunt") return "Hunt";
  if (phase === "finished") return "Finished";
  if (phase === "cancelled") return "Cancelled";
  return "Waiting";
}

function hideSeekGameStatusText() {
  const me = getMyHideSeekPlayer();

  if (state.hideSeek.phase === "finished") {
    return state.hideSeek.winner === "wolf"
      ? "The wolf found every sheep. Wolf wins."
      : "At least one sheep stayed hidden. Sheep win.";
  }

  if (state.hideSeek.phase === "cancelled") {
    return "The round ended because the Multiplayer room closed.";
  }

  if (me?.player_status === "found") {
    return "You were found. Your last game dot is now visible to everyone.";
  }

  if (me?.player_status === "out") {
    return "You are out. Your last game dot is now visible to everyone.";
  }

  if (state.hideSeek.phase === "escape") {
    return state.hideSeek.viewerRole === "wolf"
      ? "Sheep are hiding... Their locations and hiding zone are private."
      : "Reach the blue hiding zone before the escape timer reaches zero.";
  }

  if (state.hideSeek.phase === "hunt") {
    return state.hideSeek.viewerRole === "wolf"
      ? "Search inside the zone. Hidden sheep remain private until found or out."
      : "Stay inside the hiding zone and avoid the wolf until time runs out.";
  }

  return "Waiting for the Hide & Seek round.";
}

function formatHideSeekCountdown() {
  let deadline = null;

  if (state.hideSeek.phase === "escape") {
    deadline = state.hideSeek.escapeEndsAt;
  } else if (state.hideSeek.phase === "hunt") {
    deadline = state.hideSeek.huntEndsAt;
  }

  const deadlineMs = Date.parse(deadline || "");

  if (!Number.isFinite(deadlineMs)) {
    return "00:00";
  }

  const serverNow = Date.now() + state.hideSeek.serverOffsetMs;
  const seconds = Math.max(0, Math.ceil((deadlineMs - serverNow) / 1000));
  const minutesPart = Math.floor(seconds / 60);
  const secondsPart = String(seconds % 60).padStart(2, "0");

  return `${String(minutesPart).padStart(2, "0")}:${secondsPart}`;
}

function hideSeekOutsideWarningSeconds() {
  const warningMs = Date.parse(state.hideSeek.outsideWarningEndsAt || "");

  if (!Number.isFinite(warningMs) || !hasActiveHideSeekRound()) {
    return null;
  }

  const serverNow = Date.now() + state.hideSeek.serverOffsetMs;

  return Math.max(0, Math.ceil((warningMs - serverNow) / 1000));
}

function getMyHideSeekPlayer() {
  return state.hideSeek.players.find((player) => player.is_me) || null;
}

async function startHideSeekRound() {
  if (
    !hasActiveMultiplayerRoom() ||
    !state.auth.client ||
    !state.auth.user ||
    state.hideSeek.starting ||
    hasActiveHideSeekRound()
  ) {
    return;
  }

  if (state.multiplayer.members.length < 2) {
    showToast("Hide & Seek needs at least 2 riders");
    return;
  }

  const safetyAccepted = window.confirm(
    "Play safely. Follow road rules. Do not speed. Do not stop somewhere dangerous. Leave the zone if needed.\n\nStart Hide & Seek?"
  );

  if (!safetyAccepted) return;

  state.hideSeek.starting = true;
  state.hideSeek.preparationText = "Getting a clean GPS location...";
  state.hideSeek.unavailableMessage = "";
  renderMultiplayerState();

  try {
    const startPoint = await getFreshRouteStartPoint();

    if (
      !startPoint ||
      !Number.isFinite(Number(startPoint.lat)) ||
      !Number.isFinite(Number(startPoint.lng)) ||
      Number(startPoint.accuracy) > MAX_GPS_ACCURACY_M
    ) {
      throw new Error("Need GPS accuracy of 35 metres or better before starting.");
    }

    state.hideSeek.preparationText = "Loading nearby road chunks...";
    renderHideSeekState();

    const roadsReady = await ensureRoadsNearPoint(startPoint, {
      replaceIfFar: true,
      quiet: false
    });

    if (!roadsReady || state.roadSegments.length === 0) {
      throw new Error("Could not load nearby roads for a hiding zone.");
    }

    state.hideSeek.preparationText = "Checking road-based hiding zones...";
    renderHideSeekState();

    const localCandidates = buildHideSeekZoneCandidates(startPoint);

    if (localCandidates.length < HIDE_SEEK_ZONE_MIN_CANDIDATES) {
      throw new Error(
        "Not enough suitable roads nearby. Move to another area and try again."
      );
    }

    const routeableCandidates = await filterRouteableHideSeekCandidates(
      startPoint,
      localCandidates
    );

    if (routeableCandidates.length < HIDE_SEEK_ZONE_MIN_CANDIDATES) {
      throw new Error(
        "Not enough reachable hiding zones were found. Move to another area and try again."
      );
    }

    state.hideSeek.preparationText = "Randomly choosing the wolf and zone...";
    renderHideSeekState();

    const { data, error } = await state.auth.client.rpc(
      "start_hide_seek_round",
      {
        p_room_id: state.multiplayer.roomId,
        p_start_lat: Number(startPoint.lat),
        p_start_lng: Number(startPoint.lng),
        p_zone_candidates: routeableCandidates.map((candidate) => ({
          lat: candidate.lat,
          lng: candidate.lng,
          road_count: candidate.road_count,
          routeable: true
        })),
        p_safety_ack: true
      }
    );

    if (error) {
      throw error;
    }

    const roundId = Array.isArray(data) ? data[0] : data;

    if (!roundId) {
      throw new Error("Could not read the new Hide & Seek round.");
    }

    state.hideSeek.roundId = String(roundId);
    state.hideSeek.preparationText = "";

    await pollHideSeekState({ force: true });

    if (state.currentPoint) {
      void maybeSendHideSeekLocation(state.currentPoint, {
        force: true
      });
    }

    showToast("Hide & Seek started");
  } catch (error) {
    console.error(error);
    showToast(hideSeekErrorMessage(error));
    state.hideSeek.preparationText = hideSeekErrorMessage(error);
  } finally {
    state.hideSeek.starting = false;
    renderMultiplayerState();
  }
}

function buildHideSeekZoneCandidates(startPoint) {
  const roadPoints = state.roadSegments
    .map((segment) => roadSegmentMidpoint(segment))
    .filter(Boolean);

  const pool = roadPoints.filter((point) => {
    const distance = haversine(startPoint, point);

    return (
      distance >= HIDE_SEEK_ZONE_MIN_START_DISTANCE_M &&
      distance <= HIDE_SEEK_ZONE_LOCAL_MAX_DISTANCE_M
    );
  });

  shuffleHideSeekArray(pool);

  const selected = [];

  for (const point of pool) {
    if (
      selected.some(
        (candidate) =>
          haversine(candidate, point) < HIDE_SEEK_CANDIDATE_SPACING_M
      )
    ) {
      continue;
    }

    const roadCount = countNearbyHideSeekRoadChunks(point, roadPoints);

    if (roadCount < HIDE_SEEK_ZONE_MIN_ROAD_CHUNKS) {
      continue;
    }

    selected.push({
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
      road_count: roadCount,
      routeable: false
    });

    if (selected.length >= HIDE_SEEK_ZONE_MAX_CANDIDATES) {
      break;
    }
  }

  return selected;
}

function roadSegmentMidpoint(segment) {
  if (!validCoords(segment?.coords)) return null;

  const a = segment.coords[0];
  const b = segment.coords[segment.coords.length - 1];

  return {
    lat: (Number(a[0]) + Number(b[0])) / 2,
    lng: (Number(a[1]) + Number(b[1])) / 2
  };
}

function countNearbyHideSeekRoadChunks(point, roadPoints) {
  let count = 0;

  for (const roadPoint of roadPoints) {
    if (haversine(point, roadPoint) <= HIDE_SEEK_ZONE_RADIUS_M) {
      count += 1;
    }
  }

  return count;
}

function shuffleHideSeekArray(values) {
  for (let index = values.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = values[index];

    values[index] = values[swapIndex];
    values[swapIndex] = current;
  }
}

async function filterRouteableHideSeekCandidates(startPoint, candidates) {
  const limitedCandidates = candidates.slice(
    0,
    HIDE_SEEK_ZONE_MAX_CANDIDATES
  );

  const coords = [startPoint, ...limitedCandidates]
    .map((point) => `${point.lng},${point.lat}`)
    .join(";");

  const url =
    `https://router.project-osrm.org/table/v1/driving/${coords}` +
    "?sources=0&annotations=duration,distance";

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Hiding-zone routing returned ${response.status}.`);
  }

  const data = await response.json();

  if (data.code !== "Ok") {
    throw new Error(data.message || "Could not check hiding-zone routes.");
  }

  const durations = data.durations?.[0] || [];
  const distances = data.distances?.[0] || [];

  return limitedCandidates
    .map((candidate, index) => ({
      ...candidate,
      routeable:
        Number.isFinite(Number(durations[index + 1])) &&
        Number.isFinite(Number(distances[index + 1])) &&
        Number(durations[index + 1]) <= 360 &&
        Number(distances[index + 1]) <= 4500
    }))
    .filter((candidate) => candidate.routeable);
}

async function pollHideSeekState(options = {}) {
  const { force = false } = options;

  if (
    !hasActiveMultiplayerRoom() ||
    !state.auth.client ||
    !state.auth.user ||
    state.hideSeek.polling ||
    (!force && !navigator.onLine)
  ) {
    return;
  }

  state.hideSeek.polling = true;

  const { data, error } = await state.auth.client.rpc(
    "get_hide_seek_state",
    {
      p_room_id: state.multiplayer.roomId
    }
  );

  state.hideSeek.polling = false;

  if (error) {
    console.error(error);

    const message = hideSeekErrorMessage(error);

    if (/started before you joined/i.test(message)) {
      state.hideSeek.unavailableMessage =
        "A round is already running. You can start or join the next round.";
    }

    renderHideSeekState();
    return;
  }

  const rows = Array.isArray(data) ? data : [];

  if (rows.length === 0) {
    if (state.hideSeek.starting) {
      renderHideSeekState();
      return;
    }

    resetHideSeekState({
      clearRound: true,
      render: false
    });
    renderHideSeekState();
    return;
  }

  applyHideSeekRows(rows);
}

function applyHideSeekRows(rows) {
  const first = rows[0];
  const previousRoundId = state.hideSeek.roundId;
  const previousPhase = state.hideSeek.phase;
  const previousRole = state.hideSeek.viewerRole;

  state.hideSeek.roundId = String(first.round_id || "");
  state.hideSeek.phase = String(first.phase || "");
  state.hideSeek.viewerRole = String(first.viewer_role || "");
  state.hideSeek.winner = first.winner || null;
  state.hideSeek.players = rows;
  state.hideSeek.escapeEndsAt = first.escape_ends_at || null;
  state.hideSeek.huntEndsAt = first.hunt_ends_at || null;
  state.hideSeek.zoneRadiusM =
    Number(first.zone_radius_m) || HIDE_SEEK_ZONE_RADIUS_M;
  state.hideSeek.leaveWarningSeconds =
    Number(first.leave_warning_seconds) || 15;
  state.hideSeek.findDistanceM = Number(first.find_distance_m) || 50;
  state.hideSeek.staleAfterSeconds =
    Number(first.stale_after_seconds) || 300;
  state.hideSeek.unavailableMessage = "";

  const serverNowMs = Date.parse(first.server_now || "");

  if (Number.isFinite(serverNowMs)) {
    state.hideSeek.serverOffsetMs = serverNowMs - Date.now();
  }

  const hasZoneValues =
    first.zone_lat !== null &&
    first.zone_lat !== undefined &&
    first.zone_lng !== null &&
    first.zone_lng !== undefined;

  const zoneLat = hasZoneValues ? Number(first.zone_lat) : NaN;
  const zoneLng = hasZoneValues ? Number(first.zone_lng) : NaN;

  state.hideSeek.zonePoint =
    Number.isFinite(zoneLat) && Number.isFinite(zoneLng)
      ? { lat: zoneLat, lng: zoneLng }
      : null;

  const me = getMyHideSeekPlayer();

  state.hideSeek.outsideWarningEndsAt =
    me?.outside_warning_ends_at || null;

  if (hasActiveHideSeekRound()) {
    drawHideSeekZone();
    drawHideSeekMarkers(rows);
  } else {
    clearHideSeekVisuals();
  }

  applyHideSeekOwnMarkerStyle();

  if (
    state.hideSeek.viewerRole === "sheep" &&
    state.hideSeek.phase === "escape" &&
    state.hideSeek.zonePoint
  ) {
    void ensureHideSeekRoute();
  } else {
    clearHideSeekRoute();
  }

  if (hasActiveHideSeekRound()) {
    startHideSeekCountdown();
  } else {
    stopHideSeekCountdown();
  }

  const roundChanged = previousRoundId !== state.hideSeek.roundId;
  const phaseChanged = previousPhase !== state.hideSeek.phase;
  const roleChanged = previousRole !== state.hideSeek.viewerRole;

  if (roundChanged || roleChanged) {
    showToast(
      state.hideSeek.viewerRole === "wolf"
        ? "You are the wolf"
        : "You are a sheep"
    );
  } else if (phaseChanged && state.hideSeek.phase === "hunt") {
    showToast("The hunt has started");
  } else if (phaseChanged && state.hideSeek.phase === "finished") {
    showToast(
      state.hideSeek.winner === "wolf"
        ? "Wolf wins"
        : "Sheep win"
    );
  }

  if (roundChanged && state.currentPoint) {
    void maybeSendHideSeekLocation(state.currentPoint, {
      force: true
    });
  }

  renderMultiplayerState();
}

async function maybeSendHideSeekLocation(point, options = {}) {
  const { force = false } = options;
  const me = getMyHideSeekPlayer();

  if (
    !hasActiveHideSeekRound() ||
    !state.auth.client ||
    !state.auth.user ||
    !navigator.onLine ||
    me?.player_status !== "active"
  ) {
    return false;
  }

  if (
    !point ||
    !Number.isFinite(Number(point.lat)) ||
    !Number.isFinite(Number(point.lng)) ||
    !Number.isFinite(Number(point.accuracy)) ||
    Number(point.accuracy) > MAX_GPS_ACCURACY_M
  ) {
    return false;
  }

  const now = Date.now();

  if (
    !force &&
    now - state.hideSeek.lastLocationSentAt <
      HIDE_SEEK_LOCATION_SEND_MIN_MS
  ) {
    return false;
  }

  if (state.hideSeek.updatingLocation) {
    return false;
  }

  state.hideSeek.lastLocationSentAt = now;
  state.hideSeek.updatingLocation = true;

  const { data, error } = await state.auth.client.rpc(
    "update_hide_seek_location",
    {
      p_round_id: state.hideSeek.roundId,
      p_lat: Number(point.lat),
      p_lng: Number(point.lng),
      p_accuracy: Number(point.accuracy)
    }
  );

  state.hideSeek.updatingLocation = false;

  if (error) {
    console.error(error);
    return false;
  }

  void pollHideSeekState();

  return Boolean(data);
}

async function leaveHideSeekRound(options = {}) {
  const {
    quiet = false,
    render = true
  } = options;

  if (
    !state.hideSeek.roundId ||
    !state.auth.client ||
    !state.auth.user ||
    state.hideSeek.leaving
  ) {
    return;
  }

  state.hideSeek.leaving = true;

  if (render) {
    renderMultiplayerState();
  }

  const { error } = await state.auth.client.rpc(
    "leave_hide_seek_round",
    {
      p_round_id: state.hideSeek.roundId
    }
  );

  state.hideSeek.leaving = false;

  if (error) {
    console.error(error);

    if (!quiet) {
      showToast(hideSeekErrorMessage(error));
    }

    if (render) {
      renderMultiplayerState();
    }
    return;
  }

  if (!quiet) {
    showToast("Left Hide & Seek");
  }

  if (render) {
    await pollHideSeekState({ force: true });
    renderMultiplayerState();
  }
}

function drawHideSeekZone() {
  if (!state.hideSeek.layer) return;

  if (!state.hideSeek.zonePoint) {
    if (state.hideSeek.zoneCircle) {
      state.hideSeek.layer.removeLayer(state.hideSeek.zoneCircle);
      state.hideSeek.zoneCircle = null;
    }
    return;
  }

  const latlng = [
    state.hideSeek.zonePoint.lat,
    state.hideSeek.zonePoint.lng
  ];

  if (!state.hideSeek.zoneCircle) {
    state.hideSeek.zoneCircle = L.circle(latlng, {
      radius: state.hideSeek.zoneRadiusM,
      color: HIDE_SEEK_SHEEP_COLOUR,
      opacity: 0.9,
      fillColor: HIDE_SEEK_SHEEP_COLOUR,
      fillOpacity: 0.08,
      weight: 3,
      dashArray: "10 8",
      interactive: false
    }).addTo(state.hideSeek.layer);
  } else {
    state.hideSeek.zoneCircle.setLatLng(latlng);
    state.hideSeek.zoneCircle.setRadius(state.hideSeek.zoneRadiusM);
  }
}

function drawHideSeekMarkers(players) {
  if (!state.hideSeek.layer || !state.map) return;

  const seenIds = new Set();

  for (const player of players || []) {
    const userId = String(player.user_id || "");

    if (!userId || player.is_me) continue;

    const lat = Number(player.lat);
    const lng = Number(player.lng);

    if (
      player.lat === null ||
      player.lat === undefined ||
      player.lng === null ||
      player.lng === undefined ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      continue;
    }

    const status = String(player.player_status || "active");
    const role = player.role === "wolf" ? "wolf" : "sheep";

    const visibleByGameRules =
      state.hideSeek.phase === "hunt" &&
      (
        (
          state.hideSeek.viewerRole === "sheep" &&
          role === "wolf"
        ) ||
        (
          role === "sheep" &&
          ["found", "out"].includes(status)
        )
      );

    if (!visibleByGameRules) {
      continue;
    }

    const colour =
      status === "found" || status === "out"
        ? HIDE_SEEK_OUT_COLOUR
        : role === "wolf"
          ? HIDE_SEEK_WOLF_COLOUR
          : HIDE_SEEK_SHEEP_COLOUR;

    seenIds.add(userId);

    const icon = L.divIcon({
      className: "multiplayer-dot-icon hide-seek-dot-icon",
      html: `
        <div
          class="hide-seek-leaflet-dot ${role} ${escapeHtml(status)}"
          style="--dot-colour: ${colour};"
        ></div>
      `,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    const tooltip = `${escapeHtml(player.display_name || "Player")} • ${
      role === "wolf" ? "Wolf" : hideSeekPlayerStatusLabel(player)
    }`;

    const existingMarker = state.hideSeek.markers.get(userId);

    if (existingMarker) {
      existingMarker.setLatLng([lat, lng]);
      existingMarker.setIcon(icon);
      existingMarker.setTooltipContent(tooltip);
    } else {
      const marker = L.marker([lat, lng], {
        icon,
        pane: "multiplayerPane",
        interactive: false
      }).addTo(state.hideSeek.layer);

      marker.bindTooltip(tooltip, {
        sticky: true
      });

      state.hideSeek.markers.set(userId, marker);
    }
  }

  for (const [userId, marker] of state.hideSeek.markers.entries()) {
    if (!seenIds.has(userId)) {
      state.hideSeek.layer.removeLayer(marker);
      state.hideSeek.markers.delete(userId);
    }
  }
}

function clearHideSeekMarkers() {
  if (state.hideSeek.layer) {
    for (const marker of state.hideSeek.markers.values()) {
      state.hideSeek.layer.removeLayer(marker);
    }
  }

  state.hideSeek.markers.clear();
}

function applyHideSeekOwnMarkerStyle() {
  const colour =
    hasActiveHideSeekRound() && state.hideSeek.viewerRole === "wolf"
      ? HIDE_SEEK_WOLF_COLOUR
      : HIDE_SEEK_SHEEP_COLOUR;

  state.userMarker?.setStyle({
    color: "#eef7ff",
    fillColor: colour
  });

  state.accuracyCircle?.setStyle({
    color: colour,
    fillColor: colour
  });
}

async function ensureHideSeekRoute(options = {}) {
  const { force = false } = options;

  if (
    state.hideSeek.viewerRole !== "sheep" ||
    state.hideSeek.phase !== "escape" ||
    !state.hideSeek.zonePoint
  ) {
    clearHideSeekRoute();
    return;
  }

  if (state.hideSeek.routeLoading) {
    return;
  }

  const routeKey =
    `${state.hideSeek.roundId}:` +
    `${state.hideSeek.zonePoint.lat.toFixed(6)},` +
    `${state.hideSeek.zonePoint.lng.toFixed(6)}`;

  if (!force && state.hideSeek.routeLine && state.hideSeek.routeKey === routeKey) {
    return;
  }

  const start = await getFreshRouteStartPoint();

  if (!start) return;

  const requestId = ++state.hideSeek.routeRequestId;
  state.hideSeek.routeLoading = true;

  try {
    const route = await fetchRoadRoute(start, state.hideSeek.zonePoint);

    if (
      requestId !== state.hideSeek.routeRequestId ||
      state.hideSeek.phase !== "escape" ||
      state.hideSeek.viewerRole !== "sheep"
    ) {
      return;
    }

    drawHideSeekRoute(route.coords);

    state.hideSeek.routeKey = routeKey;
    state.hideSeek.lastRouteStartPoint = start;
    state.hideSeek.lastRouteAt = Date.now();
  } catch (error) {
    console.error(error);
  } finally {
    if (requestId === state.hideSeek.routeRequestId) {
      state.hideSeek.routeLoading = false;
    }
  }
}

function drawHideSeekRoute(coords) {
  clearHideSeekRoute({ keepRequest: true });

  if (
    !state.hideSeek.layer ||
    !Array.isArray(coords) ||
    coords.length < 2
  ) {
    return;
  }

  state.hideSeek.routeHalo = L.polyline(coords, {
    color: "#eef7ff",
    weight: 9,
    opacity: 0.7,
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  }).addTo(state.hideSeek.layer);

  state.hideSeek.routeLine = L.polyline(coords, {
    color: HIDE_SEEK_SHEEP_COLOUR,
    weight: 5,
    opacity: 1,
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  }).addTo(state.hideSeek.layer);
}

function clearHideSeekRoute(options = {}) {
  const { keepRequest = false } = options;

  if (!keepRequest) {
    state.hideSeek.routeRequestId += 1;
    state.hideSeek.routeLoading = false;
  }

  if (state.hideSeek.routeHalo && state.hideSeek.layer) {
    state.hideSeek.layer.removeLayer(state.hideSeek.routeHalo);
  }

  if (state.hideSeek.routeLine && state.hideSeek.layer) {
    state.hideSeek.layer.removeLayer(state.hideSeek.routeLine);
  }

  state.hideSeek.routeHalo = null;
  state.hideSeek.routeLine = null;
  state.hideSeek.routeKey = "";
  state.hideSeek.lastRouteStartPoint = null;
  state.hideSeek.lastRouteAt = 0;
}

function maybeUpdateHideSeekRoute(point) {
  if (
    state.hideSeek.viewerRole !== "sheep" ||
    state.hideSeek.phase !== "escape" ||
    !state.hideSeek.zonePoint ||
    !state.hideSeek.routeLine ||
    !state.hideSeek.lastRouteStartPoint ||
    Number(point?.accuracy) > MAX_GPS_ACCURACY_M
  ) {
    return;
  }

  const now = Date.now();

  if (
    now - state.hideSeek.lastRouteAt <
      HIDE_SEEK_ROUTE_MIN_REROUTE_TIME_MS
  ) {
    return;
  }

  if (
    haversine(point, state.hideSeek.lastRouteStartPoint) <
      HIDE_SEEK_ROUTE_REROUTE_DISTANCE_M
  ) {
    return;
  }

  void ensureHideSeekRoute({ force: true });
}

function hideSeekErrorMessage(error) {
  const message = String(error?.message || error || "");

  if (!message) {
    return "Hide & Seek had a problem";
  }

  return message.replace(/^Error:\s*/i, "");
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

  stopMultiplayerLocationWatch();
  renderMultiplayerState();

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

  const newlyDiscoveredSegments = Array.from(state.tripUnlocked)
    .map((segmentId) => state.savedSegments[segmentId])
    .filter(Boolean);

  void syncMySharedRoads({
    segments: newlyDiscoveredSegments,
    quiet: true,
    reason: "finish-drive"
  });

    if (hasActiveMultiplayerRoom()) {
    startMultiplayerLocationWatch();
    renderMultiplayerState();
  }

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
  void maybeSendMultiplayerLocation(point);

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
  maybeUpdateHideSeekRoute(point);
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
      pane: "userLocationPane",
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
      pane: "userAccuracyPane",
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

  applyHideSeekOwnMarkerStyle();
   
   state.accuracyCircle?.bringToFront();
  state.userMarker?.bringToFront();
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

        // Quiet mode: roads turn orange silently while driving.

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
  const confirmed = confirm(
    "Reset all discovered roads saved on this device? Any shared friend-map copy will also be removed, but your account and friends will stay unchanged."
  );

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

  state.sharedRoadSync.hashCache.clear();
  removeSharedRoadSyncMetaForCurrentUser();
  void clearMySharedRoads({ quiet: true, reason: "reset" });

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
      await reconcileMySharedRoads({ quiet: true });
      await refreshFriendData({ quiet: true });
        } else {
      stopMultiplayerMode({
        clearRoom: true
      });

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
    await reconcileMySharedRoads({ quiet: true });
    await refreshFriendData({ quiet: true });
    } else {
    stopMultiplayerMode({
      clearRoom: true
    });

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

  const message = String(error.message || "").toLowerCase();

  if (message.includes("email rate limit")) {
    setAuthMessage(
      "Too many confirmation emails were requested. Wait a while, then try again. If you already created the account, check your email or spam folder for the confirmation link.",
      "error"
    );
  } else {
    setAuthMessage(error.message || "Could not create account.", "error");
  }

  renderAuthState();
  return;
}

  state.auth.session = data?.session || null;
  state.auth.user = data?.user || data?.session?.user || null;

  if (state.auth.session && state.auth.user) {
    await ensureRoadProfile({ quiet: false });
    await maybeSyncProfileStats({ force: true, quiet: true });
    await reconcileMySharedRoads({ quiet: true });
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
    await reconcileMySharedRoads({ quiet: true });
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

  if (hasActiveMultiplayerRoom()) {
    await leaveMultiplayerRoom({
      quiet: true
    });
  }

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

  const previousValue = state.auth.profile
    ? Boolean(state.auth.profile[field])
    : Boolean(state.friendSettings[localKey]);

  if (!state.auth.client || !state.auth.user || !state.auth.profile) {
    state.friendSettings[localKey] = previousValue;
    applyFriendSettingsToUI();
    showToast("Create a Road Profile before sharing");
    return;
  }

  if (field === "show_map" && checked && !previousValue) {
    state.friendSettings.showMap = false;
    state.auth.profile.show_map = false;
    applyFriendSettingsToUI();

    const confirmed = await showMapShareConfirmation();

    if (!confirmed) {
      applyFriendSettingsToUI();
      return;
    }
  }

  state.friendSettings[localKey] = checked;
  state.auth.profile[field] = checked;
  applyFriendSettingsToUI();

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

    state.friendSettings[localKey] = previousValue;
    state.auth.profile[field] = previousValue;

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

  if (field === "show_map") {
    if (checked) {
      const previousMeta = getSharedRoadSyncMetaForCurrentUser() || {};

      setSharedRoadSyncMetaForCurrentUser({
        ...previousMeta,
        pendingReplace: true
      });

      const synced = await syncMySharedRoads({
        replace: true,
        force: true,
        quiet: true,
        reason: "sharing-enabled"
      });

      showToast(
        synced
          ? "Map sharing on"
          : "Map sharing is on. Road sync will retry when online"
      );
    } else {
      const cleared = await clearMySharedRoads({
        quiet: true,
        reason: "sharing-disabled"
      });

      showToast(
        cleared
          ? "Map sharing off"
          : "Map sharing is off. Server cleanup will retry"
      );
    }
         return;
  }

  showToast(checked ? "Road Profile sharing on" : "Road Profile sharing off");
}

function showMapShareConfirmation() {
  if (!els.mapShareConfirmOverlay) {
    return Promise.resolve(false);
  }

  if (state.sharedRoadSync.confirmationResolve) {
    state.sharedRoadSync.confirmationResolve(false);
  }

  els.mapShareConfirmOverlay.classList.remove("hidden");
  els.mapShareConfirmOverlay.setAttribute("aria-hidden", "false");

  setTimeout(() => {
    els.confirmMapShareBtn?.focus();
  }, 0);

  return new Promise((resolve) => {
    state.sharedRoadSync.confirmationResolve = resolve;
  });
}

function resolveMapShareConfirmation(confirmed) {
  els.mapShareConfirmOverlay?.classList.add("hidden");
  els.mapShareConfirmOverlay?.setAttribute("aria-hidden", "true");

  const resolve = state.sharedRoadSync.confirmationResolve;
  state.sharedRoadSync.confirmationResolve = null;

  if (resolve) {
    resolve(Boolean(confirmed));
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
  const sharingBusy =
    Boolean(state.sharedRoadSync.syncing) ||
    Boolean(state.sharedRoadSync.clearing);

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
      element.disabled = loading || submitting || sharingBusy;
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
  renderMultiplayerState();
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
  state.friends.outgoingRequests = [];
  state.friends.acceptedFriends = [];

  state.friends.loadingRequests = false;
  state.friends.loadingOutgoingRequests = false;
  state.friends.loadingFriends = false;

  state.friends.sendingRequest = false;

  state.friends.respondingRequestId = null;
  state.friends.respondingAction = null;

  state.friends.cancellingOutgoingRequestId = null;
  state.friends.removingFriendId = null;

  state.friends.nicknames.clear();
  state.friends.loadingNicknames = false;
  state.friends.nicknameEditorOpen = false;
  state.friends.nicknameRequestFriendId = null;

  closeFriendFullMap();
  clearActiveFriendMapData({ keepActiveFriend: false });

  state.statsSync.syncing = false;
  state.statsSync.lastSyncAt = 0;
  state.statsSync.lastPayloadKey = "";

  state.sharedRoadSync.syncing = false;
  state.sharedRoadSync.clearing = false;
  state.sharedRoadSync.activeUserId = null;
  state.sharedRoadSync.privateCleanupChecked = false;
  state.sharedRoadSync.hashCache.clear();
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
    loadOutgoingFriendRequests({ quiet: true }),
    loadFriends({ quiet: true }),
    loadFriendNicknames({ quiet: true })
  ]);

  pruneFriendNicknamesToAcceptedFriends();

  const activeFriend = getActiveFriend();

  if (activeFriend) {
    renderFriendProfile(activeFriend);
  }

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
    Boolean(state.friends.respondingRequestId) ||
    Boolean(state.friends.cancellingOutgoingRequestId) ||
    Boolean(state.friends.removingFriendId) ||
    Boolean(state.friends.nicknameRequestFriendId);

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

  renderIncomingFriendRequests(signedIn);
  renderOutgoingFriendRequests(signedIn);
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

async function loadOutgoingFriendRequests(options = {}) {
  const { quiet = false } = options;

  if (!state.auth.client || !state.auth.user) {
    state.friends.outgoingRequests = [];
    renderFriendsList();
    return [];
  }

  if (state.friends.loadingOutgoingRequests) {
    return state.friends.outgoingRequests;
  }

  state.friends.loadingOutgoingRequests = true;

  if (!quiet) {
    renderFriendsList();
  }

  const { data, error } = await state.auth.client.rpc(
    "get_outgoing_friend_requests"
  );

  state.friends.loadingOutgoingRequests = false;

  if (error) {
    console.error(error);

    if (!quiet) {
      showToast(friendRequestErrorMessage(error));
    }

    renderFriendsList();
    return state.friends.outgoingRequests;
  }

  state.friends.outgoingRequests = Array.isArray(data)
    ? data
    : [];

  renderFriendsList();

  return state.friends.outgoingRequests;
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

async function loadFriendNicknames(options = {}) {
  const { quiet = false } = options;

  if (!state.auth.client || !state.auth.user) {
    state.friends.nicknames.clear();
    state.friends.loadingNicknames = false;
    renderFriendsList();
    return state.friends.nicknames;
  }

  if (state.friends.loadingNicknames) {
    return state.friends.nicknames;
  }

  state.friends.loadingNicknames = true;

  if (!quiet) {
    renderFriendsList();
  }

  const { data, error } = await state.auth.client.rpc(
    "get_my_friend_nicknames"
  );

  state.friends.loadingNicknames = false;

  if (error) {
    console.error(error);

    if (!quiet) {
      showToast(friendNicknameErrorMessage(error));
    }

    renderFriendsList();
    return state.friends.nicknames;
  }

  const nextNicknames = new Map();
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? [data]
      : [];

  for (const row of rows) {
    const friendId = String(
      row?.friend_id ||
      row?.id ||
      row?.p_friend_id ||
      ""
    );

    const nickname = normaliseFriendNickname(
      row?.nickname ??
      row?.friend_nickname ??
      row?.p_nickname ??
      ""
    );

    if (friendId && nickname) {
      nextNicknames.set(friendId, nickname);
    }
  }

  state.friends.nicknames = nextNicknames;

  renderFriendsList();

  const activeFriend = getActiveFriend();

  if (activeFriend) {
    renderFriendProfile(activeFriend);
  }

  return state.friends.nicknames;
}

async function acceptIncomingFriendRequest(requestId) {
  await respondToIncomingFriendRequest("accept", requestId);
}

async function cancelOutgoingFriendRequest(requestId) {
  if (!state.auth.client || !state.auth.user) {
    showToast("Sign in to manage friend requests");
    return;
  }

  if (!requestId) {
    showToast("Friend request was missing an ID");
    return;
  }

  if (state.friends.cancellingOutgoingRequestId) {
    return;
  }

  const request =
    state.friends.outgoingRequests.find((item) => {
      return String(item.request_id || "") === String(requestId);
    }) || null;

  const username =
    request?.receiver_username ||
    "this user";

  const confirmed = confirm(
    `Cancel your friend request to ${username}?`
  );

  if (!confirmed) {
    return;
  }

  state.friends.cancellingOutgoingRequestId = requestId;
  renderFriendsList();

  const { data, error } = await state.auth.client.rpc(
         "cancel_outgoing_friend_request",
    {
      target_request_id: requestId
    }
  );

  state.friends.cancellingOutgoingRequestId = null;

  if (error) {
    console.error(error);
    showToast(friendRequestErrorMessage(error));
    renderFriendsList();
    return;
  }

  if (data !== true) {
    await refreshFriendData({
      quiet: true
    });

    showToast("That request is no longer pending");
    return;
  }

  state.friends.outgoingRequests =
    state.friends.outgoingRequests.filter((item) => {
      return String(item.request_id || "") !== String(requestId);
    });

  renderFriendsList();

  await refreshFriendData({
    quiet: true
  });

  showToast("Friend request cancelled");
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

function renderOutgoingFriendRequests(signedIn) {
  if (!els.outgoingRequestsList) {
    return;
  }

  if (!signedIn) {
    els.outgoingRequestsList.innerHTML =
      '<div class="empty-state">Sign in to see requests you have sent.</div>';
    return;
  }

  if (state.friends.loadingOutgoingRequests) {
    els.outgoingRequestsList.innerHTML =
      '<div class="empty-state">Loading outgoing requests...</div>';
    return;
  }

  const requests =
    state.friends.outgoingRequests || [];

  if (requests.length === 0) {
    els.outgoingRequestsList.innerHTML =
      '<div class="empty-state">No outgoing friend requests.</div>';
    return;
  }

  els.outgoingRequestsList.innerHTML = requests
    .map((request) => renderOutgoingFriendRequestRow(request))
    .join("");
}

function renderOutgoingFriendRequestRow(request) {
  const requestId = String(
    request.request_id ||
    ""
  );

  const username =
    request.receiver_username ||
    "Road Profile";

  const friendCode =
    request.receiver_friend_code ||
    "Friend code hidden";

  const initial =
    username.slice(0, 1).toUpperCase() ||
    "R";

  const isCancelling =
    state.friends.cancellingOutgoingRequestId === requestId;

  return `
    <div
      class="friend-row request-row"
      data-request-id="${escapeHtml(requestId)}"
    >
      <div class="friend-avatar">
        ${escapeHtml(initial)}
      </div>

      <div class="friend-main">
        <div class="friend-name">
          ${escapeHtml(username)}
        </div>

        <div class="friend-sub">
          ${escapeHtml(friendCode)} • Pending
        </div>
      </div>

      <div class="request-actions">
        <button
          class="request-action-btn decline-request-btn"
          type="button"
          data-outgoing-action="cancel"
          data-request-id="${escapeHtml(requestId)}"
          ${isCancelling ? "disabled" : ""}
        >${isCancelling ? "Cancelling..." : "Cancel"}</button>
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
  const nickname = getFriendNickname(friendId);
  const displayName = nickname || username;
  const friendCode = friend.friend_code || "Friend code hidden";
  const initial = displayName.slice(0, 1).toUpperCase() || "R";

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

  const subtitle = nickname
    ? `${username} • ${friendCode} • ${profileStatus} • ${mapStatus}${syncedText}`
    : `${friendCode} • ${profileStatus} • ${mapStatus}${syncedText}`;

  return `
    <button
      class="friend-row real-friend-row${nickname ? " friend-row-has-nickname" : ""}"
      type="button"
      data-friend-id="${escapeHtml(friendId)}"
    >
      <div class="friend-avatar">${escapeHtml(initial)}</div>

      <div class="friend-main">
        <div class="friend-name">${escapeHtml(displayName)}</div>
        <div class="friend-sub">${escapeHtml(subtitle)}</div>
      </div>

      <div class="friend-score">
        <strong>${escapeHtml(score)}</strong>
        <span>${escapeHtml(scoreSub)}</span>
      </div>
    </button>
  `;
}

function pruneFriendNicknamesToAcceptedFriends() {
  const acceptedIds = new Set(
    state.friends.acceptedFriends.map((friend) => {
      return String(friend.friend_id || friend.id || "");
    })
  );

  for (const friendId of state.friends.nicknames.keys()) {
    if (!acceptedIds.has(friendId)) {
      state.friends.nicknames.delete(friendId);
    }
  }
}

function getFriendNickname(friendId) {
  const id = String(friendId || "");
  return state.friends.nicknames.get(id) || "";
}

function getFriendDisplayName(friend) {
  if (!friend) return "Friend";

  const friendId = String(friend.friend_id || friend.id || "");
  return getFriendNickname(friendId) || friend.username || "Road Profile";
}

function normaliseFriendNickname(value) {
  return Array.from(String(value || "").trim())
    .slice(0, FRIEND_NICKNAME_MAX_LENGTH)
    .join("");
}

function friendNicknameLength(value) {
  return Array.from(String(value || "")).length;
}

function enforceFriendNicknameLimit() {
  if (!els.friendNicknameInput) return;

  const characters = Array.from(els.friendNicknameInput.value || "");

  if (characters.length > FRIEND_NICKNAME_MAX_LENGTH) {
    els.friendNicknameInput.value = characters
      .slice(0, FRIEND_NICKNAME_MAX_LENGTH)
      .join("");
  }
}

function updateFriendNameCharacterCount() {
  if (!els.friendNameCharacterCount) return;

  const count = friendNicknameLength(els.friendNicknameInput?.value || "");
  els.friendNameCharacterCount.textContent =
    `${count} / ${FRIEND_NICKNAME_MAX_LENGTH}`;
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

  clearActiveFriendMapData({ keepActiveFriend: false });

  state.activeFriendId = String(friend.friend_id || friend.id || "");
  state.friendMap.friendId = state.activeFriendId;
  state.friends.nicknameEditorOpen = false;

  renderFriendProfile(friend);
  showFriendProfileView();

  void refreshActiveFriendProfileAndMap(state.activeFriendId);
}

function renderFriendProfile(friend) {
  if (!friend) return;

  const friendId = String(friend.friend_id || friend.id || "");
  const username = friend.username || "Road Profile";
  const nickname = getFriendNickname(friendId);
  const displayName = nickname || username;
  const friendCode = friend.friend_code || "Friend code hidden";
  const initial = displayName.slice(0, 1).toUpperCase() || "R";
  const profileShared = Boolean(friend.show_profile);
  const mapShared = Boolean(friend.show_map);
  const stats = normaliseFriendStats(friend);
  const mapStateMatches = state.friendMap.friendId === friendId;
  const mapLoading = mapStateMatches && state.friendMap.loading;

  if (els.friendProfileAvatar) {
    els.friendProfileAvatar.textContent = initial;
  }

  if (els.friendProfileName) {
    els.friendProfileName.textContent = displayName;
  }

  if (els.friendNicknameBadge) {
    els.friendNicknameBadge.classList.toggle("hidden", !nickname);
  }

  if (els.friendProfileHandle) {
    const identityPrefix = nickname
      ? `${username} • ${friendCode}`
      : friendCode;

    if (!profileShared) {
      els.friendProfileHandle.textContent = `${identityPrefix} • profile private`;
    } else if (stats.hasStats) {
      els.friendProfileHandle.textContent = `${identityPrefix} • ${formatSyncedTime(stats.lastSyncedAt)}`;
    } else {
      els.friendProfileHandle.textContent = `${identityPrefix} • not synced yet`;
    }
  }

  renderFriendNameControls(friend);
  updateActiveFriendMapTitle(friend);

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
    els.openFriendMapBtn.disabled = !mapShared || mapLoading;
  }

  if (els.friendMapOpenLabel) {
    if (!mapShared) {
      els.friendMapOpenLabel.textContent = "Private";
    } else if (mapLoading) {
      els.friendMapOpenLabel.textContent = "Loading…";
    } else if (mapStateMatches && state.friendMap.error) {
      els.friendMapOpenLabel.textContent = "Retry →";
    } else {
      els.friendMapOpenLabel.textContent = "Open →";
    }
  }

  if (els.removeFriendBtn) {
    const isRemoving =
      state.friends.removingFriendId === state.activeFriendId;

    els.removeFriendBtn.disabled = isRemoving;
    els.removeFriendBtn.textContent = isRemoving
      ? "Removing..."
      : "Remove friend";
  }

  renderFriendPreviewSvg(friend);
}

function renderFriendNameControls(friend) {
  if (!friend) return;

  const friendId = String(friend.friend_id || friend.id || "");
  const nickname = getFriendNickname(friendId);
  const requestRunning = Boolean(state.friends.nicknameRequestFriendId);
  const editorOpen = Boolean(state.friends.nicknameEditorOpen);

  els.friendNameControls?.classList.remove("hidden");
  els.friendNameEditor?.classList.toggle("hidden", !editorOpen);

  if (els.changeFriendNameBtn) {
    els.changeFriendNameBtn.disabled = requestRunning;
    els.changeFriendNameBtn.textContent = nickname
      ? "Change private name"
      : "Change name";
    els.changeFriendNameBtn.setAttribute(
      "aria-expanded",
      editorOpen ? "true" : "false"
    );
  }

  if (editorOpen && els.friendNicknameInput) {
    const expectedValue = nickname;

    if (document.activeElement !== els.friendNicknameInput) {
      els.friendNicknameInput.value = expectedValue;
    }
  }

  if (els.friendNicknameInput) {
         els.friendNicknameInput.disabled = requestRunning;
  }

  if (els.saveFriendNameBtn) {
    const saving = state.friends.nicknameRequestFriendId === friendId;
    els.saveFriendNameBtn.disabled = requestRunning;
    els.saveFriendNameBtn.textContent = saving
      ? "Saving..."
      : "Save name";
  }

  if (els.cancelFriendNameBtn) {
    els.cancelFriendNameBtn.disabled = requestRunning;
  }

  if (els.clearFriendNameBtn) {
    const clearing = state.friends.nicknameRequestFriendId === friendId;
    els.clearFriendNameBtn.classList.toggle("hidden", !nickname);
    els.clearFriendNameBtn.disabled = requestRunning;
    els.clearFriendNameBtn.textContent = clearing
      ? "Updating..."
      : "Use original username";
  }

  updateFriendNameCharacterCount();
}

function openFriendNameEditor() {
  const friend = getActiveFriend();

  if (!friend) {
    showToast("Open an accepted friend first");
    return;
  }

  if (state.friends.nicknameRequestFriendId) {
    return;
  }

  const friendId = String(friend.friend_id || friend.id || "");

  state.friends.nicknameEditorOpen = true;

  if (els.friendNicknameInput) {
    els.friendNicknameInput.value = getFriendNickname(friendId);
  }

  renderFriendProfile(friend);
  updateFriendNameCharacterCount();

  setTimeout(() => {
    els.friendNicknameInput?.focus();
    els.friendNicknameInput?.select();
  }, 0);
}

function cancelFriendNameEditor() {
  if (state.friends.nicknameRequestFriendId) {
    return;
  }

  state.friends.nicknameEditorOpen = false;

  const friend = getActiveFriend();

  if (friend) {
    renderFriendProfile(friend);
  }
}

async function saveActiveFriendNickname() {
  if (!state.auth.client || !state.auth.user) {
    showToast("Sign in to change a friend name");
    return;
  }

  const friend = getActiveFriend();

  if (!friend) {
    showToast("Friend could not be found");
    return;
  }

  if (state.friends.nicknameRequestFriendId) {
    return;
  }

  enforceFriendNicknameLimit();

  const rawNickname = String(els.friendNicknameInput?.value || "").trim();
  const nicknameLength = friendNicknameLength(rawNickname);

  if (!rawNickname) {
    showToast("Enter a private name");
    return;
  }

  if (nicknameLength > FRIEND_NICKNAME_MAX_LENGTH) {
    showToast("Private name must be 40 characters or fewer");
    return;
  }

  const friendId = String(friend.friend_id || friend.id || "");
  const nickname = normaliseFriendNickname(rawNickname);

  state.friends.nicknameRequestFriendId = friendId;
  renderFriendsList();
  renderFriendProfile(friend);

  const { error } = await state.auth.client.rpc(
    "set_friend_nickname",
    {
      p_friend_id: friendId,
      p_nickname: nickname
    }
  );

  state.friends.nicknameRequestFriendId = null;

  if (error) {
    console.error(error);
    showToast(friendNicknameErrorMessage(error));
    renderFriendsList();
    renderFriendProfile(friend);
    return;
  }

  state.friends.nicknames.set(friendId, nickname);
  state.friends.nicknameEditorOpen = false;

  renderFriendsList();
  renderFriendProfile(friend);
  showToast(`Private name saved as ${nickname}`);
}

async function clearActiveFriendNickname() {
  if (!state.auth.client || !state.auth.user) {
    showToast("Sign in to change a friend name");
    return;
  }

  const friend = getActiveFriend();

  if (!friend) {
    showToast("Friend could not be found");
    return;
  }

  if (state.friends.nicknameRequestFriendId) {
    return;
  }

  const friendId = String(friend.friend_id || friend.id || "");

  if (!getFriendNickname(friendId)) {
    state.friends.nicknameEditorOpen = false;
    renderFriendProfile(friend);
    return;
  }

  state.friends.nicknameRequestFriendId = friendId;
  renderFriendsList();
  renderFriendProfile(friend);

  const { error } = await state.auth.client.rpc(
    "clear_friend_nickname",
    {
      p_friend_id: friendId
    }
  );

  state.friends.nicknameRequestFriendId = null;

  if (error) {
    console.error(error);
    showToast(friendNicknameErrorMessage(error));
    renderFriendsList();
    renderFriendProfile(friend);
    return;
  }

  state.friends.nicknames.delete(friendId);
  state.friends.nicknameEditorOpen = false;

  renderFriendsList();
  renderFriendProfile(friend);
  showToast("Original username restored");
}

function updateActiveFriendMapTitle(friend = getActiveFriend()) {
  if (!els.friendMapTitle || !friend) return;

  els.friendMapTitle.textContent = `${getFriendDisplayName(friend)}’s Map`;
}

function friendNicknameErrorMessage(error) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("40") || message.includes("too long")) {
    return "Private name must be 40 characters or fewer";
  }

  if (message.includes("not friends") || message.includes("friendship")) {
    return "That friendship is no longer available";
  }

  if (message.includes("function") && message.includes("does not exist")) {
    return "Nickname SQL has not been installed yet";
  }

  return error?.message || "Could not update private name";
}

async function refreshActiveFriendProfileAndMap(friendId) {
  const expectedFriendId = String(friendId || "");

  await Promise.all([
    loadFriends({ quiet: true }),
    loadFriendNicknames({ quiet: true })
  ]);

  if (state.activeFriendId !== expectedFriendId) {
    return;
  }

  const friend = getFriendById(expectedFriendId);

  if (!friend) {
    showToast("That friendship is no longer available");
    showFriendsListView();
    return;
  }

  renderFriendProfile(friend);

  if (!friend.show_map) {
    clearActiveFriendMapData({ keepActiveFriend: true });
    state.friendMap.friendId = expectedFriendId;
    renderFriendProfile(friend);
    return;
  }

  await loadFriendSharedRoads(expectedFriendId, { force: true });
}

async function loadFriendSharedRoads(friendId, options = {}) {
  const { force = false } = options;
  const id = String(friendId || "");
  const friend = getFriendById(id);

  if (!state.auth.client || !state.auth.user || !friend || !friend.show_map) {
    clearActiveFriendMapData({ keepActiveFriend: true });
    state.friendMap.friendId = id;
    renderFriendProfile(friend);
    return false;
  }

  if (
    !force &&
    state.friendMap.friendId === id &&
    state.friendMap.loaded &&
    !state.friendMap.error
  ) {
    return true;
  }

  const requestId = ++state.friendMap.requestId;

  state.friendMap.friendId = id;
  state.friendMap.roads = [];
  state.friendMap.loading = true;
  state.friendMap.loaded = false;
  state.friendMap.error = "";

  renderFriendProfile(friend);

  const roads = [];
  let afterHash = null;

  try {
    for (let page = 0; page < SHARED_ROAD_MAX_DOWNLOAD_PAGES; page++) {
      const { data, error } = await state.auth.client.rpc(
        "get_friend_shared_roads",
        {
          p_friend_id: id,
          p_after_hash: afterHash,
          p_limit: SHARED_ROAD_DOWNLOAD_PAGE_SIZE
        }
      );

      if (
        requestId !== state.friendMap.requestId ||
        state.activeFriendId !== id
      ) {
        return false;
      }

      if (error) {
        throw error;
      }

      const pageRows = (Array.isArray(data) ? data : [])
        .map(normaliseDownloadedSharedRoad)
        .filter(Boolean);

      roads.push(...pageRows);

      if (pageRows.length < SHARED_ROAD_DOWNLOAD_PAGE_SIZE) {
        break;
      }

      afterHash = pageRows[pageRows.length - 1]?.shared_road_hash || null;

      if (!afterHash) {
        break;
      }

      if (page === SHARED_ROAD_MAX_DOWNLOAD_PAGES - 1) {
        throw new Error("Friend map is too large to load safely");
      }
    }

    state.friendMap.roads = roads;
    state.friendMap.loading = false;
    state.friendMap.loaded = true;
    state.friendMap.error = "";

    renderFriendProfile(getFriendById(id));
    return true;
  } catch (error) {
    console.error(error);

    if (
      requestId !== state.friendMap.requestId ||
      state.activeFriendId !== id
    ) {
      return false;
    }

    state.friendMap.roads = [];
    state.friendMap.loading = false;
    state.friendMap.loaded = false;
    state.friendMap.error =
      error?.message || "Could not load this friend map";

    renderFriendProfile(getFriendById(id));
    return false;
  }
}

function normaliseDownloadedSharedRoad(row) {
  const hash = String(row?.shared_road_hash || "").toLowerCase();
  const coords = normaliseSharedRoadCoords(row?.coordinates);

  if (!/^[0-9a-f]{64}$/.test(hash) || !coords) {
    return null;
  }

  return {
    shared_road_hash: hash,
    coordinates: coords
  };
}

function renderFriendPreviewSvg(friend) {
  if (!els.friendMapPreviewSvg) return;

  els.friendMapPreviewSvg.innerHTML = "";

  if (!friend?.show_map) {
    appendFriendPreviewStatus("Map overview private");
    return;
  }

  if (state.friendMap.friendId !== state.activeFriendId) {
    appendFriendPreviewStatus("Preparing map…");
    return;
  }

  if (state.friendMap.loading) {
    appendFriendPreviewStatus("Loading discovered roads…");
    return;
  }

  if (state.friendMap.error) {
    appendFriendPreviewStatus("Could not load map");
    return;
  }

  if (!state.friendMap.loaded) {
    appendFriendPreviewStatus("Preparing map…");
    return;
  }

  if (state.friendMap.roads.length === 0) {
    appendFriendPreviewStatus("No shared roads yet");
    return;
  }

  const pathData = buildFriendPreviewPath(state.friendMap.roads, 320, 190, 14);

  if (!pathData) {
    appendFriendPreviewStatus("No shared roads yet");
    return;
  }

  const path = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );

  path.setAttribute("d", pathData);
  path.setAttribute("vector-effect", "non-scaling-stroke");
  path.setAttribute("aria-hidden", "true");

  els.friendMapPreviewSvg.appendChild(path);
}

function appendFriendPreviewStatus(message) {
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
  text.textContent = message;

  els.friendMapPreviewSvg.appendChild(text);
}

function buildFriendPreviewPath(roads, width, height, padding) {
  const validRoads = roads
    .map((road) => normaliseSharedRoadCoords(road?.coordinates))
    .filter(Boolean);

  if (validRoads.length === 0) return "";

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const coords of validRoads) {
    for (const [lat, lng] of coords) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
  }

  if (maxLat - minLat < 0.000001) {
    minLat -= 0.0005;
    maxLat += 0.0005;
  }

  if (maxLng - minLng < 0.000001) {
    minLng -= 0.0005;
    maxLng += 0.0005;
  }

  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);

  const project = ([lat, lng]) => {
    const x = padding + ((lng - minLng) / (maxLng - minLng)) * innerWidth;
    const y = height - padding - ((lat - minLat) / (maxLat - minLat)) * innerHeight;

    return [x.toFixed(2), y.toFixed(2)];
  };

  return validRoads
    .map((coords) => {
      const [a, b] = coords;
      const [x1, y1] = project(a);
      const [x2, y2] = project(b);
      return `M${x1} ${y1}L${x2} ${y2}`;
    })
    .join(" ");
}

async function openFriendFullMap() {
  const activeFriendId = String(state.activeFriendId || "");

  if (!activeFriendId) {
    showToast("Open an accepted friend first");
    return;
  }

  await loadFriends({ quiet: true });

  if (state.activeFriendId !== activeFriendId) {
    return;
  }

  const friend = getFriendById(activeFriendId);

  if (!friend) {
    showToast("That friendship is no longer available");
    showFriendsListView();
    return;
  }

  if (!friend.show_map) {
    clearActiveFriendMapData({ keepActiveFriend: true });
    state.friendMap.friendId = activeFriendId;
    renderFriendProfile(friend);
    showToast("This friend has map overview sharing off");
    return;
  }

  updateActiveFriendMapTitle(friend);

  els.friendMapOverlay?.classList.remove("hidden");
  els.friendMapOverlay?.setAttribute("aria-hidden", "false");
  setFriendFullMapStatus("Loading discovered roads…");

  const loaded = await loadFriendSharedRoads(activeFriendId, { force: true });

  if (
    !loaded ||
    state.activeFriendId !== activeFriendId ||
    els.friendMapOverlay?.classList.contains("hidden")
  ) {
    if (state.friendMap.error) {
      setFriendFullMapStatus("Could not load this friend map");
    }
    return;
  }

  ensureFriendFullMap();
  drawFriendFullMapRoads(state.friendMap.roads);
}

function ensureFriendFullMap() {
  if (state.friendMap.fullMap || !window.L || !els.friendFullMap) {
    return;
  }

  state.friendMap.fullMap = L.map(els.friendFullMap, {
    zoomControl: true,
    preferCanvas: true,
    attributionControl: false,
    tap: true
  }).setView(DEFAULT_CENTER, 4);

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 20,
      crossOrigin: true,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
    }
  ).addTo(state.friendMap.fullMap);

  state.friendMap.fullRenderer = L.canvas({ padding: 0.5 });

  setTimeout(() => {
    state.friendMap.fullMap?.invalidateSize(true);
  }, 80);
}

function drawFriendFullMapRoads(roads) {
  const map = state.friendMap.fullMap;

  if (!map) return;

  if (state.friendMap.fullRoadLayer) {
    map.removeLayer(state.friendMap.fullRoadLayer);
    state.friendMap.fullRoadLayer = null;
  }

  const latLngs = roads
    .map((road) => normaliseSharedRoadCoords(road?.coordinates))
    .filter(Boolean);

  if (latLngs.length === 0) {
    map.setView(DEFAULT_CENTER, 4);
    setFriendFullMapStatus("No shared roads yet");
    return;
  }

  state.friendMap.fullRoadLayer = L.polyline(latLngs, {
    renderer: state.friendMap.fullRenderer,
    color: ROAD_ORANGE,
    weight: 5,
    opacity: 1,
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  }).addTo(map);

  const bounds = state.friendMap.fullRoadLayer.getBounds();

  if (bounds.isValid()) {
         map.fitBounds(bounds, {
      padding: [28, 28],
      maxZoom: 17
    });
  }

  setFriendFullMapStatus("");
}

function setFriendFullMapStatus(message) {
  if (!els.friendFullMapStatus) return;

  if (!message) {
    els.friendFullMapStatus.textContent = "";
    els.friendFullMapStatus.classList.add("hidden");
    return;
  }

  els.friendFullMapStatus.textContent = message;
  els.friendFullMapStatus.classList.remove("hidden");
}

function destroyFriendFullMap() {
  if (state.friendMap.fullMap) {
    state.friendMap.fullMap.remove();
  }

  state.friendMap.fullMap = null;
  state.friendMap.fullRoadLayer = null;
  state.friendMap.fullRenderer = null;
  setFriendFullMapStatus("");
}

function closeFriendFullMap() {
  destroyFriendFullMap();

  els.friendMapOverlay?.classList.add("hidden");
  els.friendMapOverlay?.setAttribute("aria-hidden", "true");
}

function clearActiveFriendMapData(options = {}) {
  const { keepActiveFriend = true } = options;

  state.friendMap.requestId++;
  state.friendMap.friendId = keepActiveFriend
    ? String(state.activeFriendId || "")
    : null;
  state.friendMap.roads = [];
  state.friendMap.loading = false;
  state.friendMap.loaded = false;
  state.friendMap.error = "";

  destroyFriendFullMap();

  if (!keepActiveFriend) {
    state.activeFriendId = null;
  }
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

async function removeActiveFriend() {
  if (!state.auth.client || !state.auth.user) {
    showToast("Sign in to remove a friend");
    return;
  }

  const friend = getActiveFriend();

  if (!friend) {
    showToast("Friend could not be found");
    showFriendsListView();
    return;
  }

  const friendId = String(
    friend.friend_id ||
    friend.id ||
    ""
  );

  const displayName = getFriendDisplayName(friend);

  if (!friendId) {
    showToast("Friend ID is missing");
    return;
  }

  if (state.friends.removingFriendId) {
    return;
  }

  const confirmed = confirm(
    `Remove ${displayName} from your friends? Their profile and road progress will not be deleted.`
  );

  if (!confirmed) {
    return;
  }

  state.friends.removingFriendId = friendId;

  if (els.removeFriendBtn) {
    els.removeFriendBtn.disabled = true;
    els.removeFriendBtn.textContent = "Removing...";
  }

  renderFriendsList();

  const { error } = await state.auth.client.rpc(
    "remove_friend",
    {
      friend_id: friendId
    }
  );

  if (error) {
    console.error(error);

    state.friends.removingFriendId = null;

    if (els.removeFriendBtn) {
      els.removeFriendBtn.disabled = false;
      els.removeFriendBtn.textContent = "Remove friend";
    }

    showToast(friendRequestErrorMessage(error));
    renderFriendsList();
    return;
  }

  state.friends.acceptedFriends =
    state.friends.acceptedFriends.filter((item) => {
      const itemFriendId = String(
        item.friend_id ||
        item.id ||
        ""
      );

      return itemFriendId !== friendId;
    });

  state.friends.nicknames.delete(friendId);
  state.friends.removingFriendId = null;
  state.friends.nicknameEditorOpen = false;
  state.activeFriendId = null;

  closeFriendFullMap();
  showFriendsListView();
  renderFriendsList();

  await refreshFriendData({
    quiet: true
  });

  state.friends.nicknames.delete(friendId);
  renderFriendsList();

  showToast(`${displayName} removed`);
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

/* ---------- Checkpoint 7 shared historical roads ---------- */

async function handleOnlineReconnect() {
  showToast("Online");

  if (!state.isRecording) {
    await reconcileMySharedRoads({ quiet: true });
  }

  if (hasActiveMultiplayerRoom()) {
    if (state.currentPoint) {
      void maybeSendMultiplayerLocation(state.currentPoint, {
        force: true
      });
    }

    void pollMultiplayerRoomState();
  }
}

async function reconcileMySharedRoads(options = {}) {
  const { quiet = true } = options;

  if (!state.auth.client || !state.auth.user || !state.auth.profile) {
    return false;
  }

  if (state.isRecording) {
    return false;
  }

  const userId = String(state.auth.user.id || "");

  if (state.sharedRoadSync.activeUserId !== userId) {
    state.sharedRoadSync.activeUserId = userId;
    state.sharedRoadSync.privateCleanupChecked = false;
    state.sharedRoadSync.hashCache.clear();
  }

  if (state.auth.profile.show_map) {
    return syncMySharedRoads({
      force: false,
      quiet,
      reason: "reconcile"
    });
  }

  const meta = getSharedRoadSyncMetaForCurrentUser();

  if (
    meta?.pendingClear ||
    !state.sharedRoadSync.privateCleanupChecked
  ) {
    state.sharedRoadSync.privateCleanupChecked = true;

    return clearMySharedRoads({
      quiet,
      reason: "private-reconcile"
    });
  }

  return true;
}

async function syncMySharedRoads(options = {}) {
  const {
    segments = null,
    replace = false,
    force = false,
    quiet = true,
    reason = "manual"
  } = options;

  if (!state.auth.client || !state.auth.user || !state.auth.profile) {
    return false;
  }

  if (!state.auth.profile.show_map || state.isRecording) {
    return false;
  }

  if (!navigator.onLine) {
    return false;
  }

  if (state.sharedRoadSync.syncing || state.sharedRoadSync.clearing) {
    return false;
  }

  const meta = getSharedRoadSyncMetaForCurrentUser();
  const mustReplace = Boolean(
    replace ||
    !meta ||
    meta.pendingReplace ||
    meta.pendingClear
  );

  const isFullSync = !Array.isArray(segments) || mustReplace;
  const sourceSegments = isFullSync
    ? Object.values(state.savedSegments)
    : segments.filter(Boolean);

  if (!isFullSync && sourceSegments.length === 0) {
    return true;
  }

  let localFingerprint = null;

  if (isFullSync) {
    localFingerprint = await computeLocalRoadDatasetFingerprint();

    if (
      !force &&
      !mustReplace &&
      meta?.fingerprint === localFingerprint &&
      Number(meta?.count) === Object.keys(state.savedSegments).length
    ) {
      return true;
    }
  }

  state.sharedRoadSync.syncing = true;
  renderAuthState();

  try {
    if (mustReplace) {
      const cleared = await clearMySharedRoads({
        quiet: true,
        reason: `${reason}-replace`,
        preserveMeta: true,
        allowWhileSyncing: true
      });

      if (!cleared) {
        throw new Error("Could not replace the previous shared map");
      }
    }

    const seenHashes = new Set();
    let uploadedCount = 0;

    for (
      let startIndex = 0;
      startIndex < sourceSegments.length;
      startIndex += SHARED_ROAD_UPLOAD_BATCH_SIZE
    ) {
      const sourceBatch = sourceSegments.slice(
        startIndex,
        startIndex + SHARED_ROAD_UPLOAD_BATCH_SIZE
      );

      const builtBatch = await Promise.all(
        sourceBatch.map(buildSharedRoadRecord)
      );

      const uploadBatch = builtBatch.filter((record) => {
        if (!record || seenHashes.has(record.shared_road_hash)) {
          return false;
        }

        seenHashes.add(record.shared_road_hash);
        return true;
      });

      if (uploadBatch.length === 0) {
        continue;
      }

      const { data, error } = await state.auth.client.rpc(
        "sync_my_shared_roads",
        {
          roads: uploadBatch
        }
      );

      if (error) {
        throw error;
      }

      uploadedCount += Number(data) || uploadBatch.length;
    }

    localFingerprint =
      localFingerprint ||
      await computeLocalRoadDatasetFingerprint();

    setSharedRoadSyncMetaForCurrentUser({
      fingerprint: localFingerprint,
      count: Object.keys(state.savedSegments).length,
      pendingClear: false,
      pendingReplace: false,
      serverMayHaveRoads: Object.keys(state.savedSegments).length > 0,
      lastSyncAt: new Date().toISOString()
    });

    if (!quiet) {
      showToast(
        uploadedCount > 0
          ? `${uploadedCount.toLocaleString("en-AU")} shared roads synced`
          : "Shared map is up to date"
      );
    }

    return true;
  } catch (error) {
    console.error(error);

    if (!quiet) {
      showToast(sharedRoadErrorMessage(error));
    }

    return false;
  } finally {
    state.sharedRoadSync.syncing = false;
    renderAuthState();
  }
}

async function clearMySharedRoads(options = {}) {
  const {
    quiet = true,
    reason = "manual",
    preserveMeta = false,
    allowWhileSyncing = false
  } = options;

  if (!state.auth.client || !state.auth.user) {
    return false;
  }

  if (
    state.sharedRoadSync.clearing ||
    (state.sharedRoadSync.syncing && !allowWhileSyncing)
  ) {
    return false;
  }

  state.sharedRoadSync.clearing = true;
  renderAuthState();

  try {
    const { error } = await state.auth.client.rpc(
      "clear_my_shared_roads"
    );

    if (error) {
      throw error;
    }

    if (!preserveMeta) {
      removeSharedRoadSyncMetaForCurrentUser();
    }

    if (!quiet) {
      showToast("Shared road copy cleared");
    }

    return true;
  } catch (error) {
    console.error(error);

    const previous = getSharedRoadSyncMetaForCurrentUser() || {};

    setSharedRoadSyncMetaForCurrentUser({
      ...previous,
      pendingClear: true,
      clearReason: reason
    });

    if (!quiet) {
      showToast(sharedRoadErrorMessage(error));
    }

    return false;
  } finally {
    state.sharedRoadSync.clearing = false;
    renderAuthState();
  }
}

async function buildSharedRoadRecord(segment) {
  const coordinates = normaliseSharedRoadCoords(segment?.coords);

  if (!coordinates) {
    return null;
  }

  const canonical = coordinates
    .map(([lat, lng]) => `${lat.toFixed(6)},${lng.toFixed(6)}`)
    .join("|");

  let sharedRoadHash = state.sharedRoadSync.hashCache.get(canonical);

  if (!sharedRoadHash) {
    sharedRoadHash = await sha256Hex(canonical);
    state.sharedRoadSync.hashCache.set(canonical, sharedRoadHash);
  }

  return {
    shared_road_hash: sharedRoadHash,
    coordinates
  };
}

function normaliseSharedRoadCoords(coords) {
  if (!Array.isArray(coords) || coords.length < 2) {
    return null;
  }

  const first = coords[0];
  const last = coords[coords.length - 1];

  if (
    !Array.isArray(first) ||
    !Array.isArray(last) ||
    first.length < 2 ||
    last.length < 2
  ) {
    return null;
  }

  const endpoints = [first, last].map((coord) => [
    Number(Number(coord[0]).toFixed(6)),
    Number(Number(coord[1]).toFixed(6))
  ]);

  if (
    !endpoints.every(([lat, lng]) =>
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    )
  ) {
    return null;
  }

  if (
    endpoints[0][0] === endpoints[1][0] &&
    endpoints[0][1] === endpoints[1][1]
  ) {
    return null;
  }

  endpoints.sort((a, b) => {
    return a[0] - b[0] || a[1] - b[1];
  });

  return endpoints;
}

async function computeLocalRoadDatasetFingerprint() {
  const localSegmentIds = Object.keys(state.savedSegments).sort();
  return sha256Hex(localSegmentIds.join("\n"));
}

async function sha256Hex(value) {
  if (!window.crypto?.subtle) {
    throw new Error("Secure road hashing is unavailable in this browser");
  }

  const digest = await window.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(value))
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getSharedRoadSyncStore() {
  const store = readJson(SHARED_ROAD_SYNC_STATE_KEY, {});

  return store && typeof store === "object" && !Array.isArray(store)
    ? store
    : {};
}

function getSharedRoadSyncMetaForCurrentUser() {
  const userId = String(state.auth.user?.id || "");

  if (!userId) return null;

  const store = getSharedRoadSyncStore();
  const meta = store[userId];

  return meta && typeof meta === "object"
    ? meta
    : null;
}

function setSharedRoadSyncMetaForCurrentUser(meta) {
  const userId = String(state.auth.user?.id || "");

  if (!userId) return;

  const store = getSharedRoadSyncStore();
  store[userId] = meta;
  writeJson(SHARED_ROAD_SYNC_STATE_KEY, store);
}

function removeSharedRoadSyncMetaForCurrentUser() {
  const userId = String(state.auth.user?.id || "");

  if (!userId) return;
     const store = getSharedRoadSyncStore();
  delete store[userId];
  writeJson(SHARED_ROAD_SYNC_STATE_KEY, store);
}

function sharedRoadErrorMessage(error) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("map sharing is off")) {
    return "Map sharing is off";
  }

  if (message.includes("maximum of 500")) {
    return "Shared-road batch was too large";
  }

  if (message.includes("payload")) {
    return "Shared-road batch was too large";
  }

  if (message.includes("authentication")) {
    return "Sign in again to sync shared roads";
  }

  if (message.includes("function") && message.includes("does not exist")) {
    return "Checkpoint 7 SQL has not been installed yet";
  }

  return error?.message || "Could not sync shared roads";
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


/* ================================================== */
/* Road Discovery AU v46 Hide & Seek extension        */
/* Append this block once to the bottom of app.js v45 */
/* ================================================== */

const HS46_ESCAPE_SECONDS = 3 * 60;
const HS46_SIGNAL_WARNING_SECONDS = 5;

Object.assign(state.hideSeek, {
  roleRevealAt: null,
  nextSignalAt: null,
  signalSequence: 0,
  signalEmittedAt: null,
  signalExpiresAt: null,
  signalClues: [],
  signalPolling: false,
  roleRevealTimer: null,
  revealedRoundId: null
});

[
  "hideSeekSignalPanel",
  "hideSeekSignalStatus",
  "hideSeekSignalList",
  "hideSeekMapHud",
  "hideSeekMapRole",
  "hideSeekMapPhase",
  "hideSeekMapTimer",
  "hideSeekMapSignalStatus",
  "hideSeekMapSignalList",
  "hideSeekRoleRevealOverlay",
  "hideSeekRoleRevealText"
].forEach((id) => {
  els[id] = $(id);
});

const hideSeekV45 = {
  resetState: resetHideSeekState,
  startCountdown: startHideSeekCountdown,
  renderState: renderHideSeekState,
  playerStatusLabel: hideSeekPlayerStatusLabel,
  phaseLabel: hideSeekPhaseLabel,
  gameStatusText: hideSeekGameStatusText,
  pollState: pollHideSeekState,
  applyRows: applyHideSeekRows
};

hasActiveHideSeekRound = function () {
  return Boolean(
    state.hideSeek.roundId &&
    ["starting", "escape", "hunt"].includes(
      state.hideSeek.phase
    )
  );
};

resetHideSeekState = function (options = {}) {
  const {
    clearRound = true,
    render = true
  } = options;

  hideHideSeekRoleReveal();

  hideSeekV45.resetState({
    clearRound,
    render: false
  });

  state.hideSeek.signalPolling = false;
  state.hideSeek.nextSignalAt = null;
  state.hideSeek.signalEmittedAt = null;
  state.hideSeek.signalExpiresAt = null;
  state.hideSeek.signalClues = [];

  if (clearRound) {
    state.hideSeek.roleRevealAt = null;
    state.hideSeek.signalSequence = 0;
    state.hideSeek.revealedRoundId = null;
  }

  renderHideSeekMapHud();

  if (render) {
    renderMultiplayerState();
  }
};

startHideSeekCountdown = function () {
  stopHideSeekCountdown();

  if (!hasActiveHideSeekRound()) return;

  state.hideSeek.countdownTimer = window.setInterval(() => {
    renderHideSeekState();

    const phaseDeadline =
      state.hideSeek.phase === "starting"
        ? state.hideSeek.roleRevealAt
        : state.hideSeek.phase === "escape"
          ? state.hideSeek.escapeEndsAt
          : state.hideSeek.phase === "hunt"
            ? state.hideSeek.huntEndsAt
            : null;

    const phaseDeadlineMs = Date.parse(
      phaseDeadline || ""
    );

    if (
      Number.isFinite(phaseDeadlineMs) &&
      hs46ServerNowMs() >= phaseDeadlineMs
    ) {
      void pollHideSeekState({
        force: true
      });
    }

    const nextSignalMs = Date.parse(
      state.hideSeek.nextSignalAt || ""
    );

    if (
      state.hideSeek.phase === "hunt" &&
      Number.isFinite(nextSignalMs) &&
      hs46ServerNowMs() >= nextSignalMs
    ) {
      void pollHideSeekSignalState();
    }
  }, 1000);
};

renderHideSeekState = function () {
  hideSeekV45.renderState();

  const role =
    state.hideSeek.phase === "starting"
      ? "choosing"
      : state.hideSeek.viewerRole || "player";

  if (els.hideSeekRoleBadge) {
    els.hideSeekRoleBadge.textContent =
      role === "wolf"
        ? "Wolf"
        : role === "sheep"
          ? "Sheep"
          : role === "choosing"
            ? "Choosing..."
            : "Player";

    els.hideSeekRoleBadge.classList.toggle(
      "wolf",
      role === "wolf"
    );

    els.hideSeekRoleBadge.classList.toggle(
      "sheep",
      role === "sheep"
    );

    els.hideSeekRoleBadge.classList.toggle(
      "choosing",
      role === "choosing"
    );
  }

  renderHideSeekSignalUI();
  renderHideSeekMapHud();
};

renderHideSeekPlayers = function () {
  if (!els.hideSeekPlayersList) return;

  const players = Array.isArray(
    state.hideSeek.players
  )
    ? state.hideSeek.players
    : [];

  if (players.length === 0) {
    els.hideSeekPlayersList.innerHTML = `
      <div class="empty-state">
        Roles appear when the round starts.
      </div>
    `;

    return;
  }

  els.hideSeekPlayersList.innerHTML = players
    .map((player) => {
      const role =
        state.hideSeek.phase === "starting" ||
        !player.role
          ? "choosing"
          : player.role === "wolf"
            ? "wolf"
            : "sheep";

      const status = String(
        player.player_status || "active"
      );

      const name = escapeHtml(
        player.display_name || "Road user"
      );

      const isMe = Boolean(player.is_me);

      const statusLabel =
        hideSeekPlayerStatusLabel(player);

      const roleLabel =
        role === "choosing"
          ? "Role is being chosen"
          : role === "wolf"
            ? "Wolf"
            : "Sheep";

      return `
        <div class="hide-seek-player-row">
          <span
            class="hide-seek-player-dot ${role} ${escapeHtml(status)}"
            aria-hidden="true"
          ></span>

          <div class="hide-seek-player-main">
            <div class="hide-seek-player-name">
              ${name}${isMe ? " <span>You</span>" : ""}
            </div>

            <div class="hide-seek-player-sub">
              ${roleLabel}
            </div>
          </div>

          <div class="hide-seek-player-status ${escapeHtml(status)}">
            ${escapeHtml(statusLabel)}
          </div>
        </div>
      `;
    })
    .join("");
};

hideSeekPlayerStatusLabel = function (player) {
  if (state.hideSeek.phase === "starting") {
    return "Choosing";
  }

  return hideSeekV45.playerStatusLabel(player);
};

hideSeekPhaseLabel = function (phase) {
  if (phase === "starting") {
    return "Choosing";
  }

  return hideSeekV45.phaseLabel(phase);
};

hideSeekGameStatusText = function () {
  if (state.hideSeek.phase === "starting") {
    return "Randomly choosing one wolf and the sheep...";
  }

  return hideSeekV45.gameStatusText();
};

formatHideSeekCountdown = function () {
  let deadline = null;

  if (state.hideSeek.phase === "starting") {
    deadline = state.hideSeek.roleRevealAt;
  } else if (state.hideSeek.phase === "escape") {
    deadline = state.hideSeek.escapeEndsAt;
  } else if (state.hideSeek.phase === "hunt") {
    deadline = state.hideSeek.huntEndsAt;
  }

  const deadlineMs = Date.parse(deadline || "");

  if (!Number.isFinite(deadlineMs)) {
    return "00:00";
  }

  const seconds = Math.max(
    0,
    Math.ceil(
      (deadlineMs - hs46ServerNowMs()) / 1000
    )
  );

  return hs46FormatSeconds(seconds);
};

function hs46FormatSeconds(secondsValue) {
  const seconds = Math.max(
    0,
    Math.ceil(Number(secondsValue) || 0)
  );

  const minutesPart = Math.floor(seconds / 60);

  const secondsPart = String(
    seconds % 60
  ).padStart(2, "0");

  return (
    `${String(minutesPart).padStart(2, "0")}` +
    `:${secondsPart}`
  );
}

function hs46ServerNowMs() {
  return (
    Date.now() +
    state.hideSeek.serverOffsetMs
  );
}

function hs46SignalIsActive() {
  const emittedMs = Date.parse(
    state.hideSeek.signalEmittedAt || ""
  );

  const expiresMs = Date.parse(
    state.hideSeek.signalExpiresAt || ""
  );

  const now = hs46ServerNowMs();

  return (
    state.hideSeek.phase === "hunt" &&
    Number.isFinite(emittedMs) &&
    Number.isFinite(expiresMs) &&
    now >= emittedMs &&
    now < expiresMs
  );
}

function hs46SignalStatusText() {
  if (state.hideSeek.phase !== "hunt") {
    return "";
  }

  if (hs46SignalIsActive()) {
    if (state.hideSeek.viewerRole === "wolf") {
      return state.hideSeek.signalClues.length > 0
        ? "Sheep signals active"
        : "No hidden sheep signal received";
    }

    return "Your signal was sent";
  }

  const nextMs = Date.parse(
    state.hideSeek.nextSignalAt || ""
  );

  if (!Number.isFinite(nextMs)) {
    return "No more signals this round";
  }

  const seconds = Math.max(
    0,
    Math.ceil(
      (nextMs - hs46ServerNowMs()) / 1000
    )
  );

  if (
    seconds <=
    HS46_SIGNAL_WARNING_SECONDS
  ) {
    return `Signal incoming • ${seconds}s`;
  }

  return (
    `Next signal • ` +
    hs46FormatSeconds(seconds)
  );
}

function hs46DirectionArrow(direction) {
  return {
    N: "↑",
    NE: "↗",
    E: "→",
    SE: "↘",
    S: "↓",
    SW: "↙",
    W: "←",
    NW: "↖"
  }[direction] || "•";
}

function hs46DistanceLabel(distance) {
  if (distance === "close") {
    return "Close";
  }

  if (distance === "medium") {
    return "Medium";
  }

  return "Far";
}

function hs46SignalCluesHtml() {
  if (
    state.hideSeek.viewerRole !== "wolf" ||
    !hs46SignalIsActive() ||
    state.hideSeek.signalClues.length === 0
  ) {
    return "";
  }

  return state.hideSeek.signalClues
    .map((clue) => {
      const direction = escapeHtml(
        clue.direction
      );

      const distance = escapeHtml(
        hs46DistanceLabel(clue.distance)
      );

      const arrow = hs46DirectionArrow(
        clue.direction
      );

      return `
        <span class="hide-seek-signal-clue ${escapeHtml(clue.distance)}">
          <strong>${arrow}</strong>
          <span>${direction} • ${distance}</span>
        </span>
      `;
    })
    .join("");
}

function renderHideSeekSignalUI() {
  const visible =
    Boolean(state.hideSeek.roundId) &&
    state.hideSeek.phase === "hunt";

  const statusText = visible
    ? hs46SignalStatusText()
    : "";

  const cluesHtml = visible
    ? hs46SignalCluesHtml()
    : "";

  const nextMs = Date.parse(
    state.hideSeek.nextSignalAt || ""
  );

  const secondsToSignal =
    Number.isFinite(nextMs)
      ? Math.max(
          0,
          Math.ceil(
            (
              nextMs -
              hs46ServerNowMs()
            ) / 1000
          )
        )
      : null;

  const incoming =
    secondsToSignal !== null &&
    secondsToSignal <=
      HS46_SIGNAL_WARNING_SECONDS;

  els.hideSeekSignalPanel?.classList.toggle(
    "hidden",
    !visible
  );

  if (els.hideSeekSignalStatus) {
    els.hideSeekSignalStatus.textContent =
      statusText;

    els.hideSeekSignalStatus.classList.toggle(
      "incoming",
      incoming
    );
  }

  if (els.hideSeekSignalList) {
    els.hideSeekSignalList.classList.toggle(
      "hidden",
      !cluesHtml
    );

    els.hideSeekSignalList.innerHTML =
      cluesHtml;
  }
}

function renderHideSeekMapHud() {
  if (!els.hideSeekMapHud) return;

  const hasRound = Boolean(
    state.hideSeek.roundId
  );

  els.hideSeekMapHud.classList.toggle(
    "hidden",
    !hasRound
  );

  if (!hasRound) return;

  const role =
    state.hideSeek.phase === "starting"
      ? "choosing"
      : state.hideSeek.viewerRole || "player";

  if (els.hideSeekMapRole) {
    els.hideSeekMapRole.textContent =
      role === "wolf"
        ? "Wolf"
        : role === "sheep"
          ? "Sheep"
          : role === "choosing"
            ? "Choosing"
            : "Player";

    els.hideSeekMapRole.classList.toggle(
      "wolf",
      role === "wolf"
    );

    els.hideSeekMapRole.classList.toggle(
      "sheep",
      role === "sheep"
    );

    els.hideSeekMapRole.classList.toggle(
      "choosing",
      role === "choosing"
    );
  }

  if (els.hideSeekMapPhase) {
    if (state.hideSeek.phase === "starting") {
      els.hideSeekMapPhase.textContent =
        "Choosing roles";
    } else if (
      state.hideSeek.phase === "escape"
    ) {
      els.hideSeekMapPhase.textContent =
        "Sheep escape";
    } else if (
      state.hideSeek.phase === "hunt"
    ) {
      els.hideSeekMapPhase.textContent =
        "Hunt";
    } else if (
      state.hideSeek.phase === "finished"
    ) {
      els.hideSeekMapPhase.textContent =
        state.hideSeek.winner === "wolf"
          ? "Wolf wins"
          : "Sheep win";
    } else {
      els.hideSeekMapPhase.textContent =
        "Round ended";
    }
  }

  if (els.hideSeekMapTimer) {
    els.hideSeekMapTimer.textContent =
      [
        "starting",
        "escape",
        "hunt"
      ].includes(state.hideSeek.phase)
        ? formatHideSeekCountdown()
        : "Finished";
  }

  const signalVisible =
    state.hideSeek.phase === "hunt";

  const signalStatus = signalVisible
    ? hs46SignalStatusText()
    : "";

  const cluesHtml = signalVisible
    ? hs46SignalCluesHtml()
    : "";

  const nextMs = Date.parse(
    state.hideSeek.nextSignalAt || ""
  );

  const secondsToSignal =
    Number.isFinite(nextMs)
      ? Math.max(
          0,
          Math.ceil(
            (
              nextMs -
              hs46ServerNowMs()
            ) / 1000
          )
        )
      : null;

  const incoming =
    secondsToSignal !== null &&
    secondsToSignal <=
      HS46_SIGNAL_WARNING_SECONDS;

  if (els.hideSeekMapSignalStatus) {
    els.hideSeekMapSignalStatus.classList.toggle(
      "hidden",
      !signalVisible
    );

    els.hideSeekMapSignalStatus.classList.toggle(
      "incoming",
      incoming
    );

    els.hideSeekMapSignalStatus.textContent =
      signalStatus;
  }

  if (els.hideSeekMapSignalList) {
    els.hideSeekMapSignalList.classList.toggle(
      "hidden",
      !cluesHtml
    );

    els.hideSeekMapSignalList.innerHTML =
      cluesHtml;
  }
}

function showHideSeekRoleReveal(role) {
  if (
    !state.hideSeek.roundId ||
    !["wolf", "sheep"].includes(role) ||
    state.hideSeek.revealedRoundId ===
      state.hideSeek.roundId
  ) {
    return;
  }

  hideHideSeekRoleReveal();

  state.hideSeek.revealedRoundId =
    state.hideSeek.roundId;

  if (els.hideSeekRoleRevealText) {
    els.hideSeekRoleRevealText.textContent =
      role === "wolf"
        ? "You are the wolf"
        : "You are a sheep";
  }

  if (els.hideSeekRoleRevealOverlay) {
    els.hideSeekRoleRevealOverlay.classList.remove(
      "hidden"
    );

    els.hideSeekRoleRevealOverlay.classList.toggle(
      "wolf",
      role === "wolf"
    );

    els.hideSeekRoleRevealOverlay.classList.toggle(
      "sheep",
      role === "sheep"
    );

    els.hideSeekRoleRevealOverlay.setAttribute(
      "aria-hidden",
      "false"
    );
  }

  state.hideSeek.roleRevealTimer =
    window.setTimeout(() => {
      hideHideSeekRoleReveal();
    }, 3000);
}

function hideHideSeekRoleReveal() {
  if (
    state.hideSeek.roleRevealTimer !== null
  ) {
    window.clearTimeout(
      state.hideSeek.roleRevealTimer
    );

    state.hideSeek.roleRevealTimer = null;
  }

  if (els.hideSeekRoleRevealOverlay) {
    els.hideSeekRoleRevealOverlay.classList.add(
      "hidden"
    );

    els.hideSeekRoleRevealOverlay.classList.remove(
      "wolf",
      "sheep"
    );

    els.hideSeekRoleRevealOverlay.setAttribute(
      "aria-hidden",
      "true"
    );
  }
}

pollHideSeekState = async function (
  options = {}
) {
  await hideSeekV45.pollState(options);

  if (state.hideSeek.roundId) {
    await pollHideSeekSignalState();
  }
};

async function pollHideSeekSignalState() {
  if (
    !state.hideSeek.roundId ||
    !state.auth.client ||
    !state.auth.user ||
    state.hideSeek.signalPolling ||
    !navigator.onLine
  ) {
    return;
  }

  state.hideSeek.signalPolling = true;

  const { data, error } =
    await state.auth.client.rpc(
      "get_hide_seek_signal_state",
      {
        p_room_id:
          state.multiplayer.roomId
      }
    );

  state.hideSeek.signalPolling = false;

  if (error) {
    console.error(error);
    return;
  }

  const row = Array.isArray(data)
    ? data[0]
    : data;

  if (
    !row ||
    String(row.round_id || "") !==
      state.hideSeek.roundId
  ) {
    return;
  }

  const serverNowMs = Date.parse(
    row.server_now || ""
  );

  if (Number.isFinite(serverNowMs)) {
    state.hideSeek.serverOffsetMs =
      serverNowMs - Date.now();
  }

  state.hideSeek.roleRevealAt =
    row.role_reveal_at ||
    state.hideSeek.roleRevealAt;

  state.hideSeek.nextSignalAt =
    row.next_signal_at || null;

  state.hideSeek.signalSequence =
    Number(row.signal_sequence) || 0;

  state.hideSeek.signalEmittedAt =
    row.signal_emitted_at || null;

  state.hideSeek.signalExpiresAt =
    row.signal_expires_at || null;

  state.hideSeek.signalClues =
    normaliseHideSeekSignalClues(
      row.clues
    );

  renderHideSeekState();
}

function normaliseHideSeekSignalClues(
  value
) {
  let clues = value;

  if (typeof clues === "string") {
    try {
      clues = JSON.parse(clues);
    } catch (error) {
      console.error(error);
      clues = [];
    }
  }

  if (!Array.isArray(clues)) {
    return [];
  }

  const allowedDirections = new Set([
    "N",
    "NE",
    "E",
    "SE",
    "S",
    "SW",
    "W",
    "NW"
  ]);

  const allowedDistances = new Set([
    "close",
    "medium",
    "far"
  ]);

  /*
    Only these two coarse fields are retained.
    Any unexpected GPS fields are discarded.
  */
  return clues
    .map((clue) => ({
      direction: String(
        clue?.direction || ""
      ).toUpperCase(),

      distance: String(
        clue?.distance || ""
      ).toLowerCase()
    }))
    .filter(
      (clue) =>
        allowedDirections.has(
          clue.direction
        ) &&
        allowedDistances.has(
          clue.distance
        )
    )
    .slice(0, 7);
}

applyHideSeekRows = function (rows) {
  const first = rows?.[0];

  const previousRoundId =
    state.hideSeek.roundId;

  const previousRole =
    state.hideSeek.viewerRole;

  const escapeEndsMs = Date.parse(
    first?.escape_ends_at || ""
  );

  if (Number.isFinite(escapeEndsMs)) {
    state.hideSeek.roleRevealAt =
      new Date(
        escapeEndsMs -
        HS46_ESCAPE_SECONDS * 1000
      ).toISOString();
  }

  if (
    String(first?.phase || "") !== "hunt"
  ) {
    state.hideSeek.nextSignalAt = null;
    state.hideSeek.signalEmittedAt = null;
    state.hideSeek.signalExpiresAt = null;
    state.hideSeek.signalClues = [];
  }

  const normalShowToast = showToast;

  if (
    String(first?.phase || "") ===
    "starting"
  ) {
    showToast = function (message) {
      if (
        /^You are (the wolf|a sheep)$/i.test(
          String(message || "")
        )
      ) {
        return;
      }

      normalShowToast(message);
    };
  }

  try {
    hideSeekV45.applyRows(rows);
  } finally {
    showToast = normalShowToast;
  }

  const roleIsRevealed = [
    "wolf",
    "sheep"
  ].includes(state.hideSeek.viewerRole);

  const roundChanged =
    previousRoundId !==
    state.hideSeek.roundId;

  const roleChanged =
    previousRole !==
    state.hideSeek.viewerRole;

  if (
    roleIsRevealed &&
    (roundChanged || roleChanged)
  ) {
    showHideSeekRoleReveal(
      state.hideSeek.viewerRole
    );
  }
};

applyHideSeekOwnMarkerStyle = function () {
  const colour =
    hasActiveHideSeekRound() &&
    state.hideSeek.phase === "starting"
      ? HIDE_SEEK_OUT_COLOUR
      : hasActiveHideSeekRound() &&
          state.hideSeek.viewerRole === "wolf"
        ? HIDE_SEEK_WOLF_COLOUR
        : HIDE_SEEK_SHEEP_COLOUR;

  state.userMarker?.setStyle({
    color: "#eef7ff",
    fillColor: colour
  });

  state.accuracyCircle?.setStyle({
    color: colour,
    fillColor: colour
  });
};

/* ================================================== */
/* Road Discovery AU v47 navigation + map pings       */
/* Append this block once to the bottom of app.js v46 */
/* ================================================== */

const hideSeekV47 = {
  initMap,
  renderState: renderHideSeekState,
  clearVisuals: clearHideSeekVisuals,
  updateUserMarker,
  applyOwnMarkerStyle: applyHideSeekOwnMarkerStyle,
  signalStatusText: hs46SignalStatusText
};

Object.assign(state.hideSeek, {
  signalPingMarkers: [],
  signalPingKey: ""
});

Object.assign(state, {
  userHeadingMarker: null,
  userHeadingDegrees: null,
  userHeadingPreviousPoint: null,
  mapHeadingMode: "heading",
  mapBearingAnimationFrame: null
});

initMap = function () {
  if (!window.L) {
    hideSeekV47.initMap();
    return;
  }

  const normalMapFactory = L.map;
  const rotationAvailable = Boolean(
    L?.Map?.prototype?.setBearing
  );

  if (rotationAvailable) {
    L.map = function (target, options = {}) {
      return normalMapFactory(target, {
        ...options,
        rotate: true,
        bearing: 0,
        rotateControl: false,
        touchRotate: false,
        shiftKeyRotate: false,
        zoomAnimation: false
      });
    };
  }

  try {
    hideSeekV47.initMap();
  } finally {
    L.map = normalMapFactory;
  }

  if (state.map && rotationAvailable) {
    state.map.on("rotate", () => {
      hs47UpdateNorthIndicator();
      hs47StyleHeadingMarker();
    });

    state.map.on("dragstart", () => {
      window.setTimeout(hs47UpdateNorthIndicator, 0);
    });
  }

  hs47UpdateNorthIndicator();
};

function hs47EnsureNorthIndicator() {
  if ($("mapNorthIndicator")) return;

  const appShell = $("appShell");

  if (!appShell) return;

  const indicator = document.createElement("button");
  indicator.id = "mapNorthIndicator";
  indicator.className = "map-north-indicator";
  indicator.type = "button";
  indicator.setAttribute("aria-label", "Return map to north-up");
  indicator.title = "Return to north-up";
  indicator.innerHTML = `
    <span class="map-north-arrow" aria-hidden="true">▲</span>
    <strong>N</strong>
  `;

  indicator.addEventListener("click", () => {
    state.mapHeadingMode = "north";
    hs47SetMapBearing(0);
    hs47UpdateNorthIndicator();
  });

  appShell.appendChild(indicator);
}

function hs47ImproveLocateButton() {
  const button = $("locateBtn");

  if (!button) return;

  button.title = "Centre on me • Follow my heading";
  button.setAttribute(
    "aria-label",
    "Centre map on my location and follow my heading."
  );

  button.addEventListener("click", () => {
    state.followUser = true;
    state.mapHeadingMode = "heading";

    if (state.currentPoint) {
      hs47ApplyHeadingView(state.currentPoint);
    }

    hs47UpdateNorthIndicator();
  });
}

function hs47NormaliseDegrees(value) {
  const degrees = Number(value);

  if (!Number.isFinite(degrees)) return null;

  return ((degrees % 360) + 360) % 360;
}

function hs47BearingDegrees(from, to) {
  const fromLat = toRad(from.lat);
  const toLat = toRad(to.lat);
  const longitudeDelta = toRad(to.lng - from.lng);

  const y = Math.sin(longitudeDelta) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) *
      Math.cos(toLat) *
      Math.cos(longitudeDelta);

  return hs47NormaliseDegrees(
    Math.atan2(y, x) * (180 / Math.PI)
  );
}

function hs47ShortestBearingTurn(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function hs47MapBearing() {
  if (!state.map || typeof state.map.getBearing !== "function") {
    return 0;
  }

  return hs47NormaliseDegrees(state.map.getBearing()) || 0;
}

function hs47CancelBearingAnimation() {
  if (state.mapBearingAnimationFrame !== null) {
    window.cancelAnimationFrame(state.mapBearingAnimationFrame);
    state.mapBearingAnimationFrame = null;
  }
}

function hs47SetMapBearing(targetValue, options = {}) {
  if (!state.map || typeof state.map.setBearing !== "function") {
    hs47UpdateNorthIndicator();
    hs47StyleHeadingMarker();
    return;
  }

  const { animate = true } = options;
  const target = hs47NormaliseDegrees(targetValue) || 0;
  const start = hs47MapBearing();
  const turn = hs47ShortestBearingTurn(start, target);

  hs47CancelBearingAnimation();

  if (Math.abs(turn) < 0.5) {
    state.map.setBearing(target);
    return;
  }

  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  )?.matches;

  if (!animate || reduceMotion || !window.requestAnimationFrame) {
    state.map.setBearing(target);
    return;
  }

  const startedAt = performance.now();
  const durationMs = 260;

  const animateBearing = (now) => {
    if (
      !state.map ||
      (state.mapHeadingMode === "north" && target !== 0)
    ) {
      state.mapBearingAnimationFrame = null;
      return;
    }

    const progress = Math.min(
      1,
      (now - startedAt) / durationMs
    );

    const eased = 1 - (1 - progress) ** 3;

    state.map.setBearing(
      hs47NormaliseDegrees(start + turn * eased) || 0
    );

    if (progress < 1) {
      state.mapBearingAnimationFrame =
        window.requestAnimationFrame(animateBearing);
    } else {
      state.mapBearingAnimationFrame = null;
    }
  };

  state.mapBearingAnimationFrame =
    window.requestAnimationFrame(animateBearing);
}

function hs47NavigationIsActive() {
  return Boolean(
    state.isRecording ||
    state.waypointPoint ||
    hasActiveHideSeekRound()
  );
}

function hs47ApplyHeadingView(point) {
  const heading = hs47NormaliseDegrees(
    state.userHeadingDegrees
  );

  if (
    heading === null ||
    !state.followUser ||
    state.mapHeadingMode !== "heading" ||
    !hs47NavigationIsActive()
  ) {
    hs47StyleHeadingMarker();
    return;
  }

  /*
    Rotate the map underneath the marker so the rider's
    direction of travel points toward the top of the screen.
  */
  hs47SetMapBearing(-heading);

  /*
    Hide & Seek Multiplayer GPS has its own location watch.
    This makes it follow the sheep even if Start Drive is off.
  */
  if (
    hasActiveHideSeekRound() &&
    !state.isRecording &&
    state.map
  ) {
    state.map.panTo([point.lat, point.lng], {
      animate: true,
      duration: 0.3
    });
  }
}

function hs47UpdateNorthIndicator() {
  const indicator = $("mapNorthIndicator");

  if (!indicator) return;

  const arrow = indicator.querySelector(
    ".map-north-arrow"
  );

  const bearing = hs47MapBearing();

  const headingMode =
    state.mapHeadingMode === "heading" &&
    state.followUser;

  if (arrow) {
    arrow.style.transform = `rotate(${bearing}deg)`;
  }

  indicator.classList.toggle(
    "heading-up",
    headingMode
  );

  indicator.classList.toggle(
    "north-up",
    Math.abs(
      hs47ShortestBearingTurn(bearing, 0)
    ) < 0.5
  );

  indicator.title = headingMode
    ? "Heading-up • Tap for north-up"
    : "North-up • Tap My Location for heading-up";
}

function hs47UpdateHeading(point) {
  let heading = hs47NormaliseDegrees(
    point?.heading
  );

  const previous =
    state.userHeadingPreviousPoint;

  const hasCleanPoint =
    Number(point?.accuracy) <=
    MAX_GPS_ACCURACY_M;

  /*
    Some devices do not provide coords.heading.
    When that happens, derive the direction after
    at least five metres of clean GPS movement.
  */
  if (
    heading === null &&
    previous &&
    hasCleanPoint
  ) {
    const movement = haversine(previous, point);

    if (movement >= 5) {
      heading = hs47BearingDegrees(
        previous,
        point
      );
    }
  }

  if (heading !== null) {
    state.userHeadingDegrees = heading;
  }

  if (hasCleanPoint) {
    state.userHeadingPreviousPoint = {
      lat: Number(point.lat),
      lng: Number(point.lng)
    };
  }
}

function hs47OwnMarkerColour() {
  if (
    hasActiveHideSeekRound() &&
    state.hideSeek.phase === "starting"
  ) {
    return HIDE_SEEK_OUT_COLOUR;
  }

  if (
    hasActiveHideSeekRound() &&
    state.hideSeek.viewerRole === "wolf"
  ) {
    return HIDE_SEEK_WOLF_COLOUR;
  }

  return HIDE_SEEK_SHEEP_COLOUR;
}

function hs47DrawHeadingMarker(point) {
  if (!state.map) return;

  const heading = hs47NormaliseDegrees(
    state.userHeadingDegrees
  );

  if (heading === null) {
    if (state.userHeadingMarker) {
      state.userHeadingMarker.setOpacity(0);
    }

    return;
  }

  const latlng = [point.lat, point.lng];

  if (!state.userHeadingMarker) {
    const icon = L.divIcon({
      className: "road-user-heading-icon",
      html: `
        <span
          class="road-user-heading-rotator"
          aria-hidden="true"
        >
          <span
            class="road-user-heading-arrow"
          ></span>
        </span>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });

    state.userHeadingMarker = L.marker(
      latlng,
      {
        icon,
        pane: "userLocationPane",
        interactive: false,
        keyboard: false,
        zIndexOffset: 20
      }
    ).addTo(state.map);
  } else {
    state.userHeadingMarker.setLatLng(latlng);
    state.userHeadingMarker.setOpacity(1);
  }

  hs47StyleHeadingMarker();
}

function hs47StyleHeadingMarker() {
  const element =
    state.userHeadingMarker?.getElement?.();

  if (!element) return;

  /*
    Counter the map bearing so the arrow always shows
    the rider's real direction on the screen.
  */
  const screenHeading =
    hs47NormaliseDegrees(
      (state.userHeadingDegrees || 0) +
      hs47MapBearing()
    ) || 0;

  element.style.setProperty(
    "--road-heading",
    `${screenHeading}deg`
  );

  element.style.setProperty(
    "--road-heading-colour",
    hs47OwnMarkerColour()
  );
}

updateUserMarker = function (point) {
  hideSeekV47.updateUserMarker(point);

  hs47UpdateHeading(point);
  hs47DrawHeadingMarker(point);
  hs47ApplyHeadingView(point);
};

applyHideSeekOwnMarkerStyle = function () {
  hideSeekV47.applyOwnMarkerStyle();
  hs47StyleHeadingMarker();
};

/* -------------------------------------------------- */
/* Exact three-second sheep map pings                 */
/* -------------------------------------------------- */

normaliseHideSeekSignalClues = function (value) {
  let pings = value;

  if (typeof pings === "string") {
    try {
      pings = JSON.parse(pings);
    } catch (error) {
      console.error(error);
      pings = [];
    }
  }

  if (!Array.isArray(pings)) return [];

  return pings
    .map((ping) => ({
      lat: Number(ping?.lat),
      lng: Number(ping?.lng)
    }))
    .filter(
      (ping) =>
        Number.isFinite(ping.lat) &&
        Number.isFinite(ping.lng) &&
        ping.lat >= -90 &&
        ping.lat <= 90 &&
        ping.lng >= -180 &&
        ping.lng <= 180
    )
    .slice(0, 7);
};

/*
  Query 20 now sends coordinates rather than the old
  NW/Close direction cards, so remove the old cards.
*/
hs46SignalCluesHtml = function () {
  return "";
};

hs46SignalStatusText = function () {
  if (
    state.hideSeek.phase === "hunt" &&
    hs46SignalIsActive()
  ) {
    if (
      state.hideSeek.viewerRole === "wolf"
    ) {
      return state.hideSeek.signalClues.length > 0
        ? "Sheep ping active"
        : "No hidden sheep ping received";
    }

    return "Your location pinged";
  }

  return hideSeekV47.signalStatusText();
};

function hs47SignalPingKey() {
  const coordinates =
    state.hideSeek.signalClues
      .map(
        (ping) =>
          `${ping.lat.toFixed(6)},` +
          `${ping.lng.toFixed(6)}`
      )
      .join("|");

  return (
    `${state.hideSeek.signalSequence}:` +
    coordinates
  );
}

function hs47ClearSignalPings() {
  for (
    const marker of
    state.hideSeek.signalPingMarkers
  ) {
    state.map?.removeLayer(marker);
  }

  state.hideSeek.signalPingMarkers = [];
  state.hideSeek.signalPingKey = "";
}

function hs47RenderSignalPings() {
  const shouldShow =
    Boolean(state.map) &&
    state.hideSeek.phase === "hunt" &&
    state.hideSeek.viewerRole === "wolf" &&
    hs46SignalIsActive() &&
    state.hideSeek.signalClues.length > 0;

  if (!shouldShow) {
    hs47ClearSignalPings();
    return;
  }

  const key = hs47SignalPingKey();

  if (
    key === state.hideSeek.signalPingKey &&
    state.hideSeek.signalPingMarkers.length > 0
  ) {
    return;
  }

  hs47ClearSignalPings();

  const icon = L.divIcon({
    className: "hide-seek-radar-ping-icon",
    html: `
      <span
        class="hide-seek-radar-ping"
        aria-hidden="true"
      >
        <span
          class="hide-seek-radar-ping-dot"
        ></span>
      </span>
    `,
    iconSize: [52, 52],
    iconAnchor: [26, 26]
  });

  for (
    const ping of
    state.hideSeek.signalClues
  ) {
    const marker = L.marker(
      [ping.lat, ping.lng],
      {
        icon,
        pane: "multiplayerPane",
        interactive: false,
        keyboard: false,
        zIndexOffset: 30
      }
    ).addTo(state.map);

    state.hideSeek.signalPingMarkers.push(
      marker
    );
  }

  state.hideSeek.signalPingKey = key;
}

renderHideSeekState = function () {
  hideSeekV47.renderState();
  hs47RenderSignalPings();
};

clearHideSeekVisuals = function () {
  hs47ClearSignalPings();
  hideSeekV47.clearVisuals();
};

hs47EnsureNorthIndicator();
hs47ImproveLocateButton();

/* ================================================== */
/* Road Discovery AU v48 hybrid direction extension  */
/* Append this block once to the bottom of app.js v47 */
/* ================================================== */

const HS48_COMPASS_STORAGE_KEY =
  "roadDiscoveryAU.compassPermission.v1";

const HS48_COMPASS_MAX_AGE_MS = 2200;
const HS48_GPS_HEADING_MAX_AGE_MS = 8000;
const HS48_COMPASS_APPLY_MIN_MS = 160;
const HS48_GPS_ENTER_SPEED_MPS = 3.0;
const HS48_GPS_EXIT_SPEED_MPS = 1.7;

/*
  Correct the v47 case where null could be interpreted
  as zero degrees instead of an unknown heading.
*/
const hs48V47NormaliseDegrees =
  hs47NormaliseDegrees;

hs47NormaliseDegrees = function (value) {
  if (
    value === null ||
    value === undefined ||
    (
      typeof value === "string" &&
      value.trim() === ""
    )
  ) {
    return null;
  }

  return hs48V47NormaliseDegrees(value);
};

const hideSeekV48 = {
  updateUserMarker,
  renderHideSeekState,
  setWaypoint,
  clearWaypoint,
  startDrive,
  finishDrive
};

Object.assign(state, {
  compassPermission: "unknown",
  compassPermissionRequesting: false,
  compassListenerActive: false,
  compassEventName: null,
  compassHeadingDegrees: null,
  compassHeadingUpdatedAt: 0,
  compassLastAppliedAt: 0,

  hybridHeadingSource: "gps",
  hybridGpsHeadingDegrees: null,
  hybridGpsHeadingUpdatedAt: 0,
  hybridSpeedMps: null,
  hybridPreviousPoint: null
});

function hs48StoredCompassPermission() {
  try {
    return (
      localStorage.getItem(
        HS48_COMPASS_STORAGE_KEY
      ) === "granted"
    );
  } catch (error) {
    console.error(error);
    return false;
  }
}

function hs48RememberCompassPermission(
  granted
) {
  try {
    if (granted) {
      localStorage.setItem(
        HS48_COMPASS_STORAGE_KEY,
        "granted"
      );
    } else {
      localStorage.removeItem(
        HS48_COMPASS_STORAGE_KEY
      );
    }
  } catch (error) {
    console.error(error);
  }
}

function hs48OrientationAvailable() {
  return (
    typeof window.DeviceOrientationEvent !==
    "undefined"
  );
}

function hs48NavigationIsActive() {
  return hs47NavigationIsActive();
}

function hs48ScreenAngle() {
  const modernAngle = Number(
    window.screen?.orientation?.angle
  );

  if (Number.isFinite(modernAngle)) {
    return modernAngle;
  }

  const legacyAngle = Number(
    window.orientation
  );

  return Number.isFinite(legacyAngle)
    ? legacyAngle
    : 0;
}

function hs48CompassHeadingFromEvent(
  event
) {
  const iosHeading = Number(
    event?.webkitCompassHeading
  );

  const iosAccuracy = Number(
    event?.webkitCompassAccuracy
  );

  let heading = null;

  /*
    iPhone Safari supplies webkitCompassHeading.
  */
  if (Number.isFinite(iosHeading)) {
    /*
      Ignore very poorly calibrated compass readings.
    */
    if (
      Number.isFinite(iosAccuracy) &&
      iosAccuracy > 45
    ) {
      return null;
    }

    heading = iosHeading;
  } else {
    /*
      Other supported browsers can supply an absolute
      alpha orientation instead.
    */
    const alpha = Number(event?.alpha);

    if (
      !event?.absolute ||
      !Number.isFinite(alpha)
    ) {
      return null;
    }

    heading = 360 - alpha;
  }

  return hs47NormaliseDegrees(
    heading + hs48ScreenAngle()
  );
}

function hs48SmoothCompassHeading(
  nextHeading
) {
  const current = hs47NormaliseDegrees(
    state.compassHeadingDegrees
  );

  if (current === null) {
    return nextHeading;
  }

  const turn = hs47ShortestBearingTurn(
    current,
    nextHeading
  );

  const smoothing =
    Math.abs(turn) >= 100
      ? 0.55
      : 0.34;

  return hs47NormaliseDegrees(
    current + turn * smoothing
  );
}

function hs48OnDeviceOrientation(event) {
  const rawHeading =
    hs48CompassHeadingFromEvent(event);

  if (rawHeading === null) {
    return;
  }

  const now = Date.now();

  state.compassPermission = "granted";

  state.compassHeadingDegrees =
    hs48SmoothCompassHeading(rawHeading);

  state.compassHeadingUpdatedAt = now;

  /*
    Limit how often compass readings rotate the map.
  */
  if (
    now - state.compassLastAppliedAt <
    HS48_COMPASS_APPLY_MIN_MS
  ) {
    return;
  }

  state.compassLastAppliedAt = now;

  hs48ApplySelectedHeading();
}

function hs48AddCompassListener() {
  if (
    state.compassListenerActive ||
    !hs48OrientationAvailable()
  ) {
    return;
  }

  /*
    Prefer absolute orientation when a browser offers
    it. iPhone Safari uses deviceorientation.
  */
  state.compassEventName =
    "ondeviceorientationabsolute" in window
      ? "deviceorientationabsolute"
      : "deviceorientation";

  window.addEventListener(
    state.compassEventName,
    hs48OnDeviceOrientation,
    true
  );

  state.compassListenerActive = true;
}

function hs48RemoveCompassListener() {
  if (!state.compassListenerActive) {
    return;
  }

  window.removeEventListener(
    state.compassEventName ||
      "deviceorientation",
    hs48OnDeviceOrientation,
    true
  );

  state.compassListenerActive = false;
  state.compassEventName = null;
}

function hs48RefreshCompassListener() {
  const permissionReady = [
    "granted",
    "remembered",
    "not-required"
  ].includes(state.compassPermission);

  /*
    Only run the sensor during navigation and while
    the PWA is visible.
  */
  const shouldListen =
    permissionReady &&
    hs48NavigationIsActive() &&
    document.visibilityState !== "hidden";

  if (shouldListen) {
    hs48AddCompassListener();
  } else {
    hs48RemoveCompassListener();
  }
}

async function hs48RequestCompassPermission() {
  if (
    state.compassPermissionRequesting ||
    state.compassPermission === "granted" ||
    state.compassPermission ===
      "not-required"
  ) {
    hs48RefreshCompassListener();
    return;
  }

  const OrientationEvent =
    window.DeviceOrientationEvent;

  if (!OrientationEvent) {
    state.compassPermission =
      "unavailable";

    return;
  }

  state.compassPermissionRequesting =
    true;

  try {
    if (
      typeof OrientationEvent
        .requestPermission === "function"
    ) {
      /*
        This begins synchronously inside the user's
        tap on the re-centre button.
      */
      const permissionPromise =
        OrientationEvent.requestPermission();

      const permission =
        await permissionPromise;

      if (permission !== "granted") {
        state.compassPermission = "denied";

        hs48RememberCompassPermission(
          false
        );

        hs48RefreshCompassListener();

        showToast(
          "Using GPS direction"
        );

        return;
      }
    }

    state.compassPermission =
      typeof OrientationEvent
        .requestPermission === "function"
        ? "granted"
        : "not-required";

    hs48RememberCompassPermission(true);
    hs48RefreshCompassListener();

    showToast(
      "Instant direction enabled"
    );
  } catch (error) {
    console.error(error);

    state.compassPermission = "denied";

    hs48RememberCompassPermission(false);
    hs48RefreshCompassListener();

    showToast(
      "Using GPS direction"
    );
  } finally {
    state.compassPermissionRequesting =
      false;
  }
}

function hs48UpdateGpsCourse(point) {
  const now = Date.now();

  const timestamp =
    Number(point?.timestamp) || now;

  const accuracy = Number(
    point?.accuracy
  );

  const clean =
    Number.isFinite(accuracy) &&
    accuracy <= MAX_GPS_ACCURACY_M;

  /*
    Weak GPS readings cannot influence the hybrid
    heading calculation.
  */
  if (!clean) {
    return;
  }

  const previous =
    state.hybridPreviousPoint;

  let gpsHeading =
    hs47NormaliseDegrees(
      point?.heading
    );

  let measuredSpeed = Number(
    point?.speed
  );

  if (
    !Number.isFinite(measuredSpeed) ||
    measuredSpeed < 0
  ) {
    measuredSpeed = null;
  }

  if (previous) {
    const elapsedSeconds = Math.max(
      0,
      (
        timestamp -
        previous.timestamp
      ) / 1000
    );

    if (
      elapsedSeconds >= 0.4 &&
      elapsedSeconds <= 12
    ) {
      const movement = haversine(
        previous,
        point
      );

      /*
        Calculate speed if the browser did not
        supply it.
      */
      if (measuredSpeed === null) {
        measuredSpeed =
          movement / elapsedSeconds;
      }

      /*
        Calculate course from movement if the browser
        did not provide GPS heading.
      */
      if (
        gpsHeading === null &&
        movement >= 4
      ) {
        gpsHeading =
          hs47BearingDegrees(
            previous,
            point
          );
      }
    }
  }

  if (gpsHeading !== null) {
    state.hybridGpsHeadingDegrees =
      gpsHeading;

    state.hybridGpsHeadingUpdatedAt =
      now;
  }

  if (measuredSpeed !== null) {
    if (
      state.hybridSpeedMps === null
    ) {
      state.hybridSpeedMps =
        measuredSpeed;
    } else {
      /*
        Smooth speed to stop the source rapidly
        switching around the threshold.
      */
      state.hybridSpeedMps =
        state.hybridSpeedMps * 0.58 +
        measuredSpeed * 0.42;
    }
  }

  state.hybridPreviousPoint = {
    lat: Number(point.lat),
    lng: Number(point.lng),
    timestamp
  };
}

function hs48SelectedHeading() {
  const now = Date.now();

  const compassFresh =
    hs47NormaliseDegrees(
      state.compassHeadingDegrees
    ) !== null &&
    now -
      state.compassHeadingUpdatedAt <=
      HS48_COMPASS_MAX_AGE_MS;

  const gpsFresh =
    hs47NormaliseDegrees(
      state.hybridGpsHeadingDegrees
    ) !== null &&
    now -
      state.hybridGpsHeadingUpdatedAt <=
      HS48_GPS_HEADING_MAX_AGE_MS;

  const speed = Number(
    state.hybridSpeedMps
  );

  const speedKnown =
    Number.isFinite(speed) &&
    speed >= 0;

  /*
    If currently using GPS, stay on GPS until
    speed drops below roughly 6 km/h.
  */
  if (
    state.hybridHeadingSource === "gps"
  ) {
    if (
      compassFresh &&
      (
        !speedKnown ||
        speed <=
          HS48_GPS_EXIT_SPEED_MPS
      )
    ) {
      state.hybridHeadingSource =
        "compass";
    }
  } else if (
    /*
      If currently using the compass, wait until
      roughly 11 km/h before switching to GPS.
    */
    gpsFresh &&
    speedKnown &&
    speed >= HS48_GPS_ENTER_SPEED_MPS
  ) {
    state.hybridHeadingSource = "gps";
  }

  if (
    state.hybridHeadingSource ===
      "compass" &&
    compassFresh
  ) {
    return state.compassHeadingDegrees;
  }

  if (gpsFresh) {
    state.hybridHeadingSource = "gps";
    return state.hybridGpsHeadingDegrees;
  }

  if (compassFresh) {
    state.hybridHeadingSource =
      "compass";

    return state.compassHeadingDegrees;
  }

  return hs47NormaliseDegrees(
    state.userHeadingDegrees
  );
}

function hs48ApplySelectedHeading() {
  if (!hs48NavigationIsActive()) {
    return;
  }

  const selectedHeading =
    hs48SelectedHeading();

  if (selectedHeading === null) {
    return;
  }

  state.userHeadingDegrees =
    selectedHeading;

  if (state.currentPoint) {
    hs47DrawHeadingMarker(
      state.currentPoint
    );

    hs47ApplyHeadingView(
      state.currentPoint
    );
  }
}

/* -------------------------------------------------- */
/* Wrap the existing v47 navigation safely            */
/* -------------------------------------------------- */

updateUserMarker = function (point) {
  hideSeekV48.updateUserMarker(point);

  hs48UpdateGpsCourse(point);
  hs48RefreshCompassListener();
  hs48ApplySelectedHeading();
};

renderHideSeekState = function () {
  hideSeekV48.renderHideSeekState();
  hs48RefreshCompassListener();
};

setWaypoint = async function (point) {
  const result =
    await hideSeekV48.setWaypoint(point);

  hs48RefreshCompassListener();
  hs48ApplySelectedHeading();

  return result;
};

clearWaypoint = function (
  showMessage = true
) {
  const result =
    hideSeekV48.clearWaypoint(
      showMessage
    );

  hs48RefreshCompassListener();

  return result;
};

startDrive = async function () {
  const result =
    await hideSeekV48.startDrive();

  hs48RefreshCompassListener();
  hs48ApplySelectedHeading();

  return result;
};

finishDrive = function () {
  const result =
    hideSeekV48.finishDrive();

  hs48RefreshCompassListener();

  return result;
};

/* -------------------------------------------------- */
/* Permission and visibility events                   */
/* -------------------------------------------------- */

const hs48LocateButton =
  $("locateBtn");

hs48LocateButton?.addEventListener(
  "click",
  () => {
    void hs48RequestCompassPermission();
  }
);

document.addEventListener(
  "visibilitychange",
  () => {
    hs48RefreshCompassListener();
  }
);

if (hs48StoredCompassPermission()) {
  state.compassPermission =
    "remembered";
}

hs48RefreshCompassListener();

/* ================================================== */
/* Road Discovery AU v49 rotation alignment fix       */
/* Append this block once to the bottom of app.js v48 */
/* ================================================== */

const hideSeekV49 = {
  initMap,
  updateUserMarker
};

Object.assign(state, {
  navigationSvgRenderer: null,
  userLocationSvgRenderer: null,
  userAccuracySvgRenderer: null,
  navigationRedrawFrame: null
});

initMap = function () {
  hideSeekV49.initMap();

  if (
    !state.map ||
    typeof L?.svg !== "function"
  ) {
    return;
  }

  /*
    Keep the thousands of road chunks on the existing
    Canvas renderer.

    Only navigation paths use SVG so they remain
    aligned while the map bearing changes.
  */
  state.navigationSvgRenderer = L.svg({
    padding: 0.5
  });

  state.userLocationSvgRenderer = L.svg({
    pane: "userLocationPane",
    padding: 0.5
  });

  state.userAccuracySvgRenderer = L.svg({
    pane: "userAccuracyPane",
    padding: 0.5
  });

  state.map.on(
    "rotate move zoomend resize",
    () => {
      hs49ScheduleNavigationRedraw();
    }
  );
};

function hs49MovePathToRenderer(
  path,
  renderer,
  owner
) {
  if (
    !path ||
    !renderer ||
    !owner ||
    path.options?.renderer === renderer
  ) {
    return;
  }

  const wasAdded =
    typeof owner.hasLayer === "function" &&
    owner.hasLayer(path);

  if (wasAdded) {
    owner.removeLayer(path);
  }

  path.options.renderer = renderer;

  if (wasAdded) {
    owner.addLayer(path);
  }
}

function hs49RedrawNavigationPaths() {
  const paths = [
    state.userMarker,
    state.accuracyCircle,
    state.waypointMarker,
    state.routeHalo,
    state.routeLine,
    state.hideSeek.zoneCircle,
    state.hideSeek.routeHalo,
    state.hideSeek.routeLine
  ];

  for (const path of paths) {
    path?.redraw?.();
  }

  state.userHeadingMarker?.update?.();

  for (
    const marker of
    state.hideSeek.signalPingMarkers || []
  ) {
    marker?.update?.();
  }
}

function hs49ScheduleNavigationRedraw() {
  if (
    state.navigationRedrawFrame !== null
  ) {
    return;
  }

  if (!window.requestAnimationFrame) {
    hs49RedrawNavigationPaths();
    return;
  }

  state.navigationRedrawFrame =
    window.requestAnimationFrame(() => {
      state.navigationRedrawFrame = null;
      hs49RedrawNavigationPaths();
    });
}

/* -------------------------------------------------- */
/* Stable single-step bearing updates                 */
/* -------------------------------------------------- */

hs47SetMapBearing = function (
  targetValue
) {
  if (
    !state.map ||
    typeof state.map.setBearing !== "function"
  ) {
    hs47UpdateNorthIndicator();
    hs47StyleHeadingMarker();
    return;
  }

  const target =
    hs47NormaliseDegrees(
      targetValue
    ) || 0;

  const current = hs47MapBearing();

  const turn =
    hs47ShortestBearingTurn(
      current,
      target
    );

  hs47CancelBearingAnimation();

  /*
    One stable rotation per sensor update prevents
    the route and marker renderers from separating.
  */
  if (Math.abs(turn) >= 0.75) {
    state.map.setBearing(target);
  }

  hs47UpdateNorthIndicator();
  hs47StyleHeadingMarker();
  hs49ScheduleNavigationRedraw();
};

/* -------------------------------------------------- */
/* User marker and accuracy circle                    */
/* -------------------------------------------------- */

updateUserMarker = function (point) {
  hideSeekV49.updateUserMarker(point);

  hs49MovePathToRenderer(
    state.userMarker,
    state.userLocationSvgRenderer,
    state.map
  );

  hs49MovePathToRenderer(
    state.accuracyCircle,
    state.userAccuracySvgRenderer,
    state.map
  );

  state.accuracyCircle?.bringToFront?.();
  state.userMarker?.bringToFront?.();

  state.userHeadingMarker
    ?.setZIndexOffset?.(20);

  hs49ScheduleNavigationRedraw();
};

/* -------------------------------------------------- */
/* Normal waypoint paths                              */
/* -------------------------------------------------- */

drawWaypointMarker = function (point) {
  if (!state.routeLayer) return;

  const latlng = [
    point.lat,
    point.lng
  ];

  if (!state.waypointMarker) {
    state.waypointMarker =
      L.circleMarker(latlng, {
        renderer:
          state.navigationSvgRenderer ||
          undefined,

        radius: 9,
        color: "#eef7ff",
        weight: 4,
        fillColor: ROUTE_BLUE,
        fillOpacity: 1
      }).addTo(state.routeLayer);

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

  hs49ScheduleNavigationRedraw();
};

drawRouteLine = function (coords) {
  clearRouteLine();

  if (
    !state.routeLayer ||
    !Array.isArray(coords) ||
    coords.length < 2
  ) {
    return;
  }

  const renderer =
    state.navigationSvgRenderer ||
    undefined;

  state.routeHalo = L.polyline(
    coords,
    {
      renderer,
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
      renderer,
      color: ROUTE_BLUE,
      weight: 5,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }
  ).addTo(state.routeLayer);

  state.waypointMarker
    ?.bringToFront?.();

  hs49ScheduleNavigationRedraw();
};

/* -------------------------------------------------- */
/* Hide & Seek zone and route                         */
/* -------------------------------------------------- */

drawHideSeekZone = function () {
  if (!state.hideSeek.layer) return;

  if (!state.hideSeek.zonePoint) {
    if (state.hideSeek.zoneCircle) {
      state.hideSeek.layer.removeLayer(
        state.hideSeek.zoneCircle
      );

      state.hideSeek.zoneCircle = null;
    }

    return;
  }

  const latlng = [
    state.hideSeek.zonePoint.lat,
    state.hideSeek.zonePoint.lng
  ];

  if (!state.hideSeek.zoneCircle) {
    state.hideSeek.zoneCircle =
      L.circle(latlng, {
        renderer:
          state.navigationSvgRenderer ||
          undefined,

        radius:
          state.hideSeek.zoneRadiusM,

        color:
          HIDE_SEEK_SHEEP_COLOUR,

        opacity: 0.9,

        fillColor:
          HIDE_SEEK_SHEEP_COLOUR,

        fillOpacity: 0.08,
        weight: 3,
        dashArray: "10 8",
        interactive: false
      }).addTo(state.hideSeek.layer);
  } else {
    state.hideSeek.zoneCircle.setLatLng(
      latlng
    );

    state.hideSeek.zoneCircle.setRadius(
      state.hideSeek.zoneRadiusM
    );
  }

  hs49ScheduleNavigationRedraw();
};

drawHideSeekRoute = function (coords) {
  clearHideSeekRoute({
    keepRequest: true
  });

  if (
    !state.hideSeek.layer ||
    !Array.isArray(coords) ||
    coords.length < 2
  ) {
    return;
  }

  const renderer =
    state.navigationSvgRenderer ||
    undefined;

  state.hideSeek.routeHalo =
    L.polyline(coords, {
      renderer,
      color: "#eef7ff",
      weight: 9,
      opacity: 0.7,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }).addTo(state.hideSeek.layer);

  state.hideSeek.routeLine =
    L.polyline(coords, {
      renderer,
      color:
        HIDE_SEEK_SHEEP_COLOUR,

      weight: 5,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }).addTo(state.hideSeek.layer);

  hs49ScheduleNavigationRedraw();
};

/* ================================================== */
/* Road Discovery AU v50 unified navigation marker   */
/* Append this block once to the bottom of app.js v49 */
/* ================================================== */

const HS50_ROUTE_MIN_REROUTE_TIME_MS = 15000;
const HS50_ROUTE_REROUTE_DISTANCE_M = 40;
const HS50_ROUTE_OFF_ROUTE_DISTANCE_M = 45;

const hideSeekV50 = {
  initMap
};

Object.assign(state, {
  hs50OriginalPanTo: null,
  hs50WaypointReroutePending: false,
  hs50HideSeekReroutePending: false
});

/* -------------------------------------------------- */
/* Stable map following                               */
/* -------------------------------------------------- */

initMap = function () {
  hideSeekV50.initMap();

  if (!state.map || typeof state.map.panTo !== "function") {
    return;
  }

  /*
    Leaflet Rotate and iPhone Safari can briefly render paths and
    markers in different frames when a new animated pan starts while
    the bearing is also changing. Keep heading-up following immediate
    and stable. North-up manual panning keeps Leaflet's normal options.
  */
  state.hs50OriginalPanTo = state.map.panTo.bind(state.map);

  state.map.panTo = function (latlng, options = {}) {
    const headingFollowActive =
      state.followUser &&
      state.mapHeadingMode === "heading" &&
      hs47NavigationIsActive();

    return state.hs50OriginalPanTo(
      latlng,
      headingFollowActive
        ? {
            ...options,
            animate: false
          }
        : options
    );
  };
};

hs47ApplyHeadingView = function (point) {
  const heading = hs47NormaliseDegrees(
    state.userHeadingDegrees
  );

  if (
    heading === null ||
    !state.followUser ||
    state.mapHeadingMode !== "heading" ||
    !hs47NavigationIsActive()
  ) {
    hs47StyleHeadingMarker();
    return;
  }

  /*
    Compass events only change the bearing. GPS events perform the
    actual centring through the existing GPS follow code. This avoids
    starting a map pan on every compass event.
  */
  hs47SetMapBearing(-heading);
  hs47StyleHeadingMarker();
};

/* -------------------------------------------------- */
/* One combined position + direction marker          */
/* -------------------------------------------------- */

function hs50OwnMarkerColour() {
  if (
    hasActiveHideSeekRound() &&
    state.hideSeek.phase === "starting"
  ) {
    return HIDE_SEEK_OUT_COLOUR;
  }

  if (
    hasActiveHideSeekRound() &&
    state.hideSeek.viewerRole === "wolf"
  ) {
    return HIDE_SEEK_WOLF_COLOUR;
  }

  return HIDE_SEEK_SHEEP_COLOUR;
}

function hs50OwnMarkerHaloColour() {
  if (
    hasActiveHideSeekRound() &&
    state.hideSeek.phase === "starting"
  ) {
    return "rgba(154, 163, 178, 0.24)";
  }

  if (
    hasActiveHideSeekRound() &&
    state.hideSeek.viewerRole === "wolf"
  ) {
    return "rgba(255, 77, 77, 0.24)";
  }

  return "rgba(75, 179, 255, 0.24)";
}

function hs50CombinedMarkerIcon() {
  return L.divIcon({
    className: "road-user-combined-icon",
    html: `
      <span class="road-user-combined" aria-hidden="true">
        <span class="road-user-combined-heading">
          <span class="road-user-combined-arrow"></span>
        </span>
        <span class="road-user-combined-halo"></span>
        <span class="road-user-combined-dot"></span>
      </span>
    `,
    iconSize: [52, 52],
    iconAnchor: [26, 26]
  });
}

function hs50RemoveSeparateDot() {
  if (!state.userMarker) return;

  try {
    state.map?.removeLayer(state.userMarker);
  } catch (error) {
    console.error(error);
  }

  state.userMarker = null;
}

hs47DrawHeadingMarker = function (point) {
  if (
    !state.map ||
    !Number.isFinite(Number(point?.lat)) ||
    !Number.isFinite(Number(point?.lng))
  ) {
    return;
  }

  hs50RemoveSeparateDot();

  const latlng = [Number(point.lat), Number(point.lng)];

  if (!state.userHeadingMarker) {
    state.userHeadingMarker = L.marker(latlng, {
      icon: hs50CombinedMarkerIcon(),
      pane: "userLocationPane",
      interactive: false,
      keyboard: false,
      zIndexOffset: 40
    }).addTo(state.map);
  } else {
    const markerElement = state.userHeadingMarker.getElement?.();

    if (!markerElement?.classList?.contains("road-user-combined-icon")) {
      state.userHeadingMarker.setIcon(hs50CombinedMarkerIcon());
    }

    state.userHeadingMarker.setLatLng(latlng);
    state.userHeadingMarker.setOpacity(1);
  }

  hs47StyleHeadingMarker();
};

hs47StyleHeadingMarker = function () {
  const element = state.userHeadingMarker?.getElement?.();

  if (!element) return;

  const heading = hs47NormaliseDegrees(
    state.userHeadingDegrees
  );

  const screenHeading =
    heading === null
      ? 0
      : hs47NormaliseDegrees(heading + hs47MapBearing()) || 0;

  element.style.setProperty(
    "--road-heading",
    `${screenHeading}deg`
  );

  element.style.setProperty(
    "--road-marker-colour",
    hs50OwnMarkerColour()
  );

  element.style.setProperty(
    "--road-marker-halo",
    hs50OwnMarkerHaloColour()
  );

  element.style.setProperty(
    "--road-heading-visible",
    heading === null ? "0" : "1"
  );
};

function hs50UpdateAccuracyCircle(point) {
  if (!state.map) return;

  const latlng = [Number(point.lat), Number(point.lng)];
  const accuracy = Number(point.accuracy);

  const radius =
    Number.isFinite(accuracy) && accuracy > 0
      ? accuracy
      : 20;

  const colour = hs50OwnMarkerColour();

  if (!state.accuracyCircle) {
    state.accuracyCircle = L.circle(latlng, {
      renderer: state.userAccuracySvgRenderer || undefined,
      pane: "userAccuracyPane",
      radius,
      color: colour,
      opacity: 0.35,
      fillColor: colour,
      fillOpacity: 0.06,
      weight: 1,
      interactive: false
    }).addTo(state.map);
  } else {
    state.accuracyCircle.setLatLng(latlng);
    state.accuracyCircle.setRadius(radius);

    state.accuracyCircle.setStyle({
      color: colour,
      fillColor: colour
    });
  }

  state.accuracyCircle.bringToFront?.();
}

updateUserMarker = function (point) {
  if (
    !state.map ||
    !Number.isFinite(Number(point?.lat)) ||
    !Number.isFinite(Number(point?.lng))
  ) {
    return;
  }

  /*
    One authoritative point now drives the dot, arrow
    and follow view.
  */
  state.currentPoint = point;

  hs50RemoveSeparateDot();
  hs50UpdateAccuracyCircle(point);

  hs48UpdateGpsCourse(point);
  hs48RefreshCompassListener();

  const selectedHeading = hs48SelectedHeading();

  if (selectedHeading !== null) {
    state.userHeadingDegrees = selectedHeading;
  }

  hs47DrawHeadingMarker(point);
  hs47ApplyHeadingView(point);
  hs49ScheduleNavigationRedraw();
};

applyHideSeekOwnMarkerStyle = function () {
  const colour = hs50OwnMarkerColour();

  state.accuracyCircle?.setStyle?.({
    color: colour,
    fillColor: colour
  });

  hs47StyleHeadingMarker();
};

/* -------------------------------------------------- */
/* Route refresh while travelling                    */
/* -------------------------------------------------- */

function hs50FlatRouteCoords(line) {
  const result = [];

  function add(value) {
    if (Array.isArray(value)) {
      for (const item of value) {
        add(item);
      }

      return;
    }

    const lat = Number(value?.lat);
    const lng = Number(value?.lng);

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      result.push([lat, lng]);
    }
  }

  add(line?.getLatLngs?.() || []);

  return result;
}

function hs50DistanceFromRouteM(point, line) {
  const coords = hs50FlatRouteCoords(line);

  if (coords.length < 2) {
    return Infinity;
  }

  let closest = Infinity;

  for (let index = 1; index < coords.length; index += 1) {
    closest = Math.min(
      closest,
      pointToSegmentDistance(
        point,
        coords[index - 1],
        coords[index]
      )
    );

    if (closest <= 8) {
      break;
    }
  }

  return closest;
}

function hs50RouteNeedsRefresh(point, line, lastStart, lastAt) {
  const accuracy = Number(point?.accuracy);

  if (
    !line ||
    !lastStart ||
    !Number.isFinite(accuracy) ||
    accuracy > MAX_GPS_ACCURACY_M ||
    Date.now() - Number(lastAt || 0) <
      HS50_ROUTE_MIN_REROUTE_TIME_MS
  ) {
    return false;
  }

  const moved = haversine(point, lastStart);

  if (moved >= HS50_ROUTE_REROUTE_DISTANCE_M) {
    return true;
  }

  return (
    hs50DistanceFromRouteM(point, line) >=
    HS50_ROUTE_OFF_ROUTE_DISTANCE_M
  );
}

maybeUpdateWaypointRoute = function (point) {
  if (!state.waypointPoint) return;

  if (
    haversine(point, state.waypointPoint) <=
    ROUTE_ARRIVAL_RADIUS_M
  ) {
    clearWaypoint(false);
    showToast("Waypoint reached");
    return;
  }

  if (
    state.isRouting ||
    state.hs50WaypointReroutePending ||
    !hs50RouteNeedsRefresh(
      point,
      state.routeLine,
      state.lastRouteStartPoint,
      state.lastRouteAt
    )
  ) {
    return;
  }

  state.hs50WaypointReroutePending = true;

  void routeToWaypoint({
    fit: false,
    silent: true
  }).finally(() => {
    state.hs50WaypointReroutePending = false;
  });
};

maybeUpdateHideSeekRoute = function (point) {
  if (
    state.hideSeek.viewerRole !== "sheep" ||
    state.hideSeek.phase !== "escape" ||
    !state.hideSeek.zonePoint ||
    state.hideSeek.routeLoading ||
    state.hs50HideSeekReroutePending ||
    !hs50RouteNeedsRefresh(
      point,
      state.hideSeek.routeLine,
      state.hideSeek.lastRouteStartPoint,
      state.hideSeek.lastRouteAt
    )
  ) {
    return;
  }

  state.hs50HideSeekReroutePending = true;

  void ensureHideSeekRoute({
    force: true
  }).finally(() => {
    state.hs50HideSeekReroutePending = false;
  });
};

/* ================================================== */
/* Road Discovery AU v51 hide GPS accuracy circle    */
/* Append this block once to the bottom of app.js v50 */
/* ================================================== */

hs50UpdateAccuracyCircle = function () {
  if (state.accuracyCircle && state.map) {
    state.map.removeLayer(state.accuracyCircle);
  }

  state.accuracyCircle = null;
};

/* ================================================== */
/* Road Discovery AU v52 shortest-turn arrow fix     */
/* Append this block once to the bottom of app.js v51 */
/* ================================================== */

Object.assign(state, {
  hs52DisplayedHeadingDegrees: null
});

hs47StyleHeadingMarker = function () {
  const element = state.userHeadingMarker?.getElement?.();

  if (!element) return;

  const heading = hs47NormaliseDegrees(
    state.userHeadingDegrees
  );

  if (heading !== null) {
    const targetHeading =
      hs47NormaliseDegrees(
        heading + hs47MapBearing()
      ) || 0;

    if (
      !Number.isFinite(
        state.hs52DisplayedHeadingDegrees
      )
    ) {
      state.hs52DisplayedHeadingDegrees =
        targetHeading;
    } else {
      const previousNormalised =
        hs47NormaliseDegrees(
          state.hs52DisplayedHeadingDegrees
        ) || 0;

      state.hs52DisplayedHeadingDegrees +=
        hs47ShortestBearingTurn(
          previousNormalised,
          targetHeading
        );
    }
  }

  element.style.setProperty(
    "--road-heading",
    `${state.hs52DisplayedHeadingDegrees || 0}deg`
  );

  element.style.setProperty(
    "--road-marker-colour",
    hs50OwnMarkerColour()
  );

  element.style.setProperty(
    "--road-marker-halo",
    hs50OwnMarkerHaloColour()
  );

  element.style.setProperty(
    "--road-heading-visible",
    heading === null ? "0" : "1"
  );
};
