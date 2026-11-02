// Service worker: app shell works offline (results, verdicts, tracking); scans need the network.
const CACHE = "skinverdict-v5";
const SHELL = [
  "./", "index.html", "styles.css?v=5", "manifest.webmanifest",
  "js/theme.js?v=5", "js/ingredients.js?v=5", "js/engine.js?v=5", "js/products.js?v=5", "js/store.js?v=5", "js/app.js?v=5",
  "js/share.js?v=5", "js/barcode.js?v=5", "js/scanner.js?v=5", "js/ocr.js?v=5", "js/sync.js?v=5", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // fonts, YouCam masks: browser default
  if (url.pathname.startsWith("/api/")) return; // live data: always network
  // Network-first for the page (fresh deploys show up), cache-first for versioned assets.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((r) => { caches.open(CACHE).then((c) => c.put("index.html", r.clone())); return r; }).catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  })));
});
