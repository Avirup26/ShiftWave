// ShiftWave service worker — network-first pass-through.
// This file exists solely to satisfy Chrome's PWA installability requirement.
// It performs NO caching: every request goes to the network, and the response
// is returned directly without being stored. There are no caches.open(),
// caches.put(), or cache-first fallbacks anywhere in this file.
self.addEventListener('fetch', function (event) {
  event.respondWith(fetch(event.request));
});
