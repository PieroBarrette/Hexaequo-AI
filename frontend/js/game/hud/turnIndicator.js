import { subscribeToGameState } from '../../store/gameStore.js';

export function mountTurnIndicator(element) {
    if (!element) {
        return () => {};
    }

    const unsubscribe = subscribeToGameState((state) => {
        const active = (state.activePlayer ?? 'unknown').toString();
        const formatted = capitalize(active);
        element.innerHTML = `
            <span class="hud-label">Active Player</span>
            <strong class="hud-value">${formatted}</strong>
        `;
        element.dataset.playerColor = active;
    });

    return unsubscribe;
}

function capitalize(value) {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
}
