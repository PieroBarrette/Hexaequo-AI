import { mountBoardRenderer } from './game/boardRenderer.js';
import { createCanvasGraphics } from './game/canvasGraphics.js';
import { updateGameState, getGameState } from './store/gameStore.js';

const HEX_DIRECTIONS = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]
];

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('modernGameCanvas');
    const addTileBtn = document.getElementById('devAddTile');
    const addDiscBtn = document.getElementById('devAddDisc');

    if (!canvas) {
        console.warn('No canvas element found for the modern renderer.');
        return;
    }

    const graphicsApi = createCanvasGraphics(canvas, { hexSize: 40, verbose: false });

    mountBoardRenderer({
        graphicsApi,
        animateMultiJumps: true
    });

    addTileBtn?.addEventListener('click', () => {
        updateGameState((state) => {
            const tiles = { ...state.tiles };
            const candidate = findPlacementSpot(tiles);
            if (!candidate) return state;
            tiles[`${candidate.q},${candidate.r}`] = Math.random() > 0.5 ? 'black' : 'white';
            return { ...state, tiles };
        });
    });

    addDiscBtn?.addEventListener('click', () => {
        updateGameState((state) => {
            const placement = findPiecePlacement(state);
            if (!placement) return state;
            const pieces = { ...state.pieces };
            pieces[`${placement.q},${placement.r}`] = {
                type: placement.type,
                color: placement.color
            };
            return { ...state, pieces };
        });
    });

    window.hexaequoModern = {
        getGameState,
        updateGameState
    };
});

function findPlacementSpot(tiles) {
    const occupied = new Set(Object.keys(tiles));
    const candidates = [];
    for (const key of occupied) {
        const [q, r] = key.split(',').map(Number);
        for (const [dq, dr] of HEX_DIRECTIONS) {
            const cq = q + dq;
            const cr = r + dr;
            const cKey = `${cq},${cr}`;
            if (!occupied.has(cKey)) {
                candidates.push({ q: cq, r: cr });
            }
        }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
}

function findPiecePlacement(state) {
    const tiles = state.tiles || {};
    const pieces = state.pieces || {};
    const emptyTiles = Object.keys(tiles).filter((key) => !pieces[key]);
    if (emptyTiles.length === 0) return null;
    const [q, r] = emptyTiles[Math.floor(Math.random() * emptyTiles.length)].split(',').map(Number);
    const type = Math.random() > 0.7 ? 'ring' : 'disc';
    const color = Math.random() > 0.5 ? 'black' : 'white';
    return { q, r, type, color };
}
