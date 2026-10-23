/**
 * Player session.
 *
 * An address and a password are the only way in: signing up, signing in, and
 * following the link a forgotten password sends all answer with a Hexaequo
 * session, adopted in one place below. (Google sign-in was offered until
 * 2026-10-20; the accounts it made get a password through that same link.)
 *
 * The access token lives in localStorage rather than a cookie because the API
 * and the app may be served from different origins in development, and because
 * nothing here is a cross-site form target.
 */

import { serverOrigin, identify, isConnected, useSessionToken, forgetIdentity } from './net.js';

const TOKEN_KEY = 'hexaequo.token';
const REFRESH_KEY = 'hexaequo.refresh';

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

/**
 * The rating to print for a user — one number per account, wherever it shows.
 *
 * A rating reaches the page from several directions: a seat the server filled
 * when the game began, a lobby roster, a leaderboard row, a profile. Each of
 * those is a snapshot of the moment it was sent, and for anybody else that is
 * the only truth there is.
 *
 * For the person reading the page it is not. Their own rating changes under
 * them the instant a rated game ends, and every copy in a payload that was
 * already delivered goes stale at once — which is how the header came to say
 * one number while the name beside the board said another, both of them about
 * the same account on the same screen. Anything that prints a rating asks
 * here, and gets the live one for the account signed in.
 */
export function ratingFor(userId, fallback) {
  if (account && userId && account.id === userId && typeof account.elo === 'number') {
    return account.elo;
  }
  return fallback;
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
      /* The socket was told the old token and may have been refused for it —
         and a refusal for a bad token is deliberately not retried, so it would
         have stayed anonymous with a good token sitting in the drawer. Tell it
         the new one, or mark it as needing to ask again when it next speaks. */
      if (isConnected()) identify(fresh.accessToken).catch(() => {});
      else forgetIdentity();
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
/**
 * Is the access token past its date?
 *
 * Reading a JWT's expiry without verifying it is safe here, because nothing is
 * being trusted: the server verifies, and this only decides whether to bother
 * asking. An access token lasts a week, so once a week every signed-in visitor
 * loaded the page, had /auth/me answer 401, spent the refresh token and tried
 * again. That works — and it also prints a red failed request in the console
 * of somebody who is plainly signed in, which is alarming and was reported as
 * a bug. Asking for a new one first is the same number of requests and none of
 * the alarm.
 */
function tokenExpired(token) {
  try {
    const payload = String(token).split('.')[1];
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (!claims || typeof claims.exp !== 'number') return false;
    // A minute of margin, so one that dies in flight is not sent either.
    return Date.now() >= claims.exp * 1000 - 60000;
  } catch {
    return false;                 // unreadable: let the server be the judge
  }
}

export async function api(path, options = {}, allowRetry = true) {
  let token = readToken();
  if (token && allowRetry && readRefresh() && tokenExpired(token)) {
    if (await refreshSession()) token = readToken();
  }
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

/*
 * Restore the session on start-up, if the stored token is still good.
 *
 * Only the server can say a session is over, and it says so with a 401 -- which
 * api() answers by throwing the token away -- or a 404, the account behind it
 * being gone. Every other failure is the server not being reachable just then:
 * asleep and waking up, a proxy answering 502 while the process starts, a phone
 * between two networks. This used to treat those as "signed out" too, once, and
 * never ask again. So the page said "sign in" over a lobby that listed the same
 * person as online: the socket had reached the server a moment later, offered
 * the same token, and been recognised. Two sources of truth about who you are,
 * and only one of them retried.
 *
 * Now a failure that is not an answer is asked again, with a growing pause and
 * at once when the network comes back, until it is answered one way or the
 * other. Until then the session is not "signed out", it is not yet known --
 * sessionReady() says so, and everything that draws the account waits rather
 * than guessing.
 */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 15000;
let restoring = null;

/** Whether a failed request may succeed if asked again in a moment. */
function transient(error) {
  const status = error && error.status;
  if (!status) return true;                        // the network, not the server
  return status >= 500 || status === 408 || status === 429;
}

function pause(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      if (typeof window !== 'undefined') window.removeEventListener('online', done);
      resolve();
    }
    // Back on the network is the moment to ask, not the end of the pause.
    if (typeof window !== 'undefined') window.addEventListener('online', done);
  });
}

export function restoreSession() {
  if (restoring) return restoring;
  /* Cleared in a finally rather than inside restore(): with no token the whole
     of restore() runs before this assignment does, and a clearing written in
     there was overwritten by the very promise it had just cleared. */
  restoring = restore().finally(() => { restoring = null; });
  return restoring;
}

async function restore() {
  let delay = RETRY_FIRST_MS;
  for (;;) {
    /* Read each time round: signing out mid-wait ends it, and a refresh that
       happened meanwhile is picked up rather than retried with the old one. */
    if (!readToken()) { account = null; break; }
    try {
      const body = await api('/auth/me');
      account = body.user;
      needsPseudo = Boolean(body.needsPseudo);
      break;
    } catch (error) {
      if (transient(error)) {
        await pause(delay);
        delay = Math.min(delay * 2, RETRY_MAX_MS);
        continue;
      }
      /* An answer. 401 has already had the token thrown away by api(); an
         account that no longer exists gets the same, so the socket stops
         offering a token nobody can honour. */
      if (error.status === 404) { writeToken(null); writeRefresh(null); }
      account = null;
      break;
    }
  }
  ready = true;
  announce();
  return account;
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

/**
 * Choose a new password from the link in the mail, and be signed in by it.
 *
 * The link has already proved the address, so asking for the password again
 * on the sign-in form proved nothing; the server answers with a session.
 */
export async function resetPassword(token, newPassword) {
  return adoptSession(await api('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  }));
}

export async function confirmEmail(token) {
  return api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
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

/*
 * Signing out ends the session on the server, not only in this browser.
 *
 * Forgetting the tokens here used to be all of it, and the refresh token went
 * on working for its thirty days: whoever had a copy of it could keep trading
 * it for fresh sessions long after its owner had signed out. Now the server
 * is told to delete it.
 *
 * Sent as it is rather than through api(), which may first spend this very
 * token on a new pair when the access token has run out -- and the new one
 * would be left alive. Not awaited: signing out never waits on the network.
 * Offline, the message is lost and the token just runs its course. The access
 * token cannot be taken back by anyone; it expires on its own within a week.
 */
function endSessionOnServer(refreshToken) {
  if (!refreshToken) return;
  fetch(`${serverOrigin()}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  }).catch(() => { /* offline: nothing more to be done from here */ });
}

export function signOut() {
  endSessionOnServer(readRefresh());
  writeToken(null);
  writeRefresh(null);
  account = null;
  needsPseudo = false;
  announce();
}
