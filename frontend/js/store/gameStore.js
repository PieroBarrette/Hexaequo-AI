// Observable game state store shared by the modern SPA and any lightweight dev tools.
// Handles serialized snapshots so Socket.IO payloads and replay logs can hydrate the renderer.

import { createInitialState, applySnapshot, serializeState } from '../game/gameState.js';

let currentState = createInitialState();
let previousState = currentState;
const subscribers = new Set();

export function getGameState() {
    return currentState;
}

export function getPreviousGameState() {
    return previousState;
}

export function serializeCurrentState() {
    return serializeState(currentState);
}

export function resetGameState(initialState = createInitialState()) {
    previousState = currentState;
    currentState = initialState;
    notify({ reason: 'reset' });
    return currentState;
}

export function applySerializedState(snapshot, options = {}) {
    const fallback = options.fallback ?? currentState ?? createInitialState();
    const nextState = applySnapshot(snapshot, fallback);
    return setGameState(() => nextState, { reason: options.reason ?? 'snapshot', snapshot });
}

export function setGameState(nextState, options = {}) {
    const resolved = typeof nextState === 'function' ? nextState(currentState) : nextState;
    if (!resolved) {
        return currentState;
    }

    previousState = currentState;
    currentState = resolved;
    if (options.skipNotify !== true) {
        notify({ reason: options.reason ?? 'set', snapshot: options.snapshot });
    }
    return currentState;
}

export function updateGameState(patchFn, options = {}) {
    if (typeof patchFn !== 'function') {
        throw new Error('updateGameState expects a function');
    }
    return setGameState(patchFn, { reason: options.reason ?? 'update' });
}

export function subscribeToGameState(listener, options = {}) {
    const entry = { listener, options };
    subscribers.add(entry);
    if (options.emitInitial !== false) {
        try {
            listener(currentState, previousState, { reason: 'initial' });
        } catch (err) {
            console.error('gameStore listener error', err);
        }
    }
    return () => {
        subscribers.delete(entry);
    };
}

function notify(payload = {}) {
    subscribers.forEach(({ listener }) => {
        try {
            listener(currentState, previousState, payload);
        } catch (err) {
            console.error('gameStore listener error', err);
        }
    });
}
