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
  }
  if (socket.connected) return socket;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connection timed out')), 8000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
  });
  return socket;
}

export function disconnect() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export const isConnected = () => Boolean(socket && socket.connected);

/** Emit and await the server's acknowledgement. Rejects rather than hanging. */
export async function request(event, payload = {}, timeoutMs = 8000) {
  const live = await connect();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    live.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response || { ok: false, error: 'EMPTY_RESPONSE' });
    });
  });
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

/** A shareable link that drops the recipient straight into the room. */
export function inviteLink(code) {
  const url = new URL(location.href);
  url.hash = `#/play?online=1&code=${encodeURIComponent(code)}`;
  return url.toString();
}
