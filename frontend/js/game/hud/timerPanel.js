import { subscribeToGameState } from '../../store/gameStore.js';

export function mountTimerPanel(targets = {}) {
    const disposers = [];
    if (targets.black) {
        disposers.push(subscribeToGameState((state) => renderTimer(targets.black, state, 'black')));
    }
    if (targets.white) {
        disposers.push(subscribeToGameState((state) => renderTimer(targets.white, state, 'white')));
    }
    return () => disposers.forEach((dispose) => dispose());
}

function renderTimer(element, state, color) {
    if (!element) return;
    const remainingMs = resolveRemainingMilliseconds(state, color);
    element.innerHTML = `
        <span class="hud-label">${capitalize(color)} Timer</span>
        <strong class="hud-value">${formatTime(remainingMs)}</strong>
    `;
}

function resolveRemainingMilliseconds(state, color) {
    const metadata = state.metadata ?? {};
    const timers = metadata.timers ?? metadata.timer ?? {};
    const legacy = metadata[`${color}Timer`] ?? null;
    const candidate = timers[color] ?? legacy;

    if (typeof candidate === 'number') {
        return candidate;
    }

    if (candidate && typeof candidate.remainingMs === 'number') {
        return candidate.remainingMs;
    }

    if (candidate && typeof candidate.seconds === 'number') {
        return candidate.seconds * 1000;
    }

    return null;
}

function formatTime(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        return '--:--';
    }
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60)
        .toString()
        .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function capitalize(value) {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
}
