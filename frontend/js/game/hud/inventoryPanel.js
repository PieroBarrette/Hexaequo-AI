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
    const reserve = {
        tiles: clampCount(state.inventory?.[color]),
        disc: clampCount(state.discInventory?.[color]),
        ring: clampCount(state.ringInventory?.[color])
    };
    const captured = {
        disc: clampCount(state.captured?.[color]?.disc),
        ring: clampCount(state.captured?.[color]?.ring)
    };
    const opponent = color === 'black' ? 'white' : 'black';
    const isTurn = state.activePlayer === color;

    element.dataset.player = color;
    element.dataset.active = isTurn ? 'true' : 'false';
    element.innerHTML = `
        <div class="inventory-tabletop" aria-hidden="true">
            ${renderCluster('tile', reserve.tiles, color, 'reserve')}
            ${renderCluster('disc', reserve.disc, color, 'reserve')}
            ${renderCluster('ring', reserve.ring, color, 'reserve')}
        </div>
        <div class="inventory-divider" aria-hidden="true"></div>
        <div class="inventory-tabletop inventory-tabletop--captured" aria-hidden="true">
            ${renderCluster('disc', captured.disc, opponent, 'captured')}
            ${renderCluster('ring', captured.ring, opponent, 'captured')}
        </div>
        ${renderSummary(color, reserve, captured)}
    `;
}

function renderCluster(kind, count, color, slot) {
    const safeCount = clampCount(count);
    const tokens = safeCount > 0 ? buildTokens(kind, safeCount, color) : '<span class="token token--ghost" aria-hidden="true"></span>'; 
    return `
        <div class="token-cluster" data-kind="${kind}" data-slot="${slot}">
            ${tokens}
        </div>
    `;
}

function buildTokens(kind, count, color) {
    const tokenKind = kind === 'tile' ? 'tile' : kind;
    return Array.from({ length: count })
        .map(() => `<span class="token token--${tokenKind}" data-color="${color}" aria-hidden="true"></span>`)
        .join('');
}

function renderSummary(color, reserve, captured) {
    return `
        <span class="sr-only">
            ${color} reserve: ${reserve.tiles} tiles, ${reserve.disc} discs, ${reserve.ring} rings.
            Captured: ${captured.disc} discs and ${captured.ring} rings.
        </span>
    `;
}

function clampCount(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
}

