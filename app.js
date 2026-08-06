/* global ol, shp, GeoTIFF, pdfjsLib, JSZip */
const APP_KEY = "notatkart:data:v1";
const VISIBILITY_KEY = "notatkart:layer-visibility:v1";
const PROJECT_INDEX_KEY = "notatkart:projects:v1";
const ACTIVE_PROJECT_KEY = "notatkart:active-project:v1";
const PHOTO_DB = "notatkart-photos";
const PHOTO_STORE = "photos";
const projection = "EPSG:3857";
const $ = (id) => document.getElementById(id);
const drawingSource = new ol.source.Vector();
const notesSource = new ol.source.Vector();
const importSource = new ol.source.Vector();
const positionSource = new ol.source.Vector();
const format = new ol.format.GeoJSON();
let drawInteraction;
let modifyInteraction;
let toolMode = null;
let selectedFeature = null;
let pendingPhoto = null;
let pendingSymbol = null;
let quickCoordinate = null;
let quickPhotoCoordinate = null;
let longPressTimer;
let ignoreSingleClickUntil = 0;
let positionWatch;
let trackWatch;
let trackFeature = null;
let trackCoordinates = [];
let toastTimer;
function projectDataKey(id) { return `${APP_KEY}:project:${id}`; }
function projectVisibilityKey(id) { return `${VISIBILITY_KEY}:project:${id}`; }
function readProjects() { try { return JSON.parse(localStorage.getItem(PROJECT_INDEX_KEY)) || []; } catch { return []; } }
function writeProjects(projects) { localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(projects)); }
function createProject(name) { return { id: uid(), name: name || "Nytt prosjekt", createdAt: new Date().toISOString() }; }
function initialiseProjects() {
  let projects = readProjects();
  if (!projects.length) {
    const first = createProject("Mitt første prosjekt");
    projects = [first]; writeProjects(projects);
    const oldData = localStorage.getItem(APP_KEY); const oldVisibility = localStorage.getItem(VISIBILITY_KEY);
    if (oldData) localStorage.setItem(projectDataKey(first.id), oldData);
    if (oldVisibility) localStorage.setItem(projectVisibilityKey(first.id), oldVisibility);
    localStorage.setItem(ACTIVE_PROJECT_KEY, first.id);
  }
  const requested = localStorage.getItem(ACTIVE_PROJECT_KEY);
  const active = projects.find((project) => project.id === requested) || projects[0];
  localStorage.setItem(ACTIVE_PROJECT_KEY, active.id);
  return { projects, activeId: active.id };
}
const projectState = initialiseProjects();
let activeProjectId = projectState.activeId;
let groupVisibility = JSON.parse(localStorage.getItem(projectVisibilityKey(activeProjectId)) || "{}");

function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function toast(message) { const el = $("toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3600); }
const symbolNames = { culvert: "Stikkrenne", landing: "Velteplass", turning: "Snuplass", "arrow-left": "Gul pil venstre", "arrow-right": "Gul pil høyre" };
const svgIcon = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const symbolIcons = {
  culvert: svgIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#9bdcff"/><stop offset=".48" stop-color="#247fbd"/><stop offset="1" stop-color="#075082"/></linearGradient></defs><path d="M14 19h32v27H14z" fill="url(#b)" stroke="#064a78" stroke-width="3"/><ellipse cx="14" cy="32.5" rx="8" ry="14" fill="#8ed8ff" stroke="#064a78" stroke-width="3"/><ellipse cx="14" cy="32.5" rx="4" ry="9" fill="#163f5a"/><ellipse cx="46" cy="32.5" rx="8" ry="14" fill="#12679d" stroke="#064a78" stroke-width="3"/><path d="M20 22h20" stroke="#d7f3ff" stroke-width="3" opacity=".7"/></svg>`),
  landing: svgIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#5b351b" stroke-width="3"><path d="M10 43h40a7 7 0 0 0 0-14H10a7 7 0 0 0 0 14Z" fill="#a96a36"/><path d="M16 29h36a7 7 0 0 0 0-14H16a7 7 0 0 0 0 14Z" fill="#c78345"/><circle cx="10" cy="36" r="7" fill="#e5b271"/><circle cx="16" cy="22" r="7" fill="#e5b271"/><circle cx="10" cy="36" r="3" fill="#7c4a24"/><circle cx="16" cy="22" r="3" fill="#7c4a24"/></g><path d="M22 18h24M16 32h28" stroke="#f2c889" stroke-width="2" opacity=".8"/></svg>`),
  turning: svgIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="none" stroke="#68727a" stroke-width="6" stroke-linecap="round"><path d="M32 9a23 23 0 0 1 20 12"/><path d="M54 32a23 23 0 0 1-12 20"/><path d="M32 55A23 23 0 0 1 12 43"/><path d="M10 32a23 23 0 0 1 12-20"/></g><g fill="#68727a"><path d="m50 13 9 10-14 1z"/><path d="m51 50-10 9-1-14z"/><path d="m14 51-9-10 14-1z"/><path d="m13 14 10-9 1 14z"/></g><circle cx="32" cy="32" r="8" fill="#d9dde0" stroke="#68727a" stroke-width="3"/></svg>`),
  "arrow-left": svgIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 52"><path d="M7 26 30 5v12h34v18H30v12z" fill="#ffd52d" stroke="#9a7600" stroke-width="4" stroke-linejoin="round"/><path d="M33 21h25" stroke="#fff2a3" stroke-width="4" stroke-linecap="round" opacity=".85"/></svg>`),
  "arrow-right": svgIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 52"><path d="m65 26-23 21V35H8V17h34V5z" fill="#ffd52d" stroke="#9a7600" stroke-width="4" stroke-linejoin="round"/><path d="M39 21H14" stroke="#fff2a3" stroke-width="4" stroke-linecap="round" opacity=".85"/></svg>`)
};
function symbolText(feature) { if (feature.get("symbolText")) return feature.get("symbolText"); if (feature.get("symbolType") === "culvert" && feature.get("diameter")) return `Ø ${feature.get("diameter")} mm`; return ""; }
function importKey(feature) { return `import:${feature.get("sourceName") || "ukjent"}`; }
function noteKey(feature) { return feature.get("noteType") === "symbol" ? `symbol:${feature.get("symbolType") || "other"}` : `note:${feature.get("noteType") || "other"}`; }
function groupIsVisible(key) { return groupVisibility[key] !== false; }
function setGroupVisibility(key, visible) { groupVisibility[key] = visible; localStorage.setItem(projectVisibilityKey(activeProjectId), JSON.stringify(groupVisibility)); importSource.changed(); drawingSource.changed(); notesSource.changed(); }
function mapSymbolStyle(feature) {
  const type = feature.get("symbolType"); const label = symbolText(feature); const rotation = feature.get("rotation") || 0;
  const labelStyle = label ? new ol.style.Style({ text: new ol.style.Text({ text: label, offsetY: -27, font: "800 13px system-ui", fill: new ol.style.Fill({ color: type === "culvert" ? "#247fbd" : "#17302a" }), stroke: new ol.style.Stroke({ color: "#fff", width: 3 }) }) }) : null;
  let base;
  if (type === "arrow-left" || type === "arrow-right") base = new ol.style.Style({ text: new ol.style.Text({ text: type === "arrow-left" ? "←" : "→", font: "900 42px system-ui", fill: new ol.style.Fill({ color: "#ffd52d" }), stroke: new ol.style.Stroke({ color: "#9a7600", width: 3 }) }) });
  else if (type === "culvert") { const lines = [-4, 4].map((offsetY) => new ol.style.Style({ text: new ol.style.Text({ text: "━", offsetY, rotation, scale: [1.25, .75], font: "800 25px system-ui", fill: new ol.style.Fill({ color: "#247fbd" }), stroke: new ol.style.Stroke({ color: "#064a78", width: 1.1 }) }) })); return labelStyle ? [...lines, labelStyle] : lines; }
  else if (type === "landing") { const logEnds = [[-10, -8.7, "#d99a62"], [0, -8.7, "#c78345"], [10, -8.7, "#e0a26b"], [-5, 0, "#bf7540"], [5, 0, "#d18a51"], [0, 8.7, "#e5ad77"]]; const logs = logEnds.flatMap(([x, y, color]) => [new ol.style.Style({ image: new ol.style.Circle({ radius: 4.5, displacement: [x, y], fill: new ol.style.Fill({ color }), stroke: new ol.style.Stroke({ color: "#5b351b", width: 1 }) }) }), new ol.style.Style({ image: new ol.style.Circle({ radius: 1.7, displacement: [x, y], fill: new ol.style.Fill({ color: "#f4cea0" }), stroke: new ol.style.Stroke({ color: "#a56436", width: .5 }) }) })]); return labelStyle ? [...logs, labelStyle] : logs; }
  else base = new ol.style.Style({ text: new ol.style.Text({ text: "⟳", font: "900 42px system-ui", fill: new ol.style.Fill({ color: "#68727a" }), stroke: new ol.style.Stroke({ color: "#fff", width: 2 }) }) });
  return labelStyle ? [base, labelStyle] : base;
}
function scaleSymbolStyles(styles, factor) { if (factor === 1) return styles; const list = Array.isArray(styles) ? styles : [styles]; list.forEach((style) => { const image = style.getImage(); if (image) { image.setScale(factor); const displacement = image.getDisplacement?.() || [0, 0]; image.setDisplacement?.(displacement.map((value) => value * factor)); } const text = style.getText(); if (text) { const scale = text.getScaleArray(); text.setScale([scale[0] * factor, scale[1] * factor]); text.setOffsetX(text.getOffsetX() * factor); text.setOffsetY(text.getOffsetY() * factor); } }); return styles; }
function localFeatureStyle(feature, resolution) {
  if (!groupIsVisible(noteKey(feature))) return null;
  const scaleDenominator = ol.proj.getPointResolution(projection, resolution, map.getView().getCenter(), "m") * (96 / .0254);
  if (scaleDenominator >= 10000) return null;
  const type = feature.get("noteType");
  if (type === "symbol") {
    return scaleSymbolStyles(mapSymbolStyle(feature), scaleDenominator >= 3000 ? .5 : 1);
    const symbolType = feature.get("symbolType");
    const styles = {
      culvert: new ol.style.Style({ image: new ol.style.Icon({ src: symbolIcons.culvert, scale: 0.78, anchor: [0.5, 0.5] }), text: new ol.style.Text({ text: symbolText(feature), offsetY: -27, font: "800 13px system-ui", fill: new ol.style.Fill({ color: "#17302a" }), stroke: new ol.style.Stroke({ color: "#fff", width: 3 }) }) }),
      landing: new ol.style.Style({ image: new ol.style.Icon({ src: symbolIcons.landing, scale: 0.78, anchor: [0.5, 0.5] }), text: new ol.style.Text({ text: symbolText(feature), offsetY: -27, font: "800 12px system-ui", fill: new ol.style.Fill({ color: "#17302a" }), stroke: new ol.style.Stroke({ color: "#fff", width: 3 }) }) }),
      turning: new ol.style.Style({ image: new ol.style.Icon({ src: symbolIcons.turning, scale: 0.78, anchor: [0.5, 0.5] }), text: new ol.style.Text({ text: symbolText(feature), offsetY: -27, font: "800 12px system-ui", fill: new ol.style.Fill({ color: "#17302a" }), stroke: new ol.style.Stroke({ color: "#fff", width: 3 }) }) }),
      "arrow-left": new ol.style.Style({ image: new ol.style.Icon({ src: symbolIcons["arrow-left"], scale: 0.76, anchor: [0.5, 0.5] }), text: new ol.style.Text({ text: symbolText(feature), offsetY: -25, font: "800 12px system-ui", fill: new ol.style.Fill({ color: "#17302a" }), stroke: new ol.style.Stroke({ color: "#fff", width: 3 }) }) }),
      "arrow-right": new ol.style.Style({ image: new ol.style.Icon({ src: symbolIcons["arrow-right"], scale: 0.76, anchor: [0.5, 0.5] }), text: new ol.style.Text({ text: symbolText(feature), offsetY: -25, font: "800 12px system-ui", fill: new ol.style.Fill({ color: "#17302a" }), stroke: new ol.style.Stroke({ color: "#fff", width: 3 }) }) })
    };
    return styles[symbolType];
  }
  if (type === "text" && feature.get("bubble")) return bubbleStyle(feature);
  if (type === "text" || type === "location") return new ol.style.Style({ image: new ol.style.Circle({ radius: 9, fill: new ol.style.Fill({ color: type === "location" ? "#2877d5" : "#dc6f45" }), stroke: new ol.style.Stroke({ color: "#fff", width: 2 }) }), text: new ol.style.Text({ text: feature.get("title") || "Notat", offsetY: -19, font: "700 13px system-ui", fill: new ol.style.Fill({ color: "#17302a" }), stroke: new ol.style.Stroke({ color: "#fff", width: 3 }) }) });
  if (type === "track") return new ol.style.Style({ stroke: new ol.style.Stroke({ color: "#2877d5", width: 5, lineCap: "round", lineJoin: "round" }), image: new ol.style.Circle({ radius: 5, fill: new ol.style.Fill({ color: "#2877d5" }), stroke: new ol.style.Stroke({ color: "#fff", width: 2 }) }) });
  if (type === "photo") return new ol.style.Style({ image: new ol.style.RegularShape({ points: 4, radius: 12, angle: Math.PI / 4, fill: new ol.style.Fill({ color: "#1e4d3a" }), stroke: new ol.style.Stroke({ color: "#fff", width: 2 }) }), text: new ol.style.Text({ text: "Bilde", offsetY: -21, font: "700 12px system-ui", fill: new ol.style.Fill({ color: "#17302a" }), stroke: new ol.style.Stroke({ color: "#fff", width: 3 }) }) });
  const geometryType = feature.getGeometry().getType();
  if (type === "sketch" && feature.get("sketchKind") === "LineString" && feature.get("title") && feature.get("title") !== "Skisse") return new ol.style.Style({ stroke: new ol.style.Stroke({ color: "#dc6f45", width: 4, lineCap: "round", lineJoin: "round" }), text: new ol.style.Text({ text: resolution <= 2 ? feature.get("title") : "", placement: "line", overflow: true, font: "800 14px system-ui", fill: new ol.style.Fill({ color: "#17302a" }), stroke: new ol.style.Stroke({ color: "#fff", width: 4 }) }) });
  const color = feature.get("styleColor") || "#dc6f45";
  return new ol.style.Style({ fill: geometryType === "Polygon" ? new ol.style.Fill({ color: "rgba(220,111,69,.18)" }) : undefined, stroke: new ol.style.Stroke({ color, width: 4, lineCap: "round", lineJoin: "round" }), image: new ol.style.Circle({ radius: 5, fill: new ol.style.Fill({ color }) }) });
}
function rasterStyle(feature) { const image = feature.get("image"); if (!image?.width) return new ol.style.Style({ fill: new ol.style.Fill({ color: "rgba(49,115,86,.18)" }), stroke: new ol.style.Stroke({ color: "#317356", width: 2, lineDash: [6, 4] }) }); return new ol.style.Style({ renderer(coordinates, state) { const ring = coordinates[0]; if (!ring?.length) return; const [topLeft, topRight, , bottomLeft] = ring; const context = state.context; context.save(); context.globalAlpha = 0.96; context.setTransform((topRight[0] - topLeft[0]) / image.width, (topRight[1] - topLeft[1]) / image.width, (bottomLeft[0] - topLeft[0]) / image.height, (bottomLeft[1] - topLeft[1]) / image.height, topLeft[0], topLeft[1]); context.drawImage(image, 0, 0); context.restore(); } }); }
function importedStyle(feature) { if (!groupIsVisible(importKey(feature))) return null; if (feature.get("importType") === "raster") return rasterStyle(feature); return new ol.style.Style({ fill: new ol.style.Fill({ color: "rgba(49,115,86,.13)" }), stroke: new ol.style.Stroke({ color: "#317356", width: 2 }), image: new ol.style.Circle({ radius: 4, fill: new ol.style.Fill({ color: "#317356" }) }) }); }
const baseLayer = new ol.layer.Tile({ source: new ol.source.TileWMS({ url: "https://wms.geonorge.no/skwms1/wms.norges_grunnkart", params: { LAYERS: "Norges_grunnkart", FORMAT: "image/png", TRANSPARENT: false }, crossOrigin: "anonymous" }) });
const losmasserLayer = new ol.layer.Tile({ visible: false, source: new ol.source.TileWMS({ url: "https://geo.ngu.no/mapserver/LosmasserWMS3", params: { LAYERS: "Losmasser_temakart_sammenstilt", FORMAT: "image/png", TRANSPARENT: true }, crossOrigin: "anonymous" }) });
const marinLeireLayer = new ol.layer.Tile({ visible: false, source: new ol.source.TileWMS({ url: "https://geo.ngu.no/mapserver/MarinGrenseWMS4", params: { LAYERS: "Mulig_marin_leire", FORMAT: "image/png", TRANSPARENT: true }, crossOrigin: "anonymous" }) });
const skogbruksplanLayer = new ol.layer.Tile({ visible: false, source: new ol.source.TileWMS({ url: "https://wms.nibio.no/cgi-bin/skogbruksplan", params: { LAYERS: "hogstklasser", STYLES: "default", FORMAT: "image/png", TRANSPARENT: true }, crossOrigin: "anonymous" }) });
const nokkelbiotoperLayer = new ol.layer.Tile({ visible: false, source: new ol.source.TileWMS({ url: "https://wms.nibio.no/cgi-bin/mis", params: { LAYERS: "Nokkelbiotop", FORMAT: "image/png", TRANSPARENT: true }, crossOrigin: "anonymous" }) });
const kulturminnerLayer = new ol.layer.Tile({ visible: false, source: new ol.source.TileWMS({ url: "https://askeladden_wms.ra.no/arcgis/services/WMS/RA_Askeladden/MapServer/WMSServer", params: { VERSION: "1.3.0", LAYERS: "Sikringssone_fredet,Lokaliteter,Enkeltminner,Kulturmiljo,Kulturmiljoikon,Lokalitetsikon,Enkeltminneikon,Freda_bygninger", FORMAT: "image/png", TRANSPARENT: true }, crossOrigin: "anonymous" }) });
const artskartLayer = new ol.layer.Tile({ visible: false, source: new ol.source.TileWMS({ url: "https://wms.nibio.no/cgi-bin/artsdata", params: { LAYERS: "Arteriskog", FORMAT: "image/png", TRANSPARENT: true }, crossOrigin: "anonymous" }) });
const importLayer = new ol.layer.Vector({ source: importSource, style: importedStyle });
const notesLayer = new ol.layer.Vector({ source: notesSource, style: localFeatureStyle });
const drawingLayer = new ol.layer.Vector({ source: drawingSource, style: localFeatureStyle });
const positionLayer = new ol.layer.Vector({ source: positionSource, style: new ol.style.Style({ image: new ol.style.Circle({ radius: 8, fill: new ol.style.Fill({ color: "#2877d5" }), stroke: new ol.style.Stroke({ color: "#fff", width: 3 }) }) }) });
const map = new ol.Map({ target: "map", layers: [baseLayer, losmasserLayer, marinLeireLayer, skogbruksplanLayer, nokkelbiotoperLayer, kulturminnerLayer, artskartLayer, importLayer, drawingLayer, notesLayer, positionLayer], view: new ol.View({ center: ol.proj.fromLonLat([10.256, 60.168]), zoom: 8, maxZoom: 20 }), controls: ol.control.defaults.defaults({ attribution: false }) });
function niceScaleDistance(metres) { const power = 10 ** Math.floor(Math.log10(Math.max(metres, 1))); return [5, 2, 1].map((step) => step * power).find((distance) => distance <= metres) || power; }
function updateMapScale() { const view = map.getView(); const resolution = view.getResolution(); if (!resolution) return; const metresPerPixel = ol.proj.getPointResolution(projection, resolution, view.getCenter(), "m"); const distance = niceScaleDistance(metresPerPixel * 92); const width = Math.max(34, Math.min(92, distance / metresPerPixel)); const ratio = Math.round(metresPerPixel * (96 / .0254)); $("scale-ratio").textContent = `1 : ${ratio.toLocaleString("nb-NO")}`; $("scale-distance").textContent = distance >= 1000 ? `${distance / 1000} km` : `${distance} m`; $("scale-bar").style.width = `${width}px`; }
map.getView().on("change:resolution", updateMapScale); map.getView().on("change:center", updateMapScale); map.once("rendercomplete", updateMapScale);

function appendLayerRow(container, label, count, key) { const row = document.createElement("label"); const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.setAttribute("aria-label", `${label} (${count})`); checkbox.checked = groupIsVisible(key); checkbox.addEventListener("change", () => setGroupVisibility(key, checkbox.checked)); const text = document.createElement("span"); text.textContent = label; const amount = document.createElement("small"); amount.textContent = `${count}`; row.append(checkbox, text, amount); container.append(row); }
function refreshLayerMenus() { const importList = $("import-list"); const importedGroups = new Map(); importSource.getFeatures().forEach((feature) => { const name = feature.get("sourceName") || "Importerte data"; importedGroups.set(name, (importedGroups.get(name) || 0) + 1); }); importList.replaceChildren(); if (importedGroups.size) importedGroups.forEach((count, name) => appendLayerRow(importList, name, count, `import:${name}`)); else importList.textContent = "Ingen importerte data ennå."; const notesList = $("notes-list"); const noteGroups = new Map(); [...drawingSource.getFeatures(), ...notesSource.getFeatures()].forEach((feature) => { const key = noteKey(feature); noteGroups.set(key, (noteGroups.get(key) || 0) + 1); }); const groups = [{ key: "note:sketch", label: "Skisser" }, { key: "note:text", label: "Tekstnotater" }, { key: "note:photo", label: "Bilder" }, { key: "symbol:culvert", label: "Stikkrenner" }, { key: "symbol:landing", label: "Velteplasser" }, { key: "symbol:turning", label: "Snuplasser" }, { key: "symbol:arrow-left", label: "Gule piler mot venstre" }, { key: "symbol:arrow-right", label: "Gule piler mot høyre" }]; notesList.replaceChildren(); groups.forEach((group) => appendLayerRow(notesList, group.label, noteGroups.get(group.key) || 0, group.key)); }
function countObjects() { const importedDatasets = new Set(importSource.getFeatures().map((feature) => feature.get("sourceName") || "Importerte data")).size; $("import-count").textContent = `${importedDatasets} datasett`; const noteObjects = drawingSource.getFeatures().length + notesSource.getFeatures().length; $("note-count").textContent = `${noteObjects} objekt${noteObjects === 1 ? "" : "er"}`; refreshLayerMenus(); }
function serialise(source) { const images = source.getFeatures().map((feature) => [feature, feature.get("image")]); images.forEach(([feature, image]) => { if (image) feature.unset("image", true); }); const data = format.writeFeaturesObject(source.getFeatures(), { featureProjection: projection, dataProjection: projection }); images.forEach(([feature, image]) => { if (image) feature.set("image", image, true); }); return data; }
function readInto(source, data) { if (data?.features) source.addFeatures(format.readFeatures(data, { featureProjection: projection, dataProjection: projection })); }
function saveData() { localStorage.setItem(projectDataKey(activeProjectId), JSON.stringify({ drawings: serialise(drawingSource), notes: serialise(notesSource), imports: serialise(importSource) })); countObjects(); }
function loadData() { try { const data = JSON.parse(localStorage.getItem(projectDataKey(activeProjectId))); if (data) { readInto(drawingSource, data.drawings); readInto(notesSource, data.notes); readInto(importSource, data.imports); } } catch { toast("Kunne ikke lese tidligere lokale notater."); } countObjects(); }
function renderProjectPicker() { const select = $("project-select"); select.replaceChildren(); projectState.projects.forEach((project) => { const option = document.createElement("option"); option.value = project.id; option.textContent = project.name; option.selected = project.id === activeProjectId; select.append(option); }); $("project-name").value = projectState.projects.find((project) => project.id === activeProjectId)?.name || ""; }
function zoomToProject() { const features = [...drawingSource.getFeatures(), ...notesSource.getFeatures(), ...importSource.getFeatures()]; if (!features.length) return; const extent = ol.extent.createEmpty(); features.forEach((feature) => ol.extent.extend(extent, feature.getGeometry().getExtent())); if (!ol.extent.isEmpty(extent)) map.getView().fit(extent, { padding: [70, 280, 70, 280], maxZoom: 16, duration: 500 }); }
function switchProject(id) {
  if (id === activeProjectId || !projectState.projects.some((project) => project.id === id)) return;
  saveData(); deactivateTool(); hideDetail(); drawingSource.clear(); notesSource.clear(); importSource.clear(); positionSource.clear();
  activeProjectId = id; localStorage.setItem(ACTIVE_PROJECT_KEY, id); groupVisibility = JSON.parse(localStorage.getItem(projectVisibilityKey(id)) || "{}");
  loadData(); restoreRasterImages(); zoomToProject(); renderProjectPicker(); toast(`Byttet til ${projectState.projects.find((project) => project.id === id).name}.`);
}
function addProject() { const project = createProject("Nytt prosjekt"); projectState.projects.push(project); writeProjects(projectState.projects); switchProject(project.id); const field = $("project-name"); field.focus(); field.select(); toast("Nytt, tomt prosjekt er klart. Skriv inn prosjektnavnet øverst."); }
function renameProject() { const project = projectState.projects.find((item) => item.id === activeProjectId); const name = $("project-name").value.trim(); if (!project || !name) { renderProjectPicker(); return; } project.name = name; writeProjects(projectState.projects); renderProjectPicker(); }
function photoDatabase() { return new Promise((resolve, reject) => { const request = indexedDB.open(PHOTO_DB, 1); request.onupgradeneeded = () => request.result.createObjectStore(PHOTO_STORE); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function savePhoto(id, blob) { const db = await photoDatabase(); return new Promise((resolve, reject) => { const tx = db.transaction(PHOTO_STORE, "readwrite"); tx.objectStore(PHOTO_STORE).put(blob, id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
async function getPhoto(id) { const db = await photoDatabase(); return new Promise((resolve, reject) => { const request = db.transaction(PHOTO_STORE).objectStore(PHOTO_STORE).get(id); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function deletePhoto(id) { const db = await photoDatabase(); return new Promise((resolve, reject) => { const tx = db.transaction(PHOTO_STORE, "readwrite"); tx.objectStore(PHOTO_STORE).delete(id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
function projectFileName(name) { return (name || "notatkart-prosjekt").replace(/[^a-z0-9æøå_-]+/gi, "-").replace(/^-|-$/g, "") || "notatkart-prosjekt"; }
async function exportProject() { try { saveData(); const project = projectState.projects.find((item) => item.id === activeProjectId); const data = JSON.parse(localStorage.getItem(projectDataKey(activeProjectId))); const photoIds = new Set([...notesSource.getFeatures(), ...importSource.getFeatures()].map((feature) => feature.get("photoId") || feature.get("rasterId")).filter(Boolean)); const zip = new JSZip(); zip.file("project.json", JSON.stringify({ version: 1, project: { name: project?.name || "Prosjekt" }, data }, null, 2)); await Promise.all([...photoIds].map(async (id) => { const blob = await getPhoto(id); if (blob) zip.file(`media/${id}`, blob); })); download(await zip.generateAsync({ type: "blob" }), `${projectFileName(project?.name)}.notatkart`); toast("Prosjektpakken er lastet ned."); } catch (error) { console.error(error); toast("Kunne ikke eksportere prosjektet."); } }
async function importProject(file) { try { const zip = await JSZip.loadAsync(file); const manifestFile = zip.file("project.json"); if (!manifestFile) throw new Error("Dette er ikke en Notatkart-prosjektpakke."); const manifest = JSON.parse(await manifestFile.async("string")); if (!manifest?.data) throw new Error("Prosjektpakken mangler prosjektdata."); const project = createProject(`${manifest.project?.name || "Importert prosjekt"} (importert)`); projectState.projects.push(project); writeProjects(projectState.projects); localStorage.setItem(projectDataKey(project.id), JSON.stringify(manifest.data)); const media = Object.keys(zip.files).filter((name) => name.startsWith("media/") && !zip.files[name].dir); await Promise.all(media.map(async (name) => savePhoto(name.slice(6), await zip.file(name).async("blob")))); switchProject(project.id); toast("Prosjektet er importert."); } catch (error) { console.error(error); toast(error.message || "Kunne ikke importere prosjektet."); } }
function rasterImage(blob) { return new Promise((resolve, reject) => { const url = URL.createObjectURL(blob); const image = new Image(); image.onload = () => { URL.revokeObjectURL(url); resolve(image); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Kunne ikke lese JPEG-bildet")); }; image.src = url; }); }
async function restoreRasterImages() { const rasters = importSource.getFeatures().filter((feature) => feature.get("importType") === "raster" && feature.get("rasterId")); await Promise.all(rasters.map(async (feature) => { try { const blob = await getPhoto(feature.get("rasterId")); if (blob) feature.set("image", await rasterImage(blob)); } catch { /* Kartpakken vises som ramme dersom den lokale bildefilen mangler. */ } })); importSource.changed(); }
function projectionFromPrj(prjText) { const zone = prjText.match(/UTM[_ ]Zone[_ ](\d{1,2})N/i)?.[1]; if (!zone) throw new Error("Finner ikke UTM-sone i PRJ-filen."); const epsg = /WGS[_ ]?1984|WGS 84/i.test(prjText) ? `EPSG:326${zone.padStart(2, "0")}` : `EPSG:258${zone.padStart(2, "0")}`; if (!ol.proj.get(epsg)) { const definition = epsg.startsWith("EPSG:326") ? `+proj=utm +zone=${Number(zone)} +datum=WGS84 +units=m +no_defs` : `+proj=utm +zone=${Number(zone)} +ellps=GRS80 +units=m +no_defs`; proj4.defs(epsg, definition); ol.proj.proj4.register(proj4); } return epsg; }
function ensureUtmProjection(epsg) { if (ol.proj.get(epsg)) return epsg; const match = /^EPSG:(258|326)(\d{2})$/.exec(epsg); if (!match) throw new Error(`Koordinatsystemet ${epsg} støttes ikke.`); const zone = Number(match[2]); const definition = match[1] === "258" ? `+proj=utm +zone=${zone} +ellps=GRS80 +units=m +no_defs` : `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`; proj4.defs(epsg, definition); ol.proj.proj4.register(proj4); return epsg; }
function utm32Projection() { return ensureUtmProjection("EPSG:25832"); }
function selectedImportProjection() { return ensureUtmProjection($("import-projection").value); }
function importedFeature(geometry, file, importType, title = "") { return new ol.Feature({ geometry, id: uid(), sourceName: file.name, imported: true, importType, title: title || file.name, body: importType === "landxml" ? "Importert fra LandXML (ETRS89 / UTM 32)." : "Importert fra DXF (ETRS89 / UTM 32)." }); }
function transformImportCoordinate(coordinate, dataProjection = selectedImportProjection()) { return ol.proj.transform(coordinate, dataProjection, projection); }
function dxfPairs(text) { const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/); const pairs = []; for (let i = 0; i + 1 < rows.length; i += 2) pairs.push([Number(rows[i].trim()), rows[i + 1].trim()]); return pairs; }
function dxfNumber(properties, code) { const value = properties.find(([group]) => group === code)?.[1]; return value === undefined ? undefined : Number(value); }
function dxfPoints(properties) { const points = []; let x; properties.forEach(([group, value]) => { if (group === 10) x = Number(value); if (group === 20 && Number.isFinite(x)) { points.push(transformImportCoordinate([x, Number(value)])); x = undefined; } }); return points; }
async function importDxfFile(file) {
  const pairs = dxfPairs(await file.text()); let inEntities = false; let total = 0;
  const add = (geometry, title) => { if (!geometry) return; importSource.addFeature(importedFeature(geometry, file, "dxf", title)); total += 1; };
  for (let i = 0; i < pairs.length;) {
    const [group, value] = pairs[i];
    if (group === 0 && value === "SECTION" && pairs[i + 1]?.[0] === 2) { inEntities = pairs[i + 1][1] === "ENTITIES"; i += 2; continue; }
    if (group === 0 && value === "ENDSEC") { inEntities = false; i += 1; continue; }
    if (!inEntities || group !== 0) { i += 1; continue; }
    const entity = value; let next = i + 1; while (next < pairs.length && pairs[next][0] !== 0) next += 1;
    const properties = pairs.slice(i + 1, next); const layer = properties.find(([code]) => code === 8)?.[1] || entity;
    if (entity === "POINT") { const x = dxfNumber(properties, 10), y = dxfNumber(properties, 20); if (Number.isFinite(x) && Number.isFinite(y)) add(new ol.geom.Point(transformImportCoordinate([x, y])), layer); }
    if (entity === "LINE") { const x1 = dxfNumber(properties, 10), y1 = dxfNumber(properties, 20), x2 = dxfNumber(properties, 11), y2 = dxfNumber(properties, 21); if ([x1, y1, x2, y2].every(Number.isFinite)) add(new ol.geom.LineString([transformImportCoordinate([x1, y1]), transformImportCoordinate([x2, y2])]), layer); }
    if (entity === "LWPOLYLINE") { const points = dxfPoints(properties); const flags = dxfNumber(properties, 70) || 0; if (points.length > 1) add((flags & 1) ? new ol.geom.Polygon([[...points, points[0]]]) : new ol.geom.LineString(points), layer); }
    if (entity === "POLYLINE") { const flags = dxfNumber(properties, 70) || 0; const points = []; let cursor = next; while (pairs[cursor]?.[0] === 0 && pairs[cursor]?.[1] === "VERTEX") { let vertexEnd = cursor + 1; while (vertexEnd < pairs.length && pairs[vertexEnd][0] !== 0) vertexEnd += 1; const vertex = pairs.slice(cursor + 1, vertexEnd); const x = dxfNumber(vertex, 10), y = dxfNumber(vertex, 20); if (Number.isFinite(x) && Number.isFinite(y)) points.push(transformImportCoordinate([x, y])); cursor = vertexEnd; } if (points.length > 1) add((flags & 1) ? new ol.geom.Polygon([[...points, points[0]]]) : new ol.geom.LineString(points), layer); i = cursor; continue; }
    if (entity === "CIRCLE") { const x = dxfNumber(properties, 10), y = dxfNumber(properties, 20), radius = dxfNumber(properties, 40); if ([x, y, radius].every(Number.isFinite)) { const center = transformImportCoordinate([x, y]); const east = transformImportCoordinate([x + radius, y]); add(new ol.geom.Circle(center, Math.hypot(east[0] - center[0], east[1] - center[1])), layer); } }
    i = next;
  }
  if (!total) throw new Error("Fant ingen støttede objekter i DXF-filen."); return total;
}
async function importLandXmlFile(file) {
  const documentXml = new DOMParser().parseFromString(await file.text(), "application/xml"); if (documentXml.querySelector("parsererror")) throw new Error("LandXML-filen kunne ikke leses.");
  let total = 0; const add = (geometry, title) => { importSource.addFeature(importedFeature(geometry, file, "landxml", title)); total += 1; };
  documentXml.querySelectorAll("Alignment").forEach((alignment) => { const coordinates = []; alignment.querySelectorAll("CoordGeom > *").forEach((element) => { const start = element.querySelector("Start")?.textContent; const end = element.querySelector("End")?.textContent; [start, end].filter(Boolean).forEach((text) => { const values = text.trim().split(/\s+/).map(Number); if (values.length >= 2 && values.every(Number.isFinite)) { const point = transformImportCoordinate([values[1], values[0]]); if (!coordinates.length || coordinates.at(-1)[0] !== point[0] || coordinates.at(-1)[1] !== point[1]) coordinates.push(point); } }); }); if (coordinates.length > 1) add(new ol.geom.LineString(coordinates), alignment.getAttribute("name") || "Veglinje"); });
  documentXml.querySelectorAll("PntList2D").forEach((list, index) => { const values = list.textContent.trim().split(/\s+/).map(Number); const coordinates = []; for (let i = 0; i + 1 < values.length; i += 2) if (Number.isFinite(values[i]) && Number.isFinite(values[i + 1])) coordinates.push(transformImportCoordinate([values[i + 1], values[i]])); if (coordinates.length > 1) add(new ol.geom.LineString(coordinates), `LandXML-linje ${index + 1}`); });
  documentXml.querySelectorAll("CgPoint").forEach((point, index) => { const values = point.textContent.trim().split(/\s+/).map(Number); if (values.length >= 2 && values.every(Number.isFinite)) add(new ol.geom.Point(transformImportCoordinate([values[1], values[0]])), point.getAttribute("name") || `Punkt ${index + 1}`); });
  if (!total) throw new Error("Fant ingen linjer eller punkter som kunne importeres fra LandXML-filen."); return total;
}
function canvasBlob(canvas, type = "image/jpeg") { return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Kunne ikke lage kartbilde.")), type, .9)); }
async function importRasterCanvas(file, canvas, coordinates, formatName) { const blob = await canvasBlob(canvas); const rasterId = uid(); await savePhoto(rasterId, blob); const feature = new ol.Feature({ geometry: new ol.geom.Polygon([[...coordinates, coordinates[0]]]), id: uid(), importType: "raster", rasterId, sourceName: file.name, title: file.name, body: `Georeferert ${formatName}` }); feature.set("image", await rasterImage(blob), true); importSource.addFeature(feature); return 1; }
function projectionFromGeoTiffKeys(keys) { const code = Number(keys?.ProjectedCSTypeGeoKey || keys?.GeographicTypeGeoKey); if (Number.isInteger(code) && code > 0 && code !== 32767) { const epsg = `EPSG:${code}`; if (/^EPSG:(258|326)\d{2}$/.test(epsg)) return ensureUtmProjection(epsg); if (epsg === "EPSG:4326") return epsg; } return selectedImportProjection(); }
async function importGeoTiffFile(file) {
  if (!GeoTIFF?.fromArrayBuffer) throw new Error("GeoTIFF-støtten er ikke lastet. Prøv igjen med internettforbindelse.");
  const tiff = await GeoTIFF.fromArrayBuffer(await file.arrayBuffer()); const image = await tiff.getImage(); const [minX, minY, maxX, maxY] = image.getBoundingBox(); const dataProjection = projectionFromGeoTiffKeys(await image.getGeoKeys());
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) throw new Error("GeoTIFF-filen mangler gyldig georeferering. Velg en georeferert TIFF.");
  const sourceWidth = image.getWidth(), sourceHeight = image.getHeight(), scale = Math.min(1, 2048 / Math.max(sourceWidth, sourceHeight)); const width = Math.max(1, Math.round(sourceWidth * scale)), height = Math.max(1, Math.round(sourceHeight * scale)); const rgb = await image.readRGB({ width, height }); const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const context = canvas.getContext("2d"); const pixels = context.createImageData(width, height); for (let index = 0; index < width * height; index += 1) { pixels.data[index * 4] = rgb[index * 3]; pixels.data[index * 4 + 1] = rgb[index * 3 + 1]; pixels.data[index * 4 + 2] = rgb[index * 3 + 2]; pixels.data[index * 4 + 3] = 255; } context.putImageData(pixels, 0, 0);
  const coordinates = [[minX, maxY], [maxX, maxY], [maxX, minY], [minX, minY]].map((coordinate) => transformImportCoordinate(coordinate, dataProjection)); return importRasterCanvas(file, canvas, coordinates, "GeoTIFF");
}
function geoPdfCoordinates(arrayBuffer) { const raw = new TextDecoder("latin1").decode(arrayBuffer); const match = /\/GPTS\s*\[([^\]]+)\]/s.exec(raw); if (!match) throw new Error("Fant ikke standard GeoPDF-koordinater. Eksporter som GeoTIFF eller legg ved JGW/PRJ."); const values = match[1].match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?/g)?.map(Number) || []; if (values.length < 8) throw new Error("GeoPDF-koordinatene er ufullstendige."); const coordinates = []; for (let index = 0; index + 1 < values.length && coordinates.length < 4; index += 2) coordinates.push(ol.proj.fromLonLat([values[index + 1], values[index]])); if (coordinates.length !== 4) throw new Error("GeoPDF-en må inneholde fire hjørnekoordinater."); return coordinates; }
async function importGeoPdfFile(file) {
  if (!pdfjsLib?.getDocument) throw new Error("GeoPDF-støtten er ikke lastet. Prøv igjen med internettforbindelse."); const arrayBuffer = await file.arrayBuffer(); const coordinates = geoPdfCoordinates(arrayBuffer); pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise; const page = await pdf.getPage(1); const initialViewport = page.getViewport({ scale: 1 }); const scale = Math.min(2, 2048 / Math.max(initialViewport.width, initialViewport.height)); const viewport = page.getViewport({ scale }); const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height); await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise; return importRasterCanvas(file, canvas, coordinates, "GeoPDF (første side)");
}
function worldCorners(values, width, height, dataProjection) { const [a, d, b, e, c, f] = values; const coordinate = (column, row) => ol.proj.transform([a * column + b * row + c, d * column + e * row + f], dataProjection, projection); return [coordinate(-0.5, -0.5), coordinate(width - 0.5, -0.5), coordinate(width - 0.5, height - 0.5), coordinate(-0.5, height - 0.5), coordinate(-0.5, -0.5)]; }
function deactivateTool() { if (drawInteraction) { map.removeInteraction(drawInteraction); drawInteraction = null; } if (modifyInteraction) { map.removeInteraction(modifyInteraction); modifyInteraction = null; } toolMode = null; document.querySelectorAll("[data-draw]").forEach((button) => button.classList.remove("active")); $("map").style.cursor = ""; }
function activateDraw(kind) { const color = kind === "Polygon" ? "#dc6f45" : $("draw-color").value; hideQuickMenu(); deactivateTool(); toolMode = "draw"; document.querySelector(`[data-draw="${kind}"]`).classList.add("active"); drawInteraction = new ol.interaction.Draw({ source: drawingSource, type: kind === "freehand" ? "LineString" : kind, freehand: kind === "freehand", style: new ol.style.Style({ stroke: new ol.style.Stroke({ color, width: 4 }) }) }); drawInteraction.on("drawend", (event) => { event.feature.setProperties({ id: uid(), noteType: "sketch", sketchKind: kind, styleColor: color, title: "Skisse", body: "", createdAt: new Date().toISOString() }); saveData(); deactivateTool(); hideQuickMenu(); toast("Skissen er lagret. Tekst kan legges til senere."); }); map.addInteraction(drawInteraction); toast(kind === "Polygon" ? "Tegn område og dobbelttrykk for å avslutte." : "Tegn i kartet. Dobbelttrykk for å avslutte."); }
function selectPlacement(kind) { hideQuickMenu(); deactivateTool(); toolMode = kind; $("map").style.cursor = "crosshair"; const messages = { text: "Trykk i kartet der tekstboksen skal plasseres.", photo: "Trykk i kartet der bildet hører til.", symbol: `Trykk i kartet der ${symbolNames[pendingSymbol?.type]?.toLowerCase() || "symbolet"} skal plasseres.` }; toast(messages[kind]); }
async function addPhoto(coordinate) { const id = uid(); try { await savePhoto(id, pendingPhoto); notesSource.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coordinate), id: uid(), noteType: "photo", photoId: id, title: pendingPhoto.name || "Bilde", createdAt: new Date().toISOString() })); pendingPhoto = null; $("photo-name").textContent = "Ingen bilde valgt."; $("place-photo").disabled = true; saveData(); toast("Bildet er lagret på kartpunktet."); } catch { toast("Bildet kunne ikke lagres lokalt."); } }
function addText(coordinate) { const body = $("note-text").value.trim(); const title = $("note-title").value.trim(); if (!body && !title) { toast("Skriv litt tekst før du plasserer notatet."); return; } notesSource.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coordinate), id: uid(), noteType: "text", title: title || "Notat", body, createdAt: new Date().toISOString() })); $("note-title").value = ""; $("note-text").value = ""; saveData(); toast("Tekstboksen er lagret på kartpunktet."); }
function addSymbol(coordinate) { if (!pendingSymbol) return; const name = symbolNames[pendingSymbol.type]; const text = $("symbol-text").value.trim(); notesSource.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coordinate), id: uid(), noteType: "symbol", symbolType: pendingSymbol.type, symbolText: text, rotation: 0, title: name, body: text || "Kartfestet symbol", createdAt: new Date().toISOString() })); saveData(); toast(`${name} er lagret på kartpunktet.`); pendingSymbol = null; $("symbol-type").value = ""; $("symbol-text").value = ""; }
function identifyTitle(properties, fallback) { return properties.navn || properties.Navn || properties.name || properties.Name || properties.art || properties.Artsnavn || properties.scientificName || properties.VitenskapeligNavn || properties.kulturminneBetegnelse || fallback; }
function identifyText(properties) { const labels = { navn: "Navn", art: "Art", Artsnavn: "Art", scientificName: "Vitenskapelig navn", VitenskapeligNavn: "Vitenskapelig navn", norskNavn: "Norsk navn", kulturminneBetegnelse: "Betegnelse", kulturminneKategori: "Kategori", vernetype: "Vernestatus", vernelov: "Vernelov", funndato: "Funndato", dato: "Dato", rødlistekategori: "Rødlistekategori", redlistCategory: "Rødlistekategori", presisjon: "Presisjon" }; return Object.entries(properties).filter(([key, value]) => value !== null && value !== undefined && value !== "" && !/^(geometry|shape|objectid|globalid|id)$/i.test(key)).slice(0, 9).map(([key, value]) => `${labels[key] || key}: ${String(value)}`).join("\n"); }
function identifyProperties(text) { try { const data = JSON.parse(text); const feature = data.features?.[0] || (data.properties ? data : null); if (feature?.properties) return feature.properties; } catch { /* Some WMS services only provide HTML feature information. */ } const document = new DOMParser().parseFromString(text, "text/html"); const rows = [...document.querySelectorAll("tr")]; const properties = {}; rows.forEach((row) => { const cells = [...row.querySelectorAll("th,td")].map((cell) => cell.textContent.trim()); if (cells.length >= 2 && cells[0] && cells[1]) properties[cells[0]] = cells.slice(1).join(" "); }); return Object.keys(properties).length ? properties : null; }
async function identifyLayer(layer, label, coordinate) { const source = layer.getSource(); for (const infoFormat of ["application/json", "text/html"]) { const url = source.getFeatureInfoUrl(coordinate, map.getView().getResolution(), map.getView().getProjection(), { INFO_FORMAT: infoFormat, FEATURE_COUNT: 1 }); if (!url) continue; try { const response = await fetch(url); if (!response.ok) continue; const properties = identifyProperties(await response.text()); if (properties) return { label, properties }; } catch { /* Try the other format or the next visible WMS layer. */ } } return null; }
async function identifyExternalFeature(coordinate) { const candidates = [{ layer: kulturminnerLayer, label: "KULTURMINNE · RIKSANTIKVAREN" }, { layer: artskartLayer, label: "ARTSKART · ARTSDATA" }, { layer: nokkelbiotoperLayer, label: "NØKKELBIOTOP · NIBIO" }]; let attempted = false; for (const candidate of candidates) { if (!candidate.layer.getVisible()) continue; attempted = true; const result = await identifyLayer(candidate.layer, candidate.label, coordinate); if (!result) continue; selectedFeature = null; $("detail-type").textContent = result.label; $("detail-title").textContent = identifyTitle(result.properties, "Kartobjekt"); $("detail-body").textContent = identifyText(result.properties) || "Ingen tilgjengelig objektinformasjon."; $("detail-photo").hidden = true; $("detail-photo").src = ""; $("symbol-editor").hidden = true; $("text-editor").hidden = true; $("edit-geometry").hidden = true; $("delete-object").hidden = true; const href = result.properties.link || result.properties.url || result.properties.URL; const detailLink = $("detail-link"); detailLink.hidden = !href; if (href) detailLink.href = href; $("detail-card").hidden = false; return; } hideDetail(); if (attempted) toast("Fant ingen objektinformasjon på dette punktet."); }
map.on("singleclick", async (event) => { if (Date.now() < ignoreSingleClickUntil) return; if (toolMode === "text") { addText(event.coordinate); deactivateTool(); return; } if (toolMode === "photo") { await addPhoto(event.coordinate); deactivateTool(); return; } if (toolMode === "symbol") { addSymbol(event.coordinate); deactivateTool(); return; } let found; map.forEachFeatureAtPixel(event.pixel, (feature, layer) => { if (layer === notesLayer || layer === drawingLayer) { found = feature; return true; } }, { hitTolerance: 14 }); if (found) showDetail(found); else await identifyExternalFeature(event.coordinate); });
function hideQuickMenu() { $("quick-menu").hidden = true; }
function openQuickMenu(coordinate, pixel) { quickCoordinate = coordinate; const menu = $("quick-menu"); menu.style.left = `${Math.max(8, Math.min(pixel[0] - 100, map.getSize()[0] - 228))}px`; menu.style.top = `${Math.max(62, Math.min(pixel[1] - 42, map.getSize()[1] - 110))}px`; menu.hidden = false; }
function addQuickNote() {
  if (!quickCoordinate) return;
  const feature = new ol.Feature({ geometry: new ol.geom.Point(quickCoordinate), id: uid(), noteType: "text", title: "Notat", body: "", createdAt: new Date().toISOString() });
  notesSource.addFeature(feature); saveData(); hideQuickMenu(); showDetail(feature);
  requestAnimationFrame(() => { const field = $("edit-note-title"); field.focus(); field.select(); });
}
document.querySelectorAll("[data-quick]").forEach((button) => button.addEventListener("click", () => {
  if (!quickCoordinate) return;
  const kind = button.dataset.quick;
  if (kind === "note") { addQuickNote(); return; }
  if (kind === "photo") { quickPhotoCoordinate = quickCoordinate; hideQuickMenu(); $("photo-input").click(); return; }
  pendingSymbol = { type: kind };
  $("symbol-text").value = "";
  addSymbol(quickCoordinate);
  hideQuickMenu();
}));
map.getViewport().addEventListener("pointerdown", (event) => { if (toolMode) return; const pixel = map.getEventPixel(event); longPressTimer = setTimeout(() => { ignoreSingleClickUntil = Date.now() + 700; openQuickMenu(map.getCoordinateFromPixel(pixel), pixel); }, 620); });
["pointerup", "pointermove", "pointercancel"].forEach((type) => map.getViewport().addEventListener(type, () => clearTimeout(longPressTimer)));
map.getViewport().addEventListener("contextmenu", (event) => event.preventDefault());
function hideDetail() { selectedFeature = null; $("detail-card").hidden = true; $("detail-photo").src = ""; $("detail-link").hidden = true; $("symbol-editor").hidden = true; $("text-editor").hidden = true; }
async function showDetail(feature) { selectedFeature = feature; const type = feature.get("noteType"); $("detail-type").textContent = type === "photo" ? "KARTFESTET BILDE" : type === "text" ? "KARTFESTET NOTAT" : type === "symbol" ? "KARTFESTET SYMBOL" : type === "sketch" ? "SKISSE" : "IMPORTERT SHAPE"; $("detail-title").textContent = type === "symbol" ? symbolNames[feature.get("symbolType")] : feature.get("title") || (type === "sketch" ? "Skisse" : feature.get("sourceName") || "Kartobjekt"); $("detail-body").textContent = type === "symbol" ? (symbolText(feature) || "Kartfestet symbol") : feature.get("body") || (type === "sketch" ? "Tegnet i Notatkart." : "Importert shapefil."); $("symbol-editor").hidden = type !== "symbol"; $("text-editor").hidden = type !== "text"; if (type === "symbol") { $("edit-symbol-type").value = feature.get("symbolType") || "culvert"; $("edit-symbol-text").value = feature.get("symbolText") || symbolText(feature); } if (type === "text") { $("edit-note-title").value = feature.get("title") || ""; $("edit-note-text").value = feature.get("body") || ""; } const image = $("detail-photo"); image.hidden = true; image.src = ""; if (type === "photo") { const blob = await getPhoto(feature.get("photoId")); if (blob) { image.src = URL.createObjectURL(blob); image.hidden = false; } else $("detail-body").textContent = "Bildefilen finnes ikke lenger lokalt på denne enheten."; } $("detail-card").hidden = false; }
$("delete-object").addEventListener("click", async () => { if (!selectedFeature) return; if (!confirm("Slette dette objektet fra Notatkart?")) return; const photoId = selectedFeature.get("photoId"); [notesSource, drawingSource].forEach((source) => source.removeFeature(selectedFeature)); if (photoId) await deletePhoto(photoId); saveData(); hideDetail(); toast("Objektet er slettet."); });
$("close-detail").addEventListener("click", hideDetail);
document.querySelectorAll("[data-draw]").forEach((button) => button.addEventListener("click", () => activateDraw(button.dataset.draw)));
$("cancel-tool").addEventListener("click", () => { deactivateTool(); hideQuickMenu(); toast("Aktivt verktøy er avsluttet."); });
$("place-text").addEventListener("click", activateTextBubble);
$("symbol-toggle").addEventListener("click", () => { const open = $("symbol-content").hidden; $("symbol-content").hidden = !open; $("symbol-toggle").setAttribute("aria-expanded", String(open)); });
function toggleToolContent(toggleId, contentId) { $(toggleId).addEventListener("click", () => { const open = $(contentId).hidden; $(contentId).hidden = !open; $(toggleId).setAttribute("aria-expanded", String(open)); }); }
toggleToolContent("text-toggle", "text-content");
toggleToolContent("position-toggle", "position-content");
toggleToolContent("track-toggle", "track-content");
toggleToolContent("photo-toggle", "photo-content");
$("symbol-type").addEventListener("change", (event) => { if (!event.target.value) return; pendingSymbol = { type: event.target.value }; selectPlacement("symbol"); });
$("save-symbol").addEventListener("click", () => { if (!selectedFeature || selectedFeature.get("noteType") !== "symbol") return; const symbolType = $("edit-symbol-type").value; const text = $("edit-symbol-text").value.trim(); const rotation = symbolType === "culvert" ? Number($("edit-symbol-rotation").value) * Math.PI / 180 : 0; selectedFeature.setProperties({ symbolType, symbolText: text, rotation, title: symbolNames[symbolType], body: text || "Kartfestet symbol" }); saveData(); notesSource.changed(); hideDetail(); toast("Symbolinformasjonen er oppdatert."); });
$("edit-symbol-rotation").addEventListener("input", (event) => { $("edit-symbol-rotation-value").textContent = `${event.target.value}°`; });
$("edit-symbol-type").addEventListener("change", (event) => { $("culvert-rotation").hidden = event.target.value !== "culvert"; });
$("save-sketch-style").addEventListener("click", () => { if (!selectedFeature || selectedFeature.get("noteType") !== "sketch" || selectedFeature.getGeometry().getType() !== "LineString") return; selectedFeature.set("styleColor", $("edit-sketch-color").value); saveData(); drawingSource.changed(); hideDetail(); toast("Linjefargen er oppdatert."); });
$("save-text-note").addEventListener("click", () => { const type = selectedFeature?.get("noteType"); if (type !== "text" && type !== "sketch") return; const title = $("edit-note-title").value.trim(); const body = $("edit-note-text").value.trim(); if (type === "text" && !title && !body) { toast("Tekstnotatet kan ikke være tomt."); return; } selectedFeature.setProperties({ title: title || (type === "sketch" ? "Skisse" : "Notat"), body }); if (type === "text" && selectedFeature.get("bubble")) fitBubbleToText(selectedFeature); saveData(); notesSource.changed(); drawingSource.changed(); hideDetail(); toast("Teksten er oppdatert."); });
$("photo-input").addEventListener("change", async (event) => { pendingPhoto = event.target.files?.[0] || null; $("photo-name").textContent = pendingPhoto ? pendingPhoto.name : "Ingen bilde valgt."; $("place-photo").disabled = !pendingPhoto; if (pendingPhoto && quickPhotoCoordinate) { const coordinate = quickPhotoCoordinate; quickPhotoCoordinate = null; await addPhoto(coordinate); } });
$("place-photo").addEventListener("click", () => { if (pendingPhoto) selectPlacement("photo"); });
$("base-toggle").addEventListener("change", (event) => { baseLayer.setVisible(event.target.checked); });
$("losmasser-toggle").addEventListener("change", (event) => { losmasserLayer.setVisible(event.target.checked); });
$("marin-leire-toggle").addEventListener("change", (event) => { marinLeireLayer.setVisible(event.target.checked); });
$("skogbruksplan-toggle").addEventListener("change", (event) => { skogbruksplanLayer.setVisible(event.target.checked); });
$("nokkelbiotoper-toggle").addEventListener("change", (event) => { nokkelbiotoperLayer.setVisible(event.target.checked); });
$("kulturminner-toggle").addEventListener("change", (event) => { kulturminnerLayer.setVisible(event.target.checked); });
$("artskart-toggle").addEventListener("change", (event) => { artskartLayer.setVisible(event.target.checked); });
$("import-toggle").addEventListener("change", (event) => { importLayer.setVisible(event.target.checked); });
$("notes-toggle").addEventListener("change", (event) => { drawingLayer.setVisible(event.target.checked); notesLayer.setVisible(event.target.checked); });
function toggleSubmenu(buttonId, menuId) { $(buttonId).addEventListener("click", () => { const open = $(menuId).hidden; $(menuId).hidden = !open; $(buttonId).setAttribute("aria-expanded", String(open)); }); }
toggleSubmenu("import-expand", "import-list");
toggleSubmenu("notes-expand", "notes-list");
async function importShapeFile(file) { const parsed = await shp(await file.arrayBuffer()); const collections = parsed.type === "FeatureCollection" ? [parsed] : Object.values(parsed); let total = 0; collections.forEach((collection) => { const features = format.readFeatures(collection, { dataProjection: "EPSG:4326", featureProjection: projection }); features.forEach((feature) => feature.setProperties({ id: uid(), sourceName: file.name, imported: true, importType: "shape" })); importSource.addFeatures(features); total += features.length; }); return total; }
async function importAvenzaFile(file, zip, names) { const jgwName = names.find((name) => /\.(jgw|jpgw)$/i.test(name)); const jpegName = names.find((name) => /\.(jpg|jpeg)$/i.test(name)); const prjName = names.find((name) => /\.prj$/i.test(name)); if (!jgwName || !jpegName || !prjName) throw new Error("Kartpakken mangler JPEG, JGW eller PRJ."); const values = (await zip.file(jgwName).async("string")).trim().split(/\s+/).map(Number); if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) throw new Error("JGW-filen har ugyldige koordinater."); const dataProjection = projectionFromPrj(await zip.file(prjName).async("string")); const blob = await zip.file(jpegName).async("blob"); const image = await rasterImage(blob); const rasterId = uid(); await savePhoto(rasterId, blob); const feature = new ol.Feature({ geometry: new ol.geom.Polygon([worldCorners(values, image.width, image.height, dataProjection)]), id: uid(), importType: "raster", rasterId, sourceName: file.name, title: file.name, body: "Georeferert JPEG-kartpakke" }); feature.set("image", image, true); importSource.addFeature(feature); return 1; }
async function importZipFile(file) { const zip = await JSZip.loadAsync(file); const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir); if (names.some((name) => /\.shp$/i.test(name))) return importShapeFile(file); if (names.some((name) => /\.(jgw|jpgw)$/i.test(name)) && names.some((name) => /\.(jpg|jpeg)$/i.test(name))) return importAvenzaFile(file, zip, names); throw new Error("Fant verken shapefil eller JPEG/JGW-kartpakke i ZIP-filen."); }
async function importFile(file) { const name = file.name.toLowerCase(); if (name.endsWith(".dxf")) return importDxfFile(file); if (name.endsWith(".xml")) return importLandXmlFile(file); if (name.endsWith(".tif") || name.endsWith(".tiff")) return importGeoTiffFile(file); if (name.endsWith(".pdf")) return importGeoPdfFile(file); if (name.endsWith(".zip")) return importZipFile(file); throw new Error("Filtypen støttes ikke. Velg DXF, LandXML, GeoTIFF, GeoPDF eller ZIP."); }
$("shape-input").addEventListener("change", async (event) => { const files = [...(event.target.files || [])]; if (!files.length) return; let imported = 0; try { toast(`Leser ${files.length} kartfil${files.length === 1 ? "" : "er"} …`); for (const file of files) imported += await importFile(file); saveData(); if (imported) { map.getView().fit(importSource.getExtent(), { padding: [70, 280, 70, 280], maxZoom: 16, duration: 500 }); toast(`${imported} objekt fra ${files.length} kartfil${files.length === 1 ? "" : "er"} er importert og lagret.`); } } catch (error) { console.error(error); toast(error.message || "Kunne ikke importere én av filene."); } finally { event.target.value = ""; } });
function currentPosition() { if (!navigator.geolocation) { toast("Denne nettleseren støtter ikke posisjon."); return; } $("locate-button").textContent = "Finner posisjon …"; navigator.geolocation.getCurrentPosition((position) => { const coordinate = ol.proj.fromLonLat([position.coords.longitude, position.coords.latitude]); positionSource.clear(); positionSource.addFeature(new ol.Feature(new ol.geom.Point(coordinate))); map.getView().animate({ center: coordinate, zoom: Math.max(map.getView().getZoom(), 16), duration: 600 }); $("locate-button").textContent = "Min posisjon"; if (positionWatch) navigator.geolocation.clearWatch(positionWatch); positionWatch = navigator.geolocation.watchPosition((update) => { positionSource.getFeatures()[0]?.getGeometry().setCoordinates(ol.proj.fromLonLat([update.coords.longitude, update.coords.latitude])); }, () => {}, { enableHighAccuracy: true, maximumAge: 10000 }); toast("Posisjonen vises med blå prikk."); }, () => { $("locate-button").textContent = "Min posisjon"; toast("Fikk ikke posisjon. Kontroller at du har gitt tillatelse."); }, { enableHighAccuracy: true, timeout: 15000 }); }
$("locate-button").addEventListener("click", currentPosition);
function download(blob, filename) { const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
function exportJpeg() { toast("Lager JPEG i UTM 32 av gjeldende kartutsnitt …"); map.once("rendercomplete", () => { try { const size = map.getSize(); const result = document.createElement("canvas"); result.width = size[0]; result.height = size[1]; const context = result.getContext("2d"); Array.from(map.getViewport().querySelectorAll("canvas")).forEach((canvas) => { if (!canvas.width || !canvas.height) return; const opacity = canvas.parentNode.style.opacity || canvas.style.opacity || 1; context.globalAlpha = Number(opacity); const matrix = (canvas.style.transform || "").match(/^matrix\(([^)]+)\)$/); if (matrix) context.setTransform(...matrix[1].split(",").map(Number)); else context.setTransform(1, 0, 0, 1, 0, 0); context.drawImage(canvas, 0, 0); }); context.setTransform(1, 0, 0, 1, 0, 0); result.toBlob((blob) => { if (!blob) throw new Error("Kunne ikke lage bilde"); const stamp = new Date().toISOString().slice(0, 10); download(blob, `notatkart-${stamp}.jpg`); const extent = map.getView().calculateExtent(size); const utm32 = utm32Projection(); const topLeft = ol.proj.transform([extent[0], extent[3]], projection, utm32); const topRight = ol.proj.transform([extent[2], extent[3]], projection, utm32); const bottomLeft = ol.proj.transform([extent[0], extent[1]], projection, utm32); const pixelWidth = Math.max(1, size[0] - 1); const pixelHeight = Math.max(1, size[1] - 1); const a = (topRight[0] - topLeft[0]) / pixelWidth; const d = (topRight[1] - topLeft[1]) / pixelWidth; const b = (bottomLeft[0] - topLeft[0]) / pixelHeight; const e = (bottomLeft[1] - topLeft[1]) / pixelHeight; const c = topLeft[0] + (a + b) / 2; const f = topLeft[1] + (d + e) / 2; const worldFile = [a, d, b, e, c, f].join("\n"); download(new Blob([worldFile], { type: "text/plain" }), `notatkart-${stamp}.jgw`); download(new Blob(["Koordinatsystem: ETRS89 / UTM sone 32N (EPSG:25832)\nJPEG og JGW-filen må ligge sammen.\nVerdiene i JGW inkluderer eventuell kartrotasjon."], { type: "text/plain" }), `notatkart-${stamp}-lesmeg.txt`); toast("Georeferert JPEG, JGW og UTM 32-koordinatinfo er lastet ned."); }, "image/jpeg", .92); } catch (error) { console.error(error); toast("Kunne ikke lage JPEG. Prøv igjen når grunnkartet er lastet."); } }); map.renderSync(); }
$("export-button").addEventListener("click", exportJpeg);
$("export-project").addEventListener("click", exportProject);
$("project-input").addEventListener("change", async (event) => { const file = event.target.files?.[0]; if (file) await importProject(file); event.target.value = ""; });
renderProjectPicker();
function initialisePanels() {
  const panels = [...document.querySelectorAll(".panel")];
  const setCollapsed = (panel, collapsed) => { const button = panel.querySelector(".panel-toggle"); panel.classList.toggle("collapsed", collapsed); button.setAttribute("aria-expanded", String(!collapsed)); button.setAttribute("aria-label", `${collapsed ? "Åpne" : "Lukk"} ${panel.classList.contains("left-panel") ? "kartlag" : "verktøy"}`); setTimeout(() => map.updateSize(), 190); };
  panels.forEach((panel) => panel.querySelector(".panel-toggle").addEventListener("click", () => { const opening = panel.classList.contains("collapsed"); if (opening) panels.filter((other) => other !== panel).forEach((other) => setCollapsed(other, true)); setCollapsed(panel, !opening); }));
}
initialisePanels();
$("project-select").addEventListener("change", (event) => switchProject(event.target.value));
$("new-project").addEventListener("click", addProject);
$("project-name").addEventListener("change", renameProject);
$("project-name").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } });
loadData();
restoreRasterImages();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));

// GPS-notater og sporlogger lagres i de samme lokale kartdataene som resten av notatene.
function refreshLayerMenus() {
  const importList = $("import-list");
  const importedGroups = new Map();
  importSource.getFeatures().forEach((feature) => { const name = feature.get("sourceName") || "Importerte data"; importedGroups.set(name, (importedGroups.get(name) || 0) + 1); });
  importList.replaceChildren();
  if (importedGroups.size) importedGroups.forEach((count, name) => appendLayerRow(importList, name, count, `import:${name}`)); else importList.textContent = "Ingen importerte data ennå.";
  const notesList = $("notes-list");
  const noteGroups = new Map();
  [...drawingSource.getFeatures(), ...notesSource.getFeatures()].forEach((feature) => { const key = noteKey(feature); noteGroups.set(key, (noteGroups.get(key) || 0) + 1); });
  const groups = [
    { key: "note:sketch", label: "Skisser" }, { key: "note:text", label: "Tekstnotater" }, { key: "note:location", label: "Lagrede posisjoner" }, { key: "note:track", label: "Sporlogger" }, { key: "note:photo", label: "Bilder" },
    { key: "symbol:culvert", label: "Stikkrenner" }, { key: "symbol:landing", label: "Velteplasser" }, { key: "symbol:turning", label: "Snuplasser" }, { key: "symbol:arrow-left", label: "Gule piler mot venstre" }, { key: "symbol:arrow-right", label: "Gule piler mot høyre" }
  ];
  notesList.replaceChildren();
  groups.forEach((group) => appendLayerRow(notesList, group.label, noteGroups.get(group.key) || 0, group.key));
}

async function showDetail(feature) {
  selectedFeature = feature;
  $("detail-link").hidden = true; $("delete-object").hidden = false;
  const type = feature.get("noteType");
  $("detail-type").textContent = type === "photo" ? "KARTFESTET BILDE" : type === "location" ? "LAGRET POSISJON" : type === "text" ? "KARTFESTET NOTAT" : type === "track" ? "SPORLOGG" : type === "symbol" ? "KARTFESTET SYMBOL" : type === "sketch" ? "SKISSE" : "IMPORTERT SHAPE";
  $("detail-title").textContent = type === "symbol" ? symbolNames[feature.get("symbolType")] : feature.get("title") || (type === "track" ? "Sporlogg" : type === "sketch" ? "Skisse" : feature.get("sourceName") || "Kartobjekt");
  $("detail-body").textContent = type === "symbol" ? (symbolText(feature) || "Kartfestet symbol") : type === "track" ? `Lengde: ${Math.round(feature.get("distanceMeters") || 0)} m` : feature.get("body") || (type === "sketch" ? "Tegnet i Notatkart." : "Importert shapefil.");
  $("symbol-editor").hidden = type !== "symbol";
  $("culvert-rotation").hidden = type !== "symbol" || feature.get("symbolType") !== "culvert";
  $("text-editor").hidden = type !== "text" && type !== "location" && type !== "sketch";
  const geometryType = feature.getGeometry()?.getType();
  $("line-style-editor").hidden = type !== "sketch" || geometryType !== "LineString";
  if (type === "sketch" && geometryType === "LineString") $("edit-sketch-color").value = feature.get("styleColor") || "#dc6f45";
  $("edit-geometry").hidden = type === "symbol" ? false : type !== "sketch" || (geometryType !== "LineString" && geometryType !== "Polygon") || feature.get("sketchKind") === "freehand";
  $("edit-geometry").textContent = type === "symbol" ? "Flytt symbol" : "Rediger punkter";
  if (type === "symbol") { $("edit-symbol-type").value = feature.get("symbolType") || "culvert"; $("edit-symbol-text").value = feature.get("symbolText") || symbolText(feature); const degrees = Math.round(((feature.get("rotation") || 0) * 180 / Math.PI + 360) % 360); $("edit-symbol-rotation").value = degrees; $("edit-symbol-rotation-value").textContent = `${degrees}°`; }
  if (type === "text" || type === "location" || type === "sketch") { $("edit-note-title").value = feature.get("title") || ""; $("edit-note-text").value = feature.get("body") || ""; }
  const image = $("detail-photo"); image.hidden = true; image.src = "";
  if (type === "photo") { const blob = await getPhoto(feature.get("photoId")); if (blob) { image.src = URL.createObjectURL(blob); image.hidden = false; } else $("detail-body").textContent = "Bildefilen finnes ikke lenger lokalt på denne enheten."; }
  $("detail-card").hidden = false;
}

function updatePositionMarker(coordinate) {
  const marker = positionSource.getFeatures()[0];
  if (marker) marker.getGeometry().setCoordinates(coordinate); else positionSource.addFeature(new ol.Feature(new ol.geom.Point(coordinate)));
}

function gpsCoordinate(position) { return ol.proj.fromLonLat([position.coords.longitude, position.coords.latitude]); }
function gpsError() { toast("Fikk ikke posisjon. Kontroller at du har gitt tillatelse."); }

function saveCurrentPosition() {
  if (!navigator.geolocation) { toast("Denne nettleseren støtter ikke posisjon."); return; }
  $("save-position").disabled = true;
  $("save-position").textContent = "Finner posisjon …";
  navigator.geolocation.getCurrentPosition((position) => {
    const coordinate = gpsCoordinate(position);
    updatePositionMarker(coordinate);
    const title = $("position-title").value.trim() || "Lagret posisjon";
    const body = $("position-text").value.trim();
    notesSource.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coordinate), id: uid(), noteType: "location", title, body, accuracy: Math.round(position.coords.accuracy), createdAt: new Date().toISOString() }));
    $("position-title").value = ""; $("position-text").value = "";
    $("save-position").disabled = false; $("save-position").textContent = "Lagre min posisjon";
    saveData(); toast("Posisjon og notat er lagret lokalt.");
  }, () => { $("save-position").disabled = false; $("save-position").textContent = "Lagre min posisjon"; gpsError(); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
}

function trackLength() { return trackCoordinates.length > 1 ? ol.sphere.getLength(new ol.geom.LineString(trackCoordinates), { projection }) : 0; }
function updateTrackStatus() { $("track-status").textContent = trackWatch ? `Sporer: ${(trackLength() / 1000).toFixed(2)} km av 10 km.` : "Ingen aktiv sporlogg."; }
function stopTrack(reachedLimit = false) {
  if (trackWatch) navigator.geolocation.clearWatch(trackWatch);
  trackWatch = undefined;
  $("start-track").disabled = false; $("stop-track").disabled = true;
  const distanceMeters = trackLength();
  if (trackFeature && trackCoordinates.length > 1) { trackFeature.setProperties({ id: uid(), noteType: "track", title: "Sporlogg", distanceMeters, createdAt: new Date().toISOString() }); saveData(); toast(reachedLimit ? "Sporloggen stoppet ved maksimal lengde på 10 km." : `Sporloggen er lagret (${Math.round(distanceMeters)} m).`); }
  else if (!reachedLimit) toast("Sporloggen ble avsluttet før nok GPS-punkter var registrert.");
  trackFeature = null; trackCoordinates = []; updateTrackStatus();
}
function startTrack() {
  if (!navigator.geolocation) { toast("Denne nettleseren støtter ikke posisjon."); return; }
  if (trackWatch) return;
  trackCoordinates = []; trackFeature = null;
  $("start-track").disabled = true; $("stop-track").disabled = false;
  $("track-status").textContent = "Venter på GPS-posisjon …";
  trackWatch = navigator.geolocation.watchPosition((position) => {
    const coordinate = gpsCoordinate(position); updatePositionMarker(coordinate);
    if (!trackCoordinates.length) { trackCoordinates.push(coordinate); updateTrackStatus(); return; }
    const last = trackCoordinates[trackCoordinates.length - 1];
    if (Math.hypot(coordinate[0] - last[0], coordinate[1] - last[1]) < 3) return;
    const candidate = [...trackCoordinates, coordinate];
    const candidateLength = ol.sphere.getLength(new ol.geom.LineString(candidate), { projection });
    if (candidateLength >= 10000) { stopTrack(true); return; }
    trackCoordinates.push(coordinate);
    if (!trackFeature) { trackFeature = new ol.Feature(new ol.geom.LineString(trackCoordinates)); drawingSource.addFeature(trackFeature); }
    else trackFeature.getGeometry().setCoordinates(trackCoordinates);
    updateTrackStatus();
  }, () => { stopTrack(); gpsError(); }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  toast("Sporlogg startet. Den lagres når du stopper den.");
}

$("save-position").addEventListener("click", saveCurrentPosition);
$("start-track").addEventListener("click", startTrack);
$("stop-track").addEventListener("click", () => stopTrack());
$("save-text-note").addEventListener("click", () => {
  if (!selectedFeature || selectedFeature.get("noteType") !== "location") return;
  const title = $("edit-note-title").value.trim(); const body = $("edit-note-text").value.trim();
  if (!title && !body) { toast("Notatet kan ikke være tomt."); return; }
  selectedFeature.setProperties({ title: title || "Lagret posisjon", body }); saveData(); notesSource.changed(); hideDetail(); toast("Posisjonsnotatet er oppdatert.");
});
$("edit-geometry").addEventListener("click", () => {
  const feature = selectedFeature;
  if (!feature) return;
  deactivateTool(); toolMode = "modify";
  modifyInteraction = new ol.interaction.Modify({ features: new ol.Collection([feature]) });
  modifyInteraction.on("modifyend", () => { saveData(); deactivateTool(); showDetail(feature); toast(feature.get("noteType") === "symbol" ? "Symbolet er flyttet og lagret." : "Punktene er oppdatert og lagret."); });
  map.addInteraction(modifyInteraction); $("detail-card").hidden = true; $("map").style.cursor = "crosshair";
  toast("Dra et punkt for å flytte det. Dra et punkt på linjen for å legge til et nytt.");
});

function wrapBubbleText(text, widthPixels) {
  const maxChars = Math.max(12, Math.floor(widthPixels / 7));
  return text.split("\n").flatMap((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines = []; let line = "";
    words.forEach((word) => { const next = line ? `${line} ${word}` : word; if (next.length > maxChars && line) { lines.push(line); line = word; } else line = next; });
    if (line) lines.push(line); return lines;
  }).join("\n");
}
function bubbleRawText(feature) { return [feature.get("title") || "Notat", feature.get("body") || ""].filter(Boolean).join("\n"); }
function bubbleLayout(anchor, end, requiredHeightPixels = 0) {
  const resolution = map.getView().getResolution();
  const dx = end[0] - anchor[0]; const dy = end[1] - anchor[1];
  const directionX = Math.sign(dx) || 1; const directionY = Math.sign(dy) || -1;
  const startX = anchor[0] + dx * 0.2; const startY = anchor[1] + dy * 0.2;
  const width = Math.max(Math.abs(dx * 0.8), 140 * resolution);
  const height = Math.max(Math.abs(dy * 0.8), 62 * resolution, requiredHeightPixels * resolution);
  const endX = startX + directionX * width; const endY = startY + directionY * height;
  const minX = Math.min(startX, endX); const maxX = Math.max(startX, endX); const minY = Math.min(startY, endY); const maxY = Math.max(startY, endY);
  return { ring: [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]], tail: [anchor, [startX, startY]] };
}
function bubbleWidthPixels(feature) { const extent = feature.getGeometry().getExtent(); return Math.max(140, Math.abs(extent[2] - extent[0]) / map.getView().getResolution()); }
function fitBubbleToText(feature) {
  const anchor = feature.get("bubbleAnchor"); const end = feature.get("bubbleEnd");
  if (!anchor || !end) return;
  const initial = bubbleLayout(anchor, end); const width = Math.abs(initial.ring[1][0] - initial.ring[0][0]) / map.getView().getResolution();
  const lines = wrapBubbleText(bubbleRawText(feature), width).split("\n").length;
  const layout = bubbleLayout(anchor, end, 30 + lines * 18);
  feature.getGeometry().setCoordinates([layout.ring]);
}
function bubbleStyle(feature) {
  const width = bubbleWidthPixels(feature);
  const anchor = feature.get("bubbleAnchor"); const end = feature.get("bubbleEnd");
  const tail = anchor && end ? bubbleLayout(anchor, end).tail : null;
  const styles = [new ol.style.Style({ fill: new ol.style.Fill({ color: "rgba(255,255,253,.96)" }), stroke: new ol.style.Stroke({ color: "#dc6f45", width: 3, lineJoin: "round" }), text: new ol.style.Text({ text: wrapBubbleText(bubbleRawText(feature), width - 24), font: "700 14px system-ui", textAlign: "center", textBaseline: "middle", fill: new ol.style.Fill({ color: "#17302a" }), padding: [10, 12, 10, 12] }) })];
  if (tail) styles.push(new ol.style.Style({ geometry: new ol.geom.LineString(tail), stroke: new ol.style.Stroke({ color: "#dc6f45", width: 3, lineCap: "round" }), image: new ol.style.Circle({ radius: 4, fill: new ol.style.Fill({ color: "#dc6f45" }), stroke: new ol.style.Stroke({ color: "#fff", width: 2 }) }) }));
  return styles;
}
function activateTextBubble() {
  const title = $("note-title").value.trim(); const body = $("note-text").value.trim();
  deactivateTool(); toolMode = "text-bubble"; $("map").style.cursor = "crosshair";
  let anchor; let end;
  drawInteraction = new ol.interaction.Draw({ source: notesSource, type: "Circle", geometryFunction: (coordinates, geometry) => {
    anchor = coordinates[0]; end = coordinates[1] || coordinates[0]; const layout = bubbleLayout(anchor, end);
    if (!geometry) geometry = new ol.geom.Polygon([layout.ring]); else geometry.setCoordinates([layout.ring]); return geometry;
  } });
  drawInteraction.on("drawend", (event) => {
    event.feature.setProperties({ id: uid(), noteType: "text", bubble: true, bubbleAnchor: anchor, bubbleEnd: end, title: title || "Notat", body, createdAt: new Date().toISOString() });
    fitBubbleToText(event.feature); $("note-title").value = ""; $("note-text").value = ""; saveData(); deactivateTool(); showDetail(event.feature); requestAnimationFrame(() => { const titleField = $("edit-note-title"); titleField.focus(); titleField.select(); }); toast("Tekstboksen er klar. Skriv inn teksten i panelet.");
  });
  map.addInteraction(drawInteraction); toast("Hold inne ved festepunktet og dra ut snakkeboblen.");
}
$("save-text-note").addEventListener("click", () => {
  if (!selectedFeature || selectedFeature.get("noteType") !== "text" || !selectedFeature.get("bubble")) return;
  fitBubbleToText(selectedFeature); saveData(); notesSource.changed();
});
