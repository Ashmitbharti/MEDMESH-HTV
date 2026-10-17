// Offline cache: once opened with internet, MedMesh works with none.
const C = "medmesh-v5";
const CORE = ["./", "index.html", "app.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "area.json"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(C).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/")) return; // never cache live data
  const fresh = e.request.mode === "navigate" || /\/(app\.js|index\.html)?$/.test(u.pathname);
  if (fresh) { // network first for the app shell so redeploys show up immediately; cache when offline
    e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => {
    const net = fetch(e.request).then((r) => { if (r.ok && (u.origin === location.origin || u.host.includes("fonts."))) { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
