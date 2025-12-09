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
    const opponent = color === 'black' ? 'white' : 'black';
    const losses = state.captured?.[opponent] ?? { disc: 0, ring: 0 };
    const isTurn = state.activePlayer === color;
    const tilesLabel = inventoryCount === 1 ? 'tile' : 'tiles';

    element.innerHTML = `
        <div class="inventory-header">
            <div>
                <div class="inventory-player">${capitalize(color)}</div>
                <div class="inventory-status ${isTurn ? 'live' : ''}">${isTurn ? 'Your move' : 'Waiting'}</div>
            </div>
            <div class="inventory-remaining">${inventoryCount} ${tilesLabel} left</div>
        </div>
        <div class="inventory-stats">
            <div>
                <label>Discs</label>
                <strong>${discs}</strong>
            </div>
            <div>
                <label>Rings</label>
                <strong>${rings}</strong>
            </div>
            <div>
                <label>Captured discs</label>
                <strong>${captured.disc ?? 0}</strong>
            </div>
            <div>
                <label>Captured rings</label>
                <strong>${captured.ring ?? 0}</strong>
            </div>
        </div>
        <div class="inventory-captures">
            <div>Discs lost <span>${losses.disc ?? 0}</span></div>
            <div>Rings lost <span>${losses.ring ?? 0}</span></div>
        </div>
    `;
}

function capitalize(value) {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
}
