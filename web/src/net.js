/**
 * Connection to the game server.
 *
 * In production the backend serves this app, so the socket lives on the same
 * origin and nothing needs configuring. In development the app is served by
 * serve.py on 8001 while the backend listens on 3001, so the origin is guessed
 * and can be overridden with ?api=http://host:port for anything unusual.
 *
 * The socket.io client is loaded from the server itself rather than bundled:
 * it is guaranteed to match the server's version, and there is still no build
 * step.
 */

const DEV_BACKEND_PORT = '3001';

/** Where the API and websocket live. */
export function serverOrigin() {
  const override = new URLSearchParams(location.search).get('api');
  if (override) return override.replace(/\/$/, '');
  // Served by the backend itself: same origin.
  if (location.port !== '8001' && location.port !== '8765') return location.origin;
  return `${location.protocol}//${location.hostname}:${DEV_BACKEND_PORT}`;
}

let clientLoad = null;

function loadClientLibrary() {
  if (clientLoad) return clientLoad;
  clientLoad = new Promise((resolve, reject) => {
    if (window.io) return resolve(window.io);
    const script = document.createElement('script');
    script.src = `${serverOrigin()}/socket.io/socket.io.js`;
    script.async = true;
    script.onload = () => (window.io ? resolve(window.io) : reject(new Error('socket.io did not load')));
    script.onerror = () => reject(new Error('socket.io is unreachable'));
    document.head.appendChild(script);
  }).catch((error) => {
    clientLoad = null;              // allow a later retry
    throw error;
  });
  return clientLoad;
}

let socket = null;

/** Connect, or return the live connection. */
export async function connect() {
  if (socket && socket.connected) return socket;
  const io = await loadClientLibrary();
  if (!socket) {
    socket = io(serverOrigin(), {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    /* A new connection is a new socket to the server, whatever this object is
       called on our side — so whoever it was told, it has not been told yet. */
    socket.on('connect', forgetIdentity);
    socket.on('disconnect', forgetIdentity);
    watchForWaking();
  }
  if (socket.connected) return socket;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connection timed out')), 8000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
  });
  return socket;
}

/*
 * Coming back to the app.
 *
 * A phone that goes to sleep, or a tab left in the background, has its timers
 * throttled and its connection closed underneath it. socket.io reconnects on a
 * timer — and that timer is the very thing that was throttled, so returning to
 * a game could mean standing in front of it waiting a minute for a connection
 * while the other player's grace countdown runs down. Reloading the page made
 * a new socket and hid the problem, which is why it looked like a page that
 * needed refreshing.
 *
 * Worse, a socket can be left believing it is connected when the connection is
 * gone: the operating system took the TCP session and no close event ever
 * fired. Nothing arrives, nothing fails, and the game simply sits there.
 *
 * So the moment the page is looked at again the connection is poked. Down: dial
 * at once rather than waiting for the next retry. Up: made to prove it, and
 * replaced if it cannot. Three events because no single one of them fires
 * everywhere — a tab being shown, a window being focused, a network coming
 * back — and doing this twice costs a round trip.
 */
const WAKE_PROOF_MS = 3000;
let watchingForWaking = false;
let proving = false;

function wake() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (!socket) return;
  if (!socket.connected) {
    forgetIdentity();
    socket.connect();
    return;
  }
  if (proving) return;
  proving = true;
  let answered = false;
  const timer = setTimeout(() => {
    proving = false;
    if (answered || !socket) return;
    /* It said it was connected and could not show it. Take it down so the
       reconnection everything already listens for actually happens. */
    forgetIdentity();
    socket.disconnect();
    socket.connect();
  }, WAKE_PROOF_MS);
  socket.emit('hx:ping', {}, () => {
    answered = true;
    proving = false;
    clearTimeout(timer);
  });
}

function watchForWaking() {
  if (watchingForWaking || typeof document === 'undefined') return;
  watchingForWaking = true;
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
}

export function disconnect() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export const isConnected = () => Boolean(socket && socket.connected);

function ask(live, event, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    live.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response || { ok: false, error: 'EMPTY_RESPONSE' });
    });
  });
}

/*
 * The socket carries who you are, and carries it again after every reconnect.
 *
 * A socket knows nothing until it is told, and hx:identify is the telling. That
 * used to be each view's errand, run once when the view was built — so a
 * connection that dropped and came back was anonymous to the server while the
 * page still showed you signed in. You stayed listed in the lobby, green light
 * and all, from the entry the old socket had left behind, and challenging
 * somebody came back "sign in first" from a socket that had never been told
 * your name.
 *
 * The transport owns it now: a connection identifies itself, and every request
 * waits for that to have happened. Nothing above this layer has to remember,
 * and there is no window between arriving and being known.
 *
 * The token arrives through a function auth.js hands over rather than an
 * import: auth.js already imports this module, and the two must not reach for
 * each other.
 */
let readSessionToken = () => null;
let identified = null;          // a promise while identifying, else null

export function useSessionToken(fn) {
  readSessionToken = typeof fn === 'function' ? fn : (() => null);
}

/** Forget what this socket was told, so the next request says it again. */
export function forgetIdentity() { identified = null; }

/*
 * A refusal is not a settlement.
 *
 * This used to await the answer and throw it away, so a socket that asked to
 * be identified and was told no counted as identified for the rest of its
 * life. The server refuses for one reason that will never change — the token
 * is not signed by us, or the account behind it is gone — and for one that
 * changes by itself: it could not read the profile just then. Treating the
 * second like the first is how somebody came to be standing in the lobby
 * without their own name in the list, on a connection the server had never
 * been told about, with nothing to do about it but reload the page.
 *
 * So a token that was offered and not accepted for a reason that might pass
 * leaves the socket unsettled, and the next request over it asks again. Every
 * request is a chance to repair the connection, which is what makes clicking
 * anywhere at all put it right.
 *
 * A bad token is left settled on purpose: it will not become good by being
 * asked about on every request, and a new one arrives through identify()
 * below, which clears this first.
 */
function settleIdentity(live) {
  if (identified) return identified;
  identified = (async () => {
    const token = readSessionToken() || null;
    try {
      const answer = await ask(live, 'hx:identify', { token }, 5000);
      const refused = !(answer && answer.ok);
      const permanent = answer && answer.error === 'BAD_TOKEN';
      if (token && refused && !permanent) identified = null;
    } catch {
      /* Unreachable: the socket stays anonymous, which still plays. Cleared so
         the next request asks again rather than trusting this. */
      identified = null;
    }
  })();
  return identified;
}

/** Emit and await the server's acknowledgement. Rejects rather than hanging. */
export async function request(event, payload = {}, timeoutMs = 8000) {
  const live = await connect();
  // Never for hx:identify itself, which is the thing being waited on.
  if (event !== 'hx:identify') await settleIdentity(live);
  return ask(live, event, payload, timeoutMs);
}

/** Subscribe to a server event; returns an unsubscribe function. */
export function listen(event, handler) {
  let attached = null;
  connect().then((live) => {
    attached = live;
    live.on(event, handler);
  }).catch(() => { /* the caller surfaces connection failures */ });
  return () => {
    if (attached) attached.off(event, handler);
  };
}

/*
 * A key for the seat, kept by the tab.
 *
 * A socket is how the server knows a player, and a socket does not survive a
 * sleeping phone. The account does, but a guest has none -- so each tab makes
 * itself a key, sends it with every seat it takes, and offers it again when it
 * comes back on a new connection: the server hands the seat over to whichever
 * connection holds the key. Never shown, never guessable, and worth nothing
 * outside the games it was used in. Kept per tab rather than per browser so
 * that two tabs are two players, which is what they look like to whoever is
 * opposite.
 */
const SEAT_KEY = 'hexaequo.seatKey';
let seatKey = null;

export function rejoinKey() {
  if (seatKey) return seatKey;
  try { seatKey = sessionStorage.getItem(SEAT_KEY); } catch { /* no store */ }
  if (!seatKey) {
    seatKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem(SEAT_KEY, seatKey); } catch { /* as long as the page lasts */ }
  }
  return seatKey;
}

/** A shareable link that drops the recipient straight into the room. */
export function inviteLink(code) {
  const url = new URL(location.href);
  url.hash = `#/play?online=1&code=${encodeURIComponent(code)}`;
  return url.toString();
}

/**
 * Say who is on this socket, now.
 *
 * Signing in or out mid-session changes the answer, so the old one is dropped
 * before asking again — otherwise the socket would keep the name it was given
 * when the page loaded. Connecting no longer needs this: the transport
 * identifies itself and every request waits for it. An unidentified socket
 * still plays; its games are simply unrated.
 */
export async function identify(token) {
  forgetIdentity();
  try {
    return await request('hx:identify', { token: token || null }, 5000);
  } catch {
    return { ok: false, error: 'OFFLINE' };
  }
}
