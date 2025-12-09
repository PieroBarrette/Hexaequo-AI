// Helper utilities for describing how a Hexaequo board changed between two states.
// Renderer layers can use the returned diff to queue animations without duplicating
// board-diff logic across clients.

export function diffStatesForAnimation(previousState = {}, updatedState = {}, options = {}) {
    const prevTiles = previousState.tiles || {};
    const nextTiles = updatedState.tiles || {};
    const prevPieces = previousState.pieces || {};
    const nextPieces = updatedState.pieces || {};

    const opponent = updatedState.activePlayer || 'black';
    const player = opponent === 'black' ? 'white' : 'black';

    const tilePlacements = collectTilePlacements(prevTiles, nextTiles);
    const captures = collectCapturedPieces(prevPieces, nextPieces, opponent, player);

    const moveDetection = detectMove(prevPieces, nextPieces, player);
    const placements = collectPiecePlacements(prevPieces, nextPieces, player, moveDetection.movedToKey);

    const jumpPath = normaliseJumpPath(options.jumpPath || updatedState.lastJumpPath);
    const isLoop = Boolean(jumpPath && jumpPath.length > 1 && samePosition(jumpPath[0], jumpPath[jumpPath.length - 1]));
    const loopPiece = isLoop ? lookupPieceForLoop(jumpPath, prevPieces, nextPieces) : null;

    return {
        player,
        opponent,
        tilePlacements,
        captures,
        move: buildMoveDescriptor(moveDetection, jumpPath),
        placements,
        loopMove: isLoop ? { path: jumpPath, piece: loopPiece } : null,
        jumpPath
    };
}

function collectTilePlacements(previousTiles, nextTiles) {
    const placements = [];
    for (const key of Object.keys(nextTiles)) {
        if (!previousTiles[key] && nextTiles[key]) {
            const [q, r] = parseKey(key);
            placements.push({ q, r, color: nextTiles[key] });
        }
    }
    return placements;
}

function collectCapturedPieces(previousPieces, nextPieces, opponentColor, playerColor) {
    const captures = [];
    for (const key of Object.keys(previousPieces)) {
        const prevPiece = previousPieces[key];
        if (!prevPiece || prevPiece.color !== opponentColor) continue;

        const current = nextPieces[key];
        const removedCompletely = !current;
        const replacedByPlayer = current && current.color === playerColor;

        if (removedCompletely || replacedByPlayer) {
            const [q, r] = parseKey(key);
            captures.push({ q, r, piece: prevPiece });
        }
    }
    return captures;
}

function detectMove(previousPieces, nextPieces, playerColor) {
    let movedFromKey = null;
    let movedToKey = null;
    let piece = null;

    for (const key of Object.keys(previousPieces)) {
        const prevPiece = previousPieces[key];
        if (prevPiece && prevPiece.color === playerColor && !nextPieces[key]) {
            movedFromKey = key;
            piece = prevPiece;
            break;
        }
    }

    for (const key of Object.keys(nextPieces)) {
        const nextPiece = nextPieces[key];
        if (!nextPiece || nextPiece.color !== playerColor) continue;

        const prevPiece = previousPieces[key];
        const isNewLocation = !prevPiece || prevPiece.color !== playerColor;
        if (isNewLocation) {
            movedToKey = key;
            if (!piece) {
                piece = nextPiece;
            }
            break;
        }
    }

    return { movedFromKey, movedToKey, piece };
}

function collectPiecePlacements(previousPieces, nextPieces, playerColor, moveDestinationKey) {
    const placements = [];
    for (const key of Object.keys(nextPieces)) {
        if (key === moveDestinationKey) continue;
        const piece = nextPieces[key];
        if (!piece || piece.color !== playerColor) continue;
        const prevPiece = previousPieces[key];
        if (!prevPiece || prevPiece.color !== playerColor) {
            const [q, r] = parseKey(key);
            placements.push({ q, r, piece });
        }
    }
    return placements;
}

function buildMoveDescriptor(moveDetection, jumpPath) {
    const { movedFromKey, movedToKey, piece } = moveDetection;
    if (movedFromKey && movedToKey && piece) {
        const [fromQ, fromR] = parseKey(movedFromKey);
        const [toQ, toR] = parseKey(movedToKey);
        return {
            from: { q: fromQ, r: fromR },
            to: { q: toQ, r: toR },
            piece,
            jumpPath
        };
    }
    return null;
}

function lookupPieceForLoop(path, previousPieces, nextPieces) {
    if (!path || path.length === 0) {
        return null;
    }
    const key = `${path[0].q},${path[0].r}`;
    return nextPieces[key] || previousPieces[key] || null;
}

function samePosition(a, b) {
    if (!a || !b) return false;
    return a.q === b.q && a.r === b.r;
}

export function normaliseJumpPath(path) {
    if (!path || path.length === 0) return null;

    const normalised = [];
    for (const entry of path) {
        if (typeof entry === 'string') {
            const [q, r] = entry.split(',').map(Number);
            if (Number.isFinite(q) && Number.isFinite(r)) {
                normalised.push({ q, r });
            }
        } else if (entry && typeof entry === 'object' && Number.isFinite(entry.q) && Number.isFinite(entry.r)) {
            normalised.push({ q: entry.q, r: entry.r });
        }
    }

    return normalised.length > 0 ? normalised : null;
}

function parseKey(key) {
    const [q, r] = key.split(',').map(Number);
    return [q, r];
}
