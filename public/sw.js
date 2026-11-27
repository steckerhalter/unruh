/*
 * Unruh development service worker.
 *
 * It used to be cache-first, which meant a reload could keep serving an old
 * index.html while the detector code was being changed. It is now
 * network-first: a reload always gets the current app, with the cached shell
 * only as an offline fallback.
 */
const CACHE_NAME = 'unruh-cache-v2';
const SHELL = [
  '/unruh/',
  '/unruh/index.html',
  '/unruh/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    // Network first: never let a reload run an older bundle.
    event.respondWith(
      fetch(request).catch(() => caches.match('/unruh/index.html'))
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
