import { subscribeToGameState } from '../../store/gameStore.js';

export function mountInventoryPanel(targets = {}) {
    const disposers = [];
    if (targets.black) {
        disposers.push(subscribeToGameState((state) => renderInventory(targets.black, state, 'black')));
    }
    if (targets.white) {
        disposers.push(subscribeToGameState((state) => renderInventory(targets.white, state, 'white')));
    }
    return () => disposers.forEach((dispose) => dispose());
}

function renderInventory(element, state, color) {
    if (!element) return;
    const inventoryCount = state.inventory?.[color] ?? 0;
    const discs = state.discInventory?.[color] ?? 0;
    const rings = state.ringInventory?.[color] ?? 0;
    const captured = state.captured?.[color] ?? { disc: 0, ring: 0 };

    element.innerHTML = `
        <span class="hud-label">${capitalize(color)}</span>
        <ul class="hud-list">
            <li>Tiles: <strong>${inventoryCount}</strong></li>
            <li>Discs: <strong>${discs}</strong></li>
            <li>Rings: <strong>${rings}</strong></li>
            <li>Captured discs: <strong>${captured.disc ?? 0}</strong></li>
            <li>Captured rings: <strong>${captured.ring ?? 0}</strong></li>
        </ul>
    `;
}

function capitalize(value) {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
}
