import { subscribeToGameState } from '../../store/gameStore.js';
import { getAppState, subscribeToAppState } from '../../store/appStore.js';

export function mountTimerPanel(targets = {}) {
    const disposers = [];
    const stateCache = {
        app: getAppState(),
        game: null
    };

    const renderAll = () => {
        if (targets.black) {
            renderSummary(targets.black, 'black', stateCache);
        }
        if (targets.white) {
            renderSummary(targets.white, 'white', stateCache);
        }
    };

    disposers.push(
        subscribeToAppState((appState) => {
            stateCache.app = appState;
            renderAll();
        })
    );
    disposers.push(
        subscribeToGameState((gameState) => {
            stateCache.game = gameState;
            renderAll();
        })
    );

    renderAll();

    return () => disposers.forEach((dispose) => dispose?.());
}

function renderSummary(root, color, cache) {
    if (!root) return;
    const pseudoEl = root.querySelector(`[data-player-pseudo="${color}"]`) ?? root.querySelector('[data-player-pseudo]');
    const eloEl = root.querySelector(`[data-player-elo="${color}"]`) ?? root.querySelector('[data-player-elo]');
    const timerEl = root.querySelector(`[data-player-timer="${color}"]`) ?? root.querySelector('[data-player-timer]');
    const timerValueEl = timerEl?.querySelector('.player-header__timer-value');

    const player = cache.app.players?.[color] ?? {};
    if (pseudoEl) {
        pseudoEl.textContent = player.pseudo ?? `Player ${capitalize(color)}`;
    }
    if (eloEl) {
        eloEl.textContent = formatElo(player.elo);
    }

    const timerMode = cache.app.matchSettings?.timerMode ?? 'none';
    const showTimer = timerMode !== 'none';
    if (timerEl) {
        timerEl.dataset.visible = showTimer ? 'true' : 'false';
        const remaining = resolveRemainingMilliseconds(cache.game, color);
        const displayValue = cache.app.gameFrozen ? '--:--' : formatTime(remaining);
        if (timerValueEl) {
            timerValueEl.textContent = showTimer ? displayValue : '--:--';
        }
    }
}

function resolveRemainingMilliseconds(state, color) {
    if (!state) return null;
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

function formatElo(value) {
    if (!Number.isFinite(value)) {
        return 'ELO --';
    }
    return `ELO ${Math.max(0, Math.floor(value))}`;
}

function capitalize(value) {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
}
