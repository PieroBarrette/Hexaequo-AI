import { subscribeToGameState } from '../../store/gameStore.js';
import { subscribeToAppState } from '../../store/appStore.js';

export function mountTurnIndicator(element) {
    if (!element) {
        return () => {};
    }

    let currentGameState = null;
    let currentAppState = null;

    const render = () => {
        if (!currentGameState) return;
        
        const active = (currentGameState.activePlayer ?? 'unknown').toString();
        const formatted = capitalize(active);
        const isAiThinking = currentAppState?.aiThinking && currentAppState?.gameMode === 'ai' && active === 'white';
        
        if (isAiThinking) {
            element.innerHTML = `
                <span class="hud-label">AI Thinking</span>
                <strong class="hud-value">
                    <span class="thinking-indicator">
                        <span class="thinking-dot"></span>
                        <span class="thinking-dot"></span>
                        <span class="thinking-dot"></span>
                    </span>
                </strong>
            `;
            element.dataset.playerColor = active;
            element.dataset.thinking = 'true';
        } else {
            element.innerHTML = `
                <span class="hud-label">Active Player</span>
                <strong class="hud-value">${formatted}</strong>
            `;
            element.dataset.playerColor = active;
            element.dataset.thinking = 'false';
        }
    };

    const unsubscribeGame = subscribeToGameState((state) => {
        currentGameState = state;
        render();
    });

    const unsubscribeApp = subscribeToAppState((state) => {
        currentAppState = state;
        render();
    });

    return () => {
        unsubscribeGame?.();
        unsubscribeApp?.();
    };
}

function capitalize(value) {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
}
