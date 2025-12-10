import { mountInventoryPanel } from './inventoryPanel.js';
import { mountTimerPanel } from './timerPanel.js';
import { mountInlinePrompts } from './multiJumpOverlay.js';
import { mountGameOverBanner } from './gameOverBanner.js';

export function mountHud() {
    const disposers = [];

    const inventoryBlack = document.querySelector('[data-inventory-black]');
    const inventoryWhite = document.querySelector('[data-inventory-white]');
    disposers.push(
        mountInventoryPanel({
            black: inventoryBlack,
            white: inventoryWhite
        })
    );

    const playerSummaryBlack = document.querySelector('[data-player-summary="black"]');
    const playerSummaryWhite = document.querySelector('[data-player-summary="white"]');
    disposers.push(
        mountTimerPanel({
            black: playerSummaryBlack,
            white: playerSummaryWhite
        })
    );

    const inlinePrompts = document.querySelector('[data-inline-prompts]');
    disposers.push(mountInlinePrompts(inlinePrompts));

    const gameOverOverlay = document.querySelector('[data-game-over]');
    disposers.push(mountGameOverBanner(gameOverOverlay));

    return () => disposers.forEach((dispose) => dispose?.());
}
