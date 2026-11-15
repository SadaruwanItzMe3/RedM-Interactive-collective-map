// Frontier Atlas — Collector's Field Guide
// Data flow: data/collectibles.json (repository) -> optional local edits in LocalStorage (admin mode).

const KEY_COLLECTED = "frontierAtlas.collected";
const KEY_LOCAL = "frontierAtlas.localCollectibles";

const state = {
  data: null,            // { map, categories, collectibles }
  map: null,
  baseLayer: null,
  layers: {},            // category id -> layer group
  markers: new Map(),    // collectible id -> marker
  collected: loadSet(KEY_COLLECTED),
  adminMode: false,
  editingId: null,       // id being edited, or null when adding
  editorOpen: false,
  selectedId: null,
  usingLocalEdits: false
};

const $ = id => document.getElementById(id);

// ---------- Storage ----------
function loadSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key)) || []); } catch { return new Set(); }
}
function saveCollected() {
  try { localStorage.setItem(KEY_COLLECTED, JSON.stringify([...state.collected])); } catch {}
}
function loadLocalCollectibles() {
  try { const v = JSON.parse(localStorage.getItem(KEY_LOCAL)); return Array.isArray(v) ? v : null; } catch { return null; }
}
function saveLocalCollectibles() {
  try { localStorage.setItem(KEY_LOCAL, JSON.stringify(state.data.collectibles)); state.usingLocalEdits = true; }
  catch { showNotice("Could not save: browser storage is full or blocked."); }
  updateNote();
}

// ---------- Data ----------
function cleanCollectibles(list, categories) {
  const ids = new Set(), ok = [];
  (Array.isArray(list) ? list : []).forEach(c => {
    const valid = c && typeof c.id === "string" && typeof c.name === "string" &&
      Number.isFinite(c.x) && Number.isFinite(c.y) && categories.some(k => k.id === c.category);
    if (valid && !ids.has(c.id)) { ids.add(c.id); ok.push(c); }
  });
  return ok;
}
function cleanData(raw) {
  const m = raw && raw.map;
  if (!m || !Number.isFinite(m.width) || !Number.isFinite(m.height) || !Array.isArray(raw.categories)) throw new Error("bad data");
  const categories = raw.categories.filter(c => c && c.id && c.name);
  return { map: m, categories, collectibles: cleanCollectibles(raw.collectibles, categories) };
}

fetch("data/collectibles.json")
  .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
  .then(raw => {
    state.data = cleanData(raw);
    const local = loadLocalCollectibles();
    if (local) { state.data.collectibles = cleanCollectibles(local, state.data.categories); state.usingLocalEdits = true; }
    init();
  })
  .catch(() => showNotice("Could not load data/collectibles.json. Check the file is valid JSON and open the site through a web server."));

function init() {
  setupMap();
  buildCategories();
  fillCategorySelect();
  renderMarkers();
  updateProgress();
  setupSearch();
  setupAdmin();
  $("menu-btn").addEventListener("click", () => {
    const open = $("sidebar").classList.toggle("open");
    $("menu-btn").setAttribute("aria-expanded", open);
  });
  updateNote();
}

// ---------- Map ----------
function setupMap() {
  const { image, width, height } = state.data.map;
  const bounds = [[0, 0], [height, width]];
  state.map = L.map("map", {
    crs: L.CRS.Simple, minZoom: -3, maxZoom: 2, zoomSnap: 0.25,
    maxBounds: [[-height * 0.1, -width * 0.1], [height * 1.1, width * 1.1]], maxBoundsViscosity: 0.8,
    attributionControl: false
  });
  const probe = new Image();
  probe.onload = () => L.imageOverlay(image, bounds).addTo(state.map);
  probe.onerror = () => {
    L.rectangle(bounds, { color: "#c9a24b", weight: 2, fillColor: "#1d1510", fillOpacity: 1, dashArray: "8 8" }).addTo(state.map);
    showNotice("Map image not found. Add it as " + image + ".");
  };
  probe.src = image;
  state.map.fitBounds(bounds);

  const Reset = L.Control.extend({
    onAdd() {
      const bar = L.DomUtil.create("div", "leaflet-bar");
      const a = L.DomUtil.create("a", "", bar);
      a.href = "#"; a.title = "Reset view"; a.setAttribute("role", "button"); a.textContent = "⌂";
      L.DomEvent.on(a, "click", e => { L.DomEvent.preventDefault(e); state.map.fitBounds(bounds); });
      L.DomEvent.disableClickPropagation(bar);
      return bar;
    }
  });
  new Reset({ position: "topright" }).addTo(state.map);

  state.map.on("click", e => {
    if (state.adminMode && state.editorOpen) {      // fill coordinates from the click
      const f = $("editor");
      f.x.value = Math.round(e.latlng.lng);
      f.y.value = Math.round(state.data.map.height - e.latlng.lat);
    }
  });
}

const toLatLng = c => [state.data.map.height - c.y, c.x];
const getCategory = id => state.data.categories.find(c => c.id === id);

// ---------- Markers ----------
function renderMarkers() {
  Object.values(state.layers).forEach(l => l.remove());
  state.layers = {};
  state.markers.clear();
  const hidden = new Set([...document.querySelectorAll("#category-list input")].filter(i => !i.checked).map(i => i.dataset.cat));
  state.data.categories.forEach(cat => {
    state.layers[cat.id] = L.layerGroup();
    if (!hidden.has(cat.id)) state.layers[cat.id].addTo(state.map);
  });
  state.data.collectibles.forEach(item => {
    const cat = getCategory(item.category);
    const marker = L.marker(toLatLng(item), { icon: makeIcon(item, cat), title: item.name, keyboard: true });
    marker.bindPopup(() => buildPopup(item, cat), { maxWidth: 280 });
    marker.on("popupclose", () => { if (state.selectedId === item.id) setSelected(null); });
    marker.addTo(state.layers[cat.id]);
    state.markers.set(item.id, marker);
  });
}

function makeIcon(item, cat) {
  const done = state.collected.has(item.id), sel = state.selectedId === item.id;
  return L.divIcon({
    className: "",
    html: '<div class="marker-pin' + (done ? " done" : "") + (sel ? " selected" : "") + '" style="background:' + cat.color + '">' + (cat.symbol || "•") + "</div>",
    iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16]
  });
}
function refreshMarker(id) {
  const item = state.data.collectibles.find(c => c.id === id), marker = state.markers.get(id);
  if (item && marker) marker.setIcon(makeIcon(item, getCategory(item.category)));
}
function setSelected(id) {
  const prev = state.selectedId;
  state.selectedId = id;
  if (prev) refreshMarker(prev);
  if (id) refreshMarker(id);
}

function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

function buildPopup(item, cat) {
  const done = state.collected.has(item.id);
  const box = el("div", undefined, "popup");
  box.appendChild(el("h3", item.name));
  const dl = el("dl");
  [["Category", cat.name], ["Location", item.location || "—"], ["Coordinates", item.x + ", " + item.y]].forEach(([k, v]) => {
    dl.append(el("dt", k), el("dd", v));
  });
  dl.append(el("dt", "Status"), el("dd", done ? "Collected" : "Not collected", done ? "status-done" : ""));
  box.appendChild(dl);
  if (item.description) box.appendChild(el("p", item.description, "desc" + (item.sample ? " sample-tag" : "")));
  if (item.image) {
    const img = el("img");
    img.src = item.image; img.alt = "Reference for " + item.name; img.loading = "lazy";
    img.onerror = () => img.remove();                 // missing image: just hide it
    box.appendChild(img);
  }
  const toggle = el("button", done ? "Mark as not collected" : "Mark as collected", "btn" + (done ? " is-done" : ""));
  toggle.type = "button";
  toggle.onclick = () => toggleCollected(item.id);
  box.appendChild(toggle);
  if (state.adminMode) {
    const edit = el("button", "Edit this collectible", "btn ghost");
    edit.type = "button";
    edit.onclick = () => openEditor(item.id);
    box.appendChild(edit);
  }
  return box;
}

function toggleCollected(id) {
  state.collected.has(id) ? state.collected.delete(id) : state.collected.add(id);
  saveCollected();
  refreshMarker(id);
  const item = state.data.collectibles.find(c => c.id === id);
  const marker = state.markers.get(id);
  if (item && marker && marker.isPopupOpen()) marker.getPopup().setContent(buildPopup(item, getCategory(item.category)));
  updateProgress();
}

// ---------- Sidebar ----------
function buildCategories() {
  const list = $("category-list");
  list.textContent = "";
  state.data.categories.forEach(cat => {
    const label = el("label");
    const input = el("input");
    input.type = "checkbox"; input.checked = true; input.dataset.cat = cat.id;
    input.onchange = () => {
      const layer = state.layers[cat.id];
      input.checked ? state.map.addLayer(layer) : state.map.removeLayer(layer);
    };
    const pin = el("span", cat.symbol || "•", "pin-sample");
    pin.style.background = cat.color;
    const count = el("span", "", "cat-count");
    count.dataset.cat = cat.id;
    label.append(input, pin, el("span", cat.name, "cat-name"), count);
    const li = el("li");
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
  $("stat-done").textContent = done;
  $("stat-left").textContent = total - done;
  $("stat-total").textContent = total;
  $("overall-bar").style.width = (total ? (done / total) * 100 : 0) + "%";
}

function updateNote() {
  const samples = state.data.collectibles.filter(c => c.sample).length;
  const parts = [];
  if (samples) parts.push(samples + " sample marker(s) shown. Replace them with real server locations.");
  if (state.usingLocalEdits) parts.push("Showing local edits from this browser.");
  $("data-note").textContent = parts.join(" ");
  $("data-note").hidden = !parts.length;
}

// ---------- Search ----------
function setupSearch() {
  const input = $("search"), box = $("results");
  let active = -1, shown = [];

  const run = () => {
    const q = input.value.trim().toLowerCase();
    box.textContent = ""; active = -1;
    if (!q) { box.hidden = true; return; }
    shown = state.data.collectibles.filter(c => {
      const cat = getCategory(c.category);
      return [c.name, c.location, c.description, cat && cat.name].some(t => t && t.toLowerCase().includes(q));
    }).slice(0, 8);
    if (!shown.length) box.appendChild(el("li", "No collectibles match.", "empty"));
    shown.forEach(c => {
      const li = el("li");
      const pin = el("span", getCategory(c.category).symbol || "•", "pin-sample");
      pin.style.background = getCategory(c.category).color;
      const text = el("span", c.name);
      text.appendChild(el("small", getCategory(c.category).name + " · " + (c.location || "")));
      li.append(pin, text);
      li.onclick = () => choose(c);
      box.appendChild(li);
    });
    box.hidden = false;
  };
  const choose = c => {
    box.hidden = true; input.value = c.name;
    $("sidebar").classList.remove("open");
    focusCollectible(c.id);
  };
  input.addEventListener("input", run);
  input.addEventListener("keydown", e => {
    const items = [...box.querySelectorAll("li:not(.empty)")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle("active", i === active));
    } else if (e.key === "Enter") {
      const pick = shown[active >= 0 ? active : 0];
      if (pick) choose(pick);
    } else if (e.key === "Escape") { box.hidden = true; }
  });
  document.addEventListener("click", e => { if (!e.target.closest(".search")) box.hidden = true; });
}

function focusCollectible(id) {
  const item = state.data.collectibles.find(c => c.id === id), marker = state.markers.get(id);
  if (!item || !marker) return;
  const layer = state.layers[item.category];
  if (!state.map.hasLayer(layer)) {                       // make sure its category is visible
    state.map.addLayer(layer);
    const box = document.querySelector('#category-list input[data-cat="' + item.category + '"]');
    if (box) box.checked = true;
  }
  setSelected(id);
  state.map.flyTo(toLatLng(item), Math.max(state.map.getZoom(), 0), { duration: 0.8 });
  state.map.once("moveend", () => marker.openPopup());
}

// ---------- Admin mode ----------
function setupAdmin() {
  $("admin-toggle").onclick = () => {
    state.adminMode = !state.adminMode;
    $("admin-toggle").setAttribute("aria-pressed", state.adminMode);
    $("admin-tools").hidden = !state.adminMode;
    document.body.classList.toggle("admin-on", state.adminMode);
    if (!state.adminMode) closeEditor();
    state.map.closePopup();
  };
  $("add-btn").onclick = () => { $("sidebar").classList.remove("open"); openEditor(null); };
  $("editor-cancel").onclick = closeEditor;
  $("editor").onsubmit = saveEditor;
  $("export-btn").onclick = exportJson;
  $("import-btn").onclick = () => $("import-file").click();
  $("import-file").onchange = importJson;
  $("reset-btn").onclick = () => {
    if (!confirm("Discard all local edits and go back to data/collectibles.json?")) return;
    try { localStorage.removeItem(KEY_LOCAL); } catch {}
    location.reload();
  };
}

function fillCategorySelect() {
  const sel = $("editor").category;
  sel.textContent = "";
  state.data.categories.forEach(c => { const o = el("option", c.name); o.value = c.id; sel.appendChild(o); });
}

function openEditor(id) {
  const f = $("editor"), item = id ? state.data.collectibles.find(c => c.id === id) : null;
  state.editingId = id; state.editorOpen = true;
  $("editor-title").textContent = item ? "Edit collectible" : "Add collectible";
  f.reset();
  if (item) ["name", "category", "location", "x", "y", "description", "image"].forEach(k => f[k].value = item[k] ?? "");
  // Delete button only when editing
  let del = $("editor-delete");
  if (item && !del) {
    del = el("button", "Delete", "btn danger"); del.type = "button"; del.id = "editor-delete";
    del.onclick = deleteEditing;
    f.appendChild(del);
  }
  if (!item && del) del.remove();
  f.hidden = false;
  state.map.closePopup();
}
function closeEditor() { $("editor").hidden = true; state.editorOpen = false; state.editingId = null; }

function saveEditor(e) {
  e.preventDefault();
  const f = $("editor"), x = Number(f.x.value), y = Number(f.y.value), { width, height } = state.data.map;
  if (x < 0 || y < 0 || x > width || y > height) { showNotice("Coordinates must be inside the map (0–" + width + ", 0–" + height + ")."); return; }
  const fields = { name: f.name.value.trim(), category: f.category.value, location: f.location.value.trim(), x, y,
    description: f.description.value.trim(), image: f.image.value.trim() };
  if (state.editingId) {
    Object.assign(state.data.collectibles.find(c => c.id === state.editingId), fields);
  } else {
    state.data.collectibles.push({ id: "custom-" + Date.now(), ...fields });
  }
  saveLocalCollectibles();
  closeEditor(); renderMarkers(); updateProgress();
}

function deleteEditing() {
  if (!confirm("Delete this collectible?")) return;
  state.data.collectibles = state.data.collectibles.filter(c => c.id !== state.editingId);
  state.collected.delete(state.editingId); saveCollected();
  saveLocalCollectibles();
  closeEditor(); renderMarkers(); updateProgress();
}

function exportJson() {
  const out = { map: state.data.map, categories: state.data.categories, collectibles: state.data.collectibles };
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
  const a = el("a"); a.href = url; a.download = "collectibles.json"; a.click();
  URL.revokeObjectURL(url);
}

function importJson() {
  const file = $("import-file").files[0];
  if (!file) return;
  file.text().then(text => {
    const clean = cleanData(JSON.parse(text));
    if (!clean.collectibles.length) throw new Error("empty");
    state.data.collectibles = clean.collectibles;
    saveLocalCollectibles();
    renderMarkers(); updateProgress();
    showNotice("Imported " + clean.collectibles.length + " collectibles.");
  }).catch(() => showNotice("Import failed: the file is not a valid collectibles.json."))
    .finally(() => { $("import-file").value = ""; });
}

// ---------- Helpers ----------
let noticeTimer;
function showNotice(text) {
  const n = $("map-notice");
  n.textContent = text; n.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { n.hidden = true; }, 6000);
}
