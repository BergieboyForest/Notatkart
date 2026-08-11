const CACHE = "notatkart-v87";
const FILES = [
  "./", "./index.html", "./styles.css?v=33", "./app.js?v=87", "./manifest.webmanifest", "./icon.svg",
  "./vendor/ol.css", "./vendor/ol.js", "./vendor/proj4.js", "./vendor/shp.js", "./vendor/geotiff.js",
  "./vendor/pdf.min.js", "./vendor/pdf.worker.min.js", "./vendor/jszip.min.js"
];
const TILE_HOSTS = new Set([
  "wms.geonorge.no", "geo.ngu.no", "wms.nibio.no", "askeladden_wms.ra.no"
]);
function shouldCache(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin || TILE_HOSTS.has(url.hostname);
}
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then((response) => {
    if (shouldCache(event.request) && response && (response.ok || response.type === "opaque")) {
      caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});
