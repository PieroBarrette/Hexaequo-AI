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

    element.dataset.player = color;
    element.innerHTML = `
        <div class="inventory-grid">
            ${renderStatRow('disc', discs, captured.disc ?? 0, losses.disc ?? 0)}
            ${renderStatRow('ring', rings, captured.ring ?? 0, losses.ring ?? 0)}
        </div>
        <div class="inventory-footer">
            <div class="inventory-pool">
                <span>Tiles in pool</span>
                <strong>${inventoryCount}</strong>
                <small>${tilesLabel} remaining</small>
            </div>
            <div class="inventory-turn ${isTurn ? 'is-active' : ''}">
                <span>${isTurn ? 'Your move' : 'Stand by'}</span>
                <span class="inventory-turn__dot" aria-hidden="true"></span>
            </div>
        </div>
    `;
}

function renderStatRow(kind, remaining, captured, lost) {
    const label = kind === 'disc' ? 'Discs' : 'Rings';
    const piecesLabel = remaining === 1 ? 'piece ready' : 'pieces ready';
    return `
        <article class="inventory-stat" data-kind="${kind}">
            <span class="inventory-stat__chip" aria-hidden="true"></span>
            <div class="inventory-stat__copy">
                <p class="inventory-stat__label">${label}</p>
                <p class="inventory-stat__meta">${captured} captured · ${lost} lost</p>
            </div>
            <div class="inventory-stat__value">
                <strong>${remaining}</strong>
                <span>${piecesLabel}</span>
            </div>
        </article>
    `;
}

