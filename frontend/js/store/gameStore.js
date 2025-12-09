// Minimal observable store for the game board state.
// Will eventually back both the SPA UI and legacy canvas while we migrate.

import { createInitialState } from '../game/gameState.js';

let currentState = createInitialState();
const subscribers = new Set();

export function getGameState() {
    return currentState;
}

export function setGameState(nextState) {
    const resolved = typeof nextState === 'function' ? nextState(currentState) : nextState;
    currentState = resolved;
    notify();
}

export function updateGameState(patchFn) {
    currentState = patchFn(currentState);
    notify();
}

export function subscribeToGameState(listener) {
    subscribers.add(listener);
    listener(currentState);
    return () => {
        subscribers.delete(listener);
    };
}

function notify() {
    subscribers.forEach((listener) => {
        try {
            listener(currentState);
        } catch (err) {
            console.error('gameStore listener error', err);
        }
    });
}
