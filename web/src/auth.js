/**
 * Player session.
 *
 * Google Identity Services hands the browser a signed ID token; we pass it to
 * our own server, which verifies it and answers with a Hexaequo session. From
 * then on Google is out of the picture — the app talks to its own API.
 *
 * The access token lives in localStorage rather than a cookie because the API
 * and the app may be served from different origins in development, and because
 * nothing here is a cross-site form target.
 */

import { serverOrigin, identify, isConnected, useSessionToken } from './net.js';

const TOKEN_KEY = 'hexaequo.token';
const REFRESH_KEY = 'hexaequo.refresh';
const GSI_SRC = 'https://accounts.google.com/gsi/client';

/** Filled from the server the first time we ask; null when signed out. */
let account = null;
let needsPseudo = false;
let ready = false;
const listeners = new Set();

export const currentUser = () => account;
export const isSignedIn = () => Boolean(account);
export const mustChoosePseudo = () => Boolean(account && needsPseudo);
export const sessionReady = () => ready;

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * A rating that has just moved.
 *
 * The session carries the number the header shows, and it was only ever filled
 * when the session was fetched — so finishing a rated game left the chip on the
 * old rating while the profile, which asks the server, showed the new one. The
 * same number in two places disagreeing is worse than either being late.
 * Everything that draws it listens for this already.
 */
export function ratingChanged(elo) {
  if (!account || typeof elo !== 'number' || account.elo === elo) return;
  account.elo = elo;
  announce();
}

/* The transport identifies every connection it makes, and this is where it
   gets the token — handed over rather than imported, since net.js must not
   reach back into this module. Registered at load, before any socket exists. */
useSessionToken(() => readToken());

function announce() {
  // Keep an open socket in step with the session, so signing in mid-visit
  // upgrades the connection instead of needing a reconnect. Only when one is
  // already open: browsing the home page should not dial the server.
  if (isConnected()) identify(readToken()).catch(() => {});
  for (const fn of listeners) {
    try { fn(account); } catch { /* a listener must not break sign-in */ }
  }
}

/** The raw session token, for the socket handshake. */
export const sessionToken = () => readToken();

/*
 * "Stay signed in" decides which drawer the session goes in.
 *
 * localStorage outlives the browser, so the account comes back on its own the
 * next time the app is opened. sessionStorage lasts as long as the tab and no
 * longer, which is what someone signing in on a machine that is not theirs is
 * asking for. The choice itself is remembered — the box should be as they left
 * it — and defaults to on, because that was the only behaviour there was
 * before the box existed and nobody should be signed out by an upgrade.
 *
 * Reads look in both, so a session started under one setting survives the
 * setting being changed, and writes clear the other drawer so a token can
 * never be left behind in the one that outlives the tab.
 */
const REMEMBER_KEY = 'hexaequo.remember';

function readFlag(key) {
  try { return localStorage.getItem(key) ?? sessionStorage.getItem(key); } catch { return null; }
}

let remember = readFlag(REMEMBER_KEY) !== '0';

export const staySignedIn = () => remember;

/** Choose where the next session is kept. Moves the current one there too. */
export function setStaySignedIn(on) {
  remember = Boolean(on);
  try { localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0'); } catch { /* no store */ }
  const token = readToken();
  const refresh = readRefresh();
  writeToken(token);
  writeRefresh(refresh);
}

const store = () => (remember ? localStorage : sessionStorage);
const other = () => (remember ? sessionStorage : localStorage);

function put(key, value) {
  try {
    other().removeItem(key);
    if (value) store().setItem(key, value);
    else store().removeItem(key);
  } catch { /* private browsing: the session just will not survive a reload */ }
}

function readToken() { return readFlag(TOKEN_KEY); }
function writeToken(value) { put(TOKEN_KEY, value); }

function readRefresh() { return readFlag(REFRESH_KEY); }
function writeRefresh(value) { put(REFRESH_KEY, value); }

/**
 * Trade the refresh token for a new session.
 *
 * The server has been issuing these all along and the client was throwing them
 * away, so an access token reaching its seventh day signed the player out with
 * no warning and no way back but the sign-in form. Returns whether it worked.
 */
let refreshing = null;
async function refreshSession() {
  const token = readRefresh();
  if (!token) return false;
  // One attempt at a time: several requests failing together must not each
  // spend the token, since the server rotates it away on use.
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const response = await fetch(`${serverOrigin()}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      });
      if (!response.ok) return false;
      const body = await response.json();
      const fresh = body && body.data;
      if (!fresh || !fresh.accessToken) return false;
      writeToken(fresh.accessToken);
      writeRefresh(fresh.refreshToken || null);
      return true;
    } catch {
      return false;                 // offline is not a reason to sign out
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Call the API, attaching the session token when there is one. */
export async function api(path, options = {}, allowRetry = true) {
  const token = readToken();
  const response = await fetch(`${serverOrigin()}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  let body = null;
  try { body = await response.json(); } catch { /* empty or non-JSON body */ }

  if (response.status === 401 && token) {
    /* An access token only lasts a week. Spend the refresh token before
       concluding the session is over — and only once, so a refresh that
       fails cannot loop. */
    if (allowRetry && await refreshSession()) {
      return api(path, options, false);
    }
    // Genuinely over: forget it rather than retrying forever.
    writeToken(null);
    writeRefresh(null);
    account = null;
    announce();
  }
  if (!response.ok) {
    const error = new Error((body && body.message) || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = body && body.error;
    throw error;
  }
  return body;
}

/** Restore the session on start-up, if the stored token is still good. */
export async function restoreSession() {
  if (!readToken()) { ready = true; announce(); return null; }
  try {
    const body = await api('/auth/me');
    account = body.user;
    needsPseudo = Boolean(body.needsPseudo);
  } catch {
    account = null;
  }
  ready = true;
  announce();
  return account;
}

let gsiLoad = null;

/** Load Google's script once. It is the only third-party code on the site. */
function loadGoogleScript() {
  if (gsiLoad) return gsiLoad;
  gsiLoad = new Promise((resolve, reject) => {
    if (window.google && window.google.accounts) return resolve(window.google);
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error('Google script did not initialise')));
    script.onerror = () => reject(new Error('Google is unreachable'));
    document.head.appendChild(script);
  }).catch((error) => { gsiLoad = null; throw error; });
  return gsiLoad;
}

let clientId = null;
let gsiReady = false;

/** The client id is public; the server is the only thing that verifies tokens. */
export async function googleClientId() {
  if (clientId) return clientId;
  const body = await api('/auth/config').catch(() => null);
  clientId = (body && body.googleClientId) || null;
  return clientId;
}

/**
 * Draw Google's own sign-in button into `container`.
 * Google requires its rendered button rather than a look-alike.
 */
export async function renderGoogleButton(container, { theme = 'outline', text = 'signin_with' } = {}) {
  const [google, id] = await Promise.all([loadGoogleScript(), googleClientId()]);
  if (!id) throw new Error('Google sign-in is not configured');

  /* Configure Google's client once and only once.
   *
   * The panel redraws whenever the session changes or a tab is switched, and
   * calling initialize() each time made Google warn that only the last
   * instance would be used — a real hazard, since the callback that completes
   * a sign-in belongs to whichever call ran last. Nothing in the configuration
   * depends on the container, so it never needs repeating. */
  if (!gsiReady) {
    google.accounts.id.initialize({
      client_id: id,
      callback: async (response) => {
        try {
          await completeSignIn(response.credential);
        } catch (error) {
          document.dispatchEvent(new CustomEvent('auth-error', { bubbles: true, detail: error }));
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    gsiReady = true;
  }

  container.innerHTML = '';
  google.accounts.id.renderButton(container, {
    theme, text, size: 'large', shape: 'pill', logo_alignment: 'left',
  });
}

/**
 * Adopt a session the API just issued.
 *
 * Every door answers in the same shape — a token, the account, and whether a
 * nickname is still owed — so there is one place that turns that into being
 * signed in.
 */
function adoptSession(body) {
  writeToken(body.accessToken);
  writeRefresh(body.refreshToken || null);
  account = body.user;
  needsPseudo = Boolean(body.needsPseudo);
  announce();
  return body;
}

/** Create an account with an address and a password. */
export async function signUpWithEmail({ email, pseudo, password }) {
  return adoptSession(await api('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, pseudo, password }),
  }));
}

/** Sign in with an address and a password. */
export async function signInWithEmail({ email, password }) {
  return adoptSession(await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }));
}

/**
 * Ask for a reset link. Always resolves: the API answers the same way whether
 * or not the address is registered, and so does this.
 */
export async function requestPasswordReset(email) {
  await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) })
    .catch(() => {});
  return true;
}

export async function resetPassword(token, newPassword) {
  return api('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
}

export async function confirmEmail(token) {
  return api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
}

/** Exchange Google's credential for our session. */
export async function completeSignIn(credential) {
  return adoptSession(await api('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  }));
}

export async function chooseNickname(pseudo) {
  const body = await api('/auth/pseudo', {
    method: 'PUT',
    body: JSON.stringify({ pseudo }),
  });
  account = body.user;
  needsPseudo = false;
  announce();
  return account;
}

export async function nicknameAvailable(pseudo) {
  return api(`/auth/pseudo-available?pseudo=${encodeURIComponent(pseudo)}`);
}

export function signOut() {
  writeToken(null);
  writeRefresh(null);
  account = null;
  needsPseudo = false;
  if (window.google && window.google.accounts && window.google.accounts.id) {
    window.google.accounts.id.disableAutoSelect();
  }
  announce();
}
