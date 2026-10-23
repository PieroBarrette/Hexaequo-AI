/**
 * Service worker: precache the whole app so Hexaequo works offline.
 *
 * The app's files are small and entirely static, so they are served
 * cache-first. Nothing else is: the API and the socket go to the network as if
 * the worker were not there (see the fetch handler).
 *
 * The version is not written here. The server computes it from the contents of
 * the files being cached and substitutes it on the way out, so a deploy that
 * changes anything gets a new cache and one that changes nothing does not.
 * Bumping it by hand was a step that could be forgotten — and was, for several
 * releases, which is exactly how an installed app gets stuck on old code.
 */

const CACHE_VERSION = '__BUILD__';

/*
 * On a development machine the worker caches nothing and steps in at once.
 *
 * It used to be kept off localhost altogether, because a cache-first worker
 * there serves yesterday's modules after every edit. But notifications cannot
 * arrive without a worker, so now it is registered everywhere and, here, does
 * only that: every request goes to the network as if it were not there.
 */
const DEVELOPMENT = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(self.location.hostname);

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/tokens.css',
  './styles/app.css',
  './src/bootTheme.js',
  './src/main.js',
  './src/router.js',
  './src/settings.js',
  './src/fade.js',
  './src/i18n.js',
  './src/auth.js',
  './src/net.js',
  './src/audio.js',
  './src/update.js',
  './src/locales/en.json',
  './src/locales/fr.json',
  './src/game/hex.js',
  './src/game/state.js',
  './src/game/moves.js',
  './src/game/ai.js',
  './src/ui/board.js',
  './src/ui/icons.js',
  './src/ui/logo.js',
  './src/ui/miniBoard.js',
  './src/views/home.js',
  './src/views/play.js',
  './src/views/account.js',
  './src/views/leaderboard.js',
  './src/views/online.js',
  './src/ui/overlay.js',
  './src/ui/panels.js',
  './src/ui/authErrors.js',
  /* The pages with addresses of their own, drawn as panels. Their documents
     (/rules/, /fr/regles/…) need not be cached: offline, any address falls
     back to the shell below, and the shell opens the page from the path. */
  './src/pages.js',
  './src/content/index.js',
  './src/content/shared.js',
  './src/content/rules.js',
  './src/content/about.js',
  './src/content/guide.js',
  './src/content/faq.js',
  './src/content/legal.js',
  './src/views/settings.js',
  './assets/icons/icon-192x192.png',
  './assets/icons/icon-512x512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './apple-touch-icon.png',
  /* The analysis worker and the arithmetic it feeds. The worker pulls in the
     game modules above, which are already here. */
  './src/game/accuracy.js',
  './src/game/analysisWorker.js',
  './src/presence.js',
  './src/progress.js',
  './src/push.js',
  './src/settingsSync.js',
  './src/streak.js',
  './src/ui/challenge.js',
  './src/ui/emoji.js',
  './src/ui/qr.js',
  './src/views/lobby.js',
  './src/views/mailAction.js',
  './src/views/profile.js',
  // Sound is synthesised in audio.js; there is nothing left to download.
];

/* The app's own files: the list above, and anything else in the folders where
   it keeps its code, styles and pictures. The only answers this worker keeps. */
const OWN = new Set(SHELL.map((entry) => new URL(entry, self.location.href).pathname));
const isOwnFile = (url) => OWN.has(url.pathname) || /^\/(src|styles|assets)\//.test(url.pathname);

self.addEventListener('install', (event) => {
  if (DEVELOPMENT) {
    self.skipWaiting();
    return;
  }
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
      .then((names) => Promise.all(names
        .filter((n) => DEVELOPMENT || n !== CACHE_VERSION)
        .map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (DEVELOPMENT) return;
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

  /*
   * Anything that is not one of the app's files goes to the network,
   * untouched. It used to be every GET to this origin, and the API and the
   * socket are GETs too: a rating, a leaderboard or /api/version gave their
   * first answer until the next release, /api/auth/me kept for one account
   * was handed to the next on a shared computer, and every request socket.io
   * made while polling left an entry behind. Even the socket.io client, which
   * the server hands out so that the two cannot drift apart, was kept until
   * the app's next release, whatever the server had moved to since.
   */
  if (!isOwnFile(url)) return;

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

/* ── Notifications ──────────────────────────────────────────────────────────
 *
 * The server sends a few lines of JSON — the words, where tapping leads, a tag
 * and the number for the icon — and this draws them. Banner, sound and whether
 * the badge shows at all are the device's to decide, from its own settings.
 *
 * Every push is shown. Browsers insist on it, and Safari withdraws the
 * subscription of a site that receives pushes without showing anything — so
 * the decision not to bother somebody who is looking is made on the server,
 * before anything is sent, never here.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const shown = self.registration.showNotification(data.title || 'Hexaequo', {
    body: data.body || '',
    icon: './assets/icons/icon-192x192.png',
    // The small one-colour mark Android puts in the status bar.
    badge: './assets/icons/badge-96.png',
    /* One per subject: a newer "your move" replaces the last rather than
       stacking, and still sounds, since it is news. */
    tag: data.tag || 'hexaequo',
    renotify: true,
    lang: data.lang || '',
    timestamp: data.at || Date.now(),
    data: { url: data.url || './', kind: data.kind || null },
  });
  const counted = data.badge && self.navigator && self.navigator.setAppBadge
    ? self.navigator.setAppBadge(data.badge).catch(() => {})
    : null;
  event.waitUntil(Promise.all([shown, counted]));
});

/*
 * Tapping a notification goes where it says: to the game, the challenge, the
 * lobby. An app already open is brought forward and told where to go, which
 * keeps whatever it was holding; otherwise it is opened there.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const wanted = (event.notification.data && event.notification.data.url) || './';
  const target = new URL(wanted, self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    /* Every page of the site is the app now — /rules/ and the rest open it
       with a panel over the home screen — so any window of ours can be told
       where to go. */
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus().catch(() => {});
      open.postMessage({ type: 'hx:open', url: target });
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

/*
 * The push service has handed this browser a new address. The page may not be
 * open to tell the server, so the worker does it, with the old address as its
 * credential — it has no session of its own to send.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    let fresh = event.newSubscription;
    if (!fresh && old && old.options) {
      fresh = await self.registration.pushManager.subscribe(old.options).catch(() => null);
    }
    if (!old || !fresh) return;
    await fetch('/api/push/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldEndpoint: old.endpoint, subscription: fresh.toJSON() }),
    }).catch(() => {});
  })());
});
