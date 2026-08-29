/**
 * Service worker: precache the whole app so Hexaequo works offline.
 *
 * The bundle is small and entirely static, so a cache-first strategy is safe.
 *
 * The version is not written here. The server computes it from the contents of
 * the files being cached and substitutes it on the way out, so a deploy that
 * changes anything gets a new cache and one that changes nothing does not.
 * Bumping it by hand was a step that could be forgotten — and was, for several
 * releases, which is exactly how an installed app gets stuck on old code.
 */

const CACHE_VERSION = '__BUILD__';

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
  './src/auth.js',
  './src/net.js',
  './src/audio.js',
  './src/update.js',
  './src/handoff.js',
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
  './src/views/legal.js',
  './src/views/account.js',
  './src/views/leaderboard.js',
  './src/views/online.js',
  './src/ui/overlay.js',
  './src/ui/panels.js',
  './src/views/settings.js',
  './assets/icons/icon-192x192.png',
  './assets/icons/icon-512x512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './apple-touch-icon.png',
  // Sound is synthesised in audio.js; there is nothing left to download.
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // addAll rejects wholesale if any single entry 404s; add individually so a
      // missing optional asset cannot block the install.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
  );
});

/*
 * Step aside until the page says so.
 *
 * Taking over the moment a new worker installs leaves the open page running
 * the old modules against the new caches, which is a half-updated app. The
 * page offers the update instead, and sends this when the person accepts.
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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
