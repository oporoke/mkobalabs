// Mkoba Lite App service worker: keeps the app usable offline.
// App files: cache first. Data (/d/api GET): network first, last copy when offline. Writes are never cached
// (the page keeps unsent records itself and sends them when the connection returns).
const CACHE = 'mkoba-app-__VERSION__';
const SHELL = ['/d/app/', '/d/app/app.js?v=__VERSION__', '/d/app/app.css?v=__VERSION__', '/d/app/manifest.webmanifest', '/d/app/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('mkoba-app-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/d/api/')) {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  if (url.pathname.startsWith('/d/app')) {
    e.respondWith(caches.match(e.request, { ignoreSearch: url.pathname === '/d/app/' }).then(hit => hit || fetch(e.request)));
  }
});
