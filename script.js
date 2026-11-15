// Frontier Atlas — stage 1: map, category filters, sample markers, collected status.

const STORAGE_KEY = "frontierAtlas.collected";
const state = {
  data: null,
  map: null,
  markers: {},                       // collectible id -> Leaflet marker
  layers: {},                        // category id  -> Leaflet layer group
  collected: loadCollected()
};

// ---------- LocalStorage ----------
function loadCollected() {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY)) || []); }
  catch { return new Set(); }
}
function saveCollected() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.collected])); }
  catch { /* storage may be blocked; app still works for this session */ }
}

// ---------- Start ----------
fetch("data/collectibles.json")
  .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
  .then(data => { state.data = data; init(); })
  .catch(() => {
    showNotice("Could not load data/collectibles.json. Open the site through a local server (for example VS Code Live Server), not by double-clicking index.html.");
  });

function init() {
  setupMap();
  buildCategories();
  addMarkers();
  updateProgress();
  setupSidebarToggle();

  const samples = state.data.collectibles.filter(c => c.sample).length;
  if (samples) {
    document.getElementById("data-note").textContent =
      "Showing " + samples + " sample marker(s). Replace them with your server's real locations in data/collectibles.json.";
  }
}

// ---------- Map ----------
function setupMap() {
  const { image, width, height } = state.data.map;
  // Simple CRS: 1 map unit = 1 image pixel. Leaflet uses [y, x] and y grows upward, so we flip y.
  const bounds = [[0, 0], [height, width]];

  state.map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: -3,
    maxZoom: 2,
    zoomSnap: 0.25,
    maxBounds: [[-height * 0.1, -width * 0.1], [height * 1.1, width * 1.1]],
    maxBoundsViscosity: 0.8,
    attributionControl: false
  });

  // Check the image exists first so we can show a friendly placeholder if it doesn't.
  const probe = new Image();
  probe.onload = () => L.imageOverlay(image, bounds).addTo(state.map);
  probe.onerror = () => {
    drawPlaceholder(bounds, width, height);
    showNotice("Map image not found. Add your map as " + image + " (see assets/README.txt).");
  };
  probe.src = image;

  state.map.fitBounds(bounds);
}

function drawPlaceholder(bounds, width, height) {
  L.rectangle(bounds, { color: "#c9a24b", weight: 2, fill: true, fillColor: "#1d1510", fillOpacity: 1, dashArray: "8 8" }).addTo(state.map);
  for (let x = 512; x < width; x += 512) L.polyline([[0, x], [height, x]], { color: "#3a281c", weight: 1 }).addTo(state.map);
  for (let y = 512; y < height; y += 512) L.polyline([[y, 0], [y, width]], { color: "#3a281c", weight: 1 }).addTo(state.map);
}

// Convert JSON pixel position (from top-left) to a Leaflet point.
function toLatLng(c) {
  return [state.data.map.height - c.y, c.x];
}

// ---------- Markers ----------
function addMarkers() {
  state.data.categories.forEach(cat => {
    state.layers[cat.id] = L.layerGroup().addTo(state.map);
  });

  state.data.collectibles.forEach(item => {
    const cat = getCategory(item.category);
    if (!cat) return;                // ignore items with an unknown category
    const marker = L.marker(toLatLng(item), { icon: makeIcon(cat, state.collected.has(item.id)), title: item.name });
    marker.bindPopup(() => buildPopup(item, cat), { maxWidth: 280 });
    marker.addTo(state.layers[cat.id]);
    state.markers[item.id] = marker;
  });
}

function makeIcon(cat, done) {
  return L.divIcon({
    className: "",
    html: '<div class="marker-pin' + (done ? " done" : "") + '" style="background:' + cat.color + '">' + cat.symbol + "</div>",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  });
}

function buildPopup(item, cat) {
  const done = state.collected.has(item.id);
  const el = document.createElement("div");
  el.className = "popup";

  const title = document.createElement("h3");
  title.textContent = item.name;
  el.appendChild(title);

  const dl = document.createElement("dl");
  [["Category", cat.name], ["Location", item.location], ["Coordinates", item.x + ", " + item.y],
   ["Status", done ? "Collected" : "Not collected"]].forEach(([k, v]) => {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    dl.append(dt, dd);
  });
  el.appendChild(dl);

  const desc = document.createElement("p");
  desc.className = "desc" + (item.sample ? " sample-tag" : "");
  desc.textContent = item.description;
  el.appendChild(desc);

  if (item.image) {
    const img = document.createElement("img");
    img.src = item.image; img.alt = "Reference for " + item.name; img.loading = "lazy";
    el.appendChild(img);
  }

  const btn = document.createElement("button");
  btn.textContent = done ? "Mark as not collected" : "Mark as collected";
  btn.className = done ? "is-done" : "";
  btn.addEventListener("click", () => toggleCollected(item, cat));
  el.appendChild(btn);
  return el;
}

function toggleCollected(item, cat) {
  if (state.collected.has(item.id)) state.collected.delete(item.id);
  else state.collected.add(item.id);
  saveCollected();
  const marker = state.markers[item.id];
  marker.setIcon(makeIcon(cat, state.collected.has(item.id)));
  marker.setPopupContent(buildPopup(item, cat));   // refresh status text and button
  updateProgress();
}

// ---------- Sidebar ----------
function buildCategories() {
  const list = document.getElementById("category-list");
  state.data.categories.forEach(cat => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    label.innerHTML =
      '<input type="checkbox" checked>' +
      '<span class="swatch" style="background:' + cat.color + '"></span>' +
      '<span class="cat-name"></span><span class="cat-count" data-cat="' + cat.id + '"></span>';
    label.querySelector(".cat-name").textContent = cat.name;
    label.querySelector("input").addEventListener("change", e => {
      const layer = state.layers[cat.id];
      if (e.target.checked) state.map.addLayer(layer); else state.map.removeLayer(layer);
    });
    li.appendChild(label);
    list.appendChild(li);
  });
}

function updateProgress() {
  let total = 0, done = 0;
  state.data.categories.forEach(cat => {
    const items = state.data.collectibles.filter(c => c.category === cat.id);
    const got = items.filter(c => state.collected.has(c.id)).length;
    total += items.length; done += got;
    const badge = document.querySelector('.cat-count[data-cat="' + cat.id + '"]');
    if (badge) badge.textContent = got + "/" + items.length;
  });
  document.getElementById("overall-text").textContent = done + " of " + total + " collected";
  document.getElementById("overall-bar").style.width = (total ? (done / total) * 100 : 0) + "%";
}

function setupSidebarToggle() {
  const btn = document.getElementById("menu-btn");
  const sidebar = document.getElementById("sidebar");
  btn.addEventListener("click", () => {
    const open = sidebar.classList.toggle("open");
    btn.setAttribute("aria-expanded", open);
  });
}

// ---------- Helpers ----------
function getCategory(id) { return state.data.categories.find(c => c.id === id); }

function showNotice(text) {
  const n = document.getElementById("map-notice");
  n.textContent = text;
  n.hidden = false;
}
