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

/*
 * On a development machine the worker caches nothing and steps in at once.
 *
 * It used to be kept off localhost altogether, because a cache-first worker
 * there serves yesterday's modules after every edit. But notifications cannot
 * arrive without a worker, so now it is registered everywhere and, here, does
 * only that: every request goes to the network as if it were not there.
 */
const DEVELOPMENT = /^(localhost|127.d+.d+.d+|[::1])$/.test(self.location.hostname);

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
  /* The analysis worker and the arithmetic it feeds. The worker pulls in the
     game modules above, which are already here. */
  './src/game/accuracy.js',
  './src/game/analysisWorker.js',
  './src/presence.js',
  './src/progress.js',
  './src/push.js',
  './src/settingsSync.js',
  './src/ui/challenge.js',
  './src/ui/emoji.js',
  './src/ui/qr.js',
  './src/views/lobby.js',
  './src/views/mailAction.js',
  './src/views/profile.js',
  './styles/page.css',
  // Sound is synthesised in audio.js; there is nothing left to download.
];

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
    /* The app itself, not any page of the site: the static pages under
       /rules/ or /fr/ have no router to hear where to go. */
    const scope = new URL(self.registration.scope).pathname;
    const open = windows.find((client) => {
      const url = new URL(client.url);
      return url.origin === self.location.origin
        && (url.pathname === scope || url.pathname === `${scope}index.html`);
    });
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
