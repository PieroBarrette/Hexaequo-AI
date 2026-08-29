/**
 * Who is on the site, and whether they are free.
 *
 * Three answers: `free` — signed in with the site open and not at a board;
 * `playing` — here, but in the middle of a game; `offline` — not here. The
 * light beside a name is that answer, and the challenge button reads it too.
 *
 * The server keeps one watch list per socket, so this module owns the union of
 * what every screen has asked for: a page watching one player and a lobby
 * watching twenty must not overwrite each other. Each caller gets back a
 * release function; the union is re-sent whenever it changes.
 */

import { request, listen, isConnected } from './net.js';

/** token → the ids that caller cares about. */
const claims = new Map();
const statuses = new Map();
const listeners = new Set();
let nextToken = 1;
let subscribed = false;

/** The last answer we had for this account. Unknown reads as offline. */
export const presenceOf = (userId) => statuses.get(userId) || 'offline';

/** Be told when any watched account's light changes. */
export function onPresence(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(changed) {
  for (const fn of listeners) {
    try { fn(changed); } catch { /* one bad listener must not stop the rest */ }
  }
}

function union() {
  const all = new Set();
  for (const ids of claims.values()) for (const id of ids) all.add(id);
  return [...all];
}

/**
 * Tell the server the whole list again.
 *
 * Sent as a set rather than as additions, because that is what the server
 * stores: a socket watches exactly these, and nothing lingers from a screen
 * that has since been left.
 */
async function push() {
  const ids = union();
  try {
    if (!subscribed) {
      subscribed = true;
      /* A dropped connection loses the watch list with the socket it was on. */
      listen('connect', () => { if (claims.size) push(); });
      listen('hx:presence', (payload) => {
        const incoming = (payload && payload.statuses) || {};
        const changed = [];
        for (const [id, status] of Object.entries(incoming)) {
          if (statuses.get(id) === status) continue;
          statuses.set(id, status);
          changed.push(id);
        }
        if (changed.length) announce(changed);
      });
    }
    const response = await request('hx:presence:watch', { userIds: ids });
    if (!response || !response.ok) return;
    const changed = [];
    for (const [id, status] of Object.entries(response.statuses || {})) {
      if (statuses.get(id) === status) continue;
      statuses.set(id, status);
      changed.push(id);
    }
    /* Anything no longer watched is no longer known; saying so is better than
       keeping a light that has stopped being maintained. */
    for (const id of [...statuses.keys()]) {
      if (!ids.includes(id)) statuses.delete(id);
    }
    if (changed.length) announce(changed);
  } catch { /* offline: every light stays as it was, which reads as unknown */ }
}

/**
 * Watch these accounts until the returned function is called.
 * @param {string[]} userIds
 * @returns {() => void} release
 */
export function watchPresence(userIds) {
  const token = nextToken++;
  claims.set(token, new Set((userIds || []).filter(Boolean).map(String)));
  push();
  return () => {
    if (!claims.delete(token)) return;
    push();
  };
}


/** True when the socket is up, so a screen can say "unknown" rather than lie. */
export const presenceLive = () => isConnected();
