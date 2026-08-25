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

import { serverOrigin, identify, isConnected } from './net.js';

const TOKEN_KEY = 'hexaequo.token';
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

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function writeToken(value) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private browsing: the session just will not survive a reload */ }
}

/** Call the API, attaching the session token when there is one. */
export async function api(path, options = {}) {
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
    // The session died: forget it rather than retrying forever.
    writeToken(null);
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
  account = null;
  needsPseudo = false;
  if (window.google && window.google.accounts && window.google.accounts.id) {
    window.google.accounts.id.disableAutoSelect();
  }
  announce();
}
