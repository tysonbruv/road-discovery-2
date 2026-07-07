/* Road Discovery AU - GitHub Pages prototype
   Static, phone-friendly, no backend.
   Uses Leaflet, OpenStreetMap/CARTO tiles, and Overpass for nearby roads.
*/

const STORAGE_KEY = "roadDiscoveryAU.visited.v1";
const SETTINGS_KEY = "roadDiscoveryAU.settings.v1";

const els = {
  status: document.getElementById("statusText"),
  areaProgress: document.getElementById("areaProgress"),
  todayKm: document.getElementById("todayKm"),
  unlockedCount: document.getElementById("unlockedCount"),
  loadRoadsBtn: document.getElementById("loadRoadsBtn"),
  startBtn: document.getElementById("startBtn"),
  finishBtn: document.getElementById("finishBtn"),
  demoBtn: document.getElementById("demoBtn"),
  locateBtn: document.getElementById("locateBtn"),
  summarySheet: document.getElementById("summarySheet"),
  summaryText: document.getElementById("summaryText"),
  closeSummaryBtn: document.getElementById("closeSummaryBtn"),
  settingsToggle: document.getElementById("settingsToggle"),
  settingsPanel: document.getElementById("settingsPanel"),
  unlockRadius: document.getElementById("unlockRadius"),
  unlockRadiusText: document.getElementById("unlockRadiusText"),
  maxAccuracy: document.getElementById("maxAccuracy"),
  maxAccuracyText: document.getElementById("maxAccuracyText"),
  segmentSize: document.getElementById("segmentSize"),
  resetBtn: document.getElementById("resetBtn"),
};

const state = {
  map: null,
  roadsLayer: L.layerGroup(),
  tripLayer: L.layerGroup(),
  userMarker: null,
  accuracyCircle: null,

  roadSegments: [],
  visited: loadVisited(),

  watchId: null,
  isRecording: false,

  tripUnlocked: new Set(),
  tripDistanceM: 0,
  lastPoint: null,

  demoTimer: null,

  settings: loadSettings(),
};

init();

function init() {
  state.map = L.map("map", {
    zoomControl: false,
    preferCanvas: true,
    attributionControl: true,
  }).setView([-33.7688, 150.905], 14);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  }).addTo(state.map);

  state.roadsLayer.addTo(state.map);
state.tripLayer.addTo(state.map);

// Fix weird blank tile gaps on first load / mobile browsers
setTimeout(() => {
  state.map.invalidateSize(true);
}, 250);

setTimeout(() => {
  state.map.invalidateSize(true);
}, 1000);

window.addEventListener("resize", () => {
  state.map.invalidateSize(true);
});

applySettingsToUi();
wireEvents();
  registerServiceWorker();
  updateStats();

  locateUser(false);

  setStatus("Load roads near you, or press Demo Drive to test instantly.");
}

function wireEvents() {
  els.loadRoadsBtn.addEventListener("click", () => loadRoadsNearMapCenter());
  els.startBtn.addEventListener("click", startDrive);
  els.finishBtn.addEventListener("click", finishDrive);
  els.demoBtn.addEventListener("click", runDemoDrive);
  els.locateBtn.addEventListener("click", () => locateUser(true));

  els.closeSummaryBtn.addEventListener("click", () => {
    els.summarySheet.classList.add("hidden");
  });

  els.settingsToggle.addEventListener("click", () => {
    els.settingsPanel.classList.toggle("hidden");
  });

  els.resetBtn.addEventListener("click", resetVisited);

  els.unlockRadius.addEventListener("input", () => {
    state.settings.unlockRadius = Number(els.unlockRadius.value);
    saveSettings();
    applySettingsToUi();
  });

  els.maxAccuracy.addEventListener("input", () => {
    state.settings.maxAccuracy = Number(els.maxAccuracy.value);
    saveSettings();
    applySettingsToUi();
  });

  els.segmentSize.addEventListener("change", () => {
    state.settings.segmentSize = Number(els.segmentSize.value);
    saveSettings();
    setStatus("Segment size changed. Load roads again to rebuild chunks.");
  });
}

function applySettingsToUi() {
  els.unlockRadius.value = state.settings.unlockRadius;
  els.maxAccuracy.value = state.settings.maxAccuracy;
  els.segmentSize.value = state.settings.segmentSize;

  els.unlockRadiusText.textContent = `${state.settings.unlockRadius} m`;
  els.maxAccuracyText.textContent = `${state.settings.maxAccuracy} m`;
}

async function locateUser(zoom) {
  if (!navigator.geolocation) {
    setStatus("GPS is not available in this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const point = positionToPoint(pos);

      updateUserMarker(point);

      if (zoom) {
        state.map.setView([point.lat, point.lng], 16);
      } else {
        state.map.setView([point.lat, point.lng], Math.max(state.map.getZoom(), 14));
      }

      setStatus("GPS ready. Load roads here, then Start Drive.");
    },
    () => {
      setStatus("GPS permission blocked or unavailable. Demo Drive still works.");
    },
    {
      enableHighAccuracy: true,
      timeout: 9000,
      maximumAge: 5000,
    }
  );
}

async function loadRoadsNearMapCenter() {
  const center = state.map.getCenter();
  await loadRoads(center.lat, center.lng, 1800);
}

async function loadRoads(lat, lng, radiusM) {
  stopDemo();

  state.roadsLayer.clearLayers();
  state.tripLayer.clearLayers();
  state.roadSegments = [];

  updateStats();

  setStatus(`Loading roads within ${(radiusM / 1000).toFixed(1)} km...`);
  els.loadRoadsBtn.disabled = true;

  const query = `
    [out:json][timeout:25];
    way(around:${Math.round(radiusM)},${lat},${lng})
      ["highway"]
      ["highway"!~"footway|cycleway|path|steps|pedestrian|bridleway|corridor|elevator|platform|construction|proposed|raceway"];
    out tags geom;
  `;

  const url = "https://overpass-api.de/api/interpreter";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: new URLSearchParams({ data: query }),
    });

    if (!response.ok) {
      throw new Error(`Overpass returned ${response.status}`);
    }

    const data = await response.json();
    const ways = data.elements || [];

    buildSegmentsFromWays(ways);
    drawSegments();
    updateStats();

    setStatus(
      `Loaded ${state.roadSegments.length.toLocaleString()} road chunks. Press Start Drive.`
    );
  } catch (err) {
    console.error(err);
    setStatus("Could not load nearby roads. Press Demo Drive, or try again in a smaller area.");
  } finally {
    els.loadRoadsBtn.disabled = false;
  }
}

function buildSegmentsFromWays(ways) {
  const segmentSizeM = state.settings.segmentSize;
  const seen = new Set();

  for (const way of ways) {
    if (!way.geometry || way.geometry.length < 2) continue;

    const name = way.tags?.name || "Unnamed road";
    const highway = way.tags?.highway || "road";

    for (let i = 0; i < way.geometry.length - 1; i++) {
      const a = {
        lat: way.geometry[i].lat,
        lng: way.geometry[i].lon,
      };

      const b = {
        lat: way.geometry[i + 1].lat,
        lng: way.geometry[i + 1].lon,
      };

      const dist = haversine(a, b);
      if (dist < 3) continue;

      const pieces = Math.max(1, Math.ceil(dist / segmentSizeM));

      for (let p = 0; p < pieces; p++) {
        const start = interpolate(a, b, p / pieces);
        const end = interpolate(a, b, (p + 1) / pieces);

        const id = `${way.id}:${i}:${p}:${segmentSizeM}`;

        if (seen.has(id)) continue;
        seen.add(id);

        state.roadSegments.push({
          id,
          name,
          highway,
          coords: [
            [start.lat, start.lng],
            [end.lat, end.lng],
          ],
          lengthM: haversine(start, end),
          visited: Boolean(state.visited[id]),
          currentTrip: false,
          layer: null,
        });
      }
    }
  }
}

function drawSegments() {
  const greyStyle = {
    color: "#4e5563",
    weight: 4,
    opacity: 0.82,
    lineCap: "round",
  };

  const orangeStyle = {
    color: "#ff8a18",
    weight: 5,
    opacity: 1,
    lineCap: "round",
  };

  for (const seg of state.roadSegments) {
    const layer = L.polyline(seg.coords, seg.visited ? orangeStyle : greyStyle);

    layer.bindTooltip(
      `${seg.name}<br>${seg.visited ? "Discovered" : "Undiscovered"}`,
      { sticky: true }
    );

    layer.addTo(state.roadsLayer);

    seg.layer = layer;
  }
}

function startDrive() {
  if (!navigator.geolocation) {
    setStatus("GPS is not available in this browser.");
    return;
  }

  if (state.roadSegments.length === 0) {
    setStatus("Load roads first, or use Demo Drive.");
    return;
  }

  stopDemo();

  state.isRecording = true;
  state.tripUnlocked.clear();
  state.tripDistanceM = 0;
  state.lastPoint = null;
  state.tripLayer.clearLayers();

  els.startBtn.classList.add("hidden");
  els.finishBtn.classList.remove("hidden");

  setStatus("Recording. Keep this page open while driving.");

  state.watchId = navigator.geolocation.watchPosition(
    onGpsPosition,
    (err) => {
      setStatus(`GPS error: ${err.message || "location unavailable"}`);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
    }
  );
}

function finishDrive() {
  stopDemo();

  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  state.isRecording = false;

  els.startBtn.classList.remove("hidden");
  els.finishBtn.classList.add("hidden");

  const newKm = sumTripUnlockedKm();

  els.summaryText.innerHTML = `
    ${metersToKm(state.tripDistanceM)} km travelled<br>
    ${newKm.toFixed(2)} km newly discovered<br>
    ${state.tripUnlocked.size} road chunks unlocked
  `;

  els.summarySheet.classList.remove("hidden");

  setStatus("Trip finished. Progress saved on this phone.");
}

function onGpsPosition(position) {
  const point = positionToPoint(position);

  updateUserMarker(point);

  state.map.panTo([point.lat, point.lng], {
    animate: true,
    duration: 0.3,
  });

  if (point.accuracy > state.settings.maxAccuracy) {
    setStatus(`GPS accuracy ${Math.round(point.accuracy)} m. Waiting for cleaner signal...`);
    return;
  }

  if (state.lastPoint) {
    const d = haversine(state.lastPoint, point);

    if (d < 150) {
      state.tripDistanceM += d;
    }

    drawTripLine(state.lastPoint, point);
  }

  state.lastPoint = point;

  const unlockedNow = unlockNearbySegments(point);

  updateStats();

  setStatus(
    unlockedNow > 0
      ? `Unlocked ${unlockedNow} road chunks.`
      : "Recording. Roads turn orange as you drive."
  );
}

function unlockNearbySegments(point) {
  let unlocked = 0;
  const radius = state.settings.unlockRadius;

  for (const seg of state.roadSegments) {
    if (seg.visited) continue;

    const dist = pointToSegmentDistance(point, seg.coords[0], seg.coords[1]);

    if (dist <= radius) {
      seg.visited = true;
      seg.currentTrip = true;

      state.visited[seg.id] = Date.now();
      state.tripUnlocked.add(seg.id);

      styleSegment(seg);

      unlocked++;
    }
  }

  if (unlocked > 0) {
    saveVisited();
  }

  return unlocked;
}

function styleSegment(seg) {
  if (!seg.layer) return;

  if (seg.currentTrip) {
    seg.layer.setStyle({
      color: "#ffb04a",
      weight: 6,
      opacity: 1,
      lineCap: "round",
    });
  } else if (seg.visited) {
    seg.layer.setStyle({
      color: "#ff8a18",
      weight: 5,
      opacity: 1,
      lineCap: "round",
    });
  } else {
    seg.layer.setStyle({
      color: "#4e5563",
      weight: 4,
      opacity: 0.82,
      lineCap: "round",
    });
  }
}

function drawTripLine(a, b) {
  L.polyline(
    [
      [a.lat, a.lng],
      [b.lat, b.lng],
    ],
    {
      color: "#ffb04a",
      weight: 7,
      opacity: 0.35,
      lineCap: "round",
    }
  ).addTo(state.tripLayer);
}

function updateUserMarker(point) {
  const latlng = [point.lat, point.lng];

  if (!state.userMarker) {
    const icon = L.divIcon({
      className: "",
      html: '<div class="user-dot"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    state.userMarker = L.marker(latlng, { icon }).addTo(state.map);
  } else {
    state.userMarker.setLatLng(latlng);
  }

  if (!state.accuracyCircle) {
    state.accuracyCircle = L.circle(latlng, {
      radius: point.accuracy || 20,
      color: "#4bb3ff",
      opacity: 0.35,
      fillColor: "#4bb3ff",
      fillOpacity: 0.06,
      weight: 1,
    }).addTo(state.map);
  } else {
    state.accuracyCircle.setLatLng(latlng);
    state.accuracyCircle.setRadius(point.accuracy || 20);
  }
}

function updateStats() {
  const total = state.roadSegments.length;
  const visitedInArea = state.roadSegments.filter((s) => s.visited).length;
  const percent = total ? (visitedInArea / total) * 100 : 0;

  els.areaProgress.textContent = `${percent.toFixed(2)}%`;
  els.unlockedCount.textContent = total ? `${visitedInArea}/${total}` : "0";
  els.todayKm.textContent = `${sumTripUnlockedKm().toFixed(2)} km`;
}

function sumTripUnlockedKm() {
  let meters = 0;

  for (const seg of state.roadSegments) {
    if (state.tripUnlocked.has(seg.id)) {
      meters += seg.lengthM;
    }
  }

  return meters / 1000;
}

function runDemoDrive() {
  stopDemo();

  state.roadsLayer.clearLayers();
  state.tripLayer.clearLayers();

  state.roadSegments = buildDemoSegments();

  drawSegments();
  updateStats();

  const path = demoPath();

  state.map.setView(path[0], 15);

  state.isRecording = true;
  state.tripUnlocked.clear();
  state.tripDistanceM = 0;
  state.lastPoint = null;

  els.startBtn.classList.add("hidden");
  els.finishBtn.classList.remove("hidden");

  setStatus("Demo Drive running. Watch the roads turn orange.");

  let i = 0;

  state.demoTimer = setInterval(() => {
    const [lat, lng] = path[i];

    onGpsPosition({
      coords: {
        latitude: lat,
        longitude: lng,
        accuracy: 8,
        speed: 8,
        heading: 0,
      },
      timestamp: Date.now(),
    });

    i++;

    if (i >= path.length) {
      finishDrive();
    }
  }, 450);
}

function stopDemo() {
  if (state.demoTimer) {
    clearInterval(state.demoTimer);
    state.demoTimer = null;
  }
}

function buildDemoSegments() {
  const roads = [
    {
      id: "demo-a",
      name: "Reservoir Road",
      coords: [
        [-33.7798, 150.9056],
        [-33.779, 150.9134],
      ],
    },
    {
      id: "demo-b",
      name: "Sunnyholt Road",
      coords: [
        [-33.7756, 150.9002],
        [-33.7798, 150.9056],
        [-33.7848, 150.9118],
      ],
    },
    {
      id: "demo-c",
      name: "Richmond Road",
      coords: [
        [-33.772, 150.893],
        [-33.7756, 150.9002],
        [-33.779, 150.9134],
      ],
    },
    {
      id: "demo-d",
      name: "Main Street",
      coords: [
        [-33.7832, 150.8966],
        [-33.7798, 150.9056],
        [-33.7772, 150.918],
      ],
    },
    {
      id: "demo-e",
      name: "Back Street",
      coords: [
        [-33.787, 150.9042],
        [-33.7848, 150.9118],
        [-33.781, 150.9192],
      ],
    },
  ];

  const segments = [];

  for (const road of roads) {
    for (let i = 0; i < road.coords.length - 1; i++) {
      const a = {
        lat: road.coords[i][0],
        lng: road.coords[i][1],
      };

      const b = {
        lat: road.coords[i + 1][0],
        lng: road.coords[i + 1][1],
      };

      const dist = haversine(a, b);
      const pieces = Math.max(1, Math.ceil(dist / state.settings.segmentSize));

      for (let p = 0; p < pieces; p++) {
        const start = interpolate(a, b, p / pieces);
        const end = interpolate(a, b, (p + 1) / pieces);

        const id = `${road.id}:${i}:${p}:${state.settings.segmentSize}`;

        segments.push({
          id,
          name: road.name,
          highway: "demo",
          coords: [
            [start.lat, start.lng],
            [end.lat, end.lng],
          ],
          lengthM: haversine(start, end),
          visited: Boolean(state.visited[id]),
          currentTrip: false,
          layer: null,
        });
      }
    }
  }

  return segments;
}

function demoPath() {
  const anchors = [
    [-33.772, 150.893],
    [-33.7756, 150.9002],
    [-33.7798, 150.9056],
    [-33.779, 150.9134],
    [-33.7772, 150.918],
  ];

  const path = [];

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = {
      lat: anchors[i][0],
      lng: anchors[i][1],
    };

    const b = {
      lat: anchors[i + 1][0],
      lng: anchors[i + 1][1],
    };

    for (let p = 0; p < 12; p++) {
      const q = interpolate(a, b, p / 12);
      path.push([q.lat, q.lng]);
    }
  }

  path.push(anchors[anchors.length - 1]);

  return path;
}

function resetVisited() {
  const ok = confirm("Reset all discovered roads saved on this phone?");

  if (!ok) return;

  state.visited = {};
  saveVisited();

  for (const seg of state.roadSegments) {
    seg.visited = false;
    seg.currentTrip = false;
    styleSegment(seg);
  }

  state.tripUnlocked.clear();

  updateStats();

  setStatus("Discovered roads reset.");
}

function setStatus(text) {
  els.status.textContent = text;
}

function positionToPoint(position) {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy || 999,
    speed: position.coords.speed,
    heading: position.coords.heading,
    timestamp: position.timestamp || Date.now(),
  };
}

function haversine(a, b) {
  const R = 6371000;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function interpolate(a, b, t) {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

function pointToSegmentDistance(point, segA, segB) {
  const lat0 = toRad(point.lat);

  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos(lat0);

  const px = 0;
  const py = 0;

  const ax = (segA[1] - point.lng) * mPerLng;
  const ay = (segA[0] - point.lat) * mPerLat;

  const bx = (segB[1] - point.lng) * mPerLng;
  const by = (segB[0] - point.lat) * mPerLat;

  const dx = bx - ax;
  const dy = by - ay;

  const len2 = dx * dx + dy * dy;

  if (len2 === 0) {
    return Math.sqrt(ax * ax + ay * ay);
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));

  const x = ax + t * dx;
  const y = ay + t * dy;

  return Math.sqrt(x * x + y * y);
}

function metersToKm(m) {
  return (m / 1000).toFixed(2);
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function loadVisited() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveVisited() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.visited));
}

function loadSettings() {
  try {
    return {
      unlockRadius: 30,
      maxAccuracy: 50,
      segmentSize: 50,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY)),
    };
  } catch {
    return {
      unlockRadius: 30,
      maxAccuracy: 50,
      segmentSize: 50,
    };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}
