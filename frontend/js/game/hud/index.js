import { mountTurnIndicator } from './turnIndicator.js';
import { mountInventoryPanel } from './inventoryPanel.js';
import { mountTimerPanel } from './timerPanel.js';

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

    return () => disposers.forEach((dispose) => dispose?.());
}
