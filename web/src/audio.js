/**
 * Sound effects. Files are decoded once into an AudioContext buffer so that
 * repeated captures in a jump chain can overlap without cutting each other off.
 *
 * Browsers refuse to start audio before a user gesture, so the context is
 * created lazily on the first interaction and the whole module degrades to a
 * no-op if anything is unavailable.
 */

import { get as getSetting } from './settings.js';

const FILES = {
  tilePlacement: 'tile_placement.mp3',
  piecePlacement: 'piece_placement.mp3',
  move: 'move.mp3',
  capture: 'capture.mp3',
  gameEnd: 'game_end.mp3',
  ui: 'button_click.mp3',
};

const buffers = Object.create(null);
let context = null;
let master = null;
let unlocked = false;

function baseUrl(file) {
  return new URL(`../assets/sounds/${file}`, import.meta.url).href;
}

async function ensureContext() {
  if (context) return context;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  master = context.createGain();
  master.gain.value = getSetting('volume');
  master.connect(context.destination);
  return context;
}

async function decode(name) {
  if (buffers[name]) return buffers[name];
  const ctx = await ensureContext();
  if (!ctx) return null;
  try {
    const response = await fetch(baseUrl(FILES[name]));
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    buffers[name] = await ctx.decodeAudioData(bytes);
    return buffers[name];
  } catch {
    return null;
  }
}

/** Called on the first pointer or key event so playback is allowed afterwards. */
export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  ensureContext().then((ctx) => {
    if (ctx && ctx.state === 'suspended') ctx.resume();
    // Warm the two most frequent sounds so the first move is not silent.
    decode('move');
    decode('ui');
  });
}

export function setVolume(value) {
  if (master) master.gain.value = value;
}

/** Play a named effect. `delay` is in milliseconds, for chained captures. */
export async function play(name, delay = 0) {
  if (!getSetting('sound') || !FILES[name]) return;
  const buffer = await decode(name);
  if (!buffer || !context) return;
  if (context.state === 'suspended') { try { await context.resume(); } catch { return; } }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(master);
  source.start(context.currentTime + Math.max(0, delay) / 1000);
}
