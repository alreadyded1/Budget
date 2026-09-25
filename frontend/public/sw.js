/* Payday Budget service worker (D-105).
 *
 * It exists so the app can be installed; it caches nothing. Every request goes to the
 * network as usual, so balances are never served stale and offline writes stay out of
 * scope (SPEC §18).
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request))
})
