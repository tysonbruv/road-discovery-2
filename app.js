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

const HIDE_SEEK_ZONE_RADIUS_M = 750;
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

/* ================================================== */
/* Road Discovery AU v53 clean map + My Roads toggle */
/* Append this block once to the bottom of app.js v52 */
/* ================================================== */

const RD53_MY_ROADS_VISIBLE_KEY =
  "roadDiscoveryAU.myRoadsVisible.v1";

const roadDiscoveryV53 = {
  ensureLocateButton,
  initMap,
  locateUser,
  startDrive,
  finishDrive
};

Object.assign(state, {
  myRoadsVisible: rd53LoadMyRoadsVisible(),
  driveRoadLayersPreparing: false
});

/* -------------------------------------------------- */
/* My Roads button                                    */
/* -------------------------------------------------- */

function rd53LoadMyRoadsVisible() {
  try {
    const stored = localStorage.getItem(
      RD53_MY_ROADS_VISIBLE_KEY
    );

    return stored === null
      ? true
      : stored === "true";
  } catch (error) {
    console.error(error);
    return true;
  }
}

function rd53SaveMyRoadsVisible() {
  try {
    localStorage.setItem(
      RD53_MY_ROADS_VISIBLE_KEY,
      String(state.myRoadsVisible)
    );
  } catch (error) {
    console.error(error);
  }
}

function rd53EnsureMyRoadsButton() {
  let button = $("myRoadsBtn");

  if (!button) {
    const toolStack =
      document.querySelector(".tool-stack");

    if (!toolStack) return;

    button = document.createElement("button");
    button.id = "myRoadsBtn";
    button.className =
      "tool-btn my-roads-toggle-btn";
    button.type = "button";

    button.innerHTML = `
      <svg
        class="my-roads-toggle-icon"
        viewBox="0 0 32 32"
        aria-hidden="true"
      >
        <path
          d="M5 25 C10 17 14 24 19 15 C22 10 25 9 28 6"
        ></path>
      </svg>
    `;

    const friendsButton = $("friendsBtn");

    if (
      friendsButton &&
      friendsButton.parentElement === toolStack
    ) {
      toolStack.insertBefore(
        button,
        friendsButton
      );
    } else {
      toolStack.appendChild(button);
    }

    button.addEventListener("click", () => {
      if (rd53DriveRoadLayersActive()) {
        return;
      }

      state.myRoadsVisible =
        !state.myRoadsVisible;

      rd53SaveMyRoadsVisible();
      rd53ApplyRoadLayerVisibility();

      showToast(
        state.myRoadsVisible
          ? "My orange roads shown"
          : "My orange roads hidden"
      );
    });
  }

  els.myRoadsBtn = button;
  rd53UpdateMyRoadsButton();
}

ensureLocateButton = function () {
  roadDiscoveryV53.ensureLocateButton();
  rd53EnsureMyRoadsButton();
};

function rd53UpdateMyRoadsButton() {
  const button =
    els.myRoadsBtn || $("myRoadsBtn");

  if (!button) return;

  const driveActive =
    rd53DriveRoadLayersActive();

  const visuallyOn =
    driveActive || state.myRoadsVisible;

  button.classList.toggle(
    "active",
    visuallyOn
  );

  button.classList.toggle(
    "drive-active",
    driveActive
  );

  button.disabled = driveActive;

  button.setAttribute(
    "aria-pressed",
    String(visuallyOn)
  );

  button.setAttribute(
    "aria-label",
    driveActive
      ? "My orange roads are shown during Drive Mode"
      : visuallyOn
        ? "Hide my orange roads"
        : "Show my orange roads"
  );

  button.title = driveActive
    ? "My Roads • shown during Drive"
    : visuallyOn
      ? "My Roads • visible"
      : "My Roads • hidden";
}

/* -------------------------------------------------- */
/* Road layer visibility                              */
/* -------------------------------------------------- */

function rd53DriveRoadLayersActive() {
  return Boolean(
    state.isRecording ||
    state.driveRoadLayersPreparing
  );
}

function rd53SetMapLayerVisible(
  layer,
  visible
) {
  if (!state.map || !layer) return;

  const isVisible =
    state.map.hasLayer(layer);

  if (visible && !isVisible) {
    layer.addTo(state.map);
  } else if (!visible && isVisible) {
    state.map.removeLayer(layer);
  }
}

function rd53ApplyRoadLayerVisibility() {
  if (!state.map) return;

  const driveActive =
    rd53DriveRoadLayersActive();

  /*
    Grey discovery chunks and the trip line
    only appear during Drive Mode.
  */
  rd53SetMapLayerVisible(
    state.roadsLayer,
    driveActive
  );

  rd53SetMapLayerVisible(
    state.tripLayer,
    driveActive
  );

  /*
    Saved orange roads are controlled
    separately outside Drive Mode.
  */
  rd53SetMapLayerVisible(
    state.savedLayer,
    driveActive || state.myRoadsVisible
  );

  rd53ApplySavedRoadZoomStyle();
  rd53UpdateMyRoadsButton();
}

/* -------------------------------------------------- */
/* Saved orange road styling                          */
/* -------------------------------------------------- */

function rd53SavedRoadStyle() {
  const zoom =
    Number(state.map?.getZoom?.());

  if (
    !Number.isFinite(zoom) ||
    zoom >= 14
  ) {
    return {
      weight: 5,
      opacity: 0.95
    };
  }

  if (zoom >= 13) {
    return {
      weight: 3,
      opacity: 0.8
    };
  }

  if (zoom >= 12) {
    return {
      weight: 2,
      opacity: 0.68
    };
  }

  return {
    weight: 1.25,
    opacity: 0.52
  };
}

function rd53ApplySavedRoadZoomStyle() {
  if (!state.savedLayer) return;

  const style = rd53SavedRoadStyle();

  state.savedLayer.eachLayer((layer) => {
    layer?.setStyle?.(style);
  });
}

drawSavedSegment = function (segment) {
  if (
    !state.savedLayer ||
    !segment ||
    !segment.id ||
    !validCoords(segment.coords) ||
    state.savedDrawnIds.has(segment.id)
  ) {
    return;
  }

  const zoomStyle =
    rd53SavedRoadStyle();

  L.polyline(segment.coords, {
    color: ROAD_ORANGE,
    weight: zoomStyle.weight,
    opacity: zoomStyle.opacity,
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  }).addTo(state.savedLayer);

  state.savedDrawnIds.add(segment.id);
};

/* -------------------------------------------------- */
/* Map startup and GPS preview                        */
/* -------------------------------------------------- */

initMap = function () {
  roadDiscoveryV53.initMap();

  if (!state.map) return;

  state.map.on("zoomend", () => {
    rd53ApplySavedRoadZoomStyle();
  });

  /*
    Start with a clean map:
    no grey discovery chunks.
  */
  rd53ApplyRoadLayerVisibility();
};

locateUser = async function (
  options = {}
) {
  const allowDiscoveryLoad =
    rd53DriveRoadLayersActive();

  return roadDiscoveryV53.locateUser({
    ...options,

    loadRoads:
      Boolean(options.loadRoads) &&
      allowDiscoveryLoad
  });
};

/* -------------------------------------------------- */
/* Drive Mode                                         */
/* -------------------------------------------------- */

startDrive = async function () {
  if (state.driveRoadLayersPreparing) {
    showToast("Drive is already starting");
    return;
  }

  if (state.isRecording) {
    return roadDiscoveryV53.startDrive();
  }

  state.driveRoadLayersPreparing = true;
  rd53ApplyRoadLayerVisibility();

  try {
    return await roadDiscoveryV53.startDrive();
  } finally {
    state.driveRoadLayersPreparing = false;
    rd53ApplyRoadLayerVisibility();
  }
};

finishDrive = function () {
  const result =
    roadDiscoveryV53.finishDrive();

  state.driveRoadLayersPreparing = false;
  rd53ApplyRoadLayerVisibility();

  return result;
};

/* ================================================== */
/* Road Discovery AU v54 Drive preparation overlay   */
/* Append this block once to the bottom of app.js v53 */
/* ================================================== */

const roadDiscoveryV54 = {
  startDrive,
  ensureRoadsNearPoint
};

Object.assign(state, {
  drivePreparationOverlayActive: false,
  drivePreparationStage: ""
});

function rd54EnsureDrivePreparationOverlay() {
  let overlay =
    $("drivePreparationOverlay");

  if (overlay) return overlay;

  const appShell = $("appShell");

  if (!appShell) return null;

  overlay =
    document.createElement("section");

  overlay.id =
    "drivePreparationOverlay";

  overlay.className =
    "drive-preparation-overlay hidden";

  overlay.setAttribute(
    "role",
    "dialog"
  );

  overlay.setAttribute(
    "aria-modal",
    "true"
  );

  overlay.setAttribute(
    "aria-labelledby",
    "drivePreparationTitle"
  );

  overlay.innerHTML = `
    <div class="drive-preparation-card">
      <div
        class="drive-preparation-spinner"
        aria-hidden="true"
      ></div>

      <h2 id="drivePreparationTitle">
        Preparing Drive
      </h2>

      <p
        id="drivePreparationMessage"
        class="drive-preparation-message"
      >
        Please wait while Road Discovery gets ready.
      </p>

      <ol
        class="drive-preparation-stages"
        aria-live="polite"
      >
        <li data-drive-stage="gps">
          <span class="drive-preparation-stage-mark">
            1
          </span>

          <span>
            Finding a clean GPS location
          </span>
        </li>

        <li data-drive-stage="roads">
          <span class="drive-preparation-stage-mark">
            2
          </span>

          <span>
            Loading nearby roads
          </span>
        </li>

        <li data-drive-stage="ready">
          <span class="drive-preparation-stage-mark">
            3
          </span>

          <span>
            Preparing road discovery
          </span>
        </li>
      </ol>

      <p class="drive-preparation-safety">
        Start your drive while safely stopped.
        Do not interact with the app while driving.
      </p>

      <div
        id="drivePreparationActions"
        class="drive-preparation-actions hidden"
      >
        <button
          id="retryDrivePreparationBtn"
          class="drive-preparation-retry-btn"
          type="button"
        >
          Try Again
        </button>

        <button
          id="cancelDrivePreparationBtn"
          class="drive-preparation-cancel-btn"
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  `;

  appShell.appendChild(overlay);

  $("retryDrivePreparationBtn")
    ?.addEventListener("click", () => {
      rd54HideDrivePreparationOverlay();

      window.setTimeout(() => {
        void startDrive();
      }, 0);
    });

  $("cancelDrivePreparationBtn")
    ?.addEventListener("click", () => {
      rd54HideDrivePreparationOverlay();
    });

  return overlay;
}

function rd54SetDrivePreparationText(
  title,
  message
) {
  const titleElement =
    $("drivePreparationTitle");

  const messageElement =
    $("drivePreparationMessage");

  if (titleElement) {
    titleElement.textContent = title;
  }

  if (messageElement) {
    messageElement.textContent = message;
  }
}

function rd54SetDrivePreparationStage(
  stage
) {
  const stages = [
    "gps",
    "roads",
    "ready"
  ];

  const activeIndex =
    stages.indexOf(stage);

  state.drivePreparationStage = stage;

  for (
    const item of
    document.querySelectorAll(
      "[data-drive-stage]"
    )
  ) {
    const itemStage =
      item.getAttribute(
        "data-drive-stage"
      );

    const itemIndex =
      stages.indexOf(itemStage);

    item.classList.toggle(
      "active",
      itemStage === stage
    );

    item.classList.toggle(
      "complete",
      activeIndex >= 0 &&
      itemIndex < activeIndex
    );
  }
}

function rd54ShowDrivePreparationOverlay() {
  const overlay =
    rd54EnsureDrivePreparationOverlay();

  if (!overlay) return;

  state.drivePreparationOverlayActive =
    true;

  overlay.classList.remove(
    "hidden",
    "error",
    "success"
  );

  $("drivePreparationActions")
    ?.classList.add("hidden");

  rd54SetDrivePreparationText(
    "Preparing Drive",
    "Please wait while Road Discovery gets your location and loads nearby roads."
  );

  rd54SetDrivePreparationStage("gps");
}

function rd54HideDrivePreparationOverlay() {
  state.drivePreparationOverlayActive =
    false;

  state.drivePreparationStage = "";

  const overlay =
    $("drivePreparationOverlay");

  overlay?.classList.add("hidden");

  overlay?.classList.remove(
    "error",
    "success"
  );
}

function rd54ShowDrivePreparationFailure() {
  const overlay =
    rd54EnsureDrivePreparationOverlay();

  if (!overlay) return;

  const driveStatus = String(
    els.driveStatus?.textContent || ""
  ).toLowerCase();

  const roadsFailed =
    driveStatus.includes("road") ||
    state.drivePreparationStage ===
      "roads" ||
    state.drivePreparationStage ===
      "ready";

  overlay.classList.remove("success");
  overlay.classList.add("error");

  rd54SetDrivePreparationText(
    roadsFailed
      ? "Roads couldn't load"
      : "Drive couldn't start",

    roadsFailed
      ? "Check your internet connection or reception, then try again when safely stopped."
      : "A clean GPS location couldn't be found. Move outside, check location permission and try again when safely stopped."
  );

  $("drivePreparationActions")
    ?.classList.remove("hidden");
}

function rd54ShowDrivePreparationSuccess() {
  const overlay =
    $("drivePreparationOverlay");

  if (!overlay) return;

  overlay.classList.remove("error");
  overlay.classList.add("success");

  rd54SetDrivePreparationStage("ready");

  for (
    const item of
    document.querySelectorAll(
      "[data-drive-stage]"
    )
  ) {
    item.classList.remove("active");
    item.classList.add("complete");
  }

  rd54SetDrivePreparationText(
    "Drive ready",
    "Road discovery is now active."
  );
}

ensureRoadsNearPoint =
  async function (
    point,
    options = {}
  ) {
    const preparingDrive =
      state.drivePreparationOverlayActive &&
      state.driveRoadLayersPreparing &&
      !state.isRecording;

    if (preparingDrive) {
      rd54SetDrivePreparationStage(
        "roads"
      );

      rd54SetDrivePreparationText(
        "Preparing Drive",
        "Loading nearby roads. This may take a few seconds."
      );
    }

    const result =
      await roadDiscoveryV54
        .ensureRoadsNearPoint(
          point,
          options
        );

    if (preparingDrive && result) {
      rd54SetDrivePreparationStage(
        "ready"
      );

      rd54SetDrivePreparationText(
        "Preparing Drive",
        "Nearby roads loaded. Preparing road discovery."
      );
    }

    return result;
  };

startDrive = async function () {
  if (state.isRecording) {
    return roadDiscoveryV54.startDrive();
  }

  if (
    state.drivePreparationOverlayActive ||
    state.driveRoadLayersPreparing
  ) {
    return;
  }

  rd54ShowDrivePreparationOverlay();

  try {
    const result =
      await roadDiscoveryV54.startDrive();

    if (state.isRecording) {
      rd54ShowDrivePreparationSuccess();

      window.setTimeout(() => {
        if (state.isRecording) {
          rd54HideDrivePreparationOverlay();
        }
      }, 650);
    } else {
      rd54ShowDrivePreparationFailure();
    }

    return result;
  } catch (error) {
    console.error(error);

    rd54ShowDrivePreparationFailure();

    return undefined;
  }
};

/* ================================================== */
/* Road Discovery AU v55 two-finger map rotation     */
/* Append this block once to the bottom of app.js v54 */
/* ================================================== */

const RD55_MANUAL_ROTATION_THRESHOLD_DEG = 4;

const roadDiscoveryV55 = {
  initMap
};

Object.assign(state, {
  rd55TouchGestureActive: false,
  rd55TouchStartBearing: 0,
  rd55TouchRotationTravel: 0,
  rd55PreviousHeadingMode: "heading",
  rd55PreviousFollowUser: true
});

/* -------------------------------------------------- */
/* Map setup                                          */
/* -------------------------------------------------- */

initMap = function () {
  roadDiscoveryV55.initMap();

  if (!state.map || !state.map.touchRotate) {
    return;
  }

  /*
    Leaflet Rotate keeps two-finger zoom and two-finger rotation in
    the same gesture handler. v47 deliberately left touch rotation
    disabled; enable only that existing handler here.
  */
  state.map.touchRotate.enable();

  const mapContainer = state.map.getContainer?.();

  if (!mapContainer) return;

  mapContainer.addEventListener(
    "touchstart",
    rd55HandleTouchStart,
    { passive: true }
  );

  mapContainer.addEventListener(
    "touchend",
    rd55HandleTouchEnd,
    { passive: true }
  );

  mapContainer.addEventListener(
    "touchcancel",
    rd55HandleTouchEnd,
    { passive: true }
  );

  state.map.on("rotate", rd55TrackTouchRotation);
};

/* -------------------------------------------------- */
/* Gesture ownership                                  */
/* -------------------------------------------------- */

function rd55HandleTouchStart(event) {
  if (event.touches?.length !== 2 || !state.map) {
    return;
  }

  const bearing = hs47MapBearing();

  state.rd55TouchGestureActive = true;
  state.rd55TouchStartBearing = bearing;
  state.rd55TouchRotationTravel = 0;
  state.rd55PreviousHeadingMode = state.mapHeadingMode;
  state.rd55PreviousFollowUser = state.followUser;

  /*
    Stop compass/GPS bearing updates before the fingers begin moving.
    Location updates may still centre the map while the gesture owns
    its bearing.
  */
  hs47CancelBearingAnimation();
  state.mapHeadingMode = "manual-pending";
  hs47UpdateNorthIndicator();
}

function rd55TrackTouchRotation() {
  if (!state.rd55TouchGestureActive) return;

  const bearing = hs47MapBearing();
  const turnFromStart = Math.abs(
    hs47ShortestBearingTurn(
      state.rd55TouchStartBearing,
      bearing
    )
  );

  state.rd55TouchRotationTravel = Math.max(
    state.rd55TouchRotationTravel,
    turnFromStart
  );

  hs47StyleHeadingMarker();
  hs49ScheduleNavigationRedraw();
}

function rd55HandleTouchEnd(event) {
  if (
    !state.rd55TouchGestureActive ||
    (event.touches && event.touches.length >= 2)
  ) {
    return;
  }

  /*
    Leaflet completes its combined zoom/rotation calculation on the
    same touchend. Finish on the next frame so its final bearing has
    already been applied.
  */
  window.requestAnimationFrame(() => {
    rd55FinishTouchGesture();
  });
}

function rd55FinishTouchGesture() {
  if (!state.rd55TouchGestureActive) return;

  rd55TrackTouchRotation();

  const deliberatelyRotated =
    state.rd55TouchRotationTravel >=
    RD55_MANUAL_ROTATION_THRESHOLD_DEG;

  state.rd55TouchGestureActive = false;

  if (deliberatelyRotated) {
    /*
      Keep the chosen angle and stop automatic heading rotation.
    */
    state.mapHeadingMode = "manual";
  } else {
    /*
      An ordinary pinch zoom must not change navigation mode.
    */
    state.mapHeadingMode = state.rd55PreviousHeadingMode;
    state.followUser = state.rd55PreviousFollowUser;

    if (
      state.mapHeadingMode === "heading" &&
      state.followUser &&
      state.currentPoint &&
      hs47NavigationIsActive() &&
      hs47NormaliseDegrees(state.userHeadingDegrees) !== null
    ) {
      hs47ApplyHeadingView(state.currentPoint);
    } else {
      hs47SetMapBearing(state.rd55TouchStartBearing);
    }
  }

  hs47UpdateNorthIndicator();
  hs47StyleHeadingMarker();
  hs49ScheduleNavigationRedraw();
}

/* -------------------------------------------------- */
/* North indicator text                               */
/* -------------------------------------------------- */

const rd55PreviousUpdateNorthIndicator =
  hs47UpdateNorthIndicator;

hs47UpdateNorthIndicator = function () {
  rd55PreviousUpdateNorthIndicator();

  const indicator = $("mapNorthIndicator");

  if (!indicator) return;

  const manualRotation = [
    "manual",
    "manual-pending"
  ].includes(state.mapHeadingMode);

  indicator.classList.toggle(
    "manual-rotation",
    manualRotation
  );

  if (manualRotation) {
    indicator.title =
      "Manual rotation • Tap for north-up";

    indicator.setAttribute(
      "aria-label",
      "Map manually rotated. Return map to north-up."
    );
  } else {
    indicator.setAttribute(
      "aria-label",
      state.mapHeadingMode === "heading" &&
      state.followUser
        ? "Heading-up map. Return map to north-up."
        : "Return map to north-up."
    );
  }
};

/* ================================================== */
/* Road Discovery AU v56 gesture road-layer guard    */
/* Append this block once to the bottom of app.js v55 */
/* ================================================== */

const roadDiscoveryV56 = {
  touchStart: rd55HandleTouchStart,
  finishTouch: rd55FinishTouchGesture
};

Object.assign(state, {
  rd56RoadOverlaysHidden: false,
  rd56RestoreFrameOne: null,
  rd56RestoreFrameTwo: null
});

function rd56EnsureGestureRoadStyle() {
  if ($("rd56GestureRoadStyle")) return;

  const style = document.createElement("style");
  style.id = "rd56GestureRoadStyle";
  style.textContent = `
    .rd56-road-gesture-active
      .leaflet-overlay-pane canvas {
      visibility: hidden !important;
    }
  `;

  document.head.appendChild(style);
}

function rd56CancelRestoreFrames() {
  if (state.rd56RestoreFrameOne !== null) {
    window.cancelAnimationFrame(
      state.rd56RestoreFrameOne
    );

    state.rd56RestoreFrameOne = null;
  }

  if (state.rd56RestoreFrameTwo !== null) {
    window.cancelAnimationFrame(
      state.rd56RestoreFrameTwo
    );

    state.rd56RestoreFrameTwo = null;
  }
}

function rd56HideRoadOverlaysForGesture() {
  const mapContainer = state.map?.getContainer?.();

  if (!mapContainer) return;

  rd56EnsureGestureRoadStyle();
  rd56CancelRestoreFrames();

  state.rd56RoadOverlaysHidden = true;

  mapContainer.classList.add(
    "rd56-road-gesture-active"
  );
}

function rd56RestoreRoadOverlaysAfterGesture() {
  const mapContainer = state.map?.getContainer?.();

  if (!mapContainer) {
    state.rd56RoadOverlaysHidden = false;
    return;
  }

  rd56CancelRestoreFrames();

  /*
    Leaflet finalises its Canvas position after the touch gesture.
    Keep the road Canvas hidden for two render frames so it is only
    revealed after that final calculation has completed.
  */
  state.rd56RestoreFrameOne =
    window.requestAnimationFrame(() => {
      state.rd56RestoreFrameOne = null;

      hs49ScheduleNavigationRedraw();

      state.rd56RestoreFrameTwo =
        window.requestAnimationFrame(() => {
          state.rd56RestoreFrameTwo = null;
          state.rd56RoadOverlaysHidden = false;

          mapContainer.classList.remove(
            "rd56-road-gesture-active"
          );
        });
    });
}

rd55HandleTouchStart = function (event) {
  roadDiscoveryV56.touchStart(event);

  if (state.rd55TouchGestureActive) {
    rd56HideRoadOverlaysForGesture();
  }
};

rd55FinishTouchGesture = function () {
  const gestureWasActive =
    state.rd55TouchGestureActive;

  roadDiscoveryV56.finishTouch();

  if (gestureWasActive) {
    rd56RestoreRoadOverlaysAfterGesture();
  }
};

document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "hidden" &&
    state.rd56RoadOverlaysHidden
  ) {
    rd56CancelRestoreFrames();

    state.rd56RoadOverlaysHidden = false;
    state.rd55TouchGestureActive = false;
    state.mapHeadingMode =
      state.rd55PreviousHeadingMode;
    state.followUser =
      state.rd55PreviousFollowUser;

    state.map
      ?.getContainer?.()
      ?.classList.remove(
        "rd56-road-gesture-active"
      );

    hs47UpdateNorthIndicator();
  }
});

rd56EnsureGestureRoadStyle();

/* ================================================== */
/* Road Discovery AU v57 clean Drive coverage area   */
/* Append this block once to the bottom of app.js v56 */
/* ================================================== */

const roadDiscoveryV57 = {
  initMap,
  loadRoads,
  startDrive,
  redrawNavigationPaths:
    hs49RedrawNavigationPaths
};

Object.assign(state, {
  rd57RoadCoverageCircle: null,
  rd57RoadCoverageLoading: false
});

/* -------------------------------------------------- */
/* Keep discovery chunks loaded but visually hidden  */
/* -------------------------------------------------- */

rd53ApplyRoadLayerVisibility = function () {
  if (!state.map) return;

  const driveActive =
    rd53DriveRoadLayersActive();

  /*
    The road chunks remain loaded in roadsLayer and
    state.roadSegments for the discovery engine.

    Only the visible grey layer remains off the map.
  */
  rd53SetMapLayerVisible(
    state.roadsLayer,
    false
  );

  /*
    Preserve the existing current-trip line.
  */
  rd53SetMapLayerVisible(
    state.tripLayer,
    driveActive
  );

  /*
    Saved orange roads remain visible during Drive
    Mode. Newly discovered chunks continue appearing
    immediately through this layer.
  */
  rd53SetMapLayerVisible(
    state.savedLayer,
    driveActive || state.myRoadsVisible
  );

  if (
    driveActive &&
    state.lastRoadLoadCenter
  ) {
    rd57DrawRoadCoverage(
      state.lastRoadLoadCenter,
      LOAD_RADIUS_M,
      state.rd57RoadCoverageLoading
    );
  } else if (!driveActive) {
    rd57RemoveRoadCoverage();
  }

  rd53ApplySavedRoadZoomStyle();
  rd53UpdateMyRoadsButton();
};

/* -------------------------------------------------- */
/* Blue loaded-area boundary                          */
/* -------------------------------------------------- */

function rd57DrawRoadCoverage(
  centre,
  radiusM = LOAD_RADIUS_M,
  loading = false
) {
  if (
    !state.map ||
    !rd53DriveRoadLayersActive() ||
    !Number.isFinite(Number(centre?.lat)) ||
    !Number.isFinite(Number(centre?.lng))
  ) {
    return;
  }

  const latlng = [
    Number(centre.lat),
    Number(centre.lng)
  ];

  const style = {
    color: ROUTE_BLUE,
    opacity: loading ? 0.95 : 0.72,
    fillColor: ROUTE_BLUE,
    fillOpacity: loading ? 0.055 : 0.025,
    weight: loading ? 3 : 2,
    dashArray: loading ? "7 7" : "12 10",
    lineCap: "round",
    interactive: false
  };

  if (!state.rd57RoadCoverageCircle) {
    state.rd57RoadCoverageCircle = L.circle(
      latlng,
      {
        ...style,
        renderer:
          state.navigationSvgRenderer ||
          undefined,
        radius:
          Number(radiusM) || LOAD_RADIUS_M
      }
    ).addTo(state.map);
  } else {
    state.rd57RoadCoverageCircle.setLatLng(
      latlng
    );

    state.rd57RoadCoverageCircle.setRadius(
      Number(radiusM) || LOAD_RADIUS_M
    );

    state.rd57RoadCoverageCircle.setStyle(
      style
    );

    if (
      !state.map.hasLayer(
        state.rd57RoadCoverageCircle
      )
    ) {
      state.rd57RoadCoverageCircle.addTo(
        state.map
      );
    }
  }

  state.rd57RoadCoverageCircle
    .bringToBack?.();

  state.rd57RoadCoverageCircle
    .redraw?.();
}

function rd57RemoveRoadCoverage() {
  if (!state.rd57RoadCoverageCircle) {
    return;
  }

  try {
    state.map?.removeLayer(
      state.rd57RoadCoverageCircle
    );
  } catch (error) {
    console.error(error);
  }

  state.rd57RoadCoverageCircle = null;
  state.rd57RoadCoverageLoading = false;
}

/*
  Keep the boundary aligned with navigation routes
  during zooming and rotation.
*/
hs49RedrawNavigationPaths = function () {
  roadDiscoveryV57.redrawNavigationPaths();

  state.rd57RoadCoverageCircle
    ?.redraw?.();
};

/* -------------------------------------------------- */
/* Follow each successful road-loading centre        */
/* -------------------------------------------------- */

loadRoads = function (
  lat,
  lng,
  radiusM,
  options = {}
) {
  const driveLoad =
    rd53DriveRoadLayersActive();

  const previousCentre =
    state.lastRoadLoadCenter
      ? { ...state.lastRoadLoadCenter }
      : null;

  if (driveLoad) {
    state.rd57RoadCoverageLoading = true;

    rd57DrawRoadCoverage(
      {
        lat: Number(lat),
        lng: Number(lng)
      },
      radiusM,
      true
    );
  }

  const result = roadDiscoveryV57.loadRoads(
    lat,
    lng,
    radiusM,
    options
  );

  return Promise.resolve(result).then(
    (loaded) => {
      if (!driveLoad) {
        return loaded;
      }

      state.rd57RoadCoverageLoading = false;

      if (
        loaded &&
        state.lastRoadLoadCenter
      ) {
        rd57DrawRoadCoverage(
          state.lastRoadLoadCenter,
          radiusM,
          false
        );
      } else if (
        options.reason === "auto" &&
        previousCentre
      ) {
        /*
          An auto-load failure keeps the last
          successful boundary.
        */
        rd57DrawRoadCoverage(
          previousCentre,
          LOAD_RADIUS_M,
          false
        );
      } else {
        rd57RemoveRoadCoverage();
      }

      return loaded;
    }
  );
};

/* -------------------------------------------------- */
/* Drive lifecycle                                    */
/* -------------------------------------------------- */

startDrive = async function () {
  const result =
    await roadDiscoveryV57.startDrive();

  if (
    state.isRecording &&
    state.lastRoadLoadCenter
  ) {
    state.rd57RoadCoverageLoading = false;

    rd57DrawRoadCoverage(
      state.lastRoadLoadCenter,
      LOAD_RADIUS_M,
      false
    );
  } else if (
    !rd53DriveRoadLayersActive()
  ) {
    rd57RemoveRoadCoverage();
  }

  rd53ApplyRoadLayerVisibility();

  return result;
};

/*
  Ensure the grey road layer starts hidden on a
  freshly opened map.
*/
initMap = function () {
  roadDiscoveryV57.initMap();
  rd53ApplyRoadLayerVisibility();
};

/* ================================================== */
/* Road Discovery AU v58 sheep Ready fast-forward    */
/* Append this block once to the bottom of app.js v57 */
/* ================================================== */

const RD58_ESCAPE_SECONDS = 5 * 60;
const RD58_READY_POLL_MS = 2000;

const roadDiscoveryV58 = {
  bindEvents,
  resetHideSeekState,
  renderHideSeekState,
  pollHideSeekState,
  applyHideSeekRows
};

Object.assign(state.hideSeek, {
  readyPolling: false,
  readySubmitting: false,
  readyPollTimer: null,
  readyRoundId: "",
  sheepReadyCount: 0,
  sheepTotal: 0,
  viewerReady: false,
  viewerCanReady: false,
  fastCountdownActive: false
});

function rd58CacheReadyElements() {
  [
    "hideSeekReadyPanel",
    "hideSeekReadyStatus",
    "hideSeekReadyBtn",
    "hideSeekMapReadyPanel",
    "hideSeekMapReadyStatus",
    "hideSeekMapReadyBtn"
  ].forEach((id) => {
    els[id] = $(id);
  });
}

/* -------------------------------------------------- */
/* Events                                             */
/* -------------------------------------------------- */

bindEvents = function () {
  roadDiscoveryV58.bindEvents();
  rd58CacheReadyElements();

  els.hideSeekReadyBtn?.addEventListener(
    "click",
    rd58SetSheepReady
  );

  els.hideSeekMapReadyBtn?.addEventListener(
    "click",
    rd58SetSheepReady
  );
};

/* -------------------------------------------------- */
/* State lifecycle                                    */
/* -------------------------------------------------- */

function rd58ResetReadyState() {
  state.hideSeek.readyPolling = false;
  state.hideSeek.readySubmitting = false;
  state.hideSeek.readyRoundId = "";
  state.hideSeek.sheepReadyCount = 0;
  state.hideSeek.sheepTotal = 0;
  state.hideSeek.viewerReady = false;
  state.hideSeek.viewerCanReady = false;
  state.hideSeek.fastCountdownActive = false;
}

function rd58StopReadyPolling() {
  if (
    state.hideSeek.readyPollTimer !== null
  ) {
    window.clearInterval(
      state.hideSeek.readyPollTimer
    );

    state.hideSeek.readyPollTimer = null;
  }
}

function rd58SyncReadyPolling() {
  const shouldPoll = Boolean(
    state.hideSeek.roundId &&
    state.hideSeek.phase === "escape" &&
    hasActiveMultiplayerRoom()
  );

  if (!shouldPoll) {
    rd58StopReadyPolling();
    return;
  }

  if (
    state.hideSeek.readyPollTimer !== null
  ) {
    return;
  }

  state.hideSeek.readyPollTimer =
    window.setInterval(
      () => {
        void rd58PollReadyState();
      },
      RD58_READY_POLL_MS
    );
}

resetHideSeekState = function (
  options = {}
) {
  if (options.clearRound !== false) {
    rd58StopReadyPolling();
    rd58ResetReadyState();
  }

  return roadDiscoveryV58
    .resetHideSeekState(options);
};

/* -------------------------------------------------- */
/* Preserve the real role-reveal time                 */
/* -------------------------------------------------- */

applyHideSeekRows = function (rows) {
  const first = rows?.[0];

  const incomingRoundId = String(
    first?.round_id || ""
  );

  const previousRoundId =
    state.hideSeek.roundId;

  const previousRoleRevealAt =
    state.hideSeek.roleRevealAt;

  const escapeEndsMs = Date.parse(
    first?.escape_ends_at || ""
  );

  roadDiscoveryV58.applyHideSeekRows(rows);

  if (
    incomingRoundId &&
    incomingRoundId === previousRoundId &&
    previousRoleRevealAt
  ) {
    state.hideSeek.roleRevealAt =
      previousRoleRevealAt;
  } else if (
    String(first?.phase || "") ===
      "starting" &&
    Number.isFinite(escapeEndsMs)
  ) {
    state.hideSeek.roleRevealAt =
      new Date(
        escapeEndsMs -
          RD58_ESCAPE_SECONDS * 1000
      ).toISOString();
  }

  rd58SyncReadyPolling();
};

/* -------------------------------------------------- */
/* Secure aggregate Ready polling                    */
/* -------------------------------------------------- */

async function rd58PollReadyState(
  options = {}
) {
  const { force = false } = options;

  if (
    !state.hideSeek.roundId ||
    !hasActiveMultiplayerRoom() ||
    !state.auth.client ||
    !state.auth.user ||
    state.hideSeek.readyPolling ||
    (!force && !navigator.onLine)
  ) {
    return;
  }

  state.hideSeek.readyPolling = true;

  const { data, error } =
    await state.auth.client.rpc(
      "get_hide_seek_ready_state",
      {
        p_room_id:
          state.multiplayer.roomId
      }
    );

  state.hideSeek.readyPolling = false;

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

  const fastCountdownWasActive =
    state.hideSeek.fastCountdownActive;

  state.hideSeek.readyRoundId = String(
    row.round_id || ""
  );

  state.hideSeek.sheepReadyCount =
    Math.max(
      0,
      Number(row.sheep_ready_count) || 0
    );

  state.hideSeek.sheepTotal = Math.max(
    0,
    Number(row.sheep_total) || 0
  );

  state.hideSeek.viewerReady = Boolean(
    row.viewer_ready
  );

  state.hideSeek.viewerCanReady = Boolean(
    row.viewer_can_ready
  );

  state.hideSeek.fastCountdownActive =
    Boolean(row.fast_countdown_active);

  if (row.escape_ends_at) {
    state.hideSeek.escapeEndsAt =
      row.escape_ends_at;
  }

  if (row.hunt_ends_at) {
    state.hideSeek.huntEndsAt =
      row.hunt_ends_at;
  }

  const serverNowMs = Date.parse(
    row.server_now || ""
  );

  if (Number.isFinite(serverNowMs)) {
    state.hideSeek.serverOffsetMs =
      serverNowMs - Date.now();
  }

  if (
    state.hideSeek.fastCountdownActive &&
    !fastCountdownWasActive
  ) {
    showToast(
      "All sheep ready • Wolf starts in 10 seconds"
    );
  }

  if (
    String(row.phase || "") === "hunt" &&
    state.hideSeek.phase === "escape"
  ) {
    void pollHideSeekState({
      force: true
    });
  }

  renderHideSeekState();
}

pollHideSeekState = async function (
  options = {}
) {
  await roadDiscoveryV58
    .pollHideSeekState(options);

  if (state.hideSeek.roundId) {
    await rd58PollReadyState(options);
  }

  rd58SyncReadyPolling();
};

/* -------------------------------------------------- */
/* Sheep Ready action                                 */
/* -------------------------------------------------- */

async function rd58SetSheepReady() {
  if (
    !state.hideSeek.roundId ||
    state.hideSeek.phase !== "escape" ||
    state.hideSeek.viewerRole !==
      "sheep" ||
    state.hideSeek.viewerReady ||
    !state.hideSeek.viewerCanReady ||
    state.hideSeek.readySubmitting ||
    !state.auth.client ||
    !navigator.onLine
  ) {
    return;
  }

  state.hideSeek.readySubmitting = true;
  renderHideSeekState();

  if (state.currentPoint) {
    await maybeSendHideSeekLocation(
      state.currentPoint,
      {
        force: true
      }
    );
  }

  const { error } =
    await state.auth.client.rpc(
      "set_hide_seek_ready",
      {
        p_round_id:
          state.hideSeek.roundId
      }
    );

  state.hideSeek.readySubmitting = false;

  if (error) {
    console.error(error);

    showToast(
      hideSeekErrorMessage(error)
    );

    await rd58PollReadyState({
      force: true
    });

    renderHideSeekState();
    return;
  }

  showToast("You are ready");

  await rd58PollReadyState({
    force: true
  });

  await pollHideSeekState({
    force: true
  });
}

/* -------------------------------------------------- */
/* Ready interface                                    */
/* -------------------------------------------------- */

function rd58ReadyStatusText() {
  const ready =
    state.hideSeek.sheepReadyCount;

  const total =
    state.hideSeek.sheepTotal;

  if (
    state.hideSeek.fastCountdownActive
  ) {
    return (
      "All sheep ready • Wolf starts " +
      "when the timer reaches zero"
    );
  }

  if (
    state.hideSeek.viewerRole === "wolf"
  ) {
    return (
      `${ready} of ${total} sheep ready`
    );
  }

  if (state.hideSeek.viewerReady) {
    return (
      `${ready} of ${total} sheep ready` +
      " • Stay inside the zone"
    );
  }

  if (state.hideSeek.viewerCanReady) {
    return (
      `${ready} of ${total} sheep ready` +
      " • You are inside the zone"
    );
  }

  return (
    `${ready} of ${total} sheep ready` +
    " • Reach the zone first"
  );
}

function rd58RenderReadyButton(button) {
  if (!button) return;

  const showButton =
    state.hideSeek.phase === "escape" &&
    state.hideSeek.viewerRole ===
      "sheep" &&
    !state.hideSeek.fastCountdownActive;

  button.classList.toggle(
    "hidden",
    !showButton
  );

  if (!showButton) return;

  button.disabled =
    state.hideSeek.readySubmitting ||
    state.hideSeek.viewerReady ||
    !state.hideSeek.viewerCanReady;

  button.classList.toggle(
    "ready",
    state.hideSeek.viewerReady
  );

  button.textContent =
    state.hideSeek.readySubmitting
      ? "Setting Ready..."
      : state.hideSeek.viewerReady
        ? "Ready ✓"
        : state.hideSeek.viewerCanReady
          ? "Ready"
          : "Reach Zone";
}

function rd58RenderReadyUI() {
  const visible =
    Boolean(state.hideSeek.roundId) &&
    state.hideSeek.phase === "escape";

  const statusText = visible
    ? rd58ReadyStatusText()
    : "";

  els.hideSeekReadyPanel?.classList.toggle(
    "hidden",
    !visible
  );

  els.hideSeekMapReadyPanel
    ?.classList.toggle(
      "hidden",
      !visible
    );

  if (els.hideSeekReadyStatus) {
    els.hideSeekReadyStatus.textContent =
      statusText;
  }

  if (els.hideSeekMapReadyStatus) {
    els.hideSeekMapReadyStatus.textContent =
      statusText;
  }

  rd58RenderReadyButton(
    els.hideSeekReadyBtn
  );

  rd58RenderReadyButton(
    els.hideSeekMapReadyBtn
  );

  if (
    visible &&
    state.hideSeek.fastCountdownActive
  ) {
    if (els.hideSeekPhaseBadge) {
      els.hideSeekPhaseBadge.textContent =
        "Get ready";
    }

    if (els.hideSeekMapPhase) {
      els.hideSeekMapPhase.textContent =
        "Wolf starts soon";
    }

    if (els.hideSeekGameStatus) {
      els.hideSeekGameStatus.textContent =
        "All sheep are ready. The hunt " +
        "begins when the countdown " +
        "reaches zero.";
    }
  }
}

renderHideSeekState = function () {
  roadDiscoveryV58.renderHideSeekState();

  rd58CacheReadyElements();
  rd58RenderReadyUI();
  rd58SyncReadyPolling();
};

/* ================================================== */
/* Road Discovery AU v59 Hide & Seek map layout      */
/* Append this block once to the bottom of app.js v58 */
/* ================================================== */

const roadDiscoveryV59 = {
  resetHideSeekState,
  renderHideSeekState
};

function rd59ApplyHideSeekPlayingLayout() {
  const playing = Boolean(
    state.hideSeek.roundId &&
    ["starting", "escape", "hunt"].includes(
      state.hideSeek.phase
    )
  );

  document.body.classList.toggle(
    "hide-seek-playing-layout",
    playing
  );
}

resetHideSeekState = function (options = {}) {
  const result = roadDiscoveryV59.resetHideSeekState(
    options
  );

  rd59ApplyHideSeekPlayingLayout();
  return result;
};

renderHideSeekState = function () {
  roadDiscoveryV59.renderHideSeekState();
  rd59ApplyHideSeekPlayingLayout();
};

rd59ApplyHideSeekPlayingLayout();

/* ================================================== */
/* Road Discovery AU v61 friend-map road styling     */
/* Append this block once to the bottom of app.js v60 */
/* ================================================== */

const roadDiscoveryV61 = {
  ensureFriendFullMap,
  drawFriendFullMapRoads
};

function rd61FriendSavedRoadStyle() {
  const zoom = Number(
    state.friendMap.fullMap?.getZoom?.()
  );

  if (!Number.isFinite(zoom) || zoom >= 14) {
    return {
      weight: 5,
      opacity: 0.95
    };
  }

  if (zoom >= 13) {
    return {
      weight: 3,
      opacity: 0.8
    };
  }

  if (zoom >= 12) {
    return {
      weight: 2,
      opacity: 0.68
    };
  }

  return {
    weight: 1.25,
    opacity: 0.52
  };
}

function rd61ApplyFriendSavedRoadStyle() {
  state.friendMap.fullRoadLayer?.setStyle?.(
    rd61FriendSavedRoadStyle()
  );
}

ensureFriendFullMap = function () {
  roadDiscoveryV61.ensureFriendFullMap();

  const map = state.friendMap.fullMap;

  if (!map || map.rd61FriendRoadStyleBound) {
    return;
  }

  map.rd61FriendRoadStyleBound = true;
  map.on("zoomend", rd61ApplyFriendSavedRoadStyle);
};

drawFriendFullMapRoads = function (roads) {
  const result = roadDiscoveryV61.drawFriendFullMapRoads(
    roads
  );

  rd61ApplyFriendSavedRoadStyle();
  return result;
};

/* ================================================== */
/* Road Discovery AU v62 orange vein map styling     */
/* Append this block once to the bottom of app.js v61 */
/* ================================================== */

function rd62OrangeRoadStyleForZoom(zoomValue) {
  const zoom = Number(zoomValue);

  /* Street view: retain the original painted-road look. */
  if (!Number.isFinite(zoom) || zoom >= 14) {
    return {
      weight: 5,
      opacity: 0.95
    };
  }

  /* Suburb view. */
  if (zoom >= 13) {
    return {
      weight: 3,
      opacity: 0.8
    };
  }

  if (zoom >= 12) {
    return {
      weight: 2,
      opacity: 0.68
    };
  }

  /* City and surrounding-region view. */
  if (zoom >= 10) {
    return {
      weight: 1.1,
      opacity: 0.58
    };
  }

  /* Sydney-Wollongong-Gosford-Newcastle style view. */
  if (zoom >= 8) {
    return {
      weight: 0.8,
      opacity: 0.48
    };
  }

  /* State and Australia-wide view: fine orange veins. */
  return {
    weight: 0.6,
    opacity: 0.4
  };
}

rd53SavedRoadStyle = function () {
  return rd62OrangeRoadStyleForZoom(
    state.map?.getZoom?.()
  );
};

rd61FriendSavedRoadStyle = function () {
  return rd62OrangeRoadStyleForZoom(
    state.friendMap.fullMap?.getZoom?.()
  );
};

/* Apply immediately if either map is already open. */
rd53ApplySavedRoadZoomStyle();
rd61ApplyFriendSavedRoadStyle();

/* ================================================== */
/* Road Discovery AU v63 private My Places icons     */
/* Append this block once to the bottom of app.js v62 */
/* ================================================== */

const RD63_MY_PLACES_STORAGE_KEY =
  "roadDiscoveryAU.myPlaces.v1";
const RD63_MY_PLACES_MAX = 100;
const RD63_MY_PLACE_NAME_MAX = 40;

const RD63_PLACE_TYPES = Object.freeze({
  home: {
    label: "Home",
    path: "M3.5 11.5 12 4l8.5 7.5v9h-5.8v-5.8H9.3v5.8H3.5z"
  },
  work: {
    label: "Work",
    path: "M8 6V4.5h8V6h4.5v14h-17V6zm2 0h4V6zm-6.5 5.5h17M9 11.5v2h6v-2"
  },
  garage: {
    label: "Garage",
    path: "M3.5 10.5 12 5l8.5 5.5v10H3.5zm3 2.5h11v7.5h-11zm1.8 2.2h7.4M8.3 17.8h7.4"
  },
  meeting: {
    label: "Meeting",
    path: "M6 21V3.5m1 1h11l-2.2 4L18 12.5H7"
  },
  fuel: {
    label: "Fuel",
    path: "M5 21V4h9v17M4 21h11M7.5 7.5h4M14 8h2l2.5 2.5V17a1.5 1.5 0 0 0 3 0v-5.5L19 9"
  },
  scenic: {
    label: "Scenic",
    path: "M4 7.5h4l1.5-2h5l1.5 2h4v12H4zm8 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7"
  },
  star: {
    label: "Favourite",
    path: "m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"
  },
  warning: {
    label: "Warning",
    path: "M12 3.5 21 20H3zm0 5v5.5m0 3v.2"
  }
});

const roadDiscoveryV63 = {
  ensureLocateButton,
  initMap,
  closePanels,
  renderHideSeekState,
  resetHideSeekState
};

const rd63StoredPlaces = rd63LoadStoredPlaces();

state.myPlaces = {
  items: rd63StoredPlaces.items,
  visible: rd63StoredPlaces.visible,
  layer: null,
  markers: new Map(),
  placingType: null,
  movingPlaceId: null,
  keepPlacementOnClose: false,
  selectedPlaceId: null
};

/* -------------------------------------------------- */
/* Local storage                                      */
/* -------------------------------------------------- */

function rd63LoadStoredPlaces() {
  try {
    const raw = localStorage.getItem(
      RD63_MY_PLACES_STORAGE_KEY
    );

    if (!raw) {
      return {
        items: [],
        visible: true
      };
    }

    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed?.items)
      ? parsed.items
      : [];
    const ids = new Set();
    const items = [];

    for (const candidate of source) {
      const type = String(candidate?.type || "");
      const lat = Number(candidate?.lat);
      const lng = Number(candidate?.lng);
      const rawId = String(candidate?.id || "");

      if (
        !RD63_PLACE_TYPES[type] ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        continue;
      }

      const id = /^[a-zA-Z0-9_-]{1,80}$/.test(rawId)
        ? rawId
        : rd63CreatePlaceId();

      if (ids.has(id)) continue;
      ids.add(id);

      const defaultName = RD63_PLACE_TYPES[type].label;
      const name = String(candidate?.name || defaultName)
        .trim()
        .slice(0, RD63_MY_PLACE_NAME_MAX) || defaultName;

      items.push({
        id,
        type,
        name,
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        createdAt:
          Number(candidate?.createdAt) || Date.now()
      });

      if (items.length >= RD63_MY_PLACES_MAX) break;
    }

    return {
      items,
      visible: parsed?.visible !== false
    };
  } catch (error) {
    console.error(error);

    return {
      items: [],
      visible: true
    };
  }
}

function rd63SavePlaces() {
  try {
    localStorage.setItem(
      RD63_MY_PLACES_STORAGE_KEY,
      JSON.stringify({
        visible: state.myPlaces.visible,
        items: state.myPlaces.items
      })
    );
  } catch (error) {
    console.error(error);
    showToast("Could not save My Places on this device");
  }
}

function rd63CreatePlaceId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `place_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/* -------------------------------------------------- */
/* Interface creation                                 */
/* -------------------------------------------------- */

ensureLocateButton = function () {
  roadDiscoveryV63.ensureLocateButton();
  rd63EnsurePlacesInterface();
};

function rd63EnsurePlacesInterface() {
  const toolStack = document.querySelector(".tool-stack");

  if (!toolStack) return;

  let button = $("placesBtn");

  if (!button) {
    button = document.createElement("button");
    button.id = "placesBtn";
    button.className = "tool-btn places-tool-btn";
    button.type = "button";
    button.title = "My Places";
    button.setAttribute("aria-label", "Open My Places");
    button.innerHTML = rd63ToolButtonSvg();

    const friendsButton = $("friendsBtn");

    if (
      friendsButton &&
      friendsButton.parentElement === toolStack
    ) {
      toolStack.insertBefore(button, friendsButton);
    } else {
      toolStack.appendChild(button);
    }
  }

  let panel = $("placesPanel");

  if (!panel) {
    panel = document.createElement("aside");
    panel.id = "placesPanel";
    panel.className = "side-panel hidden my-places-panel";
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("aria-label", "My Places");
    panel.innerHTML = rd63PlacesPanelMarkup();

    $("appShell")?.appendChild(panel);
  }

  els.placesBtn = button;
  els.placesPanel = panel;
  els.closePlacesBtn = $("closePlacesBtn");
  els.myPlacesVisibilityToggle = $(
    "myPlacesVisibilityToggle"
  );
  els.myPlacesIconGrid = $("myPlacesIconGrid");
  els.myPlacesList = $("myPlacesList");

  if (button.dataset.rd63Bound !== "true") {
    button.dataset.rd63Bound = "true";
    button.addEventListener("click", rd63OpenPlacesPanel);
  }

  if (panel.dataset.rd63Bound !== "true") {
    panel.dataset.rd63Bound = "true";

    els.closePlacesBtn?.addEventListener(
      "click",
      () => closePanels()
    );

    els.myPlacesVisibilityToggle?.addEventListener(
      "change",
      rd63HandleVisibilityChange
    );

    els.myPlacesIconGrid?.addEventListener(
      "click",
      rd63HandleIconChoice
    );

    els.myPlacesList?.addEventListener(
      "click",
      rd63HandlePlaceListAction
    );
  }

  rd63RenderPlacesPanel();
  rd63UpdatePlacesButton();
}

function rd63ToolButtonSvg() {
  return `
    <svg
      class="places-tool-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z"
      ></path>
      <circle cx="12" cy="10" r="2.25"></circle>
    </svg>
  `;
}

function rd63PlacesPanelMarkup() {
  const iconButtons = Object.entries(RD63_PLACE_TYPES)
    .map(([type, definition]) => {
      return `
        <button
          class="my-place-icon-choice"
          type="button"
          data-place-type="${type}"
          aria-label="Place ${definition.label} icon"
        >
          ${rd63PlaceSvg(type)}
          <span>${definition.label}</span>
        </button>
      `;
    })
    .join("");

  return `
    <div class="panel-header">
      <div>
        <h2>My Places</h2>
        <p>Save private icons on your map.</p>
      </div>

      <button
        id="closePlacesBtn"
        class="panel-close-btn"
        type="button"
        aria-label="Close My Places"
      >
        ×
      </button>
    </div>

    <div class="panel-content">
      <section class="panel-section">
        <div class="my-places-privacy-note">
          <strong>🔒 Private on this device</strong>
          <p>
            Your icons are saved only on this device. Friends,
            Multiplayer players and Hide & Seek players cannot see
            them. Icons are never included in map sharing.
          </p>
          <p>
            Your icons may be deleted if you clear your Safari
            history and website data or remove Road Discovery AU
            from your Home Screen.
          </p>
        </div>
      </section>

      <section class="panel-section">
        <label
          class="toggle-row"
          for="myPlacesVisibilityToggle"
        >
          <div class="toggle-text">
            <strong>Show my icons</strong>
            <span>
              Hide or show every private icon without deleting it.
            </span>
          </div>

          <input
            id="myPlacesVisibilityToggle"
            class="toggle-input"
            type="checkbox"
          />

          <span class="toggle-switch" aria-hidden="true">
            <span class="toggle-knob"></span>
          </span>
        </label>
      </section>

      <section class="panel-section">
        <h3>Place an icon</h3>
        <p class="my-places-help">
          Choose an icon, then tap the map to place it.
        </p>

        <div
          id="myPlacesIconGrid"
          class="my-places-icon-grid"
        >
          ${iconButtons}
        </div>
      </section>

      <section class="panel-section">
        <div class="my-places-list-heading">
          <h3>Saved icons</h3>
          <span id="myPlacesCount">0</span>
        </div>

        <div
          id="myPlacesList"
          class="my-places-list"
        ></div>
      </section>
    </div>
  `;
}

function rd63PlaceSvg(type) {
  const definition = RD63_PLACE_TYPES[type];

  if (!definition) return "";

  const filled = ["home", "star"].includes(type);

  return `
    <svg
      class="my-place-svg"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="${definition.path}"
        fill="${filled ? "currentColor" : "none"}"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path>
    </svg>
  `;
}

/* -------------------------------------------------- */
/* Panel behaviour                                    */
/* -------------------------------------------------- */

function rd63OpenPlacesPanel(eventOrPlaceId = null) {
  if (hasActiveHideSeekRound()) {
    showToast("My Places are hidden during Hide & Seek");
    return;
  }

  rd63CancelPlacement(false);

  state.myPlaces.selectedPlaceId =
    typeof eventOrPlaceId === "string"
      ? eventOrPlaceId
      : null;

  rd63RenderPlacesPanel();
  openPanel("placesPanel");

  if (state.myPlaces.selectedPlaceId) {
    window.requestAnimationFrame(() => {
      const selected = els.myPlacesList?.querySelector(
        `[data-place-id="${state.myPlaces.selectedPlaceId}"]`
      );

      selected?.scrollIntoView?.({
        block: "nearest",
        behavior: "smooth"
      });
    });
  }
}

closePanels = function (hideBackdrop = true) {
  const result = roadDiscoveryV63.closePanels(hideBackdrop);

  els.placesPanel?.classList.add("hidden");
  els.placesPanel?.setAttribute("aria-hidden", "true");

  if (!state.myPlaces.keepPlacementOnClose) {
    rd63CancelPlacement(false);
  }

  return result;
};

function rd63HandleVisibilityChange() {
  state.myPlaces.visible = Boolean(
    els.myPlacesVisibilityToggle?.checked
  );

  rd63SavePlaces();
  rd63ApplyPlacesVisibility();
  rd63RenderPlacesPanel();

  showToast(
    state.myPlaces.visible
      ? "My Places shown"
      : "My Places hidden"
  );
}

function rd63HandleIconChoice(event) {
  const button = event.target.closest("[data-place-type]");

  if (!button || !els.myPlacesIconGrid?.contains(button)) {
    return;
  }

  const type = String(button.dataset.placeType || "");

  if (!RD63_PLACE_TYPES[type]) return;

  if (state.myPlaces.items.length >= RD63_MY_PLACES_MAX) {
    showToast(`My Places supports up to ${RD63_MY_PLACES_MAX} icons`);
    return;
  }

  state.myPlaces.visible = true;
  state.myPlaces.placingType = type;
  state.myPlaces.movingPlaceId = null;
  state.myPlaces.keepPlacementOnClose = true;

  rd63SavePlaces();
  rd63ApplyPlacesVisibility();
  closePanels();

  state.myPlaces.keepPlacementOnClose = false;
  rd63UpdatePlacesButton();

  const label = RD63_PLACE_TYPES[type].label;
  showToast(`Tap the map to place ${label}`);
}

function rd63HandlePlaceListAction(event) {
  const button = event.target.closest("[data-place-action]");

  if (!button || !els.myPlacesList?.contains(button)) {
    return;
  }

  const row = button.closest("[data-place-id]");
  const placeId = String(row?.dataset.placeId || "");
  const action = String(button.dataset.placeAction || "");
  const place = rd63FindPlace(placeId);

  if (!place) return;

  if (action === "waypoint") {
    closePanels();

    void setWaypoint({
      lat: place.lat,
      lng: place.lng
    });

    return;
  }

  if (action === "rename") {
    rd63RenamePlace(place);
    return;
  }

  if (action === "move") {
    rd63BeginMovePlace(place);
    return;
  }

  if (action === "delete") {
    rd63DeletePlace(place);
  }
}

function rd63RenamePlace(place) {
  const nextName = window.prompt(
    "Name this place",
    place.name
  );

  if (nextName === null) return;

  place.name =
    String(nextName)
      .trim()
      .slice(0, RD63_MY_PLACE_NAME_MAX) ||
    RD63_PLACE_TYPES[place.type].label;

  rd63SavePlaces();
  rd63DrawPlaces();
  rd63RenderPlacesPanel();
  showToast("Place renamed");
}

function rd63BeginMovePlace(place) {
  state.myPlaces.placingType = null;
  state.myPlaces.movingPlaceId = place.id;
  state.myPlaces.keepPlacementOnClose = true;

  closePanels();

  state.myPlaces.keepPlacementOnClose = false;
  rd63UpdatePlacesButton();
  showToast(`Tap the map to move ${place.name}`);
}

function rd63DeletePlace(place) {
  const confirmed = window.confirm(
    `Delete ${place.name} from My Places?`
  );

  if (!confirmed) return;

  state.myPlaces.items = state.myPlaces.items.filter(
    (item) => item.id !== place.id
  );

  state.myPlaces.selectedPlaceId = null;

  rd63SavePlaces();
  rd63DrawPlaces();
  rd63RenderPlacesPanel();
  showToast("Place deleted");
}

function rd63RenderPlacesPanel() {
  if (!els.myPlacesList) return;

  if (els.myPlacesVisibilityToggle) {
    els.myPlacesVisibilityToggle.checked =
      state.myPlaces.visible;
  }

  const count = $("myPlacesCount");

  if (count) {
    count.textContent = String(state.myPlaces.items.length);
  }

  if (state.myPlaces.items.length === 0) {
    els.myPlacesList.innerHTML = `
      <p class="my-places-empty">
        No icons saved yet.
      </p>
    `;

    return;
  }

  els.myPlacesList.innerHTML = state.myPlaces.items
    .map((place) => {
      const selected =
        place.id === state.myPlaces.selectedPlaceId;

      return `
        <article
          class="my-place-row ${selected ? "selected" : ""}"
          data-place-id="${place.id}"
        >
          <div class="my-place-row-main">
            <span class="my-place-row-icon">
              ${rd63PlaceSvg(place.type)}
            </span>

            <div>
              <strong>${escapeHtml(place.name)}</strong>
              <span>${RD63_PLACE_TYPES[place.type].label}</span>
            </div>
          </div>

          <div class="my-place-row-actions">
            <button
              type="button"
              data-place-action="waypoint"
            >
              Waypoint
            </button>

            <button
              type="button"
              data-place-action="rename"
            >
              Rename
            </button>

            <button
              type="button"
              data-place-action="move"
            >
              Move
            </button>

            <button
              class="danger"
              type="button"
              data-place-action="delete"
            >
              Delete
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

/* -------------------------------------------------- */
/* Map markers and placement                          */
/* -------------------------------------------------- */

initMap = function () {
  roadDiscoveryV63.initMap();

  if (!state.map || !window.L) return;

  if (!state.map.getPane("myPlacesPane")) {
    state.map.createPane("myPlacesPane");
  }

  const pane = state.map.getPane("myPlacesPane");

  if (pane) {
    pane.style.zIndex = "635";
    pane.style.pointerEvents = "auto";
  }

  state.myPlaces.layer = L.layerGroup().addTo(state.map);
  state.map.on("click", rd63HandlePlacesMapClick);

  rd63DrawPlaces();
  rd63ApplyPlacesVisibility();
};

function rd63HandlePlacesMapClick(event) {
  const movingPlaceId = state.myPlaces.movingPlaceId;
  const placingType = state.myPlaces.placingType;

  if (!movingPlaceId && !placingType) return;

  const lat = Number(event?.latlng?.lat);
  const lng = Number(event?.latlng?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return;
  }

  if (movingPlaceId) {
    const place = rd63FindPlace(movingPlaceId);

    if (place) {
      place.lat = Number(lat.toFixed(6));
      place.lng = Number(lng.toFixed(6));

      rd63SavePlaces();
      rd63DrawPlaces();
      showToast(`${place.name} moved`);
    }

    rd63CancelPlacement(false);
    return;
  }

  if (!RD63_PLACE_TYPES[placingType]) {
    rd63CancelPlacement(false);
    return;
  }

  const definition = RD63_PLACE_TYPES[placingType];

  state.myPlaces.items.push({
    id: rd63CreatePlaceId(),
    type: placingType,
    name: definition.label,
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    createdAt: Date.now()
  });

  rd63SavePlaces();
  rd63DrawPlaces();
  rd63CancelPlacement(false);

  showToast(`${definition.label} saved privately`);
}

function rd63DrawPlaces() {
  if (!state.myPlaces.layer || !state.map) return;

  state.myPlaces.layer.clearLayers();
  state.myPlaces.markers.clear();

  for (const place of state.myPlaces.items) {
    const icon = L.divIcon({
      className: "my-place-leaflet-icon",
      html: `
        <div class="my-place-marker-shell">
          ${rd63PlaceSvg(place.type)}
        </div>
      `,
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });

    const marker = L.marker(
      [place.lat, place.lng],
      {
        icon,
        pane: "myPlacesPane",
        interactive: true,
        keyboard: true,
        rotateWithView: false
      }
    ).addTo(state.myPlaces.layer);

    marker.bindTooltip(escapeHtml(place.name), {
      direction: "top",
      offset: [0, -18]
    });

    marker.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      rd63OpenPlacesPanel(place.id);
    });

    state.myPlaces.markers.set(place.id, marker);
  }

  rd63ApplyPlacesVisibility();
  rd63RenderPlacesPanel();
}

function rd63ApplyPlacesVisibility() {
  const map = state.map;
  const layer = state.myPlaces.layer;
  const gameActive = hasActiveHideSeekRound();
  const shouldShow =
    state.myPlaces.visible && !gameActive;

  if (map && layer) {
    const showing = map.hasLayer(layer);

    if (shouldShow && !showing) {
      layer.addTo(map);
    } else if (!shouldShow && showing) {
      map.removeLayer(layer);
    }
  }

  if (gameActive) {
    rd63CancelPlacement(false);
  }

  rd63UpdatePlacesButton();
}

function rd63UpdatePlacesButton() {
  const button = els.placesBtn || $("placesBtn");

  if (!button) return;

  const gameActive = hasActiveHideSeekRound();
  const placing = Boolean(
    state.myPlaces.placingType ||
    state.myPlaces.movingPlaceId
  );

  button.disabled = gameActive;

  button.classList.toggle(
    "active",
    state.myPlaces.visible && !gameActive
  );

  button.classList.toggle("placing", placing);

  button.setAttribute(
    "aria-pressed",
    String(state.myPlaces.visible && !gameActive)
  );

  button.title = gameActive
    ? "My Places • hidden during Hide & Seek"
    : placing
      ? "Tap the map to place an icon"
      : "My Places";
}

function rd63CancelPlacement(showMessage = false) {
  const wasPlacing = Boolean(
    state.myPlaces.placingType ||
    state.myPlaces.movingPlaceId
  );

  state.myPlaces.placingType = null;
  state.myPlaces.movingPlaceId = null;

  rd63UpdatePlacesButton();

  if (showMessage && wasPlacing) {
    showToast("Icon placement cancelled");
  }
}

function rd63FindPlace(placeId) {
  return (
    state.myPlaces.items.find(
      (place) => place.id === placeId
    ) || null
  );
}

/* -------------------------------------------------- */
/* Hide & Seek separation                             */
/* -------------------------------------------------- */

renderHideSeekState = function () {
  roadDiscoveryV63.renderHideSeekState();
  rd63ApplyPlacesVisibility();
};

resetHideSeekState = function (options = {}) {
  const result = roadDiscoveryV63.resetHideSeekState(
    options
  );

  rd63ApplyPlacesVisibility();
  return result;
};

/* ================================================== */
/* Road Discovery AU v64 introduction and About card  */
/* Append this block once to the bottom of app.js v63 */
/* ================================================== */

const RD64_WELCOME_SEEN_KEY =
  "roadDiscoveryAU.welcomeSeen.v1";

let rd64AboutOpenedAsWelcome = false;

function rd64HasSeenWelcome() {
  try {
    return localStorage.getItem(RD64_WELCOME_SEEN_KEY) === "1";
  } catch (error) {
    return false;
  }
}

function rd64SaveWelcomeSeen() {
  try {
    localStorage.setItem(RD64_WELCOME_SEEN_KEY, "1");
  } catch (error) {
    console.error(error);
  }
}

function rd64CreateAboutOverlay() {
  if ($("roadDiscoveryAboutOverlay")) return;

  const overlay = document.createElement("section");
  overlay.id = "roadDiscoveryAboutOverlay";
  overlay.className =
    "confirm-overlay road-discovery-about-overlay hidden";
  overlay.setAttribute("aria-hidden", "true");

  overlay.innerHTML = `
    <div
      class="confirm-card road-discovery-about-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="roadDiscoveryAboutTitle"
      aria-describedby="roadDiscoveryAboutDescription"
    >
      <div
        class="road-discovery-about-mark"
        aria-hidden="true"
      >
        AU
      </div>

      <div class="road-discovery-about-kicker">
        Road Discovery AU
      </div>

      <h2 id="roadDiscoveryAboutTitle">
        Explore, don’t navigate
      </h2>

      <p
        id="roadDiscoveryAboutDescription"
        class="road-discovery-about-intro"
      >
        Road Discovery AU is not a turn-by-turn navigation app.
        It records the roads you explore and turns them orange.
      </p>

      <p class="road-discovery-about-message">
        Maps tell you where to go. Road Discovery shows you where
        you’ve been.
      </p>

      <p class="road-discovery-about-ride">
        Choose your road, enjoy the ride, and paint the map orange.
      </p>

      <div class="road-discovery-about-safety">
        <strong>Play safely.</strong>
        Keep your eyes on the road and only operate the app when
        safely stopped.
      </div>

      <button
        id="closeRoadDiscoveryAboutBtn"
        class="wide-btn road-discovery-about-close"
        type="button"
      >
        Start Exploring
      </button>
    </div>
  `;

  ($("appShell") || document.body).appendChild(overlay);
}

function rd64InsertSettingsAboutButton() {
  if ($("roadDiscoveryAboutBtn")) return;

  const settingsContent = document.querySelector(
    "#settingsPanel .panel-content"
  );

  if (!settingsContent) return;

  const section = document.createElement("section");
  section.className =
    "panel-section road-discovery-about-settings";

  section.innerHTML = `
    <h3>About</h3>

    <p class="road-discovery-about-settings-copy">
      Learn what Road Discovery is designed to do and how to use it
      safely.
    </p>

    <button
      id="roadDiscoveryAboutBtn"
      class="ghost-btn wide-btn"
      type="button"
    >
      About Road Discovery
    </button>
  `;

  settingsContent.insertBefore(
    section,
    settingsContent.firstElementChild
  );
}

function rd64OpenAbout(options = {}) {
  const overlay = $("roadDiscoveryAboutOverlay");
  const closeButton = $("closeRoadDiscoveryAboutBtn");

  if (!overlay || !closeButton) return;

  rd64AboutOpenedAsWelcome = Boolean(options.firstRun);

  if (!rd64AboutOpenedAsWelcome) {
    closePanels();
  }

  closeButton.textContent = rd64AboutOpenedAsWelcome
    ? "Start Exploring"
    : "Back to Map";

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("road-discovery-about-open");

  window.setTimeout(() => closeButton.focus(), 0);
}

function rd64CloseAbout() {
  const overlay = $("roadDiscoveryAboutOverlay");

  if (!overlay) return;

  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("road-discovery-about-open");

  rd64SaveWelcomeSeen();
  rd64AboutOpenedAsWelcome = false;
}

function rd64BindAboutEvents() {
  $("roadDiscoveryAboutBtn")?.addEventListener(
    "click",
    () => rd64OpenAbout({ firstRun: false })
  );

  $("closeRoadDiscoveryAboutBtn")?.addEventListener(
    "click",
    rd64CloseAbout
  );

  $("roadDiscoveryAboutOverlay")?.addEventListener(
    "click",
    (event) => {
      if (event.target === $("roadDiscoveryAboutOverlay")) {
        rd64CloseAbout();
      }
    }
  );

  window.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !$("roadDiscoveryAboutOverlay")?.classList.contains("hidden")
    ) {
      rd64CloseAbout();
    }
  });
}

function rd64InitAboutExperience() {
  rd64CreateAboutOverlay();
  rd64InsertSettingsAboutButton();
  rd64BindAboutEvents();

  if (!rd64HasSeenWelcome()) {
    window.setTimeout(
      () => rd64OpenAbout({ firstRun: true }),
      450
    );
  }
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd64InitAboutExperience,
    { once: true }
  );
} else {
  rd64InitAboutExperience();
}

/* ================================================== */
/* Road Discovery AU v65 private progress backup      */
/* Append this block once to the bottom of app.js v64 */
/* ================================================== */

const RD65_BACKUP_META_KEY =
  "roadDiscoveryAU.privateRoadBackup.v1";
const RD65_PROGRESS_OWNER_KEY =
  "roadDiscoveryAU.progressOwner.v1";
const RD65_UPLOAD_BATCH_SIZE = 300;
const RD65_DOWNLOAD_PAGE_SIZE = 500;
const RD65_MAX_DOWNLOAD_PAGES = 500;

const roadDiscoveryV65 = {
  ensureRoadProfile,
  finishDrive,
  handleOnlineReconnect,
  resetDiscoveredRoads,
  renderAuthState
};

state.privateRoadBackup = {
  status: "signed-out",
  text: "Sign in to back up",
  detail: "",
  busy: false,
  pending: false,
  resetPending: false,
  timer: null
};

/* -------------------------------------------------- */
/* Road Profile backup status                         */
/* -------------------------------------------------- */

function rd65EnsureBackupStatusRow() {
  if ($("privateRoadBackupStatus")) return;

  const list = document.querySelector(
    "#signedInProfileCard .profile-detail-list"
  );

  if (!list) return;

  const row = document.createElement("div");
  row.className = "profile-detail-row private-road-backup-row";
  row.innerHTML = `
    <span>Progress backup</span>
    <strong
      id="privateRoadBackupStatus"
      class="private-road-backup-status waiting"
    >Checking...</strong>
  `;

  list.appendChild(row);
  rd65RenderBackupStatus();
}

function rd65SetBackupStatus(status, text, detail = "") {
  state.privateRoadBackup.status = status;
  state.privateRoadBackup.text = text;
  state.privateRoadBackup.detail = detail;
  rd65RenderBackupStatus();
}

function rd65RenderBackupStatus() {
  const element = $("privateRoadBackupStatus");

  if (!element) return;

  element.textContent = state.privateRoadBackup.text;
  element.className =
    `private-road-backup-status ${state.privateRoadBackup.status}`;

  if (state.privateRoadBackup.detail) {
    element.title = state.privateRoadBackup.detail;
  } else {
    element.removeAttribute("title");
  }
}

function rd65InitBackupUI() {
  rd65EnsureBackupStatusRow();

  if (!state.auth.user) {
    rd65SetBackupStatus("signed-out", "Sign in to back up");
  }
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd65InitBackupUI,
    { once: true }
  );
} else {
  rd65InitBackupUI();
}

/* -------------------------------------------------- */
/* Local account metadata                             */
/* -------------------------------------------------- */

function rd65BackupStore() {
  const store = readJson(RD65_BACKUP_META_KEY, {});

  return store && typeof store === "object" && !Array.isArray(store)
    ? store
    : {};
}

function rd65BackupMeta(userId = state.auth.user?.id) {
  const id = String(userId || "");
  const value = id ? rd65BackupStore()[id] : null;

  return value && typeof value === "object"
    ? value
    : null;
}

function rd65SaveBackupMeta(meta, userId = state.auth.user?.id) {
  const id = String(userId || "");

  if (!id) return;

  const store = rd65BackupStore();
  store[id] = meta;
  writeJson(RD65_BACKUP_META_KEY, store);
}

function rd65ClaimLocalProgress() {
  const userId = String(state.auth.user?.id || "");

  if (!userId) return false;

  const ownerId = String(
    readJson(RD65_PROGRESS_OWNER_KEY, "") || ""
  );

  if (!ownerId || Object.keys(state.savedSegments).length === 0) {
    writeJson(RD65_PROGRESS_OWNER_KEY, userId);
    return true;
  }

  if (ownerId === userId) return true;

  rd65SetBackupStatus(
    "paused",
    "Backup paused",
    "The orange roads on this device belong to another Road Profile. Sign back into that profile before syncing."
  );

  return false;
}

function rd65ScheduleBackup(delayMs = 350) {
  if (state.privateRoadBackup.timer !== null) {
    clearTimeout(state.privateRoadBackup.timer);
  }

  state.privateRoadBackup.timer = setTimeout(() => {
    state.privateRoadBackup.timer = null;
    void rd65ReconcileBackup();
  }, Math.max(0, Number(delayMs) || 0));
}

/* -------------------------------------------------- */
/* Private Supabase road records                      */
/* -------------------------------------------------- */

async function rd65ServerRoadCount() {
  const { data, error } = await state.auth.client.rpc(
    "get_my_private_road_count"
  );

  if (error) throw error;

  const count = Number(data);

  return Number.isFinite(count) && count >= 0
    ? Math.floor(count)
    : 0;
}

function rd65RestoredSegment(row) {
  const id = String(row?.segment_id || "");
  const coords = normaliseSharedRoadCoords(row?.coordinates);
  const lengthM = Math.round(Number(row?.length_m));

  if (
    !/^[A-Za-z0-9:._-]{1,160}$/.test(id) ||
    !coords ||
    !Number.isFinite(lengthM) ||
    lengthM < 3 ||
    lengthM > 5000
  ) {
    return null;
  }

  return {
    id,
    name: "Restored discovered road",
    highway: "road",
    coords,
    lengthM,
    unlockedAt: 1
  };
}

async function rd65DownloadPrivateRoads() {
  let afterSegmentId = null;
  let added = 0;
  let received = 0;

  rd65SetBackupStatus("restoring", "Restoring...");

  for (let page = 0; page < RD65_MAX_DOWNLOAD_PAGES; page++) {
    if (state.privateRoadBackup.resetPending) {
      return { added: 0, cancelled: true };
    }

    const { data, error } = await state.auth.client.rpc(
      "get_my_private_roads",
      {
        p_after_segment_id: afterSegmentId,
        p_page_size: RD65_DOWNLOAD_PAGE_SIZE
      }
    );

    if (error) throw error;

    if (state.privateRoadBackup.resetPending) {
      return { added: 0, cancelled: true };
    }

    const rows = Array.isArray(data) ? data : [];

    if (rows.length === 0) break;

    for (const row of rows) {
      const segment = rd65RestoredSegment(row);

      if (!segment) continue;

      received++;

      if (!state.savedSegments[segment.id]) {
        state.savedSegments[segment.id] = segment;
        state.savedSegmentIds.add(segment.id);
        added++;
      }

      state.visited[segment.id] = state.visited[segment.id] || 1;
    }

    afterSegmentId = String(
      rows[rows.length - 1]?.segment_id || ""
    );

    if (!afterSegmentId) {
      throw new Error("Private road restore pagination failed");
    }

    rd65SetBackupStatus(
      "restoring",
      `Restoring ${formatNumber(received)}...`
    );

    if (rows.length < RD65_DOWNLOAD_PAGE_SIZE) break;

    if (page === RD65_MAX_DOWNLOAD_PAGES - 1) {
      throw new Error("Private road restore safety limit reached");
    }
  }

  if (added > 0) {
    saveVisited();
    saveSavedSegments();
    state.needsSavedSegmentsSave = false;

    for (const segment of state.roadSegments) {
      if (state.savedSegments[segment.id]) {
        segment.visited = true;
        styleSegment(segment);
      }
    }

    drawSavedSegments();
    renderAllStats();

    if (typeof rd53ApplySavedRoadZoomStyle === "function") {
      rd53ApplySavedRoadZoomStyle();
    }

    void maybeSyncProfileStats({ force: true, quiet: true });
  }

  return { added, cancelled: false };
}

async function rd65PrivateRoadRecord(segment) {
  const id = String(segment?.id || "");

  if (!/^[A-Za-z0-9:._-]{1,160}$/.test(id)) return null;

  const sharedRecord = await buildSharedRoadRecord(segment);

  if (!sharedRecord) return null;

  const lengthM = Math.round(safeSegmentLengthM(segment));

  if (lengthM < 3 || lengthM > 5000) return null;

  return {
    segment_id: id,
    road_hash: sharedRecord.shared_road_hash,
    coordinates: sharedRecord.coordinates,
    length_m: lengthM
  };
}

async function rd65UploadPrivateRoads(segments) {
  const source = Array.isArray(segments)
    ? segments.filter(Boolean)
    : [];

  for (
    let start = 0;
    start < source.length;
    start += RD65_UPLOAD_BATCH_SIZE
  ) {
    const sourceBatch = source.slice(
      start,
      start + RD65_UPLOAD_BATCH_SIZE
    );
    const builtBatch = await Promise.all(
      sourceBatch.map(rd65PrivateRoadRecord)
    );
    const roads = builtBatch.filter(Boolean);

    if (roads.length > 0) {
      const { error } = await state.auth.client.rpc(
        "sync_my_private_roads",
        { roads }
      );

      if (error) throw error;
    }

    rd65SetBackupStatus(
      "syncing",
      `Backing up ${formatNumber(
        Math.min(start + sourceBatch.length, source.length)
      )} / ${formatNumber(source.length)}`
    );
  }
}

/* -------------------------------------------------- */
/* Restore, merge, then upload the combined progress  */
/* -------------------------------------------------- */

async function rd65ReconcileBackup() {
  if (!state.auth.client || !state.auth.user) {
    rd65SetBackupStatus("signed-out", "Sign in to back up");
    return false;
  }

  if (!navigator.onLine) {
    rd65SetBackupStatus("offline", "Offline • waiting");
    return false;
  }

  if (state.isRecording) {
    rd65SetBackupStatus("waiting", "Waiting for drive");
    return false;
  }

  if (state.privateRoadBackup.busy) {
    state.privateRoadBackup.pending = true;
    return false;
  }

  if (!rd65ClaimLocalProgress()) return false;

  const userId = String(state.auth.user.id || "");

  state.privateRoadBackup.busy = true;
  state.privateRoadBackup.pending = false;
  rd65SetBackupStatus("checking", "Checking...");

  try {
    const meta = rd65BackupMeta(userId) || {};

    if (meta.pendingClear || state.privateRoadBackup.resetPending) {
      rd65SetBackupStatus("clearing", "Clearing backup...");

      const { error } = await state.auth.client.rpc(
        "clear_my_private_roads"
      );

      if (error) throw error;

      state.privateRoadBackup.resetPending = false;

      rd65SaveBackupMeta(
        {
          localCount: 0,
          serverCount: 0,
          restoredAt: new Date().toISOString(),
          lastSyncAt: new Date().toISOString(),
          pendingClear: false
        },
        userId
      );

      rd65SetBackupStatus("synced", "Synced • 0 roads");
      return true;
    }

    let serverCount = await rd65ServerRoadCount();
    let localCount = Object.keys(state.savedSegments).length;

    const needsRestore =
      serverCount > 0 &&
      (
        !meta.restoredAt ||
        Number(meta.serverCount) !== serverCount ||
        localCount < serverCount
      );

    if (needsRestore) {
      const result = await rd65DownloadPrivateRoads();

      if (result.cancelled) {
        state.privateRoadBackup.pending = true;
        return false;
      }

      localCount = Object.keys(state.savedSegments).length;
    }

    if (localCount > serverCount) {
      rd65SetBackupStatus("syncing", "Backing up...");
      await rd65UploadPrivateRoads(
        Object.values(state.savedSegments)
      );
      serverCount = await rd65ServerRoadCount();
    }

    const finalLocalCount = Object.keys(state.savedSegments).length;

    rd65SaveBackupMeta(
      {
        localCount: finalLocalCount,
        serverCount,
        restoredAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString(),
        pendingClear: false
      },
      userId
    );

    if (serverCount !== finalLocalCount) {
      state.privateRoadBackup.pending = true;
      throw new Error("Private progress needs another sync pass");
    }

    rd65SetBackupStatus(
      "synced",
      `Synced • ${formatNumber(finalLocalCount)} roads`
    );

    return true;
  } catch (error) {
    console.error(error);
    rd65SetBackupStatus(
      "error",
      "Sync needs attention",
      rd65BackupErrorMessage(error)
    );
    return false;
  } finally {
    state.privateRoadBackup.busy = false;

    if (state.privateRoadBackup.pending) {
      state.privateRoadBackup.pending = false;
      rd65ScheduleBackup(1200);
    }
  }
}

/* -------------------------------------------------- */
/* Upload only the newly finished drive               */
/* -------------------------------------------------- */

async function rd65BackupFinishedDrive(segments) {
  if (!segments.length) {
    rd65ScheduleBackup(250);
    return;
  }

  if (
    !state.auth.client ||
    !state.auth.user ||
    !navigator.onLine
  ) {
    rd65SetBackupStatus(
      navigator.onLine ? "waiting" : "offline",
      navigator.onLine ? "Waiting to sync" : "Offline • waiting"
    );
    return;
  }

  if (state.privateRoadBackup.busy) {
    state.privateRoadBackup.pending = true;
    return;
  }

  if (!rd65ClaimLocalProgress()) return;

  const userId = String(state.auth.user.id || "");
  const meta = rd65BackupMeta(userId);

  if (!meta?.restoredAt || meta.pendingClear) {
    rd65ScheduleBackup(250);
    return;
  }

  state.privateRoadBackup.busy = true;

  try {
    rd65SetBackupStatus("syncing", "Backing up drive...");
    await rd65UploadPrivateRoads(segments);

    const serverCount = await rd65ServerRoadCount();
    const localCount = Object.keys(state.savedSegments).length;

    rd65SaveBackupMeta(
      {
        localCount,
        serverCount,
        restoredAt: meta.restoredAt,
        lastSyncAt: new Date().toISOString(),
        pendingClear: false
      },
      userId
    );

    if (serverCount === localCount) {
      rd65SetBackupStatus(
        "synced",
        `Synced • ${formatNumber(localCount)} roads`
      );
    } else {
      state.privateRoadBackup.pending = true;
    }
  } catch (error) {
    console.error(error);
    rd65SetBackupStatus(
      "error",
      "Sync needs attention",
      rd65BackupErrorMessage(error)
    );
  } finally {
    state.privateRoadBackup.busy = false;

    if (state.privateRoadBackup.pending) {
      state.privateRoadBackup.pending = false;
      rd65ScheduleBackup(1200);
    }
  }
}

/* -------------------------------------------------- */
/* Intentional reset protection                       */
/* -------------------------------------------------- */

function rd65QueueBackupClear() {
  const userId = String(state.auth.user?.id || "");

  if (!userId) return;

  rd65SaveBackupMeta(
    {
      ...(rd65BackupMeta(userId) || {}),
      pendingClear: true
    },
    userId
  );

  state.privateRoadBackup.resetPending = true;
  state.privateRoadBackup.pending = true;

  rd65SetBackupStatus(
    navigator.onLine ? "clearing" : "offline",
    navigator.onLine
      ? "Clearing backup..."
      : "Offline • reset waiting"
  );

  rd65ScheduleBackup(100);
}

/* -------------------------------------------------- */
/* Existing-function wrappers                         */
/* -------------------------------------------------- */

ensureRoadProfile = async function (options = {}) {
  const result = await roadDiscoveryV65.ensureRoadProfile(options);

  if (state.auth.user) {
    rd65SetBackupStatus(
      navigator.onLine ? "checking" : "offline",
      navigator.onLine ? "Checking..." : "Offline • waiting"
    );
    rd65ScheduleBackup(450);
  }

  return result;
};

finishDrive = function () {
  const wasRunning = Boolean(
    state.isRecording || state.watchId !== null
  );
  const newSegments = wasRunning
    ? Array.from(state.tripUnlocked)
        .map((id) => state.savedSegments[id])
        .filter(Boolean)
    : [];

  const result = roadDiscoveryV65.finishDrive();

  if (wasRunning) {
    void rd65BackupFinishedDrive(newSegments);
  }

  return result;
};

handleOnlineReconnect = async function () {
  const result = await roadDiscoveryV65.handleOnlineReconnect();

  if (!state.isRecording) {
    rd65ScheduleBackup(250);
  }

  return result;
};

resetDiscoveredRoads = function () {
  const before = Object.keys(state.savedSegments).length;
  const result = roadDiscoveryV65.resetDiscoveredRoads();
  const after = Object.keys(state.savedSegments).length;

  if (before > 0 && after === 0) {
    rd65QueueBackupClear();
  }

  return result;
};

renderAuthState = function () {
  const result = roadDiscoveryV65.renderAuthState();

  rd65EnsureBackupStatusRow();

  if (!state.auth.user) {
    rd65SetBackupStatus("signed-out", "Sign in to back up");
  }

  rd65RenderBackupStatus();
  return result;
};

function rd65BackupErrorMessage(error) {
  const message = String(error?.message || "");
  const lower = message.toLowerCase();

  if (lower.includes("function") && lower.includes("does not exist")) {
    return "Private progress backup SQL has not been installed.";
  }

  if (lower.includes("authentication")) {
    return "Sign in again to continue backing up progress.";
  }

  if (lower.includes("network") || lower.includes("failed to fetch")) {
    return "Connection was interrupted. Progress remains saved on this device and will retry.";
  }

  return message || "Could not sync private progress.";
}

/* ================================================== */
/* Road Discovery AU v66 location marker visibility   */
/* Append this block once to the bottom of app.js v65 */
/* ================================================== */

const RD66_LOCATION_MARKER_VISIBLE_KEY =
  "roadDiscoveryAU.locationMarkerVisible.v1";

const roadDiscoveryV66 = {
  updateUserMarker,
  beginGpsWatch,
  finishDrive,
  renderHideSeekState,
  resetHideSeekState
};

state.locationMarkerVisible = rd66LoadLocationMarkerPreference();

function rd66LoadLocationMarkerPreference() {
  try {
    const stored = localStorage.getItem(
      RD66_LOCATION_MARKER_VISIBLE_KEY
    );

    return stored === null ? true : stored !== "false";
  } catch (error) {
    return true;
  }
}

function rd66SaveLocationMarkerPreference() {
  try {
    localStorage.setItem(
      RD66_LOCATION_MARKER_VISIBLE_KEY,
      String(Boolean(state.locationMarkerVisible))
    );
  } catch (error) {
    console.error(error);
    showToast("Could not save marker setting");
  }
}

function rd66LocationMarkerIsForcedVisible() {
  return Boolean(
    state.isRecording ||
    hasActiveHideSeekRound()
  );
}

function rd66LocationMarkerShouldShow() {
  return Boolean(
    state.locationMarkerVisible ||
    rd66LocationMarkerIsForcedVisible()
  );
}

function rd66ApplyLocationMarkerVisibility() {
  const shouldShow = rd66LocationMarkerShouldShow();
  const forcedVisible = rd66LocationMarkerIsForcedVisible();

  document.body.classList.toggle(
    "location-marker-hidden",
    !shouldShow
  );

  state.userHeadingMarker?.setOpacity?.(shouldShow ? 1 : 0);

  state.userMarker?.setStyle?.({
    opacity: shouldShow ? 1 : 0,
    fillOpacity: shouldShow ? 1 : 0
  });

  state.accuracyCircle?.setStyle?.({
    opacity: shouldShow ? 0.35 : 0,
    fillOpacity: shouldShow ? 0.06 : 0
  });

  const toggle = $("locationMarkerToggle");
  const note = $("locationMarkerForcedNote");

  if (toggle) {
    toggle.checked = Boolean(state.locationMarkerVisible);
  }

  note?.classList.toggle(
    "hidden",
    !forcedVisible || state.locationMarkerVisible
  );
}

function rd66InsertLocationMarkerSetting() {
  if ($("locationMarkerToggle")) return;

  const settingsContent = document.querySelector(
    "#settingsPanel .panel-content"
  );

  if (!settingsContent) return;

  const section = document.createElement("section");
  section.className =
    "panel-section location-marker-settings-section";

  section.innerHTML = `
    <h3>Map</h3>

    <label
      class="toggle-row"
      for="locationMarkerToggle"
    >
      <div class="toggle-text">
        <strong>Show my location marker</strong>

        <span>
          Turn this off for a clean zoomed-out view of your orange
          roads. GPS, road painting, recentring and progress backup
          keep working normally.
        </span>
      </div>

      <input
        id="locationMarkerToggle"
        class="toggle-input"
        type="checkbox"
      />

      <span
        class="toggle-switch"
        aria-hidden="true"
      >
        <span class="toggle-knob"></span>
      </span>
    </label>

    <p
      id="locationMarkerForcedNote"
      class="location-marker-forced-note hidden"
    >
      Your marker is temporarily visible during an active drive or
      Hide &amp; Seek round.
    </p>
  `;

  settingsContent.insertBefore(
    section,
    settingsContent.firstElementChild
  );

  $("locationMarkerToggle")?.addEventListener(
    "change",
    (event) => {
      state.locationMarkerVisible = Boolean(
        event.currentTarget.checked
      );

      rd66SaveLocationMarkerPreference();
      rd66ApplyLocationMarkerVisibility();

      showToast(
        state.locationMarkerVisible
          ? "Location marker shown"
          : rd66LocationMarkerIsForcedVisible()
            ? "Marker will hide after the active game or drive"
            : "Location marker hidden"
      );
    }
  );
}

/* Road Discovery AU v67 settings section order */

function rd67PlaceLocationMarkerSettingBelowAbout() {
  const aboutSection = document.querySelector(
    "#settingsPanel .road-discovery-about-settings"
  );

  const locationMarkerSection = $(
    "locationMarkerToggle"
  )?.closest(".panel-section");

  if (!aboutSection || !locationMarkerSection) {
    return;
  }

  if (aboutSection.nextElementSibling !== locationMarkerSection) {
    aboutSection.insertAdjacentElement(
      "afterend",
      locationMarkerSection
    );
  }
}

function rd66InitLocationMarkerSetting() {
  rd66InsertLocationMarkerSetting();
  rd67PlaceLocationMarkerSettingBelowAbout();
  rd66ApplyLocationMarkerVisibility();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd66InitLocationMarkerSetting,
    { once: true }
  );
} else {
  rd66InitLocationMarkerSetting();
}

updateUserMarker = function (point) {
  const result = roadDiscoveryV66.updateUserMarker(point);
  rd66ApplyLocationMarkerVisibility();
  return result;
};

beginGpsWatch = function () {
  const result = roadDiscoveryV66.beginGpsWatch();
  rd66ApplyLocationMarkerVisibility();
  return result;
};

finishDrive = function () {
  const result = roadDiscoveryV66.finishDrive();
  rd66ApplyLocationMarkerVisibility();
  return result;
};

renderHideSeekState = function () {
  const result = roadDiscoveryV66.renderHideSeekState();
  rd66ApplyLocationMarkerVisibility();
  return result;
};

resetHideSeekState = function (options = {}) {
  const result = roadDiscoveryV66.resetHideSeekState(options);
  rd66ApplyLocationMarkerVisibility();
  return result;
};

/* ================================================== */
/* Road Discovery AU v68 milestone progression        */
/* Append this block once to the bottom of app.js v67 */
/* ================================================== */

const RD68_ACHIEVEMENTS = Object.freeze([
  {
    threshold: 5000,
    name: "Ignition",
    description: "Discover 5,000 roads."
  },
  {
    threshold: 10000,
    name: "Local Explorer",
    description: "Discover 10,000 roads."
  },
  {
    threshold: 17500,
    name: "Road Hunter",
    description: "Discover 17,500 roads."
  },
  {
    threshold: 30000,
    name: "Orange District",
    description: "Discover 30,000 roads."
  },
  {
    threshold: 50000,
    name: "Road Pioneer",
    description: "Discover 50,000 roads.",
    reward: "Public leaderboard access"
  },
  {
    threshold: 100000,
    name: "City Explorer",
    description: "Discover 100,000 roads."
  },
  {
    threshold: 250000,
    name: "Region Runner",
    description: "Discover 250,000 roads."
  },
  {
    threshold: 500000,
    name: "Road Veteran",
    description: "Discover 500,000 roads."
  },
  {
    threshold: 1000000,
    name: "Million Road Club",
    description: "Discover 1,000,000 roads."
  },
  {
    threshold: 2500000,
    name: "State Explorer",
    description: "Discover 2,500,000 roads."
  },
  {
    threshold: 5000000,
    name: "Continental Explorer",
    description: "Discover 5,000,000 roads."
  },
  {
    threshold: 10000000,
    name: "Orange Nation",
    description: "Discover 10,000,000 roads."
  },
    {
    threshold: 18000000,
    name: "Road Master",
    description: "Discover 18,000,000 roads."
  },
  {
    threshold: 25000000,
    name: "Global Explorer",
    description: "Discover 25,000,000 roads."
  },
  {
    threshold: 50000000,
    name: "Road Legend",
    description: "Discover 50,000,000 roads."
  }
]);

const roadDiscoveryV68 = {
  renderAllStats,
  startDrive,
  finishDrive
};

let rd68DriveStartCount = null;

function rd68UnlockedCount() {
  return Object.keys(state.savedSegments || {}).length;
}

function rd68NextAchievement(count = rd68UnlockedCount()) {
  return (
    RD68_ACHIEVEMENTS.find(
      (achievement) => count < achievement.threshold
    ) || RD68_ACHIEVEMENTS[RD68_ACHIEVEMENTS.length - 1]
  );
}

function rd68MilestoneCount(value) {
  return formatCompactNumber(Number(value) || 0);
}

function rd68ProgressPercent(count, target) {
  if (!target) return 0;

  return Math.max(
    0,
    Math.min(100, (Number(count || 0) / target) * 100)
  );
}

function rd68CreateTrophyRoom() {
  if ($("rd68TrophyOverlay")) return;

  const overlay = document.createElement("section");
  overlay.id = "rd68TrophyOverlay";
  overlay.className = "confirm-overlay rd-trophy-overlay hidden";
  overlay.setAttribute("aria-hidden", "true");

  overlay.innerHTML = `
    <div
      class="confirm-card rd-trophy-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rd68TrophyTitle"
    >
      <div class="rd-trophy-header">
        <div class="rd-trophy-heading">
          <div class="rd-trophy-mark" aria-hidden="true">★</div>

          <div>
            <div class="rd-trophy-kicker">Road Discovery AU</div>
            <h2 id="rd68TrophyTitle">Trophy Room</h2>
          </div>
        </div>

        <button
          id="rd68TrophyCloseBtn"
          class="rd-trophy-close"
          type="button"
          aria-label="Close Trophy Room"
        >
          ×
        </button>
      </div>

      <div
        id="rd68AchievementCelebration"
        class="rd-achievement-celebration hidden"
        aria-live="polite"
      ></div>

      <div class="rd-trophy-summary">
        <div class="rd-trophy-summary-topline">
          <div>
            <span>Total discovered</span>
            <strong id="rd68TrophyTotal">0</strong>
          </div>

          <div class="rd-trophy-next">
            <span>Next milestone</span>
            <strong id="rd68TrophyNext">5K</strong>
          </div>
        </div>

        <div class="rd-trophy-progress-track" aria-hidden="true">
          <span id="rd68TrophyProgressBar"></span>
        </div>

        <p id="rd68TrophyProgressText">0 / 5K roads</p>
      </div>

      <div
        id="rd68AchievementList"
        class="rd-achievement-list"
      ></div>

      <button
        id="rd68TrophyDoneBtn"
        class="wide-btn rd-trophy-done"
        type="button"
      >
        Back to Map
      </button>
    </div>
  `;

  ($("appShell") || document.body).appendChild(overlay);
}

function rd68InsertAchievementSetting() {
  if ($("rd68OpenTrophyRoomBtn")) return;

  const settingsContent = document.querySelector(
    "#settingsPanel .panel-content"
  );

  if (!settingsContent) return;

  const section = document.createElement("section");
  section.className = "panel-section rd-achievement-settings";

  section.innerHTML = `
    <h3>Achievements</h3>

    <p class="rd-achievement-settings-copy">
      View your milestones, completed achievements and next road goal.
    </p>

    <button
      id="rd68OpenTrophyRoomBtn"
      class="ghost-btn wide-btn"
      type="button"
    >
      Open Trophy Room
    </button>

    <p
      id="rd68AchievementSettingsProgress"
      class="rd-achievement-settings-progress"
    ></p>
  `;

  const aboutSection = settingsContent.querySelector(
    ".road-discovery-about-settings"
  );

  if (aboutSection) {
    aboutSection.insertAdjacentElement("afterend", section);
  } else {
    settingsContent.insertBefore(
      section,
      settingsContent.firstElementChild
    );
  }
}

function rd68AchievementCard(
  achievement,
  count,
  nextThreshold
) {
  const unlocked = count >= achievement.threshold;
  const current =
    !unlocked && achievement.threshold === nextThreshold;

  const stateClass = unlocked
    ? "unlocked"
    : current
      ? "current"
      : "locked";

  const stateText = unlocked
    ? "Unlocked"
    : current
      ? "Next"
      : "Locked";

  const reward = achievement.reward
    ? `<div class="rd-achievement-reward">${escapeHtml(
        achievement.reward
      )}</div>`
    : "";

  return `
    <article class="rd-achievement-card ${stateClass}">
      <div class="rd-achievement-icon" aria-hidden="true">
        ${unlocked ? "✓" : current ? "★" : "•"}
      </div>

      <div class="rd-achievement-copy">
        <div class="rd-achievement-count">
          ${rd68MilestoneCount(achievement.threshold)} roads
        </div>

        <h3>${escapeHtml(achievement.name)}</h3>
        <p>${escapeHtml(achievement.description)}</p>
        ${reward}
      </div>

      <span class="rd-achievement-state">${stateText}</span>
    </article>
  `;
}

function rd68RenderProgression() {
  const count = rd68UnlockedCount();
  const next = rd68NextAchievement(count);
  const target = next.threshold;

  const complete =
    count >=
    RD68_ACHIEVEMENTS[
      RD68_ACHIEVEMENTS.length - 1
    ].threshold;

  if (els.unlockedStat) {
    els.unlockedStat.textContent =
      `${rd68MilestoneCount(count)} / ` +
      `${rd68MilestoneCount(target)}`;
  }

  const settingsProgress = $(
    "rd68AchievementSettingsProgress"
  );

  if (settingsProgress) {
    settingsProgress.textContent = complete
      ? "All road milestones completed"
      : `${rd68MilestoneCount(count)} / ` +
        `${rd68MilestoneCount(target)} • Next: ${next.name}`;
  }

  const total = $("rd68TrophyTotal");
  const nextValue = $("rd68TrophyNext");
  const progressBar = $("rd68TrophyProgressBar");
  const progressText = $("rd68TrophyProgressText");
  const list = $("rd68AchievementList");

  if (total) {
    total.textContent = formatNumber(count);
  }

  if (nextValue) {
    nextValue.textContent = complete
      ? "Complete"
      : rd68MilestoneCount(target);
  }

  if (progressBar) {
    progressBar.style.width = `${rd68ProgressPercent(
      count,
      target
    )}%`;
  }

  if (progressText) {
    progressText.textContent = complete
      ? `${formatNumber(count)} roads • All milestones completed`
      : `${formatNumber(count)} / ${formatNumber(target)} roads`;
  }

  if (list) {
    list.innerHTML = RD68_ACHIEVEMENTS.map(
      (achievement) =>
        rd68AchievementCard(
          achievement,
          count,
          target
        )
    ).join("");
  }
}

function rd68RenderCelebration(achievements = []) {
  const celebration = $("rd68AchievementCelebration");

  if (!celebration) return;

  if (!achievements.length) {
    celebration.innerHTML = "";
    celebration.classList.add("hidden");
    return;
  }

  const heading =
    achievements.length === 1
      ? "Achievement unlocked"
      : `${achievements.length} achievements unlocked`;

  celebration.innerHTML = `
    <strong>${heading}</strong>

    <span>
      ${achievements
        .map(
          (achievement) =>
            `${escapeHtml(achievement.name)} — ` +
            `${rd68MilestoneCount(
              achievement.threshold
            )} roads`
        )
        .join("<br />")}
    </span>
  `;

  celebration.classList.remove("hidden");
}

function rd68OpenTrophyRoom(options = {}) {
  const overlay = $("rd68TrophyOverlay");

  if (!overlay) return;

  closePanels();
  rd68RenderProgression();
  rd68RenderCelebration(options.achievements || []);

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("rd-trophy-open");

  window.setTimeout(
    () => $("rd68TrophyCloseBtn")?.focus(),
    0
  );
}

function rd68CloseTrophyRoom() {
  const overlay = $("rd68TrophyOverlay");

  if (!overlay) return;

  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("rd-trophy-open");
  rd68RenderCelebration([]);
}

function rd68BindAchievementEvents() {
  $("rd68OpenTrophyRoomBtn")?.addEventListener(
    "click",
    () => rd68OpenTrophyRoom()
  );

  $("rd68TrophyCloseBtn")?.addEventListener(
    "click",
    rd68CloseTrophyRoom
  );

  $("rd68TrophyDoneBtn")?.addEventListener(
    "click",
    rd68CloseTrophyRoom
  );

  $("rd68TrophyOverlay")?.addEventListener(
    "click",
    (event) => {
      if (event.target === $("rd68TrophyOverlay")) {
        rd68CloseTrophyRoom();
      }
    }
  );

  window.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !$("rd68TrophyOverlay")?.classList.contains(
        "hidden"
      )
    ) {
      rd68CloseTrophyRoom();
    }
  });
}

function rd68CrossedAchievements(before, after) {
  return RD68_ACHIEVEMENTS.filter(
    (achievement) =>
      achievement.threshold > before &&
      achievement.threshold <= after
  );
}

function rd68InitAchievements() {
  rd68CreateTrophyRoom();
  rd68InsertAchievementSetting();
  rd68BindAchievementEvents();
  rd68RenderProgression();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd68InitAchievements,
    { once: true }
  );
} else {
  rd68InitAchievements();
}

renderAllStats = function () {
  const result = roadDiscoveryV68.renderAllStats();
  rd68RenderProgression();
  return result;
};

startDrive = async function () {
  const wasRunning = Boolean(
    state.isRecording || state.watchId !== null
  );

  const before = rd68UnlockedCount();
  const result = await roadDiscoveryV68.startDrive();

  if (!wasRunning && state.isRecording) {
    rd68DriveStartCount = before;
  }

  return result;
};

finishDrive = function () {
  const wasRunning = Boolean(
    state.isRecording || state.watchId !== null
  );

  const before = Number.isFinite(rd68DriveStartCount)
    ? rd68DriveStartCount
    : Math.max(
        0,
        rd68UnlockedCount() -
          state.tripUnlocked.size
      );

  const result = roadDiscoveryV68.finishDrive();
  const after = rd68UnlockedCount();

  rd68DriveStartCount = null;
  rd68RenderProgression();

  if (wasRunning) {
    const crossed = rd68CrossedAchievements(
      before,
      after
    );

    if (
      crossed.length > 0 &&
      !hasActiveHideSeekRound()
    ) {
      window.setTimeout(
        () => {
          if (
            !state.isRecording &&
            !hasActiveHideSeekRound()
          ) {
            rd68OpenTrophyRoom({
              achievements: crossed
            });
          }
        },
        650
      );
    }
  }

  return result;
};

/* ================================================== */
/* Road Discovery AU v69 account progress isolation   */
/* Append this block once to the bottom of app.js v68 */
/* ================================================== */

const RD69_ACCOUNT_PROGRESS_PREFIX =
  "roadDiscoveryAU.accountProgress.v1";
const RD69_LEGACY_OWNER_KEY =
  "roadDiscoveryAU.legacyProgressOwner.v1";

const roadDiscoveryV69 = {
  loadSavedState,
  saveVisited,
  saveSavedSegments,
  saveTodayUnlocks,
  ensureRoadProfile,
  signOutRoadProfile,
  renderAuthState
};

const rd69LegacyProgress = {
  visitedRaw: rd69ReadRaw(STORAGE_KEY),
  savedRaw: rd69ReadRaw(SAVED_SEGMENTS_KEY),
  todayRaw: rd69ReadRaw(TODAY_UNLOCKS_KEY),
  ownerId: "",
  available: false
};

state.accountProgress = {
  activeUserId: "",
  switching: false
};

function rd69ReadRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function rd69WriteRaw(key, value) {
  localStorage.setItem(key, value);
}

function rd69RemoveRaw(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error(error);
  }
}

function rd69AccountKey(userId, part) {
  return `${RD69_ACCOUNT_PROGRESS_PREFIX}.${String(userId)}.${part}`;
}

function rd69HasObjectEntries(raw) {
  if (!raw) return false;

  try {
    const value = JSON.parse(raw);

    return Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0
    );
  } catch (error) {
    return false;
  }
}

function rd69InitialiseLegacyProgress() {
  rd69LegacyProgress.available = Boolean(
    rd69HasObjectEntries(rd69LegacyProgress.savedRaw) ||
    rd69HasObjectEntries(rd69LegacyProgress.visitedRaw)
  );

  if (!rd69LegacyProgress.available) return;

  const rememberedOwner = String(
    readJson(RD69_LEGACY_OWNER_KEY, "") || ""
  );
  const previousBackupOwner = String(
    readJson(RD65_PROGRESS_OWNER_KEY, "") || ""
  );

  rd69LegacyProgress.ownerId =
    rememberedOwner || previousBackupOwner;

  if (rd69LegacyProgress.ownerId && !rememberedOwner) {
    writeJson(
      RD69_LEGACY_OWNER_KEY,
      rd69LegacyProgress.ownerId
    );
  }
}

rd69InitialiseLegacyProgress();

function rd69AccountProgressExists(userId) {
  return Boolean(
    rd69ReadRaw(rd69AccountKey(userId, "saved")) !== null ||
    rd69ReadRaw(rd69AccountKey(userId, "visited")) !== null
  );
}

function rd69MoveLegacyProgressToAccount(userId) {
  const id = String(userId || "");

  if (!id || !rd69LegacyProgress.available) {
    return false;
  }

  if (
    rd69LegacyProgress.ownerId &&
    rd69LegacyProgress.ownerId !== id
  ) {
    return false;
  }

  const destinationEntries = [
    [
      rd69AccountKey(id, "visited"),
      rd69LegacyProgress.visitedRaw || "{}"
    ],
    [
      rd69AccountKey(id, "saved"),
      rd69LegacyProgress.savedRaw || "{}"
    ],
    [
      rd69AccountKey(id, "today"),
      rd69LegacyProgress.todayRaw ||
        JSON.stringify({
          date: getTodayKey(),
          keys: {}
        })
    ]
  ];

  const legacyEntries = [
    [STORAGE_KEY, rd69LegacyProgress.visitedRaw],
    [SAVED_SEGMENTS_KEY, rd69LegacyProgress.savedRaw],
    [TODAY_UNLOCKS_KEY, rd69LegacyProgress.todayRaw]
  ];

  /*
    Remove the old device-wide copies before writing the account keys.
    This avoids temporarily doubling a large road collection in Safari's
    local-storage quota. The old values are restored if any write fails.
  */
  for (const [key] of legacyEntries) {
    rd69RemoveRaw(key);
  }

  try {
    for (const [key, value] of destinationEntries) {
      rd69WriteRaw(key, value);
    }
  } catch (error) {
    console.error(error);

    for (const [key] of destinationEntries) {
      rd69RemoveRaw(key);
    }

    for (const [key, value] of legacyEntries) {
      if (value !== null) {
        try {
          rd69WriteRaw(key, value);
        } catch (restoreError) {
          console.error(restoreError);
        }
      }
    }

    showToast("Could not separate account progress on this device");
    return false;
  }

  rd69LegacyProgress.available = false;
  rd69LegacyProgress.ownerId = id;
  rd69RemoveRaw(RD69_LEGACY_OWNER_KEY);

  return true;
}

function rd69NormaliseVisited(raw) {
  const visited = {};
  let value = raw;

  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (error) {
      value = {};
    }
  }

  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return visited;
  }

  for (const [key, entry] of Object.entries(value)) {
    const timestamp =
      typeof entry === "number"
        ? entry
        : Number(entry?.unlockedAt) ||
          Number(entry?.at) ||
          Number(entry?.timestamp) ||
          0;

    if (Number.isFinite(timestamp) && timestamp > 0) {
      visited[key] = timestamp;
    }
  }

  return visited;
}

function rd69NormaliseSaved(raw, visited) {
  const saved = {};
  let value = raw;

  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (error) {
      value = {};
    }
  }

  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return saved;
  }

  const previousVisited = state.visited;
  state.visited = visited;

  try {
    for (const [key, entry] of Object.entries(value)) {
      const segment = normaliseSavedSegment(key, entry);

      if (segment) {
        saved[segment.id] = segment;
      }
    }
  } finally {
    state.visited = previousVisited;
  }

  return saved;
}

function rd69NormaliseToday(raw) {
  let value = raw;

  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (error) {
      value = null;
    }
  }

  if (
    value &&
    value.date === getTodayKey() &&
    value.keys &&
    typeof value.keys === "object" &&
    !Array.isArray(value.keys)
  ) {
    return value;
  }

  return {
    date: getTodayKey(),
    keys: {}
  };
}

function rd69ReadAccountProgress(userId) {
  const visited = rd69NormaliseVisited(
    rd69ReadRaw(rd69AccountKey(userId, "visited"))
  );
  const savedSegments = rd69NormaliseSaved(
    rd69ReadRaw(rd69AccountKey(userId, "saved")),
    visited
  );
  const todayUnlocks = rd69NormaliseToday(
    rd69ReadRaw(rd69AccountKey(userId, "today"))
  );

  return {
    visited,
    savedSegments,
    todayUnlocks
  };
}

function rd69WriteAccountPart(part, value, options = {}) {
  const userId = String(
    state.accountProgress.activeUserId || ""
  );

  if (!userId) return false;

  try {
    rd69WriteRaw(
      rd69AccountKey(userId, part),
      JSON.stringify(value)
    );
    return true;
  } catch (error) {
    console.error(error);

    if (!options.quiet) {
      showToast(
        part === "saved"
          ? "Storage is full. Some orange roads may not save"
          : "Could not save progress on this device"
      );
    }

    return false;
  }
}

function rd69PersistActiveProgress(options = {}) {
  if (!state.accountProgress.activeUserId) return;

  rd69WriteAccountPart("visited", state.visited, options);
  rd69WriteAccountPart("saved", state.savedSegments, options);
  rd69WriteAccountPart("today", state.todayUnlocks, options);
}

function rd69ApplyProgress(progress, userId = "") {
  state.visited = progress.visited || {};
  state.savedSegments = progress.savedSegments || {};
  state.savedSegmentIds = new Set(
    Object.keys(state.savedSegments)
  );
  state.savedDrawnIds.clear();
  state.savedLayer?.clearLayers();
  state.todayUnlocks = progress.todayUnlocks || {
    date: getTodayKey(),
    keys: {}
  };
  state.needsSavedSegmentsSave = false;
  state.tripUnlocked.clear();

  for (const segment of state.roadSegments) {
    segment.visited = state.savedSegmentIds.has(segment.id);
    segment.currentTrip = false;
    styleSegment(segment);
  }

  drawSavedSegments();
  renderAllStats();

  if (typeof rd53ApplySavedRoadZoomStyle === "function") {
    rd53ApplySavedRoadZoomStyle();
  }

  if (userId) {
    writeJson(RD65_PROGRESS_OWNER_KEY, String(userId));
  }
}

function rd69BlankProgressView() {
  state.accountProgress.activeUserId = "";

  rd69ApplyProgress(
    {
      visited: {},
      savedSegments: {},
      todayUnlocks: {
        date: getTodayKey(),
        keys: {}
      }
    },
    ""
  );
}

function rd69ActivateAccount(userId) {
  const id = String(userId || "");

  if (!id) {
    rd69BlankProgressView();
    return false;
  }

  if (state.accountProgress.activeUserId === id) {
    return true;
  }

  state.accountProgress.switching = true;

  try {
    rd69PersistActiveProgress({ quiet: true });

    if (!rd69AccountProgressExists(id)) {
      rd69MoveLegacyProgressToAccount(id);
    }

    state.accountProgress.activeUserId = id;

    const progress = rd69ReadAccountProgress(id);
    rd69ApplyProgress(progress, id);
    rd69PersistActiveProgress({ quiet: true });

    return true;
  } finally {
    state.accountProgress.switching = false;
  }
}

/* -------------------------------------------------- */
/* Replace the old device-wide save destinations      */
/* -------------------------------------------------- */

loadSavedState = function () {
  roadDiscoveryV69.loadSavedState();

  /*
    Authentication is checked immediately after startup. Keep the map
    blank until the correct Supabase user ID is known.
  */
  state.visited = {};
  state.savedSegments = {};
  state.savedSegmentIds = new Set();
  state.savedDrawnIds.clear();
  state.todayUnlocks = {
    date: getTodayKey(),
    keys: {}
  };
  state.needsSavedSegmentsSave = false;
};

saveVisited = function () {
  rd69WriteAccountPart("visited", state.visited);
};

saveSavedSegments = function () {
  rd69WriteAccountPart("saved", state.savedSegments);
};

saveTodayUnlocks = function () {
  rd69WriteAccountPart("today", state.todayUnlocks);
};

/* -------------------------------------------------- */
/* Change the active road collection with auth        */
/* -------------------------------------------------- */

ensureRoadProfile = async function (options = {}) {
  const userId = String(state.auth.user?.id || "");

  if (userId) {
    rd69ActivateAccount(userId);
  }

  return roadDiscoveryV69.ensureRoadProfile(options);
};

signOutRoadProfile = async function () {
  if (state.isRecording || state.watchId !== null) {
    showToast("Finish Drive before signing out");
    return;
  }

  if (
    state.privateRoadBackup?.busy ||
    state.accountProgress.switching
  ) {
    showToast("Please wait for progress backup to finish");
    return;
  }

  rd69PersistActiveProgress();

  const result = await roadDiscoveryV69.signOutRoadProfile();

  if (!state.auth.user) {
    rd69BlankProgressView();
  }

  return result;
};

renderAuthState = function () {
  const userId = String(state.auth.user?.id || "");

  if (!userId && state.accountProgress.activeUserId) {
    rd69PersistActiveProgress({ quiet: true });
    rd69BlankProgressView();
  }

  return roadDiscoveryV69.renderAuthState();
};

/* ================================================== */
/* Road Discovery AU v71 personal trail colours       */
/* Append this block once to the bottom of app.js v70 */
/* ================================================== */

const RD71_TRAIL_COLOUR_KEY =
  "roadDiscoveryAU.trailColour.v1";

const RD71_TRAIL_COLOURS = Object.freeze({
  orange: {
    label: "Road Orange",
    trail: "#ff8a18",
    current: "#ffb04a"
  },
  gold: {
    label: "Gold",
    trail: "#ffd54a",
    current: "#ffe485"
  },
  red: {
    label: "Red",
    trail: "#ff4d4d",
    current: "#ff8585"
  },
  pink: {
    label: "Pink",
    trail: "#ff5ca8",
    current: "#ff8fc4"
  },
  purple: {
    label: "Purple",
    trail: "#a970ff",
    current: "#c49cff"
  },
  blue: {
    label: "Electric Blue",
    trail: "#2979ff",
    current: "#69a3ff"
  },
  cyan: {
    label: "Cyan",
    trail: "#21d4e8",
    current: "#6ae7f3"
  },
  lime: {
    label: "Lime",
    trail: "#b7f238",
    current: "#d2fa78"
  },
  green: {
    label: "Green",
    trail: "#37d67a",
    current: "#76e7a6"
  },
  white: {
    label: "White",
    trail: "#e8f0ff",
    current: "#ffffff"
  }
});

const roadDiscoveryV71 = {
  getSegmentStyle,
  drawTripLine,
  rd53ApplySavedRoadZoomStyle,
  rd53UpdateMyRoadsButton,
  showToast
};

state.trailColourKey = rd71LoadTrailColourKey();

function rd71ValidTrailColourKey(value) {
  return Object.prototype.hasOwnProperty.call(
    RD71_TRAIL_COLOURS,
    String(value || "")
  );
}

function rd71LoadTrailColourKey() {
  try {
    const saved = localStorage.getItem(
      RD71_TRAIL_COLOUR_KEY
    );

    return rd71ValidTrailColourKey(saved)
      ? saved
      : "orange";
  } catch (error) {
    console.error(error);
    return "orange";
  }
}

function rd71SelectedTrailColour() {
  return (
    RD71_TRAIL_COLOURS[state.trailColourKey] ||
    RD71_TRAIL_COLOURS.orange
  );
}

function rd71SaveTrailColourKey() {
  try {
    localStorage.setItem(
      RD71_TRAIL_COLOUR_KEY,
      state.trailColourKey
    );
  } catch (error) {
    console.error(error);
    showToast("Could not save trail colour");
  }
}

function rd71TrailColourChoicesHtml() {
  return Object.entries(RD71_TRAIL_COLOURS)
    .map(([key, colour]) => {
      const selected = key === state.trailColourKey;

      return `
        <button
          class="trail-colour-choice${selected ? " selected" : ""}"
          type="button"
          data-trail-colour="${key}"
          aria-label="${escapeHtml(colour.label)} trail colour"
          aria-pressed="${String(selected)}"
          style="--trail-choice-colour: ${colour.trail};"
        >
          <span
            class="trail-colour-swatch"
            aria-hidden="true"
          ></span>

          <span class="trail-colour-label">
            ${escapeHtml(colour.label)}
          </span>
        </button>
      `;
    })
    .join("");
}

function rd71InsertTrailColourSetting() {
  if ($("trailColourSetting")) return;

  const mapSection = $("locationMarkerToggle")?.closest(
    ".panel-section"
  );

  if (!mapSection) return;

  const setting = document.createElement("div");
  setting.id = "trailColourSetting";
  setting.className = "trail-colour-setting";

  setting.innerHTML = `
    <div class="trail-colour-heading">
      <div>
        <strong>Trail colour</strong>

        <span>
          Changes your discovered roads on this device only.
          Friends, waypoints, Multiplayer and Hide &amp; Seek keep
          their normal colours.
        </span>
      </div>

      <span
        id="trailColourCurrent"
        class="trail-colour-current"
      ></span>
    </div>

    <div
      id="trailColourGrid"
      class="trail-colour-grid"
      role="group"
      aria-label="Choose trail colour"
    >
      ${rd71TrailColourChoicesHtml()}
    </div>
  `;

  mapSection.appendChild(setting);

  $("trailColourGrid")?.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest(
        "[data-trail-colour]"
      );

      if (!button) return;

      rd71SelectTrailColour(
        button.dataset.trailColour
      );
    }
  );

  rd71UpdateTrailColourUI();
}

function rd71UpdateTrailColourUI() {
  const selected = rd71SelectedTrailColour();
  const current = $("trailColourCurrent");

  if (current) {
    current.textContent = selected.label;
  }

  document
    .querySelectorAll("[data-trail-colour]")
    .forEach((button) => {
      const isSelected =
        button.dataset.trailColour === state.trailColourKey;

      button.classList.toggle("selected", isSelected);
      button.setAttribute(
        "aria-pressed",
        String(isSelected)
      );
    });
}

function rd71ApplyTrailColour() {
  const selected = rd71SelectedTrailColour();

  document.documentElement.style.setProperty(
    "--rd-user-trail-colour",
    selected.trail
  );
  document.documentElement.style.setProperty(
    "--rd-user-current-trail-colour",
    selected.current
  );

  rd53ApplySavedRoadZoomStyle();

  state.tripLayer?.eachLayer?.((layer) => {
    layer?.setStyle?.({
      color: selected.current
    });
  });

  for (const segment of state.roadSegments) {
    if (segment.visited || segment.currentTrip) {
      styleSegment(segment);
    }
  }

  rd71UpdateTrailColourUI();
}

function rd71SelectTrailColour(key) {
  const value = String(key || "");

  if (!rd71ValidTrailColourKey(value)) return;

  state.trailColourKey = value;
  rd71SaveTrailColourKey();
  rd71ApplyTrailColour();

  showToast(
    `${rd71SelectedTrailColour().label} trail selected`
  );
}

function rd71InitTrailColours() {
  rd71InsertTrailColourSetting();
  rd71ApplyTrailColour();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd71InitTrailColours,
    { once: true }
  );
} else {
  rd71InitTrailColours();
}

/* -------------------------------------------------- */
/* Apply the preference only to the user's own roads  */
/* -------------------------------------------------- */

getSegmentStyle = function (segment) {
  const style = roadDiscoveryV71.getSegmentStyle(segment);
  const selected = rd71SelectedTrailColour();

  if (segment?.currentTrip) {
    style.color = selected.current;
  } else if (segment?.visited) {
    style.color = selected.trail;
  }

  return style;
};

drawSavedSegment = function (segment) {
  if (
    !state.savedLayer ||
    !segment ||
    !segment.id ||
    !validCoords(segment.coords) ||
    state.savedDrawnIds.has(segment.id)
  ) {
    return;
  }

  const selected = rd71SelectedTrailColour();
  const zoomStyle = rd53SavedRoadStyle();

  L.polyline(segment.coords, {
    color: selected.trail,
    weight: zoomStyle.weight,
    opacity: zoomStyle.opacity,
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  }).addTo(state.savedLayer);

  state.savedDrawnIds.add(segment.id);
};

drawTripLine = function (a, b) {
  if (!state.tripLayer) return;

  L.polyline(
    [
      [a.lat, a.lng],
      [b.lat, b.lng]
    ],
    {
      color: rd71SelectedTrailColour().current,
      weight: 7,
      opacity: 0.35,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }
  ).addTo(state.tripLayer);
};

rd53ApplySavedRoadZoomStyle = function () {
  const result =
    roadDiscoveryV71.rd53ApplySavedRoadZoomStyle();
  const selected = rd71SelectedTrailColour();

  state.savedLayer?.eachLayer?.((layer) => {
    layer?.setStyle?.({
      color: selected.trail
    });
  });

  return result;
};

rd53UpdateMyRoadsButton = function () {
  const result =
    roadDiscoveryV71.rd53UpdateMyRoadsButton();
  const button = els.myRoadsBtn || $("myRoadsBtn");

  if (!button) return result;

  const driveActive = rd53DriveRoadLayersActive();
  const visible = driveActive || state.myRoadsVisible;

  button.setAttribute(
    "aria-label",
    driveActive
      ? "My roads are shown during Drive Mode"
      : visible
        ? "Hide my roads"
        : "Show my roads"
  );

  button.title = driveActive
    ? "My Roads • shown during Drive"
    : visible
      ? "My Roads • visible"
      : "My Roads • hidden";

  return result;
};

showToast = function (message) {
  const neutralMessage =
    message === "My orange roads shown"
      ? "My roads shown"
      : message === "My orange roads hidden"
        ? "My roads hidden"
        : message;

  return roadDiscoveryV71.showToast(neutralMessage);
};

/* ================================================== */
/* Road Discovery AU v72 Hidden Discoveries           */
/* Append this block once to the bottom of app.js v71 */
/* ================================================== */

const RD72_DISCOVERY_STORAGE_PREFIX =
  "roadDiscoveryAU.hiddenDiscoveries.v1";
const RD72_DISCOVERY_CHECK_MIN_MS = 900;

const RD72_HIDDEN_DISCOVERIES = Object.freeze([
  {
    id: "echo_point_three_sisters",
    region: "Blue Mountains, NSW",
    answer: "Echo Point Lookout — Three Sisters",
    completionMessage: "Three Sisters riddle complete.",
    riddle:
      "Though my name promises a reply, I make no sound. From my edge, three sandstone figures rise above a deep blue valley.",
    zones: [
      {
        lat: -33.73224,
        lng: 150.31217,
        radiusM: 350
      }
    ]
  },
  {
    id: "lithgow_blast_furnace",
    region: "Lithgow, NSW",
    answer: "Lithgow Blast Furnace",
    completionMessage: "Lithgow Blast Furnace riddle complete.",
    riddle:
      "I once breathed fire and turned stone into iron. My flames are gone, but my brick bones still remember Lithgow's industrial heart.",
    zones: [
      {
        lat: -33.475056,
        lng: 150.17035,
        radiusM: 300
      }
    ]
  },
  {
    id: "mount_piper_power_station",
    region: "Central West, NSW",
    answer: "Mount Piper Power Station",
    completionMessage: "Mount Piper riddle complete.",
    riddle:
      "I swallow black stone but produce no jewellery. From the hills west of Lithgow, I send an invisible current toward more than a million homes.",
    zones: [
      {
        lat: -33.355815,
        lng: 150.03508,
        radiusM: 450
      }
    ]
  },
  {
    id: "bathurst_big_gold_panner",
    region: "Bathurst, NSW",
    answer: "The Big Gold Panner",
    completionMessage: "Big Gold Panner riddle complete.",
    riddle:
      "I search endlessly for treasure with a pan too large to carry, yet the gold beneath my gaze is never taken.",
    zones: [
      {
        lat: -33.420432,
        lng: 149.626048,
        radiusM: 250
      }
    ]
  },
  {
    id: "mount_panorama_wahluu_circuit",
    region: "Bathurst, NSW",
    answer: "Mount Panorama/Wahluu Circuit",
    completionMessage: "Mount Panorama/Wahluu riddle complete.",
    riddle:
      "Most days I am a public road with a sixty sign. On special days, engines roar and a nation watches. I climb a mountain known long before the chequered flag.",
    checkpoints: [
      {
        id: "pit_straight",
        lat: -33.439682,
        lng: 149.558735,
        radiusM: 190
      },
      {
        id: "brocks_skyline",
        lat: -33.455193,
        lng: 149.551732,
        radiusM: 210
      },
      {
        id: "conrod_straight",
        lat: -33.44986,
        lng: 149.55905,
        radiusM: 210
      }
    ],
    note:
      "Mount Panorama/Wahluu has enduring significance to the Wiradjuri people. The circuit is a public road outside closures: obey signs, closures and the posted speed limit."
  }
]);

const roadDiscoveryV72 = {
  startDrive,
  finishDrive,
  onGpsPosition,
  ensureRoadProfile,
  signOutRoadProfile,
  renderAuthState,
  rd68OpenTrophyRoom
};

state.hiddenDiscoveries = {
  activeUserId: "",
  completed: {},
  unsynced: new Set(),
  pending: new Set(),
  circuitCheckpoints: new Set(),
  lastCheckAt: 0,
  loading: false,
  syncing: false,
  syncError: false,
  deferredAchievementOptions: null
};

function rd72DiscoveryById(discoveryId) {
  return (
    RD72_HIDDEN_DISCOVERIES.find(
      (discovery) => discovery.id === discoveryId
    ) || null
  );
}

function rd72ValidDiscoveryId(discoveryId) {
  return Boolean(
    rd72DiscoveryById(String(discoveryId || ""))
  );
}

function rd72StorageKey(userId) {
  return (
    `${RD72_DISCOVERY_STORAGE_PREFIX}.` +
    String(userId || "")
  );
}

function rd72NormaliseCompletedAt(value) {
  const date = new Date(value || Date.now());

  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

function rd72ReadLocalProgress(userId) {
  const empty = {
    completed: {},
    unsynced: new Set()
  };

  if (!userId) return empty;

  try {
    const raw = localStorage.getItem(
      rd72StorageKey(userId)
    );

    if (!raw) return empty;

    const parsed = JSON.parse(raw);
    const completed = {};

    for (const [discoveryId, completedAt] of Object.entries(
      parsed?.completed || {}
    )) {
      if (!rd72ValidDiscoveryId(discoveryId)) continue;

      completed[discoveryId] =
        rd72NormaliseCompletedAt(completedAt);
    }

    const unsynced = new Set(
      Array.isArray(parsed?.unsynced)
        ? parsed.unsynced.filter(rd72ValidDiscoveryId)
        : []
    );

    return {
      completed,
      unsynced
    };
  } catch (error) {
    console.error(error);
    return empty;
  }
}

function rd72SaveLocalProgress() {
  const userId = String(
    state.hiddenDiscoveries.activeUserId || ""
  );

  if (!userId) return;

  try {
    localStorage.setItem(
      rd72StorageKey(userId),
      JSON.stringify({
        completed: state.hiddenDiscoveries.completed,
        unsynced: Array.from(
          state.hiddenDiscoveries.unsynced
        )
      })
    );
  } catch (error) {
    console.error(error);
    showToast("Could not save Hidden Discovery progress");
  }
}

function rd72ResetDriveDiscoveryState() {
  state.hiddenDiscoveries.pending.clear();
  state.hiddenDiscoveries.circuitCheckpoints.clear();
  state.hiddenDiscoveries.lastCheckAt = 0;
}

function rd72ClearAccountView() {
  state.hiddenDiscoveries.activeUserId = "";
  state.hiddenDiscoveries.completed = {};
  state.hiddenDiscoveries.unsynced = new Set();
  state.hiddenDiscoveries.loading = false;
  state.hiddenDiscoveries.syncing = false;
  state.hiddenDiscoveries.syncError = false;

  rd72ResetDriveDiscoveryState();
  rd72RenderHiddenDiscoveries();
}

function rd72ActivateAccount(userId) {
  const id = String(userId || "");

  if (!id) {
    rd72ClearAccountView();
    return;
  }

  if (state.hiddenDiscoveries.activeUserId === id) {
    return;
  }

  state.hiddenDiscoveries.activeUserId = id;

  const local = rd72ReadLocalProgress(id);

  state.hiddenDiscoveries.completed = local.completed;
  state.hiddenDiscoveries.unsynced = local.unsynced;
  state.hiddenDiscoveries.loading = false;
  state.hiddenDiscoveries.syncing = false;
  state.hiddenDiscoveries.syncError = false;

  rd72ResetDriveDiscoveryState();
  rd72RenderHiddenDiscoveries();

  void rd72LoadServerProgress(id);
}

function rd72RowsFromRpc(data) {
  if (Array.isArray(data)) return data;

  if (data && typeof data === "object") {
    return [data];
  }

  return [];
}

function rd72MergeServerRows(rows) {
  for (const row of rows) {
    const discoveryId = String(
      row?.discovery_id || row?.id || ""
    );

    if (!rd72ValidDiscoveryId(discoveryId)) continue;

    const serverCompletedAt = rd72NormaliseCompletedAt(
      row?.completed_at
    );

    const localCompletedAt =
      state.hiddenDiscoveries.completed[discoveryId];

    if (
      !localCompletedAt ||
      new Date(serverCompletedAt).getTime() <
        new Date(localCompletedAt).getTime()
    ) {
      state.hiddenDiscoveries.completed[discoveryId] =
        serverCompletedAt;
    }

    state.hiddenDiscoveries.unsynced.delete(discoveryId);
  }
}

async function rd72LoadServerProgress(expectedUserId) {
  const client = state.auth.client;
  const userId = String(expectedUserId || "");

  if (!client || !userId) return;

  state.hiddenDiscoveries.loading = true;
  rd72RenderHiddenDiscoveries();

  const { data, error } = await client.rpc(
    "get_my_hidden_discoveries"
  );

  if (
    state.hiddenDiscoveries.activeUserId !== userId
  ) {
    return;
  }

  state.hiddenDiscoveries.loading = false;

  if (error) {
    console.error(error);
    state.hiddenDiscoveries.syncError = true;
    rd72RenderHiddenDiscoveries();
    return;
  }

  state.hiddenDiscoveries.syncError = false;

  rd72MergeServerRows(
    rd72RowsFromRpc(data)
  );

  rd72SaveLocalProgress();
  rd72RenderHiddenDiscoveries();

  if (state.hiddenDiscoveries.unsynced.size > 0) {
    void rd72SyncPendingCompletions();
  }
}

async function rd72SyncPendingCompletions() {
  const hidden = state.hiddenDiscoveries;
  const client = state.auth.client;
  const userId = String(hidden.activeUserId || "");
  const currentUserId = String(
    state.auth.user?.id || ""
  );

  if (
    hidden.syncing ||
    !client ||
    !userId ||
    currentUserId !== userId ||
    hidden.unsynced.size === 0
  ) {
    return;
  }

  const discoveryIds = Array.from(
    hidden.unsynced
  ).filter(rd72ValidDiscoveryId);

  if (discoveryIds.length === 0) return;

  hidden.syncing = true;
  rd72RenderHiddenDiscoveries();

  const { data, error } = await client.rpc(
    "complete_my_hidden_discoveries",
    {
      p_discovery_ids: discoveryIds
    }
  );

  if (hidden.activeUserId !== userId) {
    return;
  }

  hidden.syncing = false;

  if (error) {
    console.error(error);
    hidden.syncError = true;

    rd72SaveLocalProgress();
    rd72RenderHiddenDiscoveries();
    return;
  }

  const rows = rd72RowsFromRpc(data);

  hidden.syncError = false;

  if (rows.length > 0) {
    rd72MergeServerRows(rows);
  }

  for (const discoveryId of discoveryIds) {
    hidden.unsynced.delete(discoveryId);
  }

  rd72SaveLocalProgress();
  rd72RenderHiddenDiscoveries();
}

function rd72PointInside(point, zone) {
  return haversine(point, zone) <= zone.radiusM;
}

function rd72CheckDiscoveryPoint(point) {
  const hidden = state.hiddenDiscoveries;
  const userId = String(state.auth.user?.id || "");

  if (
    !state.isRecording ||
    !userId ||
    hidden.activeUserId !== userId ||
    !Number.isFinite(point?.lat) ||
    !Number.isFinite(point?.lng) ||
    !Number.isFinite(point?.accuracy) ||
    point.accuracy > MAX_GPS_ACCURACY_M
  ) {
    return;
  }

  const checkedAt =
    Number(point.timestamp) || Date.now();

  if (
    checkedAt - hidden.lastCheckAt <
    RD72_DISCOVERY_CHECK_MIN_MS
  ) {
    return;
  }

  hidden.lastCheckAt = checkedAt;

  for (const discovery of RD72_HIDDEN_DISCOVERIES) {
    if (
      hidden.completed[discovery.id] ||
      hidden.pending.has(discovery.id)
    ) {
      continue;
    }

    if (Array.isArray(discovery.zones)) {
      const entered = discovery.zones.some((zone) =>
        rd72PointInside(point, zone)
      );

      if (entered) {
        hidden.pending.add(discovery.id);
      }

      continue;
    }

    if (!Array.isArray(discovery.checkpoints)) {
      continue;
    }

    for (const checkpoint of discovery.checkpoints) {
      if (rd72PointInside(point, checkpoint)) {
        hidden.circuitCheckpoints.add(
          checkpoint.id
        );
      }
    }

    const circuitComplete =
      discovery.checkpoints.every((checkpoint) =>
        hidden.circuitCheckpoints.has(checkpoint.id)
      );

    if (circuitComplete) {
      hidden.pending.add(discovery.id);
    }
  }
}

function rd72CompleteDriveDiscoveries(discoveryIds) {
  const hidden = state.hiddenDiscoveries;
  const completedAt = new Date().toISOString();
  const newlyCompleted = [];

  for (const discoveryId of discoveryIds) {
    if (
      !rd72ValidDiscoveryId(discoveryId) ||
      hidden.completed[discoveryId]
    ) {
      continue;
    }

    hidden.completed[discoveryId] = completedAt;
    hidden.unsynced.add(discoveryId);
    newlyCompleted.push(discoveryId);
  }

  rd72ResetDriveDiscoveryState();

  if (newlyCompleted.length === 0) {
    return;
  }

  rd72SaveLocalProgress();
  rd72RenderHiddenDiscoveries();

  void rd72SyncPendingCompletions();

  if (hasActiveHideSeekRound()) {
    return;
  }

  window.setTimeout(() => {
    if (
      !state.isRecording &&
      !hasActiveHideSeekRound()
    ) {
      rd72OpenCompletion(newlyCompleted);
    }
  }, 300);
}

function rd72CompletedDate(discoveryId) {
  const value =
    state.hiddenDiscoveries.completed[discoveryId];

  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Completed";
  }

  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function rd72DiscoveryCard(discovery, index) {
  const completed = Boolean(
    state.hiddenDiscoveries.completed[discovery.id]
  );

  const answer = completed
    ? `
      <div class="rd-hidden-answer">
        <span>Discovered</span>

        <strong>
          ${escapeHtml(discovery.answer)}
        </strong>

        <small>
          ${escapeHtml(
            rd72CompletedDate(discovery.id)
          )}
        </small>
      </div>
    `
    : `
      <div class="rd-hidden-locked-answer">
        Answer hidden until discovered
      </div>
    `;

  const note =
    completed && discovery.note
      ? `
        <p class="rd-hidden-cultural-note">
          ${escapeHtml(discovery.note)}
        </p>
      `
      : "";

  return `
    <article
      class="rd-hidden-card ${
        completed ? "unlocked" : "locked"
      }"
    >
      <div class="rd-hidden-card-topline">
        <span>
          Hidden Discovery ${String(index + 1).padStart(
            2,
            "0"
          )}
        </span>

        <strong>
          ${completed ? "✓ Complete" : "Undiscovered"}
        </strong>
      </div>

      <div class="rd-hidden-region">
        ${escapeHtml(discovery.region)}
      </div>

      <blockquote>
        ${escapeHtml(discovery.riddle)}
      </blockquote>

      ${answer}
      ${note}
    </article>
  `;
}

function rd72CreateHiddenDiscoveryUi() {
  if (!$("rd72HiddenDiscoveryOverlay")) {
    const room = document.createElement("section");

    room.id = "rd72HiddenDiscoveryOverlay";
    room.className =
      "confirm-overlay rd-hidden-overlay hidden";

    room.setAttribute("aria-hidden", "true");

    room.innerHTML = `
      <div
        class="confirm-card rd-hidden-room-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rd72HiddenDiscoveryTitle"
      >
        <div class="rd-hidden-header">
          <div>
            <div class="rd-hidden-kicker">
              Road Discovery AU
            </div>

            <h2 id="rd72HiddenDiscoveryTitle">
              Hidden Discoveries
            </h2>
          </div>

          <button
            id="rd72HiddenDiscoveryCloseBtn"
            class="rd-hidden-close"
            type="button"
            aria-label="Close Hidden Discoveries"
          >
            ×
          </button>
        </div>

        <div class="rd-hidden-safety-note">
          <strong>Start Drive required.</strong>

          Solve and plan your journey before moving.
          Discover a nearby road while Drive Mode is
          active, then press Finish Drive to reveal the
          Hidden Discovery. Stay on public roads, never
          enter restricted or private property, and do
          not use your phone while moving.
        </div>

        <div class="rd-hidden-summary">
          <strong id="rd72HiddenDiscoveryProgress">
            0 of 5 discovered
          </strong>

          <span id="rd72HiddenDiscoverySyncStatus"></span>
        </div>

        <div class="rd-hidden-state-heading">
          New South Wales
        </div>

        <div
          id="rd72HiddenDiscoveryList"
          class="rd-hidden-list"
        ></div>

        <button
          id="rd72HiddenDiscoveryDoneBtn"
          class="wide-btn rd-hidden-done"
          type="button"
        >
          Back to Map
        </button>
      </div>
    `;

    ($("appShell") || document.body).appendChild(room);
  }

  if (!$("rd72HiddenCompleteOverlay")) {
    const completion =
      document.createElement("section");

    completion.id = "rd72HiddenCompleteOverlay";
    completion.className =
      "confirm-overlay rd-hidden-complete-overlay hidden";

    completion.setAttribute("aria-hidden", "true");

    completion.innerHTML = `
      <div
        class="confirm-card rd-hidden-complete-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rd72HiddenCompleteTitle"
      >
        <div
          class="rd-hidden-complete-mark"
          aria-hidden="true"
        >
          ◇
        </div>

        <div class="rd-hidden-kicker">
          Road Discovery AU
        </div>

        <h2 id="rd72HiddenCompleteTitle">
          Hidden Discovery Complete
        </h2>

        <div
          id="rd72HiddenCompleteList"
          class="rd-hidden-complete-list"
        ></div>

        <button
          id="rd72HiddenCompleteDoneBtn"
          class="wide-btn"
          type="button"
        >
          Continue
        </button>
      </div>
    `;

    ($("appShell") || document.body).appendChild(
      completion
    );
  }
}

function rd72InsertHiddenDiscoverySetting() {
  if ($("rd72OpenHiddenDiscoveryBtn")) {
    return;
  }

  const settingsContent = document.querySelector(
    "#settingsPanel .panel-content"
  );

  if (!settingsContent) return;

  const section = document.createElement("section");

  section.className =
    "panel-section rd-hidden-discovery-settings";

  section.innerHTML = `
    <h3>Hidden Discoveries</h3>

    <p class="rd-hidden-settings-copy">
      Solve location riddles, explore the road and
      reveal each answer after Finish Drive.
    </p>

    <button
      id="rd72OpenHiddenDiscoveryBtn"
      class="ghost-btn wide-btn"
      type="button"
    >
      Open Hidden Discoveries
    </button>

    <p
      id="rd72HiddenSettingsProgress"
      class="rd-hidden-settings-progress"
    ></p>
  `;

  const achievements = settingsContent.querySelector(
    ".rd-achievement-settings"
  );

  if (achievements) {
    achievements.insertAdjacentElement(
      "afterend",
      section
    );
  } else {
    settingsContent.insertBefore(
      section,
      settingsContent.firstElementChild
    );
  }
}

function rd72RenderHiddenDiscoveries() {
  const hidden = state.hiddenDiscoveries;

  const completedCount =
    RD72_HIDDEN_DISCOVERIES.filter(
      (discovery) =>
        Boolean(hidden.completed[discovery.id])
    ).length;

  const total = RD72_HIDDEN_DISCOVERIES.length;

  const progressText =
    `${completedCount} of ${total} discovered`;

  const settingsProgress = $(
    "rd72HiddenSettingsProgress"
  );

  const roomProgress = $(
    "rd72HiddenDiscoveryProgress"
  );

  const syncStatus = $(
    "rd72HiddenDiscoverySyncStatus"
  );

  const list = $("rd72HiddenDiscoveryList");

  if (settingsProgress) {
    settingsProgress.textContent = state.auth.user
      ? progressText
      : `${progressText} • Sign in to save progress`;
  }

  if (roomProgress) {
    roomProgress.textContent = progressText;
  }

  if (syncStatus) {
    if (!state.auth.user) {
      syncStatus.textContent =
        "Sign in to complete and sync riddles";
    } else if (hidden.loading) {
      syncStatus.textContent =
        "Loading account progress...";
    } else if (hidden.syncing) {
      syncStatus.textContent = "Syncing...";
    } else if (hidden.syncError) {
      syncStatus.textContent =
        "Saved on this device • sync will retry";
    } else if (hidden.unsynced.size > 0) {
      syncStatus.textContent =
        "Saved on this device • sync pending";
    } else {
      syncStatus.textContent =
        "Saved to your Road Profile";
    }
  }

  if (list) {
    list.innerHTML =
      RD72_HIDDEN_DISCOVERIES.map(
        rd72DiscoveryCard
      ).join("");
  }
}

function rd72OpenHiddenDiscoveryRoom() {
  const overlay = $(
    "rd72HiddenDiscoveryOverlay"
  );

  if (!overlay) return;

  closePanels();

  if (typeof rd68CloseTrophyRoom === "function") {
    rd68CloseTrophyRoom();
  }

  rd72RenderHiddenDiscoveries();

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");

  document.body.classList.add("rd-hidden-open");

  window.setTimeout(() => {
    $("rd72HiddenDiscoveryCloseBtn")?.focus();
  }, 0);
}

function rd72CloseHiddenDiscoveryRoom() {
  const overlay = $(
    "rd72HiddenDiscoveryOverlay"
  );

  if (!overlay) return;

  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");

  document.body.classList.remove(
    "rd-hidden-open"
  );
}

function rd72OpenCompletion(discoveryIds) {
  const overlay = $("rd72HiddenCompleteOverlay");
  const list = $("rd72HiddenCompleteList");
  const title = $("rd72HiddenCompleteTitle");

  const discoveries = discoveryIds
    .map(rd72DiscoveryById)
    .filter(Boolean);

  if (
    !overlay ||
    !list ||
    discoveries.length === 0
  ) {
    return;
  }

  if (title) {
    title.textContent =
      discoveries.length === 1
        ? "Hidden Discovery Complete"
        : "Hidden Discoveries Complete";
  }

  list.innerHTML = discoveries
    .map(
      (discovery) => `
        <article>
          <strong>
            ${escapeHtml(discovery.answer)}
          </strong>

          <span>
            ${escapeHtml(
              discovery.completionMessage
            )}
          </span>
        </article>
      `
    )
    .join("");

  closePanels();
  rd72CloseHiddenDiscoveryRoom();

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");

  document.body.classList.add(
    "rd-hidden-complete-open"
  );

  window.setTimeout(() => {
    $("rd72HiddenCompleteDoneBtn")?.focus();
  }, 0);
}

function rd72CloseCompletion() {
  const overlay = $("rd72HiddenCompleteOverlay");

  if (!overlay) return;

  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");

  document.body.classList.remove(
    "rd-hidden-complete-open"
  );

  const deferred =
    state.hiddenDiscoveries
      .deferredAchievementOptions;

  state.hiddenDiscoveries
    .deferredAchievementOptions = null;

  if (deferred) {
    window.setTimeout(() => {
      roadDiscoveryV72.rd68OpenTrophyRoom(
        deferred
      );
    }, 180);
  }
}

function rd72BindHiddenDiscoveryEvents() {
  $("rd72OpenHiddenDiscoveryBtn")?.addEventListener(
    "click",
    rd72OpenHiddenDiscoveryRoom
  );

  [
    "rd72HiddenDiscoveryCloseBtn",
    "rd72HiddenDiscoveryDoneBtn"
  ].forEach((id) => {
    $(id)?.addEventListener(
      "click",
      rd72CloseHiddenDiscoveryRoom
    );
  });

  $("rd72HiddenCompleteDoneBtn")?.addEventListener(
    "click",
    rd72CloseCompletion
  );

  $("rd72HiddenDiscoveryOverlay")?.addEventListener(
    "click",
    (event) => {
      if (
        event.target ===
        $("rd72HiddenDiscoveryOverlay")
      ) {
        rd72CloseHiddenDiscoveryRoom();
      }
    }
  );

  $("rd72HiddenCompleteOverlay")?.addEventListener(
    "click",
    (event) => {
      if (
        event.target ===
        $("rd72HiddenCompleteOverlay")
      ) {
        rd72CloseCompletion();
      }
    }
  );

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    if (
      !$("rd72HiddenCompleteOverlay")
        ?.classList.contains("hidden")
    ) {
      rd72CloseCompletion();
      return;
    }

    if (
      !$("rd72HiddenDiscoveryOverlay")
        ?.classList.contains("hidden")
    ) {
      rd72CloseHiddenDiscoveryRoom();
    }
  });

  window.addEventListener("online", () => {
    void rd72SyncPendingCompletions();
  });
}

function rd72InitHiddenDiscoveries() {
  rd72CreateHiddenDiscoveryUi();
  rd72InsertHiddenDiscoverySetting();
  rd72BindHiddenDiscoveryEvents();
  rd72RenderHiddenDiscoveries();

  const userId = String(
    state.auth.user?.id || ""
  );

  if (userId) {
    rd72ActivateAccount(userId);
  }
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd72InitHiddenDiscoveries,
    { once: true }
  );
} else {
  rd72InitHiddenDiscoveries();
}

/* -------------------------------------------------- */
/* Reuse existing drive and account lifecycles        */
/* -------------------------------------------------- */

startDrive = async function () {
  const wasRunning = Boolean(
    state.isRecording || state.watchId !== null
  );

  if (!wasRunning) {
    rd72ResetDriveDiscoveryState();
  }

  return roadDiscoveryV72.startDrive();
};

onGpsPosition = function (position) {
  const result =
    roadDiscoveryV72.onGpsPosition(position);

  const point = positionToPoint(position);

  rd72CheckDiscoveryPoint(point);

  return result;
};

finishDrive = function () {
  const wasRunning = Boolean(
    state.isRecording || state.watchId !== null
  );

  const pending = Array.from(
    state.hiddenDiscoveries.pending
  );

  const result =
    roadDiscoveryV72.finishDrive();

  if (wasRunning) {
    rd72CompleteDriveDiscoveries(pending);
  }

  return result;
};

ensureRoadProfile = async function (options = {}) {
  const userId = String(
    state.auth.user?.id || ""
  );

  if (userId) {
    rd72ActivateAccount(userId);
  }

  const result =
    await roadDiscoveryV72.ensureRoadProfile(
      options
    );

  const confirmedUserId = String(
    state.auth.user?.id || ""
  );

  if (confirmedUserId) {
    rd72ActivateAccount(confirmedUserId);
  }

  return result;
};

signOutRoadProfile = async function () {
  rd72SaveLocalProgress();

  const result =
    await roadDiscoveryV72.signOutRoadProfile();

  if (!state.auth.user) {
    rd72ClearAccountView();
  }

  return result;
};

renderAuthState = function () {
  const result =
    roadDiscoveryV72.renderAuthState();

  const userId = String(
    state.auth.user?.id || ""
  );

  if (userId) {
    rd72ActivateAccount(userId);
  } else if (
    state.hiddenDiscoveries.activeUserId
  ) {
    rd72ClearAccountView();
  } else {
    rd72RenderHiddenDiscoveries();
  }

  return result;
};

rd68OpenTrophyRoom = function (options = {}) {
  const completionOpen =
    !$("rd72HiddenCompleteOverlay")
      ?.classList.contains("hidden");

  if (completionOpen) {
    state.hiddenDiscoveries
      .deferredAchievementOptions = options;

    return;
  }

  return roadDiscoveryV72.rd68OpenTrophyRoom(
    options
  );
};

/* ================================================== */
/* Road Discovery AU v73 General Menu                 */
/* Append this block once to the bottom of app.js v72 */
/* ================================================== */

const roadDiscoveryV73 = {
  closePanels,
  renderAllStats,
  renderAuthState,
  rd72RenderHiddenDiscoveries
};

function rd73CreateGeneralMenu() {
  if ($("rd73GeneralMenuPanel")) return;

  const panel = document.createElement("aside");

  panel.id = "rd73GeneralMenuPanel";
  panel.className =
    "side-panel rd-general-menu-panel hidden";

  panel.setAttribute("aria-hidden", "true");
  panel.setAttribute("aria-label", "General Menu");

  panel.innerHTML = `
    <div class="panel-header rd-general-menu-header">
      <div>
        <h2>General Menu</h2>

        <p>
          Progress, discoveries and app controls.
        </p>
      </div>

      <button
        id="rd73CloseGeneralMenuBtn"
        class="panel-close-btn"
        type="button"
        aria-label="Close General Menu"
      >
        ×
      </button>
    </div>

    <div class="panel-content rd-general-menu-content">
      <div class="rd-general-menu-list">
        <button
          id="rd73OpenHiddenDiscoveriesBtn"
          class="rd-general-menu-item"
          type="button"
        >
          <span
            class="rd-general-menu-icon hidden-discovery"
            aria-hidden="true"
          >
            ◇
          </span>

          <span class="rd-general-menu-copy">
            <strong>Hidden Discoveries</strong>

            <small id="rd73HiddenDiscoveryProgress">
              0 / 5 discovered
            </small>
          </span>

          <span
            class="rd-general-menu-arrow"
            aria-hidden="true"
          >
            ›
          </span>
        </button>

        <button
          id="rd73OpenTrophyRoomBtn"
          class="rd-general-menu-item"
          type="button"
        >
          <span
            class="rd-general-menu-icon trophy"
            aria-hidden="true"
          >
            ★
          </span>

          <span class="rd-general-menu-copy">
            <strong>Trophy Room</strong>

            <small id="rd73TrophyProgress">
              View road milestones and achievements
            </small>
          </span>

          <span
            class="rd-general-menu-arrow"
            aria-hidden="true"
          >
            ›
          </span>
        </button>

        <button
          id="rd73OpenSettingsBtn"
          class="rd-general-menu-item"
          type="button"
        >
          <span
            class="rd-general-menu-icon settings"
            aria-hidden="true"
          >
            ⚙
          </span>

          <span class="rd-general-menu-copy">
            <strong>Settings</strong>

            <small>
              Map, trail colour, Friends and Data
            </small>
          </span>

          <span
            class="rd-general-menu-arrow"
            aria-hidden="true"
          >
            ›
          </span>
        </button>

        <button
          id="rd73OpenAboutBtn"
          class="rd-general-menu-item"
          type="button"
        >
          <span
            class="rd-general-menu-icon about"
            aria-hidden="true"
          >
            i
          </span>

          <span class="rd-general-menu-copy">
            <strong>About Road Discovery</strong>

            <small>
              What the app does and how to use it safely
            </small>
          </span>

          <span
            class="rd-general-menu-arrow"
            aria-hidden="true"
          >
            ›
          </span>
        </button>
      </div>

      <p class="rd-general-menu-safety">
        Plan while stopped. Keep your eyes on the road while moving.
      </p>
    </div>
  `;

  ($("appShell") || document.body).appendChild(panel);

  els.rd73GeneralMenuPanel = panel;
}

function rd73CleanActualSettings() {
  [
    ".road-discovery-about-settings",
    ".rd-achievement-settings",
    ".rd-hidden-discovery-settings"
  ].forEach((selector) => {
    document.querySelector(
      `#settingsPanel ${selector}`
    )?.remove();
  });

  const settingsTitle = document.querySelector(
    "#settingsPanel .panel-header h2"
  );

  const settingsDescription = document.querySelector(
    "#settingsPanel .panel-header p"
  );

  if (settingsTitle) {
    settingsTitle.textContent = "Settings";
  }

  if (settingsDescription) {
    settingsDescription.textContent =
      "Map, privacy and account controls.";
  }

  if (els.closeSettingsBtn) {
    els.closeSettingsBtn.textContent = "‹";

    els.closeSettingsBtn.classList.add(
      "rd-settings-back-btn"
    );

    els.closeSettingsBtn.setAttribute(
      "aria-label",
      "Back to General Menu"
    );

    els.closeSettingsBtn.title =
      "Back to General Menu";
  }
}

function rd73UnlockedCount() {
  if (typeof rd68UnlockedCount === "function") {
    return rd68UnlockedCount();
  }

  return Object.keys(
    state.savedSegments || {}
  ).length;
}

function rd73CompactNumber(value) {
  if (typeof rd68MilestoneCount === "function") {
    return rd68MilestoneCount(value);
  }

  return formatCompactNumber(
    Number(value) || 0
  );
}

function rd73RenderGeneralMenuProgress() {
  const hiddenProgress = $(
    "rd73HiddenDiscoveryProgress"
  );

  if (hiddenProgress) {
    const completed =
      RD72_HIDDEN_DISCOVERIES.filter(
        (discovery) =>
          Boolean(
            state.hiddenDiscoveries.completed[
              discovery.id
            ]
          )
      ).length;

    hiddenProgress.textContent =
      `${completed} / ` +
      `${RD72_HIDDEN_DISCOVERIES.length} discovered`;
  }

  const trophyProgress = $(
    "rd73TrophyProgress"
  );

  if (!trophyProgress) return;

  const count = rd73UnlockedCount();

  const finalAchievement =
    RD68_ACHIEVEMENTS[
      RD68_ACHIEVEMENTS.length - 1
    ];

  if (count >= finalAchievement.threshold) {
    trophyProgress.textContent =
      `${rd73CompactNumber(count)} roads • ` +
      `All milestones completed`;

    return;
  }

  const next = rd68NextAchievement(count);

  trophyProgress.textContent =
    `${rd73CompactNumber(count)} / ` +
    `${rd73CompactNumber(next.threshold)} • ` +
    `Next: ${next.name}`;
}

function rd73OpenGeneralMenu() {
  rd73RenderGeneralMenuProgress();
  openPanel("rd73GeneralMenuPanel");
}

function rd73CloseGeneralMenuOnly() {
  const panel = $("rd73GeneralMenuPanel");

  if (!panel) return;

  panel.classList.add("hidden");
  panel.setAttribute("aria-hidden", "true");
}

function rd73OpenActualSettings() {
  openPanel("settingsPanel");
}

function rd73OpenHiddenDiscoveries() {
  closePanels();
  rd72OpenHiddenDiscoveryRoom();
}

function rd73OpenTrophyRoom() {
  closePanels();
  rd68OpenTrophyRoom();
}

function rd73OpenAbout() {
  closePanels();

  rd64OpenAbout({
    firstRun: false
  });
}

function rd73BindGeneralMenuEvents() {
  /*
    Capture the gear click before the old Settings
    listener runs. The button stays in the same place.
  */
  els.settingsBtn?.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      rd73OpenGeneralMenu();
    },
    true
  );

  els.settingsBtn?.setAttribute(
    "aria-label",
    "Open General Menu"
  );

  if (els.settingsBtn) {
    els.settingsBtn.title = "General Menu";
  }

  $("rd73CloseGeneralMenuBtn")?.addEventListener(
    "click",
    () => closePanels()
  );

  $("rd73OpenHiddenDiscoveriesBtn")?.addEventListener(
    "click",
    rd73OpenHiddenDiscoveries
  );

  $("rd73OpenTrophyRoomBtn")?.addEventListener(
    "click",
    rd73OpenTrophyRoom
  );

  $("rd73OpenSettingsBtn")?.addEventListener(
    "click",
    rd73OpenActualSettings
  );

  $("rd73OpenAboutBtn")?.addEventListener(
    "click",
    rd73OpenAbout
  );

  /*
    The Settings header button now returns to
    General Menu instead of closing everything.
  */
  els.closeSettingsBtn?.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      rd73OpenGeneralMenu();
    },
    true
  );

  /*
    The original backdrop listener existed before
    General Menu, so explicitly close the new panel.
  */
  els.panelBackdrop?.addEventListener(
    "click",
    rd73CloseGeneralMenuOnly
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        !$("rd73GeneralMenuPanel")
          ?.classList.contains("hidden")
      ) {
        closePanels();
      }
    }
  );
}

function rd73InitGeneralMenu() {
  rd73CreateGeneralMenu();
  rd73CleanActualSettings();
  rd73BindGeneralMenuEvents();
  rd73RenderGeneralMenuProgress();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd73InitGeneralMenu,
    { once: true }
  );
} else {
  rd73InitGeneralMenu();
}

/* -------------------------------------------------- */
/* Include General Menu in shared panel lifecycle     */
/* -------------------------------------------------- */

closePanels = function (hideBackdrop = true) {
  const result =
    roadDiscoveryV73.closePanels(
      hideBackdrop
    );

  rd73CloseGeneralMenuOnly();

  return result;
};

renderAllStats = function () {
  const result =
    roadDiscoveryV73.renderAllStats();

  rd73RenderGeneralMenuProgress();

  return result;
};

renderAuthState = function () {
  const result =
    roadDiscoveryV73.renderAuthState();

  rd73RenderGeneralMenuProgress();

  return result;
};

rd72RenderHiddenDiscoveries = function () {
  const result =
    roadDiscoveryV73
      .rd72RenderHiddenDiscoveries();

  rd73RenderGeneralMenuProgress();

  return result;
};

/* ================================================== */
/* Road Discovery AU v74 Hawkesbury Lookout           */
/* Append this block once to the bottom of app.js v73 */
/* ================================================== */

const RD74_HAWKESBURY_DISCOVERY = Object.freeze({
  id: "hawkesbury_lookout",
  region: "Blue Mountains, NSW",
  answer: "Hawkesbury Lookout",
  completionMessage:
    "Hawkesbury Lookout riddle complete.",
  riddle:
    "My name belongs to one river, but another runs below my gaze. From the edge of the mountains, I watch the plain stretch toward Sydney's distant lights.",
  zones: [
    {
      lat: -33.66721,
      lng: 150.65192,
      radiusM: 250
    }
  ]
});

const roadDiscoveryV74 = {
  rd72DiscoveryById,
  rd72ResetDriveDiscoveryState,
  rd72CheckDiscoveryPoint,
  rd72RenderHiddenDiscoveries,
  rd73RenderGeneralMenuProgress
};

state.hiddenDiscoveries.hawkesburyLastCheckAt = 0;

function rd74AllHiddenDiscoveries() {
  return [
    ...RD72_HIDDEN_DISCOVERIES,
    RD74_HAWKESBURY_DISCOVERY
  ];
}

function rd74CompletedCount() {
  return rd74AllHiddenDiscoveries().filter(
    (discovery) =>
      Boolean(
        state.hiddenDiscoveries.completed[
          discovery.id
        ]
      )
  ).length;
}

function rd74RenderSixDiscoveryProgress() {
  const completed = rd74CompletedCount();
  const total =
    rd74AllHiddenDiscoveries().length;

  const progressText =
    `${completed} of ${total} discovered`;

  const settingsProgress = $(
    "rd72HiddenSettingsProgress"
  );

  const roomProgress = $(
    "rd72HiddenDiscoveryProgress"
  );

  const generalProgress = $(
    "rd73HiddenDiscoveryProgress"
  );

  if (settingsProgress) {
    settingsProgress.textContent =
      state.auth.user
        ? progressText
        : `${progressText} • Sign in to save progress`;
  }

  if (roomProgress) {
    roomProgress.textContent = progressText;
  }

  if (generalProgress) {
    generalProgress.textContent =
      `${completed} / ${total} discovered`;
  }
}

function rd74RenderHawkesburyCard() {
  const list = $(
    "rd72HiddenDiscoveryList"
  );

  if (!list) return;

  list.querySelector(
    '[data-hidden-discovery-id="hawkesbury_lookout"]'
  )?.remove();

  const holder =
    document.createElement("div");

  holder.innerHTML = rd72DiscoveryCard(
    RD74_HAWKESBURY_DISCOVERY,
    RD72_HIDDEN_DISCOVERIES.length
  ).trim();

  const card = holder.firstElementChild;

  if (!card) return;

  card.dataset.hiddenDiscoveryId =
    RD74_HAWKESBURY_DISCOVERY.id;

  list.appendChild(card);
}

function rd74CheckHawkesburyPoint(point) {
  const hidden = state.hiddenDiscoveries;

  const userId = String(
    state.auth.user?.id || ""
  );

  if (
    !state.isRecording ||
    !userId ||
    hidden.activeUserId !== userId ||
    hidden.completed[
      RD74_HAWKESBURY_DISCOVERY.id
    ] ||
    hidden.pending.has(
      RD74_HAWKESBURY_DISCOVERY.id
    ) ||
    !Number.isFinite(point?.lat) ||
    !Number.isFinite(point?.lng) ||
    !Number.isFinite(point?.accuracy) ||
    point.accuracy > MAX_GPS_ACCURACY_M
  ) {
    return;
  }

  const checkedAt =
    Number(point.timestamp) || Date.now();

  if (
    checkedAt -
      hidden.hawkesburyLastCheckAt <
    RD72_DISCOVERY_CHECK_MIN_MS
  ) {
    return;
  }

  hidden.hawkesburyLastCheckAt =
    checkedAt;

  const entered =
    RD74_HAWKESBURY_DISCOVERY.zones.some(
      (zone) =>
        rd72PointInside(point, zone)
    );

  if (entered) {
    hidden.pending.add(
      RD74_HAWKESBURY_DISCOVERY.id
    );
  }
}

/* -------------------------------------------------- */
/* Expand existing discovery helpers to six           */
/* -------------------------------------------------- */

rd72DiscoveryById = function (
  discoveryId
) {
  const existing =
    roadDiscoveryV74.rd72DiscoveryById(
      discoveryId
    );

  if (existing) return existing;

  return discoveryId ===
    RD74_HAWKESBURY_DISCOVERY.id
      ? RD74_HAWKESBURY_DISCOVERY
      : null;
};

rd72ResetDriveDiscoveryState =
  function () {
    const result =
      roadDiscoveryV74
        .rd72ResetDriveDiscoveryState();

    state.hiddenDiscoveries
      .hawkesburyLastCheckAt = 0;

    return result;
  };

rd72CheckDiscoveryPoint = function (
  point
) {
  const result =
    roadDiscoveryV74
      .rd72CheckDiscoveryPoint(point);

  rd74CheckHawkesburyPoint(point);

  return result;
};

rd72RenderHiddenDiscoveries =
  function () {
    const result =
      roadDiscoveryV74
        .rd72RenderHiddenDiscoveries();

    rd74RenderHawkesburyCard();
    rd74RenderSixDiscoveryProgress();

    return result;
  };

rd73RenderGeneralMenuProgress =
  function () {
    const result =
      roadDiscoveryV74
        .rd73RenderGeneralMenuProgress();

    rd74RenderSixDiscoveryProgress();

    return result;
  };

function rd74InitHawkesburyDiscovery() {
  rd72RenderHiddenDiscoveries();
  rd74RenderSixDiscoveryProgress();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd74InitHawkesburyDiscovery,
    { once: true }
  );
} else {
  rd74InitHawkesburyDiscovery();
}

/* ================================================== */
/* Road Discovery AU v76 Public Leaderboard           */
/* Append this block once to the bottom of app.js v75 */
/* ================================================== */

const RD76_LEADERBOARD_LIMIT = 100;

const rd76Leaderboard = {
  activeUserId: null,
  requestId: 0,
  loading: false,
  saving: false,
  loaded: false,
  isPublic: false,
  roadCount: 0,
  rank: null,
  entries: [],
  error: ""
};

const roadDiscoveryV76 = {
  closePanels,
  renderAuthState
};

function rd76CurrentUserId() {
  return String(state.auth.user?.id || "");
}

function rd76ResetLeaderboardState(userId = "") {
  rd76Leaderboard.activeUserId = String(userId || "");
  rd76Leaderboard.requestId++;
  rd76Leaderboard.loading = false;
  rd76Leaderboard.saving = false;
  rd76Leaderboard.loaded = false;
  rd76Leaderboard.isPublic = false;
  rd76Leaderboard.roadCount = 0;
  rd76Leaderboard.rank = null;
  rd76Leaderboard.entries = [];
  rd76Leaderboard.error = "";
}

function rd76PrepareForCurrentUser() {
  const userId = rd76CurrentUserId();

  if (rd76Leaderboard.activeUserId !== userId) {
    rd76ResetLeaderboardState(userId);
  }

  return userId;
}

function rd76SafeCount(value) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? Math.floor(number)
    : 0;
}

function rd76Number(value) {
  return rd76SafeCount(value).toLocaleString("en-AU");
}

function rd76NormaliseRank(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : null;
}

function rd76CreateGeneralMenuButton() {
  if ($("rd76OpenLeaderboardBtn")) return;

  const settingsButton = $("rd73OpenSettingsBtn");
  const list = settingsButton?.parentElement;

  if (!list) return;

  const button = document.createElement("button");
  button.id = "rd76OpenLeaderboardBtn";
  button.className = "rd-general-menu-item";
  button.type = "button";

  button.innerHTML = `
    <span
      class="rd-general-menu-icon leaderboard"
      aria-hidden="true"
    >
      1
    </span>

    <span class="rd-general-menu-copy">
      <strong>Public Leaderboard</strong>

      <small id="rd76GeneralMenuLeaderboardStatus">
        Public road-count rankings • Beta
      </small>
    </span>

    <span
      class="rd-general-menu-arrow"
      aria-hidden="true"
    >
      ›
    </span>
  `;

  list.insertBefore(button, settingsButton);
}

function rd76CreateLeaderboardPanel() {
  if ($("rd76LeaderboardPanel")) return;

  const panel = document.createElement("aside");
  panel.id = "rd76LeaderboardPanel";
  panel.className =
    "side-panel rd-leaderboard-panel hidden";
  panel.setAttribute("aria-hidden", "true");
  panel.setAttribute("aria-label", "Public Leaderboard");

  panel.innerHTML = `
    <div class="panel-header rd-leaderboard-header">
      <div class="rd-leaderboard-heading">
        <button
          id="rd76LeaderboardBackBtn"
          class="panel-close-btn rd-leaderboard-back-btn"
          type="button"
          aria-label="Back to General Menu"
        >
          ‹
        </button>

        <div>
          <h2>Public Leaderboard</h2>
          <p>Road-count rankings • Beta</p>
        </div>
      </div>

      <button
        id="rd76LeaderboardCloseBtn"
        class="panel-close-btn"
        type="button"
        aria-label="Close Public Leaderboard"
      >
        ×
      </button>
    </div>

    <div class="panel-content rd-leaderboard-content">
      <section class="rd-leaderboard-privacy">
        <strong>Your routes and location stay private</strong>

        <p>
          Joining only publishes your generated Road username and
          discovered-road count. Your email, friend code, road map,
          road IDs and location are never shown here.
        </p>
      </section>

      <section class="rd-leaderboard-join-card">
        <label
          class="toggle-row"
          for="rd76LeaderboardToggle"
        >
          <div class="toggle-text">
            <strong>Show me on the leaderboard</strong>

            <span id="rd76LeaderboardToggleDescription">
              Public participation is off by default.
            </span>
          </div>

          <input
            id="rd76LeaderboardToggle"
            class="toggle-input"
            type="checkbox"
          />

          <span class="toggle-switch" aria-hidden="true">
            <span class="toggle-knob"></span>
          </span>
        </label>
      </section>

      <section class="rd-leaderboard-my-card">
        <div class="rd-leaderboard-my-title">
          <span>Your standing</span>

          <span
            id="rd76LeaderboardVisibilityBadge"
            class="rd-leaderboard-visibility-badge"
          >
            Hidden
          </span>
        </div>

        <div class="rd-leaderboard-my-stats">
          <div>
            <span>Rank</span>
            <strong id="rd76LeaderboardMyRank">—</strong>
          </div>

          <div>
            <span>Synced roads</span>
            <strong id="rd76LeaderboardMyRoads">0</strong>
          </div>
        </div>

        <p id="rd76LeaderboardAccountName">
          Sign in to view the leaderboard.
        </p>
      </section>

      <div class="rd-leaderboard-list-heading">
        <div>
          <strong>Top road explorers</strong>
          <span>Top 100 plus your position</span>
        </div>

        <button
          id="rd76LeaderboardRefreshBtn"
          class="ghost-btn rd-leaderboard-refresh-btn"
          type="button"
        >
          Refresh
        </button>
      </div>

      <div
        id="rd76LeaderboardList"
        class="rd-leaderboard-list"
        aria-live="polite"
      ></div>

      <p class="rd-leaderboard-sync-note">
        Scores use roads saved to your Road Profile. After Finish
        Drive, allow the account backup to finish before refreshing.
      </p>

      <p class="rd-leaderboard-beta-note">
        Beta leaderboard for friendly competition. Rankings may be
        reviewed if progress appears invalid.
      </p>
    </div>
  `;

  ($("appShell") || document.body).appendChild(panel);
  els.rd76LeaderboardPanel = panel;
}

function rd76RenderGeneralMenuStatus() {
  const element = $("rd76GeneralMenuLeaderboardStatus");

  if (!element) return;

  const signedIn = Boolean(rd76CurrentUserId());

  if (!signedIn) {
    element.textContent = "Sign in to view public rankings";
    return;
  }

  if (!rd76Leaderboard.loaded) {
    element.textContent = "Public road-count rankings • Beta";
    return;
  }

  if (!rd76Leaderboard.isPublic) {
    element.textContent = "View rankings • You are hidden";
    return;
  }

  const rank = rd76Leaderboard.rank
    ? `#${rd76Leaderboard.rank}`
    : "Public";

  element.textContent =
    `${rank} • ${rd76Number(rd76Leaderboard.roadCount)} roads`;
}

function rd76EntryHtml(entry) {
  const rank = rd76NormaliseRank(entry?.rank_position);
  const count = rd76SafeCount(entry?.road_count);
  const username = String(
    entry?.road_username || "Road Profile"
  );
  const isMe = Boolean(entry?.is_me);

  const podiumClass =
    rank === 1
      ? " first"
      : rank === 2
        ? " second"
        : rank === 3
          ? " third"
          : "";

  return `
    <article class="rd-leaderboard-row${isMe ? " is-me" : ""}">
      <div class="rd-leaderboard-rank${podiumClass}">
        ${rank ? `#${rank}` : "—"}
      </div>

      <div class="rd-leaderboard-user">
        <strong>${escapeHtml(username)}</strong>
        <span>${isMe ? "Your Road Profile" : "Road explorer"}</span>
      </div>

      <div class="rd-leaderboard-score">
        <strong>${rd76Number(count)}</strong>
        <span>roads</span>
      </div>

      ${
        isMe
          ? `<span class="rd-leaderboard-you-badge">You</span>`
          : ""
      }
    </article>
  `;
}

function rd76RenderLeaderboardList() {
  const list = $("rd76LeaderboardList");

  if (!list) return;

  if (!rd76CurrentUserId()) {
    list.innerHTML = `
      <div class="rd-leaderboard-empty">
        Sign in through your Road Profile to view the public
        leaderboard.
      </div>
    `;
    return;
  }

  if (rd76Leaderboard.loading && !rd76Leaderboard.loaded) {
    list.innerHTML = `
      <div class="rd-leaderboard-empty">
        Loading leaderboard…
      </div>
    `;
    return;
  }

  if (rd76Leaderboard.error) {
    list.innerHTML = `
      <div class="rd-leaderboard-empty error">
        ${escapeHtml(rd76Leaderboard.error)}
      </div>
    `;
    return;
  }

  if (rd76Leaderboard.entries.length === 0) {
    list.innerHTML = `
      <div class="rd-leaderboard-empty">
        No Road Profiles are public yet. You could be the first.
      </div>
    `;
    return;
  }

  let html = "";

  for (const entry of rd76Leaderboard.entries) {
    const rank = rd76NormaliseRank(entry?.rank_position);
    const isMe = Boolean(entry?.is_me);

    if (isMe && rank && rank > RD76_LEADERBOARD_LIMIT) {
      html += `
        <div class="rd-leaderboard-position-gap">
          Your position
        </div>
      `;
    }

    html += rd76EntryHtml(entry);
  }

  list.innerHTML = html;
}

function rd76RenderLeaderboard() {
  rd76PrepareForCurrentUser();

  const signedIn = Boolean(rd76CurrentUserId());
  const busy =
    rd76Leaderboard.loading || rd76Leaderboard.saving;

  const toggle = $("rd76LeaderboardToggle");
  const description = $(
    "rd76LeaderboardToggleDescription"
  );
  const badge = $("rd76LeaderboardVisibilityBadge");
  const rank = $("rd76LeaderboardMyRank");
  const roads = $("rd76LeaderboardMyRoads");
  const account = $("rd76LeaderboardAccountName");
  const refresh = $("rd76LeaderboardRefreshBtn");

  if (toggle) {
    toggle.checked = Boolean(
      signedIn && rd76Leaderboard.isPublic
    );
    toggle.disabled = !signedIn || busy;
  }

  if (description) {
    description.textContent = !signedIn
      ? "Sign in before joining the public leaderboard."
      : rd76Leaderboard.isPublic
        ? "Your Road username and synced road count are public."
        : "Public participation is off. Your score is hidden.";
  }

  if (badge) {
    badge.textContent = rd76Leaderboard.isPublic
      ? "Public"
      : "Hidden";

    badge.classList.toggle(
      "is-public",
      rd76Leaderboard.isPublic
    );
  }

  if (rank) {
    rank.textContent = rd76Leaderboard.rank
      ? `#${rd76Leaderboard.rank}`
      : "—";
  }

  if (roads) {
    roads.textContent = rd76Number(
      rd76Leaderboard.roadCount
    );
  }

  if (account) {
    account.textContent = signedIn
      ? String(
          state.auth.profile?.username ||
          "Loading Road Profile…"
        )
      : "Sign in to view the leaderboard.";
  }

  if (refresh) {
    refresh.disabled = !signedIn || busy;
    refresh.textContent = rd76Leaderboard.loading
      ? "Loading…"
      : "Refresh";
  }

  rd76RenderLeaderboardList();
  rd76RenderGeneralMenuStatus();
}

async function rd76LoadLeaderboard(options = {}) {
  const { quiet = false } = options;
  const userId = rd76PrepareForCurrentUser();

  if (!state.auth.client || !userId) {
    rd76RenderLeaderboard();
    return false;
  }

  if (rd76Leaderboard.loading || rd76Leaderboard.saving) {
    return false;
  }

  const requestId = ++rd76Leaderboard.requestId;

  rd76Leaderboard.loading = true;
  rd76Leaderboard.error = "";
  rd76RenderLeaderboard();

  try {
    const [statusResult, leaderboardResult] =
      await Promise.all([
        state.auth.client.rpc(
          "get_my_leaderboard_status"
        ),
        state.auth.client.rpc(
          "get_public_road_leaderboard",
          { p_limit: RD76_LEADERBOARD_LIMIT }
        )
      ]);

    if (statusResult.error) {
      throw statusResult.error;
    }

    if (leaderboardResult.error) {
      throw leaderboardResult.error;
    }

    if (
      requestId !== rd76Leaderboard.requestId ||
      userId !== rd76CurrentUserId()
    ) {
      return false;
    }

    const status = Array.isArray(statusResult.data)
      ? statusResult.data[0]
      : statusResult.data;

    if (!status || typeof status !== "object") {
      throw new Error("Leaderboard status was empty");
    }

    rd76Leaderboard.isPublic = Boolean(status.is_public);
    rd76Leaderboard.roadCount = rd76SafeCount(
      status.road_count
    );
    rd76Leaderboard.rank = rd76NormaliseRank(
      status.leaderboard_rank
    );

    rd76Leaderboard.entries = Array.isArray(
      leaderboardResult.data
    )
      ? leaderboardResult.data
      : [];

    rd76Leaderboard.loaded = true;
    rd76Leaderboard.error = "";

    if (state.auth.profile) {
      state.auth.profile.show_leaderboard =
        rd76Leaderboard.isPublic;
    }

    return true;
  } catch (error) {
    console.error(error);

    if (
      requestId === rd76Leaderboard.requestId &&
      userId === rd76CurrentUserId()
    ) {
      rd76Leaderboard.error = navigator.onLine
        ? "Could not load the leaderboard. Try again."
        : "Leaderboard unavailable while offline.";

      if (!quiet) {
        showToast("Could not load leaderboard");
      }
    }

    return false;
  } finally {
    if (
      requestId === rd76Leaderboard.requestId &&
      userId === rd76CurrentUserId()
    ) {
      rd76Leaderboard.loading = false;
      rd76RenderLeaderboard();
    }
  }
}

async function rd76ChangeLeaderboardVisibility(visible) {
  const userId = rd76PrepareForCurrentUser();
  const toggle = $("rd76LeaderboardToggle");

  if (!state.auth.client || !userId) {
    if (toggle) toggle.checked = false;
    showToast("Sign in before joining the leaderboard");
    return;
  }

  if (
    rd76Leaderboard.saving ||
    rd76Leaderboard.loading
  ) {
    rd76RenderLeaderboard();
    return;
  }

  const previous = rd76Leaderboard.isPublic;

  if (visible && !previous) {
    const confirmed = window.confirm(
      "Join the public leaderboard?\n\n" +
      "Only your generated Road username and discovered-road " +
      "count will be public. Your email, friend code, map, roads " +
      "and location stay private."
    );

    if (!confirmed) {
      rd76RenderLeaderboard();
      return;
    }
  }

  rd76Leaderboard.saving = true;
  rd76Leaderboard.isPublic = Boolean(visible);
  rd76RenderLeaderboard();

  try {
    const { data, error } = await state.auth.client.rpc(
      "set_my_leaderboard_visibility",
      { p_visible: Boolean(visible) }
    );

    if (error) throw error;

    if (userId !== rd76CurrentUserId()) return;

    rd76Leaderboard.isPublic = Boolean(data);

    if (state.auth.profile) {
      state.auth.profile.show_leaderboard =
        rd76Leaderboard.isPublic;

      writeJson(
        ROAD_PROFILE_CACHE_KEY,
        state.auth.profile
      );
    }

    showToast(
      rd76Leaderboard.isPublic
        ? "You joined the public leaderboard"
        : "You left the public leaderboard"
    );
  } catch (error) {
    console.error(error);

    if (userId === rd76CurrentUserId()) {
      rd76Leaderboard.isPublic = previous;
      showToast("Could not update leaderboard privacy");
    }
  } finally {
    if (userId === rd76CurrentUserId()) {
      rd76Leaderboard.saving = false;
      rd76RenderLeaderboard();
      void rd76LoadLeaderboard({ quiet: true });
    }
  }
}

function rd76CloseLeaderboardOnly() {
  const panel = $("rd76LeaderboardPanel");

  if (!panel) return;

  panel.classList.add("hidden");
  panel.setAttribute("aria-hidden", "true");
}

function rd76OpenLeaderboard() {
  rd76PrepareForCurrentUser();
  openPanel("rd76LeaderboardPanel");
  rd76RenderLeaderboard();

  if (rd76CurrentUserId()) {
    void rd76LoadLeaderboard();
  }
}

function rd76BackToGeneralMenu() {
  rd76CloseLeaderboardOnly();
  rd73OpenGeneralMenu();
}

function rd76BindLeaderboardEvents() {
  $("rd76OpenLeaderboardBtn")?.addEventListener(
    "click",
    rd76OpenLeaderboard
  );

  $("rd76LeaderboardBackBtn")?.addEventListener(
    "click",
    rd76BackToGeneralMenu
  );

  $("rd76LeaderboardCloseBtn")?.addEventListener(
    "click",
    () => closePanels()
  );

  $("rd76LeaderboardRefreshBtn")?.addEventListener(
    "click",
    () => void rd76LoadLeaderboard()
  );

  $("rd76LeaderboardToggle")?.addEventListener(
    "change",
    (event) => {
      void rd76ChangeLeaderboardVisibility(
        Boolean(event.currentTarget.checked)
      );
    }
  );

  window.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !$("rd76LeaderboardPanel")?.classList.contains(
        "hidden"
      )
    ) {
      closePanels();
    }
  });
}

function rd76InitLeaderboard() {
  rd76CreateGeneralMenuButton();
  rd76CreateLeaderboardPanel();
  rd76BindLeaderboardEvents();
  rd76PrepareForCurrentUser();
  rd76RenderLeaderboard();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd76InitLeaderboard,
    { once: true }
  );
} else {
  rd76InitLeaderboard();
}

/* -------------------------------------------------- */
/* Include leaderboard in shared panel/auth lifecycle */
/* -------------------------------------------------- */

closePanels = function (hideBackdrop = true) {
  const result = roadDiscoveryV76.closePanels(
    hideBackdrop
  );

  rd76CloseLeaderboardOnly();

  return result;
};

renderAuthState = function () {
  const result = roadDiscoveryV76.renderAuthState();

  rd76PrepareForCurrentUser();
  rd76RenderLeaderboard();

  return result;
};

/* ================================================== */
/* Road Discovery AU v77 Leaderboard Unlock + Map     */
/* Append this block once to the bottom of app.js v76 */
/* ================================================== */

const RD77_LEADERBOARD_UNLOCK = 50000;
const RD77_PUBLIC_MAP_PAGE_SIZE = 5000;
const RD77_PUBLIC_MAP_MAX_PAGES = 200;

Object.assign(rd76Leaderboard, {
  publicMapVisible: false,
  eligible: false,
  unlockTarget: RD77_LEADERBOARD_UNLOCK,
  roadsUntilUnlock: RD77_LEADERBOARD_UNLOCK
});

const rd77PublicMap = {
  requestId: 0,
  username: "",
  roads: [],
  totalRoads: 0,
  loading: false,
  map: null,
  roadLayer: null,
  renderer: null
};

const roadDiscoveryV77 = {
  rd76ResetLeaderboardState,
  rd76RenderLeaderboard,
  rd76RenderGeneralMenuStatus,
  rd76ChangeLeaderboardVisibility,
  renderAuthState
};

/* -------------------------------------------------- */
/* Leaderboard unlock and second privacy toggle       */
/* -------------------------------------------------- */

rd76ResetLeaderboardState = function (userId = "") {
  const result =
    roadDiscoveryV77.rd76ResetLeaderboardState(userId);

  rd76Leaderboard.publicMapVisible = false;
  rd76Leaderboard.eligible = false;
  rd76Leaderboard.unlockTarget = RD77_LEADERBOARD_UNLOCK;
  rd76Leaderboard.roadsUntilUnlock =
    RD77_LEADERBOARD_UNLOCK;

  return result;
};

function rd77CreateUnlockProgress() {
  if ($("rd77LeaderboardUnlockProgress")) return;

  const joinCard = document.querySelector(
    "#rd76LeaderboardPanel .rd-leaderboard-join-card"
  );

  if (!joinCard) return;

  const progress = document.createElement("div");
  progress.id = "rd77LeaderboardUnlockProgress";
  progress.className = "rd-leaderboard-unlock-progress";

  progress.innerHTML = `
    <div class="rd-leaderboard-unlock-copy">
      <strong id="rd77LeaderboardUnlockTitle">
        Leaderboard unlock
      </strong>

      <span id="rd77LeaderboardUnlockText">
        0 / 50K roads
      </span>
    </div>

    <div
      class="rd-leaderboard-unlock-track"
      aria-hidden="true"
    >
      <span id="rd77LeaderboardUnlockBar"></span>
    </div>
  `;

  joinCard.appendChild(progress);
}

function rd77CreatePublicMapToggle() {
  if ($("rd77PublicMapToggle")) return;

  const joinCard = document.querySelector(
    "#rd76LeaderboardPanel .rd-leaderboard-join-card"
  );

  if (!joinCard) return;

  const section = document.createElement("section");
  section.className =
    "rd-leaderboard-public-map-card";

  section.innerHTML = `
    <label
      class="toggle-row"
      for="rd77PublicMapToggle"
    >
      <div class="toggle-text">
        <strong>Show my road map</strong>

        <span id="rd77PublicMapToggleDescription">
          Join the leaderboard first.
        </span>
      </div>

      <input
        id="rd77PublicMapToggle"
        class="toggle-input"
        type="checkbox"
      />

      <span class="toggle-switch" aria-hidden="true">
        <span class="toggle-knob"></span>
      </span>
    </label>

    <p class="rd-leaderboard-public-map-note">
      Optional. This adds a View Map button to your public ranking.
      It shares historical painted roads only—never live tracking.
    </p>
  `;

  joinCard.insertAdjacentElement("afterend", section);
}

function rd77CompactRoadCount(value) {
  if (typeof rd73CompactNumber === "function") {
    return rd73CompactNumber(rd76SafeCount(value));
  }

  return rd76Number(value);
}

rd76RenderGeneralMenuStatus = function () {
  if (
    rd76CurrentUserId() &&
    rd76Leaderboard.loaded &&
    !rd76Leaderboard.eligible
  ) {
    const element = $(
      "rd76GeneralMenuLeaderboardStatus"
    );

    if (element) {
      element.textContent =
        `${rd77CompactRoadCount(
          rd76Leaderboard.roadCount
        )} / 50K • Leaderboard locked`;
    }

    return;
  }

  roadDiscoveryV77.rd76RenderGeneralMenuStatus();
};

rd76RenderLeaderboard = function () {
  roadDiscoveryV77.rd76RenderLeaderboard();

  const signedIn = Boolean(rd76CurrentUserId());
  const busy =
    rd76Leaderboard.loading || rd76Leaderboard.saving;
  const loaded = rd76Leaderboard.loaded;

  const eligible = Boolean(
    signedIn && loaded && rd76Leaderboard.eligible
  );

  const target = Math.max(
    1,
    rd76SafeCount(rd76Leaderboard.unlockTarget) ||
      RD77_LEADERBOARD_UNLOCK
  );

  const count = rd76SafeCount(
    rd76Leaderboard.roadCount
  );

  const progressPercent = Math.min(
    100,
    Math.max(0, (count / target) * 100)
  );

  const leaderboardToggle = $(
    "rd76LeaderboardToggle"
  );

  const leaderboardDescription = $(
    "rd76LeaderboardToggleDescription"
  );

  const mapToggle = $("rd77PublicMapToggle");

  const mapDescription = $(
    "rd77PublicMapToggleDescription"
  );

  const progress = $(
    "rd77LeaderboardUnlockProgress"
  );

  const progressTitle = $(
    "rd77LeaderboardUnlockTitle"
  );

  const progressText = $(
    "rd77LeaderboardUnlockText"
  );

  const progressBar = $(
    "rd77LeaderboardUnlockBar"
  );

  const mapCard = document.querySelector(
    "#rd76LeaderboardPanel " +
    ".rd-leaderboard-public-map-card"
  );

  if (leaderboardToggle) {
    leaderboardToggle.disabled =
      !signedIn || !loaded || !eligible || busy;

    leaderboardToggle.checked = Boolean(
      eligible && rd76Leaderboard.isPublic
    );
  }

  if (leaderboardDescription) {
    leaderboardDescription.textContent = !signedIn
      ? "Sign in to check your 50K unlock progress."
      : !loaded
        ? "Checking your synced-road count…"
        : !eligible
          ? `${rd76Number(
              rd76Leaderboard.roadsUntilUnlock
            )} more roads required to unlock.`
          : rd76Leaderboard.isPublic
            ? "Your Road username and road count are public."
            : "Unlocked. Turn this on to join publicly.";
  }

  if (mapToggle) {
    mapToggle.checked = Boolean(
      eligible &&
      rd76Leaderboard.isPublic &&
      rd76Leaderboard.publicMapVisible
    );

    mapToggle.disabled =
      !eligible ||
      !rd76Leaderboard.isPublic ||
      busy;
  }

  if (mapDescription) {
    mapDescription.textContent = !eligible
      ? "Unlocks with the public leaderboard at 50K roads."
      : !rd76Leaderboard.isPublic
        ? "Join the public leaderboard before sharing your map."
        : rd76Leaderboard.publicMapVisible
          ? "Signed-in users can open your historical road map."
          : "Your historical road map remains private.";
  }

  progress?.classList.toggle("unlocked", eligible);

  mapCard?.classList.toggle(
    "disabled",
    !eligible || !rd76Leaderboard.isPublic
  );

  if (progressTitle) {
    progressTitle.textContent = eligible
      ? "50K leaderboard unlocked"
      : "Leaderboard unlock";
  }

  if (progressText) {
    progressText.textContent =
      `${rd77CompactRoadCount(count)} / ` +
      `${rd77CompactRoadCount(target)} roads`;
  }

  if (progressBar) {
    progressBar.style.width = `${progressPercent}%`;
  }

  rd76RenderGeneralMenuStatus();
};

/* -------------------------------------------------- */
/* Read the expanded protected status                 */
/* -------------------------------------------------- */

rd76LoadLeaderboard = async function (options = {}) {
  const { quiet = false } = options;
  const userId = rd76PrepareForCurrentUser();

  if (!state.auth.client || !userId) {
    rd76RenderLeaderboard();
    return false;
  }

  if (
    rd76Leaderboard.loading ||
    rd76Leaderboard.saving
  ) {
    return false;
  }

  const requestId = ++rd76Leaderboard.requestId;

  rd76Leaderboard.loading = true;
  rd76Leaderboard.error = "";
  rd76RenderLeaderboard();

  try {
    const [statusResult, leaderboardResult] =
      await Promise.all([
        state.auth.client.rpc(
          "get_my_leaderboard_status"
        ),
        state.auth.client.rpc(
          "get_public_road_leaderboard",
          { p_limit: RD76_LEADERBOARD_LIMIT }
        )
      ]);

    if (statusResult.error) {
      throw statusResult.error;
    }

    if (leaderboardResult.error) {
      throw leaderboardResult.error;
    }

    if (
      requestId !== rd76Leaderboard.requestId ||
      userId !== rd76CurrentUserId()
    ) {
      return false;
    }

    const status = Array.isArray(statusResult.data)
      ? statusResult.data[0]
      : statusResult.data;

    if (!status || typeof status !== "object") {
      throw new Error("Leaderboard status was empty");
    }

    rd76Leaderboard.isPublic = Boolean(
      status.is_public
    );

    rd76Leaderboard.publicMapVisible = Boolean(
      status.public_map_visible
    );

    rd76Leaderboard.roadCount = rd76SafeCount(
      status.road_count
    );

    rd76Leaderboard.eligible = Boolean(
      status.is_eligible
    );

    rd76Leaderboard.unlockTarget =
      rd76SafeCount(status.unlock_target) ||
      RD77_LEADERBOARD_UNLOCK;

    rd76Leaderboard.roadsUntilUnlock =
      rd76SafeCount(status.roads_until_unlock);

    rd76Leaderboard.rank = rd76NormaliseRank(
      status.leaderboard_rank
    );

    rd76Leaderboard.entries = Array.isArray(
      leaderboardResult.data
    )
      ? leaderboardResult.data
      : [];

    rd76Leaderboard.loaded = true;
    rd76Leaderboard.error = "";

    if (state.auth.profile) {
      state.auth.profile.show_leaderboard =
        rd76Leaderboard.isPublic;

      state.auth.profile.show_public_map =
        rd76Leaderboard.publicMapVisible;
    }

    return true;
  } catch (error) {
    console.error(error);

    if (
      requestId === rd76Leaderboard.requestId &&
      userId === rd76CurrentUserId()
    ) {
      rd76Leaderboard.error = navigator.onLine
        ? "Could not load the leaderboard. Try again."
        : "Leaderboard unavailable while offline.";

      if (!quiet) {
        showToast("Could not load leaderboard");
      }
    }

    return false;
  } finally {
    if (
      requestId === rd76Leaderboard.requestId &&
      userId === rd76CurrentUserId()
    ) {
      rd76Leaderboard.loading = false;
      rd76RenderLeaderboard();
    }
  }
};

rd76ChangeLeaderboardVisibility =
  async function (visible) {
    if (visible && !rd76Leaderboard.eligible) {
      rd76RenderLeaderboard();

      showToast(
        "Public leaderboard unlocks at 50K roads"
      );

      return;
    }

    await roadDiscoveryV77
      .rd76ChangeLeaderboardVisibility(visible);

    if (!rd76Leaderboard.isPublic) {
      rd76Leaderboard.publicMapVisible = false;
    }

    rd76RenderLeaderboard();
  };

async function rd77ChangePublicMapVisibility(visible) {
  const userId = rd76PrepareForCurrentUser();
  const toggle = $("rd77PublicMapToggle");

  if (!state.auth.client || !userId) {
    if (toggle) toggle.checked = false;

    showToast(
      "Sign in before sharing a public map"
    );

    return;
  }

  if (
    !rd76Leaderboard.eligible ||
    !rd76Leaderboard.isPublic
  ) {
    rd76RenderLeaderboard();
    showToast("Join the 50K leaderboard first");
    return;
  }

  if (
    rd76Leaderboard.saving ||
    rd76Leaderboard.loading
  ) {
    rd76RenderLeaderboard();
    return;
  }

  const previous =
    rd76Leaderboard.publicMapVisible;

  if (visible && !previous) {
    const confirmed = window.confirm(
      "Show your road map publicly?\n\n" +
      "Signed-in Road Discovery users will be able to open your " +
      "historical painted-road map from the leaderboard.\n\n" +
      "Your live location, drive order, start and finish points, " +
      "speed, heading, waypoints and private icons are not shared."
    );

    if (!confirmed) {
      rd76RenderLeaderboard();
      return;
    }
  }

  rd76Leaderboard.saving = true;
  rd76Leaderboard.publicMapVisible =
    Boolean(visible);

  rd76RenderLeaderboard();

  try {
    const { data, error } =
      await state.auth.client.rpc(
        "set_my_public_map_visibility",
        { p_visible: Boolean(visible) }
      );

    if (error) throw error;

    if (userId !== rd76CurrentUserId()) {
      return;
    }

    rd76Leaderboard.publicMapVisible =
      Boolean(data);

    if (state.auth.profile) {
      state.auth.profile.show_public_map =
        rd76Leaderboard.publicMapVisible;

      writeJson(
        ROAD_PROFILE_CACHE_KEY,
        state.auth.profile
      );
    }

    showToast(
      rd76Leaderboard.publicMapVisible
        ? "Public road map sharing on"
        : "Public road map sharing off"
    );
  } catch (error) {
    console.error(error);

    if (userId === rd76CurrentUserId()) {
      rd76Leaderboard.publicMapVisible =
        previous;

      showToast(
        "Could not update public map privacy"
      );
    }
  } finally {
    if (userId === rd76CurrentUserId()) {
      rd76Leaderboard.saving = false;
      rd76RenderLeaderboard();

      void rd76LoadLeaderboard({
        quiet: true
      });
    }
  }
}

/* -------------------------------------------------- */
/* Public map button in opted-in leaderboard rows     */
/* -------------------------------------------------- */

rd76EntryHtml = function (entry) {
  const rank = rd76NormaliseRank(
    entry?.rank_position
  );

  const count = rd76SafeCount(
    entry?.road_count
  );

  const username = String(
    entry?.road_username || "Road Profile"
  );

  const isMe = Boolean(entry?.is_me);

  const hasPublicMap = Boolean(
    entry?.has_public_map
  );

  const podiumClass =
    rank === 1
      ? " first"
      : rank === 2
        ? " second"
        : rank === 3
          ? " third"
          : "";

  return `
    <article class="rd-leaderboard-row${
      isMe ? " is-me" : ""
    }${hasPublicMap ? " has-public-map" : ""}">
      <div class="rd-leaderboard-rank${podiumClass}">
        ${rank ? `#${rank}` : "—"}
      </div>

      <div class="rd-leaderboard-user">
        <strong>${escapeHtml(username)}</strong>

        <span>
          ${isMe ? "Your Road Profile" : "Road explorer"}
        </span>
      </div>

      <div class="rd-leaderboard-score">
        <strong>${rd76Number(count)}</strong>
        <span>roads</span>
      </div>

      ${
        hasPublicMap
          ? `
            <button
              class="rd77-view-public-map-btn"
              type="button"
              data-road-username="${escapeHtml(username)}"
            >
              View Map
            </button>
          `
          : ""
      }

      ${
        isMe
          ? `
            <span class="rd-leaderboard-you-badge">
              You
            </span>
          `
          : ""
      }
    </article>
  `;
};

/* -------------------------------------------------- */
/* Read-only full public road map                     */
/* -------------------------------------------------- */

function rd77CreatePublicMapOverlay() {
  if ($("rd77PublicMapOverlay")) return;

  const overlay = document.createElement("section");
  overlay.id = "rd77PublicMapOverlay";

  overlay.className =
    "friend-map-overlay " +
    "rd-public-map-overlay hidden";

  overlay.setAttribute(
    "aria-hidden",
    "true"
  );

  overlay.setAttribute(
    "aria-label",
    "Public road map"
  );

  overlay.innerHTML = `
    <header
      class="friend-map-header rd-public-map-header"
    >
      <button
        id="rd77ClosePublicMapBtn"
        class="back-btn"
        type="button"
      >
        ← Leaderboard
      </button>

      <div>
        <h2 id="rd77PublicMapTitle">
          Public Road Map
        </h2>

        <p>
          Historical road-completion progress.
          Not live tracking.
        </p>
      </div>
    </header>

    <div class="friend-full-map-shell">
      <div
        id="rd77PublicMap"
        class="friend-full-map rd-public-map"
        role="img"
        aria-label="Public historical discovered roads"
      ></div>

      <div
        id="rd77PublicMapStatus"
        class="friend-full-map-status"
        role="status"
      >
        Loading public road map…
      </div>
    </div>
  `;

  ($("appShell") || document.body)
    .appendChild(overlay);
}

function rd77SetPublicMapStatus(message) {
  const status = $("rd77PublicMapStatus");

  if (!status) return;

  if (!message) {
    status.textContent = "";
    status.classList.add("hidden");
    return;
  }

  status.textContent = message;
  status.classList.remove("hidden");
}

function rd77DestroyPublicMap() {
  rd77PublicMap.requestId++;
  rd77PublicMap.loading = false;
  rd77PublicMap.username = "";
  rd77PublicMap.roads = [];
  rd77PublicMap.totalRoads = 0;

  if (rd77PublicMap.map) {
    rd77PublicMap.map.remove();
  }

  rd77PublicMap.map = null;
  rd77PublicMap.roadLayer = null;
  rd77PublicMap.renderer = null;
}

function rd77ClosePublicMap(options = {}) {
  const {
    returnToLeaderboard = true
  } = options;

  const overlay = $("rd77PublicMapOverlay");

  rd77DestroyPublicMap();

  overlay?.classList.add("hidden");
  overlay?.setAttribute("aria-hidden", "true");

  if (returnToLeaderboard) {
    rd76OpenLeaderboard();
  }
}

function rd77EnsurePublicMap() {
  const container = $("rd77PublicMap");

  if (
    rd77PublicMap.map ||
    !window.L ||
    !container
  ) {
    return;
  }

  rd77PublicMap.map = L.map(container, {
    zoomControl: true,
    preferCanvas: true,
    attributionControl: false,
    tap: true
  }).setView(DEFAULT_CENTER, 4);

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/" +
    "dark_all/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 20,
      crossOrigin: true,
      attribution:
        "&copy; OpenStreetMap contributors " +
        "&copy; CARTO"
    }
  ).addTo(rd77PublicMap.map);

  rd77PublicMap.renderer = L.canvas({
    padding: 0.5
  });

  rd77PublicMap.map.on(
    "zoomend",
    rd77ApplyPublicMapRoadStyle
  );

  window.setTimeout(() => {
    rd77PublicMap.map?.invalidateSize(true);
  }, 80);
}

function rd77PublicMapRoadStyle() {
  if (
    typeof rd62OrangeRoadStyleForZoom ===
    "function"
  ) {
    return rd62OrangeRoadStyleForZoom(
      rd77PublicMap.map?.getZoom?.()
    );
  }

  return {
    weight: 3,
    opacity: 0.85
  };
}

function rd77ApplyPublicMapRoadStyle() {
  rd77PublicMap.roadLayer?.setStyle?.(
    rd77PublicMapRoadStyle()
  );
}

function rd77DrawPublicMapRoads() {
  const map = rd77PublicMap.map;

  if (!map) return;

  if (rd77PublicMap.roadLayer) {
    map.removeLayer(
      rd77PublicMap.roadLayer
    );

    rd77PublicMap.roadLayer = null;
  }

  const latLngs = rd77PublicMap.roads
    .map((road) => {
      return normaliseSharedRoadCoords(
        road?.coordinates
      );
    })
    .filter(Boolean);

  if (latLngs.length === 0) {
    map.setView(DEFAULT_CENTER, 4);

    rd77SetPublicMapStatus(
      "No public roads available"
    );

    return;
  }

  const style = rd77PublicMapRoadStyle();

  rd77PublicMap.roadLayer =
    L.polyline(latLngs, {
      renderer: rd77PublicMap.renderer,
      color: ROAD_ORANGE,
      weight: style.weight,
      opacity: style.opacity,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }).addTo(map);

  const bounds =
    rd77PublicMap.roadLayer.getBounds();

  if (bounds.isValid()) {
    map.fitBounds(bounds, {
      padding: [28, 28],
      maxZoom: 17
    });
  }

  rd77SetPublicMapStatus("");
}

async function rd77OpenPublicMap(
  usernameValue
) {
  const username = String(
    usernameValue || ""
  ).trim();

  if (
    !state.auth.client ||
    !state.auth.user
  ) {
    showToast(
      "Sign in to open public road maps"
    );

    return;
  }

  if (!username) {
    showToast(
      "Public road map is unavailable"
    );

    return;
  }

  const requestId =
    ++rd77PublicMap.requestId;

  closePanels();

  rd77PublicMap.username = username;
  rd77PublicMap.roads = [];
  rd77PublicMap.totalRoads = 0;
  rd77PublicMap.loading = true;

  const overlay = $(
    "rd77PublicMapOverlay"
  );

  const title = $(
    "rd77PublicMapTitle"
  );

  if (title) {
    title.textContent =
      `${username}’s Map`;
  }

  overlay?.classList.remove("hidden");

  overlay?.setAttribute(
    "aria-hidden",
    "false"
  );

  rd77SetPublicMapStatus(
    "Loading public road map…"
  );

  let offset = 0;

  try {
    for (
      let page = 0;
      page < RD77_PUBLIC_MAP_MAX_PAGES;
      page++
    ) {
      const { data, error } =
        await state.auth.client.rpc(
          "get_public_road_map",
          {
            p_road_username: username,
            p_offset: offset,
            p_page_size:
              RD77_PUBLIC_MAP_PAGE_SIZE
          }
        );

      if (
        requestId !==
          rd77PublicMap.requestId ||
        $("rd77PublicMapOverlay")
          ?.classList.contains("hidden")
      ) {
        return;
      }

      if (error) throw error;

      const payload = Array.isArray(data)
        ? data[0]
        : data;

      if (
        !payload ||
        typeof payload !== "object"
      ) {
        throw new Error(
          "Public road map response was empty"
        );
      }

      const pageRoads = (
        Array.isArray(payload.roads)
          ? payload.roads
          : []
      )
        .map((road) => {
          const coordinates =
            normaliseSharedRoadCoords(
              road?.coordinates
            );

          return coordinates
            ? { coordinates }
            : null;
        })
        .filter(Boolean);

      rd77PublicMap.roads.push(
        ...pageRoads
      );

      rd77PublicMap.totalRoads =
        rd76SafeCount(
          payload.total_roads
        );

      rd77SetPublicMapStatus(
        `Loading ${rd76Number(
          rd77PublicMap.roads.length
        )} / ${rd76Number(
          rd77PublicMap.totalRoads
        )} roads…`
      );

      if (!payload.has_more) {
        break;
      }

      const nextOffset =
        rd76SafeCount(
          payload.next_offset
        );

      if (nextOffset <= offset) {
        throw new Error(
          "Public road map pagination failed"
        );
      }

      offset = nextOffset;

      if (
        page ===
        RD77_PUBLIC_MAP_MAX_PAGES - 1
      ) {
        throw new Error(
          "Public road map is too large " +
          "to load safely"
        );
      }
    }

    if (
      requestId !==
      rd77PublicMap.requestId
    ) {
      return;
    }

    rd77PublicMap.loading = false;

    rd77EnsurePublicMap();
    rd77DrawPublicMapRoads();
  } catch (error) {
    console.error(error);

    if (
      requestId !==
      rd77PublicMap.requestId
    ) {
      return;
    }

    rd77PublicMap.loading = false;
    rd77PublicMap.roads = [];

    rd77SetPublicMapStatus(
      navigator.onLine
        ? "This public road map is unavailable"
        : "Public road maps are unavailable while offline"
    );
  }
}

/* -------------------------------------------------- */
/* Bind the new controls                              */
/* -------------------------------------------------- */

function rd77BindLeaderboardMapEvents() {
  $("rd77PublicMapToggle")?.addEventListener(
    "change",
    (event) => {
      void rd77ChangePublicMapVisibility(
        Boolean(
          event.currentTarget.checked
        )
      );
    }
  );

  $("rd76LeaderboardList")?.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest(
        ".rd77-view-public-map-btn"
      );

      if (!button) return;

      void rd77OpenPublicMap(
        button.dataset.roadUsername
      );
    }
  );

  $("rd77ClosePublicMapBtn")?.addEventListener(
    "click",
    () => rd77ClosePublicMap()
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        !$("rd77PublicMapOverlay")
          ?.classList.contains("hidden")
      ) {
        rd77ClosePublicMap();
      }
    }
  );
}

function rd77InitLeaderboardUnlockAndMap() {
  rd77CreateUnlockProgress();
  rd77CreatePublicMapToggle();
  rd77CreatePublicMapOverlay();
  rd77BindLeaderboardMapEvents();
  rd76RenderLeaderboard();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd77InitLeaderboardUnlockAndMap,
    { once: true }
  );
} else {
  rd77InitLeaderboardUnlockAndMap();
}

/* Remove an open public map immediately after sign-out. */

renderAuthState = function () {
  const result =
    roadDiscoveryV77.renderAuthState();

  if (
    !rd76CurrentUserId() &&
    !$("rd77PublicMapOverlay")
      ?.classList.contains("hidden")
  ) {
    rd77ClosePublicMap({
      returnToLeaderboard: false
    });
  }

  return result;
};

/* ================================================== */
/* Road Discovery AU v78 Road Profile drive gate      */
/* Append this block once to the bottom of app.js v77 */
/* ================================================== */

const RD78_OWNERLESS_LEGACY_BLOCK_KEY =
  "roadDiscoveryAU.ownerlessLegacyBlocked.v1";

const roadDiscoveryV78 = {
  startDrive,
  ensureRoadProfile,
  renderAuthState,
  rd69MoveLegacyProgressToAccount
};

let rd78OwnerlessLegacyPending = false;

function rd78ReadStorageValue(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function rd78WriteStorageValue(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

function rd78RemoveStorageValue(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

/* -------------------------------------------------- */
/* Stop ownerless old device data joining an account  */
/* -------------------------------------------------- */

const rd78LegacyWasAlreadyBlocked =
  rd78ReadStorageValue(
    RD78_OWNERLESS_LEGACY_BLOCK_KEY
  ) === "1";

if (
  rd69LegacyProgress.available &&
  (
    rd78LegacyWasAlreadyBlocked ||
    !rd69LegacyProgress.ownerId
  )
) {
  /*
    Keep this collection ownerless even if the active-account view
    updates the older backup-owner key later in the same session.
  */
  rd69LegacyProgress.ownerId = "";
  rd78OwnerlessLegacyPending = true;

  rd78WriteStorageValue(
    RD78_OWNERLESS_LEGACY_BLOCK_KEY,
    "1"
  );
} else if (!rd69LegacyProgress.available) {
  rd78RemoveStorageValue(
    RD78_OWNERLESS_LEGACY_BLOCK_KEY
  );
}

rd69MoveLegacyProgressToAccount = function (userId) {
  if (
    rd69LegacyProgress.available &&
    (
      rd78OwnerlessLegacyPending ||
      rd78ReadStorageValue(
        RD78_OWNERLESS_LEGACY_BLOCK_KEY
      ) === "1"
    )
  ) {
    rd69LegacyProgress.ownerId = "";
    rd78OwnerlessLegacyPending = true;

    rd78WriteStorageValue(
      RD78_OWNERLESS_LEGACY_BLOCK_KEY,
      "1"
    );

    return false;
  }

  return roadDiscoveryV78.rd69MoveLegacyProgressToAccount(
    userId
  );
};

/* -------------------------------------------------- */
/* Road Profile required prompt                       */
/* -------------------------------------------------- */

function rd78CreateProfileRequiredOverlay() {
  if ($("rd78ProfileRequiredOverlay")) return;

  const overlay = document.createElement("section");

  overlay.id = "rd78ProfileRequiredOverlay";
  overlay.className =
    "confirm-overlay rd78-profile-required-overlay hidden";
  overlay.setAttribute("aria-hidden", "true");

  overlay.innerHTML = `
    <div
      class="confirm-card rd78-profile-required-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rd78ProfileRequiredTitle"
      aria-describedby="rd78ProfileRequiredDescription"
    >
      <div
        class="rd78-profile-mark"
        aria-hidden="true"
      >
        RD
      </div>

      <div class="rd78-profile-kicker">
        Road Discovery AU
      </div>

      <h2 id="rd78ProfileRequiredTitle">
        Road Profile required
      </h2>

      <p
        id="rd78ProfileRequiredDescription"
        class="rd78-profile-required-message"
      >
        Sign in to save progress and compete.
      </p>

      <p class="rd78-profile-required-detail">
        Your discovered roads belong to your Road Profile and can be
        restored on another device.
      </p>

      <div class="rd78-profile-required-actions">
        <button
          id="rd78OpenRoadProfileBtn"
          class="wide-btn"
          type="button"
        >
          Open Road Profile
        </button>

        <button
          id="rd78ProfileRequiredNotNowBtn"
          class="ghost-btn wide-btn"
          type="button"
        >
          Not Now
        </button>
      </div>
    </div>
  `;

  ($("appShell") || document.body).appendChild(overlay);
}

function rd78OpenProfileRequired() {
  rd78CreateProfileRequiredOverlay();

  const overlay = $("rd78ProfileRequiredOverlay");

  if (!overlay) return;

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");

  window.setTimeout(() => {
    $("rd78OpenRoadProfileBtn")?.focus();
  }, 0);
}

function rd78CloseProfileRequired() {
  const overlay = $("rd78ProfileRequiredOverlay");

  if (!overlay) return;

  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
}

/* -------------------------------------------------- */
/* One-time explanation for truly ownerless old roads */
/* -------------------------------------------------- */

function rd78CreateOwnerlessLegacyOverlay() {
  if ($("rd78OwnerlessLegacyOverlay")) return;

  const overlay = document.createElement("section");

  overlay.id = "rd78OwnerlessLegacyOverlay";
  overlay.className =
    "confirm-overlay rd78-ownerless-overlay hidden";
  overlay.setAttribute("aria-hidden", "true");

  overlay.innerHTML = `
    <div
      class="confirm-card rd78-ownerless-card"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="rd78OwnerlessTitle"
      aria-describedby="rd78OwnerlessDescription"
    >
      <div
        class="rd78-ownerless-mark"
        aria-hidden="true"
      >
        !
      </div>

      <div class="rd78-profile-kicker">
        Road Profile protection
      </div>

      <h2 id="rd78OwnerlessTitle">
        Unsigned road progress found
      </h2>

      <p
        id="rd78OwnerlessDescription"
        class="rd78-profile-required-message"
      >
        Roads created without a recorded Road Profile cannot be
        transferred into this account or used for competition.
      </p>

      <p class="rd78-profile-required-detail">
        Your signed-in Road Profile will start fresh. Progress already
        owned by a Road Profile is not affected.
      </p>

      <button
        id="rd78OwnerlessStartFreshBtn"
        class="wide-btn"
        type="button"
      >
        Start Fresh
      </button>
    </div>
  `;

  ($("appShell") || document.body).appendChild(overlay);
}

function rd78OpenOwnerlessLegacyNotice() {
  if (
    !rd78OwnerlessLegacyPending ||
    !state.auth.user ||
    !state.auth.profile
  ) {
    return;
  }

  rd78CreateOwnerlessLegacyOverlay();

  const overlay = $("rd78OwnerlessLegacyOverlay");

  if (!overlay) return;

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");

  window.setTimeout(() => {
    $("rd78OwnerlessStartFreshBtn")?.focus();
  }, 0);
}

function rd78ClearOwnerlessLegacyProgress() {
  [
    STORAGE_KEY,
    SAVED_SEGMENTS_KEY,
    TODAY_UNLOCKS_KEY,
    RD69_LEGACY_OWNER_KEY
  ].forEach((key) => {
    rd78RemoveStorageValue(key);
  });

  const ownerlessRoadsRemain = Boolean(
    rd69HasObjectEntries(
      rd69ReadRaw(STORAGE_KEY)
    ) ||
    rd69HasObjectEntries(
      rd69ReadRaw(SAVED_SEGMENTS_KEY)
    )
  );

  if (ownerlessRoadsRemain) {
    showToast(
      "Could not clear unsigned road progress"
    );
    return;
  }

  rd69LegacyProgress.visitedRaw = null;
  rd69LegacyProgress.savedRaw = null;
  rd69LegacyProgress.todayRaw = null;
  rd69LegacyProgress.ownerId = "";
  rd69LegacyProgress.available = false;

  rd78OwnerlessLegacyPending = false;

  rd78RemoveStorageValue(
    RD78_OWNERLESS_LEGACY_BLOCK_KEY
  );

  const overlay = $("rd78OwnerlessLegacyOverlay");

  overlay?.classList.add("hidden");
  overlay?.setAttribute("aria-hidden", "true");

  showToast("Road Profile ready");
}

/* -------------------------------------------------- */
/* Bind and initialise                                */
/* -------------------------------------------------- */

function rd78BindProfileGateEvents() {
  $("rd78OpenRoadProfileBtn")?.addEventListener(
    "click",
    () => {
      rd78CloseProfileRequired();
      openFriendsPanel();
    }
  );

  $("rd78ProfileRequiredNotNowBtn")?.addEventListener(
    "click",
    rd78CloseProfileRequired
  );

  $("rd78ProfileRequiredOverlay")?.addEventListener(
    "click",
    (event) => {
      if (event.target === event.currentTarget) {
        rd78CloseProfileRequired();
      }
    }
  );

  $("rd78OwnerlessStartFreshBtn")?.addEventListener(
    "click",
    rd78ClearOwnerlessLegacyProgress
  );

  window.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !$("rd78ProfileRequiredOverlay")?.classList.contains(
        "hidden"
      )
    ) {
      rd78CloseProfileRequired();
    }
  });
}

function rd78InitProfileGate() {
  rd78CreateProfileRequiredOverlay();
  rd78CreateOwnerlessLegacyOverlay();
  rd78BindProfileGateEvents();
  rd78OpenOwnerlessLegacyNotice();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd78InitProfileGate,
    { once: true }
  );
} else {
  rd78InitProfileGate();
}

/* -------------------------------------------------- */
/* Final wrappers                                     */
/* -------------------------------------------------- */

startDrive = async function () {
  if (state.auth.checkingSession) {
    showToast("Checking Road Profile…");
    return;
  }

  if (!state.auth.user || !state.auth.profile) {
    rd78OpenProfileRequired();
    return;
  }

  return roadDiscoveryV78.startDrive();
};

ensureRoadProfile = async function (options = {}) {
  const profile =
    await roadDiscoveryV78.ensureRoadProfile(options);

  if (profile && rd78OwnerlessLegacyPending) {
    window.setTimeout(
      rd78OpenOwnerlessLegacyNotice,
      0
    );
  }

  return profile;
};

renderAuthState = function () {
  const result =
    roadDiscoveryV78.renderAuthState();

  if (state.auth.user && state.auth.profile) {
    rd78CloseProfileRequired();

    if (rd78OwnerlessLegacyPending) {
      window.setTimeout(
        rd78OpenOwnerlessLegacyNotice,
        0
      );
    }
  }

  return result;
};

/* ================================================== */
/* Road Discovery AU v79 discovery country browser    */
/* Append this block once to the bottom of app.js v78 */
/* ================================================== */

const RD79_COUNTRIES = Object.freeze([
  {
    code: "AU",
    name: "Australia"
  },
  {
    code: "NZ",
    name: "New Zealand",
    comingSoon: true
  }
]);

const RD79_AU_REGIONS = Object.freeze([
  { code: "NSW", name: "New South Wales" },
  {
    code: "ACT",
    name: "Australian Capital Territory"
  },
  { code: "QLD", name: "Queensland" },
  { code: "VIC", name: "Victoria" },
  { code: "TAS", name: "Tasmania" },
  { code: "SA", name: "South Australia" },
  { code: "WA", name: "Western Australia" },
  { code: "NT", name: "Northern Territory" }
]);

const roadDiscoveryV79 = {
  rd72OpenHiddenDiscoveryRoom,
  rd72RenderHiddenDiscoveries
};

state.rd79HiddenDiscoveryBrowser = {
  view: "countries",
  countryCode: "",
  regionCode: ""
};

function rd79AllDiscoveries() {
  if (
    typeof rd74AllHiddenDiscoveries === "function"
  ) {
    return rd74AllHiddenDiscoveries();
  }

  return Array.from(RD72_HIDDEN_DISCOVERIES);
}

function rd79DiscoveryCountryCode(discovery) {
  const explicitCode =
    discovery?.countryCode || discovery?.country;

  return String(
    explicitCode || "AU"
  ).toUpperCase();
}

function rd79DiscoveryRegionCode(discovery) {
  const explicitCode =
    discovery?.regionCode || discovery?.stateCode;

  if (explicitCode) {
    return String(explicitCode).toUpperCase();
  }

  const regionText = String(
    discovery?.region || ""
  ).toUpperCase();

  const match = regionText.match(
    /\b(NSW|ACT|QLD|VIC|TAS|SA|WA|NT)\b/
  );

  return match ? match[1] : "";
}

function rd79DiscoveriesFor(
  countryCode,
  regionCode = ""
) {
  const country = String(
    countryCode || ""
  ).toUpperCase();

  const region = String(
    regionCode || ""
  ).toUpperCase();

  return rd79AllDiscoveries().filter(
    (discovery) => {
      if (
        rd79DiscoveryCountryCode(discovery) !==
        country
      ) {
        return false;
      }

      return (
        !region ||
        rd79DiscoveryRegionCode(discovery) === region
      );
    }
  );
}

function rd79CompletedCount(discoveries) {
  return discoveries.filter((discovery) =>
    Boolean(
      state.hiddenDiscoveries.completed[
        discovery.id
      ]
    )
  ).length;
}

function rd79ProgressText(discoveries) {
  return (
    `${rd79CompletedCount(discoveries)} of ` +
    `${discoveries.length} discovered`
  );
}

function rd79MenuCard(options) {
  const {
    kind,
    code,
    name,
    discoveries,
    comingSoon = false
  } = options;

  const hasDiscoveries =
    discoveries.length > 0;

  const disabled =
    comingSoon || !hasDiscoveries;

  const status = disabled
    ? "Coming soon"
    : `${rd79CompletedCount(discoveries)} / ` +
      `${discoveries.length} discovered`;

  const dataAttribute =
    kind === "country"
      ? `data-rd79-country="${escapeHtml(code)}"`
      : `data-rd79-region="${escapeHtml(code)}"`;

  return `
    <button
      class="rd79-menu-card ${
        disabled ? "coming-soon" : "available"
      }"
      type="button"
      ${dataAttribute}
      ${
        disabled
          ? 'disabled aria-disabled="true"'
          : ""
      }
    >
      <span
        class="rd79-menu-code"
        aria-hidden="true"
      >
        ${escapeHtml(code)}
      </span>

      <span class="rd79-menu-copy">
        <strong>
          ${escapeHtml(name)}
        </strong>

        <small>
          ${escapeHtml(status)}
        </small>
      </span>

      <span
        class="rd79-menu-arrow"
        aria-hidden="true"
      >
        ${disabled ? "" : "›"}
      </span>
    </button>
  `;
}

function rd79RoomElements() {
  const overlay = $(
    "rd72HiddenDiscoveryOverlay"
  );

  return {
    overlay,

    card: overlay?.querySelector(
      ".rd-hidden-room-card"
    ),

    title: $(
      "rd72HiddenDiscoveryTitle"
    ),

    heading: overlay?.querySelector(
      ".rd-hidden-state-heading"
    ),

    progress: $(
      "rd72HiddenDiscoveryProgress"
    ),

    list: $(
      "rd72HiddenDiscoveryList"
    ),

    doneButton: $(
      "rd72HiddenDiscoveryDoneBtn"
    )
  };
}

function rd79SetRoomLayout(options) {
  const {
    title,
    heading,
    progress,
    doneText,
    menuView
  } = options;

  const elements = rd79RoomElements();

  if (elements.title) {
    elements.title.textContent = title;
  }

  if (elements.heading) {
    elements.heading.textContent = heading;
  }

  if (elements.progress) {
    elements.progress.textContent = progress;
  }

  if (elements.doneButton) {
    elements.doneButton.textContent = doneText;
  }

  elements.card?.classList.toggle(
    "rd79-hidden-menu-view",
    Boolean(menuView)
  );

  elements.list?.classList.toggle(
    "rd79-menu-list",
    Boolean(menuView)
  );

  return elements;
}

function rd79RenderCountryMenu() {
  const allDiscoveries =
    rd79AllDiscoveries();

  const elements = rd79SetRoomLayout({
    title: "Hidden Discoveries",
    heading: "Choose a country",
    progress: rd79ProgressText(
      allDiscoveries
    ),
    doneText: "Back to Map",
    menuView: true
  });

  if (!elements.list) return;

  elements.list.innerHTML =
    RD79_COUNTRIES.map((country) =>
      rd79MenuCard({
        kind: "country",
        code: country.code,
        name: country.name,

        discoveries:
          rd79DiscoveriesFor(
            country.code
          ),

        comingSoon:
          country.comingSoon
      })
    ).join("");
}

function rd79RenderAustraliaMenu() {
  const australiaDiscoveries =
    rd79DiscoveriesFor("AU");

  const elements = rd79SetRoomLayout({
    title: "Australia",
    heading: "States and territories",

    progress: rd79ProgressText(
      australiaDiscoveries
    ),

    doneText: "Back to Countries",
    menuView: true
  });

  if (!elements.list) return;

  elements.list.innerHTML =
    RD79_AU_REGIONS.map((region) =>
      rd79MenuCard({
        kind: "region",
        code: region.code,
        name: region.name,

        discoveries:
          rd79DiscoveriesFor(
            "AU",
            region.code
          )
      })
    ).join("");
}

function rd79RegionName(regionCode) {
  return (
    RD79_AU_REGIONS.find(
      (region) =>
        region.code === regionCode
    )?.name || regionCode
  );
}

function rd79RenderRegionDiscoveries() {
  const browser =
    state.rd79HiddenDiscoveryBrowser;

  const discoveries =
    rd79DiscoveriesFor(
      browser.countryCode,
      browser.regionCode
    );

  const regionName =
    rd79RegionName(
      browser.regionCode
    );

  const elements = rd79SetRoomLayout({
    title: regionName,

    heading:
      `${browser.regionCode} ` +
      `Hidden Discoveries`,

    progress:
      rd79ProgressText(discoveries),

    doneText: "Back to Australia",
    menuView: false
  });

  if (!elements.list) return;

  if (discoveries.length === 0) {
    elements.list.innerHTML = `
      <div class="rd79-empty-state">
        <strong>
          Coming soon
        </strong>

        <span>
          Hidden Discoveries have not been
          added here yet.
        </span>
      </div>
    `;

    return;
  }

  elements.list.innerHTML =
    discoveries
      .map(rd72DiscoveryCard)
      .join("");
}

function rd79RenderCurrentView() {
  const browser =
    state.rd79HiddenDiscoveryBrowser;

  if (browser.view === "regions") {
    rd79RenderAustraliaMenu();
    return;
  }

  if (browser.view === "discoveries") {
    rd79RenderRegionDiscoveries();
    return;
  }

  rd79RenderCountryMenu();
}

function rd79OpenCountry(countryCode) {
  if (countryCode !== "AU") return;

  const browser =
    state.rd79HiddenDiscoveryBrowser;

  browser.view = "regions";
  browser.countryCode = "AU";
  browser.regionCode = "";

  rd79RenderCurrentView();
}

function rd79OpenRegion(regionCode) {
  const discoveries =
    rd79DiscoveriesFor(
      "AU",
      regionCode
    );

  if (discoveries.length === 0) {
    return;
  }

  const browser =
    state.rd79HiddenDiscoveryBrowser;

  browser.view = "discoveries";
  browser.countryCode = "AU";
  browser.regionCode = regionCode;

  rd79RenderCurrentView();
}

function rd79HandleMenuClick(event) {
  const countryButton =
    event.target.closest(
      "[data-rd79-country]"
    );

  if (
    countryButton &&
    !countryButton.disabled
  ) {
    rd79OpenCountry(
      countryButton.dataset.rd79Country
    );

    return;
  }

  const regionButton =
    event.target.closest(
      "[data-rd79-region]"
    );

  if (
    regionButton &&
    !regionButton.disabled
  ) {
    rd79OpenRegion(
      regionButton.dataset.rd79Region
    );
  }
}

function rd79HandleRoomBack(event) {
  event.preventDefault();
  event.stopImmediatePropagation();

  const browser =
    state.rd79HiddenDiscoveryBrowser;

  if (browser.view === "discoveries") {
    browser.view = "regions";
    browser.regionCode = "";

    rd79RenderCurrentView();
    return;
  }

  if (browser.view === "regions") {
    browser.view = "countries";
    browser.countryCode = "";

    rd79RenderCurrentView();
    return;
  }

  rd72CloseHiddenDiscoveryRoom();
}

function rd79ResetBrowserView() {
  const browser =
    state.rd79HiddenDiscoveryBrowser;

  browser.view = "countries";
  browser.countryCode = "";
  browser.regionCode = "";
}

function rd79InitDiscoveryBrowser() {
  const list = $(
    "rd72HiddenDiscoveryList"
  );

  const doneButton = $(
    "rd72HiddenDiscoveryDoneBtn"
  );

  if (
    !list ||
    !doneButton ||
    list.dataset.rd79BrowserBound === "1"
  ) {
    return;
  }

  list.dataset.rd79BrowserBound = "1";

  list.addEventListener(
    "click",
    rd79HandleMenuClick
  );

  /*
    Capture this button before its original
    Back to Map listener. It now travels back
    through Region -> Country -> Map.
  */
  doneButton.addEventListener(
    "click",
    rd79HandleRoomBack,
    true
  );

  rd79RenderCurrentView();
}

/* Start at the country screen whenever opened. */
rd72OpenHiddenDiscoveryRoom = function () {
  rd79ResetBrowserView();

  const result =
    roadDiscoveryV79
      .rd72OpenHiddenDiscoveryRoom();

  rd79RenderCurrentView();
  return result;
};

/*
  Preserve the selected country/state screen when
  progress synchronises or changes.
*/
rd72RenderHiddenDiscoveries = function () {
  const result =
    roadDiscoveryV79
      .rd72RenderHiddenDiscoveries();

  rd79RenderCurrentView();
  return result;
};

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd79InitDiscoveryBrowser,
    { once: true }
  );
} else {
  rd79InitDiscoveryBrowser();
}

/* ================================================== */
/* Road Discovery AU v80 Hidden Discoveries 7–14      */
/* Append this block once to the bottom of app.js v79 */
/* ================================================== */

const RD80_NEW_HIDDEN_DISCOVERIES = Object.freeze([
  {
    id: "galston_gorge_lookout",
    countryCode: "AU",
    regionCode: "NSW",
    region: "Northern Sydney, NSW",
    answer: "Galston Gorge Lookout",
    completionMessage:
      "Galston Gorge Lookout riddle complete.",
    riddle:
      "Where sandstone walls hold a winding road, " +
      "the valley bends beneath the trees. " +
      "Find the lookout watching over the gorge.",
    zones: [
      {
        lat: -33.6616298,
        lng: 151.0873912,
        radiusM: 300
      }
    ]
  },
  {
    id: "north_head_scenic_drive_view_point",
    countryCode: "AU",
    regionCode: "NSW",
    region: "Sydney Harbour, NSW",
    answer: "North Head Scenic Drive View Point",
    completionMessage:
      "North Head riddle complete.",
    riddle:
      "Seek the sanctuary that guards the north head, " +
      "where sheltered waters surrender to the open sea. " +
      "Follow the headland road to its final view.",
    zones: [
      {
        lat: -33.8232065,
        lng: 151.2984181,
        radiusM: 350
      }
    ],
    note:
      "North Head has controlled opening hours. Obey gates, closures, signs and all National Park directions."
  },
  {
    id: "sublime_point_lookout",
    countryCode: "AU",
    regionCode: "NSW",
    region: "Illawarra, NSW",
    answer: "Sublime Point Lookout",
    completionMessage:
      "Sublime Point riddle complete.",
    riddle:
      "High above seventeen beaches, " +
      "where the escarpment watches over the sea, " +
      "find the point with a view beyond words.",
    zones: [
      {
        lat: -34.2961251,
        lng: 150.9247813,
        radiusM: 300
      }
    ]
  },
  {
    id: "bald_hill_lookout",
    countryCode: "AU",
    regionCode: "NSW",
    region: "Illawarra, NSW",
    answer: "Bald Hill Lookout",
    completionMessage:
      "Bald Hill riddle complete.",
    riddle:
      "Find the hill with no hair, " +
      "where people borrow wings above the coast. " +
      "Look south for a bridge clinging to the sea.",
    zones: [
      {
        lat: -34.2231263,
        lng: 150.9981465,
        radiusM: 300
      }
    ]
  },
  {
    id: "picton_mushroom_tunnel",
    countryCode: "AU",
    regionCode: "NSW",
    region: "Wollondilly region, NSW",
    answer: "Picton Mushroom Tunnel",
    completionMessage:
      "Picton Mushroom Tunnel riddle complete.",
    riddle:
      "Where iron horses thundered unseen, " +
      "the rails claimed a life in nineteen-sixteen. " +
      "Pale life later grew, a ghost in white, " +
      "a haunting view.",
    zones: [
      {
        lat: -34.1720399,
        lng: 150.6054248,
        radiusM: 350
      }
    ],
    note:
      "The tunnel may be closed or unsafe. This discovery can be completed from the nearby public road. Never enter a closed tunnel or restricted area."
  },
  {
    id: "solomon_jane_wiseman_grave",
    countryCode: "AU",
    regionCode: "NSW",
    region: "Hawkesbury River region, NSW",
    answer: "Solomon and Jane Wiseman’s Grave",
    completionMessage:
      "Solomon and Jane Wiseman riddle complete.",
    riddle:
      "Condemned by the Crown, then pardoned and free, " +
      "he gave his name to the crossing you see. " +
      "Beside him, his wife is said to haunt an old stair, " +
      "though the walls rose years later, some swear she is there. " +
      "Three times laid down before finding their rest, " +
      "seek the wise man and wife at the end of your quest.",
    zones: [
      {
        lat: -33.4034051,
        lng: 151.0077256,
        radiusM: 350
      }
    ],
    note:
      "This discovery can be completed from the nearby public road. Please treat the cemetery and those resting there with respect."
  },
  {
    id: "miss_porters_house",
    countryCode: "AU",
    regionCode: "NSW",
    region: "Newcastle region, NSW",
    answer: "Miss Porter’s House",
    completionMessage:
      "Miss Porter’s House riddle complete.",
    riddle:
      "A father raised the home, a mother kept it warm, " +
      "two sisters kept its memories through sorrow and storm. " +
      "The coal city shook, yet every room held fast—" +
      "seek a Miss’s house where their century still lasts.",
    zones: [
      {
        lat: -32.9277541,
        lng: 151.7648008,
        radiusM: 250
      }
    ]
  },
  {
    id: "sir_edmund_barton_monument",
    countryCode: "AU",
    regionCode: "NSW",
    region: "Mid North Coast, NSW",
    answer: "Sir Edmund Barton Monument",
    completionMessage:
      "Sir Edmund Barton Monument riddle complete.",
    riddle:
      "Six colonies stood apart, then gathered into one, " +
      "he first steered the Commonwealth when Federation had begun. " +
      "The Hastings knew him earlier, before the nation’s call—" +
      "find the bronze beside the river who stood first in nineteen-oh-one.",
    zones: [
      {
        lat: -31.4280237,
        lng: 152.9081574,
        radiusM: 300
      }
    ]
  }
]);

const roadDiscoveryV80 = {
  rd79AllDiscoveries,
  rd72DiscoveryById,
  rd72ResetDriveDiscoveryState,
  rd72CheckDiscoveryPoint,
  rd72RenderHiddenDiscoveries,
  rd73RenderGeneralMenuProgress
};

state.hiddenDiscoveries.rd80LastCheckAt = 0;

/* -------------------------------------------------- */
/* Combined discovery list                            */
/* -------------------------------------------------- */

function rd80AllHiddenDiscoveries() {
  return [
    ...roadDiscoveryV80.rd79AllDiscoveries(),
    ...RD80_NEW_HIDDEN_DISCOVERIES
  ];
}

rd79AllDiscoveries = function () {
  return rd80AllHiddenDiscoveries();
};

/* -------------------------------------------------- */
/* Allow local and server progress to recognise IDs   */
/* -------------------------------------------------- */

rd72DiscoveryById = function (discoveryId) {
  const existing =
    roadDiscoveryV80.rd72DiscoveryById(
      discoveryId
    );

  if (existing) {
    return existing;
  }

  return (
    RD80_NEW_HIDDEN_DISCOVERIES.find(
      (discovery) =>
        discovery.id === discoveryId
    ) || null
  );
};

/* -------------------------------------------------- */
/* Check the eight new discovery zones                */
/* -------------------------------------------------- */

function rd80CheckNewDiscoveryPoint(point) {
  const hidden = state.hiddenDiscoveries;

  const userId = String(
    state.auth.user?.id || ""
  );

  if (
    !state.isRecording ||
    !userId ||
    hidden.activeUserId !== userId ||
    !Number.isFinite(point?.lat) ||
    !Number.isFinite(point?.lng) ||
    !Number.isFinite(point?.accuracy) ||
    point.accuracy > MAX_GPS_ACCURACY_M
  ) {
    return;
  }

  const checkedAt =
    Number(point.timestamp) || Date.now();

  if (
    checkedAt - hidden.rd80LastCheckAt <
    RD72_DISCOVERY_CHECK_MIN_MS
  ) {
    return;
  }

  hidden.rd80LastCheckAt = checkedAt;

  for (
    const discovery of
    RD80_NEW_HIDDEN_DISCOVERIES
  ) {
    if (
      hidden.completed[discovery.id] ||
      hidden.pending.has(discovery.id)
    ) {
      continue;
    }

    const entered =
      Array.isArray(discovery.zones) &&
      discovery.zones.some((zone) =>
        rd72PointInside(point, zone)
      );

    if (entered) {
      hidden.pending.add(discovery.id);
    }
  }
}

rd72ResetDriveDiscoveryState = function () {
  const result =
    roadDiscoveryV80
      .rd72ResetDriveDiscoveryState();

  state.hiddenDiscoveries.rd80LastCheckAt = 0;

  return result;
};

rd72CheckDiscoveryPoint = function (point) {
  const result =
    roadDiscoveryV80
      .rd72CheckDiscoveryPoint(point);

  rd80CheckNewDiscoveryPoint(point);

  return result;
};

/* -------------------------------------------------- */
/* Update progress totals from 6 to 14                */
/* -------------------------------------------------- */

function rd80RenderFourteenDiscoveryProgress() {
  const discoveries =
    rd80AllHiddenDiscoveries();

  const completed =
    discoveries.filter(
      (discovery) =>
        Boolean(
          state.hiddenDiscoveries.completed[
            discovery.id
          ]
        )
    ).length;

  const total = discoveries.length;

  const progressText =
    `${completed} of ${total} discovered`;

  const settingsProgress = $(
    "rd72HiddenSettingsProgress"
  );

  const generalProgress = $(
    "rd73HiddenDiscoveryProgress"
  );

  if (settingsProgress) {
    settingsProgress.textContent =
      state.auth.user
        ? progressText
        : `${progressText} • Sign in to save progress`;
  }

  if (generalProgress) {
    generalProgress.textContent =
      `${completed} / ${total} discovered`;
  }
}

rd72RenderHiddenDiscoveries = function () {
  const result =
    roadDiscoveryV80
      .rd72RenderHiddenDiscoveries();

  rd80RenderFourteenDiscoveryProgress();

  return result;
};

rd73RenderGeneralMenuProgress = function () {
  const result =
    roadDiscoveryV80
      .rd73RenderGeneralMenuProgress();

  rd80RenderFourteenDiscoveryProgress();

  return result;
};

/* -------------------------------------------------- */
/* Initialise                                         */
/* -------------------------------------------------- */

function rd80InitNewHiddenDiscoveries() {
  rd72RenderHiddenDiscoveries();
  rd80RenderFourteenDiscoveryProgress();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd80InitNewHiddenDiscoveries,
    { once: true }
  );
} else {
  rd80InitNewHiddenDiscoveries();
}

/* ================================================== */
/* Road Discovery AU v81 manual discovery checking    */
/* Append this block once to the bottom of app.js v80 */
/* ================================================== */

const RD81_CHECK_RADIUS_M = Object.freeze({
  echo_point_three_sisters: 140,
  lithgow_blast_furnace: 140,
  mount_piper_power_station: 450,
  bathurst_big_gold_panner: 120,
  mount_panorama_wahluu_circuit: 120,
  hawkesbury_lookout: 120,
  galston_gorge_lookout: 150,
  north_head_scenic_drive_view_point: 150,
  sublime_point_lookout: 150,
  bald_hill_lookout: 150,
  picton_mushroom_tunnel: 150,
  solomon_jane_wiseman_grave: 120,
  miss_porters_house: 100,
  sir_edmund_barton_monument: 100
});

const roadDiscoveryV81 = {
  rd72CheckDiscoveryPoint,
  rd72RenderHiddenDiscoveries,
  rd79RenderCurrentView
};

state.rd81CheckingHiddenLocation = false;

/* -------------------------------------------------- */
/* Disable automatic Drive Mode discovery checks      */
/* -------------------------------------------------- */

rd72CheckDiscoveryPoint = function () {
  /*
    Hidden Discoveries are now checked only when the
    user deliberately presses I Think I Found It.
    Normal GPS handling and road painting are unchanged.
  */
};

/* -------------------------------------------------- */
/* Manual verification zones                         */
/* -------------------------------------------------- */

function rd81VerificationZones(discovery) {
  const configuredRadius = Number(
    RD81_CHECK_RADIUS_M[discovery?.id]
  );

  const radiusM =
    Number.isFinite(configuredRadius) &&
    configuredRadius > 0
      ? configuredRadius
      : 150;

  if (Array.isArray(discovery?.zones)) {
    return discovery.zones
      .filter(
        (zone) =>
          Number.isFinite(zone?.lat) &&
          Number.isFinite(zone?.lng)
      )
      .map((zone) => ({
        lat: zone.lat,
        lng: zone.lng,
        radiusM
      }));
  }

  if (Array.isArray(discovery?.checkpoints)) {
    return discovery.checkpoints
      .filter(
        (checkpoint) =>
          Number.isFinite(checkpoint?.lat) &&
          Number.isFinite(checkpoint?.lng)
      )
      .map((checkpoint) => ({
        lat: checkpoint.lat,
        lng: checkpoint.lng,
        radiusM
      }));
  }

  return [];
}

/* -------------------------------------------------- */
/* Fresh GPS reading                                  */
/* -------------------------------------------------- */

function rd81FreshGpsPoint() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({ code: 0 });
      return;
    }

    let watchId = null;
    let timeoutId = null;
    let bestPoint = null;
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;

      settled = true;

      if (watchId !== null) {
        navigator.geolocation.clearWatch(
          watchId
        );
      }

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      callback(value);
    };

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const point = {
          lat: Number(
            position.coords.latitude
          ),
          lng: Number(
            position.coords.longitude
          ),
          accuracy: Number(
            position.coords.accuracy
          ),
          speed:
            position.coords.speed === null
              ? null
              : Number(position.coords.speed),
          timestamp:
            Number(position.timestamp) ||
            Date.now()
        };

        if (
          !Number.isFinite(point.lat) ||
          !Number.isFinite(point.lng) ||
          !Number.isFinite(point.accuracy)
        ) {
          return;
        }

        if (
          !bestPoint ||
          point.accuracy < bestPoint.accuracy
        ) {
          bestPoint = point;
        }

        if (
          point.accuracy <=
          MAX_GPS_ACCURACY_M
        ) {
          finish(resolve, point);
        }
      },
      (error) => {
        if (error?.code === 1) {
          finish(reject, error);
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000
      }
    );

    timeoutId = window.setTimeout(() => {
      if (bestPoint) {
        finish(resolve, bestPoint);
      } else {
        finish(reject, { code: 3 });
      }
    }, 15000);
  });
}

/* -------------------------------------------------- */
/* Check against locked discoveries in this region    */
/* -------------------------------------------------- */

function rd81CurrentRegionDiscoveries() {
  const browser =
    state.rd79HiddenDiscoveryBrowser;

  return rd79DiscoveriesFor(
    browser.countryCode,
    browser.regionCode
  );
}

function rd81FindDiscoveryAtPoint(
  point,
  discoveries
) {
  let nearestMatch = null;
  let nearestDistance = Infinity;

  for (const discovery of discoveries) {
    if (
      state.hiddenDiscoveries.completed[
        discovery.id
      ]
    ) {
      continue;
    }

    for (
      const zone of
      rd81VerificationZones(discovery)
    ) {
      const distance = haversine(
        point,
        zone
      );

      if (
        distance <= zone.radiusM &&
        distance < nearestDistance
      ) {
        nearestMatch = discovery;
        nearestDistance = distance;
      }
    }
  }

  return nearestMatch;
}

function rd81GpsFailureMessage(error) {
  if (error?.code === 1) {
    return (
      "Location permission is required to " +
      "check a Hidden Discovery"
    );
  }

  if (error?.code === 3) {
    return (
      "Could not get a fresh GPS reading. " +
      "Move into an open area and try again"
    );
  }

  return "Current location is unavailable";
}

async function rd81CheckMyLocation() {
  if (state.rd81CheckingHiddenLocation) {
    return;
  }

  if (!state.auth.user || !state.auth.profile) {
    showToast(
      "Sign in to complete Hidden Discoveries"
    );
    return;
  }

  if (hasActiveHideSeekRound()) {
    showToast(
      "Finish Hide & Seek before checking"
    );
    return;
  }

  const discoveries =
    rd81CurrentRegionDiscoveries();

  const lockedDiscoveries =
    discoveries.filter(
      (discovery) =>
        !state.hiddenDiscoveries.completed[
          discovery.id
        ]
    );

  if (lockedDiscoveries.length === 0) {
    showToast(
      "Every discovery here is complete"
    );
    return;
  }

  state.rd81CheckingHiddenLocation = true;
  rd81UpdateCheckButton();

  try {
    const point = await rd81FreshGpsPoint();

    if (
      point.accuracy >
      MAX_GPS_ACCURACY_M
    ) {
      showToast(
        `GPS accuracy ${Math.round(
          point.accuracy
        )} m — move into an open area and try again`
      );

      return;
    }

    if (
      Number.isFinite(point.speed) &&
      point.speed > 2.5
    ) {
      showToast(
        "Stop somewhere safe before checking"
      );

      return;
    }

    const discovery =
      rd81FindDiscoveryAtPoint(
        point,
        lockedDiscoveries
      );

    if (!discovery) {
      showToast(
        "Not quite. Keep exploring."
      );

      return;
    }

    const recordingWasActive = Boolean(
      state.isRecording
    );

    rd72CompleteDriveDiscoveries([
      discovery.id
    ]);

    /*
      The existing completion function normally waits
      for Finish Drive when a drive is active. Manual
      discovery checking reveals it immediately.
    */
    if (recordingWasActive) {
      window.setTimeout(() => {
        rd72OpenCompletion([
          discovery.id
        ]);
      }, 320);
    }
  } catch (error) {
    showToast(
      rd81GpsFailureMessage(error)
    );
  } finally {
    state.rd81CheckingHiddenLocation = false;
    rd81UpdateCheckButton();
  }
}

/* -------------------------------------------------- */
/* Create the large check-location button             */
/* -------------------------------------------------- */

function rd81CreateCheckButton() {
  if ($("rd81CheckHiddenLocationBtn")) {
    return;
  }

  const doneButton = $(
    "rd72HiddenDiscoveryDoneBtn"
  );

  if (!doneButton) return;

  const button =
    document.createElement("button");

  button.id =
    "rd81CheckHiddenLocationBtn";

  button.className =
    "wide-btn rd81-check-location-btn hidden";

  button.type = "button";

  button.addEventListener(
    "click",
    rd81CheckMyLocation
  );

  doneButton.insertAdjacentElement(
    "beforebegin",
    button
  );
}

/* -------------------------------------------------- */
/* Replace the old Start Drive instructions           */
/* -------------------------------------------------- */

function rd81UpdateSafetyMessage() {
  const safetyNote = document.querySelector(
    "#rd72HiddenDiscoveryOverlay " +
      ".rd-hidden-safety-note"
  );

  if (!safetyNote) return;

  safetyNote.innerHTML = `
    <strong>
      Stop somewhere safe before checking.
    </strong>

    Solve the riddle and explore safely. When you think
    you have found a Hidden Discovery, press
    <strong>I Think I Found It</strong>. You never need
    to enter private or restricted property. Do not use
    your phone while moving.
  `;
}

/* -------------------------------------------------- */
/* Show the button only on a state's riddle screen    */
/* -------------------------------------------------- */

function rd81UpdateCheckButton() {
  const button = $(
    "rd81CheckHiddenLocationBtn"
  );

  if (!button) return;

  const browser =
    state.rd79HiddenDiscoveryBrowser;

  const showButton =
    browser.view === "discoveries";

  button.classList.toggle(
    "hidden",
    !showButton
  );

  if (!showButton) return;

  const discoveries =
    rd81CurrentRegionDiscoveries();

  const allCompleted =
    discoveries.length > 0 &&
    discoveries.every(
      (discovery) =>
        Boolean(
          state.hiddenDiscoveries.completed[
            discovery.id
          ]
        )
    );

  button.disabled =
    state.rd81CheckingHiddenLocation ||
    allCompleted;

  if (state.rd81CheckingHiddenLocation) {
    button.textContent = "Checking GPS…";
    return;
  }

  button.textContent = allCompleted
    ? "All Discoveries Found"
    : "I Think I Found It";
}

/* Keep the button aligned with the selected screen. */

rd79RenderCurrentView = function () {
  const result =
    roadDiscoveryV81
      .rd79RenderCurrentView();

  rd81UpdateCheckButton();

  return result;
};

rd72RenderHiddenDiscoveries = function () {
  const result =
    roadDiscoveryV81
      .rd72RenderHiddenDiscoveries();

  rd81UpdateCheckButton();

  return result;
};

/* -------------------------------------------------- */
/* Initialise                                         */
/* -------------------------------------------------- */

function rd81InitManualDiscoveryCheck() {
  /*
    Remove any locations automatically detected earlier
    in this browser session. Nothing already completed
    or synced is removed.
  */
  state.hiddenDiscoveries.pending.clear();

  rd81CreateCheckButton();
  rd81UpdateSafetyMessage();
  rd81UpdateCheckButton();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd81InitManualDiscoveryCheck,
    { once: true }
  );
} else {
  rd81InitManualDiscoveryCheck();
}

/* ================================================== */
/* Road Discovery AU v82 Hidden Discovery back arrow  */
/* Append this block once to the bottom of app.js v81 */
/* ================================================== */

const roadDiscoveryV82 = {
  rd72RenderHiddenDiscoveries,
  rd79RenderCurrentView
};

function rd82CreateHiddenBackButton() {
  if ($("rd82HiddenBackBtn")) {
    return;
  }

  const header = document.querySelector(
    "#rd72HiddenDiscoveryOverlay " +
      ".rd-hidden-header"
  );

  if (!header) return;

  const button =
    document.createElement("button");

  button.id = "rd82HiddenBackBtn";

  button.className =
    "rd82-hidden-back-btn hidden";

  button.type = "button";

  button.setAttribute(
    "aria-label",
    "Go back"
  );

  button.textContent = "←";

  button.addEventListener(
    "click",
    rd82GoBackOneDiscoveryPage
  );

  header.insertBefore(
    button,
    header.firstElementChild
  );
}

function rd82GoBackOneDiscoveryPage() {
  const browser =
    state.rd79HiddenDiscoveryBrowser;

  if (browser.view === "discoveries") {
    browser.view = "regions";
    browser.regionCode = "";

    rd79RenderCurrentView();
    return;
  }

  if (browser.view === "regions") {
    browser.view = "countries";
    browser.countryCode = "";
    browser.regionCode = "";

    rd79RenderCurrentView();
  }
}

function rd82UpdateHiddenBackNavigation() {
  const browser =
    state.rd79HiddenDiscoveryBrowser;

  const backButton = $(
    "rd82HiddenBackBtn"
  );

  const bottomBackButton = $(
    "rd72HiddenDiscoveryDoneBtn"
  );

  const nestedPage =
    browser.view === "regions" ||
    browser.view === "discoveries";

  if (backButton) {
    backButton.classList.toggle(
      "hidden",
      !nestedPage
    );

    backButton.setAttribute(
      "aria-label",
      browser.view === "discoveries"
        ? "Back to Australia"
        : "Back to countries"
    );
  }

  /*
    The root country screen keeps Back to Map.
    Nested screens use the new top-left arrow.
  */
  if (bottomBackButton) {
    bottomBackButton.classList.toggle(
      "rd82-bottom-back-hidden",
      nestedPage
    );
  }
}

rd79RenderCurrentView = function () {
  const result =
    roadDiscoveryV82
      .rd79RenderCurrentView();

  rd82UpdateHiddenBackNavigation();

  return result;
};

rd72RenderHiddenDiscoveries = function () {
  const result =
    roadDiscoveryV82
      .rd72RenderHiddenDiscoveries();

  rd82UpdateHiddenBackNavigation();

  return result;
};

function rd82InitHiddenBackButton() {
  rd82CreateHiddenBackButton();
  rd82UpdateHiddenBackNavigation();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd82InitHiddenBackButton,
    { once: true }
  );
} else {
  rd82InitHiddenBackButton();
}

/* ================================================== */
/* Road Discovery AU v83 Daylight map                 */
/* Append this block once to the bottom of app.js v82 */
/* ================================================== */

const RD83_DAYLIGHT_MAP_KEY =
  "roadDiscoveryAU.daylightMap.v1";

const RD83_DARK_TILE_URL =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

const RD83_LIGHT_TILE_URL =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

const roadDiscoveryV83 = {
  initMap
};

state.daylightMap = rd83LoadDaylightMap();
state.rd83BaseTileLayer = null;

function rd83LoadDaylightMap() {
  try {
    return (
      localStorage.getItem(
        RD83_DAYLIGHT_MAP_KEY
      ) === "true"
    );
  } catch (error) {
    console.error(error);
    return false;
  }
}

function rd83SaveDaylightMap() {
  try {
    localStorage.setItem(
      RD83_DAYLIGHT_MAP_KEY,
      String(Boolean(state.daylightMap))
    );
  } catch (error) {
    console.error(error);
    showToast(
      "Could not save map appearance"
    );
  }
}

function rd83IsRoadDiscoveryBaseTile(layer) {
  const url = String(layer?._url || "");

  return (
    url.includes(
      "basemaps.cartocdn.com/dark_all"
    ) ||
    url.includes(
      "basemaps.cartocdn.com/light_all"
    )
  );
}

function rd83ApplyDaylightMap() {
  const enabled = Boolean(
    state.daylightMap
  );

  document.body.classList.toggle(
    "rd83-daylight-map",
    enabled
  );

  const toggle = $(
    "rd83DaylightMapToggle"
  );

  if (toggle) {
    toggle.checked = enabled;
  }

  if (!state.map || !window.L) {
    return;
  }

  const currentUrl = enabled
    ? RD83_LIGHT_TILE_URL
    : RD83_DARK_TILE_URL;

  const layersToRemove = [];
  let matchingLayer = null;

  state.map.eachLayer((layer) => {
    if (
      layer instanceof L.TileLayer &&
      rd83IsRoadDiscoveryBaseTile(layer)
    ) {
      if (
        !matchingLayer &&
        String(layer._url || "") ===
          currentUrl
      ) {
        matchingLayer = layer;
      } else {
        layersToRemove.push(layer);
      }
    }
  });

  for (const layer of layersToRemove) {
    state.map.removeLayer(layer);
  }

  state.rd83BaseTileLayer =
    matchingLayer ||
    L.tileLayer(
      currentUrl,
      {
        maxZoom: 20,
        crossOrigin: true,
        attribution:
          "&copy; OpenStreetMap contributors &copy; CARTO"
      }
    ).addTo(state.map);

  state.rd83BaseTileLayer
    .bringToBack?.();

  state.map
    .getContainer?.()
    ?.classList.toggle(
      "rd83-daylight-map-active",
      enabled
    );

  window.setTimeout(() => {
    state.map?.invalidateSize?.(false);
  }, 0);
}

function rd83InsertDaylightMapSetting() {
  if ($("rd83DaylightMapToggle")) {
    return;
  }

  const mapSection = $(
    "locationMarkerToggle"
  )?.closest(".panel-section");

  if (!mapSection) return;

  const setting =
    document.createElement("label");

  setting.id =
    "rd83DaylightMapSetting";

  setting.className =
    "toggle-row rd83-daylight-map-setting";

  setting.setAttribute(
    "for",
    "rd83DaylightMapToggle"
  );

  setting.innerHTML = `
    <div class="toggle-text">
      <strong>Daylight map</strong>

      <span>
        Uses a brighter map with dark roads and labels
        for easier viewing outdoors. Your interface,
        GPS and discovered-road progress stay unchanged.
      </span>
    </div>

    <input
      id="rd83DaylightMapToggle"
      class="toggle-input"
      type="checkbox"
    />

    <span
      class="toggle-switch"
      aria-hidden="true"
    >
      <span class="toggle-knob"></span>
    </span>
  `;

  const trailColourSetting = $(
    "trailColourSetting"
  );

  if (
    trailColourSetting &&
    trailColourSetting.parentElement ===
      mapSection
  ) {
    mapSection.insertBefore(
      setting,
      trailColourSetting
    );
  } else {
    mapSection.appendChild(setting);
  }

  $("rd83DaylightMapToggle")
    ?.addEventListener(
      "change",
      (event) => {
        state.daylightMap = Boolean(
          event.currentTarget.checked
        );

        rd83SaveDaylightMap();
        rd83ApplyDaylightMap();

        showToast(
          state.daylightMap
            ? "Daylight map on"
            : "Dark map on"
        );
      }
    );
}

/* Apply the saved preference during map setup. */

initMap = function () {
  const result =
    roadDiscoveryV83.initMap();

  rd83ApplyDaylightMap();

  return result;
};

function rd83InitDaylightMap() {
  rd83InsertDaylightMapSetting();
  rd83ApplyDaylightMap();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd83InitDaylightMap,
    { once: true }
  );
} else {
  rd83InitDaylightMap();
}

/* ================================================== */
/* Road Discovery AU v84 motorcycle-first About copy  */
/* Append this block once to the bottom of app.js v83 */
/* ================================================== */

function rd84ApplyRiderAboutCopy() {
  const overlay = $(
    "roadDiscoveryAboutOverlay"
  );

  if (!overlay) return;

  const title = $(
    "roadDiscoveryAboutTitle"
  );

  const intro = overlay.querySelector(
    ".road-discovery-about-intro"
  );

  const message = overlay.querySelector(
    ".road-discovery-about-message"
  );

  const ride = overlay.querySelector(
    ".road-discovery-about-ride"
  );

  const safety = overlay.querySelector(
    ".road-discovery-about-safety"
  );

  if (title) {
    title.textContent = "Built for the ride";
  }

  if (intro) {
    intro.textContent =
      "Road Discovery was created with motorbike riders in mind—the people who take the long way home simply to see where a road leads.";
  }

  if (ride) {
    ride.textContent =
      "Car drivers and anyone who loves exploring can enjoy it too, but the heart of the experience is the freedom of riding, choosing your own road and watching the map fill with colour behind you.";

    /*
      Place the rider explanation before the main
      Road Discovery message.
    */
    if (
      message &&
      ride.nextElementSibling !== message
    ) {
      message.parentElement?.insertBefore(
        ride,
        message
      );
    }
  }

  if (message) {
    message.textContent =
      "This is not a navigation app. Maps tell you where to go. Road Discovery shows you where you’ve been.";
  }

  if (safety) {
    safety.innerHTML = `
      <strong>Play safely.</strong>

      Set everything up before moving, follow all road
      rules and never interact with your phone while
      riding or driving.
    `;
  }
}

function rd84InitRiderAboutCopy() {
  rd84ApplyRiderAboutCopy();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd84InitRiderAboutCopy,
    { once: true }
  );
} else {
  rd84InitRiderAboutCopy();
}

/* ================================================== */
/* Road Discovery AU v85 Wolf Pack Mode               */
/* Append this block once to the bottom of app.js v84 */
/* ================================================== */

const RD85_CLASSIC_MODE = "classic";
const RD85_WOLF_PACK_MODE = "wolf_pack";

const roadDiscoveryV85 = {
  startHideSeekRound,
  resetHideSeekState,
  renderHideSeekState,
  applyHideSeekRows,
  drawHideSeekMarkers,
  hideSeekGameStatusText,
  showHideSeekRoleReveal,
  readyStatusText: rd58ReadyStatusText,
  renderReadyUI: rd58RenderReadyUI,
  pollReadyState: rd58PollReadyState
};

Object.assign(state.hideSeek, {
  selectedGameMode: RD85_CLASSIC_MODE,
  gameMode: ""
});

function rd85CacheWolfPackElements() {
  [
    "hideSeekModePicker",
    "hideSeekClassicModeBtn",
    "hideSeekWolfPackModeBtn",
    "hideSeekModeDescription",
    "hideSeekPlayerRange",
    "hideSeekGameModeBadge"
  ].forEach((id) => {
    els[id] = $(id);
  });
}

function rd85ModeDetails(modeValue) {
  const wolfPack =
    modeValue === RD85_WOLF_PACK_MODE;

  return {
    mode: wolfPack
      ? RD85_WOLF_PACK_MODE
      : RD85_CLASSIC_MODE,

    name: wolfPack
      ? "Wolf Pack"
      : "Hide & Seek",

    tagline: wolfPack
      ? "Two wolves. One hunt."
      : "One random wolf. Everyone else becomes sheep.",

    range: wolfPack
      ? "3–8 players"
      : "2–8 players",

    minimumPlayers: wolfPack ? 3 : 2,

    rpcName: wolfPack
      ? "start_wolf_pack_round"
      : "start_hide_seek_round"
  };
}

function rd85IsWolfPack() {
  return (
    state.hideSeek.gameMode ===
    RD85_WOLF_PACK_MODE
  );
}

function rd85SetSelectedGameMode(modeValue) {
  if (
    state.hideSeek.starting ||
    hasActiveHideSeekRound()
  ) {
    return;
  }

  state.hideSeek.selectedGameMode =
    modeValue === RD85_WOLF_PACK_MODE
      ? RD85_WOLF_PACK_MODE
      : RD85_CLASSIC_MODE;

  state.hideSeek.gameMode = "";

  renderHideSeekState();
}

function rd85BindWolfPackControls() {
  rd85CacheWolfPackElements();

  if (
    els.hideSeekModePicker?.dataset
      .rd85Bound === "true"
  ) {
    return;
  }

  if (els.hideSeekModePicker) {
    els.hideSeekModePicker.dataset.rd85Bound =
      "true";
  }

  els.hideSeekClassicModeBtn?.addEventListener(
    "click",
    () => {
      rd85SetSelectedGameMode(
        RD85_CLASSIC_MODE
      );
    }
  );

  els.hideSeekWolfPackModeBtn?.addEventListener(
    "click",
    () => {
      rd85SetSelectedGameMode(
        RD85_WOLF_PACK_MODE
      );
    }
  );
}

/* -------------------------------------------------- */
/* State lifecycle                                    */
/* -------------------------------------------------- */

resetHideSeekState = function (options = {}) {
  const clearRound =
    options.clearRound !== false;

  const result =
    roadDiscoveryV85.resetHideSeekState(
      options
    );

  if (clearRound) {
    state.hideSeek.gameMode = "";
  }

  return result;
};

applyHideSeekRows = function (rows) {
  const incomingRows = Array.isArray(rows)
    ? rows
    : [];

  const incomingRoundId = String(
    incomingRows[0]?.round_id || ""
  );

  const roundChanged = Boolean(
    incomingRoundId &&
    incomingRoundId !==
      state.hideSeek.roundId
  );

  const visibleWolfCount =
    incomingRows.filter(
      (player) => player?.role === "wolf"
    ).length;

  if (visibleWolfCount >= 2) {
    state.hideSeek.gameMode =
      RD85_WOLF_PACK_MODE;
  } else if (visibleWolfCount === 1) {
    state.hideSeek.gameMode =
      RD85_CLASSIC_MODE;
  } else if (
    roundChanged &&
    !state.hideSeek.starting
  ) {
    /*
      During the secure ten-second role selection,
      other riders receive no roles. Keep the label
      neutral until the server reveals them.
    */
    state.hideSeek.gameMode = "";
  }

  roadDiscoveryV85.applyHideSeekRows(
    incomingRows
  );
};

/* -------------------------------------------------- */
/* Starting either game mode                          */
/* -------------------------------------------------- */

startHideSeekRound = async function () {
  const details = rd85ModeDetails(
    state.hideSeek.selectedGameMode
  );

  if (
    !hasActiveMultiplayerRoom() ||
    !state.auth.client ||
    !state.auth.user ||
    state.hideSeek.starting ||
    hasActiveHideSeekRound()
  ) {
    return;
  }

  if (
    state.multiplayer.members.length <
    details.minimumPlayers
  ) {
    showToast(
      `${details.name} needs at least ` +
      `${details.minimumPlayers} riders`
    );

    return;
  }

  const safetyAccepted = window.confirm(
    "Play safely. Follow road rules. Do not speed. " +
    "Do not stop somewhere dangerous. Leave the zone " +
    `if needed.\n\nStart ${details.name}?`
  );

  if (!safetyAccepted) return;

  state.hideSeek.starting = true;
  state.hideSeek.gameMode = details.mode;

  state.hideSeek.preparationText =
    "Getting a clean GPS location...";

  state.hideSeek.unavailableMessage = "";

  renderMultiplayerState();

  try {
    const startPoint =
      await getFreshRouteStartPoint();

    if (
      !startPoint ||
      !Number.isFinite(
        Number(startPoint.lat)
      ) ||
      !Number.isFinite(
        Number(startPoint.lng)
      ) ||
      Number(startPoint.accuracy) >
        MAX_GPS_ACCURACY_M
    ) {
      throw new Error(
        "Need GPS accuracy of 35 metres or better before starting."
      );
    }

    state.hideSeek.preparationText =
      "Loading nearby road chunks...";

    renderHideSeekState();

    const roadsReady =
      await ensureRoadsNearPoint(
        startPoint,
        {
          replaceIfFar: true,
          quiet: false
        }
      );

    if (
      !roadsReady ||
      state.roadSegments.length === 0
    ) {
      throw new Error(
        "Could not load nearby roads for a hiding zone."
      );
    }

    state.hideSeek.preparationText =
      "Checking road-based hiding zones...";

    renderHideSeekState();

    const localCandidates =
      buildHideSeekZoneCandidates(
        startPoint
      );

    if (
      localCandidates.length <
      HIDE_SEEK_ZONE_MIN_CANDIDATES
    ) {
      throw new Error(
        "Not enough suitable roads nearby. Move to another area and try again."
      );
    }

    const routeableCandidates =
      await filterRouteableHideSeekCandidates(
        startPoint,
        localCandidates
      );

    if (
      routeableCandidates.length <
      HIDE_SEEK_ZONE_MIN_CANDIDATES
    ) {
      throw new Error(
        "Not enough reachable hiding zones were found. Move to another area and try again."
      );
    }

    state.hideSeek.preparationText =
      details.mode ===
      RD85_WOLF_PACK_MODE
        ? "Randomly choosing two wolves and the zone..."
        : "Randomly choosing the wolf and zone...";

    renderHideSeekState();

    const { data, error } =
      await state.auth.client.rpc(
        details.rpcName,
        {
          p_room_id:
            state.multiplayer.roomId,

          p_start_lat:
            Number(startPoint.lat),

          p_start_lng:
            Number(startPoint.lng),

          p_zone_candidates:
            routeableCandidates.map(
              (candidate) => ({
                lat: candidate.lat,
                lng: candidate.lng,
                road_count:
                  candidate.road_count,
                routeable: true
              })
            ),

          p_safety_ack: true
        }
      );

    if (error) {
      throw error;
    }

    const roundId = Array.isArray(data)
      ? data[0]
      : data;

    if (!roundId) {
      throw new Error(
        `Could not read the new ${details.name} round.`
      );
    }

    state.hideSeek.roundId =
      String(roundId);

    state.hideSeek.preparationText = "";

    await pollHideSeekState({
      force: true
    });

    if (state.currentPoint) {
      void maybeSendHideSeekLocation(
        state.currentPoint,
        {
          force: true
        }
      );
    }

    showToast(
      `${details.name} started`
    );
  } catch (error) {
    console.error(error);

    const message =
      hideSeekErrorMessage(error);

    showToast(message);

    state.hideSeek.preparationText =
      message;

    state.hideSeek.gameMode = "";
  } finally {
    state.hideSeek.starting = false;
    renderMultiplayerState();
  }
};

/* -------------------------------------------------- */
/* Mode-aware interface                               */
/* -------------------------------------------------- */

hideSeekGameStatusText = function () {
  if (!rd85IsWolfPack()) {
    if (
      state.hideSeek.phase === "starting"
    ) {
      return "Randomly choosing the roles...";
    }

    return roadDiscoveryV85
      .hideSeekGameStatusText();
  }

  const me = getMyHideSeekPlayer();

  if (state.hideSeek.phase === "starting") {
    return "Randomly choosing two wolves and the sheep...";
  }

  if (state.hideSeek.phase === "finished") {
    return state.hideSeek.winner === "wolf"
      ? "The wolf pack found every sheep. Wolves win."
      : "At least one sheep stayed hidden. Sheep win.";
  }

  if (state.hideSeek.phase === "cancelled") {
    return "The Wolf Pack round ended because the Multiplayer room closed.";
  }

  if (me?.player_status === "found") {
    return "You were found. Your last game dot is now visible to everyone.";
  }

  if (me?.player_status === "out") {
    return "You are out. Your last game dot is now visible to everyone.";
  }

  if (state.hideSeek.phase === "escape") {
    return state.hideSeek.viewerRole === "wolf"
      ? "Sheep are hiding... Your wolf teammate is visible, but the sheep and hiding zone remain private."
      : "Reach the blue hiding zone before the escape timer reaches zero.";
  }

  if (state.hideSeek.phase === "hunt") {
    return state.hideSeek.viewerRole === "wolf"
      ? "Hunt with your wolf teammate. Hidden sheep remain private between three-second pings."
      : "Stay inside the hiding zone and avoid both wolves until time runs out.";
  }

  return "Waiting for the Wolf Pack round.";
};

showHideSeekRoleReveal = function (role) {
  roadDiscoveryV85.showHideSeekRoleReveal(
    role
  );

  if (
    rd85IsWolfPack() &&
    role === "wolf" &&
    els.hideSeekRoleRevealText
  ) {
    els.hideSeekRoleRevealText.textContent =
      "You are a wolf • Hunt with your pack";
  }
};

rd58ReadyStatusText = function () {
  const status =
    roadDiscoveryV85.readyStatusText();

  return rd85IsWolfPack()
    ? status.replace(
        "Wolf starts",
        "Wolves start"
      )
    : status;
};

rd58PollReadyState = async function (
  options = {}
) {
  if (!rd85IsWolfPack()) {
    return roadDiscoveryV85
      .pollReadyState(options);
  }

  const normalShowToast = showToast;

  showToast = function (message) {
    normalShowToast(
      String(message).replace(
        "Wolf starts",
        "Wolves start"
      )
    );
  };

  try {
    return await roadDiscoveryV85
      .pollReadyState(options);
  } finally {
    showToast = normalShowToast;
  }
};

rd58RenderReadyUI = function () {
  roadDiscoveryV85.renderReadyUI();

  if (
    rd85IsWolfPack() &&
    state.hideSeek.fastCountdownActive
  ) {
    if (els.hideSeekMapPhase) {
      els.hideSeekMapPhase.textContent =
        "Wolves start soon";
    }

    if (els.hideSeekGameStatus) {
      els.hideSeekGameStatus.textContent =
        "All sheep are ready. The wolves begin hunting when the countdown reaches zero.";
    }
  }
};

renderHideSeekState = function () {
  roadDiscoveryV85.renderHideSeekState();
  rd85CacheWolfPackElements();

  const setupDetails = rd85ModeDetails(
    state.hideSeek.selectedGameMode
  );

  const memberCount =
    state.multiplayer.members.length;

  const setupDisabled = Boolean(
    state.hideSeek.starting ||
    hasActiveHideSeekRound() ||
    state.multiplayer.leaving
  );

  els.hideSeekClassicModeBtn
    ?.classList.toggle(
      "active",
      setupDetails.mode ===
        RD85_CLASSIC_MODE
    );

  els.hideSeekWolfPackModeBtn
    ?.classList.toggle(
      "active",
      setupDetails.mode ===
        RD85_WOLF_PACK_MODE
    );

  els.hideSeekClassicModeBtn?.setAttribute(
    "aria-pressed",
    String(
      setupDetails.mode ===
        RD85_CLASSIC_MODE
    )
  );

  els.hideSeekWolfPackModeBtn?.setAttribute(
    "aria-pressed",
    String(
      setupDetails.mode ===
        RD85_WOLF_PACK_MODE
    )
  );

  if (els.hideSeekClassicModeBtn) {
    els.hideSeekClassicModeBtn.disabled =
      setupDisabled;
  }

  if (els.hideSeekWolfPackModeBtn) {
    els.hideSeekWolfPackModeBtn.disabled =
      setupDisabled;
  }

  if (els.hideSeekModeDescription) {
    els.hideSeekModeDescription.textContent =
      setupDetails.tagline;
  }

  if (els.hideSeekPlayerRange) {
    els.hideSeekPlayerRange.textContent =
      setupDetails.range;
  }

  if (els.startHideSeekBtn) {
    els.startHideSeekBtn.disabled =
      !hasActiveMultiplayerRoom() ||
      memberCount <
        setupDetails.minimumPlayers ||
      state.hideSeek.starting ||
      state.multiplayer.leaving;

    els.startHideSeekBtn.textContent =
      state.hideSeek.starting
        ? `Preparing ${setupDetails.name}...`
        : state.hideSeek.roundId
          ? `Start another ${setupDetails.name} round`
          : `Start ${setupDetails.name}`;
  }

  if (
    els.hideSeekPreparationText &&
    !state.hideSeek.preparationText &&
    !state.hideSeek.unavailableMessage
  ) {
    els.hideSeekPreparationText.textContent =
      memberCount <
        setupDetails.minimumPlayers
        ? `At least ${setupDetails.minimumPlayers} riders must be in the room.`
        : setupDetails.mode ===
            RD85_WOLF_PACK_MODE
          ? "The app will choose two wolves and one road-based hiding zone."
          : "The app will choose one wolf and one road-based hiding zone.";
  }

  const activeDetails = rd85IsWolfPack()
    ? rd85ModeDetails(
        RD85_WOLF_PACK_MODE
      )
    : state.hideSeek.gameMode ===
        RD85_CLASSIC_MODE
      ? rd85ModeDetails(
          RD85_CLASSIC_MODE
        )
      : null;

  if (els.hideSeekGameModeBadge) {
    els.hideSeekGameModeBadge.classList.toggle(
      "hidden",
      !activeDetails
    );

    els.hideSeekGameModeBadge.textContent =
      activeDetails?.name || "";

    els.hideSeekGameModeBadge.classList.toggle(
      "wolf-pack",
      rd85IsWolfPack()
    );
  }

  if (
    rd85IsWolfPack() &&
    els.leaveHideSeekBtn
  ) {
    els.leaveHideSeekBtn.textContent =
      state.hideSeek.leaving
        ? "Leaving game..."
        : "Leave Wolf Pack";
  }

  if (
    rd85IsWolfPack() &&
    els.hideSeekMapPhase
  ) {
    if (
      state.hideSeek.phase === "starting"
    ) {
      els.hideSeekMapPhase.textContent =
        "Wolf Pack • Choosing";
    } else if (
      state.hideSeek.phase === "escape" &&
      state.hideSeek.fastCountdownActive
    ) {
      els.hideSeekMapPhase.textContent =
        "Wolves start soon";
    } else if (
      state.hideSeek.phase === "escape"
    ) {
      els.hideSeekMapPhase.textContent =
        "Wolf Pack • Escape";
    } else if (
      state.hideSeek.phase === "hunt"
    ) {
      els.hideSeekMapPhase.textContent =
        "Wolf Pack • Hunt";
    } else if (
      state.hideSeek.phase === "finished"
    ) {
      els.hideSeekMapPhase.textContent =
        state.hideSeek.winner === "wolf"
          ? "Wolves win"
          : "Sheep win";
    }
  }

  rd85ApplyWolfPackMarkerLabels();
};

/* -------------------------------------------------- */
/* Wolf teammate markers                              */
/* -------------------------------------------------- */

drawHideSeekMarkers = function (players) {
  if (!state.hideSeek.layer || !state.map) {
    return;
  }

  const seenIds = new Set();

  for (const player of players || []) {
    const userId = String(
      player.user_id || ""
    );

    if (!userId || player.is_me) {
      continue;
    }

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

    const status = String(
      player.player_status || "active"
    );

    const role =
      player.role === "wolf"
        ? "wolf"
        : "sheep";

    const wolfTeammateVisible =
      rd85IsWolfPack() &&
      state.hideSeek.viewerRole === "wolf" &&
      role === "wolf" &&
      ["escape", "hunt"].includes(
        state.hideSeek.phase
      );

    const visibleByGameRules =
      wolfTeammateVisible ||
      (
        state.hideSeek.phase === "hunt" &&
        (
          (
            state.hideSeek.viewerRole ===
              "sheep" &&
            role === "wolf"
          ) ||
          (
            role === "sheep" &&
            ["found", "out"].includes(
              status
            )
          )
        )
      );

    if (!visibleByGameRules) {
      continue;
    }

    const colour =
      status === "found" ||
      status === "out"
        ? HIDE_SEEK_OUT_COLOUR
        : role === "wolf"
          ? HIDE_SEEK_WOLF_COLOUR
          : HIDE_SEEK_SHEEP_COLOUR;

    seenIds.add(userId);

    const icon = L.divIcon({
      className:
        "multiplayer-dot-icon hide-seek-dot-icon",

      html: `
        <div
          class="hide-seek-leaflet-dot ${role} ${escapeHtml(status)}"
          style="--dot-colour: ${colour};"
        ></div>
      `,

      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    const roleLabel =
      wolfTeammateVisible
        ? "Wolf teammate"
        : role === "wolf"
          ? "Wolf"
          : hideSeekPlayerStatusLabel(
              player
            );

    const tooltip =
      `${escapeHtml(
        player.display_name || "Player"
      )} • ${roleLabel}`;

    const existingMarker =
      state.hideSeek.markers.get(userId);

    if (existingMarker) {
      existingMarker.setLatLng([
        lat,
        lng
      ]);

      existingMarker.setIcon(icon);

      existingMarker.setTooltipContent(
        tooltip
      );
    } else {
      const marker = L.marker(
        [lat, lng],
        {
          icon,
          pane: "multiplayerPane",
          interactive: false
        }
      ).addTo(state.hideSeek.layer);

      marker.bindTooltip(tooltip, {
        sticky: true
      });

      state.hideSeek.markers.set(
        userId,
        marker
      );
    }
  }

  for (
    const [userId, marker] of
    state.hideSeek.markers.entries()
  ) {
    if (!seenIds.has(userId)) {
      state.hideSeek.layer.removeLayer(
        marker
      );

      state.hideSeek.markers.delete(
        userId
      );
    }
  }
};

function rd85ApplyWolfPackMarkerLabels() {
  if (!rd85IsWolfPack()) return;

  for (const player of state.hideSeek.players) {
    if (
      player?.role !== "wolf" ||
      player?.is_me
    ) {
      continue;
    }

    const marker =
      state.hideSeek.markers.get(
        String(player.user_id || "")
      );

    marker?.setTooltipContent(
      `${escapeHtml(
        player.display_name || "Player"
      )} • Wolf teammate`
    );
  }
}

function rd85InitWolfPackMode() {
  rd85BindWolfPackControls();
  renderHideSeekState();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd85InitWolfPackMode,
    { once: true }
  );
} else {
  rd85InitWolfPackMode();
}

/* ================================================== */
/* Road Discovery AU v86 Road Conquest                */
/* app.js Part 1 of 2                                 */
/* Append below the existing v85 Wolf Pack block      */
/* ================================================== */

const RD86_CONQUEST_RED = "#ff4d4d";
const RD86_CONQUEST_BLUE = "#4bb3ff";
const RD86_CONQUEST_NEUTRAL = "#9aa3b2";
const RD86_CONQUEST_LOCATION_SEND_MS = 3000;
const RD86_CONQUEST_ROUTE_REROUTE_MS = 45000;
const RD86_CONQUEST_ROUTE_REROUTE_M = 140;
const RD86_CONQUEST_MIN_PLAYERS = 2;
const RD86_CONQUEST_MAX_PLAYERS = 8;
const RD86_CONQUEST_MIN_CANDIDATES = 18;
const RD86_CONQUEST_MAX_CANDIDATES = 60;
const RD86_CONQUEST_CANDIDATE_MIN_M = 700;
const RD86_CONQUEST_CANDIDATE_MAX_M = 2450;
const RD86_CONQUEST_CANDIDATE_SPACING_M = 135;
const RD86_CONQUEST_ROAD_DENSITY_RADIUS_M = 450;
const RD86_CONQUEST_MIN_ROAD_COUNT = 15;

const roadDiscoveryV86 = {
  renderMultiplayerState,
  pollHideSeekState,
  maybeSendMultiplayerLocation,
  startMultiplayerMode,
  stopMultiplayerMode,
  leaveMultiplayerRoom,
  startHideSeekRound,
  markerColour: hs50OwnMarkerColour,
  markerHaloColour: hs50OwnMarkerHaloColour
};

state.conquest = {
  roundId: null,
  phase: "",
  viewerTeam: "",
  viewerCheckedIn: false,
  winner: null,

  deploymentEndsAt: null,
  graceEndsAt: null,
  countdownEndsAt: null,
  matchStartsAt: null,
  matchEndsAt: null,
  overtimeEndsAt: null,
  serverOffsetMs: 0,

  startPoint: null,
  startRadiusM: 150,
  objectiveRadiusM: 100,
  cacheCollectRadiusM: 40,

  redScore: 0,
  blueScore: 0,
  redReadyCount: 0,
  blueReadyCount: 0,
  redTotal: 0,
  blueTotal: 0,

  players: [],
  objectives: [],
  caches: [],

  starting: false,
  polling: false,
  updatingLocation: false,
  leaving: false,
  preparationText: "",
  unavailableMessage: "",
  lastLocationSentAt: 0,

  layer: null,
  startCircle: null,
  startMarker: null,
  teammateMarkers: new Map(),
  objectiveLayers: new Map(),
  cacheMarkers: new Map(),

  routeLine: null,
  routeHalo: null,
  routeLoading: false,
  routeRequestId: 0,
  routeKey: "",
  lastRouteStartPoint: null,
  lastRouteAt: 0,

  countdownTimer: null,
  resultTimer: null,
  resultShownFor: ""
};

function rd86CacheConquestElements() {
  [
    "conquestSetupBox",
    "startConquestBtn",
    "conquestPreparationText",
    "conquestGameBox",
    "conquestTeamBadge",
    "conquestPhaseBadge",
    "conquestTimerValue",
    "conquestRedScore",
    "conquestBlueScore",
    "conquestGameStatus",
    "conquestPlayersList",
    "leaveConquestBtn",
    "conquestMapHud",
    "conquestMapTeam",
    "conquestMapPhase",
    "conquestMapTimer",
    "conquestMapRedScore",
    "conquestMapBlueScore",
    "conquestFocusStrip",
    "conquestResultOverlay",
    "conquestResultEyebrow",
    "conquestResultTitle",
    "conquestResultScore"
  ].forEach((id) => {
    els[id] = $(id);
  });
}

function hasActiveConquestRound() {
  return Boolean(
    state.conquest.roundId &&
    [
      "deployment",
      "countdown",
      "active",
      "overtime"
    ].includes(state.conquest.phase)
  );
}

function rd86HasConquestRound() {
  return Boolean(state.conquest.roundId);
}

function rd86TeamColour(team) {
  return team === "red"
    ? RD86_CONQUEST_RED
    : team === "blue"
      ? RD86_CONQUEST_BLUE
      : RD86_CONQUEST_NEUTRAL;
}

function rd86TeamLabel(team) {
  if (team === "red") return "Red Team";
  if (team === "blue") return "Blue Team";
  return "Team";
}

function rd86EnsureConquestLayer() {
  if (
    state.map &&
    !state.conquest.layer
  ) {
    state.conquest.layer =
      L.layerGroup().addTo(state.map);
  }
}

function rd86ClearLayerItem(item) {
  if (
    item &&
    state.conquest.layer
  ) {
    state.conquest.layer.removeLayer(item);
  }
}

function rd86ClearConquestRoute(options = {}) {
  const keepRequest =
    options.keepRequest === true;

  if (!keepRequest) {
    state.conquest.routeRequestId += 1;
    state.conquest.routeLoading = false;
  }

  rd86ClearLayerItem(
    state.conquest.routeHalo
  );

  rd86ClearLayerItem(
    state.conquest.routeLine
  );

  state.conquest.routeHalo = null;
  state.conquest.routeLine = null;
  state.conquest.routeKey = "";
  state.conquest.lastRouteStartPoint = null;
  state.conquest.lastRouteAt = 0;
}

function rd86ClearConquestVisuals() {
  rd86ClearConquestRoute();

  rd86ClearLayerItem(
    state.conquest.startCircle
  );

  rd86ClearLayerItem(
    state.conquest.startMarker
  );

  state.conquest.startCircle = null;
  state.conquest.startMarker = null;

  for (
    const marker of
    state.conquest.teammateMarkers.values()
  ) {
    rd86ClearLayerItem(marker);
  }

  state.conquest.teammateMarkers.clear();

  for (
    const layers of
    state.conquest.objectiveLayers.values()
  ) {
    rd86ClearLayerItem(layers.circle);
    rd86ClearLayerItem(layers.marker);
  }

  state.conquest.objectiveLayers.clear();

  for (
    const marker of
    state.conquest.cacheMarkers.values()
  ) {
    rd86ClearLayerItem(marker);
  }

  state.conquest.cacheMarkers.clear();
}

function rd86StopConquestCountdown() {
  if (
    state.conquest.countdownTimer !== null
  ) {
    window.clearInterval(
      state.conquest.countdownTimer
    );

    state.conquest.countdownTimer = null;
  }
}

function rd86StartConquestCountdown() {
  rd86StopConquestCountdown();

  if (!rd86HasConquestRound()) return;

  state.conquest.countdownTimer =
    window.setInterval(() => {
      rd86RenderConquestState();
    }, 1000);
}

function rd86ResetConquestState(options = {}) {
  const clearRound =
    options.clearRound !== false;

  const render =
    options.render !== false;

  rd86StopConquestCountdown();
  rd86ClearConquestVisuals();

  if (state.conquest.resultTimer !== null) {
    window.clearTimeout(
      state.conquest.resultTimer
    );

    state.conquest.resultTimer = null;
  }

  els.conquestResultOverlay
    ?.classList.add("hidden");

  state.conquest.starting = false;
  state.conquest.polling = false;
  state.conquest.updatingLocation = false;
  state.conquest.leaving = false;
  state.conquest.preparationText = "";
  state.conquest.unavailableMessage = "";
  state.conquest.lastLocationSentAt = 0;

  if (clearRound) {
    state.conquest.roundId = null;
    state.conquest.phase = "";
    state.conquest.viewerTeam = "";
    state.conquest.viewerCheckedIn = false;
    state.conquest.winner = null;

    state.conquest.deploymentEndsAt = null;
    state.conquest.graceEndsAt = null;
    state.conquest.countdownEndsAt = null;
    state.conquest.matchStartsAt = null;
    state.conquest.matchEndsAt = null;
    state.conquest.overtimeEndsAt = null;
    state.conquest.serverOffsetMs = 0;

    state.conquest.startPoint = null;
    state.conquest.startRadiusM = 150;
    state.conquest.objectiveRadiusM = 100;
    state.conquest.cacheCollectRadiusM = 40;

    state.conquest.redScore = 0;
    state.conquest.blueScore = 0;
    state.conquest.redReadyCount = 0;
    state.conquest.blueReadyCount = 0;
    state.conquest.redTotal = 0;
    state.conquest.blueTotal = 0;

    state.conquest.players = [];
    state.conquest.objectives = [];
    state.conquest.caches = [];
    state.conquest.resultShownFor = "";
  }

  document.body.classList.remove(
    "conquest-game-active",
    "conquest-red-team",
    "conquest-blue-team"
  );

  hs47StyleHeadingMarker?.();

  if (render) {
    renderMultiplayerState();
  }
}

function rd86NormaliseJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);

      return Array.isArray(parsed)
        ? parsed
        : [];
    } catch (error) {
      return [];
    }
  }

  return [];
}

function rd86ConquestServerNow() {
  return (
    Date.now() +
    state.conquest.serverOffsetMs
  );
}

function rd86DeadlineForPhase() {
  const serverNow =
    rd86ConquestServerNow();

  if (
    state.conquest.phase === "deployment"
  ) {
    const deploymentMs = Date.parse(
      state.conquest.deploymentEndsAt || ""
    );

    if (
      Number.isFinite(deploymentMs) &&
      serverNow < deploymentMs
    ) {
      return deploymentMs;
    }

    return Date.parse(
      state.conquest.graceEndsAt || ""
    );
  }

  if (
    state.conquest.phase === "countdown"
  ) {
    return Date.parse(
      state.conquest.countdownEndsAt || ""
    );
  }

  if (state.conquest.phase === "active") {
    return Date.parse(
      state.conquest.matchEndsAt || ""
    );
  }

  if (
    state.conquest.phase === "overtime"
  ) {
    return Date.parse(
      state.conquest.overtimeEndsAt || ""
    );
  }

  return NaN;
}

function rd86FormatConquestCountdown() {
  const deadline =
    rd86DeadlineForPhase();

  if (!Number.isFinite(deadline)) {
    return "00:00";
  }

  const seconds = Math.max(
    0,
    Math.ceil(
      (
        deadline -
        rd86ConquestServerNow()
      ) / 1000
    )
  );

  const minutes =
    Math.floor(seconds / 60);

  return (
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds % 60).padStart(2, "0")}`
  );
}

function rd86ConquestPhaseLabel() {
  if (
    state.conquest.phase === "deployment"
  ) {
    const deploymentMs = Date.parse(
      state.conquest.deploymentEndsAt || ""
    );

    return (
      Number.isFinite(deploymentMs) &&
      rd86ConquestServerNow() >= deploymentMs
    )
      ? "Team grace"
      : "Deployment";
  }

  if (
    state.conquest.phase === "countdown"
  ) {
    return "Starting";
  }

  if (state.conquest.phase === "active") {
    return "Conquest";
  }

  if (
    state.conquest.phase === "overtime"
  ) {
    return "Overtime";
  }

  if (
    state.conquest.phase === "finished"
  ) {
    return "Finished";
  }

  if (
    state.conquest.phase === "cancelled"
  ) {
    return "Cancelled";
  }

  return "Waiting";
}

function rd86ConquestStatusText() {
  if (
    state.conquest.phase === "deployment"
  ) {
    if (state.conquest.viewerCheckedIn) {
      return (
        "Checked in. Waiting for both teams to reach " +
        "their private starting areas."
      );
    }

    return (
      `Reach the ${rd86TeamLabel(
        state.conquest.viewerTeam
      )} starting area to check in.`
    );
  }

  if (
    state.conquest.phase === "countdown"
  ) {
    return (
      "A, B, C, D and E will appear when the countdown " +
      "reaches zero."
    );
  }

  if (state.conquest.phase === "active") {
    return (
      "Capture A, B, C, D and E. Owned objectives score " +
      "every three seconds. Collect Road Caches for bonuses."
    );
  }

  if (
    state.conquest.phase === "overtime"
  ) {
    return (
      "Sudden victory: the next completed objective " +
      "capture or Road Cache wins."
    );
  }

  if (
    state.conquest.phase === "finished"
  ) {
    if (state.conquest.winner === "draw") {
      return "The match finished as a draw.";
    }

    return (
      `${rd86TeamLabel(
        state.conquest.winner
      )} won the match.`
    );
  }

  if (
    state.conquest.phase === "cancelled"
  ) {
    return (
      "The match was cancelled because both teams " +
      "could not remain active."
    );
  }

  return "Waiting for Road Conquest.";
}

function rd86RenderConquestPlayers() {
  if (!els.conquestPlayersList) return;

  const players = Array.isArray(
    state.conquest.players
  )
    ? state.conquest.players
    : [];

  if (players.length === 0) {
    els.conquestPlayersList.innerHTML = `
      <div class="empty-state">
        Teams appear when Conquest starts.
      </div>
    `;

    return;
  }

  els.conquestPlayersList.innerHTML =
    players
      .map((player) => {
        const team =
          player?.team === "red"
            ? "red"
            : "blue";

        const active =
          player?.player_status === "active";

        const checkedIn =
          Boolean(player?.checked_in);

        const status = !active
          ? "Left"
          : checkedIn
            ? "Ready"
            : "Travelling";

        return `
          <div class="conquest-player-row ${team}">
            <span
              class="conquest-player-dot ${team}"
              aria-hidden="true"
            ></span>

            <div class="conquest-player-main">
              <strong>
                ${escapeHtml(
                  player?.display_name ||
                  "Rider"
                )}${player?.is_me ? " • You" : ""}
              </strong>

              <span>
                ${rd86TeamLabel(team)}
              </span>
            </div>

            <span class="conquest-player-state">
              ${escapeHtml(status)}
            </span>
          </div>
        `;
      })
      .join("");
}

function rd86ObjectiveFocusHtml(objective) {
  const code = String(
    objective?.code || "?"
  );

  const owner =
    objective?.owner_team === "red"
      ? "red"
      : objective?.owner_team === "blue"
        ? "blue"
        : "neutral";

  const pressure = String(
    objective?.pressure_state || "empty"
  );

  return `
    <button
      class="conquest-focus-btn objective ${owner}"
      type="button"
      data-conquest-kind="objective"
      data-conquest-id="${escapeHtml(code)}"
      aria-label="Focus objective ${escapeHtml(code)}"
    >
      <span
        class="conquest-focus-arrow"
        aria-hidden="true"
      >
        ↑
      </span>

      <strong>${escapeHtml(code)}</strong>

      <small>
        ${pressure === "contested" ? "Fight" : owner}
      </small>
    </button>
  `;
}

function rd86CacheFocusHtml(cache) {
  const id = String(cache?.id || "");

  const tier = String(
    cache?.tier || "bronze"
  );

  return `
    <button
      class="conquest-focus-btn cache ${escapeHtml(tier)}"
      type="button"
      data-conquest-kind="cache"
      data-conquest-id="${escapeHtml(id)}"
      aria-label="Focus ${escapeHtml(tier)} Road Cache"
    >
      <span
        class="conquest-focus-arrow"
        aria-hidden="true"
      >
        ↑
      </span>

      <strong>
        +${Number(cache?.reward) || 0}
      </strong>

      <small>${escapeHtml(tier)}</small>
    </button>
  `;
}

function rd86RenderFocusStrip() {
  if (!els.conquestFocusStrip) return;

  if (
    ![
      "active",
      "overtime",
      "finished"
    ].includes(state.conquest.phase)
  ) {
    els.conquestFocusStrip.innerHTML = "";

    els.conquestFocusStrip.classList.add(
      "hidden"
    );

    return;
  }

  const objectiveHtml =
    state.conquest.objectives
      .map(rd86ObjectiveFocusHtml)
      .join("");

  const cacheHtml =
    state.conquest.caches
      .filter(
        (cache) =>
          String(cache?.status || "") ===
          "available"
      )
      .map(rd86CacheFocusHtml)
      .join("");

  els.conquestFocusStrip.innerHTML =
    objectiveHtml + cacheHtml;

  els.conquestFocusStrip.classList.toggle(
    "hidden",
    !objectiveHtml && !cacheHtml
  );

  window.requestAnimationFrame(
    rd86UpdateFocusDirections
  );
}

function rd86RenderConquestState() {
  rd86CacheConquestElements();

  const roomActive =
    hasActiveMultiplayerRoom();

  const activeRound =
    hasActiveConquestRound();

  const hasRound =
    rd86HasConquestRound();

  const hideSeekBusy = Boolean(
    state.hideSeek.starting ||
    hasActiveHideSeekRound()
  );

  const memberCount =
    state.multiplayer.members.length;

  els.conquestSetupBox?.classList.toggle(
    "hidden",
    !roomActive ||
    activeRound ||
    hideSeekBusy
  );

  els.conquestGameBox?.classList.toggle(
    "hidden",
    !roomActive || !hasRound
  );

  if (els.startConquestBtn) {
    els.startConquestBtn.disabled =
      !roomActive ||
      memberCount <
        RD86_CONQUEST_MIN_PLAYERS ||
      memberCount >
        RD86_CONQUEST_MAX_PLAYERS ||
      state.conquest.starting ||
      state.multiplayer.leaving ||
      hideSeekBusy;

    els.startConquestBtn.textContent =
      state.conquest.starting
        ? "Preparing Road Conquest..."
        : hasRound
          ? "Start another Road Conquest"
          : "Start Road Conquest";
  }

  if (els.conquestPreparationText) {
    els.conquestPreparationText.textContent =
      state.conquest.preparationText ||
      state.conquest.unavailableMessage ||
      (
        memberCount <
          RD86_CONQUEST_MIN_PLAYERS
          ? "At least 2 riders must be in the room."
          : memberCount >
              RD86_CONQUEST_MAX_PLAYERS
            ? "Road Conquest supports a maximum of 8 riders."
            : "The app will build two teams and choose road-based objectives."
      );
  }

  if (els.conquestTeamBadge) {
    els.conquestTeamBadge.textContent =
      rd86TeamLabel(
        state.conquest.viewerTeam
      );

    els.conquestTeamBadge.classList.toggle(
      "red",
      state.conquest.viewerTeam === "red"
    );

    els.conquestTeamBadge.classList.toggle(
      "blue",
      state.conquest.viewerTeam === "blue"
    );
  }

  const phaseLabel =
    rd86ConquestPhaseLabel();

  const timerText =
    rd86FormatConquestCountdown();

  if (els.conquestPhaseBadge) {
    els.conquestPhaseBadge.textContent =
      phaseLabel;
  }

  if (els.conquestTimerValue) {
    els.conquestTimerValue.textContent =
      timerText;
  }

  if (els.conquestRedScore) {
    els.conquestRedScore.textContent =
      String(state.conquest.redScore);
  }

  if (els.conquestBlueScore) {
    els.conquestBlueScore.textContent =
      String(state.conquest.blueScore);
  }

  if (els.conquestGameStatus) {
    els.conquestGameStatus.textContent =
      rd86ConquestStatusText();
  }

  if (els.leaveConquestBtn) {
    els.leaveConquestBtn.classList.toggle(
      "hidden",
      !hasRound
    );

    els.leaveConquestBtn.disabled =
      state.conquest.leaving;

    els.leaveConquestBtn.textContent =
      state.conquest.leaving
        ? "Leaving Conquest..."
        : activeRound
          ? "Leave Road Conquest"
          : "Close Conquest result";
  }

  const showMapHud = Boolean(
    roomActive && activeRound
  );

  els.conquestMapHud?.classList.toggle(
    "hidden",
    !showMapHud
  );

  if (els.conquestMapTeam) {
    els.conquestMapTeam.textContent =
      rd86TeamLabel(
        state.conquest.viewerTeam
      );

    els.conquestMapTeam.classList.toggle(
      "red",
      state.conquest.viewerTeam === "red"
    );

    els.conquestMapTeam.classList.toggle(
      "blue",
      state.conquest.viewerTeam === "blue"
    );
  }

  if (els.conquestMapPhase) {
    els.conquestMapPhase.textContent =
      phaseLabel;
  }

  if (els.conquestMapTimer) {
    els.conquestMapTimer.textContent =
      timerText;
  }

  if (els.conquestMapRedScore) {
    els.conquestMapRedScore.textContent =
      String(state.conquest.redScore);
  }

  if (els.conquestMapBlueScore) {
    els.conquestMapBlueScore.textContent =
      String(state.conquest.blueScore);
  }

  rd86RenderConquestPlayers();
  rd86RenderFocusStrip();

  document.body.classList.toggle(
    "conquest-game-active",
    activeRound
  );

  document.body.classList.toggle(
    "conquest-red-team",
    activeRound &&
      state.conquest.viewerTeam === "red"
  );

  document.body.classList.toggle(
    "conquest-blue-team",
    activeRound &&
      state.conquest.viewerTeam === "blue"
  );

  if (
    (
      state.conquest.starting ||
      hasRound
    ) &&
    els.hideSeekSetupBox
  ) {
    els.hideSeekSetupBox.classList.add(
      "hidden"
    );
  }
}

function rd86StartIcon(team) {
  const label =
    team === "red" ? "RED" : "BLUE";

  return L.divIcon({
    className:
      "conquest-start-marker-icon",

    html: `
      <div class="conquest-start-marker ${team}">
        <strong>${label}</strong>
        <span>START</span>
      </div>
    `,

    iconSize: [64, 48],
    iconAnchor: [32, 24]
  });
}

function rd86DrawDeploymentStart() {
  rd86EnsureConquestLayer();

  const show = Boolean(
    state.conquest.phase === "deployment" &&
    state.conquest.startPoint
  );

  if (!show) {
    rd86ClearLayerItem(
      state.conquest.startCircle
    );

    rd86ClearLayerItem(
      state.conquest.startMarker
    );

    state.conquest.startCircle = null;
    state.conquest.startMarker = null;

    rd86ClearConquestRoute();
    return;
  }

  const point =
    state.conquest.startPoint;

  const latlng = [
    point.lat,
    point.lng
  ];

  const team =
    state.conquest.viewerTeam;

  const colour =
    rd86TeamColour(team);

  if (!state.conquest.startCircle) {
    state.conquest.startCircle =
      L.circle(latlng, {
        radius:
          state.conquest.startRadiusM,

        color: colour,
        weight: 3,
        opacity: 0.95,
        fillColor: colour,
        fillOpacity: 0.13,
        dashArray: "10 8",
        interactive: false
      }).addTo(state.conquest.layer);
  } else {
    state.conquest.startCircle
      .setLatLng(latlng)
      .setRadius(
        state.conquest.startRadiusM
      )
      .setStyle({
        color: colour,
        fillColor: colour
      });
  }

  if (!state.conquest.startMarker) {
    state.conquest.startMarker =
      L.marker(latlng, {
        icon: rd86StartIcon(team),
        pane: "multiplayerPane",
        interactive: false
      }).addTo(state.conquest.layer);
  } else {
    state.conquest.startMarker
      .setLatLng(latlng)
      .setIcon(
        rd86StartIcon(team)
      );
  }

  if (
    !state.conquest.viewerCheckedIn
  ) {
    void rd86EnsureDeploymentRoute();
  } else {
    rd86ClearConquestRoute();
  }
}

function rd86TeammateIcon(team) {
  return L.divIcon({
    className:
      "multiplayer-dot-icon conquest-teammate-icon",

    html: `
      <div class="conquest-teammate-dot ${team}"></div>
    `,

    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
}

function rd86DrawTeammates() {
  rd86EnsureConquestLayer();

  const seen = new Set();

  for (
    const player of
    state.conquest.players
  ) {
    const userId = String(
      player?.user_id || ""
    );

    if (
      !userId ||
      player?.is_me ||
      player?.team !==
        state.conquest.viewerTeam ||
      player?.player_status !== "active"
    ) {
      continue;
    }

    const lat =
      Number(player?.lat);

    const lng =
      Number(player?.lng);

    if (
      player?.lat === null ||
      player?.lng === null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      continue;
    }

    seen.add(userId);

    const tooltip =
      `${escapeHtml(
        player?.display_name ||
        "Teammate"
      )} • ${rd86TeamLabel(
        player?.team
      )}`;

    const existing =
      state.conquest.teammateMarkers.get(
        userId
      );

    if (existing) {
      existing.setLatLng([lat, lng]);

      existing.setIcon(
        rd86TeammateIcon(
          player.team
        )
      );

      existing.setTooltipContent(
        tooltip
      );
    } else {
      const marker = L.marker(
        [lat, lng],
        {
          icon: rd86TeammateIcon(
            player.team
          ),
          pane: "multiplayerPane",
          interactive: false
        }
      ).addTo(state.conquest.layer);

      marker.bindTooltip(
        tooltip,
        {
          sticky: true
        }
      );

      state.conquest.teammateMarkers.set(
        userId,
        marker
      );
    }
  }

  for (
    const [userId, marker] of
    state.conquest.teammateMarkers.entries()
  ) {
    if (!seen.has(userId)) {
      rd86ClearLayerItem(marker);

      state.conquest.teammateMarkers.delete(
        userId
      );
    }
  }
}

function rd86ObjectiveIcon(objective) {
  const owner =
    objective?.owner_team === "red"
      ? "red"
      : objective?.owner_team === "blue"
        ? "blue"
        : "neutral";

  const pressure = String(
    objective?.pressure_state ||
    "empty"
  );

  return L.divIcon({
    className:
      "conquest-objective-marker-icon",

    html: `
      <div class="conquest-objective-marker ${owner} ${escapeHtml(pressure)}">
        ${escapeHtml(
          String(objective?.code || "?")
        )}
      </div>
    `,

    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });
}

function rd86FocusPoint(point) {
  if (
    !state.map ||
    !Number.isFinite(
      Number(point?.lat)
    ) ||
    !Number.isFinite(
      Number(point?.lng)
    )
  ) {
    return;
  }

  state.followUser = false;

  state.map.panTo(
    [
      Number(point.lat),
      Number(point.lng)
    ],
    {
      animate: true,
      duration: 0.35
    }
  );
}

function rd86DrawObjectives() {
  rd86EnsureConquestLayer();

  const visible = [
    "active",
    "overtime",
    "finished"
  ].includes(state.conquest.phase);

  const objectives = visible
    ? state.conquest.objectives
    : [];

  const seen = new Set();

  for (const objective of objectives) {
    const code = String(
      objective?.code || ""
    );

    const lat =
      Number(objective?.lat);

    const lng =
      Number(objective?.lng);

    if (
      !code ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      continue;
    }

    seen.add(code);

    const owner =
      objective?.owner_team === "red"
        ? "red"
        : objective?.owner_team === "blue"
          ? "blue"
          : "neutral";

    const colour =
      rd86TeamColour(owner);

    const latlng = [lat, lng];

    const existing =
      state.conquest.objectiveLayers.get(
        code
      );

    if (existing) {
      existing.circle
        .setLatLng(latlng)
        .setRadius(
          state.conquest.objectiveRadiusM
        )
        .setStyle({
          color: colour,
          fillColor: colour
        });

      existing.marker
        .setLatLng(latlng)
        .setIcon(
          rd86ObjectiveIcon(
            objective
          )
        );
    } else {
      const circle = L.circle(
        latlng,
        {
          radius:
            state.conquest.objectiveRadiusM,

          color: colour,
          weight: 3,
          opacity: 0.96,
          fillColor: colour,
          fillOpacity: 0.14,

          dashArray:
            owner === "neutral"
              ? "8 7"
              : null,

          interactive: false
        }
      ).addTo(state.conquest.layer);

      const marker = L.marker(
        latlng,
        {
          icon:
            rd86ObjectiveIcon(
              objective
            ),

          interactive: true,
          keyboard: false,
          zIndexOffset: 20
        }
      ).addTo(state.conquest.layer);

      marker.on("click", () => {
        rd86FocusPoint({
          lat,
          lng
        });
      });

      marker.bindTooltip(
        `Objective ${escapeHtml(code)}`,
        {
          direction: "top"
        }
      );

      state.conquest.objectiveLayers.set(
        code,
        {
          circle,
          marker
        }
      );
    }
  }

  for (
    const [code, layers] of
    state.conquest.objectiveLayers.entries()
  ) {
    if (!seen.has(code)) {
      rd86ClearLayerItem(
        layers.circle
      );

      rd86ClearLayerItem(
        layers.marker
      );

      state.conquest.objectiveLayers.delete(
        code
      );
    }
  }
}

function rd86CacheIcon(cache) {
  const tier = String(
    cache?.tier || "bronze"
  );

  return L.divIcon({
    className:
      "conquest-cache-marker-icon",

    html: `
      <div class="conquest-cache-marker ${escapeHtml(tier)}">
        <span>
          +${Number(cache?.reward) || 0}
        </span>
      </div>
    `,

    iconSize: [42, 42],
    iconAnchor: [21, 21]
  });
}

function rd86DrawCaches() {
  rd86EnsureConquestLayer();

  const visible = [
    "active",
    "overtime",
    "finished"
  ].includes(state.conquest.phase);

  const caches = visible
    ? state.conquest.caches
    : [];

  const seen = new Set();

  for (const cache of caches) {
    const id = String(
      cache?.id || ""
    );

    const lat =
      Number(cache?.lat);

    const lng =
      Number(cache?.lng);

    if (
      !id ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      continue;
    }

    seen.add(id);

    const existing =
      state.conquest.cacheMarkers.get(
        id
      );

    if (existing) {
      existing.setLatLng([lat, lng]);

      existing.setIcon(
        rd86CacheIcon(cache)
      );
    } else {
      const marker = L.marker(
        [lat, lng],
        {
          icon:
            rd86CacheIcon(cache),

          interactive: true,
          keyboard: false,
          zIndexOffset: 30
        }
      ).addTo(state.conquest.layer);

      marker.on("click", () => {
        rd86FocusPoint({
          lat,
          lng
        });
      });

      marker.bindTooltip(
        `${escapeHtml(
          String(
            cache?.tier || "Road"
          )
        )} Cache • +${Number(cache?.reward) || 0}`,
        {
          direction: "top"
        }
      );

      state.conquest.cacheMarkers.set(
        id,
        marker
      );
    }
  }

  for (
    const [id, marker] of
    state.conquest.cacheMarkers.entries()
  ) {
    if (!seen.has(id)) {
      rd86ClearLayerItem(marker);

      state.conquest.cacheMarkers.delete(
        id
      );
    }
  }
}

function rd86DrawConquestMap() {
  if (!rd86HasConquestRound()) {
    rd86ClearConquestVisuals();
    return;
  }

  rd86DrawDeploymentStart();
  rd86DrawTeammates();
  rd86DrawObjectives();
  rd86DrawCaches();
  rd86UpdateFocusDirections();
}

function rd86FocusTarget(kind, id) {
  if (kind === "objective") {
    return (
      state.conquest.objectives.find(
        (objective) =>
          String(
            objective?.code || ""
          ) === String(id || "")
      ) || null
    );
  }

  if (kind === "cache") {
    return (
      state.conquest.caches.find(
        (cache) =>
          String(
            cache?.id || ""
          ) === String(id || "")
      ) || null
    );
  }

  return null;
}

function rd86UpdateFocusDirections() {
  if (
    !state.map ||
    !els.conquestFocusStrip
  ) {
    return;
  }

  const size =
    state.map.getSize();

  const centre = {
    x: size.x / 2,
    y: size.y / 2
  };

  for (
    const button of
    els.conquestFocusStrip.querySelectorAll(
      "[data-conquest-kind]"
    )
  ) {
    const target =
      rd86FocusTarget(
        button.dataset.conquestKind,
        button.dataset.conquestId
      );

    if (!target) continue;

    const point =
      state.map.latLngToContainerPoint([
        Number(target.lat),
        Number(target.lng)
      ]);

    const offscreen =
      point.x < 24 ||
      point.y < 24 ||
      point.x > size.x - 24 ||
      point.y > size.y - 24;

    button.classList.toggle(
      "offscreen",
      offscreen
    );

    const angle =
      Math.atan2(
        point.x - centre.x,
        centre.y - point.y
      ) *
      (180 / Math.PI);

    button.style.setProperty(
      "--conquest-pointer-angle",
      `${angle}deg`
    );
  }
}

async function rd86EnsureDeploymentRoute(
  options = {}
) {
  const force =
    options.force === true;

  if (
    state.conquest.phase !==
      "deployment" ||
    state.conquest.viewerCheckedIn ||
    !state.conquest.startPoint ||
    state.conquest.routeLoading
  ) {
    if (
      state.conquest.phase !==
        "deployment" ||
      state.conquest.viewerCheckedIn
    ) {
      rd86ClearConquestRoute();
    }

    return;
  }

  const destination =
    state.conquest.startPoint;

  const routeKey =
    `${state.conquest.roundId}:` +
    `${destination.lat.toFixed(6)},` +
    `${destination.lng.toFixed(6)}`;

  if (
    !force &&
    state.conquest.routeLine &&
    state.conquest.routeKey ===
      routeKey
  ) {
    return;
  }

  const start =
    state.currentPoint ||
    await getFreshRouteStartPoint();

  if (!start) return;

  const requestId =
    ++state.conquest.routeRequestId;

  state.conquest.routeLoading = true;

  try {
    const route =
      await fetchRoadRoute(
        start,
        destination
      );

    if (
      requestId !==
        state.conquest.routeRequestId ||
      state.conquest.phase !==
        "deployment" ||
      state.conquest.viewerCheckedIn
    ) {
      return;
    }

    rd86ClearConquestRoute({
      keepRequest: true
    });

    if (
      !Array.isArray(route?.coords) ||
      route.coords.length < 2
    ) {
      return;
    }

    const colour =
      rd86TeamColour(
        state.conquest.viewerTeam
      );

    state.conquest.routeHalo =
      L.polyline(
        route.coords,
        {
          color: "#eef7ff",
          weight: 9,
          opacity: 0.68,
          lineCap: "round",
          lineJoin: "round",
          interactive: false
        }
      ).addTo(
        state.conquest.layer
      );

    state.conquest.routeLine =
      L.polyline(
        route.coords,
        {
          color: colour,
          weight: 5,
          opacity: 1,
          lineCap: "round",
          lineJoin: "round",
          interactive: false
        }
      ).addTo(
        state.conquest.layer
      );

    state.conquest.routeKey =
      routeKey;

    state.conquest.lastRouteStartPoint = {
      lat: Number(start.lat),
      lng: Number(start.lng)
    };

    state.conquest.lastRouteAt =
      Date.now();
  } catch (error) {
    console.error(error);
  } finally {
    if (
      requestId ===
      state.conquest.routeRequestId
    ) {
      state.conquest.routeLoading =
        false;
    }
  }
}

function rd86MaybeUpdateDeploymentRoute(
  point
) {
  if (
    state.conquest.phase !==
      "deployment" ||
    state.conquest.viewerCheckedIn ||
    !state.conquest.startPoint ||
    !state.conquest.routeLine ||
    !state.conquest.lastRouteStartPoint ||
    Number(point?.accuracy) >
      MAX_GPS_ACCURACY_M
  ) {
    return;
  }

  if (
    Date.now() -
      state.conquest.lastRouteAt <
    RD86_CONQUEST_ROUTE_REROUTE_MS
  ) {
    return;
  }

  if (
    haversine(
      point,
      state.conquest.lastRouteStartPoint
    ) <
    RD86_CONQUEST_ROUTE_REROUTE_M
  ) {
    return;
  }

  void rd86EnsureDeploymentRoute({
    force: true
  });
}

function rd86BuildConquestCandidates(startPoint) {
  const roadPoints = state.roadSegments
    .map((segment) =>
      roadSegmentMidpoint(segment)
    )
    .filter(Boolean);

  const pool = roadPoints.filter(
    (point) => {
      const distance = haversine(
        startPoint,
        point
      );

      return (
        distance >=
          RD86_CONQUEST_CANDIDATE_MIN_M &&
        distance <=
          RD86_CONQUEST_CANDIDATE_MAX_M
      );
    }
  );

  shuffleHideSeekArray(pool);

  const selected = [];

  for (const point of pool) {
    if (
      selected.some(
        (candidate) =>
          haversine(candidate, point) <
          RD86_CONQUEST_CANDIDATE_SPACING_M
      )
    ) {
      continue;
    }

    let roadCount = 0;

    for (const roadPoint of roadPoints) {
      if (
        haversine(point, roadPoint) <=
        RD86_CONQUEST_ROAD_DENSITY_RADIUS_M
      ) {
        roadCount += 1;
      }
    }

    if (
      roadCount <
      RD86_CONQUEST_MIN_ROAD_COUNT
    ) {
      continue;
    }

    selected.push({
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
      road_count: roadCount,
      routeable: false
    });

    if (
      selected.length >=
      RD86_CONQUEST_MAX_CANDIDATES
    ) {
      break;
    }
  }

  return selected;
}

async function rd86FilterRouteableCandidates(
  startPoint,
  candidates
) {
  const limited = candidates.slice(
    0,
    RD86_CONQUEST_MAX_CANDIDATES
  );

  const coords = [startPoint, ...limited]
    .map(
      (point) =>
        `${point.lng},${point.lat}`
    )
    .join(";");

  const url =
    `https://router.project-osrm.org/table/v1/driving/${coords}` +
    "?sources=0&annotations=duration,distance";

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Conquest routing returned ${response.status}.`
    );
  }

  const data = await response.json();

  if (data.code !== "Ok") {
    throw new Error(
      data.message ||
      "Could not check Conquest routes."
    );
  }

  const durations =
    data.durations?.[0] || [];

  const distances =
    data.distances?.[0] || [];

  return limited
    .map((candidate, index) => ({
      ...candidate,
      routeable:
        Number.isFinite(
          Number(durations[index + 1])
        ) &&
        Number.isFinite(
          Number(distances[index + 1])
        ) &&
        Number(durations[index + 1]) <=
          600 &&
        Number(distances[index + 1]) <=
          5000
    }))
    .filter(
      (candidate) => candidate.routeable
    );
}

function rd86ConquestErrorMessage(error) {
  const message = String(
    error?.message || error || ""
  );

  return message
    ? message.replace(/^Error:\s*/i, "")
    : "Road Conquest had a problem";
}

async function rd86StartConquestRound() {
  if (
    !hasActiveMultiplayerRoom() ||
    !state.auth.client ||
    !state.auth.user ||
    state.conquest.starting ||
    hasActiveConquestRound()
  ) {
    return;
  }

  if (hasActiveHideSeekRound()) {
    showToast(
      "Finish Hide & Seek before starting Road Conquest"
    );
    return;
  }

  const memberCount =
    state.multiplayer.members.length;

  if (
    memberCount <
    RD86_CONQUEST_MIN_PLAYERS
  ) {
    showToast(
      "Road Conquest needs at least 2 riders"
    );
    return;
  }

  if (
    memberCount >
    RD86_CONQUEST_MAX_PLAYERS
  ) {
    showToast(
      "Road Conquest supports a maximum of 8 riders"
    );
    return;
  }

  const safetyAccepted = window.confirm(
    "Play safely. Follow all road rules. Do not speed. " +
    "Do not stop somewhere dangerous. Set up the game " +
    "before moving and never interact with the phone while " +
    "riding or driving.\n\nStart Road Conquest?"
  );

  if (!safetyAccepted) return;

  if (rd86HasConquestRound()) {
    rd86ResetConquestState({
      clearRound: true,
      render: false
    });
  }

  state.conquest.starting = true;
  state.conquest.preparationText =
    "Getting a clean GPS location...";
  state.conquest.unavailableMessage = "";

  renderMultiplayerState();

  try {
    const startPoint =
      await getFreshRouteStartPoint();

    if (
      !startPoint ||
      !Number.isFinite(
        Number(startPoint.lat)
      ) ||
      !Number.isFinite(
        Number(startPoint.lng)
      ) ||
      Number(startPoint.accuracy) >
        MAX_GPS_ACCURACY_M
    ) {
      throw new Error(
        "Need GPS accuracy of 35 metres or better before starting."
      );
    }

    state.conquest.preparationText =
      "Loading nearby road points...";
    renderMultiplayerState();

    const roadsReady =
      await ensureRoadsNearPoint(
        startPoint,
        {
          replaceIfFar: true,
          quiet: false
        }
      );

    if (
      !roadsReady ||
      state.roadSegments.length === 0
    ) {
      throw new Error(
        "Could not load nearby roads for Road Conquest."
      );
    }

    state.conquest.preparationText =
      "Building balanced road objectives...";
    renderMultiplayerState();

    const candidates =
      rd86BuildConquestCandidates(
        startPoint
      );

    if (
      candidates.length <
      RD86_CONQUEST_MIN_CANDIDATES
    ) {
      throw new Error(
        "Not enough suitable roads were found. Move to a road-dense area and try again."
      );
    }

    state.conquest.preparationText =
      "Checking that every location is reachable...";
    renderMultiplayerState();

    const routeable =
      await rd86FilterRouteableCandidates(
        startPoint,
        candidates
      );

    if (
      routeable.length <
      RD86_CONQUEST_MIN_CANDIDATES
    ) {
      throw new Error(
        "Not enough reachable Conquest locations were found. Move to another area and try again."
      );
    }

    state.conquest.preparationText =
      "Randomly creating Red and Blue teams...";
    renderMultiplayerState();

    const { data, error } =
      await state.auth.client.rpc(
        "start_conquest_round",
        {
          p_room_id:
            state.multiplayer.roomId,
          p_start_lat:
            Number(startPoint.lat),
          p_start_lng:
            Number(startPoint.lng),
          p_road_candidates:
            routeable.map(
              (candidate) => ({
                lat: candidate.lat,
                lng: candidate.lng,
                road_count:
                  candidate.road_count,
                routeable: true
              })
            ),
          p_safety_ack: true
        }
      );

    if (error) throw error;

    const roundId = Array.isArray(data)
      ? data[0]
      : data;

    if (!roundId) {
      throw new Error(
        "Could not read the new Road Conquest match."
      );
    }

    state.conquest.roundId =
      String(roundId);

    state.conquest.preparationText = "";

    clearMultiplayerMarkers();

    await rd86PollConquestState({
      force: true
    });

    if (state.currentPoint) {
      void rd86MaybeSendConquestLocation(
        state.currentPoint,
        { force: true }
      );
    }

    showToast("Road Conquest started");
  } catch (error) {
    console.error(error);

    const message =
      rd86ConquestErrorMessage(error);

    state.conquest.preparationText =
      message;

    showToast(message);
  } finally {
    state.conquest.starting = false;
    renderMultiplayerState();
  }
}

function rd86ApplyConquestState(row) {
  const previousRoundId =
    state.conquest.roundId;

  const previousPhase =
    state.conquest.phase;

  const previousCheckedIn =
    state.conquest.viewerCheckedIn;

  state.conquest.roundId = String(
    row?.round_id || ""
  );

  state.conquest.phase = String(
    row?.phase || ""
  );

  state.conquest.viewerTeam = String(
    row?.viewer_team || ""
  );

  state.conquest.viewerCheckedIn =
    Boolean(row?.viewer_checked_in);

  state.conquest.winner =
    row?.winner || null;

  state.conquest.deploymentEndsAt =
    row?.deployment_ends_at || null;

  state.conquest.graceEndsAt =
    row?.grace_ends_at || null;

  state.conquest.countdownEndsAt =
    row?.countdown_ends_at || null;

  state.conquest.matchStartsAt =
    row?.match_starts_at || null;

  state.conquest.matchEndsAt =
    row?.match_ends_at || null;

  state.conquest.overtimeEndsAt =
    row?.overtime_ends_at || null;

  const serverNow = Date.parse(
    row?.server_now || ""
  );

  if (Number.isFinite(serverNow)) {
    state.conquest.serverOffsetMs =
      serverNow - Date.now();
  }

  const startLat = Number(
    row?.viewer_start_lat
  );

  const startLng = Number(
    row?.viewer_start_lng
  );

  state.conquest.startPoint =
    Number.isFinite(startLat) &&
    Number.isFinite(startLng)
      ? { lat: startLat, lng: startLng }
      : null;

  state.conquest.startRadiusM =
    Number(row?.start_radius_m) || 150;

  state.conquest.objectiveRadiusM =
    Number(row?.objective_radius_m) || 100;

  state.conquest.cacheCollectRadiusM =
    Number(row?.cache_collect_radius_m) ||
    40;

  state.conquest.redScore =
    Number(row?.red_score) || 0;

  state.conquest.blueScore =
    Number(row?.blue_score) || 0;

  state.conquest.redReadyCount =
    Number(row?.red_ready_count) || 0;

  state.conquest.blueReadyCount =
    Number(row?.blue_ready_count) || 0;

  state.conquest.redTotal =
    Number(row?.red_total) || 0;

  state.conquest.blueTotal =
    Number(row?.blue_total) || 0;

  state.conquest.players =
    rd86NormaliseJsonArray(row?.players);

  state.conquest.objectives =
    rd86NormaliseJsonArray(
      row?.objectives
    );

  state.conquest.caches =
    rd86NormaliseJsonArray(row?.caches);

  state.conquest.unavailableMessage = "";

  rd86DrawConquestMap();
  rd86StartConquestCountdown();

  hs47StyleHeadingMarker?.();

  const roundChanged =
    previousRoundId !==
    state.conquest.roundId;

  const phaseChanged =
    previousPhase !==
    state.conquest.phase;

  if (roundChanged) {
    showToast(
      `You are on ${rd86TeamLabel(
        state.conquest.viewerTeam
      )}`
    );
  }

  if (
    !previousCheckedIn &&
    state.conquest.viewerCheckedIn
  ) {
    showToast("Team start reached • Checked in");
    rd86ClearConquestRoute();
  }

  if (
    phaseChanged &&
    state.conquest.phase === "countdown"
  ) {
    showToast("Both teams ready • Match starts in 10 seconds");
  }

  if (
    phaseChanged &&
    state.conquest.phase === "active"
  ) {
    showToast("Road Conquest has begun");
  }

  if (
    phaseChanged &&
    state.conquest.phase === "overtime"
  ) {
    showToast("Overtime • Next capture or cache wins");
  }

  if (
    state.conquest.phase === "finished"
  ) {
    rd86ShowConquestResult();
  } else if (
    phaseChanged &&
    state.conquest.phase === "cancelled"
  ) {
    showToast("Road Conquest was cancelled");
  }

  rd86RenderConquestState();
}

async function rd86PollConquestState(
  options = {}
) {
  const force = options.force === true;

  if (
    !hasActiveMultiplayerRoom() ||
    !state.auth.client ||
    !state.auth.user ||
    state.conquest.polling ||
    (!force && !navigator.onLine)
  ) {
    return;
  }

  state.conquest.polling = true;

  const { data, error } =
    await state.auth.client.rpc(
      "get_conquest_state",
      {
        p_room_id:
          state.multiplayer.roomId
      }
    );

  state.conquest.polling = false;

  if (error) {
    console.error(error);

    state.conquest.unavailableMessage =
      rd86ConquestErrorMessage(error);

    rd86RenderConquestState();
    return;
  }

  const rows = Array.isArray(data)
    ? data
    : [];

  if (rows.length === 0) {
    if (!state.conquest.starting) {
      rd86ResetConquestState({
        clearRound: true,
        render: false
      });

      rd86RenderConquestState();
    }

    return;
  }

  const row = rows[0];

  if (
    hasActiveHideSeekRound() &&
    ["finished", "cancelled"].includes(
      String(row?.phase || "")
    )
  ) {
    rd86ResetConquestState({
      clearRound: true,
      render: false
    });
    return;
  }

  rd86ApplyConquestState(row);
}

async function rd86MaybeSendConquestLocation(
  point,
  options = {}
) {
  const force = options.force === true;

  rd86MaybeUpdateDeploymentRoute(point);

  if (
    !hasActiveConquestRound() ||
    !state.auth.client ||
    !state.auth.user ||
    !navigator.onLine ||
    !point ||
    !Number.isFinite(Number(point.lat)) ||
    !Number.isFinite(Number(point.lng)) ||
    !Number.isFinite(
      Number(point.accuracy)
    )
  ) {
    return false;
  }

  const now = Date.now();

  if (
    !force &&
    now -
      state.conquest.lastLocationSentAt <
      RD86_CONQUEST_LOCATION_SEND_MS
  ) {
    return false;
  }

  if (state.conquest.updatingLocation) {
    return false;
  }

  state.conquest.lastLocationSentAt = now;
  state.conquest.updatingLocation = true;

  const { data, error } =
    await state.auth.client.rpc(
      "update_conquest_location",
      {
        p_round_id:
          state.conquest.roundId,
        p_lat: Number(point.lat),
        p_lng: Number(point.lng),
        p_accuracy:
          Number(point.accuracy)
      }
    );

  state.conquest.updatingLocation = false;

  if (error) {
    console.error(error);
    return false;
  }

  if (data?.cache_collected) {
    const tier = String(
      data.cache_tier || "Road"
    );

    showToast(
      `${tier.charAt(0).toUpperCase()}${tier.slice(1)} Cache +${Number(data.cache_reward) || 0}`
    );
  }

  void rd86PollConquestState({
    force: true
  });

  return Boolean(data?.accepted);
}

async function rd86LeaveConquestRound(
  options = {}
) {
  const quiet = options.quiet === true;
  const render = options.render !== false;

  if (
    !state.conquest.roundId ||
    !state.auth.client ||
    !state.auth.user ||
    state.conquest.leaving
  ) {
    rd86ResetConquestState({
      clearRound: true,
      render
    });
    return;
  }

  state.conquest.leaving = true;

  if (render) {
    rd86RenderConquestState();
  }

  const roundId =
    state.conquest.roundId;

  const active =
    hasActiveConquestRound();

  if (active) {
    const { error } =
      await state.auth.client.rpc(
        "leave_conquest_round",
        { p_round_id: roundId }
      );

    if (error && !quiet) {
      console.error(error);
      showToast(
        rd86ConquestErrorMessage(error)
      );
    }
  }

  rd86ResetConquestState({
    clearRound: true,
    render
  });

  if (!quiet) {
    showToast(
      active
        ? "Left Road Conquest"
        : "Conquest result closed"
    );
  }
}

function rd86ShowConquestResult() {
  const roundId = String(
    state.conquest.roundId || ""
  );

  if (
    !roundId ||
    state.conquest.resultShownFor ===
      roundId
  ) {
    return;
  }

  rd86CacheConquestElements();

  if (!els.conquestResultOverlay) {
    return;
  }

  state.conquest.resultShownFor = roundId;

  const winner =
    state.conquest.winner;

  const draw = winner === "draw";
  const victory =
    !draw &&
    winner === state.conquest.viewerTeam;

  const winningTeam = draw
    ? "draw"
    : winner === "red"
      ? "red"
      : "blue";

  els.conquestResultOverlay.classList.remove(
    "hidden",
    "red",
    "blue",
    "draw",
    "victory",
    "defeat"
  );

  els.conquestResultOverlay.classList.add(
    winningTeam,
    draw
      ? "victory"
      : victory
        ? "victory"
        : "defeat"
  );

  if (els.conquestResultEyebrow) {
    els.conquestResultEyebrow.textContent =
      draw
        ? "MATCH COMPLETE"
        : victory
          ? "VICTORY"
          : "DEFEAT";
  }

  if (els.conquestResultTitle) {
    els.conquestResultTitle.textContent =
      draw
        ? "DRAW"
        : `${rd86TeamLabel(winner).toUpperCase()} WINS`;
  }

  if (els.conquestResultScore) {
    els.conquestResultScore.textContent =
      `${state.conquest.redScore} – ${state.conquest.blueScore}`;
  }

  if (state.conquest.resultTimer !== null) {
    window.clearTimeout(
      state.conquest.resultTimer
    );
  }

  state.conquest.resultTimer =
    window.setTimeout(() => {
      els.conquestResultOverlay
        ?.classList.add("hidden");

      state.conquest.resultTimer = null;
    }, 5000);
}

function rd86BindConquestEvents() {
  rd86CacheConquestElements();

  if (
    els.startConquestBtn?.dataset
      .rd86Bound === "true"
  ) {
    return;
  }

  if (els.startConquestBtn) {
    els.startConquestBtn.dataset.rd86Bound =
      "true";

    els.startConquestBtn.addEventListener(
      "click",
      rd86StartConquestRound
    );
  }

  els.leaveConquestBtn?.addEventListener(
    "click",
    () => {
      void rd86LeaveConquestRound();
    }
  );

  els.conquestFocusStrip?.addEventListener(
    "click",
    (event) => {
      const button =
        event.target.closest(
          "[data-conquest-kind]"
        );

      if (!button) return;

      const target = rd86FocusTarget(
        button.dataset.conquestKind,
        button.dataset.conquestId
      );

      if (target) {
        rd86FocusPoint(target);
      }
    }
  );

  state.map?.on(
    "move zoom rotate",
    rd86UpdateFocusDirections
  );
}

/* -------------------------------------------------- */
/* Existing app lifecycle wrappers                    */
/* -------------------------------------------------- */

renderMultiplayerState = function () {
  roadDiscoveryV86.renderMultiplayerState();

  rd86RenderConquestState();

  if (
    hasActiveConquestRound() &&
    els.multiplayerStatusText
  ) {
    els.multiplayerStatusText.textContent =
      state.isRecording
        ? "Road Conquest is active. Start Drive still paints and saves only your own orange roads."
        : "Road Conquest is active. Team locations use the private Conquest game view.";
  }
};

pollHideSeekState = async function (
  options = {}
) {
  await roadDiscoveryV86.pollHideSeekState(
    options
  );

  await rd86PollConquestState(options);
};

maybeSendMultiplayerLocation =
  async function (point, options = {}) {
    if (hasActiveConquestRound()) {
      return rd86MaybeSendConquestLocation(
        point,
        options
      );
    }

    return roadDiscoveryV86
      .maybeSendMultiplayerLocation(
        point,
        options
      );
  };

startMultiplayerMode = function (room) {
  rd86ResetConquestState({
    clearRound: true,
    render: false
  });

  return roadDiscoveryV86
    .startMultiplayerMode(room);
};

stopMultiplayerMode = function (
  options = {}
) {
  rd86ResetConquestState({
    clearRound: true,
    render: false
  });

  return roadDiscoveryV86
    .stopMultiplayerMode(options);
};

leaveMultiplayerRoom = async function (
  options = {}
) {
  if (rd86HasConquestRound()) {
    await rd86LeaveConquestRound({
      quiet: true,
      render: false
    });
  }

  return roadDiscoveryV86
    .leaveMultiplayerRoom(options);
};

startHideSeekRound = async function () {
  if (hasActiveConquestRound()) {
    showToast(
      "Finish Road Conquest before starting another game"
    );
    return;
  }

  if (rd86HasConquestRound()) {
    rd86ResetConquestState({
      clearRound: true,
      render: false
    });
  }

  return roadDiscoveryV86
    .startHideSeekRound();
};

hs50OwnMarkerColour = function () {
  if (hasActiveConquestRound()) {
    return rd86TeamColour(
      state.conquest.viewerTeam
    );
  }

  return roadDiscoveryV86.markerColour();
};

hs50OwnMarkerHaloColour = function () {
  if (hasActiveConquestRound()) {
    return state.conquest.viewerTeam === "red"
      ? "rgba(255, 77, 77, 0.26)"
      : "rgba(75, 179, 255, 0.26)";
  }

  return roadDiscoveryV86
    .markerHaloColour();
};

function rd86InitConquest() {
  rd86EnsureConquestLayer();
  rd86BindConquestEvents();
  rd86RenderConquestState();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd86InitConquest,
    { once: true }
  );
} else {
  rd86InitConquest();
}

/* ================================================== */
/* Road Discovery AU v87 Custom Conquest Bots         */
/* Append this block once to the bottom of app.js v86 */
/* ================================================== */

const RD87_CUSTOM_MATCH_MAX_TEAM = 4;
const RD87_BOT_ROUTE_CONCURRENCY = 2;
const RD87_BOT_ROUTE_RETRY_MS = 15000;
const RD87_BOT_ROUTE_CACHE_MS = 10 * 60 * 1000;

const roadDiscoveryV87 = {
  applyConquestState: rd86ApplyConquestState,
  renderConquestState: rd86RenderConquestState,
  renderConquestPlayers: rd86RenderConquestPlayers,
  drawConquestTeammates: rd86DrawTeammates,
  conquestStatusText: rd86ConquestStatusText,
  maybeSendConquestLocation:
    rd86MaybeSendConquestLocation,
  resetConquestState: rd86ResetConquestState,
  leaveConquestRound: rd86LeaveConquestRound,
  showConquestResult: rd86ShowConquestResult,
  teamLabel: rd86TeamLabel,
  markerColour: hs50OwnMarkerColour,
  markerHaloColour: hs50OwnMarkerHaloColour
};

state.customConquest = {
  assignments: new Map(),
  redBots: 3,
  blueBots: 4,
  rosterSignature: "",
  selectedPreset: "play_4v4",
  starting: false,
  preparationText: "",

  routeRequests: [],
  routeActive: new Set(),
  routeRetryAt: new Map(),
  routeCache: new Map(),

  animationFrame: null,
  lastAnimationAt: 0,
  followBotId: null
};

state.conquest.matchType = "multiplayer";
state.conquest.viewerIsSpectator = false;
state.conquest.isMatchCreator = false;

function rd87CacheCustomConquestElements() {
  [
    "customConquestBox",
    "customConquestHostNote",
    "customConquestPresetWatchBtn",
    "customConquestPresetPlayBtn",
    "customConquestPresetChallengeBtn",
    "customConquestHumanList",
    "customConquestRedBots",
    "customConquestBlueBots",
    "customConquestSummary",
    "customConquestPreparationText",
    "startCustomConquestBtn",
    "endCustomConquestBtn",
    "conquestSpectatorHint"
  ].forEach((id) => {
    els[id] = $(id);
  });
}

function rd87IsRoomCreator() {
  return Boolean(
    state.auth.user?.id &&
    state.multiplayer.createdBy &&
    String(state.auth.user.id) ===
      String(state.multiplayer.createdBy)
  );
}

function rd87IsCustomConquest() {
  return (
    state.conquest.matchType === "custom"
  );
}

function rd87RoomMembers() {
  return Array.isArray(
    state.multiplayer.members
  )
    ? state.multiplayer.members.filter(
        (member) => member?.user_id
      )
    : [];
}

function rd87EnsureCustomAssignments() {
  const members = rd87RoomMembers();
  const activeIds = new Set(
    members.map((member) =>
      String(member.user_id)
    )
  );

  for (
    const userId of
    state.customConquest.assignments.keys()
  ) {
    if (!activeIds.has(userId)) {
      state.customConquest.assignments.delete(
        userId
      );
    }
  }

  for (const member of members) {
    const userId = String(member.user_id);

    if (
      !state.customConquest.assignments.has(
        userId
      )
    ) {
      const isMe =
        userId ===
        String(state.auth.user?.id || "");

      state.customConquest.assignments.set(
        userId,
        isMe ? "red" : "spectator"
      );
    }
  }
}

function rd87ResetHumansToSpectators() {
  rd87EnsureCustomAssignments();

  for (
    const userId of
    state.customConquest.assignments.keys()
  ) {
    state.customConquest.assignments.set(
      userId,
      "spectator"
    );
  }
}

function rd87ApplyCustomPreset(preset) {
  rd87ResetHumansToSpectators();

  const myUserId = String(
    state.auth.user?.id || ""
  );

  if (preset === "watch_4v4") {
    state.customConquest.redBots = 4;
    state.customConquest.blueBots = 4;

  } else if (preset === "four_vs_me") {
    state.customConquest.redBots = 4;
    state.customConquest.blueBots = 0;

    if (myUserId) {
      state.customConquest.assignments.set(
        myUserId,
        "blue"
      );
    }

  } else {
    state.customConquest.redBots = 3;
    state.customConquest.blueBots = 4;

    if (myUserId) {
      state.customConquest.assignments.set(
        myUserId,
        "red"
      );
    }

    preset = "play_4v4";
  }

  state.customConquest.selectedPreset = preset;

  rd87RenderCustomConquestLobby();
}

function rd87CustomRoster() {
  rd87EnsureCustomAssignments();

  const humans = [];
  let redHumans = 0;
  let blueHumans = 0;

  for (const member of rd87RoomMembers()) {
    const userId = String(member.user_id);

    const team =
      state.customConquest.assignments.get(
        userId
      ) || "spectator";

    if (team === "red" || team === "blue") {
      humans.push({
        user_id: userId,
        team
      });

      if (team === "red") {
        redHumans += 1;
      } else {
        blueHumans += 1;
      }
    }
  }

  const redBots = Number(
    state.customConquest.redBots
  );

  const blueBots = Number(
    state.customConquest.blueBots
  );

  const redTotal = redHumans + redBots;
  const blueTotal = blueHumans + blueBots;

  const errors = [];

  if (redTotal < 1 || blueTotal < 1) {
    errors.push(
      "Both teams need at least one participant."
    );
  }

  if (
    redTotal > RD87_CUSTOM_MATCH_MAX_TEAM ||
    blueTotal > RD87_CUSTOM_MATCH_MAX_TEAM
  ) {
    errors.push(
      "Each team can have a maximum of four humans and bots combined."
    );
  }

  return {
    humans,
    redHumans,
    blueHumans,
    redBots,
    blueBots,
    redTotal,
    blueTotal,
    errors,
    valid: errors.length === 0
  };
}

function rd87HumanAssignmentHtml(member) {
  const userId = String(member.user_id);

  const isMe =
    userId ===
    String(state.auth.user?.id || "");

  const team =
    state.customConquest.assignments.get(
      userId
    ) || "spectator";

  const name = escapeHtml(
    member.display_name || "Road rider"
  );

  return `
    <label class="custom-conquest-human-row">
      <span class="custom-conquest-human-name">
        ${name}${isMe ? " • You" : ""}
      </span>

      <select
        class="custom-conquest-team-select ${escapeHtml(team)}"
        data-custom-conquest-user="${escapeHtml(userId)}"
        aria-label="Choose team for ${name}"
      >
        <option
          value="spectator"
          ${team === "spectator" ? "selected" : ""}
        >
          Watch
        </option>

        <option
          value="red"
          ${team === "red" ? "selected" : ""}
        >
          Red
        </option>

        <option
          value="blue"
          ${team === "blue" ? "selected" : ""}
        >
          Blue
        </option>
      </select>
    </label>
  `;
}

function rd87RenderCustomConquestLobby() {
  rd87CacheCustomConquestElements();
  rd87EnsureCustomAssignments();

  if (!els.customConquestBox) return;

  const roomActive =
    hasActiveMultiplayerRoom();

  const activeGameBusy = Boolean(
    hasActiveHideSeekRound() ||
    hasActiveConquestRound() ||
    state.hideSeek.starting
  );

  const anotherConquestStarting = Boolean(
    state.conquest.starting &&
    !state.customConquest.starting
  );

  const isHost = rd87IsRoomCreator();
  const roster = rd87CustomRoster();

  els.customConquestBox.classList.toggle(
    "hidden",
    !roomActive ||
      activeGameBusy ||
      anotherConquestStarting
  );

  if (els.customConquestHostNote) {
    els.customConquestHostNote.textContent =
      isHost
        ? "Choose who plays, who watches and how many road-following bots are on each team."
        : "The room creator controls the Custom Conquest team setup.";
  }

  if (els.customConquestHumanList) {
    const members = rd87RoomMembers();

    els.customConquestHumanList.innerHTML =
      members.length > 0
        ? members
            .map(rd87HumanAssignmentHtml)
            .join("")
        : `
            <div class="empty-state">
              Room members appear here.
            </div>
          `;

    for (
      const select of
      els.customConquestHumanList.querySelectorAll(
        "[data-custom-conquest-user]"
      )
    ) {
      select.disabled = !isHost;
    }
  }

  if (els.customConquestRedBots) {
    els.customConquestRedBots.value =
      String(roster.redBots);

    els.customConquestRedBots.disabled =
      !isHost;
  }

  if (els.customConquestBlueBots) {
    els.customConquestBlueBots.value =
      String(roster.blueBots);

    els.customConquestBlueBots.disabled =
      !isHost;
  }

  const presetButtons = [
    [
      els.customConquestPresetWatchBtn,
      "watch_4v4"
    ],
    [
      els.customConquestPresetPlayBtn,
      "play_4v4"
    ],
    [
      els.customConquestPresetChallengeBtn,
      "four_vs_me"
    ]
  ];

  for (const [button, preset] of presetButtons) {
    if (!button) continue;

    button.disabled = !isHost;

    button.classList.toggle(
      "active",
      state.customConquest.selectedPreset ===
        preset
    );
  }

  if (els.customConquestSummary) {
    const summary =
      `RED ${roster.redTotal} vs BLUE ${roster.blueTotal}`;

    const humanCount =
      roster.redHumans + roster.blueHumans;

    const botCount =
      roster.redBots + roster.blueBots;

    const detail =
      roster.errors[0] ||
      `${humanCount} human${humanCount === 1 ? "" : "s"} • ` +
      `${botCount} bot${botCount === 1 ? "" : "s"}`;

    els.customConquestSummary.innerHTML = `
      <strong>${escapeHtml(summary)}</strong>
      <span>${escapeHtml(detail)}</span>
    `;

    els.customConquestSummary.classList.toggle(
      "invalid",
      !roster.valid
    );
  }

  if (els.customConquestPreparationText) {
    els.customConquestPreparationText.textContent =
      state.customConquest.preparationText ||
      (
        isHost
          ? "Bots follow real road routes and never paint or unlock roads."
          : "Waiting for the room creator."
      );
  }

  if (els.startCustomConquestBtn) {
    els.startCustomConquestBtn.disabled =
      !roomActive ||
      !isHost ||
      !roster.valid ||
      activeGameBusy ||
      anotherConquestStarting ||
      state.customConquest.starting;

    els.startCustomConquestBtn.textContent =
      state.customConquest.starting
        ? "Preparing Custom Conquest..."
        : "Start Custom Conquest";
  }
}

function rd87SetCustomBots(team, value) {
  const safeValue = Math.max(
    0,
    Math.min(4, Number(value) || 0)
  );

  if (team === "red") {
    state.customConquest.redBots = safeValue;
  } else {
    state.customConquest.blueBots = safeValue;
  }

  state.customConquest.selectedPreset = "custom";

  rd87RenderCustomConquestLobby();
}

function rd87CustomStartPoint(roster) {
  return getFreshRouteStartPoint()
    .then((point) => {
      if (
        point &&
        Number.isFinite(Number(point.lat)) &&
        Number.isFinite(Number(point.lng)) &&
        Number(point.accuracy) <=
          MAX_GPS_ACCURACY_M
      ) {
        return point;
      }

      if (roster.humans.length === 0) {
        const centre = state.map?.getCenter();

        if (centre) {
          return {
            lat: Number(centre.lat),
            lng: Number(centre.lng),
            accuracy: 0,
            timestamp: Date.now()
          };
        }
      }

      return null;
    })
    .catch(() => {
      if (roster.humans.length === 0) {
        const centre = state.map?.getCenter();

        if (centre) {
          return {
            lat: Number(centre.lat),
            lng: Number(centre.lng),
            accuracy: 0,
            timestamp: Date.now()
          };
        }
      }

      return null;
    });
}

async function rd87StartCustomConquest() {
  if (
    !hasActiveMultiplayerRoom() ||
    !state.auth.client ||
    !state.auth.user ||
    !rd87IsRoomCreator() ||
    state.customConquest.starting ||
    hasActiveConquestRound()
  ) {
    return;
  }

  if (hasActiveHideSeekRound()) {
    showToast(
      "Finish Hide & Seek before starting Custom Conquest"
    );

    return;
  }

  const roster = rd87CustomRoster();

  if (!roster.valid) {
    showToast(
      roster.errors[0] ||
      "Choose a valid Red and Blue roster"
    );

    return;
  }

  const safetyAccepted = window.confirm(
    "Play safely. Follow all road rules. Do not speed. " +
    "Do not stop somewhere dangerous. Set up the game " +
    "before moving and never interact with the phone while " +
    "riding or driving.\n\nStart Custom Conquest?"
  );

  if (!safetyAccepted) return;

  if (rd86HasConquestRound()) {
    rd86ResetConquestState({
      clearRound: true,
      render: false
    });
  }

  state.customConquest.starting = true;
  state.conquest.starting = true;

  state.customConquest.preparationText =
    "Choosing the game centre...";

  renderMultiplayerState();

  try {
    const startPoint =
      await rd87CustomStartPoint(roster);

    if (!startPoint) {
      throw new Error(
        "A playing human needs GPS accuracy of 35 metres or better before starting."
      );
    }

    state.customConquest.preparationText =
      "Loading nearby road points...";

    renderMultiplayerState();

    const roadsReady =
      await ensureRoadsNearPoint(
        startPoint,
        {
          replaceIfFar: true,
          quiet: false
        }
      );

    if (
      !roadsReady ||
      state.roadSegments.length === 0
    ) {
      throw new Error(
        "Could not load nearby roads for Custom Conquest."
      );
    }

    state.customConquest.preparationText =
      "Building the Custom Conquest arena...";

    renderMultiplayerState();

    const candidates =
      rd86BuildConquestCandidates(
        startPoint
      );

    if (
      candidates.length <
      RD86_CONQUEST_MIN_CANDIDATES
    ) {
      throw new Error(
        "Not enough suitable roads were found. Move to a road-dense area or move the map and try again."
      );
    }

    state.customConquest.preparationText =
      "Checking that game locations are reachable...";

    renderMultiplayerState();

    const routeable =
      await rd86FilterRouteableCandidates(
        startPoint,
        candidates
      );

    if (
      routeable.length <
      RD86_CONQUEST_MIN_CANDIDATES
    ) {
      throw new Error(
        "Not enough reachable locations were found. Try another area."
      );
    }

    state.customConquest.preparationText =
      "Creating humans, bots and private teams...";

    renderMultiplayerState();

    const { data, error } =
      await state.auth.client.rpc(
        "start_custom_conquest_round",
        {
          p_room_id:
            state.multiplayer.roomId,

          p_start_lat:
            Number(startPoint.lat),

          p_start_lng:
            Number(startPoint.lng),

          p_road_candidates:
            routeable.map(
              (candidate) => ({
                lat: candidate.lat,
                lng: candidate.lng,
                road_count:
                  candidate.road_count,
                routeable: true
              })
            ),

          p_human_teams:
            roster.humans,

          p_red_bots:
            roster.redBots,

          p_blue_bots:
            roster.blueBots,

          p_safety_ack: true
        }
      );

    if (error) throw error;

    const roundId = Array.isArray(data)
      ? data[0]
      : data;

    if (!roundId) {
      throw new Error(
        "Could not read the new Custom Conquest match."
      );
    }

    state.conquest.roundId =
      String(roundId);

    state.customConquest.preparationText = "";

    clearMultiplayerMarkers();

    await rd86PollConquestState({
      force: true
    });

    showToast(
      roster.humans.length === 0
        ? "4v4 bot match started • Spectator view"
        : `Custom Conquest started • Red ${roster.redTotal} vs Blue ${roster.blueTotal}`
    );

  } catch (error) {
    console.error(error);

    const message =
      rd86ConquestErrorMessage(error);

    state.customConquest.preparationText =
      message;

    showToast(message);

  } finally {
    state.customConquest.starting = false;
    state.conquest.starting = false;

    renderMultiplayerState();
  }
}


/* -------------------------------------------------- */
/* Bot road routing                                   */
/* -------------------------------------------------- */

function rd87BotRouteCacheKey(request) {
  return [
    Number(request.start_lat).toFixed(4),
    Number(request.start_lng).toFixed(4),
    Number(request.target_lat).toFixed(4),
    Number(request.target_lng).toFixed(4)
  ].join(":");
}

function rd87DecimateRouteCoordinates(coords) {
  if (coords.length <= 220) {
    return coords;
  }

  const result = [coords[0]];

  const step =
    (coords.length - 1) / 218;

  for (
    let index = 1;
    index < 219;
    index += 1
  ) {
    result.push(
      coords[
        Math.min(
          coords.length - 2,
          Math.round(index * step)
        )
      ]
    );
  }

  result.push(
    coords[coords.length - 1]
  );

  return result;
}

function rd87RoutePayload(route) {
  const coords =
    rd87DecimateRouteCoordinates(
      Array.isArray(route?.coords)
        ? route.coords
        : []
    );

  if (coords.length < 2) return [];

  const distances = [0];
  let total = 0;

  for (
    let index = 1;
    index < coords.length;
    index += 1
  ) {
    total += haversine(
      {
        lat:
          Number(coords[index - 1][0]),
        lng:
          Number(coords[index - 1][1])
      },
      {
        lat:
          Number(coords[index][0]),
        lng:
          Number(coords[index][1])
      }
    );

    distances.push(total);
  }

  if (
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return [];
  }

  return coords.map(
    (coord, index) => ({
      lat:
        Number(
          Number(coord[0]).toFixed(6)
        ),

      lng:
        Number(
          Number(coord[1]).toFixed(6)
        ),

      progress:
        Number(
          (
            distances[index] / total
          ).toFixed(6)
        )
    })
  );
}

async function rd87FetchBotRoadRoute(
  request
) {
  const key =
    rd87BotRouteCacheKey(request);

  const cached =
    state.customConquest.routeCache.get(
      key
    );

  if (
    cached &&
    Date.now() - cached.savedAt <
      RD87_BOT_ROUTE_CACHE_MS
  ) {
    return cached.route;
  }

  const route = await fetchRoadRoute(
    {
      lat: Number(request.start_lat),
      lng: Number(request.start_lng)
    },
    {
      lat: Number(request.target_lat),
      lng: Number(request.target_lng)
    }
  );

  state.customConquest.routeCache.set(
    key,
    {
      savedAt: Date.now(),
      route
    }
  );

  return route;
}

async function rd87SupplyOneBotRoute(
  request
) {
  const requestKey =
    `${request.bot_id}:${request.target_version}`;

  state.customConquest.routeActive.add(
    requestKey
  );

  try {
    const route =
      await rd87FetchBotRoadRoute(
        request
      );

    const routePoints =
      rd87RoutePayload(route);

    if (routePoints.length < 2) {
      throw new Error(
        "Road route contained too few points"
      );
    }

    const { data, error } =
      await state.auth.client.rpc(
        "set_conquest_bot_route",
        {
          p_round_id:
            state.conquest.roundId,

          p_bot_id:
            request.bot_id,

          p_target_version:
            Number(
              request.target_version
            ),

          p_route_points:
            routePoints,

          p_duration_seconds:
            Math.max(
              1,
              Number(route.durationS)
            ),

          p_distance_m:
            Math.max(
              25,
              Number(route.distanceM)
            )
        }
      );

    if (error) throw error;

    if (data === false) {
      return;
    }

    state.customConquest.routeRetryAt.delete(
      requestKey
    );

  } catch (error) {
    console.error(
      `Could not route ${
        request.display_name ||
        "Road Bot"
      }`,
      error
    );

    state.customConquest.routeRetryAt.set(
      requestKey,
      Date.now() +
        RD87_BOT_ROUTE_RETRY_MS
    );

  } finally {
    state.customConquest.routeActive.delete(
      requestKey
    );

    window.setTimeout(() => {
      if (rd87IsCustomConquest()) {
        void rd86PollConquestState({
          force: true
        });
      }
    }, 250);
  }
}

function rd87ProcessBotRouteRequests() {
  if (
    !rd87IsCustomConquest() ||
    !hasActiveConquestRound() ||
    !state.auth.client ||
    !navigator.onLine
  ) {
    return;
  }

  const requests = Array.isArray(
    state.customConquest.routeRequests
  )
    ? state.customConquest.routeRequests
    : [];

  let availableSlots =
    RD87_BOT_ROUTE_CONCURRENCY -
    state.customConquest.routeActive.size;

  if (availableSlots <= 0) return;

  for (const request of requests) {
    if (availableSlots <= 0) break;

    const requestKey =
      `${request.bot_id}:${request.target_version}`;

    if (
      state.customConquest.routeActive.has(
        requestKey
      ) ||
      Number(
        state.customConquest.routeRetryAt.get(
          requestKey
        ) || 0
      ) > Date.now()
    ) {
      continue;
    }

    availableSlots -= 1;

    void rd87SupplyOneBotRoute(
      request
    );
  }
}


/* -------------------------------------------------- */
/* Smooth visible bot movement                        */
/* -------------------------------------------------- */

function rd87NormaliseRoutePoints(value) {
  return rd86NormaliseJsonArray(value)
    .map((point) => ({
      lat: Number(point?.lat),
      lng: Number(point?.lng),
      progress: Number(point?.progress)
    }))
    .filter(
      (point) =>
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng) &&
        Number.isFinite(point.progress)
    );
}

function rd87VisibleBotPosition(player) {
  const fallback = {
    lat: Number(player?.lat),
    lng: Number(player?.lng)
  };

  const routePoints =
    rd87NormaliseRoutePoints(
      player?.route_points
    );

  const startedAt = Date.parse(
    player?.route_started_at || ""
  );

  const durationMs =
    Number(
      player?.route_duration_seconds
    ) * 1000;

  if (
    routePoints.length < 2 ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return fallback;
  }

  const fraction = Math.max(
    0,
    Math.min(
      1,
      (
        rd86ConquestServerNow() -
        startedAt
      ) / durationMs
    )
  );

  let before = routePoints[0];

  let after =
    routePoints[
      routePoints.length - 1
    ];

  for (
    let index = 1;
    index < routePoints.length;
    index += 1
  ) {
    if (
      routePoints[index].progress >=
        fraction
    ) {
      after = routePoints[index];
      before = routePoints[index - 1];
      break;
    }
  }

  const span =
    after.progress - before.progress;

  const localFraction =
    span > 0
      ? Math.max(
          0,
          Math.min(
            1,
            (
              fraction -
              before.progress
            ) / span
          )
        )
      : 0;

  return {
    lat:
      before.lat +
      (
        after.lat - before.lat
      ) * localFraction,

    lng:
      before.lng +
      (
        after.lng - before.lng
      ) * localFraction
  };
}

function rd87ConquestParticipantIcon(
  team,
  isBot
) {
  return L.divIcon({
    className:
      "multiplayer-dot-icon conquest-teammate-icon",

    html: isBot
      ? `
          <div class="conquest-bot-dot ${team}">
            <span>BOT</span>
          </div>
        `
      : `
          <div class="conquest-teammate-dot ${team}"></div>
        `,

    iconSize:
      isBot ? [32, 32] : [26, 26],

    iconAnchor:
      isBot ? [16, 16] : [13, 13]
  });
}

rd86DrawTeammates = function () {
  rd86EnsureConquestLayer();

  const seen = new Set();

  for (
    const player of
    state.conquest.players
  ) {
    const participantId = String(
      player?.user_id || ""
    );

    const isBot =
      Boolean(player?.is_bot);

    const sameTeam =
      player?.team ===
      state.conquest.viewerTeam;

    const visibleParticipant =
      state.conquest.viewerIsSpectator
        ? isBot
        : sameTeam && !player?.is_me;

    if (
      !participantId ||
      !visibleParticipant ||
      player?.player_status !== "active"
    ) {
      continue;
    }

    const position = isBot
      ? rd87VisibleBotPosition(player)
      : {
          lat: Number(player?.lat),
          lng: Number(player?.lng)
        };

    if (
      !Number.isFinite(position.lat) ||
      !Number.isFinite(position.lng)
    ) {
      continue;
    }

    seen.add(participantId);

    const team =
      player?.team === "red"
        ? "red"
        : "blue";

    const targetText =
      isBot && player?.target_label
        ? ` • ${player.target_label}`
        : "";

    const tooltip =
      `${escapeHtml(
        player?.display_name ||
        (
          isBot
            ? "Road Bot"
            : "Teammate"
        )
      )} • ${rd86TeamLabel(team)}${escapeHtml(targetText)}`;

    const existing =
      state.conquest.teammateMarkers.get(
        participantId
      );

    if (existing) {
      existing.setLatLng([
        position.lat,
        position.lng
      ]);

      existing.setIcon(
        rd87ConquestParticipantIcon(
          team,
          isBot
        )
      );

      existing.setTooltipContent(
        tooltip
      );

    } else {
      const marker = L.marker(
        [
          position.lat,
          position.lng
        ],
        {
          icon:
            rd87ConquestParticipantIcon(
              team,
              isBot
            ),

          pane: "multiplayerPane",
          interactive: isBot,
          keyboard: false
        }
      ).addTo(
        state.conquest.layer
      );

      marker.bindTooltip(
        tooltip,
        {
          sticky: true
        }
      );

      if (isBot) {
        marker.on("click", () => {
          state.customConquest.followBotId =
            participantId;

          state.followUser = false;

          rd86FocusPoint(position);

          showToast(
            `Following ${
              player.display_name ||
              "Road Bot"
            } • tap My Location to return`
          );
        });
      }

      marker.rd87Player = player;

      state.conquest.teammateMarkers.set(
        participantId,
        marker
      );
    }

    const marker =
      state.conquest.teammateMarkers.get(
        participantId
      );

    if (marker) {
      marker.rd87Player = player;
    }
  }

  for (
    const [participantId, marker] of
    state.conquest.teammateMarkers.entries()
  ) {
    if (!seen.has(participantId)) {
      rd86ClearLayerItem(marker);

      state.conquest.teammateMarkers.delete(
        participantId
      );
    }
  }

  rd87EnsureBotAnimation();
};

function rd87AnimateVisibleBots(timestamp) {
  state.customConquest.animationFrame = null;

  if (
    !rd87IsCustomConquest() ||
    !rd86HasConquestRound()
  ) {
    return;
  }

  if (
    timestamp -
      state.customConquest.lastAnimationAt >=
    100
  ) {
    state.customConquest.lastAnimationAt =
      timestamp;

    for (
      const [participantId, marker] of
      state.conquest.teammateMarkers.entries()
    ) {
      const player =
        marker.rd87Player;

      if (!player?.is_bot) continue;

      const position =
        rd87VisibleBotPosition(player);

      if (
        Number.isFinite(position.lat) &&
        Number.isFinite(position.lng)
      ) {
        marker.setLatLng([
          position.lat,
          position.lng
        ]);

        if (
          state.customConquest.followBotId ===
            participantId &&
          state.map
        ) {
          state.map.panTo(
            [
              position.lat,
              position.lng
            ],
            {
              animate: false
            }
          );
        }
      }
    }
  }

  state.customConquest.animationFrame =
    window.requestAnimationFrame(
      rd87AnimateVisibleBots
    );
}

function rd87EnsureBotAnimation() {
  if (
    state.customConquest.animationFrame ===
      null &&
    rd87IsCustomConquest() &&
    rd86HasConquestRound()
  ) {
    state.customConquest.animationFrame =
      window.requestAnimationFrame(
        rd87AnimateVisibleBots
      );
  }
}

function rd87StopBotAnimation() {
  if (
    state.customConquest.animationFrame !==
      null
  ) {
    window.cancelAnimationFrame(
      state.customConquest.animationFrame
    );

    state.customConquest.animationFrame =
      null;
  }

  state.customConquest.followBotId = null;
}


/* -------------------------------------------------- */
/* Existing Conquest integration                      */
/* -------------------------------------------------- */

rd86TeamLabel = function (team) {
  if (team === "spectator") {
    return "Spectator";
  }

  return roadDiscoveryV87.teamLabel(
    team
  );
};

rd86ConquestStatusText = function () {
  if (
    rd87IsCustomConquest() &&
    state.conquest.viewerIsSpectator
  ) {
    if (
      state.conquest.phase ===
      "deployment"
    ) {
      return (
        "Spectator view • Bots are following roads to their private team starts."
      );
    }

    if (
      state.conquest.phase ===
      "countdown"
    ) {
      return (
        "All active participants are ready. The bot match begins at zero."
      );
    }

    if (
      state.conquest.phase === "active"
    ) {
      return (
        "Spectator view • Tap a bot to follow it or tap A, B, C, D, E and caches to focus them."
      );
    }

    if (
      state.conquest.phase ===
      "overtime"
    ) {
      return (
        "Spectator view • The next capture or Road Cache wins."
      );
    }
  }

  return roadDiscoveryV87
    .conquestStatusText();
};

rd86ApplyConquestState = function (row) {
  state.conquest.matchType = String(
    row?.match_type || "multiplayer"
  );

  state.conquest.viewerIsSpectator =
    Boolean(
      row?.viewer_is_spectator
    );

  state.conquest.isMatchCreator =
    Boolean(
      row?.is_match_creator
    );

  state.customConquest.routeRequests =
    rd86NormaliseJsonArray(
      row?.bot_route_requests
    );

  const compatibleRow =
    state.conquest.viewerIsSpectator
      ? {
          ...row,
          viewer_team: "spectator",
          viewer_checked_in: true
        }
      : row;

  roadDiscoveryV87.applyConquestState(
    compatibleRow
  );

  rd87RenderCustomConquestLobby();
  rd87ProcessBotRouteRequests();
  rd87EnsureBotAnimation();
};

rd86RenderConquestPlayers = function () {
  roadDiscoveryV87
    .renderConquestPlayers();

  if (!els.conquestPlayersList) return;

  for (
    const row of
    els.conquestPlayersList.querySelectorAll(
      ".conquest-player-row"
    )
  ) {
    const name =
      row.querySelector(
        ".conquest-player-main strong"
      );

    if (
      name &&
      /Road Bot/i.test(
        name.textContent || ""
      )
    ) {
      row.classList.add("bot");
    }
  }
};

rd86RenderConquestState = function () {
  roadDiscoveryV87
    .renderConquestState();

  rd87CacheCustomConquestElements();
  rd87RenderCustomConquestLobby();

  const spectator = Boolean(
    rd87IsCustomConquest() &&
    state.conquest.viewerIsSpectator &&
    rd86HasConquestRound()
  );

  document.body.classList.toggle(
    "conquest-spectator",
    spectator
  );

  if (spectator) {
    if (els.conquestTeamBadge) {
      els.conquestTeamBadge.textContent =
        "Spectator";

      els.conquestTeamBadge.classList.remove(
        "red",
        "blue"
      );
    }

    if (els.conquestMapTeam) {
      els.conquestMapTeam.textContent =
        "Spectator";

      els.conquestMapTeam.classList.remove(
        "red",
        "blue"
      );
    }
  }

  if (els.conquestSpectatorHint) {
    els.conquestSpectatorHint.classList.toggle(
      "hidden",
      !spectator
    );
  }

  if (els.endCustomConquestBtn) {
    const showEndButton = Boolean(
      rd87IsCustomConquest() &&
      state.conquest.isMatchCreator &&
      hasActiveConquestRound()
    );

    els.endCustomConquestBtn.classList.toggle(
      "hidden",
      !showEndButton
    );
  }
};

rd86MaybeSendConquestLocation =
  async function (
    point,
    options = {}
  ) {
    if (
      rd87IsCustomConquest() &&
      state.conquest.viewerIsSpectator
    ) {
      return false;
    }

    return roadDiscoveryV87
      .maybeSendConquestLocation(
        point,
        options
      );
  };

rd86ResetConquestState = function (
  options = {}
) {
  rd87StopBotAnimation();

  state.customConquest.routeRequests = [];

  state.customConquest.routeActive.clear();

  state.customConquest.routeRetryAt.clear();

  state.conquest.matchType =
    "multiplayer";

  state.conquest.viewerIsSpectator =
    false;

  state.conquest.isMatchCreator =
    false;

  document.body.classList.remove(
    "conquest-spectator"
  );

  return roadDiscoveryV87
    .resetConquestState(options);
};

async function rd87EndCustomConquest() {
  if (
    !rd87IsCustomConquest() ||
    !state.conquest.isMatchCreator ||
    !state.conquest.roundId ||
    !state.auth.client
  ) {
    return;
  }

  const confirmed = window.confirm(
    "End this Custom Conquest match for everyone?"
  );

  if (!confirmed) return;

  const { error } =
    await state.auth.client.rpc(
      "stop_custom_conquest_round",
      {
        p_round_id:
          state.conquest.roundId
      }
    );

  if (error) {
    console.error(error);

    showToast(
      rd86ConquestErrorMessage(error)
    );

    return;
  }

  rd86ResetConquestState({
    clearRound: true,
    render: true
  });

  showToast(
    "Custom Conquest ended"
  );
}

rd86LeaveConquestRound =
  async function (options = {}) {
    if (
      rd87IsCustomConquest() &&
      state.conquest.viewerIsSpectator &&
      state.conquest.isMatchCreator &&
      hasActiveConquestRound()
    ) {
      await rd87EndCustomConquest();
      return;
    }

    return roadDiscoveryV87
      .leaveConquestRound(options);
  };

rd86ShowConquestResult = function () {
  if (
    !(
      rd87IsCustomConquest() &&
      state.conquest.viewerIsSpectator
    )
  ) {
    return roadDiscoveryV87
      .showConquestResult();
  }

  const roundId = String(
    state.conquest.roundId || ""
  );

  if (
    !roundId ||
    state.conquest.resultShownFor ===
      roundId
  ) {
    return;
  }

  rd86CacheConquestElements();

  if (!els.conquestResultOverlay) return;

  state.conquest.resultShownFor =
    roundId;

  const winner =
    state.conquest.winner;

  const draw =
    winner === "draw";

  els.conquestResultOverlay.classList.remove(
    "hidden",
    "red",
    "blue",
    "draw",
    "victory",
    "defeat"
  );

  els.conquestResultOverlay.classList.add(
    draw ? "draw" : winner,
    "victory"
  );

  if (els.conquestResultEyebrow) {
    els.conquestResultEyebrow.textContent =
      "MATCH COMPLETE";
  }

  if (els.conquestResultTitle) {
    els.conquestResultTitle.textContent =
      draw
        ? "DRAW"
        : `${rd86TeamLabel(
            winner
          ).toUpperCase()} WINS`;
  }

  if (els.conquestResultScore) {
    els.conquestResultScore.textContent =
      `${state.conquest.redScore} – ${state.conquest.blueScore}`;
  }

  if (
    state.conquest.resultTimer !== null
  ) {
    window.clearTimeout(
      state.conquest.resultTimer
    );
  }

  state.conquest.resultTimer =
    window.setTimeout(() => {
      els.conquestResultOverlay
        ?.classList.add("hidden");

      state.conquest.resultTimer = null;
    }, 5000);
};

hs50OwnMarkerColour = function () {
  if (
    rd87IsCustomConquest() &&
    state.conquest.viewerIsSpectator
  ) {
    return "#eef7ff";
  }

  return roadDiscoveryV87
    .markerColour();
};

hs50OwnMarkerHaloColour = function () {
  if (
    rd87IsCustomConquest() &&
    state.conquest.viewerIsSpectator
  ) {
    return "rgba(238, 247, 255, 0.2)";
  }

  return roadDiscoveryV87
    .markerHaloColour();
};


/* -------------------------------------------------- */
/* Events and initialisation                          */
/* -------------------------------------------------- */

function rd87BindCustomConquestEvents() {
  rd87CacheCustomConquestElements();

  if (
    els.startCustomConquestBtn
      ?.dataset.rd87Bound === "true"
  ) {
    return;
  }

  if (els.startCustomConquestBtn) {
    els.startCustomConquestBtn
      .dataset.rd87Bound = "true";

    els.startCustomConquestBtn
      .addEventListener(
        "click",
        rd87StartCustomConquest
      );
  }

  els.customConquestPresetWatchBtn
    ?.addEventListener(
      "click",
      () => {
        rd87ApplyCustomPreset(
          "watch_4v4"
        );
      }
    );

  els.customConquestPresetPlayBtn
    ?.addEventListener(
      "click",
      () => {
        rd87ApplyCustomPreset(
          "play_4v4"
        );
      }
    );

  els.customConquestPresetChallengeBtn
    ?.addEventListener(
      "click",
      () => {
        rd87ApplyCustomPreset(
          "four_vs_me"
        );
      }
    );

  els.customConquestRedBots
    ?.addEventListener(
      "change",
      (event) => {
        rd87SetCustomBots(
          "red",
          event.target.value
        );
      }
    );

  els.customConquestBlueBots
    ?.addEventListener(
      "change",
      (event) => {
        rd87SetCustomBots(
          "blue",
          event.target.value
        );
      }
    );

  els.customConquestHumanList
    ?.addEventListener(
      "change",
      (event) => {
        const select =
          event.target.closest(
            "[data-custom-conquest-user]"
          );

        if (
          !select ||
          !rd87IsRoomCreator()
        ) {
          return;
        }

        const team = [
          "red",
          "blue",
          "spectator"
        ].includes(select.value)
          ? select.value
          : "spectator";

        state.customConquest
          .assignments.set(
            String(
              select.dataset
                .customConquestUser
            ),
            team
          );

        state.customConquest
          .selectedPreset = "custom";

        rd87RenderCustomConquestLobby();
      }
    );

  els.endCustomConquestBtn
    ?.addEventListener(
      "click",
      rd87EndCustomConquest
    );

  els.locateBtn
    ?.addEventListener(
      "click",
      () => {
        state.customConquest
          .followBotId = null;
      }
    );

  state.map?.on(
    "dragstart",
    () => {
      state.customConquest
        .followBotId = null;
    }
  );
}

function rd87InitCustomConquest() {
  rd87BindCustomConquestEvents();

  rd87ApplyCustomPreset(
    "play_4v4"
  );

  rd87RenderCustomConquestLobby();
}

if (
  document.readyState === "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    rd87InitCustomConquest,
    {
      once: true
    }
  );
} else {
  rd87InitCustomConquest();
}

/* ================================================== */
/* Road Discovery AU v89 Conquest Rally               */
/* Append this block once to the bottom of app.js v88 */
/* ================================================== */

const RD89_RALLY_PHASES = [
  "rally",
  "rally_grace",
  "rally_countdown"
];

const RD89_RALLY_COLOUR = "#aab3c2";

const roadDiscoveryV89 = {
  deadlineForPhase: rd86DeadlineForPhase,
  phaseLabel: rd86ConquestPhaseLabel,
  statusText: rd86ConquestStatusText,
  renderState: rd86RenderConquestState,
  renderPlayers: rd86RenderConquestPlayers,
  applyState: rd86ApplyConquestState,
  drawDeploymentStart: rd86DrawDeploymentStart,
  drawTeammates: rd86DrawTeammates,
  resetState: rd86ResetConquestState,
  markerColour: hs50OwnMarkerColour,
  markerHaloColour: hs50OwnMarkerHaloColour
};

state.conquest.rallyPoint = null;
state.conquest.rallyRadiusM = 100;
state.conquest.rallyEndsAt = null;
state.conquest.rallyGraceEndsAt = null;
state.conquest.rallyCountdownEndsAt = null;
state.conquest.rallyReadyCount = 0;
state.conquest.rallyTotal = 0;

function rd89IsRallyPhase(
  phase = state.conquest.phase
) {
  return RD89_RALLY_PHASES.includes(
    String(phase || "")
  );
}

hasActiveConquestRound = function () {
  return Boolean(
    state.conquest.roundId &&
    [
      ...RD89_RALLY_PHASES,
      "deployment",
      "countdown",
      "active",
      "overtime"
    ].includes(state.conquest.phase)
  );
};

/* -------------------------------------------------- */
/* Rally timer and phase wording                      */
/* -------------------------------------------------- */

rd86DeadlineForPhase = function () {
  if (
    state.conquest.phase === "rally"
  ) {
    return Date.parse(
      state.conquest.rallyEndsAt || ""
    );
  }

  if (
    state.conquest.phase === "rally_grace"
  ) {
    return Date.parse(
      state.conquest.rallyGraceEndsAt || ""
    );
  }

  if (
    state.conquest.phase ===
      "rally_countdown"
  ) {
    return Date.parse(
      state.conquest.rallyCountdownEndsAt ||
        ""
    );
  }

  return roadDiscoveryV89.deadlineForPhase();
};

rd86ConquestPhaseLabel = function () {
  if (
    state.conquest.phase === "rally"
  ) {
    return "Rally";
  }

  if (
    state.conquest.phase === "rally_grace"
  ) {
    return "Rally grace";
  }

  if (
    state.conquest.phase ===
      "rally_countdown"
  ) {
    return "Teams next";
  }

  return roadDiscoveryV89.phaseLabel();
};

rd86ConquestStatusText = function () {
  const ready =
    Number(
      state.conquest.rallyReadyCount
    ) || 0;

  const total =
    Number(
      state.conquest.rallyTotal
    ) || 0;

  if (
    rd89IsRallyPhase() &&
    state.conquest.viewerIsSpectator
  ) {
    if (
      state.conquest.phase ===
        "rally_countdown"
    ) {
      return (
        "Rally complete • Teams deploy " +
        "in 10 seconds."
      );
    }

    return (
      `Spectator view • ${ready} of ${total} ` +
      "participants assembled at Rally."
    );
  }

  if (
    state.conquest.phase === "rally"
  ) {
    return state.conquest.viewerCheckedIn
      ? (
          `${ready} of ${total} assembled • ` +
          "Waiting at Rally."
        )
      : (
          `${ready} of ${total} assembled • ` +
          "Reach the grey Rally area."
        );
  }

  if (
    state.conquest.phase === "rally_grace"
  ) {
    return state.conquest.viewerCheckedIn
      ? (
          `${ready} of ${total} assembled • ` +
          "Final Rally grace."
        )
      : (
          "Final Rally grace • Reach the " +
          "grey area now."
        );
  }

  if (
    state.conquest.phase ===
      "rally_countdown"
  ) {
    return (
      "Rally complete • Red and Blue " +
      "starting areas appear when the " +
      "countdown reaches zero."
    );
  }

  if (
    state.conquest.phase === "deployment"
  ) {
    if (
      state.conquest.viewerIsSpectator
    ) {
      return (
        "Spectator view • One Red and one " +
        "Blue rider must reach their team starts."
      );
    }

    return state.conquest.viewerCheckedIn
      ? (
          "Your team start is reached • " +
          "Waiting for the other team."
        )
      : (
          `Reach the ${rd86TeamLabel(
            state.conquest.viewerTeam
          )} start • One rider from each ` +
          "team is enough."
        );
  }

  if (
    state.conquest.phase === "countdown"
  ) {
    return (
      "Objectives A, B, C, D and E " +
      "appear at zero."
    );
  }

  if (
    state.conquest.phase === "active"
  ) {
    return state.conquest.viewerIsSpectator
      ? (
          "Spectator view • Tap a bot, A–E, " +
          "or a Road Cache to follow the action."
        )
      : (
          "Capture A–E. Owned objectives score " +
          "every three seconds. Collect Road " +
          "Caches for bonuses."
        );
  }

  return roadDiscoveryV89.statusText();
};

/* -------------------------------------------------- */
/* Neutral Rally marker and area                      */
/* -------------------------------------------------- */

function rd89RallyIcon() {
  return L.divIcon({
    className:
      "conquest-rally-marker-icon",

    html: `
      <div class="conquest-rally-marker">
        <strong>RALLY</strong>
        <span>MEET HERE</span>
      </div>
    `,

    iconSize: [72, 50],
    iconAnchor: [36, 25]
  });
}

rd86DrawDeploymentStart = function () {
  if (!rd89IsRallyPhase()) {
    roadDiscoveryV89
      .drawDeploymentStart();

    return;
  }

  rd86EnsureConquestLayer();
  rd86ClearConquestRoute();

  const point =
    state.conquest.rallyPoint;

  if (!point) {
    rd86ClearLayerItem(
      state.conquest.startCircle
    );

    rd86ClearLayerItem(
      state.conquest.startMarker
    );

    state.conquest.startCircle = null;
    state.conquest.startMarker = null;

    return;
  }

  const latlng = [
    point.lat,
    point.lng
  ];

  if (!state.conquest.startCircle) {
    state.conquest.startCircle =
      L.circle(latlng, {
        radius:
          state.conquest.rallyRadiusM,

        color: RD89_RALLY_COLOUR,
        weight: 3,
        opacity: 0.95,

        fillColor: RD89_RALLY_COLOUR,
        fillOpacity: 0.14,

        dashArray: "10 8",
        interactive: false
      }).addTo(state.conquest.layer);
  } else {
    state.conquest.startCircle
      .setLatLng(latlng)
      .setRadius(
        state.conquest.rallyRadiusM
      )
      .setStyle({
        color: RD89_RALLY_COLOUR,
        fillColor: RD89_RALLY_COLOUR
      });
  }

  if (!state.conquest.startMarker) {
    state.conquest.startMarker =
      L.marker(latlng, {
        icon: rd89RallyIcon(),
        pane: "multiplayerPane",
        interactive: false
      }).addTo(state.conquest.layer);
  } else {
    state.conquest.startMarker
      .setLatLng(latlng)
      .setIcon(rd89RallyIcon());
  }
};

/* -------------------------------------------------- */
/* Rally participant list                             */
/* -------------------------------------------------- */

rd86RenderConquestPlayers = function () {
  if (!rd89IsRallyPhase()) {
    roadDiscoveryV89.renderPlayers();
    return;
  }

  if (!els.conquestPlayersList) {
    return;
  }

  const players =
    Array.isArray(
      state.conquest.players
    )
      ? state.conquest.players
      : [];

  if (players.length === 0) {
    els.conquestPlayersList.innerHTML = `
      <div class="empty-state">
        Waiting for Rally participants.
      </div>
    `;

    return;
  }

  els.conquestPlayersList.innerHTML =
    players
      .map((player) => {
        const active =
          player?.player_status ===
          "active";

        const status = !active
          ? "Left"
          : player?.checked_in
            ? "Assembled"
            : "Travelling";

        const botClass =
          player?.is_bot
            ? " bot"
            : "";

        const fallbackName =
          player?.is_bot
            ? "Road Bot"
            : "Rider";

        return `
          <div class="conquest-player-row neutral${botClass}">
            <span
              class="conquest-player-dot neutral"
              aria-hidden="true"
            ></span>

            <div class="conquest-player-main">
              <strong>
                ${escapeHtml(
                  player?.display_name ||
                  fallbackName
                )}${player?.is_me ? " • You" : ""}
              </strong>

              <span>
                Rally participant
              </span>
            </div>

            <span class="conquest-player-state">
              ${escapeHtml(status)}
            </span>
          </div>
        `;
      })
      .join("");
};

/* -------------------------------------------------- */
/* Neutral participant dots during Rally              */
/* -------------------------------------------------- */

function rd89RallyParticipantIcon(
  isBot
) {
  return L.divIcon({
    className:
      "multiplayer-dot-icon " +
      "conquest-teammate-icon",

    html: isBot
      ? `
          <div class="conquest-rally-bot-dot">
            <span>BOT</span>
          </div>
        `
      : `
          <div class="conquest-rally-player-dot"></div>
        `,

    iconSize:
      isBot
        ? [32, 32]
        : [26, 26],

    iconAnchor:
      isBot
        ? [16, 16]
        : [13, 13]
  });
}

rd86DrawTeammates = function () {
  if (!rd89IsRallyPhase()) {
    roadDiscoveryV89.drawTeammates();
    return;
  }

  rd86EnsureConquestLayer();

  const seen = new Set();

  for (
    const player of
    state.conquest.players
  ) {
    const participantId =
      String(
        player?.user_id || ""
      );

    const isBot =
      Boolean(player?.is_bot);

    if (
      !participantId ||
      player?.is_me ||
      player?.player_status !==
        "active" ||
      (
        state.conquest
          .viewerIsSpectator &&
        !isBot
      )
    ) {
      continue;
    }

    const lat =
      Number(player?.lat);

    const lng =
      Number(player?.lng);

    if (
      player?.lat === null ||
      player?.lng === null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      continue;
    }

    seen.add(participantId);

    const fallbackName =
      isBot
        ? "Road Bot"
        : "Rider";

    const tooltip =
      `${escapeHtml(
        player?.display_name ||
        fallbackName
      )} • Rally`;

    const existing =
      state.conquest
        .teammateMarkers
        .get(participantId);

    if (existing) {
      existing.setLatLng([
        lat,
        lng
      ]);

      existing.setIcon(
        rd89RallyParticipantIcon(
          isBot
        )
      );

      existing.setTooltipContent(
        tooltip
      );
    } else {
      const marker =
        L.marker(
          [lat, lng],
          {
            icon:
              rd89RallyParticipantIcon(
                isBot
              ),

            pane: "multiplayerPane",
            interactive: false,
            keyboard: false
          }
        ).addTo(
          state.conquest.layer
        );

      marker.bindTooltip(
        tooltip,
        {
          sticky: true
        }
      );

      state.conquest
        .teammateMarkers
        .set(
          participantId,
          marker
        );
    }
  }

  for (
    const [
      participantId,
      marker
    ] of
    state.conquest
      .teammateMarkers
      .entries()
  ) {
    if (!seen.has(participantId)) {
      rd86ClearLayerItem(marker);

      state.conquest
        .teammateMarkers
        .delete(participantId);
    }
  }
};

/* -------------------------------------------------- */
/* Rally HUD                                          */
/* -------------------------------------------------- */

rd86RenderConquestState = function () {
  roadDiscoveryV89.renderState();

  const rally =
    rd89IsRallyPhase();

  const spectator =
    Boolean(
      state.conquest
        .viewerIsSpectator
    );

  document.body.classList.toggle(
    "conquest-rally-active",
    rally
  );

  if (!rally) {
    return;
  }

  document.body.classList.remove(
    "conquest-red-team",
    "conquest-blue-team"
  );

  for (
    const badge of [
      els.conquestTeamBadge,
      els.conquestMapTeam
    ]
  ) {
    if (!badge) {
      continue;
    }

    badge.textContent =
      spectator
        ? "Spectator"
        : "Rally";

    badge.classList.remove(
      "red",
      "blue"
    );
  }
};

/* -------------------------------------------------- */
/* Apply Rally state                                  */
/* -------------------------------------------------- */

rd86ApplyConquestState = function (
  row
) {
  const previousRoundId =
    String(
      state.conquest.roundId || ""
    );

  const previousRallyReady =
    Boolean(
      state.conquest
        .viewerCheckedIn
    );

  const nextPhase =
    String(row?.phase || "");

  const nextIsRally =
    rd89IsRallyPhase(
      nextPhase
    );

  const rallyLat =
    Number(row?.rally_lat);

  const rallyLng =
    Number(row?.rally_lng);

  state.conquest.rallyPoint =
    Number.isFinite(rallyLat) &&
    Number.isFinite(rallyLng)
      ? {
          lat: rallyLat,
          lng: rallyLng
        }
      : null;

  state.conquest.rallyRadiusM =
    Number(
      row?.rally_radius_m
    ) || 100;

  state.conquest.rallyEndsAt =
    row?.rally_ends_at || null;

  state.conquest.rallyGraceEndsAt =
    row?.rally_grace_ends_at ||
    null;

  state.conquest
    .rallyCountdownEndsAt =
      row?.rally_countdown_ends_at ||
      null;

  state.conquest.rallyReadyCount =
    Number(
      row?.rally_ready_count
    ) || 0;

  state.conquest.rallyTotal =
    Number(
      row?.rally_total
    ) || 0;

  /*
    This prevents the old team-start
    notification from being used when
    somebody enters the Rally area.
  */
  if (nextIsRally) {
    state.conquest.viewerCheckedIn =
      Boolean(
        row?.viewer_checked_in
      );
  }

  /*
    Keep teams hidden during Rally.
    Final teams appear after Rally has
    completed and deployment begins.
  */
  const compatibleRow =
    nextIsRally
      ? {
          ...row,

          viewer_team: "",

          players:
            rd86NormaliseJsonArray(
              row?.players
            ).map((player) => ({
              ...player,
              team: "neutral"
            }))
        }
      : row;

  /*
    Suppress the older early
    team-assignment notification.
  */
  if (
    nextIsRally &&
    previousRoundId !==
      String(row?.round_id || "")
  ) {
    state.conquest.roundId =
      String(
        row?.round_id || ""
      );
  }

  roadDiscoveryV89.applyState(
    compatibleRow
  );

  if (
    nextIsRally &&
    previousRoundId !==
      state.conquest.roundId
  ) {
    showToast(
      "Road Conquest Rally started"
    );
  }

  if (
    nextIsRally &&
    !state.conquest
      .viewerIsSpectator &&
    !previousRallyReady &&
    state.conquest.viewerCheckedIn
  ) {
    showToast(
      "Rally reached • Assembled"
    );
  }
};

/* -------------------------------------------------- */
/* Rally-aware state polling                          */
/* -------------------------------------------------- */

rd86PollConquestState =
  async function (
    options = {}
  ) {
    const force =
      options.force === true;

    if (
      !hasActiveMultiplayerRoom() ||
      !state.auth.client ||
      !state.auth.user ||
      state.conquest.polling ||
      (
        !force &&
        !navigator.onLine
      )
    ) {
      return;
    }

    state.conquest.polling = true;

    const { data, error } =
      await state.auth.client.rpc(
        "get_conquest_state_v2",
        {
          p_room_id:
            state.multiplayer.roomId
        }
      );

    state.conquest.polling = false;

    if (error) {
      console.error(error);

      state.conquest
        .unavailableMessage =
          rd86ConquestErrorMessage(
            error
          );

      rd86RenderConquestState();

      return;
    }

    const row =
      Array.isArray(data)
        ? data[0] || null
        : data || null;

    if (!row) {
      if (
        !state.conquest.starting
      ) {
        rd86ResetConquestState({
          clearRound: true,
          render: false
        });

        rd86RenderConquestState();
      }

      return;
    }

    if (
      hasActiveHideSeekRound() &&
      [
        "finished",
        "cancelled"
      ].includes(
        String(row?.phase || "")
      )
    ) {
      rd86ResetConquestState({
        clearRound: true,
        render: false
      });

      return;
    }

    rd86ApplyConquestState(row);
  };

/* -------------------------------------------------- */
/* Rally-aware GPS updates                            */
/* -------------------------------------------------- */

rd86MaybeSendConquestLocation =
  async function (
    point,
    options = {}
  ) {
    const force =
      options.force === true;

    if (
      state.conquest
        .viewerIsSpectator ||
      !hasActiveConquestRound() ||
      !state.auth.client ||
      !state.auth.user ||
      !navigator.onLine ||
      !point ||
      !Number.isFinite(
        Number(point.lat)
      ) ||
      !Number.isFinite(
        Number(point.lng)
      ) ||
      !Number.isFinite(
        Number(point.accuracy)
      )
    ) {
      return false;
    }

    rd86MaybeUpdateDeploymentRoute(
      point
    );

    const now = Date.now();

    if (
      !force &&
      now -
        state.conquest
          .lastLocationSentAt <
        RD86_CONQUEST_LOCATION_SEND_MS
    ) {
      return false;
    }

    if (
      state.conquest
        .updatingLocation
    ) {
      return false;
    }

    state.conquest
      .lastLocationSentAt = now;

    state.conquest
      .updatingLocation = true;

    const { data, error } =
      await state.auth.client.rpc(
        "update_conquest_location_v2",
        {
          p_round_id:
            state.conquest.roundId,

          p_lat:
            Number(point.lat),

          p_lng:
            Number(point.lng),

          p_accuracy:
            Number(point.accuracy)
        }
      );

    state.conquest
      .updatingLocation = false;

    if (error) {
      console.error(error);
      return false;
    }

    if (
      data?.cache_collected
    ) {
      const tier =
        String(
          data.cache_tier ||
          "Road"
        );

      const tierName =
        tier.charAt(0).toUpperCase() +
        tier.slice(1);

      showToast(
        `${tierName} Cache +` +
        `${Number(
          data.cache_reward
        ) || 0}`
      );
    }

    void rd86PollConquestState({
      force: true
    });

    return Boolean(
      data?.accepted
    );
  };

/* -------------------------------------------------- */
/* Rally reset                                        */
/* -------------------------------------------------- */

rd86ResetConquestState =
  function (
    options = {}
  ) {
    state.conquest.rallyPoint =
      null;

    state.conquest.rallyRadiusM =
      100;

    state.conquest.rallyEndsAt =
      null;

    state.conquest
      .rallyGraceEndsAt = null;

    state.conquest
      .rallyCountdownEndsAt = null;

    state.conquest
      .rallyReadyCount = 0;

    state.conquest.rallyTotal =
      0;

    document.body.classList.remove(
      "conquest-rally-active"
    );

    return roadDiscoveryV89
      .resetState(options);
  };

/* -------------------------------------------------- */
/* Neutral own marker during Rally                    */
/* -------------------------------------------------- */

hs50OwnMarkerColour = function () {
  if (rd89IsRallyPhase()) {
    return RD89_RALLY_COLOUR;
  }

  return roadDiscoveryV89
    .markerColour();
};

hs50OwnMarkerHaloColour =
  function () {
    if (rd89IsRallyPhase()) {
      return (
        "rgba(170, 179, 194, 0.28)"
      );
    }

    return roadDiscoveryV89
      .markerHaloColour();
  };

/* ================================================== */
/* Road Discovery AU v90 Compact Conquest Arena       */
/* Append this block once to the bottom of app.js v89 */
/* ================================================== */

const RD90_CONQUEST_CANDIDATE_MIN_M =
  600;

const RD90_CONQUEST_CANDIDATE_MAX_M =
  1500;

rd86BuildConquestCandidates =
  function (startPoint) {
    const roadPoints =
      state.roadSegments
        .map((segment) =>
          roadSegmentMidpoint(segment)
        )
        .filter(Boolean);

    /*
      Every team start, A-E objective and
      cache now comes from a compact
      three-kilometre-wide battlefield.

      No candidate can be more than
      1.5 km from the match centre.
    */
    const pool = roadPoints.filter(
      (point) => {
        const distance = haversine(
          startPoint,
          point
        );

        return (
          distance >=
            RD90_CONQUEST_CANDIDATE_MIN_M &&
          distance <=
            RD90_CONQUEST_CANDIDATE_MAX_M
        );
      }
    );

    shuffleHideSeekArray(pool);

    const selected = [];

    for (const point of pool) {
      if (
        selected.some(
          (candidate) =>
            haversine(
              candidate,
              point
            ) <
            RD86_CONQUEST_CANDIDATE_SPACING_M
        )
      ) {
        continue;
      }

      let roadCount = 0;

      for (
        const roadPoint of
        roadPoints
      ) {
        if (
          haversine(
            point,
            roadPoint
          ) <=
          RD86_CONQUEST_ROAD_DENSITY_RADIUS_M
        ) {
          roadCount += 1;
        }
      }

      if (
        roadCount <
        RD86_CONQUEST_MIN_ROAD_COUNT
      ) {
        continue;
      }

      selected.push({
        lat: Number(
          point.lat.toFixed(6)
        ),

        lng: Number(
          point.lng.toFixed(6)
        ),

        road_count: roadCount,
        routeable: false
      });

      if (
        selected.length >=
        RD86_CONQUEST_MAX_CANDIDATES
      ) {
        break;
      }
    }

    return selected;
  };

/* ================================================== */
/* Road Discovery AU v91                              */
/* Smaller Conquest Arena                             */
/* ================================================== */

const RD91_CONQUEST_CANDIDATE_MIN_M = 300;
const RD91_CONQUEST_CANDIDATE_MAX_M = 850;
const RD91_CONQUEST_CANDIDATE_SPACING_M = 275;

rd86BuildConquestCandidates = function (startPoint) {
  const roadPoints = state.roadSegments
    .map(roadSegmentMidpoint)
    .filter(Boolean);

  const candidatePool = roadPoints.filter((point) => {
    const distanceFromCentre = haversine(
      startPoint,
      point
    );

    return (
      distanceFromCentre >=
        RD91_CONQUEST_CANDIDATE_MIN_M &&
      distanceFromCentre <=
        RD91_CONQUEST_CANDIDATE_MAX_M
    );
  });

  shuffleHideSeekArray(candidatePool);

  const selectedCandidates = [];

  for (const point of candidatePool) {
    const tooCloseToExistingCandidate =
      selectedCandidates.some((candidate) => {
        return (
          haversine(candidate, point) <
          RD91_CONQUEST_CANDIDATE_SPACING_M
        );
      });

    if (tooCloseToExistingCandidate) {
      continue;
    }

    let nearbyRoadCount = 0;

    for (const roadPoint of roadPoints) {
      if (
        haversine(point, roadPoint) <=
        RD86_CONQUEST_ROAD_DENSITY_RADIUS_M
      ) {
        nearbyRoadCount += 1;
      }
    }

    if (
      nearbyRoadCount <
      RD86_CONQUEST_MIN_ROAD_COUNT
    ) {
      continue;
    }

    selectedCandidates.push({
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
      road_count: nearbyRoadCount,
      routeable: false
    });

    if (
      selectedCandidates.length >=
      RD86_CONQUEST_MAX_CANDIDATES
    ) {
      break;
    }
  }

  return selectedCandidates;
};

/* ================================================== */
/* Road Discovery AU v92                              */
/* Compact Conquest Candidate Fix                     */
/* ================================================== */

const RD92_CONQUEST_CANDIDATE_MIN_M = 600;
const RD92_CONQUEST_CANDIDATE_MAX_M = 900;
const RD92_CONQUEST_CANDIDATE_SPACING_M = 100;

rd86BuildConquestCandidates = function (
  startPoint
) {
  const roadPoints = state.roadSegments
    .map((segment) =>
      roadSegmentMidpoint(segment)
    )
    .filter(Boolean);

  /*
    Supabase accepts Conquest candidates from 600 metres
    onward. This matching range prevents valid points
    from being discarded during round creation.
  */
  const candidatePool = roadPoints.filter(
    (point) => {
      const distanceFromCentre = haversine(
        startPoint,
        point
      );

      return (
        distanceFromCentre >=
          RD92_CONQUEST_CANDIDATE_MIN_M &&
        distanceFromCentre <=
          RD92_CONQUEST_CANDIDATE_MAX_M
      );
    }
  );

  shuffleHideSeekArray(candidatePool);

  const selectedCandidates = [];

  for (const point of candidatePool) {
    const tooCloseToExistingCandidate =
      selectedCandidates.some((candidate) => {
        return (
          haversine(candidate, point) <
          RD92_CONQUEST_CANDIDATE_SPACING_M
        );
      });

    if (tooCloseToExistingCandidate) {
      continue;
    }

    let nearbyRoadCount = 0;

    for (const roadPoint of roadPoints) {
      if (
        haversine(point, roadPoint) <=
        RD86_CONQUEST_ROAD_DENSITY_RADIUS_M
      ) {
        nearbyRoadCount += 1;
      }
    }

    if (
      nearbyRoadCount <
      RD86_CONQUEST_MIN_ROAD_COUNT
    ) {
      continue;
    }

    selectedCandidates.push({
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
      road_count: nearbyRoadCount,
      routeable: false
    });

    if (
      selectedCandidates.length >=
      RD86_CONQUEST_MAX_CANDIDATES
    ) {
      break;
    }
  }

  return selectedCandidates;
};

/* ================================================== */
/* Road Discovery AU v93                              */
/* Moderately Larger Balanced Conquest Arena          */
/* ================================================== */

const RD93_CONQUEST_CANDIDATE_MIN_M = 600;
const RD93_CONQUEST_CANDIDATE_MAX_M = 1200;
const RD93_CONQUEST_CANDIDATE_SPACING_M = 100;

rd86BuildConquestCandidates = function (
  startPoint
) {
  const roadPoints = state.roadSegments
    .map((segment) =>
      roadSegmentMidpoint(segment)
    )
    .filter(Boolean);

  /*
    Supply road points across a battlefield up to
    approximately 2.4 kilometres wide. Supabase still
    performs the final balanced A-E selection.
  */
  const candidatePool = roadPoints.filter(
    (point) => {
      const distanceFromCentre = haversine(
        startPoint,
        point
      );

      return (
        distanceFromCentre >=
          RD93_CONQUEST_CANDIDATE_MIN_M &&
        distanceFromCentre <=
          RD93_CONQUEST_CANDIDATE_MAX_M
      );
    }
  );

  shuffleHideSeekArray(candidatePool);

  const selectedCandidates = [];

  for (const point of candidatePool) {
    const tooCloseToExistingCandidate =
      selectedCandidates.some((candidate) => {
        return (
          haversine(candidate, point) <
          RD93_CONQUEST_CANDIDATE_SPACING_M
        );
      });

    if (tooCloseToExistingCandidate) {
      continue;
    }

    let nearbyRoadCount = 0;

    for (const roadPoint of roadPoints) {
      if (
        haversine(point, roadPoint) <=
        RD86_CONQUEST_ROAD_DENSITY_RADIUS_M
      ) {
        nearbyRoadCount += 1;
      }
    }

    if (
      nearbyRoadCount <
      RD86_CONQUEST_MIN_ROAD_COUNT
    ) {
      continue;
    }

    selectedCandidates.push({
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
      road_count: nearbyRoadCount,
      routeable: false
    });

    if (
      selectedCandidates.length >=
      RD86_CONQUEST_MAX_CANDIDATES
    ) {
      break;
    }
  }

  return selectedCandidates;
};
/* ================================================== */
/* Road Discovery AU v94                              */
/* Host-Placed Conquest Arenas                        */
/* ================================================== */

const RD94_ARENA_OBJECTIVE_CODES = [
  "A",
  "B",
  "C",
  "D",
  "E"
];

const RD94_ARENA_MIN_OBJECTIVE_GAP_M = 650;
const RD94_ARENA_MIN_SPAN_M = 1800;
const RD94_ARENA_MAX_SPAN_M = 4000;
const RD94_ARENA_MIN_CENTRE_M = 600;
const RD94_ARENA_MAX_CENTRE_M = 2000;
const RD94_ARENA_MAX_ROAD_SNAP_M = 90;

const RD94_BLOCKED_HIGHWAY_TYPES = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "raceway",
  "construction",
  "proposed"
]);

const roadDiscoveryV94 = {
  renderMultiplayerState,
  stopMultiplayerMode,
  leaveMultiplayerRoom
};

state.conquestArena = {
  mode: "balanced",
  active: false,
  startKind: "multiplayer",
  centre: null,
  objectives: [],
  layer: null,
  centreMarker: null,
  innerCircle: null,
  outerCircle: null,
  objectiveMarkers: new Map(),
  busy: false,
  mapClickBound: false
};

function rd94IsArenaHost() {
  return Boolean(
    state.auth.user?.id &&
    state.multiplayer.createdBy &&
    String(state.auth.user.id) ===
      String(state.multiplayer.createdBy)
  );
}

function rd94SafeHighwayType(value) {
  return !RD94_BLOCKED_HIGHWAY_TYPES.has(
    String(value || "road").toLowerCase()
  );
}

function rd94RoundMetres(value) {
  return Math.round(Number(value) || 0);
}

function rd94PairDistances(points) {
  const distances = [];

  for (
    let firstIndex = 0;
    firstIndex < points.length;
    firstIndex += 1
  ) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < points.length;
      secondIndex += 1
    ) {
      distances.push(
        haversine(
          points[firstIndex],
          points[secondIndex]
        )
      );
    }
  }

  return distances;
}

function rd94ArenaValidation() {
  const points =
    state.conquestArena.objectives;

  const pairDistances =
    rd94PairDistances(points);

  const minimumGap =
    pairDistances.length > 0
      ? Math.min(...pairDistances)
      : 0;

  const span =
    pairDistances.length > 0
      ? Math.max(...pairDistances)
      : 0;

  const centreDistances =
    state.conquestArena.centre
      ? points.map((point) =>
          haversine(
            state.conquestArena.centre,
            point
          )
        )
      : [];

  const allInCentreRing =
    centreDistances.every(
      (distance) =>
        distance >=
          RD94_ARENA_MIN_CENTRE_M &&
        distance <=
          RD94_ARENA_MAX_CENTRE_M
    );

  const complete =
    points.length ===
      RD94_ARENA_OBJECTIVE_CODES.length;

  const valid = Boolean(
    complete &&
    allInCentreRing &&
    minimumGap >=
      RD94_ARENA_MIN_OBJECTIVE_GAP_M &&
    span >= RD94_ARENA_MIN_SPAN_M &&
    span <= RD94_ARENA_MAX_SPAN_M
  );

  return {
    complete,
    valid,
    minimumGap,
    span,
    allInCentreRing
  };
}

function rd94InstallArenaStyles() {
  if (document.getElementById(
    "rd94ConquestArenaStyles"
  )) {
    return;
  }

  const style =
    document.createElement("style");

  style.id = "rd94ConquestArenaStyles";

  style.textContent = `
    .rd94-arena-choice {
      display: grid;
      gap: 9px;
      margin: 14px 0;
      padding: 12px;
      border: 1px solid rgba(143, 164, 196, 0.24);
      border-radius: 16px;
      background: rgba(12, 19, 31, 0.58);
    }

    .rd94-arena-choice-title {
      font-size: 0.78rem;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #dce9ff;
    }

    .rd94-arena-choice-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .rd94-arena-mode-btn {
      min-height: 42px;
      padding: 9px 10px;
      border: 1px solid rgba(156, 177, 210, 0.28);
      border-radius: 12px;
      background: rgba(27, 38, 56, 0.86);
      color: #f5f9ff;
      font: inherit;
      font-size: 0.82rem;
      font-weight: 850;
    }

    .rd94-arena-mode-btn.active {
      border-color: #7dc4ff;
      background: rgba(43, 124, 188, 0.34);
      box-shadow: 0 0 0 1px rgba(125, 196, 255, 0.3) inset;
    }

    .rd94-arena-mode-btn:disabled {
      opacity: 0.45;
    }

    .rd94-arena-choice-note {
      margin: 0;
      color: #9fb2cc;
      font-size: 0.76rem;
      line-height: 1.38;
    }

    .rd94-arena-overlay {
      position: fixed;
      inset: 0;
      z-index: 6500;
      pointer-events: none;
    }

    .rd94-arena-overlay.hidden {
      display: none;
    }

    .rd94-arena-panel {
      position: absolute;
      top: max(10px, env(safe-area-inset-top));
      left: 50%;
      width: min(94vw, 520px);
      transform: translateX(-50%);
      display: grid;
      gap: 10px;
      padding: 13px;
      border: 1px solid rgba(147, 178, 221, 0.3);
      border-radius: 18px;
      background: rgba(8, 14, 24, 0.94);
      color: #f7fbff;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(14px);
      pointer-events: auto;
    }

    .rd94-arena-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .rd94-arena-heading strong {
      display: block;
      font-size: 1rem;
    }

    .rd94-arena-heading span {
      display: block;
      margin-top: 3px;
      color: #a9bad0;
      font-size: 0.75rem;
      line-height: 1.35;
    }

    .rd94-arena-progress {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 6px;
    }

    .rd94-arena-objective-chip {
      min-height: 38px;
      border: 1px solid rgba(151, 170, 199, 0.3);
      border-radius: 11px;
      background: rgba(31, 43, 61, 0.88);
      color: #8291a5;
      font: inherit;
      font-weight: 950;
    }

    .rd94-arena-objective-chip.placed {
      border-color: #f6ca55;
      background: rgba(190, 130, 17, 0.24);
      color: #ffe38a;
    }

    .rd94-arena-status {
      min-height: 38px;
      padding: 9px 10px;
      border-radius: 12px;
      background: rgba(28, 39, 56, 0.8);
      color: #c7d6e9;
      font-size: 0.78rem;
      line-height: 1.42;
    }

    .rd94-arena-status.good {
      background: rgba(19, 111, 75, 0.28);
      color: #9ef0c5;
    }

    .rd94-arena-status.bad {
      background: rgba(139, 55, 47, 0.28);
      color: #ffc0b9;
    }

    .rd94-arena-actions {
      display: grid;
      grid-template-columns: auto auto 1fr;
      gap: 8px;
    }

    .rd94-arena-action {
      min-height: 42px;
      padding: 9px 13px;
      border: 1px solid rgba(151, 170, 199, 0.3);
      border-radius: 12px;
      background: rgba(31, 43, 61, 0.9);
      color: #f5f9ff;
      font: inherit;
      font-size: 0.82rem;
      font-weight: 850;
    }

    .rd94-arena-action.confirm {
      border-color: rgba(93, 194, 139, 0.5);
      background: rgba(24, 142, 83, 0.34);
    }

    .rd94-arena-action:disabled {
      opacity: 0.42;
    }

    .rd94-arena-objective-icon {
      background: transparent;
      border: 0;
    }

    .rd94-arena-objective-marker {
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      border: 3px solid #ffe58b;
      border-radius: 50%;
      background: #171d27;
      color: #ffe58b;
      font-size: 1rem;
      font-weight: 1000;
      box-shadow:
        0 0 0 5px rgba(255, 218, 92, 0.17),
        0 7px 18px rgba(0, 0, 0, 0.42);
    }

    .rd94-arena-centre-icon {
      background: transparent;
      border: 0;
    }

    .rd94-arena-centre-marker {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      border: 2px solid #dce8f7;
      border-radius: 50%;
      background: #222c3a;
      color: #f5f9ff;
      font-size: 0.58rem;
      font-weight: 900;
      box-shadow: 0 5px 14px rgba(0, 0, 0, 0.36);
    }

    @media (max-width: 520px) {
      .rd94-arena-panel {
        width: calc(100vw - 16px);
        padding: 11px;
      }

      .rd94-arena-actions {
        grid-template-columns: 1fr 1fr;
      }

      .rd94-arena-action.confirm {
        grid-column: 1 / -1;
      }
    }
  `;

  document.head.appendChild(style);
}

function rd94ArenaChoiceHtml(scope) {
  return `
    <div
      class="rd94-arena-choice"
      data-rd94-arena-choice="${escapeHtml(scope)}"
    >
      <div class="rd94-arena-choice-title">
        Arena layout
      </div>

      <div class="rd94-arena-choice-buttons">
        <button
          class="rd94-arena-mode-btn"
          type="button"
          data-rd94-arena-mode="balanced"
        >
          Balanced Random
        </button>

        <button
          class="rd94-arena-mode-btn"
          type="button"
          data-rd94-arena-mode="custom"
        >
          Place A–E
        </button>
      </div>

      <p class="rd94-arena-choice-note"></p>
    </div>
  `;
}

function rd94InjectArenaChoice(
  containerId,
  startButtonId,
  scope
) {
  const container =
    document.getElementById(containerId);

  const startButton =
    document.getElementById(startButtonId);

  if (
    !container ||
    !startButton ||
    container.querySelector(
      `[data-rd94-arena-choice="${scope}"]`
    )
  ) {
    return;
  }

  const holder =
    document.createElement("div");

  holder.innerHTML =
    rd94ArenaChoiceHtml(scope);

  const choice = holder.firstElementChild;

  startButton.parentNode?.insertBefore(
    choice,
    startButton
  );

  choice?.addEventListener(
    "click",
    (event) => {
      const button =
        event.target.closest(
          "[data-rd94-arena-mode]"
        );

      if (!button || button.disabled) return;

      const mode =
        button.dataset.rd94ArenaMode ===
        "custom"
          ? "custom"
          : "balanced";

      rd94SetArenaMode(mode);
    }
  );
}

function rd94EnsureArenaChoices() {
  rd94InstallArenaStyles();

  rd94InjectArenaChoice(
    "conquestSetupBox",
    "startConquestBtn",
    "multiplayer"
  );

  rd94InjectArenaChoice(
    "customConquestBox",
    "startCustomConquestBtn",
    "custom"
  );

  rd94EnsurePlacementOverlay();
  rd94BindStartInterceptors();
  rd94RenderArenaChoices();
}

function rd94SetArenaMode(mode) {
  if (
    mode === "custom" &&
    !rd94IsArenaHost()
  ) {
    showToast(
      "Only the room creator can place A–E"
    );
    return;
  }

  state.conquestArena.mode =
    mode === "custom"
      ? "custom"
      : "balanced";

  rd94RenderArenaChoices();
}

function rd94RenderArenaChoices() {
  const isHost = rd94IsArenaHost();
  const customSelected =
    state.conquestArena.mode === "custom";

  for (
    const choice of
    document.querySelectorAll(
      "[data-rd94-arena-choice]"
    )
  ) {
    for (
      const button of
      choice.querySelectorAll(
        "[data-rd94-arena-mode]"
      )
    ) {
      const mode =
        button.dataset.rd94ArenaMode;

      button.classList.toggle(
        "active",
        mode === state.conquestArena.mode
      );

      button.disabled =
        mode === "custom" && !isHost;
    }

    const note = choice.querySelector(
      ".rd94-arena-choice-note"
    );

    if (note) {
      note.textContent = !isHost
        ? "The room creator can choose and place a custom arena."
        : customSelected
          ? "Start opens the map so you can place five safe objectives before teams are created."
          : "A–E are spread automatically across reachable roads.";
    }
  }

  const startButton =
    document.getElementById(
      "startConquestBtn"
    );

  if (
    startButton &&
    customSelected &&
    !state.conquest.starting
  ) {
    startButton.textContent =
      "Place A–E & Start";
  }

  const customStartButton =
    document.getElementById(
      "startCustomConquestBtn"
    );

  if (
    customStartButton &&
    customSelected &&
    !state.customConquest.starting
  ) {
    customStartButton.textContent =
      "Place A–E & Start";
  }
}

function rd94EnsurePlacementOverlay() {
  if (document.getElementById(
    "rd94ArenaOverlay"
  )) {
    return;
  }

  const overlay =
    document.createElement("div");

  overlay.id = "rd94ArenaOverlay";
  overlay.className =
    "rd94-arena-overlay hidden";

  overlay.innerHTML = `
    <div
      class="rd94-arena-panel"
      role="dialog"
      aria-modal="false"
      aria-label="Place Conquest objectives"
    >
      <div class="rd94-arena-heading">
        <div>
          <strong>Place Conquest A–E</strong>
          <span>
            Tap safe public roads. Tap a placed letter below to remove it, or drag its marker.
          </span>
        </div>
      </div>

      <div
        id="rd94ArenaProgress"
        class="rd94-arena-progress"
      ></div>

      <div
        id="rd94ArenaStatus"
        class="rd94-arena-status"
      ></div>

      <div class="rd94-arena-actions">
        <button
          id="rd94ArenaCancelBtn"
          class="rd94-arena-action"
          type="button"
        >
          Cancel
        </button>

        <button
          id="rd94ArenaUndoBtn"
          class="rd94-arena-action"
          type="button"
        >
          Undo
        </button>

        <button
          id="rd94ArenaConfirmBtn"
          class="rd94-arena-action confirm"
          type="button"
        >
          Confirm A–E
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById(
    "rd94ArenaCancelBtn"
  )?.addEventListener(
    "click",
    () => rd94CancelArenaPlacement()
  );

  document.getElementById(
    "rd94ArenaUndoBtn"
  )?.addEventListener(
    "click",
    rd94UndoArenaObjective
  );

  document.getElementById(
    "rd94ArenaConfirmBtn"
  )?.addEventListener(
    "click",
    () => {
      void rd94ConfirmArenaPlacement();
    }
  );

  document.getElementById(
    "rd94ArenaProgress"
  )?.addEventListener(
    "click",
    (event) => {
      const button =
        event.target.closest(
          "[data-rd94-remove-objective]"
        );

      if (!button || button.disabled) return;

      rd94RemoveArenaObjective(
        button.dataset
          .rd94RemoveObjective
      );
    }
  );
}

function rd94BindStartInterceptors() {
  const bindings = [
    ["startConquestBtn", "multiplayer"],
    ["startCustomConquestBtn", "custom"]
  ];

  for (const [buttonId, startKind] of bindings) {
    const button =
      document.getElementById(buttonId);

    if (
      !button ||
      button.dataset.rd94ArenaBound ===
        "true"
    ) {
      continue;
    }

    button.dataset.rd94ArenaBound =
      "true";

    button.addEventListener(
      "click",
      (event) => {
        if (
          state.conquestArena.mode !==
          "custom"
        ) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        void rd94BeginArenaPlacement(
          startKind
        );
      },
      true
    );
  }
}

function rd94ArenaObjectiveIcon(code) {
  return L.divIcon({
    className:
      "rd94-arena-objective-icon",
    html: `
      <div class="rd94-arena-objective-marker">
        ${escapeHtml(code)}
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });
}

function rd94ArenaCentreIcon() {
  return L.divIcon({
    className:
      "rd94-arena-centre-icon",
    html: `
      <div class="rd94-arena-centre-marker">
        RALLY
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

function rd94EnsurePlacementLayer() {
  if (
    state.map &&
    !state.conquestArena.layer
  ) {
    state.conquestArena.layer =
      L.layerGroup().addTo(state.map);
  }
}

function rd94ClearPlacementLayers() {
  if (state.conquestArena.layer) {
    state.conquestArena.layer.clearLayers();
  }

  state.conquestArena.centreMarker = null;
  state.conquestArena.innerCircle = null;
  state.conquestArena.outerCircle = null;
  state.conquestArena.objectiveMarkers.clear();
}

function rd94DrawArenaCentre() {
  rd94EnsurePlacementLayer();

  const centre =
    state.conquestArena.centre;

  if (!centre || !state.conquestArena.layer) {
    return;
  }

  state.conquestArena.outerCircle =
    L.circle(
      [centre.lat, centre.lng],
      {
        radius:
          RD94_ARENA_MAX_CENTRE_M,
        color: "#d8e6f8",
        weight: 2,
        opacity: 0.62,
        fillOpacity: 0.025,
        dashArray: "10 9",
        interactive: false
      }
    ).addTo(state.conquestArena.layer);

  state.conquestArena.innerCircle =
    L.circle(
      [centre.lat, centre.lng],
      {
        radius:
          RD94_ARENA_MIN_CENTRE_M,
        color: "#9daec4",
        weight: 1,
        opacity: 0.42,
        fillOpacity: 0.02,
        dashArray: "5 8",
        interactive: false
      }
    ).addTo(state.conquestArena.layer);

  state.conquestArena.centreMarker =
    L.marker(
      [centre.lat, centre.lng],
      {
        icon: rd94ArenaCentreIcon(),
        interactive: false,
        keyboard: false,
        zIndexOffset: 10
      }
    ).addTo(state.conquestArena.layer);
}

function rd94ClosestPointOnSegment(
  point,
  segment
) {
  const coords = segment?.coords;

  if (
    !Array.isArray(coords) ||
    coords.length < 2
  ) {
    return null;
  }

  const a = {
    lat: Number(coords[0][0]),
    lng: Number(coords[0][1])
  };

  const b = {
    lat: Number(coords[1][0]),
    lng: Number(coords[1][1])
  };

  if (
    !Number.isFinite(a.lat) ||
    !Number.isFinite(a.lng) ||
    !Number.isFinite(b.lat) ||
    !Number.isFinite(b.lng)
  ) {
    return null;
  }

  const metresPerLat = 111320;
  const metresPerLng =
    Math.max(
      1000,
      Math.cos(
        Number(point.lat) *
        Math.PI / 180
      ) * 111320
    );

  const ax =
    (a.lng - point.lng) *
    metresPerLng;

  const ay =
    (a.lat - point.lat) *
    metresPerLat;

  const bx =
    (b.lng - point.lng) *
    metresPerLng;

  const by =
    (b.lat - point.lat) *
    metresPerLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared =
    dx * dx + dy * dy;

  const fraction =
    lengthSquared > 0
      ? Math.max(
          0,
          Math.min(
            1,
            -(
              ax * dx + ay * dy
            ) / lengthSquared
          )
        )
      : 0;

  const snapped = {
    lat:
      a.lat +
      (b.lat - a.lat) * fraction,
    lng:
      a.lng +
      (b.lng - a.lng) * fraction,
    highway:
      String(segment.highway || "road"),
    road_name:
      String(segment.name || "Road")
  };

  return {
    ...snapped,
    distance: haversine(point, snapped)
  };
}

function rd94NearestSafeRoadPoint(point) {
  let nearest = null;

  for (const segment of state.roadSegments) {
    if (!rd94SafeHighwayType(
      segment?.highway
    )) {
      continue;
    }

    const candidate =
      rd94ClosestPointOnSegment(
        point,
        segment
      );

    if (
      candidate &&
      (
        !nearest ||
        candidate.distance <
          nearest.distance
      )
    ) {
      nearest = candidate;
    }
  }

  if (
    !nearest ||
    nearest.distance >
      RD94_ARENA_MAX_ROAD_SNAP_M
  ) {
    return null;
  }

  return {
    lat: Number(nearest.lat.toFixed(6)),
    lng: Number(nearest.lng.toFixed(6)),
    highway: nearest.highway,
    road_name: nearest.road_name
  };
}

function rd94ValidateNewObjective(
  point,
  replacingCode = ""
) {
  const centre =
    state.conquestArena.centre;

  if (!centre) {
    return {
      valid: false,
      message: "The arena centre is unavailable."
    };
  }

  const centreDistance =
    haversine(centre, point);

  if (
    centreDistance <
      RD94_ARENA_MIN_CENTRE_M ||
    centreDistance >
      RD94_ARENA_MAX_CENTRE_M
  ) {
    return {
      valid: false,
      message:
        "Place each objective inside the 600–2,000 gmetre arena ring."
    };
  }

  for (
    const objective of
    state.conquestArena.objectives
  ) {
    if (
      objective.code === replacingCode
    ) {
      continue;
    }

    const gap =
      haversine(objective, point);

    if (
      gap <
      RD94_ARENA_MIN_OBJECTIVE_GAP_M
    ) {
      return {
        valid: false,
        message:
          `Too close to ${objective.code}. Keep every objective at least 650 metres apart.`
      };
    }
  }

  return {
    valid: true,
    message: ""
  };
}

function rd94DrawArenaObjectives() {
  rd94EnsurePlacementLayer();

  const activeCodes = new Set(
    state.conquestArena.objectives.map(
      (objective) => objective.code
    )
  );

  for (
    const objective of
    state.conquestArena.objectives
  ) {
    let marker =
      state.conquestArena
        .objectiveMarkers
        .get(objective.code);

    if (marker) {
      marker.setLatLng([
        objective.lat,
        objective.lng
      ]);
      continue;
    }

    marker = L.marker(
      [objective.lat, objective.lng],
      {
        icon:
          rd94ArenaObjectiveIcon(
            objective.code
          ),
        draggable: true,
        keyboard: false,
        zIndexOffset: 50
      }
    ).addTo(state.conquestArena.layer);

    marker.on(
      "dragstart",
      () => {
        marker.rd94PreviousPoint = {
          lat: objective.lat,
          lng: objective.lng
        };
      }
    );

    marker.on(
      "dragend",
      () => {
        const latlng = marker.getLatLng();

        const snapped =
          rd94NearestSafeRoadPoint({
            lat: Number(latlng.lat),
            lng: Number(latlng.lng)
          });

        const validation = snapped
          ? rd94ValidateNewObjective(
              snapped,
              objective.code
            )
          : {
              valid: false,
              message:
                "That point is not close enough to a suitable public road."
            };

        if (!validation.valid) {
          const previous =
            marker.rd94PreviousPoint ||
            objective;

          marker.setLatLng([
            previous.lat,
            previous.lng
          ]);

          showToast(validation.message);
          return;
        }

        objective.lat = snapped.lat;
        objective.lng = snapped.lng;
        objective.highway =
          snapped.highway;
        objective.road_name =
          snapped.road_name;

        marker.setLatLng([
          objective.lat,
          objective.lng
        ]);

        rd94RenderPlacementOverlay();
      }
    );

    marker.bindTooltip(
      `Objective ${escapeHtml(objective.code)} • Drag to move`,
      { direction: "top" }
    );

    state.conquestArena
      .objectiveMarkers
      .set(objective.code, marker);
  }

  for (
    const [code, marker] of
    state.conquestArena
      .objectiveMarkers
      .entries()
  ) {
    if (!activeCodes.has(code)) {
      state.conquestArena.layer
        ?.removeLayer(marker);

      state.conquestArena
        .objectiveMarkers
        .delete(code);
    }
  }
}

function rd94RenderPlacementOverlay(
  overrideMessage = ""
) {
  const overlay =
    document.getElementById(
      "rd94ArenaOverlay"
    );

  const progress =
    document.getElementById(
      "rd94ArenaProgress"
    );

  const status =
    document.getElementById(
      "rd94ArenaStatus"
    );

  const undoButton =
    document.getElementById(
      "rd94ArenaUndoBtn"
    );

  const confirmButton =
    document.getElementById(
      "rd94ArenaConfirmBtn"
    );

  if (!overlay || !progress || !status) {
    return;
  }

  overlay.classList.toggle(
    "hidden",
    !state.conquestArena.active
  );

  progress.innerHTML =
    RD94_ARENA_OBJECTIVE_CODES
      .map((code) => {
        const placed =
          state.conquestArena.objectives
            .some(
              (objective) =>
                objective.code === code
            );

        return `
          <button
            class="rd94-arena-objective-chip ${placed ? "placed" : ""}"
            type="button"
            data-rd94-remove-objective="${code}"
            ${placed ? "" : "disabled"}
            aria-label="${placed ? `Remove objective ${code}` : `Objective ${code} not placed` }"
          >
            ${code}
          </button>
        `;
      })
      .join("");

  const validation =
    rd94ArenaValidation();

  status.classList.remove(
    "good",
    "bad"
  );

  if (overrideMessage) {
    status.textContent = overrideMessage;
  } else if (!validation.complete) {
    const nextCode =
      RD94_ARENA_OBJECTIVE_CODES[
        state.conquestArena
          .objectives.length
      ];

    status.textContent =
      `Tap a suitable road to place ${nextCode}. ` +
      `${state.conquestArena.objectives.length}/5 placed • ` +
      "minimum 650 m between objectives.";
  } else if (
    validation.minimumGap <
    RD94_ARENA_MIN_OBJECTIVE_GAP_M
  ) {
    status.textContent =
      `Objectives are only ${rd94RoundMetres(validation.minimumGap)} m apart. Move one until the minimum is 650 m.`;
    status.classList.add("bad");
  } else if (
    validation.span <
    RD94_ARENA_MIN_SPAN_M
  ) {
    status.textContent =
      `Arena span is ${rd94RoundMetres(validation.span)} m. Move an outer objective until the span reaches 1.8 km.`;
    status.classList.add("bad");
  } else if (
    validation.span >
    RD94_ARENA_MAX_SPAN_M
  ) {
    status.textContent =
      `Arena span is ${rd94RoundMetres(validation.span)} m. Keep the complete arena within 4 km.`;
    status.classList.add("bad");
  } else if (!validation.allInCentreRing) {
    status.textContent =
      "Every objective must stay inside the 600–1,200 metre arena ring.";
    status.classList.add("bad");
  } else {
    status.textContent =
      `Arena ready • nearest gap ${rd94RoundMetres(validation.minimumGap)} m • total span ${rd94RoundMetres(validation.span)} m.`;
    status.classList.add("good");
  }

  if (undoButton) {
    undoButton.disabled = Boolean(
      state.conquestArena.busy ||
      state.conquestArena.objectives
        .length === 0
    );
  }

  if (confirmButton) {
    confirmButton.disabled = Boolean(
      state.conquestArena.busy ||
      !validation.valid
    );

    confirmButton.textContent =
      state.conquestArena.busy
        ? "Checking arena..."
        : "Confirm A–E";
  }

  rd94DrawArenaObjectives();
}

function rd94HandleArenaMapClick(event) {
  if (
    !state.conquestArena.active ||
    state.conquestArena.busy ||
    state.conquestArena.objectives.length >=
      RD94_ARENA_OBJECTIVE_CODES.length
  ) {
    return;
  }

  const snapped =
    rd94NearestSafeRoadPoint({
      lat: Number(event.latlng.lat),
      lng: Number(event.latlng.lng)
    });

  if (!snapped) {
    showToast(
      "Tap closer to a suitable public road"
    );
    return;
  }

  const validation =
    rd94ValidateNewObjective(snapped);

  if (!validation.valid) {
    showToast(validation.message);
    return;
  }

  const code =
    RD94_ARENA_OBJECTIVE_CODES[
      state.conquestArena.objectives.length
    ];

  state.conquestArena.objectives.push({
    code,
    lat: snapped.lat,
    lng: snapped.lng,
    highway: snapped.highway,
    road_name: snapped.road_name
  });

  showToast(
    `Objective ${code} placed • ${snapped.road_name}`
  );

  rd94RenderPlacementOverlay();
}

function rd94BindArenaMapClick() {
  if (
    !state.map ||
    state.conquestArena.mapClickBound
  ) {
    return;
  }

  state.map.on(
    "click",
    rd94HandleArenaMapClick
  );

  state.conquestArena.mapClickBound = true;
}

function rd94UnbindArenaMapClick() {
  if (
    !state.map ||
    !state.conquestArena.mapClickBound
  ) {
    return;
  }

  state.map.off(
    "click",
    rd94HandleArenaMapClick
  );

  state.conquestArena.mapClickBound = false;
}

function rd94RemoveArenaObjective(code) {
  if (state.conquestArena.busy) return;

  const index =
    state.conquestArena.objectives
      .findIndex(
        (objective) =>
          objective.code === code
      );

  if (index < 0) return;

  state.conquestArena.objectives.splice(
    index,
    1
  );

  state.conquestArena.objectives
    .forEach((objective, objectiveIndex) => {
      objective.code =
        RD94_ARENA_OBJECTIVE_CODES[
          objectiveIndex
        ];
    });

  rd94ClearPlacementLayers();
  rd94DrawArenaCentre();
  rd94RenderPlacementOverlay();
}

function rd94UndoArenaObjective() {
  const last =
    state.conquestArena.objectives.at(-1);

  if (last) {
    rd94RemoveArenaObjective(last.code);
  }
}

async function rd94ArenaStartPoint(startKind) {
  if (startKind === "custom") {
    const roster = rd87CustomRoster();

    if (!roster.valid) {
      throw new Error(
        roster.errors[0] ||
        "Choose a valid Red and Blue roster."
      );
    }

    return rd87CustomStartPoint(roster);
  }

  return getFreshRouteStartPoint();
}

async function rd94BeginArenaPlacement(
  startKind
) {
  if (
    !hasActiveMultiplayerRoom() ||
    !state.auth.client ||
    !state.auth.user ||
    !rd94IsArenaHost() ||
    state.conquestArena.busy ||
    hasActiveConquestRound()
  ) {
    if (!rd94IsArenaHost()) {
      showToast(
        "Only the room creator can place A–E"
      );
    }
    return;
  }

  if (hasActiveHideSeekRound()) {
    showToast(
      "Finish Hide & Seek before placing a Conquest arena"
    );
    return;
  }

  if (startKind === "multiplayer") {
    const memberCount =
      state.multiplayer.members.length;

    if (
      memberCount <
        RD86_CONQUEST_MIN_PLAYERS ||
      memberCount >
        RD86_CONQUEST_MAX_PLAYERS
    ) {
      showToast(
        "Road Conquest needs 2–8 riders"
      );
      return;
    }
  }

  state.conquestArena.busy = true;
  state.conquestArena.startKind =
    startKind === "custom"
      ? "custom"
      : "multiplayer";

  closePanels();
  state.awaitingWaypointClick = false;

  if (state.myPlaces) {
    state.myPlaces.placingType = null;
    state.myPlaces.movingPlaceId = null;
  }

  showToast(
    "Loading roads for custom arena placement"
  );

  try {
    const startPoint =
      await rd94ArenaStartPoint(
        state.conquestArena.startKind
      );

    if (
      !startPoint ||
      !Number.isFinite(
        Number(startPoint.lat)
      ) ||
      !Number.isFinite(
        Number(startPoint.lng)
      ) ||
      (
        Number(startPoint.accuracy) >
          MAX_GPS_ACCURACY_M &&
        Number(startPoint.accuracy) !== 0
      )
    ) {
      throw new Error(
        "Need GPS accuracy of 35 metres or better before placing the arena."
      );
    }

    const roadsReady =
      await ensureRoadsNearPoint(
        startPoint,
        {
          replaceIfFar: true,
          quiet: false
        }
      );

    if (
      !roadsReady ||
      state.roadSegments.length === 0
    ) {
      throw new Error(
        "Could not load roads for this arena."
      );
    }

    let centre = {
      lat: Number(startPoint.lat),
      lng: Number(startPoint.lng),
      accuracy:
        Number(startPoint.accuracy) || 0
    };

    if (
      state.conquestArena.startKind ===
        "custom" &&
      rd87CustomRoster().humans.length === 0
    ) {
      const snappedCentre =
        rd94NearestSafeRoadPoint(centre);

      if (snappedCentre) {
        centre = {
          ...snappedCentre,
          accuracy: 0
        };
      }
    }

    state.conquestArena.centre = centre;
    state.conquestArena.objectives = [];
    state.conquestArena.active = true;
    state.conquestArena.busy = false;

    rd94ClearPlacementLayers();
    rd94DrawArenaCentre();
    rd94BindArenaMapClick();

    state.followUser = false;

    state.map?.setView(
      [centre.lat, centre.lng],
      Math.min(
        14,
        Number(state.map.getZoom()) || 14
      ),
      { animate: true }
    );

    rd94RenderPlacementOverlay();

    showToast(
      "Tap five safe roads to place A–E"
    );
  } catch (error) {
    console.error(error);

    state.conquestArena.busy = false;
    state.conquestArena.active = false;

    const message =
      rd86ConquestErrorMessage(error);

    showToast(message);
    rd94RenderPlacementOverlay();
  }
}

function rd94CancelArenaPlacement(
  showMessage = true
) {
  state.conquestArena.active = false;
  state.conquestArena.busy = false;
  state.conquestArena.centre = null;
  state.conquestArena.objectives = [];

  rd94UnbindArenaMapClick();
  rd94ClearPlacementLayers();
  rd94RenderPlacementOverlay();

  if (showMessage) {
    showToast(
      "Custom arena placement cancelled"
    );
  }
}

function rd94Cross(origin, a, b) {
  return (
    (a.lng - origin.lng) *
      (b.lat - origin.lat) -
    (a.lat - origin.lat) *
      (b.lng - origin.lng)
  );
}

function rd94ConvexHull(points) {
  const sorted = points
    .map((point) => ({
      lat: Number(point.lat),
      lng: Number(point.lng)
    }))
    .sort(
      (a, b) =>
        a.lng - b.lng ||
        a.lat - b.lat
    );

  if (sorted.length <= 2) {
    return sorted;
  }

  const lower = [];

  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      rd94Cross(
        lower[lower.length - 2],
        lower[lower.length - 1],
        point
      ) <= 0
    ) {
      lower.pop();
    }

    lower.push(point);
  }

  const upper = [];

  for (
    let index = sorted.length - 1;
    index >= 0;
    index -= 1
  ) {
    const point = sorted[index];

    while (
      upper.length >= 2 &&
      rd94Cross(
        upper[upper.length - 2],
        upper[upper.length - 1],
        point
      ) <= 0
    ) {
      upper.pop();
    }

    upper.push(point);
  }

  lower.pop();
  upper.pop();

  return lower.concat(upper);
}

function rd94PointInPolygon(point, polygon) {
  let inside = false;

  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];

    const crosses = Boolean(
      (
        currentPoint.lat > point.lat
      ) !== (
        previousPoint.lat > point.lat
      ) &&
      point.lng <
        (
          (
            previousPoint.lng -
            currentPoint.lng
          ) *
          (
            point.lat -
            currentPoint.lat
          ) /
          (
            previousPoint.lat -
            currentPoint.lat
          ) +
          currentPoint.lng
        )
    );

    if (crosses) {
      inside = !inside;
    }
  }

  return inside;
}

function rd94BuildCustomArenaCandidates() {
  const centre =
    state.conquestArena.centre;

  const objectives =
    state.conquestArena.objectives;

  const hull =
    rd94ConvexHull(objectives);

  const roadPoints =
    state.roadSegments
      .filter(
        (segment) =>
          rd94SafeHighwayType(
            segment?.highway
          )
      )
      .map((segment) => ({
        ...roadSegmentMidpoint(segment),
        highway:
          String(segment.highway || "road")
      }))
      .filter(
        (point) =>
          Number.isFinite(
            Number(point?.lat)
          ) &&
          Number.isFinite(
            Number(point?.lng)
          )
      );

  const pool = roadPoints.filter(
    (point) => {
      const centreDistance =
        haversine(centre, point);

      if (
        centreDistance <
          RD94_ARENA_MIN_CENTRE_M ||
        centreDistance >
          RD94_ARENA_MAX_CENTRE_M ||
        !rd94PointInPolygon(
          point,
          hull
        )
      ) {
        return false;
      }

      return true;
    }
  );

  shuffleHideSeekArray(pool);

  const selected = [];

  for (const point of pool) {
    if (
      selected.some(
        (candidate) =>
          haversine(
            candidate,
            point
          ) <
          RD93_CONQUEST_CANDIDATE_SPACING_M
      )
    ) {
      continue;
    }

    let roadCount = 0;

    for (const roadPoint of roadPoints) {
      if (
        haversine(
          point,
          roadPoint
        ) <=
        RD86_CONQUEST_ROAD_DENSITY_RADIUS_M
      ) {
        roadCount += 1;
      }
    }

    if (
      roadCount <
      RD86_CONQUEST_MIN_ROAD_COUNT
    ) {
      continue;
    }

    selected.push({
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
      road_count: roadCount,
      routeable: false
    });

    if (
      selected.length >=
      RD86_CONQUEST_MAX_CANDIDATES -
        RD94_ARENA_OBJECTIVE_CODES.length
    ) {
      break;
    }
  }

  /*
    Keep the five verified edge locations in the supplied
    pool so the existing balanced-round transaction can
    always prove the required 1.8 km span. The server
    removes candidates close to A-E immediately after it
    installs the host's final objective coordinates, so
    caches cannot spawn on top of an objective.
  */
  for (const objective of objectives) {
    selected.push({
      lat: Number(
        Number(objective.lat).toFixed(6)
      ),
      lng: Number(
        Number(objective.lng).toFixed(6)
      ),
      road_count: 100000,
      routeable: false
    });
  }

  return selected;
}

async function rd94ValidateObjectiveRoutes() {
  const routeable =
    await rd86FilterRouteableCandidates(
      state.conquestArena.centre,
      state.conquestArena.objectives.map(
        (objective) => ({
          ...objective,
          road_count: 100000,
          routeable: false
        })
      )
    );

  if (
    routeable.length !==
    RD94_ARENA_OBJECTIVE_CODES.length
  ) {
    throw new Error(
      "Every objective must be reachable by a normal road route from the Rally area. Move the unreachable objective and try again."
    );
  }
}

function rd94CustomObjectivePayload() {
  return state.conquestArena.objectives
    .map((objective) => ({
      code: objective.code,
      lat: Number(
        Number(objective.lat).toFixed(6)
      ),
      lng: Number(
        Number(objective.lng).toFixed(6)
      )
    }));
}

async function rd94StartPreparedArena() {
  const startKind =
    state.conquestArena.startKind;

  const centre = {
    ...state.conquestArena.centre
  };

  const objectivePayload =
    rd94CustomObjectivePayload();

  const roster =
    startKind === "custom"
      ? rd87CustomRoster()
      : null;

  if (
    startKind === "custom" &&
    !roster?.valid
  ) {
    throw new Error(
      roster?.errors?.[0] ||
      "Choose a valid Red and Blue roster."
    );
  }

  state.conquestArena.busy = true;
  state.conquest.starting = true;

  if (startKind === "custom") {
    state.customConquest.starting = true;
    state.customConquest.preparationText =
      "Checking the custom arena...";
  } else {
    state.conquest.preparationText =
      "Checking the custom arena...";
  }

  rd94RenderPlacementOverlay(
    "Checking all five road routes..."
  );

  try {
    await rd94ValidateObjectiveRoutes();

    rd94RenderPlacementOverlay(
      "Building safe cache locations inside A–E..."
    );

    const candidates =
      rd94BuildCustomArenaCandidates();

    if (
      candidates.length <
      RD86_CONQUEST_MIN_CANDIDATES
    ) {
      throw new Error(
        "Not enough suitable cache and team-start roads exist inside this A–E boundary. Adjust the outer objectives and try again."
      );
    }

    const routeable =
      await rd86FilterRouteableCandidates(
        centre,
        candidates
      );

    if (
      routeable.length <
      RD86_CONQUEST_MIN_CANDIDATES
    ) {
      throw new Error(
        "Not enough reachable roads exist inside this custom arena. Adjust A–E and try again."
      );
    }

    if (rd86HasConquestRound()) {
      rd86ResetConquestState({
        clearRound: true,
        render: false
      });
    }

    rd94RenderPlacementOverlay(
      "Creating teams, starts and the custom arena..."
    );

    const sharedParameters = {
      p_room_id:
        state.multiplayer.roomId,
      p_start_lat:
        Number(centre.lat),
      p_start_lng:
        Number(centre.lng),
      p_road_candidates:
        routeable.map(
          (candidate) => ({
            lat: candidate.lat,
            lng: candidate.lng,
            road_count:
              candidate.road_count,
            routeable: true
          })
        ),
      p_objectives: objectivePayload,
      p_safety_ack: true
    };

    const rpcName =
      startKind === "custom"
        ? "start_custom_conquest_round_custom_arena"
        : "start_conquest_round_custom_arena";

    const parameters =
      startKind === "custom"
        ? {
            ...sharedParameters,
            p_human_teams:
              roster.humans,
            p_red_bots:
              roster.redBots,
            p_blue_bots:
              roster.blueBots
          }
        : sharedParameters;

    const { data, error } =
      await state.auth.client.rpc(
        rpcName,
        parameters
      );

    if (error) throw error;

    const roundId = Array.isArray(data)
      ? data[0]
      : data;

    if (!roundId) {
      throw new Error(
        "Could not read the new custom-arena match."
      );
    }

    state.conquest.roundId =
      String(roundId);

    state.conquest.preparationText = "";
    state.customConquest.preparationText = "";

    state.conquestArena.active = false;
    state.conquestArena.busy = false;
    rd94UnbindArenaMapClick();
    rd94ClearPlacementLayers();
    rd94RenderPlacementOverlay();

    clearMultiplayerMarkers();

    await rd86PollConquestState({
      force: true
    });

    if (
      startKind === "multiplayer" &&
      state.currentPoint
    ) {
      void rd86MaybeSendConquestLocation(
        state.currentPoint,
        { force: true }
      );
    }

    showToast(
      startKind === "custom"
        ? "Custom Conquest started with host-placed A–E"
        : "Road Conquest started with host-placed A–E"
    );
  } catch (error) {
    console.error(error);

    const message =
      rd86ConquestErrorMessage(error);

    state.conquest.preparationText =
      message;
    state.customConquest.preparationText =
      message;

    state.conquestArena.busy = false;
    state.conquestArena.active = true;

    rd94BindArenaMapClick();
    rd94RenderPlacementOverlay(message);
    showToast(message);
  } finally {
    state.conquest.starting = false;
    state.customConquest.starting = false;

    renderMultiplayerState();
  }
}

async function rd94ConfirmArenaPlacement() {
  if (
    state.conquestArena.busy ||
    !rd94ArenaValidation().valid
  ) {
    return;
  }

  const safetyAccepted = window.confirm(
    "I confirm that A, B, C, D and E are safe, public and legally accessible road locations. None require stopping on a motorway, freeway, tunnel or dangerous roadside.\n\nPlayers must obey all road rules, avoid quiet residential streets and never interact with the phone while riding or driving.\n\nCreate this Custom Arena?"
  );

  if (!safetyAccepted) return;

  await rd94StartPreparedArena();
}

renderMultiplayerState = function () {
  const result =
    roadDiscoveryV94
      .renderMultiplayerState();

  rd94EnsureArenaChoices();

  if (
    state.conquestArena.active &&
    !hasActiveMultiplayerRoom()
  ) {
    rd94CancelArenaPlacement(false);
  }

  return result;
};

stopMultiplayerMode = function (
  options = {}
) {
  rd94CancelArenaPlacement(false);

  return roadDiscoveryV94
    .stopMultiplayerMode(options);
};

leaveMultiplayerRoom = async function (
  options = {}
) {
  rd94CancelArenaPlacement(false);

  return roadDiscoveryV94
    .leaveMultiplayerRoom(options);
};

function rd94InitCustomArena() {
  rd94EnsureArenaChoices();

  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        state.conquestArena.active &&
        !state.conquestArena.busy
      ) {
        rd94CancelArenaPlacement();
      }
    }
  );
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd94InitCustomArena,
    { once: true }
  );
} else {
  rd94InitCustomArena();
}

/* ================================================== */
/* Road Discovery AU v95                              */
/* Conquest Settings Cog                              */
/* ================================================== */

const roadDiscoveryV95 = {
  renderMultiplayerState,
  stopMultiplayerMode,
  leaveMultiplayerRoom
};

state.conquestSettings = {
  open: false
};

function rd95InstallConquestSettingsStyles() {
  if (
    document.getElementById(
      "rd95ConquestSettingsStyles"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "rd95ConquestSettingsStyles";

  style.textContent = `
    #conquestSetupBox.rd95-conquest-settings-host {
      position: relative;
    }

    .rd95-conquest-settings-cog {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 4;
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      padding: 0;
      border: 1px solid rgba(151, 174, 207, 0.3);
      border-radius: 12px;
      background: rgba(27, 39, 58, 0.9);
      color: #eaf3ff;
      font-family: Arial, sans-serif;
      font-size: 1.25rem;
      line-height: 1;
      box-shadow: 0 5px 14px rgba(0, 0, 0, 0.24);
      cursor: pointer;
    }

    .rd95-conquest-settings-cog:hover,
    .rd95-conquest-settings-cog:focus-visible {
      border-color: #7dc4ff;
      background: rgba(42, 113, 168, 0.42);
      outline: none;
    }

    .rd95-conquest-settings-cog:disabled {
      opacity: 0.42;
      cursor: default;
    }

    .rd95-conquest-settings-overlay {
      position: fixed;
      inset: 0;
      z-index: 6900;
      display: grid;
      place-items: center;
      padding:
        max(14px, env(safe-area-inset-top))
        12px
        max(14px, env(safe-area-inset-bottom));
      background: rgba(2, 7, 14, 0.76);
      backdrop-filter: blur(8px);
    }

    .rd95-conquest-settings-overlay.hidden {
      display: none;
    }

    .rd95-conquest-settings-panel {
      width: min(94vw, 560px);
      max-height: min(88vh, 760px);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
      border: 1px solid rgba(147, 178, 221, 0.3);
      border-radius: 20px;
      background: rgba(9, 16, 27, 0.98);
      color: #f7fbff;
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.52);
    }

    .rd95-conquest-settings-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 15px 15px 13px;
      border-bottom: 1px solid rgba(147, 178, 221, 0.18);
    }

    .rd95-conquest-settings-heading strong {
      display: block;
      font-size: 1rem;
    }

    .rd95-conquest-settings-heading span {
      display: block;
      margin-top: 3px;
      color: #9fb2cc;
      font-size: 0.76rem;
    }

    .rd95-conquest-settings-close {
      flex: 0 0 auto;
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      padding: 0;
      border: 1px solid rgba(151, 174, 207, 0.28);
      border-radius: 12px;
      background: rgba(31, 43, 61, 0.9);
      color: #f7fbff;
      font: inherit;
      font-size: 1.2rem;
      font-weight: 900;
      cursor: pointer;
    }

    .rd95-conquest-settings-content {
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 14px;
    }

    #customConquestBox.rd95-custom-conquest-inside-settings {
      margin: 0 !important;
      max-width: none !important;
    }

    #customConquestBox.rd95-custom-conquest-inside-settings:not(.hidden) {
      display: block;
    }

    @media (max-width: 520px) {
      .rd95-conquest-settings-overlay {
        place-items: end center;
        padding-left: 8px;
        padding-right: 8px;
      }

      .rd95-conquest-settings-panel {
        width: 100%;
        max-height: 91vh;
        border-radius: 20px 20px 14px 14px;
      }

      .rd95-conquest-settings-content {
        padding: 11px;
      }
    }
  `;

  document.head.appendChild(style);
}

function rd95EnsureConquestSettings() {
  rd95InstallConquestSettingsStyles();

  const conquestBox =
    document.getElementById(
      "conquestSetupBox"
    );

  const customBox =
    document.getElementById(
      "customConquestBox"
    );

  if (!conquestBox || !customBox) {
    return;
  }

  conquestBox.classList.add(
    "rd95-conquest-settings-host"
  );

  let cog = document.getElementById(
    "rd95ConquestSettingsCog"
  );

  if (!cog) {
    cog = document.createElement("button");
    cog.id = "rd95ConquestSettingsCog";
    cog.className =
      "rd95-conquest-settings-cog";
    cog.type = "button";
    cog.textContent = "⚙︎";
    cog.setAttribute(
      "aria-label",
      "Open Conquest settings"
    );
    cog.setAttribute(
      "title",
      "Conquest settings"
    );

    cog.addEventListener(
      "click",
      rd95OpenConquestSettings
    );

    conquestBox.appendChild(cog);
  }

  let overlay = document.getElementById(
    "rd95ConquestSettingsOverlay"
  );

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id =
      "rd95ConquestSettingsOverlay";
    overlay.className =
      "rd95-conquest-settings-overlay hidden";
    overlay.setAttribute(
      "aria-hidden",
      "true"
    );

    overlay.innerHTML = `
      <section
        class="rd95-conquest-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rd95ConquestSettingsTitle"
      >
        <header class="rd95-conquest-settings-heading">
          <div>
            <strong id="rd95ConquestSettingsTitle">
              Conquest Settings
            </strong>
            <span>
              Custom teams, human players and bots
            </span>
          </div>

          <button
            id="rd95ConquestSettingsClose"
            class="rd95-conquest-settings-close"
            type="button"
            aria-label="Close Conquest settings"
          >
            ×
          </button>
        </header>

        <div
          id="rd95ConquestSettingsContent"
          class="rd95-conquest-settings-content"
        ></div>
      </section>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener(
      "click",
      (event) => {
        if (event.target === overlay) {
          rd95CloseConquestSettings();
        }
      }
    );

    overlay.addEventListener(
      "click",
      (event) => {
        if (
          event.target.closest(
            "#startCustomConquestBtn"
          )
        ) {
          rd95CloseConquestSettings();
        }
      },
      true
    );

    document.getElementById(
      "rd95ConquestSettingsClose"
    )?.addEventListener(
      "click",
      rd95CloseConquestSettings
    );
  }

  const content = document.getElementById(
    "rd95ConquestSettingsContent"
  );

  if (
    content &&
    customBox.parentElement !== content
  ) {
    customBox.classList.add(
      "rd95-custom-conquest-inside-settings"
    );

    content.appendChild(customBox);
  }

  rd95RenderConquestSettings();
}

function rd95OpenConquestSettings() {
  if (
    !hasActiveMultiplayerRoom() ||
    hasActiveConquestRound() ||
    hasActiveHideSeekRound()
  ) {
    return;
  }

  state.conquestSettings.open = true;

  rd87RenderCustomConquestLobby?.();
  rd94EnsureArenaChoices?.();
  rd95RenderConquestSettings();

  window.setTimeout(() => {
    document.getElementById(
      "rd95ConquestSettingsClose"
    )?.focus();
  }, 0);
}

function rd95CloseConquestSettings() {
  state.conquestSettings.open = false;
  rd95RenderConquestSettings();
}

function rd95RenderConquestSettings() {
  const overlay = document.getElementById(
    "rd95ConquestSettingsOverlay"
  );

  const cog = document.getElementById(
    "rd95ConquestSettingsCog"
  );

  const gameBusy = Boolean(
    hasActiveConquestRound() ||
    hasActiveHideSeekRound() ||
    state.conquest.starting ||
    state.customConquest.starting ||
    state.hideSeek.starting
  );

  if (gameBusy) {
    state.conquestSettings.open = false;
  }

  if (cog) {
    cog.disabled = Boolean(
      !hasActiveMultiplayerRoom() ||
      gameBusy
    );

    cog.setAttribute(
      "aria-expanded",
      state.conquestSettings.open
        ? "true"
        : "false"
    );
  }

  if (overlay) {
    overlay.classList.toggle(
      "hidden",
      !state.conquestSettings.open
    );

    overlay.setAttribute(
      "aria-hidden",
      state.conquestSettings.open
        ? "false"
        : "true"
    );
  }
}

renderMultiplayerState = function () {
  const result =
    roadDiscoveryV95
      .renderMultiplayerState();

  rd95EnsureConquestSettings();
  rd95RenderConquestSettings();

  return result;
};

stopMultiplayerMode = function (
  options = {}
) {
  rd95CloseConquestSettings();

  return roadDiscoveryV95
    .stopMultiplayerMode(options);
};

leaveMultiplayerRoom = async function (
  options = {}
) {
  rd95CloseConquestSettings();

  return roadDiscoveryV95
    .leaveMultiplayerRoom(options);
};

function rd95InitConquestSettings() {
  rd95EnsureConquestSettings();

  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        state.conquestSettings.open
      ) {
        rd95CloseConquestSettings();
      }
    }
  );
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd95InitConquestSettings,
    { once: true }
  );
} else {
  rd95InitConquestSettings();
}

/* ================================================== */
/* Road Discovery AU v97                              */
/* One Objective May Use The Rally Area               */
/* ================================================== */

rd94ArenaValidation = function () {
  const points =
    state.conquestArena.objectives;

  const pairDistances =
    rd94PairDistances(points);

  const minimumGap =
    pairDistances.length > 0
      ? Math.min(...pairDistances)
      : 0;

  const span =
    pairDistances.length > 0
      ? Math.max(...pairDistances)
      : 0;

  const centreDistances =
    state.conquestArena.centre
      ? points.map((point) =>
          haversine(
            state.conquestArena.centre,
            point
          )
        )
      : [];

  const rallyObjectiveCount =
    centreDistances.filter(
      (distance) =>
        distance <
          RD94_ARENA_MIN_CENTRE_M
    ).length;

  const allInCentreRing = Boolean(
    rallyObjectiveCount <= 1 &&
    centreDistances.every(
      (distance) =>
        distance <=
          RD94_ARENA_MAX_CENTRE_M
    )
  );

  const complete =
    points.length ===
      RD94_ARENA_OBJECTIVE_CODES.length;

  const valid = Boolean(
    complete &&
    allInCentreRing &&
    minimumGap >=
      RD94_ARENA_MIN_OBJECTIVE_GAP_M &&
    span >= RD94_ARENA_MIN_SPAN_M &&
    span <= RD94_ARENA_MAX_SPAN_M
  );

  return {
    complete,
    valid,
    minimumGap,
    span,
    allInCentreRing,
    rallyObjectiveCount
  };
};


rd94ValidateNewObjective = function (
  point,
  replacingCode = ""
) {
  const centre =
    state.conquestArena.centre;

  if (!centre) {
    return {
      valid: false,
      message:
        "The arena centre is unavailable."
    };
  }

  const centreDistance =
    haversine(centre, point);

  if (
    centreDistance >
      RD94_ARENA_MAX_CENTRE_M
  ) {
    return {
      valid: false,
      message:
        "Keep every objective within 2,000 metres of Rally."
    };
  }

  const anotherObjectiveUsesRally =
    state.conquestArena.objectives.some(
      (objective) =>
        objective.code !== replacingCode &&
        haversine(centre, objective) <
          RD94_ARENA_MIN_CENTRE_M
    );

  if (
    centreDistance <
      RD94_ARENA_MIN_CENTRE_M &&
    anotherObjectiveUsesRally
  ) {
    return {
      valid: false,
      message:
        "Only one objective can be placed inside the Rally area."
    };
  }

  for (
    const objective of
    state.conquestArena.objectives
  ) {
    if (
      objective.code === replacingCode
    ) {
      continue;
    }

    if (
      haversine(objective, point) <
      RD94_ARENA_MIN_OBJECTIVE_GAP_M
    ) {
      return {
        valid: false,
        message:
          `Too close to ${objective.code}. Keep every objective at least 650 metres apart.`
      };
    }
  }

  return {
    valid: true,
    message: ""
  };
};


function rd97UpdateRallyObjectiveInstructions() {
  const instruction =
    document.querySelector(
      ".rd94-arena-heading span"
    );

  if (instruction) {
    instruction.textContent =
      "Tap safe public roads. One objective may be placed inside Rally. Tap a placed letter to remove it, or drag its marker.";
  }
}


if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd97UpdateRallyObjectiveInstructions,
    { once: true }
  );
} else {
  rd97UpdateRallyObjectiveInstructions();
}

/* ================================================== */
/* Road Discovery AU v98                              */
/* Cleaner Conquest Settings + Match Length           */
/* ================================================== */

const RD98_CONQUEST_DURATIONS = [
  20,
  28,
  40,
  60
];

state.customConquest.matchDurationMinutes = 28;

const roadDiscoveryV98 = {
  renderMultiplayerState
};


function rd98SafeConquestDuration(value) {
  const duration = Number(value);

  return RD98_CONQUEST_DURATIONS.includes(
    duration
  )
    ? duration
    : 28;
}


function rd98HidePresetButtons() {
  const presetButtons = [
    document.getElementById(
      "customConquestPresetWatchBtn"
    ),
    document.getElementById(
      "customConquestPresetPlayBtn"
    ),
    document.getElementById(
      "customConquestPresetChallengeBtn"
    )
  ].filter(Boolean);

  for (const button of presetButtons) {
    button.hidden = true;
    button.style.display = "none";
  }

  const sharedParent =
    presetButtons.length > 0 &&
    presetButtons.every(
      (button) =>
        button.parentElement ===
          presetButtons[0].parentElement
    )
      ? presetButtons[0].parentElement
      : null;

  if (sharedParent) {
    sharedParent.hidden = true;
    sharedParent.style.display = "none";
  }
}


function rd98InstallDurationStyles() {
  if (
    document.getElementById(
      "rd98ConquestDurationStyles"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "rd98ConquestDurationStyles";

  style.textContent = `
    .rd98-conquest-duration {
      display: grid;
      gap: 9px;
      margin: 14px 0;
      padding: 12px;
      border: 1px solid rgba(143, 164, 196, 0.24);
      border-radius: 16px;
      background: rgba(12, 19, 31, 0.58);
    }

    .rd98-conquest-duration-title {
      font-size: 0.78rem;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #dce9ff;
    }

    .rd98-conquest-duration-options {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 7px;
    }

    .rd98-conquest-duration-btn {
      min-height: 42px;
      padding: 8px 6px;
      border: 1px solid rgba(156, 177, 210, 0.28);
      border-radius: 12px;
      background: rgba(27, 38, 56, 0.86);
      color: #f5f9ff;
      font: inherit;
      font-size: 0.8rem;
      font-weight: 850;
      cursor: pointer;
    }

    .rd98-conquest-duration-btn.active {
      border-color: #b686ff;
      background: rgba(118, 65, 190, 0.38);
      box-shadow:
        0 0 0 1px rgba(182, 134, 255, 0.28) inset;
    }

    .rd98-conquest-duration-btn:disabled {
      opacity: 0.44;
      cursor: default;
    }

    .rd98-conquest-duration-note {
      margin: 0;
      color: #9fb2cc;
      font-size: 0.74rem;
      line-height: 1.35;
    }

    @media (max-width: 420px) {
      .rd98-conquest-duration-options {
        grid-template-columns: 1fr 1fr;
      }
    }
  `;

  document.head.appendChild(style);
}


function rd98DurationLabel(minutes) {
  return minutes === 60
    ? "1 hour"
    : `${minutes} min`;
}


function rd98EnsureDurationSetting() {
  rd98InstallDurationStyles();
  rd98HidePresetButtons();

  const customBox =
    document.getElementById(
      "customConquestBox"
    );

  if (!customBox) return;

  let durationBox =
    document.getElementById(
      "rd98ConquestDuration"
    );

  if (!durationBox) {
    durationBox =
      document.createElement("section");

    durationBox.id =
      "rd98ConquestDuration";

    durationBox.className =
      "rd98-conquest-duration";

    durationBox.innerHTML = `
      <div class="rd98-conquest-duration-title">
        Match length
      </div>

      <div class="rd98-conquest-duration-options">
        ${RD98_CONQUEST_DURATIONS
          .map(
            (minutes) => `
              <button
                class="rd98-conquest-duration-btn"
                type="button"
                data-rd98-duration="${minutes}"
              >
                ${rd98DurationLabel(minutes)}
              </button>
            `
          )
          .join("")}
      </div>

      <p class="rd98-conquest-duration-note">
        The match timer starts after Rally, deployment and the ten-second countdown.
      </p>
    `;

    durationBox.addEventListener(
      "click",
      (event) => {
        const button =
          event.target.closest(
            "[data-rd98-duration]"
          );

        if (
          !button ||
          button.disabled ||
          !rd87IsRoomCreator()
        ) {
          return;
        }

        state.customConquest
          .matchDurationMinutes =
            rd98SafeConquestDuration(
              button.dataset
                .rd98Duration
            );

        rd98RenderDurationSetting();
      }
    );

    const arenaChoice =
      customBox.querySelector(
        '[data-rd94-arena-choice="custom"]'
      );

    if (arenaChoice) {
      arenaChoice.parentNode.insertBefore(
        durationBox,
        arenaChoice
      );
    } else {
      const startButton =
        document.getElementById(
          "startCustomConquestBtn"
        );

      customBox.insertBefore(
        durationBox,
        startButton || null
      );
    }
  }

  rd98RenderDurationSetting();
}


function rd98RenderDurationSetting() {
  const duration =
    rd98SafeConquestDuration(
      state.customConquest
        .matchDurationMinutes
    );

  state.customConquest
    .matchDurationMinutes = duration;

  const isHost = rd87IsRoomCreator();
  const gameBusy = Boolean(
    hasActiveConquestRound() ||
    hasActiveHideSeekRound() ||
    state.conquest.starting ||
    state.customConquest.starting
  );

  for (
    const button of
    document.querySelectorAll(
      "[data-rd98-duration]"
    )
  ) {
    const buttonDuration = Number(
      button.dataset.rd98Duration
    );

    button.classList.toggle(
      "active",
      buttonDuration === duration
    );

    button.disabled = Boolean(
      !isHost || gameBusy
    );

    button.setAttribute(
      "aria-pressed",
      buttonDuration === duration
        ? "true"
        : "false"
    );
  }
}


function rd98InstallDurationRpcBridge() {
  const client = state.auth.client;

  if (
    !client ||
    client.rd98DurationBridgeInstalled
  ) {
    return;
  }

  const originalRpc =
    client.rpc.bind(client);

  client.rpc = function (
    functionName,
    parameters = {},
    options
  ) {
    if (
      functionName ===
        "start_custom_conquest_round" ||
      functionName ===
        "start_custom_conquest_round_custom_arena"
    ) {
      parameters = {
        ...parameters,
        p_match_duration_minutes:
          rd98SafeConquestDuration(
            state.customConquest
              .matchDurationMinutes
          )
      };
    }

    return originalRpc(
      functionName,
      parameters,
      options
    );
  };

  client.rd98DurationBridgeInstalled = true;
}


renderMultiplayerState = function () {
  rd98InstallDurationRpcBridge();

  const result =
    roadDiscoveryV98
      .renderMultiplayerState();

  rd98EnsureDurationSetting();

  return result;
};


function rd98InitConquestDuration() {
  rd98InstallDurationRpcBridge();
  rd98EnsureDurationSetting();

  document.getElementById(
    "customConquestBox"
  )?.addEventListener(
    "click",
    (event) => {
      if (
        event.target.closest(
          "#startCustomConquestBtn"
        )
      ) {
        rd98InstallDurationRpcBridge();
      }
    },
    true
  );
}


if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd98InitConquestDuration,
    { once: true }
  );
} else {
  rd98InitConquestDuration();
}

/* ================================================== */
/* Road Discovery AU v99                              */
/* One Multiplayer Safety Notice                      */
/* ================================================== */

const roadDiscoveryV99 = {
  renderMultiplayerState
};


function rd99InstallMultiplayerSafetyStyles() {
  if (
    document.getElementById(
      "rd99MultiplayerSafetyStyles"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "rd99MultiplayerSafetyStyles";

  style.textContent = `
    .rd99-multiplayer-safety-note {
      margin: 18px 0 12px;
    }

    .rd99-multiplayer-safety-note strong {
      color: #ffd7ab;
    }
  `;

  document.head.appendChild(style);
}


function rd99MoveMultiplayerSafetyNotice() {
  rd99InstallMultiplayerSafetyStyles();

  /* Remove the duplicate Hide & Seek menu notice. */
  document.querySelectorAll(
    "#hideSeekSetupBox .hide-seek-safety-note"
  ).forEach((notice) => notice.remove());

  /* Remove the duplicate Conquest menu notice. */
  document.querySelectorAll(
    "#conquestSetupBox .conquest-safety-note"
  ).forEach((notice) => notice.remove());

  const leaveButton =
    document.getElementById(
      "leaveMultiplayerRoomBtn"
    );

  if (!leaveButton?.parentNode) {
    return;
  }

  let notice =
    document.getElementById(
      "rd99MultiplayerSafetyNotice"
    );

  if (!notice) {
    notice =
      document.createElement("div");

    notice.id =
      "rd99MultiplayerSafetyNotice";

    notice.className =
      "conquest-safety-note " +
      "rd99-multiplayer-safety-note";

    notice.innerHTML = `
      <strong>Play safely.</strong>
      Follow all road rules. Do not speed. Do not stop
      somewhere dangerous. Set up the game before moving
      and never interact with the phone while riding or
      driving.
    `;
  }

  if (
    notice.parentNode !==
      leaveButton.parentNode ||
    notice.nextElementSibling !==
      leaveButton
  ) {
    leaveButton.parentNode.insertBefore(
      notice,
      leaveButton
    );
  }
}


renderMultiplayerState = function () {
  const result =
    roadDiscoveryV99
      .renderMultiplayerState();

  rd99MoveMultiplayerSafetyNotice();

  return result;
};


function rd99InitMultiplayerSafetyNotice() {
  rd99MoveMultiplayerSafetyNotice();
}


if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd99InitMultiplayerSafetyNotice,
    { once: true }
  );
} else {
  rd99InitMultiplayerSafetyNotice();
}

/* ================================================== */
/* Road Discovery AU v100                             */
/* Clear Multiplayer Game Mode Dividers               */
/* ================================================== */

const roadDiscoveryV100 = {
  renderMultiplayerState
};


function rd100InstallGameModeDividerStyles() {
  if (
    document.getElementById(
      "rd100GameModeDividerStyles"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "rd100GameModeDividerStyles";

  style.textContent = `
    #multiplayerActiveBox > .hide-seek-divider,
    #multiplayerActiveBox > .conquest-divider {
      display: none !important;
    }

    .rd100-game-modes-title {
      margin: 20px 0 12px;
      color: #eef4ff;
      font-size: 1rem;
      font-weight: 950;
      line-height: 1.2;
      letter-spacing: 0.015em;
    }

    .rd100-game-mode-divider {
      width: 100%;
      height: 1px;
      margin: 14px 0;
      border: 0;
      background: rgba(133, 58, 58, 0.68);
      box-shadow: none;
    }

    .rd100-game-modes-title +
      .rd100-game-mode-divider {
      margin-top: 0;
    }
  `;

  document.head.appendChild(style);
}


function rd100CreateDivider(id) {
  let divider =
    document.getElementById(id);

  if (!divider) {
    divider =
      document.createElement("div");

    divider.id = id;
    divider.className =
      "rd100-game-mode-divider";

    divider.setAttribute(
      "aria-hidden",
      "true"
    );
  }

  return divider;
}


function rd100FirstElementInParent(
  parent,
  elements
) {
  return elements
    .filter(
      (element) =>
        element?.parentNode === parent
    )
    .sort((first, second) => {
      const position =
        first.compareDocumentPosition(
          second
        );

      return position &
        Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1;
    })[0] || null;
}


function rd100EnsureGameModeDividers() {
  rd100InstallGameModeDividerStyles();

  const leaveButton =
    document.getElementById(
      "leaveMultiplayerRoomBtn"
    );

  const parent = leaveButton?.parentNode;

  if (!parent) return;

  const hideSeekAnchor =
    rd100FirstElementInParent(
      parent,
      [
        document.getElementById(
          "hideSeekSetupBox"
        ),
        document.getElementById(
          "hideSeekGameBox"
        )
      ]
    );

  const conquestAnchor =
    rd100FirstElementInParent(
      parent,
      [
        document.getElementById(
          "conquestSetupBox"
        ),
        document.getElementById(
          "conquestGameBox"
        )
      ]
    );

  if (!hideSeekAnchor || !conquestAnchor) {
    return;
  }

  let title =
    document.getElementById(
      "rd100GameModesTitle"
    );

  if (!title) {
    title = document.createElement("h3");
    title.id = "rd100GameModesTitle";
    title.className =
      "rd100-game-modes-title";
    title.textContent = "Game modes";
  }

  const topDivider =
    rd100CreateDivider(
      "rd100BeforeHideSeekDivider"
    );

  const middleDivider =
    rd100CreateDivider(
      "rd100AfterHideSeekDivider"
    );

  const bottomDivider =
    rd100CreateDivider(
      "rd100AfterConquestDivider"
    );

  parent.insertBefore(
    title,
    hideSeekAnchor
  );

  parent.insertBefore(
    topDivider,
    hideSeekAnchor
  );

  parent.insertBefore(
    middleDivider,
    conquestAnchor
  );

  const safetyNotice =
    document.getElementById(
      "rd99MultiplayerSafetyNotice"
    );

  parent.insertBefore(
    bottomDivider,
    safetyNotice?.parentNode === parent
      ? safetyNotice
      : leaveButton
  );
}


renderMultiplayerState = function () {
  const result =
    roadDiscoveryV100
      .renderMultiplayerState();

  rd100EnsureGameModeDividers();

  return result;
};


function rd100InitGameModeDividers() {
  rd100EnsureGameModeDividers();
}


if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd100InitGameModeDividers,
    { once: true }
  );
} else {
  rd100InitGameModeDividers();
}

/* ================================================== */
/* Road Discovery AU v101                             */
/* Custom Conquest Minimum + Highlighted Labels       */
/* ================================================== */

const RD101_CONQUEST_MIN_ROOM_RIDERS = 2;

const roadDiscoveryV101 = {
  renderMultiplayerState
};


function rd101InstallConquestSettingStyles() {
  if (
    document.getElementById(
      "rd101ConquestSettingStyles"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "rd101ConquestSettingStyles";

  style.textContent = `
    #customConquestBox
      .custom-conquest-section-title {
      color: #ffc857 !important;
    }
  `;

  document.head.appendChild(style);
}


function rd101ConquestRoomRiderCount() {
  return Array.isArray(
    state.multiplayer.members
  )
    ? state.multiplayer.members.length
    : 0;
}


function rd101ApplyCustomConquestMinimum() {
  rd101InstallConquestSettingStyles();

  const memberCount =
    rd101ConquestRoomRiderCount();

  const startButton =
    document.getElementById(
      "startCustomConquestBtn"
    );

  const preparationText =
    document.getElementById(
      "customConquestPreparationText"
    );

  if (
    startButton &&
    memberCount <
      RD101_CONQUEST_MIN_ROOM_RIDERS
  ) {
    startButton.disabled = true;
  }

  if (
    preparationText &&
    memberCount <
      RD101_CONQUEST_MIN_ROOM_RIDERS &&
    !state.customConquest.starting
  ) {
    preparationText.textContent =
      "At least 2 riders must be in the room.";
  }
}


function rd101BlockSingleRiderCustomConquest(
  event
) {
  const startButton = event.target.closest(
    "#startCustomConquestBtn"
  );

  if (
    !startButton ||
    rd101ConquestRoomRiderCount() >=
      RD101_CONQUEST_MIN_ROOM_RIDERS
  ) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  showToast(
    "Road Conquest needs at least 2 riders"
  );
}


function rd101BindCustomConquestMinimum() {
  if (
    document.documentElement.dataset
      .rd101ConquestMinimumBound === "true"
  ) {
    return;
  }

  document.documentElement.dataset
    .rd101ConquestMinimumBound = "true";

  document.addEventListener(
    "click",
    rd101BlockSingleRiderCustomConquest,
    true
  );
}


renderMultiplayerState = function () {
  const result =
    roadDiscoveryV101
      .renderMultiplayerState();

  rd101ApplyCustomConquestMinimum();

  return result;
};


function rd101InitConquestMinimum() {
  rd101InstallConquestSettingStyles();
  rd101BindCustomConquestMinimum();
  rd101ApplyCustomConquestMinimum();
}


if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd101InitConquestMinimum,
    { once: true }
  );
} else {
  rd101InitConquestMinimum();
}

/* ================================================== */
/* Road Discovery AU v102                             */
/* Single Dark Centreline for Discovered Roads        */
/* ================================================== */

const RD102_TRAIL_CORE_COLOUR = "#050608";

const roadDiscoveryV102 = {
  drawSavedSegment,
  drawSavedSegments,
  resetDiscoveredRoads,
  rd53ApplyRoadLayerVisibility,
  rd53ApplySavedRoadZoomStyle
};

Object.assign(state, {
  rd102TrailCoreGroup: null,
  rd102TrailCoreBase: null,
  rd102TrailCoreLive: null,
  rd102TrailCoreKnownIds: new Set(),
  rd102TrailCoreLiveCoords: [],
  rd102TrailCoreBulkDraw: false
});

function rd102TrailCoreStyle() {
  const zoom = Number(state.map?.getZoom?.());

  if (!Number.isFinite(zoom) || zoom >= 14) {
    return { weight: 1.45, opacity: 0.78 };
  }

  if (zoom >= 13) {
    return { weight: 0.9, opacity: 0.72 };
  }

  if (zoom >= 12) {
    return { weight: 0.62, opacity: 0.65 };
  }

  if (zoom >= 10) {
    return { weight: 0.4, opacity: 0.58 };
  }

  if (zoom >= 8) {
    return { weight: 0.3, opacity: 0.5 };
  }

  return { weight: 0.22, opacity: 0.44 };
}

function rd102CreateTrailCoreLayers() {
  if (!window.L || !state.map) return false;

  if (!state.rd102TrailCoreGroup) {
    state.rd102TrailCoreGroup = L.layerGroup();
  }

  const options = {
    color: RD102_TRAIL_CORE_COLOUR,
    ...rd102TrailCoreStyle(),
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  };

  if (!state.rd102TrailCoreBase) {
    state.rd102TrailCoreBase = L.polyline(
      [],
      options
    ).addTo(state.rd102TrailCoreGroup);
  }

  if (!state.rd102TrailCoreLive) {
    state.rd102TrailCoreLive = L.polyline(
      [],
      options
    ).addTo(state.rd102TrailCoreGroup);
  }

  return true;
}

function rd102KeepCorrectLayerOrder() {
  state.rd102TrailCoreBase?.bringToFront?.();
  state.rd102TrailCoreLive?.bringToFront?.();

  [
    state.routeHalo,
    state.routeLine,
    state.hideSeek?.routeHalo,
    state.hideSeek?.routeLine,
    state.conquest?.routeHalo,
    state.conquest?.routeLine
  ].forEach((layer) => layer?.bringToFront?.());
}

function rd102HasTrailCoreRoads() {
  return (
    state.rd102TrailCoreKnownIds.size > 0 ||
    state.rd102TrailCoreLiveCoords.length > 0
  );
}

function rd102SyncTrailCoreVisibility() {
  if (!rd102CreateTrailCoreLayers()) return;

  const group = state.rd102TrailCoreGroup;
  const visible = state.map.hasLayer(group);

  const shouldShow = Boolean(
    state.savedLayer &&
    state.map.hasLayer(state.savedLayer) &&
    rd102HasTrailCoreRoads()
  );

  if (shouldShow && !visible) {
    group.addTo(state.map);
    rd102KeepCorrectLayerOrder();
  } else if (!shouldShow && visible) {
    state.map.removeLayer(group);
  }
}

function rd102ApplyTrailCoreStyle() {
  if (!rd102CreateTrailCoreLayers()) return;

  const style = {
    color: RD102_TRAIL_CORE_COLOUR,
    ...rd102TrailCoreStyle()
  };

  state.rd102TrailCoreBase.setStyle(style);
  state.rd102TrailCoreLive.setStyle(style);
}

function rd102RebuildTrailCore() {
  if (!rd102CreateTrailCoreLayers()) return;

  const coordinates = [];
  const knownIds = new Set();

  Object.values(state.savedSegments || {}).forEach(
    (segment) => {
      if (
        !segment?.id ||
        !validCoords(segment.coords)
      ) {
        return;
      }

      knownIds.add(segment.id);
      coordinates.push(segment.coords);
    }
  );

  state.rd102TrailCoreKnownIds = knownIds;
  state.rd102TrailCoreLiveCoords = [];

  state.rd102TrailCoreBase.setLatLngs(
    coordinates
  );

  state.rd102TrailCoreLive.setLatLngs([]);

  rd102ApplyTrailCoreStyle();
  rd102SyncTrailCoreVisibility();
  rd102KeepCorrectLayerOrder();
}

function rd102AddTrailCoreSegment(segment) {
  if (
    !segment?.id ||
    !validCoords(segment.coords) ||
    state.rd102TrailCoreKnownIds.has(segment.id) ||
    !rd102CreateTrailCoreLayers()
  ) {
    return;
  }

  state.rd102TrailCoreKnownIds.add(segment.id);

  state.rd102TrailCoreLiveCoords.push(
    segment.coords
  );

  /*
    Only redraw roads unlocked during this session.
    The full saved trail is not rebuilt after every
    GPS update.
  */
  state.rd102TrailCoreLive.setLatLngs(
    state.rd102TrailCoreLiveCoords
  );

  rd102ApplyTrailCoreStyle();
  rd102SyncTrailCoreVisibility();
  rd102KeepCorrectLayerOrder();
}

drawSavedSegment = function (segment) {
  const wasDrawn = Boolean(
    segment?.id &&
    state.savedDrawnIds.has(segment.id)
  );

  const result =
    roadDiscoveryV102.drawSavedSegment(segment);

  if (
    !state.rd102TrailCoreBulkDraw &&
    !wasDrawn &&
    segment?.id &&
    state.savedDrawnIds.has(segment.id)
  ) {
    rd102AddTrailCoreSegment(segment);
  }

  return result;
};

drawSavedSegments = function () {
  state.rd102TrailCoreBulkDraw = true;

  try {
    return roadDiscoveryV102.drawSavedSegments();
  } finally {
    state.rd102TrailCoreBulkDraw = false;
    rd102RebuildTrailCore();
  }
};

resetDiscoveredRoads = function () {
  const result =
    roadDiscoveryV102.resetDiscoveredRoads();

  rd102RebuildTrailCore();

  return result;
};

rd53ApplyRoadLayerVisibility = function () {
  const result =
    roadDiscoveryV102
      .rd53ApplyRoadLayerVisibility();

  rd102SyncTrailCoreVisibility();

  return result;
};

rd53ApplySavedRoadZoomStyle = function () {
  const result =
    roadDiscoveryV102
      .rd53ApplySavedRoadZoomStyle();

  rd102ApplyTrailCoreStyle();

  return result;
};

function rd102InitTrailCore() {
  rd102RebuildTrailCore();

  state.map?.on?.(
    "zoomend",
    rd102ApplyTrailCoreStyle
  );
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd102InitTrailCore,
    { once: true }
  );
} else {
  rd102InitTrailCore();
}

/* ================================================== */
/* Road Discovery AU v103                             */
/* Optional Discovered-Road Centreline Setting        */
/* ================================================== */

const RD103_TRAIL_CENTRELINE_KEY =
  "roadDiscoveryAU.trailCentreline.v1";

const roadDiscoveryV103 = {
  rd102SyncTrailCoreVisibility
};

state.trailCentrelineVisible =
  rd103LoadTrailCentrelinePreference();

function rd103LoadTrailCentrelinePreference() {
  try {
    /* Enabled by default for existing and new users. */
    return (
      localStorage.getItem(
        RD103_TRAIL_CENTRELINE_KEY
      ) !== "false"
    );
  } catch (error) {
    console.error(error);
    return true;
  }
}

function rd103SaveTrailCentrelinePreference() {
  try {
    localStorage.setItem(
      RD103_TRAIL_CENTRELINE_KEY,
      String(state.trailCentrelineVisible)
    );
  } catch (error) {
    console.error(error);

    showToast(
      "Could not save trail centreline setting"
    );
  }
}

function rd103UpdateTrailCentrelineToggle() {
  const toggle = document.getElementById(
    "rd103TrailCentrelineToggle"
  );

  if (toggle) {
    toggle.checked = Boolean(
      state.trailCentrelineVisible
    );
  }
}

function rd103InsertTrailCentrelineSetting() {
  if (
    document.getElementById(
      "rd103TrailCentrelineSetting"
    )
  ) {
    rd103UpdateTrailCentrelineToggle();
    return;
  }

  const trailColourSetting =
    document.getElementById(
      "trailColourSetting"
    );

  if (!trailColourSetting) return;

  const setting =
    document.createElement("label");

  setting.id =
    "rd103TrailCentrelineSetting";

  setting.className = "toggle-row";

  setting.htmlFor =
    "rd103TrailCentrelineToggle";

  setting.style.marginTop = "12px";

  setting.innerHTML = `
    <div class="toggle-text">
      <strong>Dark trail centreline</strong>

      <span>
        Adds a thin black line through discovered roads
        so dense areas remain separated when zoomed out.
      </span>
    </div>

    <input
      id="rd103TrailCentrelineToggle"
      class="toggle-input"
      type="checkbox"
    />

    <span
      class="toggle-switch"
      aria-hidden="true"
    >
      <span class="toggle-knob"></span>
    </span>
  `;

  trailColourSetting.insertAdjacentElement(
    "afterend",
    setting
  );

  const toggle = document.getElementById(
    "rd103TrailCentrelineToggle"
  );

  toggle.checked = Boolean(
    state.trailCentrelineVisible
  );

  toggle.addEventListener(
    "change",
    (event) => {
      state.trailCentrelineVisible = Boolean(
        event.currentTarget.checked
      );

      rd103SaveTrailCentrelinePreference();
      rd102SyncTrailCoreVisibility();

      showToast(
        state.trailCentrelineVisible
          ? "Trail centreline on"
          : "Trail centreline off"
      );
    }
  );
}

rd102SyncTrailCoreVisibility = function () {
  if (!state.trailCentrelineVisible) {
    const group = state.rd102TrailCoreGroup;

    if (
      group &&
      state.map?.hasLayer?.(group)
    ) {
      state.map.removeLayer(group);
    }

    return;
  }

  return roadDiscoveryV103
    .rd102SyncTrailCoreVisibility();
};

function rd103InitTrailCentrelineSetting() {
  rd103InsertTrailCentrelineSetting();
  rd103UpdateTrailCentrelineToggle();
  rd102SyncTrailCoreVisibility();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd103InitTrailCentrelineSetting,
    { once: true }
  );
} else {
  rd103InitTrailCentrelineSetting();
}

/* ================================================== */
/* Road Discovery AU v104                             */
/* Waypoint Pin + Front-Facing My Places House        */
/* ================================================== */

function rd104ToolIconSvg(pathMarkup) {
  return `
    <svg
      class="places-tool-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      ${pathMarkup}
    </svg>
  `;
}

function rd104WaypointPinSvg() {
  return rd104ToolIconSvg(`
    <path
      d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z"
    ></path>

    <circle
      cx="12"
      cy="10"
      r="2.25"
    ></circle>
  `);
}

function rd104FrontHouseSvg() {
  return rd104ToolIconSvg(`
    <path
      d="M3.25 11.25 12 3.75l8.75 7.5"
    ></path>

    <path
      d="M5 10.25V20h14v-9.75"
    ></path>

    <path
      d="M9.5 20v-6h5v6"
    ></path>
  `);
}

/*
  My Places uses this function whenever its toolbar
  button is first created.
*/
rd63ToolButtonSvg = function () {
  return rd104FrontHouseSvg();
};

function rd104ApplyMainToolIcons() {
  const waypointButton =
    document.getElementById("waypointBtn");

  const placesButton =
    document.getElementById("placesBtn");

  if (waypointButton) {
    waypointButton.innerHTML =
      rd104WaypointPinSvg();
  }

  if (placesButton) {
    placesButton.innerHTML =
      rd104FrontHouseSvg();
  }
}

function rd104InitMainToolIcons() {
  rd104ApplyMainToolIcons();

  /*
    Covers the same startup frame in which My Places
    creates its toolbar button.
  */
  window.requestAnimationFrame(
    rd104ApplyMainToolIcons
  );
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd104InitMainToolIcons,
    { once: true }
  );
} else {
  rd104InitMainToolIcons();
}

/* ================================================== */
/* Road Discovery AU v105                             */
/* Allow Solo Human vs Bots in Custom Conquest        */
/* ================================================== */

const roadDiscoveryV105 = {
  blockedSingleRiderHandler:
    rd101BlockSingleRiderCustomConquest
};

/*
  Custom Conquest already validates the real matchup:
  Red and Blue must each contain at least one human or
  bot, with no more than four participants per team.

  The additional v101 room-member check is therefore
  removed from Custom Conquest only. Standard Conquest
  still requires at least two real room riders.
*/
rd101ApplyCustomConquestMinimum = function () {
  rd101InstallConquestSettingStyles();
};

rd101BlockSingleRiderCustomConquest = function () {
  /* Match validity is handled by rd87CustomRoster. */
};

rd101BindCustomConquestMinimum = function () {
  document.removeEventListener(
    "click",
    roadDiscoveryV105.blockedSingleRiderHandler,
    true
  );

  document.documentElement.dataset
    .rd101ConquestMinimumBound = "matchup";
};

function rd105InitSoloCustomConquest() {
  rd101BindCustomConquestMinimum();
  rd101InstallConquestSettingStyles();

  /*
    Recalculate the start button from the selected
    humans and bots, clearing the old two-rider text.
  */
  renderMultiplayerState();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    rd105InitSoloCustomConquest,
    { once: true }
  );
} else {
  rd105InitSoloCustomConquest();
}

/* ================================================== */
/* Road Discovery AU v106                             */
/* Custom Conquest Roster Confirmation + Bot AI       */
/* ================================================== */

const RD106_BOT_DIFFICULTIES = [
  "easy",
  "normal",
  "hard",
  "unfair"
];

const roadDiscoveryV106 = {
  renderMultiplayerState,
  rd87RenderCustomConquestLobby,
  rd94RenderArenaChoices,
  rd95CloseConquestSettings,
  stopMultiplayerMode,
  leaveMultiplayerRoom
};

Object.assign(state.customConquest, {
  confirmingRoster: false,
  confirmedStart: false,
  botDifficulties: {
    red: [],
    blue: []
  }
});


function rd106SafeBotDifficulty(value) {
  const difficulty = String(
    value || ""
  ).toLowerCase();

  return RD106_BOT_DIFFICULTIES.includes(
    difficulty
  )
    ? difficulty
    : "normal";
}


function rd106DifficultyLabel(value) {
  const difficulty =
    rd106SafeBotDifficulty(value);

  return difficulty.charAt(0).toUpperCase() +
    difficulty.slice(1);
}


function rd106SyncBotDifficulties() {
  const roster = rd87CustomRoster();

  for (const team of ["red", "blue"]) {
    const count = team === "red"
      ? roster.redBots
      : roster.blueBots;

    const existing = Array.isArray(
      state.customConquest.botDifficulties?.[team]
    )
      ? state.customConquest.botDifficulties[team]
      : [];

    state.customConquest.botDifficulties[team] =
      Array.from(
        { length: count },
        (_, index) =>
          rd106SafeBotDifficulty(
            existing[index]
          )
      );
  }

  return roster;
}


function rd106BotDifficultyPayload() {
  rd106SyncBotDifficulties();

  return {
    red:
      state.customConquest.botDifficulties
        .red.slice(),

    blue:
      state.customConquest.botDifficulties
        .blue.slice()
  };
}


function rd106InstallStyles() {
  if (
    document.getElementById(
      "rd106CustomConquestStyles"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "rd106CustomConquestStyles";

  style.textContent = `
    #customConquestBox.rd106-confirming-roster
      > :not(#rd106CustomConquestReview) {
      display: none !important;
    }

    #rd106CustomConquestReview[hidden] {
      display: none !important;
    }

    .rd106-review {
      display: grid;
      gap: 13px;
    }

    .rd106-review-heading {
      display: grid;
      gap: 4px;
    }

    .rd106-review-heading strong {
      color: #f7fbff;
      font-size: 1.05rem;
      font-weight: 950;
    }

    .rd106-review-heading span {
      color: #9fb2cc;
      font-size: 0.76rem;
      line-height: 1.4;
    }

    .rd106-review-summary {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid
        rgba(168, 124, 255, 0.34);
      border-radius: 13px;
      background:
        rgba(96, 53, 157, 0.2);
      color: #f5edff;
      font-size: 0.78rem;
      font-weight: 850;
    }

    .rd106-roster-section {
      display: grid;
      gap: 8px;
    }

    .rd106-roster-title {
      color: #ffc857;
      font-size: 0.75rem;
      font-weight: 950;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .rd106-roster-list {
      display: grid;
      gap: 7px;
    }

    .rd106-roster-row {
      min-height: 46px;
      display: grid;
      grid-template-columns:
        minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      padding: 8px 9px 8px 11px;
      border: 1px solid
        rgba(151, 174, 207, 0.2);
      border-radius: 12px;
      background:
        rgba(19, 29, 44, 0.72);
    }

    .rd106-roster-row.red {
      border-left: 3px solid
        rgba(255, 82, 92, 0.78);
    }

    .rd106-roster-row.blue {
      border-left: 3px solid
        rgba(75, 166, 255, 0.82);
    }

    .rd106-roster-person {
      min-width: 0;
      display: grid;
      gap: 2px;
    }

    .rd106-roster-person strong {
      overflow: hidden;
      color: #f6f9ff;
      font-size: 0.78rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .rd106-roster-person span {
      color: #92a6c1;
      font-size: 0.68rem;
      font-weight: 750;
    }

    .rd106-team-badge {
      min-width: 64px;
      padding: 7px 9px;
      border-radius: 9px;
      text-align: center;
      font-size: 0.7rem;
      font-weight: 950;
      text-transform: uppercase;
    }

    .rd106-team-badge.red {
      color: #ff9ca3;
      background:
        rgba(137, 29, 39, 0.34);
    }

    .rd106-team-badge.blue {
      color: #9fd2ff;
      background:
        rgba(22, 83, 137, 0.36);
    }

    .rd106-difficulty-select {
      width: 108px;
      min-height: 35px;
      padding: 6px 28px 6px 9px;
      border: 1px solid
        rgba(255, 200, 87, 0.45);
      border-radius: 9px;
      background: #0b111b;
      color: #fff3cf;
      font: inherit;
      font-size: 0.72rem;
      font-weight: 850;
    }

    .rd106-difficulty-guide {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      padding: 10px;
      border: 1px solid
        rgba(151, 174, 207, 0.18);
      border-radius: 12px;
      background:
        rgba(8, 14, 24, 0.55);
      color: #9fb2cc;
      font-size: 0.67rem;
      line-height: 1.35;
    }

    .rd106-difficulty-guide strong {
      color: #eaf2ff;
    }

    .rd106-safety-note {
      margin: 0;
      padding: 10px 11px;
      border-left: 3px solid
        rgba(255, 152, 44, 0.72);
      border-radius: 8px;
      background:
        rgba(111, 57, 13, 0.2);
      color: #d8c3a5;
      font-size: 0.69rem;
      line-height: 1.42;
    }

    .rd106-review-actions {
      display: grid;
      grid-template-columns:
        0.72fr 1.28fr;
      gap: 8px;
    }

    .rd106-review-action {
      min-height: 46px;
      padding: 9px 10px;
      border: 1px solid
        rgba(151, 174, 207, 0.28);
      border-radius: 12px;
      background:
        rgba(28, 41, 60, 0.92);
      color: #f6f9ff;
      font: inherit;
      font-size: 0.76rem;
      font-weight: 900;
      cursor: pointer;
    }

    .rd106-review-action.start {
      border-color:
        rgba(171, 113, 255, 0.58);

      background: linear-gradient(
        100deg,
        rgba(110, 43, 93, 0.9),
        rgba(32, 79, 125, 0.94)
      );
    }

    .rd106-review-action:disabled {
      opacity: 0.42;
      cursor: default;
    }

    @media (max-width: 420px) {
      .rd106-roster-row {
        grid-template-columns:
          minmax(0, 1fr) 102px;
      }

      .rd106-difficulty-select {
        width: 102px;
      }

      .rd106-difficulty-guide {
        grid-template-columns: 1fr;
      }

      .rd106-review-actions {
        grid-template-columns: 1fr;
      }
    }
  `;

  document.head.appendChild(style);
}


function rd106DifficultyOptions(selected) {
  return RD106_BOT_DIFFICULTIES
    .map(
      (difficulty) => `
        <option
          value="${difficulty}"
          ${
            difficulty === selected
              ? "selected"
              : ""
          }
        >
          ${rd106DifficultyLabel(
            difficulty
          )}
        </option>
      `
    )
    .join("");
}


function rd106HumanReviewRows(roster) {
  const humansById = new Map(
    roster.humans.map(
      (human) => [
        String(human.user_id),
        human
      ]
    )
  );

  return rd87RoomMembers()
    .filter((member) =>
      humansById.has(
        String(member.user_id)
      )
    )
    .map((member) => {
      const userId =
        String(member.user_id);

      const human =
        humansById.get(userId);

      const team = human.team;

      const isMe =
        userId ===
        String(
          state.auth.user?.id || ""
        );

      const name = escapeHtml(
        member.display_name ||
          "Road rider"
      );

      return `
        <div
          class="rd106-roster-row ${team}"
        >
          <div
            class="rd106-roster-person"
          >
            <strong>
              ${name}${
                isMe ? " • You" : ""
              }
            </strong>

            <span>Human rider</span>
          </div>

          <span
            class="rd106-team-badge ${team}"
          >
            ${escapeHtml(team)}
          </span>
        </div>
      `;
    })
    .join("");
}


function rd106BotReviewRows(
  team,
  count
) {
  const difficulties =
    state.customConquest
      .botDifficulties[team];

  return Array.from(
    { length: count },
    (_, index) => {
      const selected =
        rd106SafeBotDifficulty(
          difficulties[index]
        );

      const teamLabel =
        team === "red"
          ? "Red"
          : "Blue";

      return `
        <label
          class="rd106-roster-row ${team}"
        >
          <span
            class="rd106-roster-person"
          >
            <strong>
              ${teamLabel} Road Bot ${
                index + 1
              }
            </strong>

            <span>
              ${teamLabel} team • road-following bot
            </span>
          </span>

          <select
            class="rd106-difficulty-select"
            data-rd106-bot-team="${team}"
            data-rd106-bot-index="${index}"
            aria-label="Difficulty for ${teamLabel} Road Bot ${
              index + 1
            }"
          >
            ${rd106DifficultyOptions(
              selected
            )}
          </select>
        </label>
      `;
    }
  ).join("");
}


function rd106ReviewHtml(roster) {
  const humanRows =
    rd106HumanReviewRows(roster);

  const botRows = [
    rd106BotReviewRows(
      "red",
      roster.redBots
    ),

    rd106BotReviewRows(
      "blue",
      roster.blueBots
    )
  ].join("");

  const duration =
    rd98SafeConquestDuration(
      state.customConquest
        .matchDurationMinutes
    );

  const arenaLabel =
    state.conquestArena.mode ===
      "custom"
      ? "Host-placed A–E"
      : "Balanced Random";

  return `
    <section
      class="rd106-review-heading"
    >
      <strong>
        Confirm Custom Conquest
      </strong>

      <span>
        Review everybody in this match and choose each bot's difficulty.
      </span>
    </section>

    <div
      class="rd106-review-summary"
    >
      <span>
        RED ${roster.redTotal}
        vs
        BLUE ${roster.blueTotal}
      </span>

      <span>
        ${rd98DurationLabel(duration)}
        •
        ${arenaLabel}
      </span>
    </div>

    <section
      class="rd106-roster-section"
    >
      <div
        class="rd106-roster-title"
      >
        Humans
      </div>

      <div
        class="rd106-roster-list"
      >
        ${
          humanRows ||
          `
            <div class="empty-state">
              Spectator-controlled bot match
            </div>
          `
        }
      </div>
    </section>

    <section
      class="rd106-roster-section"
    >
      <div
        class="rd106-roster-title"
      >
        Bots • individual difficulty
      </div>

      <div
        class="rd106-roster-list"
      >
        ${botRows}
      </div>
    </section>

    <div
      class="rd106-difficulty-guide"
    >
      <span>
        <strong>Easy</strong>
        • 70% speed, slower reactions
      </span>

      <span>
        <strong>Normal</strong>
        • current balanced bot
      </span>

      <span>
        <strong>Hard</strong>
        • 110% speed, smarter reactions
      </span>

      <span>
        <strong>Unfair</strong>
        • 125% speed, aggressive AI
      </span>
    </div>

    <p class="rd106-safety-note">
      Bot speed is simulated. Never try to match a bot's pace. Riders must obey speed limits and all road rules.
    </p>

    <div
      class="rd106-review-actions"
    >
      <button
        id="rd106BackToConquestSettingsBtn"
        class="rd106-review-action"
        type="button"
      >
        Back to Settings
      </button>

      <button
        id="rd106StartConfirmedConquestBtn"
        class="rd106-review-action start"
        type="button"
        ${
          roster.valid
            ? ""
            : "disabled"
        }
      >
        Start Custom Conquest
      </button>
    </div>
  `;
}


function rd106EnsureReviewPanel() {
  rd106InstallStyles();

  const customBox =
    document.getElementById(
      "customConquestBox"
    );

  if (!customBox) return null;

  let review =
    document.getElementById(
      "rd106CustomConquestReview"
    );

  if (!review) {
    review =
      document.createElement("div");

    review.id =
      "rd106CustomConquestReview";

    review.className =
      "rd106-review";

    review.hidden = true;

    review.addEventListener(
      "change",
      (event) => {
        const select =
          event.target.closest(
            "[data-rd106-bot-team]"
          );

        if (!select) return;

        const team =
          select.dataset
            .rd106BotTeam;

        const index = Number(
          select.dataset
            .rd106BotIndex
        );

        if (
          !["red", "blue"].includes(
            team
          ) ||
          !Number.isInteger(index) ||
          index < 0
        ) {
          return;
        }

        state.customConquest
          .botDifficulties[team][index] =
            rd106SafeBotDifficulty(
              select.value
            );

        select.value =
          state.customConquest
            .botDifficulties[team][index];
      }
    );

    review.addEventListener(
      "click",
      (event) => {
        if (
          event.target.closest(
            "#rd106BackToConquestSettingsBtn"
          )
        ) {
          state.customConquest
            .confirmingRoster = false;

          rd106RenderConfirmationUi();

          return;
        }

        if (
          event.target.closest(
            "#rd106StartConfirmedConquestBtn"
          )
        ) {
          rd106StartConfirmedConquest();
        }
      }
    );

    customBox.appendChild(review);
  }

  return review;
}


function rd106RenderConfirmationUi() {
  const review =
    rd106EnsureReviewPanel();

  const customBox =
    document.getElementById(
      "customConquestBox"
    );

  const startButton =
    document.getElementById(
      "startCustomConquestBtn"
    );

  if (!review || !customBox) return;

  const confirming = Boolean(
    state.customConquest
      .confirmingRoster
  );

  customBox.classList.toggle(
    "rd106-confirming-roster",
    confirming
  );

  review.hidden = !confirming;

  if (confirming) {
    const roster =
      rd106SyncBotDifficulties();

    review.innerHTML =
      rd106ReviewHtml(roster);
  }

  if (
    startButton &&
    !state.customConquest.starting
  ) {
    startButton.textContent =
      "Confirm Custom Conquest";
  }

  const headingSubtitle =
    document.querySelector(
      ".rd95-conquest-settings-heading span"
    );

  if (headingSubtitle) {
    headingSubtitle.textContent =
      confirming
        ? "Review roster and individual bot difficulty"
        : "Custom teams, human players and bots";
  }
}


function rd106OpenRosterConfirmation() {
  const roster =
    rd106SyncBotDifficulties();

  if (
    !rd87IsRoomCreator() ||
    !roster.valid ||
    state.customConquest.starting
  ) {
    showToast(
      roster.errors[0] ||
        "Choose a valid Red and Blue roster"
    );

    return;
  }

  state.customConquest
    .confirmingRoster = true;

  rd106RenderConfirmationUi();

  window.setTimeout(() => {
    document.getElementById(
      "rd106StartConfirmedConquestBtn"
    )?.focus();
  }, 0);
}


function rd106StartConfirmedConquest() {
  const roster =
    rd106SyncBotDifficulties();

  if (
    !rd87IsRoomCreator() ||
    !roster.valid ||
    state.customConquest.starting
  ) {
    showToast(
      roster.errors[0] ||
        "Choose a valid Red and Blue roster"
    );

    return;
  }

  rd106BotDifficultyPayload();

  state.customConquest
    .confirmingRoster = false;

  state.customConquest
    .confirmedStart = true;

  rd106RenderConfirmationUi();

  try {
    document.getElementById(
      "startCustomConquestBtn"
    )?.click();

  } finally {
    state.customConquest
      .confirmedStart = false;
  }
}


function rd106InterceptFirstStart(
  event
) {
  const startButton =
    event.target.closest?.(
      "#startCustomConquestBtn"
    );

  if (
    !startButton ||
    state.customConquest
      .confirmedStart
  ) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  rd106OpenRosterConfirmation();
}


function rd106InstallStartInterceptor() {
  if (
    document.documentElement.dataset
      .rd106StartConfirmationBound ===
      "true"
  ) {
    return;
  }

  document.documentElement.dataset
    .rd106StartConfirmationBound =
      "true";

  document.addEventListener(
    "click",
    rd106InterceptFirstStart,
    true
  );
}


function rd106InstallDifficultyRpcBridge() {
  const client = state.auth.client;

  if (
    !client ||
    client.rd106DifficultyBridgeInstalled
  ) {
    return;
  }

  const originalRpc =
    client.rpc.bind(client);

  client.rpc = function (
    functionName,
    parameters = {},
    options
  ) {
    let nextFunctionName =
      functionName;

    if (
      functionName ===
        "start_custom_conquest_round"
    ) {
      nextFunctionName =
        "start_custom_conquest_round_with_difficulties";

      parameters = {
        ...parameters,

        p_match_duration_minutes:
          rd98SafeConquestDuration(
            state.customConquest
              .matchDurationMinutes
          ),

        p_bot_difficulties:
          rd106BotDifficultyPayload()
      };

    } else if (
      functionName ===
        "start_custom_conquest_round_custom_arena"
    ) {
      nextFunctionName =
        "start_custom_conquest_round_custom_arena_with_difficulties";

      parameters = {
        ...parameters,

        p_match_duration_minutes:
          rd98SafeConquestDuration(
            state.customConquest
              .matchDurationMinutes
          ),

        p_bot_difficulties:
          rd106BotDifficultyPayload()
      };
    }

    return originalRpc(
      nextFunctionName,
      parameters,
      options
    );
  };

  client.rd106DifficultyBridgeInstalled =
    true;
}


rd87RenderCustomConquestLobby =
function () {
  const result =
    roadDiscoveryV106
      .rd87RenderCustomConquestLobby();

  rd106SyncBotDifficulties();
  rd106RenderConfirmationUi();

  return result;
};


rd94RenderArenaChoices =
function () {
  const result =
    roadDiscoveryV106
      .rd94RenderArenaChoices();

  rd106RenderConfirmationUi();

  return result;
};


rd95CloseConquestSettings =
function () {
  state.customConquest
    .confirmingRoster = false;

  const result =
    roadDiscoveryV106
      .rd95CloseConquestSettings();

  rd106RenderConfirmationUi();

  return result;
};


renderMultiplayerState =
function () {
  rd106InstallDifficultyRpcBridge();

  const result =
    roadDiscoveryV106
      .renderMultiplayerState();

  rd106RenderConfirmationUi();

  return result;
};


stopMultiplayerMode =
function (
  options = {}
) {
  state.customConquest
    .confirmingRoster = false;

  return roadDiscoveryV106
    .stopMultiplayerMode(options);
};


leaveMultiplayerRoom =
async function (
  options = {}
) {
  state.customConquest
    .confirmingRoster = false;

  return roadDiscoveryV106
    .leaveMultiplayerRoom(options);
};


function rd106InitCustomConquestConfirmation() {
  rd106InstallStyles();
  rd106InstallStartInterceptor();
  rd106InstallDifficultyRpcBridge();
  rd106SyncBotDifficulties();
  rd106RenderConfirmationUi();
}


if (
  document.readyState === "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    rd106InitCustomConquestConfirmation,
    { once: true }
  );

} else {
  rd106InitCustomConquestConfirmation();
}

/* ================================================== */
/* Road Discovery AU v107                             */
/* Place A–E only + settings-first Conquest flow      */
/* ================================================== */

const roadDiscoveryV107 = {
  rd94RenderArenaChoices,
  rd95EnsureConquestSettings,
  rd95RenderConquestSettings,
  renderMultiplayerState
};


function rd107InstallConquestFlowStyles() {
  if (
    document.getElementById(
      "rd107ConquestFlowStyles"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "rd107ConquestFlowStyles";

  style.textContent = `
    #rd95ConquestSettingsCog,
    [data-rd94-arena-mode="balanced"] {
      display: none !important;
    }

    .rd94-arena-choice-buttons {
      grid-template-columns: 1fr !important;
    }
  `;

  document.head.appendChild(style);
}


function rd107ApplyPlaceOnlyUi() {
  state.conquestArena.mode = "custom";

  for (
    const balancedButton of
    document.querySelectorAll(
      '[data-rd94-arena-mode="balanced"]'
    )
  ) {
    balancedButton.remove();
  }

  for (
    const placeButton of
    document.querySelectorAll(
      '[data-rd94-arena-mode="custom"]'
    )
  ) {
    placeButton.classList.add("active");

    placeButton.textContent =
      "Place A–E";
  }

  for (
    const note of
    document.querySelectorAll(
      ".rd94-arena-choice-note"
    )
  ) {
    note.textContent =
      rd94IsArenaHost()
        ? "Place five safe objectives after confirming the Conquest settings."
        : "The room creator places the five Conquest objectives.";
  }

  const mainStartButton =
    document.getElementById(
      "startConquestBtn"
    );

  if (
    mainStartButton &&
    !state.conquest.starting
  ) {
    mainStartButton.textContent =
      "Start Road Conquest";
  }

  const cog =
    document.getElementById(
      "rd95ConquestSettingsCog"
    );

  if (cog) {
    cog.hidden = true;
    cog.tabIndex = -1;

    cog.setAttribute(
      "aria-hidden",
      "true"
    );
  }
}


function rd107OpenSettingsFromMainStart(
  event
) {
  const button =
    event.target.closest?.(
      "#startConquestBtn"
    );

  if (!button) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  if (button.disabled) return;

  if (!rd94IsArenaHost()) {
    showToast(
      "Only the room creator can start Road Conquest"
    );

    return;
  }

  state.conquestArena.mode = "custom";

  rd95OpenConquestSettings();
  rd107ApplyPlaceOnlyUi();
}


function rd107InstallMainStartInterceptor() {
  if (
    document.documentElement.dataset
      .rd107MainStartBound === "true"
  ) {
    return;
  }

  document.documentElement.dataset
    .rd107MainStartBound = "true";

  document.addEventListener(
    "click",
    rd107OpenSettingsFromMainStart,
    true
  );
}


rd94RenderArenaChoices = function () {
  state.conquestArena.mode = "custom";

  const result =
    roadDiscoveryV107
      .rd94RenderArenaChoices();

  rd107ApplyPlaceOnlyUi();

  return result;
};


rd95EnsureConquestSettings = function () {
  const result =
    roadDiscoveryV107
      .rd95EnsureConquestSettings();

  rd107ApplyPlaceOnlyUi();

  return result;
};


rd95RenderConquestSettings = function () {
  const result =
    roadDiscoveryV107
      .rd95RenderConquestSettings();

  rd107ApplyPlaceOnlyUi();

  return result;
};


renderMultiplayerState = function () {
  const result =
    roadDiscoveryV107
      .renderMultiplayerState();

  rd107ApplyPlaceOnlyUi();

  return result;
};


function rd107InitConquestFlow() {
  rd107InstallConquestFlowStyles();
  rd107InstallMainStartInterceptor();
  rd94EnsureArenaChoices();
  rd107ApplyPlaceOnlyUi();
}


if (
  document.readyState === "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    rd107InitConquestFlow,
    { once: true }
  );

} else {
  rd107InitConquestFlow();
}

/* ================================================== */
/* Road Discovery AU v108                             */
/* Allow one human to configure a bot Conquest match  */
/* ================================================== */

const roadDiscoveryV108 = {
  rd107ApplyPlaceOnlyUi
};


rd107ApplyPlaceOnlyUi = function () {
  const result =
    roadDiscoveryV108
      .rd107ApplyPlaceOnlyUi();

  const startButton =
    document.getElementById(
      "startConquestBtn"
    );

  const preparationText =
    document.getElementById(
      "conquestPreparationText"
    );

  const roomActive =
    hasActiveMultiplayerRoom();

  const isHost =
    rd87IsRoomCreator();

  const gameBusy = Boolean(
    hasActiveConquestRound() ||
    hasActiveHideSeekRound() ||
    state.conquest.starting ||
    state.customConquest.starting ||
    state.hideSeek.starting ||
    state.multiplayer.leaving
  );

  if (startButton) {
    startButton.disabled = Boolean(
      !roomActive ||
      !isHost ||
      gameBusy
    );

    if (!gameBusy) {
      startButton.textContent =
        "Start Road Conquest";
    }
  }

  if (
    preparationText &&
    roomActive &&
    !gameBusy
  ) {
    preparationText.textContent =
      isHost
        ? "Open Conquest Settings to configure humans and bots."
        : "Waiting for the room creator to configure the match.";
  }

  return result;
};


rd107ApplyPlaceOnlyUi();

/* ================================================== */
/* Road Discovery AU v109                             */
/* Host-placed Rally before objectives A–E            */
/* ================================================== */

const roadDiscoveryV109 = {
  rd94RenderPlacementOverlay
};


function rd109InstallRallyStyles() {
  if (
    document.getElementById(
      "rd109RallyStyles"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id = "rd109RallyStyles";

  style.textContent = `
    .rd94-arena-progress {
      grid-template-columns:
        repeat(6, minmax(0, 1fr));
    }

    .rd109-rally-chip {
      min-width: 0;
      padding-inline: 5px;
      font-size: 0.64rem;
    }

    .rd109-rally-chip.placed {
      border-color: #d8e6f8;
      background:
        rgba(116, 139, 168, 0.3);
      color: #f3f8ff;
    }
  `;

  document.head.appendChild(style);
}


function rd109RallyValidForObjectives(
  point
) {
  if (!point) return false;

  return state.conquestArena.objectives
    .every((objective) => {
      const distance =
        haversine(
          point,
          objective
        );

      return Boolean(
        distance >=
          RD94_ARENA_MIN_CENTRE_M &&
        distance <=
          RD94_ARENA_MAX_CENTRE_M
      );
    });
}


async function rd109SnapRallyPoint(
  point
) {
  const roadsReady =
    await ensureRoadsNearPoint(
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
    throw new Error(
      "Could not load roads near that Rally location."
    );
  }

  const snapped =
    rd94NearestSafeRoadPoint(point);

  if (!snapped) {
    throw new Error(
      "Place Rally closer to a safe public road or reachable parking entrance."
    );
  }

  return {
    ...snapped,
    accuracy: 0
  };
}


function rd94DrawArenaCentre() {
  rd94EnsurePlacementLayer();

  const centre =
    state.conquestArena.centre;

  if (
    !centre ||
    !state.conquestArena.layer
  ) {
    return;
  }

  state.conquestArena.outerCircle =
    L.circle(
      [centre.lat, centre.lng],
      {
        radius:
          RD94_ARENA_MAX_CENTRE_M,
        color: "#d8e6f8",
        weight: 2,
        opacity: 0.62,
        fillOpacity: 0.025,
        dashArray: "10 9",
        interactive: false
      }
    ).addTo(
      state.conquestArena.layer
    );

  state.conquestArena.innerCircle =
    L.circle(
      [centre.lat, centre.lng],
      {
        radius:
          RD94_ARENA_MIN_CENTRE_M,
        color: "#9daec4",
        weight: 1,
        opacity: 0.42,
        fillOpacity: 0.02,
        dashArray: "5 8",
        interactive: false
      }
    ).addTo(
      state.conquestArena.layer
    );

  const marker =
    L.marker(
      [centre.lat, centre.lng],
      {
        icon:
          rd94ArenaCentreIcon(),
        draggable: true,
        keyboard: false,
        zIndexOffset: 10
      }
    ).addTo(
      state.conquestArena.layer
    );

  marker.bindTooltip(
    "Rally Circle • Drag to move",
    { direction: "top" }
  );

  marker.on(
    "dragstart",
    () => {
      marker.rd109PreviousRally = {
        ...state.conquestArena.centre
      };
    }
  );

  marker.on(
    "dragend",
    async () => {
      if (
        state.conquestArena.busy
      ) {
        return;
      }

      const previous =
        marker.rd109PreviousRally ||
        {
          ...state.conquestArena
            .centre
        };

      const latlng =
        marker.getLatLng();

      state.conquestArena.busy =
        true;

      rd94RenderPlacementOverlay(
        "Checking the new Rally location..."
      );

      try {
        const snapped =
          await rd109SnapRallyPoint({
            lat: Number(latlng.lat),
            lng: Number(latlng.lng)
          });

        if (
          !rd109RallyValidForObjectives(
            snapped
          )
        ) {
          throw new Error(
            "That move would place an objective outside the 600–1,200 metre Rally ring."
          );
        }

        state.conquestArena.centre =
          snapped;

        showToast(
          `Rally moved • ${snapped.road_name}`
        );

      } catch (error) {
        state.conquestArena.centre =
          previous;

        showToast(
          rd86ConquestErrorMessage(
            error
          )
        );
      }

      state.conquestArena.busy =
        false;

      rd94ClearPlacementLayers();
      rd94DrawArenaCentre();
      rd94RenderPlacementOverlay();
    }
  );

  state.conquestArena.centreMarker =
    marker;
}


async function rd94HandleArenaMapClick(
  event
) {
  if (
    !state.conquestArena.active ||
    state.conquestArena.busy
  ) {
    return;
  }

  const tappedPoint = {
    lat: Number(event.latlng.lat),
    lng: Number(event.latlng.lng)
  };

  /*
    The first map tap places Rally.
  */
  if (!state.conquestArena.centre) {
    state.conquestArena.busy =
      true;

    rd94RenderPlacementOverlay(
      "Loading roads near the Rally location..."
    );

    try {
      const rally =
        await rd109SnapRallyPoint(
          tappedPoint
        );

      state.conquestArena.centre =
        rally;

      state.conquestArena.busy =
        false;

      rd94ClearPlacementLayers();
      rd94DrawArenaCentre();

      state.map?.setView(
        [rally.lat, rally.lng],
        Math.min(
          14,
          Number(
            state.map.getZoom()
          ) || 14
        ),
        { animate: true }
      );

      showToast(
        `Rally placed • ${rally.road_name}`
      );

      rd94RenderPlacementOverlay();

    } catch (error) {
      state.conquestArena.busy =
        false;

      showToast(
        rd86ConquestErrorMessage(
          error
        )
      );

      rd94RenderPlacementOverlay();
    }

    return;
  }

  /*
    Later map taps place A–E.
  */
  if (
    state.conquestArena.objectives
      .length >=
    RD94_ARENA_OBJECTIVE_CODES
      .length
  ) {
    return;
  }

  const snapped =
    rd94NearestSafeRoadPoint(
      tappedPoint
    );

  if (!snapped) {
    showToast(
      "Tap closer to a suitable public road"
    );

    return;
  }

  const validation =
    rd94ValidateNewObjective(
      snapped
    );

  if (!validation.valid) {
    showToast(validation.message);
    return;
  }

  const code =
    RD94_ARENA_OBJECTIVE_CODES[
      state.conquestArena
        .objectives.length
    ];

  state.conquestArena
    .objectives.push({
      code,
      lat: snapped.lat,
      lng: snapped.lng,
      highway: snapped.highway,
      road_name: snapped.road_name
    });

  showToast(
    `Objective ${code} placed • ${snapped.road_name}`
  );

  rd94RenderPlacementOverlay();
}


async function rd94BeginArenaPlacement(
  startKind
) {
  if (
    !hasActiveMultiplayerRoom() ||
    !state.auth.client ||
    !state.auth.user ||
    !rd94IsArenaHost() ||
    state.conquestArena.busy ||
    hasActiveConquestRound()
  ) {
    if (!rd94IsArenaHost()) {
      showToast(
        "Only the room creator can place Rally and A–E"
      );
    }

    return;
  }

  if (hasActiveHideSeekRound()) {
    showToast(
      "Finish Hide & Seek before placing a Conquest arena"
    );

    return;
  }

  if (startKind === "custom") {
    const roster =
      rd87CustomRoster();

    if (!roster.valid) {
      showToast(
        roster.errors[0] ||
        "Choose a valid Red and Blue roster."
      );

      return;
    }
  }

  state.conquestArena.startKind =
    startKind === "custom"
      ? "custom"
      : "multiplayer";

  state.conquestArena.centre =
    null;

  state.conquestArena.objectives =
    [];

  state.conquestArena.active =
    true;

  state.conquestArena.busy =
    false;

  closePanels();

  state.awaitingWaypointClick =
    false;

  if (state.myPlaces) {
    state.myPlaces.placingType =
      null;

    state.myPlaces.movingPlaceId =
      null;
  }

  rd94ClearPlacementLayers();
  rd94BindArenaMapClick();

  state.followUser = false;

  rd94RenderPlacementOverlay();

  showToast(
    "Tap a safe public road to place the Rally Circle"
  );
}


rd94RenderPlacementOverlay =
function (
  overrideMessage = ""
) {
  const result =
    roadDiscoveryV109
      .rd94RenderPlacementOverlay(
        overrideMessage
      );

  const centre =
    state.conquestArena.centre;

  const progress =
    document.getElementById(
      "rd94ArenaProgress"
    );

  const status =
    document.getElementById(
      "rd94ArenaStatus"
    );

  const undoButton =
    document.getElementById(
      "rd94ArenaUndoBtn"
    );

  const confirmButton =
    document.getElementById(
      "rd94ArenaConfirmBtn"
    );

  const heading =
    document.querySelector(
      ".rd94-arena-heading strong"
    );

  const subtitle =
    document.querySelector(
      ".rd94-arena-heading span"
    );

  if (heading) {
    heading.textContent =
      "Place Rally and Conquest A–E";
  }

  if (subtitle) {
    subtitle.textContent =
      "Place Rally first, then A–E. Drag Rally or any letter to move it before confirming.";
  }

  if (progress) {
    const rallyChip = `
      <button
        class="rd94-arena-objective-chip rd109-rally-chip ${centre ? "placed" : ""}"
        type="button"
        data-rd109-rally-chip="true"
        ${centre ? "" : "disabled"}
        aria-label="${centre ? "Remove Rally Circle" : "Rally Circle not placed"}"
      >
        RALLY
      </button>
    `;

    progress.insertAdjacentHTML(
      "afterbegin",
      rallyChip
    );
  }

  if (
    status &&
    !centre &&
    !overrideMessage
  ) {
    status.classList.remove(
      "good",
      "bad"
    );

    status.textContent =
      "Tap a safe public road or reachable parking entrance to place the Rally Circle.";
  }

  if (undoButton) {
    undoButton.disabled = Boolean(
      state.conquestArena.busy ||
      (
        !centre &&
        state.conquestArena
          .objectives.length === 0
      )
    );
  }

  if (
    confirmButton &&
    !centre
  ) {
    confirmButton.disabled = true;
  }

  return result;
};


function rd109RemoveRally() {
  if (
    state.conquestArena.busy ||
    !state.conquestArena.centre
  ) {
    return;
  }

  state.conquestArena.centre =
    null;

  state.conquestArena.objectives =
    [];

  rd94ClearPlacementLayers();
  rd94RenderPlacementOverlay();

  showToast(
    "Rally removed • tap the map to place it again"
  );
}


function rd109InstallRallyControls() {
  if (
    document.documentElement.dataset
      .rd109RallyControlsBound ===
      "true"
  ) {
    return;
  }

  document.documentElement.dataset
    .rd109RallyControlsBound =
      "true";

  document.addEventListener(
    "click",
    (event) => {
      if (
        event.target.closest(
          "[data-rd109-rally-chip]"
        )
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();

        rd109RemoveRally();
        return;
      }

      if (
        event.target.closest(
          "#rd94ArenaUndoBtn"
        ) &&
        state.conquestArena.active &&
        state.conquestArena.centre &&
        state.conquestArena
          .objectives.length === 0
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();

        rd109RemoveRally();
      }
    },
    true
  );
}


function rd109InitRallyPlacement() {
  rd109InstallRallyStyles();
  rd109InstallRallyControls();
}


if (
  document.readyState === "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    rd109InitRallyPlacement,
    { once: true }
  );

} else {
  rd109InitRallyPlacement();
}

/* ================================================== */
/* Road Discovery AU v110                             */
/* 900-metre middle arena placement guide             */
/* ================================================== */

const roadDiscoveryV110 = {
  rd94DrawArenaCentre
};


state.conquestArena.middleCircle =
  null;


rd94DrawArenaCentre = function () {
  const result =
    roadDiscoveryV110
      .rd94DrawArenaCentre();

  const centre =
    state.conquestArena.centre;

  if (
    !centre ||
    !state.conquestArena.layer
  ) {
    return result;
  }

  state.conquestArena.middleCircle =
    L.circle(
      [centre.lat, centre.lng],
      {
        radius: 900,
        color: "#b9cbe1",
        weight: 1.5,
        opacity: 0.52,
        fillOpacity: 0,
        dashArray: "7 9",
        interactive: false
      }
    ).addTo(
      state.conquestArena.layer
    );

  return result;
};

/* ================================================== */
/* Road Discovery AU v111                             */
/* Team-start roads around 500 metres from Rally      */
/* ================================================== */

const roadDiscoveryV111 = {
  rd94BuildCustomArenaCandidates
};

const RD111_TEAM_START_MIN_M =
  400;

const RD111_TEAM_START_MAX_M =
  590;

const RD111_TEAM_START_LIMIT =
  15;

const RD111_OUTER_CANDIDATE_LIMIT =
  60;


rd94BuildCustomArenaCandidates =
function () {
  const existing =
    roadDiscoveryV111
      .rd94BuildCustomArenaCandidates();

  const centre =
    state.conquestArena.centre;

  const objectives =
    state.conquestArena.objectives;

  if (
    !centre ||
    objectives.length !== 5
  ) {
    return existing;
  }

  const hull =
    rd94ConvexHull(objectives);

  const objectiveCandidates =
    existing
      .filter(
        (candidate) =>
          Number(
            candidate.road_count
          ) >= 100000
      )
      .slice(0, 5);

  const outerCandidates =
    existing
      .filter(
        (candidate) =>
          Number(
            candidate.road_count
          ) < 100000
      )
      .slice(
        0,
        RD111_OUTER_CANDIDATE_LIMIT
      );

  const roadPoints =
    state.roadSegments
      .filter((segment) =>
        rd94SafeHighwayType(
          segment?.highway
        )
      )
      .map((segment) => ({
        ...roadSegmentMidpoint(
          segment
        ),

        highway: String(
          segment.highway || "road"
        )
      }))
      .filter((point) =>
        Number.isFinite(
          Number(point?.lat)
        ) &&
        Number.isFinite(
          Number(point?.lng)
        )
      )
      .filter((point) => {
        const rallyDistance =
          haversine(
            centre,
            point
          );

        return Boolean(
          rallyDistance >=
            RD111_TEAM_START_MIN_M &&
          rallyDistance <=
            RD111_TEAM_START_MAX_M &&
          rd94PointInPolygon(
            point,
            hull
          )
        );
      });

  shuffleHideSeekArray(
    roadPoints
  );

  const innerCandidates = [];

  for (const point of roadPoints) {
    if (
      innerCandidates.some(
        (candidate) =>
          haversine(
            candidate,
            point
          ) <
          RD93_CONQUEST_CANDIDATE_SPACING_M
      )
    ) {
      continue;
    }

    let roadCount = 0;

    for (
      const roadPoint of
      roadPoints
    ) {
      if (
        haversine(
          point,
          roadPoint
        ) <=
        RD86_CONQUEST_ROAD_DENSITY_RADIUS_M
      ) {
        roadCount += 1;
      }
    }

    if (
      roadCount <
      RD86_CONQUEST_MIN_ROAD_COUNT
    ) {
      continue;
    }

    innerCandidates.push({
      lat: Number(
        Number(point.lat)
          .toFixed(6)
      ),

      lng: Number(
        Number(point.lng)
          .toFixed(6)
      ),

      road_count: roadCount,
      routeable: false
    });

    if (
      innerCandidates.length >=
        RD111_TEAM_START_LIMIT
    ) {
      break;
    }
  }

  return [
    ...innerCandidates,
    ...outerCandidates,
    ...objectiveCandidates
  ].slice(
    0,
    RD86_CONQUEST_MAX_CANDIDATES
  );
};

/* ================================================== */
/* Road Discovery AU v112                             */
/* Full visibility, waypoints and Legendary event     */
/* ================================================== */

const roadDiscoveryV112 = {
  pollConquestState:
    rd86PollConquestState,

  drawDeploymentStart:
    rd86DrawDeploymentStart,

  maybeSendConquestLocation:
    rd86MaybeSendConquestLocation,

  resetConquestState:
    rd86ResetConquestState
};

state.conquest.personalWaypoint = null;
state.conquest.personalWaypointKey = "";
state.conquest.liveOverlayPolling = false;
state.conquest.legendarySpawnAt = null;
state.conquest.legendaryEventKey = "";
state.conquest.legendaryRevealKey = "";
state.conquest.legendaryTimer = null;


function rd112InstallStyles() {
  if (
    document.getElementById(
      "rd112ConquestStyles"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id = "rd112ConquestStyles";

  style.textContent = `
    .rd112-legendary-event {
      position: fixed;
      top: max(
        18px,
        env(safe-area-inset-top)
      );
      left: 50%;
      z-index: 10050;
      min-width: min(
        420px,
        calc(100vw - 32px)
      );
      padding: 16px 22px;
      border: 2px solid
        rgba(255, 205, 67, 0.92);
      border-radius: 18px;
      background:
        linear-gradient(
          135deg,
          rgba(54, 35, 3, 0.97),
          rgba(13, 17, 24, 0.98)
        );
      box-shadow:
        0 0 0 5px
          rgba(255, 190, 33, 0.1),
        0 18px 60px
          rgba(0, 0, 0, 0.58),
        0 0 38px
          rgba(255, 186, 31, 0.3);
      color: #fff0b3;
      text-align: center;
      transform:
        translate(-50%, -18px)
        scale(0.96);
      opacity: 0;
      pointer-events: none;
      transition:
        opacity 160ms ease,
        transform 160ms ease;
    }

    .rd112-legendary-event.show {
      transform:
        translate(-50%, 0)
        scale(1);
      opacity: 1;
    }

    .rd112-legendary-event strong {
      display: block;
      font-size:
        clamp(
          1rem,
          3.4vw,
          1.34rem
        );
      font-weight: 1000;
      letter-spacing: 0.035em;
      text-transform: uppercase;
    }

    .rd112-legendary-event span {
      display: block;
      margin-top: 4px;
      color: #ffd75e;
      font-size:
        clamp(
          1.7rem,
          7vw,
          2.7rem
        );
      line-height: 1;
      font-weight: 1000;
    }

    .rd112-legendary-event.reveal {
      animation:
        rd112LegendaryPulse
        720ms ease-out 2;
    }

    @keyframes rd112LegendaryPulse {
      0% {
        box-shadow:
          0 0 0 0
            rgba(
              255,
              204,
              64,
              0.76
            ),
          0 18px 60px
            rgba(0, 0, 0, 0.58);
      }

      100% {
        box-shadow:
          0 0 0 30px
            rgba(
              255,
              204,
              64,
              0
            ),
          0 18px 60px
            rgba(0, 0, 0, 0.58);
      }
    }

    .conquest-focus-btn
      .rd112-waypoint-selected {
      outline: 2px solid #f8fbff;
      outline-offset: 2px;
    }

    .conquest-focus-btn.rd112-waypoint-selected {
      outline: 2px solid #f8fbff;
      outline-offset: 2px;
      box-shadow:
        0 0 0 5px
          rgba(104, 195, 255, 0.16),
        0 0 24px
          rgba(104, 195, 255, 0.32);
    }

    .conquest-focus-btn.cache.legendary.rd112-waypoint-selected {
      box-shadow:
        0 0 0 5px
          rgba(255, 199, 51, 0.18),
        0 0 26px
          rgba(255, 199, 51, 0.45);
    }
  `;

  document.head.appendChild(style);
}


function rd112LegendaryElement() {
  let element =
    document.getElementById(
      "rd112LegendaryEvent"
    );

  if (!element) {
    element =
      document.createElement("div");

    element.id =
      "rd112LegendaryEvent";

    element.className =
      "rd112-legendary-event";

    element.setAttribute(
      "role",
      "status"
    );

    element.setAttribute(
      "aria-live",
      "assertive"
    );

    element.innerHTML = `
      <strong>
        Legendary Cache In
      </strong>

      <span>3</span>
    `;

    document.body.appendChild(
      element
    );
  }

  return element;
}


function rd112HideLegendaryEvent() {
  const element =
    document.getElementById(
      "rd112LegendaryEvent"
    );

  element?.classList.remove(
    "show",
    "reveal"
  );
}


function rd112StopLegendaryTimer() {
  if (
    state.conquest.legendaryTimer !==
      null
  ) {
    window.clearInterval(
      state.conquest.legendaryTimer
    );

    state.conquest.legendaryTimer =
      null;
  }

  rd112HideLegendaryEvent();
}


function rd112LegendaryServerNow() {
  return (
    Date.now() +
    Number(
      state.conquest.serverOffsetMs ||
        0
    )
  );
}


function rd112RenderLegendaryCountdown() {
  const spawnMs = Date.parse(
    state.conquest.legendarySpawnAt ||
      ""
  );

  if (
    !Number.isFinite(spawnMs) ||
    ![
      "active",
      "overtime"
    ].includes(
      state.conquest.phase
    )
  ) {
    rd112HideLegendaryEvent();
    return;
  }

  const eventKey =
    `${state.conquest.roundId}:` +
    `${state.conquest.legendarySpawnAt}`;

  const remainingMs =
    spawnMs -
    rd112LegendaryServerNow();

  const element =
    rd112LegendaryElement();

  if (
    remainingMs > 0 &&
    remainingMs <= 3000
  ) {
    const count = Math.max(
      1,
      Math.ceil(
        remainingMs / 1000
      )
    );

    element.classList.remove(
      "reveal"
    );

    element.querySelector(
      "strong"
    ).textContent =
      "Legendary Cache In";

    element.querySelector(
      "span"
    ).textContent =
      String(count);

    element.classList.add(
      "show"
    );

    state.conquest.legendaryEventKey =
      eventKey;

    return;
  }

  if (
    remainingMs <= 0 &&
    remainingMs > -5000 &&
    state.conquest
      .legendaryRevealKey !==
        eventKey
  ) {
    state.conquest
      .legendaryRevealKey =
        eventKey;

    element.querySelector(
      "strong"
    ).textContent =
      "Legendary Cache";

    element.querySelector(
      "span"
    ).textContent =
      "+150";

    element.classList.add(
      "show",
      "reveal"
    );

    showToast(
      "Legendary Cache appeared • +150"
    );

    void rd112PollLiveOverlay();

    window.setTimeout(() => {
      if (
        state.conquest
          .legendaryRevealKey ===
            eventKey
      ) {
        rd112HideLegendaryEvent();
      }
    }, 2600);

    return;
  }

  if (
    remainingMs > 3000 ||
    remainingMs <= -5000
  ) {
    rd112HideLegendaryEvent();
  }
}


function rd112EnsureLegendaryTimer() {
  if (
    state.conquest.legendaryTimer ===
      null
  ) {
    state.conquest.legendaryTimer =
      window.setInterval(
        rd112RenderLegendaryCountdown,
        100
      );
  }

  rd112RenderLegendaryCountdown();
}

function rd112MergeVisiblePlayers(
  players
) {
  if (!Array.isArray(players)) {
    return;
  }

  const existingById =
    new Map(
      state.conquest.players.map(
        (player) => [
          String(
            player?.user_id || ""
          ),
          player
        ]
      )
    );

  state.conquest.players =
    players.map((player) => {
      const id = String(
        player?.user_id || ""
      );

      return {
        ...(
          existingById.get(id) ||
          {}
        ),

        ...player
      };
    });
}


async function rd112PollLiveOverlay() {
  if (
    !hasActiveMultiplayerRoom() ||
    !state.auth.client ||
    !state.conquest.roundId ||
    state.conquest
      .liveOverlayPolling ||
    !navigator.onLine
  ) {
    return;
  }

  state.conquest
    .liveOverlayPolling = true;

  try {
    const { data, error } =
      await state.auth.client.rpc(
        "get_conquest_live_overlay",
        {
          p_room_id:
            state.multiplayer.roomId
        }
      );

    if (error) {
      console.error(error);
      return;
    }

    const overlay =
      Array.isArray(data)
        ? data[0] || null
        : data || null;

    if (
      !overlay ||
      String(
        overlay.round_id || ""
      ) !==
        String(
          state.conquest.roundId ||
            ""
        )
    ) {
      return;
    }

    const serverNowMs =
      Date.parse(
        overlay.server_now || ""
      );

    if (
      Number.isFinite(serverNowMs)
    ) {
      state.conquest.serverOffsetMs =
        serverNowMs -
        Date.now();
    }

    state.conquest
      .legendarySpawnAt =
        overlay
          .legendary_spawn_at ||
        null;

    rd112MergeVisiblePlayers(
      rd86NormaliseJsonArray(
        overlay.players
      )
    );

    rd86DrawConquestMap();
    rd86RenderConquestPlayers();
    rd112EnsureLegendaryTimer();

  } finally {
    state.conquest
      .liveOverlayPolling = false;
  }
}


rd86PollConquestState =
async function (
  options = {}
) {
  await roadDiscoveryV112
    .pollConquestState(options);

  await rd112PollLiveOverlay();
};


function rd112ParticipantIcon(
  team,
  isBot
) {
  return rd87ConquestParticipantIcon(
    team,
    isBot
  );
}


rd86DrawTeammates =
function () {
  rd86EnsureConquestLayer();

  const seen = new Set();

  for (
    const player of
    state.conquest.players
  ) {
    const participantId =
      String(
        player?.user_id || ""
      );

    const isBot =
      Boolean(player?.is_bot);

    if (
      !participantId ||
      player?.is_me ||
      player?.player_status !==
        "active"
    ) {
      continue;
    }

    const position = isBot
      ? rd87VisibleBotPosition(
          player
        )
      : {
          lat: Number(
            player?.lat
          ),

          lng: Number(
            player?.lng
          )
        };

    if (
      !Number.isFinite(
        position.lat
      ) ||
      !Number.isFinite(
        position.lng
      )
    ) {
      continue;
    }

    seen.add(participantId);

    const team =
      player?.team === "red"
        ? "red"
        : "blue";

    const targetText =
      isBot &&
      player?.target_label
        ? ` • ${
            player.target_label
          }`
        : "";

    const tooltip =
      `${escapeHtml(
        player?.display_name ||
          (
            isBot
              ? "Road Bot"
              : "Rider"
          )
      )} • ${
        rd86TeamLabel(team)
      }${
        escapeHtml(targetText)
      }`;

    let marker =
      state.conquest
        .teammateMarkers.get(
          participantId
        );

    if (marker) {
      marker.setLatLng([
        position.lat,
        position.lng
      ]);

      marker.setIcon(
        rd112ParticipantIcon(
          team,
          isBot
        )
      );

      marker.setTooltipContent(
        tooltip
      );

    } else {
      marker = L.marker(
        [
          position.lat,
          position.lng
        ],
        {
          icon:
            rd112ParticipantIcon(
              team,
              isBot
            ),

          pane:
            "multiplayerPane",

          interactive: isBot,
          keyboard: false
        }
      ).addTo(
        state.conquest.layer
      );

      marker.bindTooltip(
        tooltip,
        {
          sticky: true
        }
      );

      if (isBot) {
        marker.on(
          "click",
          () => {
            const latestPlayer =
              marker.rd87Player;

            const latestPosition =
              rd87VisibleBotPosition(
                latestPlayer
              );

            state.customConquest
              .followBotId =
                participantId;

            state.followUser =
              false;

            rd86FocusPoint(
              latestPosition
            );

            showToast(
              `Following ${
                latestPlayer
                  ?.display_name ||
                "Road Bot"
              } • tap My Location to return`
            );
          }
        );
      }

      state.conquest
        .teammateMarkers.set(
          participantId,
          marker
        );
    }

    marker.rd87Player =
      player;
  }

  for (
    const [
      participantId,
      marker
    ] of
    state.conquest
      .teammateMarkers.entries()
  ) {
    if (
      !seen.has(participantId)
    ) {
      rd86ClearLayerItem(
        marker
      );

      state.conquest
        .teammateMarkers.delete(
          participantId
        );
    }
  }

  rd87EnsureBotAnimation();
};


rd86DrawDeploymentStart =
function () {
  if (
    state.conquest.phase ===
      "deployment"
  ) {
    return roadDiscoveryV112
      .drawDeploymentStart();
  }

  rd86ClearLayerItem(
    state.conquest.startCircle
  );

  rd86ClearLayerItem(
    state.conquest.startMarker
  );

  state.conquest.startCircle =
    null;

  state.conquest.startMarker =
    null;
};


function rd112WaypointButtonState() {
  if (
    !els.conquestFocusStrip
  ) {
    return;
  }

  for (
    const button of
    els.conquestFocusStrip
      .querySelectorAll(
        "[data-conquest-kind]"
      )
  ) {
    const key =
      `${
        button.dataset
          .conquestKind
      }:` +
      `${
        button.dataset
          .conquestId
      }`;

    button.classList.toggle(
      "rd112-waypoint-selected",

      key ===
        state.conquest
          .personalWaypointKey
    );
  }
}


function rd112ClearPersonalWaypoint(
  options = {}
) {
  state.conquest
    .personalWaypoint = null;

  state.conquest
    .personalWaypointKey = "";

  rd86ClearConquestRoute();
  rd112WaypointButtonState();

  if (
    options.toast !== false
  ) {
    showToast(
      "Conquest waypoint cleared"
    );
  }
}

async function rd112DrawPersonalWaypoint(
  options = {}
) {
  const waypoint =
    state.conquest
      .personalWaypoint;

  if (
    !waypoint ||
    state.conquest
      .viewerIsSpectator ||
    ![
      "active",
      "overtime"
    ].includes(
      state.conquest.phase
    )
  ) {
    return;
  }

  const start =
    options.start ||
    state.currentPoint ||
    await getFreshRouteStartPoint();

  if (!start) {
    showToast(
      "Waiting for your location"
    );

    return;
  }

  const requestId =
    ++state.conquest
      .routeRequestId;

  state.conquest
    .routeLoading = true;

  try {
    const route =
      await fetchRoadRoute(
        start,
        waypoint
      );

    if (
      requestId !==
        state.conquest
          .routeRequestId ||
      !state.conquest
        .personalWaypoint
    ) {
      return;
    }

    rd86ClearConquestRoute({
      keepRequest: true
    });

    if (
      !Array.isArray(
        route?.coords
      ) ||
      route.coords.length < 2
    ) {
      showToast(
        "Could not find a public-road route"
      );

      return;
    }

    const colour =
      rd86TeamColour(
        state.conquest
          .viewerTeam
      );

    state.conquest.routeHalo =
      L.polyline(
        route.coords,
        {
          color: "#eef7ff",
          weight: 9,
          opacity: 0.68,
          lineCap: "round",
          lineJoin: "round",
          interactive: false
        }
      ).addTo(
        state.conquest.layer
      );

    state.conquest.routeLine =
      L.polyline(
        route.coords,
        {
          color: colour,
          weight: 5,
          opacity: 1,
          lineCap: "round",
          lineJoin: "round",
          interactive: false
        }
      ).addTo(
        state.conquest.layer
      );

    state.conquest.routeKey =
      state.conquest
        .personalWaypointKey;

    state.conquest
      .lastRouteStartPoint = {
        lat: Number(start.lat),
        lng: Number(start.lng)
      };

    state.conquest.lastRouteAt =
      Date.now();

    rd112WaypointButtonState();

  } catch (error) {
    console.error(error);

    showToast(
      "Could not load the Conquest waypoint"
    );

  } finally {
    if (
      requestId ===
        state.conquest
          .routeRequestId
    ) {
      state.conquest
        .routeLoading = false;
    }
  }
}


function rd112SelectWaypoint(
  kind,
  id,
  target
) {
  const key =
    `${kind}:${id}`;

  if (
    state.conquest
      .personalWaypointKey ===
        key
  ) {
    rd112ClearPersonalWaypoint();

    state.followUser = true;

    return;
  }

  state.conquest
    .personalWaypointKey =
      key;

  state.conquest
    .personalWaypoint = {
      lat: Number(target.lat),
      lng: Number(target.lng),
      kind,
      id: String(id)
    };

  state.customConquest
    .followBotId = null;

  state.followUser = false;

  rd86FocusPoint(target);
  rd112WaypointButtonState();

  void rd112DrawPersonalWaypoint();

  const label =
    kind === "objective"
      ? `Objective ${id}`
      : Number(
          target?.reward
        ) === 150
        ? "Legendary Cache"
        : "Road Cache";

  showToast(
    `${label} waypoint set`
  );
}


function rd112HandleFocusClick(
  event
) {
  const button =
    event.target.closest?.(
      "#conquestFocusStrip " +
      "[data-conquest-kind]"
    );

  if (!button) return;

  const kind =
    button.dataset
      .conquestKind;

  const id =
    button.dataset
      .conquestId;

  const target =
    rd86FocusTarget(
      kind,
      id
    );

  if (!target) return;

  event.preventDefault();

  event.stopImmediatePropagation();

  if (
    state.conquest
      .viewerIsSpectator ||
    ![
      "active",
      "overtime"
    ].includes(
      state.conquest.phase
    )
  ) {
    rd86FocusPoint(target);

    return;
  }

  rd112SelectWaypoint(
    kind,
    id,
    target
  );
}


document.addEventListener(
  "click",
  rd112HandleFocusClick,
  true
);


const rd112OriginalRenderFocusStrip =
  rd86RenderFocusStrip;


rd86RenderFocusStrip =
function () {
  const result =
    rd112OriginalRenderFocusStrip();

  rd112WaypointButtonState();

  return result;
};


rd86MaybeSendConquestLocation =
async function (
  point,
  options = {}
) {
  const result =
    await roadDiscoveryV112
      .maybeSendConquestLocation(
        point,
        options
      );

  if (
    state.conquest
      .personalWaypoint &&
    state.conquest.routeLine &&
    !state.conquest
      .routeLoading &&
    Number(point?.accuracy) <=
      MAX_GPS_ACCURACY_M &&
    Date.now() -
      state.conquest
        .lastRouteAt >=
          RD86_CONQUEST_ROUTE_REROUTE_MS &&
    state.conquest
      .lastRouteStartPoint &&
    haversine(
      point,
      state.conquest
        .lastRouteStartPoint
    ) >=
      RD86_CONQUEST_ROUTE_REROUTE_M
  ) {
    void rd112DrawPersonalWaypoint({
      start: point
    });
  }

  return result;
};


rd86ResetConquestState =
function (
  options = {}
) {
  rd112StopLegendaryTimer();

  state.conquest
    .personalWaypoint = null;

  state.conquest
    .personalWaypointKey = "";

  state.conquest
    .legendarySpawnAt = null;

  state.conquest
    .legendaryEventKey = "";

  state.conquest
    .legendaryRevealKey = "";

  return roadDiscoveryV112
    .resetConquestState(
      options
    );
};


function rd112Init() {
  rd112InstallStyles();

  if (
    rd86HasConquestRound()
  ) {
    void rd112PollLiveOverlay();
  }
}


if (
  document.readyState ===
    "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    rd112Init,
    {
      once: true
    }
  );

} else {
  rd112Init();
}
