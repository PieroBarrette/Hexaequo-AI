import { mountTurnIndicator } from './turnIndicator.js';
import { mountInventoryPanel } from './inventoryPanel.js';
import { mountTimerPanel } from './timerPanel.js';
import { mountActionCenter } from './actionCenter.js';
import { mountMultiJumpOverlay } from './multiJumpOverlay.js';
import { mountGameOverBanner } from './gameOverBanner.js';

export function mountHud() {
    const disposers = [];

    const turnElement = document.querySelector('[data-turn-indicator]');
    disposers.push(mountTurnIndicator(turnElement));

    const inventoryBlack = document.querySelector('[data-inventory-black]');
    const inventoryWhite = document.querySelector('[data-inventory-white]');
    disposers.push(
        mountInventoryPanel({
            black: inventoryBlack,
            white: inventoryWhite
        })
    );

    const timerBlack = document.querySelector('[data-timer-black]');
    const timerWhite = document.querySelector('[data-timer-white]');
    disposers.push(
        mountTimerPanel({
            black: timerBlack,
            white: timerWhite
        })
    );

    const actionCenter = document.querySelector('[data-action-center]');
    disposers.push(mountActionCenter(actionCenter));

    const multiJumpOverlay = document.querySelector('[data-multi-jump-overlay]');
    disposers.push(mountMultiJumpOverlay(multiJumpOverlay));

    const gameOverOverlay = document.querySelector('[data-game-over]');
    disposers.push(mountGameOverBanner(gameOverOverlay));

    return () => disposers.forEach((dispose) => dispose?.());
}
