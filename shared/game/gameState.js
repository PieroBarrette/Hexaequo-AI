// Pure helpers for initializing, cloning, and serializing Hexaequo board state.
// These functions intentionally avoid DOM/window access so they can be reused by any UI layer.

const STARTING_TILES = Object.freeze({
    '0,0': 'black',
    '1,0': 'black',
    '-1,1': 'white',
    '0,1': 'white'
});

const STARTING_PIECES = Object.freeze({
    '1,0': { type: 'disc', color: 'black' },
    '-1,1': { type: 'disc', color: 'white' }
});

const STARTING_INVENTORY = Object.freeze({
    tiles: 7,
    discs: 5,
    rings: 3
});

const STARTING_CAPTURED = Object.freeze({
    disc: 0,
    ring: 0
});

/**
 * Produce a fresh game state snapshot using the classic opening setup.
 */
export function createInitialState() {
    return {
        tiles: { ...STARTING_TILES },
        pieces: clonePieces(STARTING_PIECES),
        inventory: {
            black: STARTING_INVENTORY.tiles,
            white: STARTING_INVENTORY.tiles
        },
        discInventory: {
            black: STARTING_INVENTORY.discs,
            white: STARTING_INVENTORY.discs
        },
        ringInventory: {
            black: STARTING_INVENTORY.rings,
            white: STARTING_INVENTORY.rings
        },
        captured: {
            black: { ...STARTING_CAPTURED },
            white: { ...STARTING_CAPTURED }
        },
        activePlayer: 'black',
        lastMove: null,
        metadata: {
            multiJumping: false,
            jumpHistory: [],
            moveHistory: []
        }
    };
}

/**
 * Mirror of the legacy serializeGameState for compatibility with AI/online payloads.
 */
export function serializeState(state) {
    return {
        tiles: cloneTiles(state.tiles),
        pieces: clonePieces(state.pieces),
        inventory: {
            black: buildInventorySnapshot(state, 'black'),
            white: buildInventorySnapshot(state, 'white')
        },
        captured: {
            black_discs: getCaptured(state, 'black').disc,
            black_rings: getCaptured(state, 'black').ring,
            white_discs: getCaptured(state, 'white').disc,
            white_rings: getCaptured(state, 'white').ring
        },
        activePlayer: state.activePlayer ?? 'black',
        lastJumpPath: formatJumpPath(state.lastJumpPath)
    };
}

/**
 * Apply a serialized snapshot and return a fully-cloned state object.
 */
export function applySnapshot(snapshot, fallbackState = createInitialState()) {
    if (!snapshot) return createInitialState();

    return {
        tiles: cloneTiles(snapshot.tiles ?? fallbackState.tiles),
        pieces: clonePieces(snapshot.pieces ?? fallbackState.pieces),
        inventory: {
            black: snapshot.inventory?.black?.tiles ?? fallbackState.inventory.black,
            white: snapshot.inventory?.white?.tiles ?? fallbackState.inventory.white
        },
        discInventory: {
            black: snapshot.inventory?.black?.discs ?? fallbackState.discInventory.black,
            white: snapshot.inventory?.white?.discs ?? fallbackState.discInventory.white
        },
        ringInventory: {
            black: snapshot.inventory?.black?.rings ?? fallbackState.ringInventory.black,
            white: snapshot.inventory?.white?.rings ?? fallbackState.ringInventory.white
        },
        captured: {
            black: {
                disc: snapshot.captured?.black_discs ?? fallbackState.captured.black.disc,
                ring: snapshot.captured?.black_rings ?? fallbackState.captured.black.ring
            },
            white: {
                disc: snapshot.captured?.white_discs ?? fallbackState.captured.white.disc,
                ring: snapshot.captured?.white_rings ?? fallbackState.captured.white.ring
            }
        },
        activePlayer: snapshot.activePlayer ?? fallbackState.activePlayer,
        lastMove: snapshot.lastMove ?? fallbackState.lastMove,
        metadata: {
            ...(fallbackState.metadata ?? {}),
            lastJumpPath: parseJumpPath(snapshot.lastJumpPath)
        }
    };
}

export function clonePieces(source = {}) {
    const clone = {};
    for (const key of Object.keys(source)) {
        const piece = source[key];
        clone[key] = piece ? { ...piece } : piece;
    }
    return clone;
}

function cloneTiles(source = {}) {
    return { ...(source ?? {}) };
}

function buildInventorySnapshot(state, color) {
    return {
        tiles: state.inventory?.[color] ?? 0,
        discs: state.discInventory?.[color] ?? 0,
        rings: state.ringInventory?.[color] ?? 0
    };
}

function getCaptured(state, color) {
    return state.captured?.[color] ?? STARTING_CAPTURED;
}

function formatJumpPath(path) {
    if (!path || path.length === 0) return undefined;
    return path.map((pos) => `${pos.q},${pos.r}`);
}

function parseJumpPath(serialized) {
    if (!Array.isArray(serialized)) return [];
    return serialized
        .map((token) => {
            if (typeof token !== 'string') return null;
            const [q, r] = token.split(',').map(Number);
            if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
            return { q, r };
        })
        .filter(Boolean);
}
