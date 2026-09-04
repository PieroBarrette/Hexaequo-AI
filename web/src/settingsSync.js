/**
 * Settings that follow the account rather than the machine.
 *
 * Signed out, preferences live in localStorage and belong to the browser, which
 * is right: there is nobody to attach them to. Signing in changes what they
 * are — the account's, not this device's — so the account's copy is what wins,
 * and every later change is written back to it. Sign in on a phone and the
 * board looks the way it does at home.
 *
 * A separate module from settings.js on purpose: that one is a plain local
 * store with no idea the network exists, and importing auth from it would tie
 * a knot between the two.
 */

import { DEFAULTS, getSettings, set } from './settings.js';
import { api, isSignedIn, onAuthChange, currentUser } from './auth.js';

/* Everything the app owns, minus its own bookkeeping. aiLevelsVersion records
   whether *this* copy has applied a one-off shift to a stored level; it is a
   note about a migration, not a preference, and carrying it between machines
   would let one device tell another that a migration it never ran is done. */
const KEYS = Object.keys(DEFAULTS).filter((name) => name !== 'aiLevelsVersion');
const WRITE_DELAY_MS = 600;

/* Set while the account's own values are being applied, so writing them into
   the local store does not bounce straight back to the server. */
let applying = false;
let writeTimer = 0;
let pending = null;
let lastUserId = null;

/** Only the keys this app owns: the column carries older, unrelated ones. */
function ours(stored) {
  const out = {};
  if (!stored || typeof stored !== 'object') return out;
  for (const key of KEYS) {
    if (Object.prototype.hasOwnProperty.call(stored, key)) out[key] = stored[key];
  }
  return out;
}

/**
 * Take the account's settings, or give it ours if it has none yet.
 *
 * The first device to sign in seeds the account; every one after that adopts
 * what is already there. Anything the account does not carry is left as it is
 * on this machine rather than reset to a default nobody chose.
 */
async function adopt() {
  let stored;
  try {
    const body = await api('/users/me/settings');
    stored = ours(body && body.data);
  } catch {
    return;                       // offline: the local copy is still fine
  }

  if (!Object.keys(stored).length) {
    push(getSettings());          // nothing up there yet: this device seeds it
    return;
  }

  applying = true;
  try {
    for (const [key, value] of Object.entries(stored)) {
      if (value !== undefined) set(key, value);
    }
  } finally {
    applying = false;
  }
}

/** Write to the account, coalescing a flurry of changes into one request. */
function push(values) {
  pending = { ...(pending || {}), ...ours(values) };
  clearTimeout(writeTimer);
  writeTimer = setTimeout(async () => {
    const body = pending;
    pending = null;
    if (!body || !isSignedIn()) return;
    try {
      await api('/users/me/settings', { method: 'PATCH', body: JSON.stringify(body) });
    } catch { /* the next change tries again; the local copy is unaffected */ }
  }, WRITE_DELAY_MS);
}

/** Start following the account. Call once, at start-up. */
export function startSettingsSync(onSettingsChange) {
  onSettingsChange((name, value) => {
    if (applying || !isSignedIn()) return;
    if (!KEYS.includes(name)) return;
    push({ [name]: value });
  });

  onAuthChange(() => {
    const user = currentUser();
    const id = user ? user.id : null;
    if (id === lastUserId) return;      // the same session, said twice
    lastUserId = id;
    if (id) adopt();
    /* Signing out leaves the settings where they are: they are this device's
       again, and taking them away would be a surprise, not a safeguard. */
  });
}
