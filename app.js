/* global ol, shp */
const APP_KEY = "notatkart:data:v1";
const VISIBILITY_KEY = "notatkart:layer-visibility:v1";
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
let toolMode = null;
let selectedFeature = null;
let pendingPhoto = null;
let pendingSymbol = null;
let positionWatch;
let trackWatch;
let trackFeature = null;
let trackCoordinates = [];
let toastTimer;
let groupVisibility = JSON.parse(localStorage.getItem(VISIBILITY_KEY) || "{}");

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
function symbolText(feature) { if (feature.get("symbolText")) return feature.get("symbolText"); if (feature.get("symbolType") === "culvert" && feature.get("diameter")) return `Ø ${feature.get("diameter")} mm`; return symbolNames[feature.get("symbolType")] || "Symbol"; }
function importKey(feature) { return `import:${feature.get("sourceName") || "ukjent"}`; }
function noteKey(feature) { return feature.get("noteType") === "symbol" ? `symbol:${feature.get("symbolType") || "other"}` : `note:${feature.get("noteType") || "other"}`; }
function groupIsVisible(key) { return groupVisibility[key] !== false; }
function setGroupVisibility(key, visible) { groupVisibility[key] = visible; localStorage.setItem(VISIBILITY_KEY, JSON.stringify(groupVisibility)); importSource.changed(); drawingSource.changed(); notesSource.changed(); }
function localFeatureStyle(feature) {
  if (!groupIsVisible(noteKey(feature))) return null;
  const type = feature.get("noteType");
  if (type === "symbol") {
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
  return new ol.style.Style({ fill: geometryType === "Polygon" ? new ol.style.Fill({ color: "rgba(220,111,69,.18)" }) : undefined, stroke: new ol.style.Stroke({ color: "#dc6f45", width: 4, lineCap: "round", lineJoin: "round" }), image: new ol.style.Circle({ radius: 5, fill: new ol.style.Fill({ color: "#dc6f45" }) }) });
}
function rasterStyle(feature) { const image = feature.get("image"); if (!image?.width) return new ol.style.Style({ fill: new ol.style.Fill({ color: "rgba(49,115,86,.18)" }), stroke: new ol.style.Stroke({ color: "#317356", width: 2, lineDash: [6, 4] }) }); return new ol.style.Style({ renderer(coordinates, state) { const ring = coordinates[0]; if (!ring?.length) return; const [topLeft, topRight, , bottomLeft] = ring; const context = state.context; context.save(); context.globalAlpha = 0.96; context.setTransform((topRight[0] - topLeft[0]) / image.width, (topRight[1] - topLeft[1]) / image.width, (bottomLeft[0] - topLeft[0]) / image.height, (bottomLeft[1] - topLeft[1]) / image.height, topLeft[0], topLeft[1]); context.drawImage(image, 0, 0); context.restore(); } }); }
function importedStyle(feature) { if (!groupIsVisible(importKey(feature))) return null; if (feature.get("importType") === "raster") return rasterStyle(feature); return new ol.style.Style({ fill: new ol.style.Fill({ color: "rgba(49,115,86,.13)" }), stroke: new ol.style.Stroke({ color: "#317356", width: 2 }), image: new ol.style.Circle({ radius: 4, fill: new ol.style.Fill({ color: "#317356" }) }) }); }
const baseLayer = new ol.layer.Tile({ source: new ol.source.TileWMS({ url: "https://wms.geonorge.no/skwms1/wms.norges_grunnkart", params: { LAYERS: "Norges_grunnkart", FORMAT: "image/png", TRANSPARENT: false }, crossOrigin: "anonymous" }) });
const losmasserLayer = new ol.layer.Tile({ visible: false, source: new ol.source.TileWMS({ url: "https://geo.ngu.no/mapserver/LosmasserWMS3", params: { LAYERS: "Losmasser_temakart_sammenstilt", FORMAT: "image/png", TRANSPARENT: true }, crossOrigin: "anonymous" }) });
const marinLeireLayer = new ol.layer.Tile({ visible: false, source: new ol.source.TileWMS({ url: "https://geo.ngu.no/mapserver/MarinGrenseWMS4", params: { LAYERS: "Mulig_marin_leire", FORMAT: "image/png", TRANSPARENT: true }, crossOrigin: "anonymous" }) });
const importLayer = new ol.layer.Vector({ source: importSource, style: importedStyle });
const notesLayer = new ol.layer.Vector({ source: notesSource, style: localFeatureStyle });
const drawingLayer = new ol.layer.Vector({ source: drawingSource, style: localFeatureStyle });
const positionLayer = new ol.layer.Vector({ source: positionSource, style: new ol.style.Style({ image: new ol.style.Circle({ radius: 8, fill: new ol.style.Fill({ color: "#2877d5" }), stroke: new ol.style.Stroke({ color: "#fff", width: 3 }) }) }) });
const map = new ol.Map({ target: "map", layers: [baseLayer, losmasserLayer, marinLeireLayer, importLayer, drawingLayer, notesLayer, positionLayer], view: new ol.View({ center: ol.proj.fromLonLat([10.256, 60.168]), zoom: 8, maxZoom: 20 }), controls: ol.control.defaults.defaults({ attribution: false }) });

function appendLayerRow(container, label, count, key) { const row = document.createElement("label"); const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.setAttribute("aria-label", `${label} (${count})`); checkbox.checked = groupIsVisible(key); checkbox.addEventListener("change", () => setGroupVisibility(key, checkbox.checked)); const text = document.createElement("span"); text.textContent = label; const amount = document.createElement("small"); amount.textContent = `${count}`; row.append(checkbox, text, amount); container.append(row); }
function refreshLayerMenus() { const importList = $("import-list"); const importedGroups = new Map(); importSource.getFeatures().forEach((feature) => { const name = feature.get("sourceName") || "Importerte data"; importedGroups.set(name, (importedGroups.get(name) || 0) + 1); }); importList.replaceChildren(); if (importedGroups.size) importedGroups.forEach((count, name) => appendLayerRow(importList, name, count, `import:${name}`)); else importList.textContent = "Ingen importerte data ennå."; const notesList = $("notes-list"); const noteGroups = new Map(); [...drawingSource.getFeatures(), ...notesSource.getFeatures()].forEach((feature) => { const key = noteKey(feature); noteGroups.set(key, (noteGroups.get(key) || 0) + 1); }); const groups = [{ key: "note:sketch", label: "Skisser" }, { key: "note:text", label: "Tekstnotater" }, { key: "note:photo", label: "Bilder" }, { key: "symbol:culvert", label: "Stikkrenner" }, { key: "symbol:landing", label: "Velteplasser" }, { key: "symbol:turning", label: "Snuplasser" }, { key: "symbol:arrow-left", label: "Gule piler mot venstre" }, { key: "symbol:arrow-right", label: "Gule piler mot høyre" }]; notesList.replaceChildren(); groups.forEach((group) => appendLayerRow(notesList, group.label, noteGroups.get(group.key) || 0, group.key)); }
function countObjects() { const importedDatasets = new Set(importSource.getFeatures().map((feature) => feature.get("sourceName") || "Importerte data")).size; $("import-count").textContent = `${importedDatasets} datasett`; const noteObjects = drawingSource.getFeatures().length + notesSource.getFeatures().length; $("note-count").textContent = `${noteObjects} objekt${noteObjects === 1 ? "" : "er"}`; refreshLayerMenus(); }
function serialise(source) { const images = source.getFeatures().map((feature) => [feature, feature.get("image")]); images.forEach(([feature, image]) => { if (image) feature.unset("image", true); }); const data = format.writeFeaturesObject(source.getFeatures(), { featureProjection: projection, dataProjection: projection }); images.forEach(([feature, image]) => { if (image) feature.set("image", image, true); }); return data; }
function readInto(source, data) { if (data?.features) source.addFeatures(format.readFeatures(data, { featureProjection: projection, dataProjection: projection })); }
function saveData() { localStorage.setItem(APP_KEY, JSON.stringify({ drawings: serialise(drawingSource), notes: serialise(notesSource), imports: serialise(importSource) })); countObjects(); }
function loadData() { try { const data = JSON.parse(localStorage.getItem(APP_KEY)); if (data) { readInto(drawingSource, data.drawings); readInto(notesSource, data.notes); readInto(importSource, data.imports); } } catch { toast("Kunne ikke lese tidligere lokale notater."); } countObjects(); }
function photoDatabase() { return new Promise((resolve, reject) => { const request = indexedDB.open(PHOTO_DB, 1); request.onupgradeneeded = () => request.result.createObjectStore(PHOTO_STORE); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function savePhoto(id, blob) { const db = await photoDatabase(); return new Promise((resolve, reject) => { const tx = db.transaction(PHOTO_STORE, "readwrite"); tx.objectStore(PHOTO_STORE).put(blob, id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
async function getPhoto(id) { const db = await photoDatabase(); return new Promise((resolve, reject) => { const request = db.transaction(PHOTO_STORE).objectStore(PHOTO_STORE).get(id); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function deletePhoto(id) { const db = await photoDatabase(); return new Promise((resolve, reject) => { const tx = db.transaction(PHOTO_STORE, "readwrite"); tx.objectStore(PHOTO_STORE).delete(id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
function rasterImage(blob) { return new Promise((resolve, reject) => { const url = URL.createObjectURL(blob); const image = new Image(); image.onload = () => { URL.revokeObjectURL(url); resolve(image); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Kunne ikke lese JPEG-bildet")); }; image.src = url; }); }
async function restoreRasterImages() { const rasters = importSource.getFeatures().filter((feature) => feature.get("importType") === "raster" && feature.get("rasterId")); await Promise.all(rasters.map(async (feature) => { try { const blob = await getPhoto(feature.get("rasterId")); if (blob) feature.set("image", await rasterImage(blob)); } catch { /* Kartpakken vises som ramme dersom den lokale bildefilen mangler. */ } })); importSource.changed(); }
function projectionFromPrj(prjText) { const zone = prjText.match(/UTM[_ ]Zone[_ ](\d{1,2})N/i)?.[1]; if (!zone) throw new Error("Finner ikke UTM-sone i PRJ-filen."); const epsg = /WGS[_ ]?1984|WGS 84/i.test(prjText) ? `EPSG:326${zone.padStart(2, "0")}` : `EPSG:258${zone.padStart(2, "0")}`; if (!ol.proj.get(epsg)) { const definition = epsg.startsWith("EPSG:326") ? `+proj=utm +zone=${Number(zone)} +datum=WGS84 +units=m +no_defs` : `+proj=utm +zone=${Number(zone)} +ellps=GRS80 +units=m +no_defs`; proj4.defs(epsg, definition); ol.proj.proj4.register(proj4); } return epsg; }
function worldCorners(values, width, height, dataProjection) { const [a, d, b, e, c, f] = values; const coordinate = (column, row) => ol.proj.transform([a * column + b * row + c, d * column + e * row + f], dataProjection, projection); return [coordinate(-0.5, -0.5), coordinate(width - 0.5, -0.5), coordinate(width - 0.5, height - 0.5), coordinate(-0.5, height - 0.5), coordinate(-0.5, -0.5)]; }
function deactivateTool() { if (drawInteraction) { map.removeInteraction(drawInteraction); drawInteraction = null; } toolMode = null; document.querySelectorAll("[data-draw]").forEach((button) => button.classList.remove("active")); $("map").style.cursor = ""; }
function activateDraw(kind) { deactivateTool(); toolMode = "draw"; document.querySelector(`[data-draw="${kind}"]`).classList.add("active"); drawInteraction = new ol.interaction.Draw({ source: drawingSource, type: kind === "freehand" ? "LineString" : kind, freehand: kind === "freehand", style: new ol.style.Style({ stroke: new ol.style.Stroke({ color: "#dc6f45", width: 4 }) }) }); drawInteraction.on("drawend", (event) => { event.feature.setProperties({ id: uid(), noteType: "sketch", createdAt: new Date().toISOString() }); saveData(); toast("Skissen er lagret lokalt på denne enheten."); deactivateTool(); }); map.addInteraction(drawInteraction); toast(kind === "Polygon" ? "Tegn område og dobbelttrykk for å avslutte." : "Tegn i kartet. Dobbelttrykk for å avslutte."); }
function selectPlacement(kind) { deactivateTool(); toolMode = kind; $("map").style.cursor = "crosshair"; const messages = { text: "Trykk i kartet der tekstboksen skal plasseres.", photo: "Trykk i kartet der bildet hører til.", symbol: `Trykk i kartet der ${symbolNames[pendingSymbol?.type]?.toLowerCase() || "symbolet"} skal plasseres.` }; toast(messages[kind]); }
async function addPhoto(coordinate) { const id = uid(); try { await savePhoto(id, pendingPhoto); notesSource.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coordinate), id: uid(), noteType: "photo", photoId: id, title: pendingPhoto.name || "Bilde", createdAt: new Date().toISOString() })); pendingPhoto = null; $("photo-name").textContent = "Ingen bilde valgt."; $("place-photo").disabled = true; saveData(); toast("Bildet er lagret på kartpunktet."); } catch { toast("Bildet kunne ikke lagres lokalt."); } }
function addText(coordinate) { const body = $("note-text").value.trim(); const title = $("note-title").value.trim(); if (!body && !title) { toast("Skriv litt tekst før du plasserer notatet."); return; } notesSource.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coordinate), id: uid(), noteType: "text", title: title || "Notat", body, createdAt: new Date().toISOString() })); $("note-title").value = ""; $("note-text").value = ""; saveData(); toast("Tekstboksen er lagret på kartpunktet."); }
function addSymbol(coordinate) { if (!pendingSymbol) return; const name = symbolNames[pendingSymbol.type]; notesSource.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coordinate), id: uid(), noteType: "symbol", symbolType: pendingSymbol.type, symbolText: pendingSymbol.text, title: name, body: pendingSymbol.text || "Kartfestet symbol", createdAt: new Date().toISOString() })); saveData(); toast(`${name} er lagret på kartpunktet.`); pendingSymbol = null; }
map.on("singleclick", async (event) => { if (toolMode === "text") { addText(event.coordinate); deactivateTool(); return; } if (toolMode === "photo") { await addPhoto(event.coordinate); deactivateTool(); return; } if (toolMode === "symbol") { addSymbol(event.coordinate); deactivateTool(); return; } let found; map.forEachFeatureAtPixel(event.pixel, (feature, layer) => { if (layer === notesLayer || layer === drawingLayer) { found = feature; return true; } }, { hitTolerance: 14 }); if (found) showDetail(found); else hideDetail(); });
function hideDetail() { selectedFeature = null; $("detail-card").hidden = true; $("detail-photo").src = ""; $("symbol-editor").hidden = true; $("text-editor").hidden = true; }
async function showDetail(feature) { selectedFeature = feature; const type = feature.get("noteType"); $("detail-type").textContent = type === "photo" ? "KARTFESTET BILDE" : type === "text" ? "KARTFESTET NOTAT" : type === "symbol" ? "KARTFESTET SYMBOL" : type === "sketch" ? "SKISSE" : "IMPORTERT SHAPE"; $("detail-title").textContent = type === "symbol" ? symbolNames[feature.get("symbolType")] : feature.get("title") || (type === "sketch" ? "Skisse" : feature.get("sourceName") || "Kartobjekt"); $("detail-body").textContent = type === "symbol" ? (symbolText(feature) || "Kartfestet symbol") : feature.get("body") || (type === "sketch" ? "Tegnet i Notatkart." : "Importert shapefil."); $("symbol-editor").hidden = type !== "symbol"; $("text-editor").hidden = type !== "text"; if (type === "symbol") { $("edit-symbol-type").value = feature.get("symbolType") || "culvert"; $("edit-symbol-text").value = feature.get("symbolText") || symbolText(feature); } if (type === "text") { $("edit-note-title").value = feature.get("title") || ""; $("edit-note-text").value = feature.get("body") || ""; } const image = $("detail-photo"); image.hidden = true; image.src = ""; if (type === "photo") { const blob = await getPhoto(feature.get("photoId")); if (blob) { image.src = URL.createObjectURL(blob); image.hidden = false; } else $("detail-body").textContent = "Bildefilen finnes ikke lenger lokalt på denne enheten."; } $("detail-card").hidden = false; }
$("delete-object").addEventListener("click", async () => { if (!selectedFeature) return; if (!confirm("Slette dette objektet fra Notatkart?")) return; const photoId = selectedFeature.get("photoId"); [notesSource, drawingSource].forEach((source) => source.removeFeature(selectedFeature)); if (photoId) await deletePhoto(photoId); saveData(); hideDetail(); toast("Objektet er slettet."); });
$("close-detail").addEventListener("click", hideDetail);
document.querySelectorAll("[data-draw]").forEach((button) => button.addEventListener("click", () => activateDraw(button.dataset.draw)));
$("cancel-tool").addEventListener("click", () => { deactivateTool(); toast("Aktivt verktøy er avsluttet."); });
$("place-text").addEventListener("click", activateTextBubble);
$("symbol-toggle").addEventListener("click", () => { const open = $("symbol-content").hidden; $("symbol-content").hidden = !open; $("symbol-toggle").setAttribute("aria-expanded", String(open)); });
function toggleToolContent(toggleId, contentId) { $(toggleId).addEventListener("click", () => { const open = $(contentId).hidden; $(contentId).hidden = !open; $(toggleId).setAttribute("aria-expanded", String(open)); }); }
toggleToolContent("text-toggle", "text-content");
toggleToolContent("position-toggle", "position-content");
toggleToolContent("track-toggle", "track-content");
$("place-symbol").addEventListener("click", () => { pendingSymbol = { type: $("symbol-type").value, text: $("symbol-text").value.trim() }; selectPlacement("symbol"); });
$("save-symbol").addEventListener("click", () => { if (!selectedFeature || selectedFeature.get("noteType") !== "symbol") return; const symbolType = $("edit-symbol-type").value; const text = $("edit-symbol-text").value.trim(); selectedFeature.setProperties({ symbolType, symbolText: text, title: symbolNames[symbolType], body: text || "Kartfestet symbol" }); saveData(); showDetail(selectedFeature); notesSource.changed(); toast("Symbolinformasjonen er oppdatert."); });
$("save-text-note").addEventListener("click", () => { if (!selectedFeature || selectedFeature.get("noteType") !== "text") return; const title = $("edit-note-title").value.trim(); const body = $("edit-note-text").value.trim(); if (!title && !body) { toast("Tekstnotatet kan ikke være tomt."); return; } selectedFeature.setProperties({ title: title || "Notat", body }); saveData(); showDetail(selectedFeature); notesSource.changed(); toast("Tekstnotatet er oppdatert."); });
$("photo-input").addEventListener("change", (event) => { pendingPhoto = event.target.files?.[0] || null; $("photo-name").textContent = pendingPhoto ? pendingPhoto.name : "Ingen bilde valgt."; $("place-photo").disabled = !pendingPhoto; });
$("place-photo").addEventListener("click", () => { if (pendingPhoto) selectPlacement("photo"); });
$("base-toggle").addEventListener("change", (event) => { baseLayer.setVisible(event.target.checked); });
$("losmasser-toggle").addEventListener("change", (event) => { losmasserLayer.setVisible(event.target.checked); });
$("marin-leire-toggle").addEventListener("change", (event) => { marinLeireLayer.setVisible(event.target.checked); });
$("import-toggle").addEventListener("change", (event) => { importLayer.setVisible(event.target.checked); });
$("notes-toggle").addEventListener("change", (event) => { drawingLayer.setVisible(event.target.checked); notesLayer.setVisible(event.target.checked); });
function toggleSubmenu(buttonId, menuId) { $(buttonId).addEventListener("click", () => { const open = $(menuId).hidden; $(menuId).hidden = !open; $(buttonId).setAttribute("aria-expanded", String(open)); }); }
toggleSubmenu("import-expand", "import-list");
toggleSubmenu("notes-expand", "notes-list");
async function importShapeFile(file) { const parsed = await shp(await file.arrayBuffer()); const collections = parsed.type === "FeatureCollection" ? [parsed] : Object.values(parsed); let total = 0; collections.forEach((collection) => { const features = format.readFeatures(collection, { dataProjection: "EPSG:4326", featureProjection: projection }); features.forEach((feature) => feature.setProperties({ id: uid(), sourceName: file.name, imported: true, importType: "shape" })); importSource.addFeatures(features); total += features.length; }); return total; }
async function importAvenzaFile(file, zip, names) { const jgwName = names.find((name) => /\.(jgw|jpgw)$/i.test(name)); const jpegName = names.find((name) => /\.(jpg|jpeg)$/i.test(name)); const prjName = names.find((name) => /\.prj$/i.test(name)); if (!jgwName || !jpegName || !prjName) throw new Error("Kartpakken mangler JPEG, JGW eller PRJ."); const values = (await zip.file(jgwName).async("string")).trim().split(/\s+/).map(Number); if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) throw new Error("JGW-filen har ugyldige koordinater."); const dataProjection = projectionFromPrj(await zip.file(prjName).async("string")); const blob = await zip.file(jpegName).async("blob"); const image = await rasterImage(blob); const rasterId = uid(); await savePhoto(rasterId, blob); const feature = new ol.Feature({ geometry: new ol.geom.Polygon([worldCorners(values, image.width, image.height, dataProjection)]), id: uid(), importType: "raster", rasterId, sourceName: file.name, title: file.name, body: "Georeferert JPEG-kartpakke" }); feature.set("image", image, true); importSource.addFeature(feature); return 1; }
async function importZipFile(file) { const zip = await JSZip.loadAsync(file); const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir); if (names.some((name) => /\.shp$/i.test(name))) return importShapeFile(file); if (names.some((name) => /\.(jgw|jpgw)$/i.test(name)) && names.some((name) => /\.(jpg|jpeg)$/i.test(name))) return importAvenzaFile(file, zip, names); throw new Error("Fant verken shapefil eller JPEG/JGW-kartpakke i ZIP-filen."); }
$("shape-input").addEventListener("change", async (event) => { const files = [...(event.target.files || [])]; if (!files.length) return; let imported = 0; try { toast(`Leser ${files.length} kartfil${files.length === 1 ? "" : "er"} …`); for (const file of files) imported += await importZipFile(file); saveData(); if (imported) { map.getView().fit(importSource.getExtent(), { padding: [70, 280, 70, 280], maxZoom: 16, duration: 500 }); toast(`${imported} objekt fra ${files.length} kartfil${files.length === 1 ? "" : "er"} er importert og lagret.`); } } catch (error) { console.error(error); toast("Kunne ikke importere én av filene. ZIP må inneholde shapefil eller JPEG + JGW + PRJ."); } finally { event.target.value = ""; } });
function currentPosition() { if (!navigator.geolocation) { toast("Denne nettleseren støtter ikke posisjon."); return; } $("locate-button").textContent = "Finner posisjon …"; navigator.geolocation.getCurrentPosition((position) => { const coordinate = ol.proj.fromLonLat([position.coords.longitude, position.coords.latitude]); positionSource.clear(); positionSource.addFeature(new ol.Feature(new ol.geom.Point(coordinate))); map.getView().animate({ center: coordinate, zoom: Math.max(map.getView().getZoom(), 16), duration: 600 }); $("locate-button").textContent = "Min posisjon"; if (positionWatch) navigator.geolocation.clearWatch(positionWatch); positionWatch = navigator.geolocation.watchPosition((update) => { positionSource.getFeatures()[0]?.getGeometry().setCoordinates(ol.proj.fromLonLat([update.coords.longitude, update.coords.latitude])); }, () => {}, { enableHighAccuracy: true, maximumAge: 10000 }); toast("Posisjonen vises med blå prikk."); }, () => { $("locate-button").textContent = "Min posisjon"; toast("Fikk ikke posisjon. Kontroller at du har gitt tillatelse."); }, { enableHighAccuracy: true, timeout: 15000 }); }
$("locate-button").addEventListener("click", currentPosition);
function download(blob, filename) { const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
function exportJpeg() { toast("Lager JPEG av gjeldende kartutsnitt …"); map.once("rendercomplete", () => { try { const size = map.getSize(); const result = document.createElement("canvas"); result.width = size[0]; result.height = size[1]; const context = result.getContext("2d"); Array.from(map.getViewport().querySelectorAll("canvas")).forEach((canvas) => { if (!canvas.width || !canvas.height) return; const opacity = canvas.parentNode.style.opacity || canvas.style.opacity || 1; context.globalAlpha = Number(opacity); const matrix = (canvas.style.transform || "").match(/^matrix\(([^)]+)\)$/); if (matrix) context.setTransform(...matrix[1].split(",").map(Number)); else context.setTransform(1, 0, 0, 1, 0, 0); context.drawImage(canvas, 0, 0); }); context.setTransform(1, 0, 0, 1, 0, 0); result.toBlob((blob) => { if (!blob) throw new Error("Kunne ikke lage bilde"); const stamp = new Date().toISOString().slice(0, 10); download(blob, `notatkart-${stamp}.jpg`); const extent = map.getView().calculateExtent(size); const resolution = map.getView().getResolution(); const worldFile = [resolution, 0, 0, -resolution, extent[0] + resolution / 2, extent[3] - resolution / 2].join("\n"); download(new Blob([worldFile], { type: "text/plain" }), `notatkart-${stamp}.jgw`); download(new Blob(["Koordinatsystem: EPSG:3857 (Web Mercator)\nJPEG og JGW-filen må ligge sammen."], { type: "text/plain" }), `notatkart-${stamp}-lesmeg.txt`); toast("JPEG, JGW og koordinatinfo er lastet ned."); }, "image/jpeg", .92); } catch (error) { console.error(error); toast("Kunne ikke lage JPEG. Prøv igjen når grunnkartet er lastet."); } }); map.renderSync(); }
$("export-button").addEventListener("click", exportJpeg);
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
  const type = feature.get("noteType");
  $("detail-type").textContent = type === "photo" ? "KARTFESTET BILDE" : type === "location" ? "LAGRET POSISJON" : type === "text" ? "KARTFESTET NOTAT" : type === "track" ? "SPORLOGG" : type === "symbol" ? "KARTFESTET SYMBOL" : type === "sketch" ? "SKISSE" : "IMPORTERT SHAPE";
  $("detail-title").textContent = type === "symbol" ? symbolNames[feature.get("symbolType")] : feature.get("title") || (type === "track" ? "Sporlogg" : type === "sketch" ? "Skisse" : feature.get("sourceName") || "Kartobjekt");
  $("detail-body").textContent = type === "symbol" ? (symbolText(feature) || "Kartfestet symbol") : type === "track" ? `Lengde: ${Math.round(feature.get("distanceMeters") || 0)} m` : feature.get("body") || (type === "sketch" ? "Tegnet i Notatkart." : "Importert shapefil.");
  $("symbol-editor").hidden = type !== "symbol";
  $("text-editor").hidden = type !== "text" && type !== "location";
  if (type === "symbol") { $("edit-symbol-type").value = feature.get("symbolType") || "culvert"; $("edit-symbol-text").value = feature.get("symbolText") || symbolText(feature); }
  if (type === "text" || type === "location") { $("edit-note-title").value = feature.get("title") || ""; $("edit-note-text").value = feature.get("body") || ""; }
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
  selectedFeature.setProperties({ title: title || "Lagret posisjon", body }); saveData(); showDetail(selectedFeature); notesSource.changed(); toast("Posisjonsnotatet er oppdatert.");
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
  if (!title && !body) { toast("Skriv tekst før du tegner tekstboksen."); return; }
  deactivateTool(); toolMode = "text-bubble"; $("map").style.cursor = "crosshair";
  let anchor; let end;
  drawInteraction = new ol.interaction.Draw({ source: notesSource, type: "Circle", geometryFunction: (coordinates, geometry) => {
    anchor = coordinates[0]; end = coordinates[1] || coordinates[0]; const layout = bubbleLayout(anchor, end);
    if (!geometry) geometry = new ol.geom.Polygon([layout.ring]); else geometry.setCoordinates([layout.ring]); return geometry;
  } });
  drawInteraction.on("drawend", (event) => {
    event.feature.setProperties({ id: uid(), noteType: "text", bubble: true, bubbleAnchor: anchor, bubbleEnd: end, title: title || "Notat", body, createdAt: new Date().toISOString() });
    fitBubbleToText(event.feature); $("note-title").value = ""; $("note-text").value = ""; saveData(); deactivateTool(); toast("Tekstboksen er lagret. Trykk på den for å redigere teksten.");
  });
  map.addInteraction(drawInteraction); toast("Hold inne ved festepunktet og dra ut snakkeboblen.");
}
$("save-text-note").addEventListener("click", () => {
  if (!selectedFeature || selectedFeature.get("noteType") !== "text" || !selectedFeature.get("bubble")) return;
  fitBubbleToText(selectedFeature); saveData(); notesSource.changed();
});
