/**
 * Server-side rules authority.
 *
 * The game engine lives in web/src/game/ and is shared verbatim with the
 * browser: one implementation of the rules, so the server and the client can
 * never disagree about what is legal. The engine is written as ES modules while
 * this backend is CommonJS, so it is pulled in with a dynamic import, loaded
 * once and memoised.
 *
 * The contract with clients is deliberately narrow. A client sends an *intent*
 * — "lay a tile here", "walk this path" — never a board state and never a list
 * of captures. This module regenerates every legal move for the position and
 * applies the one that matches. Anything else is refused.
 */

const path = require('path');
const { pathToFileURL } = require('url');

const ENGINE_DIR = path.join(__dirname, '..', '..', 'web', 'src', 'game');
const moduleUrl = (file) => pathToFileURL(path.join(ENGINE_DIR, file)).href;

let loading = null;

/** Load the shared engine once. */
function loadEngine() {
    if (!loading) {
        loading = (async () => {
            const [hex, state, moves] = await Promise.all([
                import(moduleUrl('hex.js')),
                import(moduleUrl('state.js')),
                import(moduleUrl('moves.js')),
            ]);
            return { hex, state, moves };
        })().catch((error) => {
            loading = null;          // let a later call retry rather than cache the failure
            throw error;
        });
    }
    return loading;
}

/** Warm the engine at boot so the first move does not pay the import cost. */
async function ready() {
    await loadEngine();
    return true;
}

/** A fresh game, as a JSON-safe snapshot. */
async function createGame() {
    const { state } = await loadEngine();
    return state.serializeState(state.createState());
}

/**
 * Apply `intent` to `snapshot` on behalf of `player`.
 *
 * `idle` is how many plies the game has already gone with neither a capture
 * nor a placement, and the new count comes back with the answer. That ledger
 * belongs to the caller — it is a fact about a history, not about a position —
 * but the rule is applied here, so the server reads the limit out of the same
 * module the browser does instead of keeping a number of its own.
 *
 * Returns either { ok: true, state, move, notation, result, idle } or
 * { ok: false, error } with a stable machine-readable error code.
 */
async function applyIntent(snapshot, intent, player, idle = 0) {
    const { hex, state, moves } = await loadEngine();

    let position;
    try {
        position = state.deserializeState(snapshot);
    } catch (error) {
        return { ok: false, error: 'CORRUPT_STATE', detail: error.message };
    }

    if (player !== state.BLACK && player !== state.WHITE) {
        return { ok: false, error: 'UNKNOWN_PLAYER' };
    }
    if (position.turn !== player) {
        return { ok: false, error: 'NOT_YOUR_TURN' };
    }
    if (moves.checkWinner(position)) {
        return { ok: false, error: 'GAME_OVER' };
    }

    const move = moves.findLegalMove(position, intent);
    if (!move) {
        return { ok: false, error: 'ILLEGAL_MOVE' };
    }

    state.applyMove(position, move);
    const nextIdle = moves.idleAfter(Number.isFinite(idle) ? idle : 0, move);

    const won = moves.checkWinner(position);
    let result = null;
    if (won) {
        result = { winner: won.winner, reason: won.reason };
    } else if (moves.generateMoves(position).length === 0) {
        result = { winner: null, reason: 'noMoves' };
    } else if (nextIdle >= moves.IDLE_LIMIT) {
        result = { winner: null, reason: 'idle' };
    }

    return {
        ok: true,
        state: state.serializeState(position),
        move: moves.moveIntent(move),
        notation: moves.moveNotation(move, hex.cellLabel) + moves.endingMark(result),
        captures: (move.type === 'disk' ? move.captures : (move.capture ? [move.capture] : []))
            .map((c) => ({ cell: c.cell, code: c.code })),
        result,
        idle: nextIdle,
    };
}

/**
 * Replay a list of intents from the opening position. Used to rebuild a game
 * whose room has fallen out of memory, and to check a stored game is coherent.
 */
async function replay(intents) {
    const { state } = await loadEngine();
    let snapshot = state.serializeState(state.createState());
    let turn = state.BLACK;
    let idle = 0;
    for (let i = 0; i < intents.length; i++) {
        const outcome = await applyIntent(snapshot, intents[i], turn, idle);
        if (!outcome.ok) {
            return { ok: false, error: outcome.error, atMove: i };
        }
        snapshot = outcome.state;
        turn = 1 - turn;
        idle = outcome.idle;
    }
    /* The idle count comes back with the position because a rebuilt game has to
       stand where the real one stood: a room that replayed its moves and then
       started counting from nought would hand both players fifty free moves. */
    return { ok: true, state: snapshot, turn, idle };
}

/** Whose turn it is in a snapshot, without a full deserialisation by callers. */
async function turnOf(snapshot) {
    const { state } = await loadEngine();
    return state.deserializeState(snapshot).turn;
}

/** Threefold repetition needs a signature the room can count. */
async function positionSignature(snapshot) {
    const { state } = await loadEngine();
    return state.positionKey(state.deserializeState(snapshot));
}

module.exports = {
    ready,
    createGame,
    applyIntent,
    replay,
    turnOf,
    positionSignature,
    BLACK: 0,
    WHITE: 1,
};
