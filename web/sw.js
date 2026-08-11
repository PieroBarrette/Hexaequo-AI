/**
 * Service worker: precache the whole app so Hexaequo works offline.
 *
 * The bundle is small and entirely static, so a cache-first strategy is safe.
 * Bump CACHE_VERSION on every release — the activate step removes older caches.
 */

const CACHE_VERSION = 'hexaequo-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/tokens.css',
  './styles/app.css',
  './src/main.js',
  './src/router.js',
  './src/settings.js',
  './src/i18n.js',
  './src/audio.js',
  './src/locales/en.json',
  './src/locales/fr.json',
  './src/game/hex.js',
  './src/game/state.js',
  './src/game/moves.js',
  './src/game/ai.js',
  './src/ui/board.js',
  './src/ui/logo.js',
  './src/ui/miniBoard.js',
  './src/views/home.js',
  './src/views/play.js',
  './src/views/rules.js',
  './src/views/settings.js',
  './assets/icons/icon-192x192.png',
  './assets/icons/icon-512x512.png',
  './assets/sounds/tile_placement.mp3',
  './assets/sounds/piece_placement.mp3',
  './assets/sounds/move.mp3',
  './assets/sounds/capture.mp3',
  './assets/sounds/game_end.mp3',
  './assets/sounds/button_click.mp3',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // addAll rejects wholesale if any single entry 404s; add individually so a
      // missing optional asset cannot block the install.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations fall back to the shell so deep links resolve while offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html').then((r) => r || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached || Response.error());
    })
  );
});
