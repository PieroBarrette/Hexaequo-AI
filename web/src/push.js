/**
 * Notifications on this device: asking for them, and keeping the server's
 * record of this device right.
 *
 * Three things have to agree for a notification to arrive here: the browser's
 * permission, a subscription with the browser's push service, and the server
 * knowing which account that subscription belongs to. The switch in the
 * settings stands for all three at once, and this module keeps them in step —
 * when the switch is pressed, at start-up, at sign-in and at sign-out.
 *
 * The wish is kept per device rather than with the account. Permission is a
 * fact about this browser: switching notifications on at home must not claim
 * they are on for a phone that was never asked. Which kinds of notification,
 * on the other hand, is a preference like any other, and follows the account.
 *
 * It also tells the server, over the socket, whether the page is on screen.
 * That is what decides whether news goes to the page or to the phone: somebody
 * looking at Hexaequo is not sent a notification about what is in front of them.
 */

import { api, isSignedIn, onAuthChange } from './auth.js';
import { request, listen } from './net.js';
import { get as getSetting } from './settings.js';

const WANTED_KEY = 'hexaequo.push';

function wanted() {
  try { return localStorage.getItem(WANTED_KEY) === '1'; } catch { return false; }
}

function remember(on) {
  try {
    if (on) localStorage.setItem(WANTED_KEY, '1');
    else localStorage.removeItem(WANTED_KEY);
  } catch { /* private browsing: the wish lasts as long as the page */ }
}

/* iPadOS asks for desktop pages and calls itself a Mac; the touch screen is
   what gives it away. */
const isAppleMobile = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  || navigator.standalone === true;

/**
 * What this browser can do.
 *
 * 'ok' — it can be asked. 'install' — an iPhone or iPad in a Safari tab: Apple
 * only lets a web app have notifications once it is on the Home Screen, so the
 * answer there is how to get it there. 'unsupported' — this browser cannot.
 */
export function support() {
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (capable && window.isSecureContext !== false) return 'ok';
  if (isAppleMobile() && !standalone()) return 'install';
  return 'unsupported';
}

/** 'default' (never asked), 'granted' or 'denied', as the browser has it. */
export const permission = () => ('Notification' in window ? Notification.permission : 'denied');

let keyRequest = null;

/** The server's public key, or null when the server has none to offer. */
function serverKey() {
  if (!keyRequest) {
    keyRequest = api('/push/key')
      .then((body) => (body && body.enabled && body.publicKey ? body.publicKey : null))
      .catch(() => { keyRequest = null; return null; });
  }
  return keyRequest;
}

/** The worker, once there is one; null where none ever registers. */
function worker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
  ]);
}

function keyBytes(base64url) {
  const padded = base64url + '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/* A subscription made with another key — before the server's keys were
   changed — would be refused by every push service; it has to be replaced
   rather than reused. Browsers that do not say which key they used are taken
   at their word. */
function madeWith(subscription, key) {
  const used = subscription.options && subscription.options.applicationServerKey;
  if (!used) return true;
  const a = new Uint8Array(used);
  const b = keyBytes(key);
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** This browser's subscription; made if `create` and there is none. */
async function currentSubscription(create = false) {
  const registration = await worker();
  if (!registration || !registration.pushManager) return null;
  let subscription = await registration.pushManager.getSubscription();
  if (!create) return subscription;
  const key = await serverKey();
  if (!key) return null;
  if (subscription && !madeWith(subscription, key)) {
    await subscription.unsubscribe().catch(() => {});
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    });
  }
  return subscription;
}

function zone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

/** Tell the server this browser is the signed-in account's. */
async function register() {
  const subscription = await currentSubscription(true);
  if (!subscription) {
    const error = new Error('no subscription');
    error.code = 'UNAVAILABLE';
    throw error;
  }
  await api('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      timeZone: zone(),
      language: getSetting('language'),
    }),
  });
  return subscription;
}

function forget(subscription) {
  return api('/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {});
}

/* Safari still answers through a callback; everyone else returns a promise. */
function askPermission() {
  return new Promise((resolve) => {
    const answer = Notification.requestPermission((value) => resolve(value));
    if (answer && typeof answer.then === 'function') answer.then(resolve, () => resolve('default'));
  });
}

/**
 * Switch notifications on for this device.
 *
 * Must be called straight from the tap that asked for it, with nothing awaited
 * before: Safari and Firefox only show their question inside a gesture, and a
 * question that never appears reads as a switch that does nothing.
 */
export async function enable() {
  if (support() !== 'ok') return { ok: false, error: 'UNSUPPORTED' };
  const answer = await askPermission();
  if (answer !== 'granted') return { ok: false, error: answer === 'denied' ? 'DENIED' : 'DISMISSED' };
  remember(true);
  if (!isSignedIn()) return { ok: false, error: 'SIGN_IN_REQUIRED' };
  try {
    await register();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.code || 'FAILED' };
  }
}

/** Switch them off for this device: the server forgets it, and so does the push service. */
export async function disable() {
  remember(false);
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) return { ok: true };
  await forget(subscription);
  await subscription.unsubscribe().catch(() => {});
  return { ok: true };
}

/** Ask the server for a notification to this device, a few seconds from now. */
export async function sendTest() {
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) return { ok: false, error: 'NOT_REGISTERED' };
  const ask = () => api('/push/test', {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  try {
    await ask();
    return { ok: true };
  } catch (error) {
    /* The server has lost track of this device — a database restored, an
       account switched elsewhere. Tell it again, once, and retry. */
    if (error.code === 'NOT_REGISTERED') {
      try {
        await register();
        await ask();
        return { ok: true };
      } catch { /* fall through */ }
    }
    return { ok: false, error: error.code || 'FAILED' };
  }
}

/**
 * Everything the settings screen needs to draw the switch truthfully.
 *
 * `on` is the three agreeing: asked for here, allowed by the browser, and a
 * subscription in place — with somebody signed in to address it to.
 */
export async function deviceState() {
  const state = {
    support: support(),
    permission: permission(),
    signedIn: isSignedIn(),
    available: false,
    on: false,
  };
  if (state.support !== 'ok') return state;
  state.available = Boolean(await serverKey());
  if (!state.available) return state;
  const subscription = await currentSubscription().catch(() => null);
  state.on = Boolean(subscription) && state.permission === 'granted' && wanted() && state.signedIn;
  return state;
}

/* ── Keeping it in step ─────────────────────────────────────────────────── */

const looking = () => document.visibilityState === 'visible';

/** Say whether this page is on screen. Only a signed-in page has anybody to say it for. */
function reportVisibility() {
  if (!isSignedIn()) return;
  request('hx:visible', { visible: looking() }, 4000).catch(() => {});
}

/*
 * Back in the app, whatever was announced has been seen: the number comes off
 * the icon and the notifications still standing in the tray are put away.
 */
async function caughtUp() {
  if (!looking()) return;
  if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  const registration = await worker().catch(() => null);
  if (!registration || !registration.getNotifications) return;
  const shown = await registration.getNotifications().catch(() => []);
  for (const notification of shown) notification.close();
}

let lastUserId;
let listening = false;

/** Start keeping this device in step with the session. Call once, at start-up. */
export function startPush() {
  onAuthChange(async (user) => {
    const id = user ? user.id : null;
    if (id === lastUserId) return;
    const was = lastUserId;
    lastUserId = id;

    if (id) {
      if (!listening) {
        listening = true;
        /* A new connection is a new socket to the server, which knows
           nothing of the last one's answer. */
        listen('connect', reportVisibility);
      }
      reportVisibility();
      /* Signed in on a device that asked for notifications: make sure the
         server has it down as this account's — it may be the first time, or
         somebody else may have been signed in here before. */
      if (support() === 'ok' && wanted() && permission() === 'granted') register().catch(() => {});
      return;
    }
    /* Signed out: the account's news must stop arriving on a device it is no
       longer signed in to. The wish stays, so signing back in picks it up. */
    if (was && support() === 'ok') {
      const subscription = await currentSubscription().catch(() => null);
      if (subscription) forget(subscription);
    }
  });

  document.addEventListener('visibilitychange', () => {
    reportVisibility();
    caughtUp();
  });
  /* A page being put away for good — the app swiped off, the tab closed —
     does not always say "hidden" first. */
  window.addEventListener('pagehide', () => {
    if (isSignedIn()) request('hx:visible', { visible: false }, 2000).catch(() => {});
  });
  caughtUp();
}
