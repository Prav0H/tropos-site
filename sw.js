// Tropos: файлы программы хранятся на устройстве — повторное открытие мгновенное.
// Файлы с ?v=N неизменны — берём из памяти; страницу и прочее — из сети, при отсутствии сети — из памяти.
const CACHE = "tropos-v15";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET") return;
  if (u.hostname.endsWith("supabase.co")) return; // данные — всегда свежие
  const fixed = /[?&]v=\d+/.test(u.search) || /cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(u.hostname) || /\/(icons|fonts)\//.test(u.pathname);
  if (fixed) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(r).then((hit) => hit || fetch(r).then((res) => { if (res.ok || res.type === "opaque") c.put(r, res.clone()); return res; }))));
  } else if (u.origin === location.origin) {
    e.respondWith(fetch(r).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(r, cp)); return res; }).catch(() => caches.match(r, { ignoreSearch: true })));
  }
});
