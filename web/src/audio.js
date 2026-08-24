/**
 * Sound, synthesised.
 *
 * Nothing here is a recording. Every effect is built from oscillators, a noise
 * buffer and envelopes, which buys three things worth having: no download, no
 * two sounds that were mastered at different levels by different people, and a
 * palette that can follow the board's material — a knock of wood in Classic,
 * struck stone and glass in Modern.
 *
 * The one rule that matters on a phone: this must never stop the music someone
 * already had playing. `navigator.audioSession.type = 'ambient'` is what says
 * so — mix with others, and stay quiet when the ringer switch is off. Without
 * it, iOS treats a Web Audio context as playback and pauses whatever else is
 * going.
 *
 * Browsers refuse to start audio before a gesture, so the context is created
 * lazily on the first interaction, and the whole module degrades to a no-op if
 * anything is unavailable.
 */

import { get as getSetting } from './settings.js';

let context = null;
let master = null;
let noiseBuffer = null;
let unlocked = false;

/* ── Materials ──────────────────────────────────────────────────────────── */

/*
 * Two voices for the same six events.
 *
 * `body` is the pitch of the struck object, `ring` how long it keeps sounding,
 * `bright` how much of the strike is heard as noise rather than tone, and
 * `partial` the inharmonic overtone that separates a bell from a drum.
 */
const MATERIALS = {
  classic: {                    // seasoned wood: low, dry, warm
    body: 210, ring: 0.13, bright: 0.55, partial: 2.4, tone: 'triangle',
    cut: 2600, chord: [392, 494, 587],          // G B D, a warm major
  },
  modern: {                     // stone and glass: higher, clearer, longer
    body: 430, ring: 0.42, bright: 0.32, partial: 3.7, tone: 'sine',
    cut: 7000, chord: [523.25, 659.25, 830.61], // C E G#, brighter and open
  },
};

const material = () => MATERIALS[getSetting('boardStyle')] || MATERIALS.modern;

/* ── Plumbing ───────────────────────────────────────────────────────────── */

/**
 * Ask the platform to mix with other audio rather than take it over.
 *
 * Safari 16.4 and later honour this; everywhere else it is simply absent, and
 * Web Audio already mixes.
 */
function askToMix() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'ambient';
  } catch { /* the property is read-only on some builds; nothing is lost */ }
}

function ensureContext() {
  if (context) return context;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  askToMix();
  context = new Ctor({ latencyHint: 'interactive' });
  master = context.createGain();
  master.gain.value = getSetting('volume');
  master.connect(context.destination);

  /* A third of a second of white noise, made once. Every strike takes a slice
     of it, which is far cheaper than filling a buffer per sound. */
  const frames = Math.floor(context.sampleRate * 0.35);
  noiseBuffer = context.createBuffer(1, frames, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  return context;
}

/** A gain node whose level falls from `peak` to silence over `seconds`. */
function envelope(at, peak, seconds, attack = 0.002) {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  return gain;
}

/**
 * A struck tone: one partial of the object that was hit.
 *
 * Real struck things drop in pitch as they settle, which is most of what makes
 * a synthesised knock sound like an object rather than a beep.
 */
function strike(at, { freq, peak, decay, type = 'sine', bend = 0.94 }) {
  const osc = context.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), at + decay);
  const gain = envelope(at, peak, decay);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + decay + 0.02);
}

/** The transient: the short scrape of contact, before the object rings. */
function transient(at, { peak, decay, cut, highpass = 0 }) {
  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  source.playbackRate.value = 0.8 + Math.random() * 0.4;

  let node = source;
  if (highpass) {
    const hp = context.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = highpass;
    node = node.connect(hp);
  }
  const lp = context.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(cut, at);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, cut * 0.35), at + decay);

  const gain = envelope(at, peak, decay, 0.001);
  node.connect(lp).connect(gain).connect(master);
  source.start(at, Math.random() * 0.2, decay + 0.05);
}

/* ── The six sounds ─────────────────────────────────────────────────────── */

/*
 * Each one is the same gesture in both materials, with the material's own
 * pitch, brightness and ring. They are deliberately close in level: a capture
 * should feel weightier than a placement without being louder in a way that
 * makes someone reach for the volume.
 */
const VOICES = {
  /** A tile laid flat: the heaviest, lowest contact. */
  tilePlacement(at) {
    const m = material();
    transient(at, { peak: 0.30 * m.bright, decay: 0.05, cut: m.cut * 0.55 });
    strike(at, { freq: m.body * 0.62, peak: 0.34, decay: m.ring * 1.5, type: m.tone, bend: 0.86 });
    strike(at + 0.004, { freq: m.body * 1.5, peak: 0.10, decay: m.ring * 0.5, type: 'sine' });
  },

  /** A piece set down on a tile: lighter, a touch higher. */
  piecePlacement(at) {
    const m = material();
    transient(at, { peak: 0.22 * m.bright, decay: 0.035, cut: m.cut * 0.8 });
    strike(at, { freq: m.body * 1.12, peak: 0.28, decay: m.ring, type: m.tone });
    strike(at + 0.003, { freq: m.body * m.partial, peak: 0.07, decay: m.ring * 0.55, type: 'sine' });
  },

  /** A piece sliding to the next cell: the quietest thing in the game. */
  move(at) {
    const m = material();
    transient(at, { peak: 0.13 * m.bright, decay: 0.03, cut: m.cut * 0.7, highpass: 300 });
    strike(at, { freq: m.body * 0.92, peak: 0.19, decay: m.ring * 0.7, type: m.tone });
  },

  /** Taking a piece: a harder contact, and something falling away under it. */
  capture(at) {
    const m = material();
    transient(at, { peak: 0.34 * m.bright, decay: 0.06, cut: m.cut });
    strike(at, { freq: m.body * 1.45, peak: 0.30, decay: m.ring * 1.2, type: m.tone, bend: 0.8 });
    strike(at + 0.012, { freq: m.body * m.partial, peak: 0.16, decay: m.ring * 1.6, type: 'sine' });
    // The captured piece leaving the board, pitched down and away.
    strike(at + 0.05, { freq: m.body * 0.55, peak: 0.16, decay: 0.2, type: 'sine', bend: 0.55 });
  },

  /** The end of the game: three notes, the only phrase in the whole set. */
  gameEnd(at) {
    const m = material();
    m.chord.forEach((freq, i) => {
      const when = at + i * 0.11;
      strike(when, { freq, peak: 0.2, decay: 0.5 + m.ring * 2, type: 'sine', bend: 0.998 });
      strike(when + 0.001, { freq: freq * 2, peak: 0.05, decay: 0.3, type: 'sine', bend: 0.998 });
    });
  },

  /** A control being pressed: short enough not to be noticed twice. */
  ui(at) {
    const m = material();
    transient(at, { peak: 0.10, decay: 0.016, cut: m.cut * 1.2, highpass: 900 });
    strike(at, { freq: m.body * 2.2, peak: 0.08, decay: 0.05, type: 'sine' });
  },
};

/* ── Public surface ─────────────────────────────────────────────────────── */

/** Called on the first pointer or key event so playback is allowed afterwards. */
export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  const ctx = ensureContext();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export function setVolume(value) {
  if (master) master.gain.value = value;
}

/**
 * Play a named effect. `delay` is in milliseconds, for chained captures.
 *
 * Scheduling ahead rather than sleeping is what lets four captures in one jump
 * land on the beat of the animation instead of whenever a timer happens to
 * fire.
 */
export function play(name, delay = 0) {
  if (!getSetting('sound') || !VOICES[name]) return;
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  try {
    VOICES[name](ctx.currentTime + Math.max(0, delay) / 1000 + 0.005);
  } catch { /* a sound that cannot play must never interrupt a move */ }
}

/** Exposed so the settings screen can demonstrate a material as it is chosen. */
export const voiceNames = () => Object.keys(VOICES);
