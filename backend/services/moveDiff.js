/**
 * moveDiff.js - Server-side utility to extract move metadata by diffing two game states.
 * 
 * Compares pre-move and post-move serialized game states to determine:
 * - moveType: 'place-tile', 'place-disc', 'place-ring', 'move', 'jump', 'ring-jump'
 * - from: {q, r} or null (for placements)
 * - to: {q, r}
 * - captures: [{q, r, type, color}] or null
 */

/**
 * Diff two game states to extract move information.
 * @param {Object} before - Pre-move serialized game state
 * @param {Object} after - Post-move serialized game state
 * @returns {Object} { moveType, from, to, captures }
 */
function diffStates(before, after) {
    if (!before || !after) return { moveType: 'unknown', from: null, to: null, captures: null };

    const beforeTiles = before.tiles || {};
    const afterTiles = after.tiles || {};
    const beforePieces = before.pieces || {};
    const afterPieces = after.pieces || {};

    // Find new tiles (present in after but not before)
    const newTiles = [];
    for (const key of Object.keys(afterTiles)) {
        if (!beforeTiles[key]) {
            newTiles.push(parseKey(key));
        }
    }

    // Find new pieces (present in after but not before)
    const newPieces = [];
    for (const key of Object.keys(afterPieces)) {
        if (!beforePieces[key]) {
            newPieces.push({ ...parseKey(key), piece: afterPieces[key] });
        }
    }

    // Find removed pieces (present in before but not after)
    const removedPieces = [];
    for (const key of Object.keys(beforePieces)) {
        if (!afterPieces[key]) {
            removedPieces.push({ ...parseKey(key), piece: beforePieces[key] });
        }
    }

    // Find moved pieces (same piece type+color, different position)
    const movedFrom = removedPieces.filter(rp => 
        newPieces.some(np => np.piece.type === rp.piece.type && np.piece.color === rp.piece.color)
    );
    const movedTo = newPieces.filter(np =>
        removedPieces.some(rp => rp.piece.type === np.piece.type && rp.piece.color === np.piece.color)
    );

    // Determine move type
    // Case 1: Tile placement (new tile, no piece movement)
    if (newTiles.length > 0 && movedFrom.length === 0 && newPieces.length === 0) {
        return {
            moveType: 'place-tile',
            from: null,
            to: newTiles[0],
            captures: null
        };
    }

    // Case 2: Piece placement (new piece on existing tile, no movement)
    if (newPieces.length > 0 && movedFrom.length === 0) {
        // Check if it's a disc or ring placement
        const placed = newPieces.find(np => !removedPieces.some(rp => 
            rp.piece.type === np.piece.type && rp.piece.color === np.piece.color
        ));
        if (placed) {
            const type = placed.piece.type === 'disc' ? 'place-disc' : 'place-ring';
            return {
                moveType: type,
                from: null,
                to: { q: placed.q, r: placed.r },
                captures: null
            };
        }
    }

    // Case 3: Piece movement (one piece removed from old pos, appears at new pos)
    if (movedFrom.length > 0 && movedTo.length > 0) {
        const from = movedFrom[0];
        const to = movedTo[0];

        // Determine captures: removed pieces that are NOT the moving piece
        const captures = removedPieces
            .filter(rp => !(rp.q === from.q && rp.r === from.r))
            .map(rp => ({ q: rp.q, r: rp.r, type: rp.piece.type, color: rp.piece.color }));

        // Determine if it's a simple move, jump, or ring jump
        const distance = hexDistance(from.q, from.r, to.q, to.r);
        let moveType;
        if (from.piece.type === 'ring') {
            moveType = 'ring-jump';
        } else if (distance > 1 || captures.length > 0) {
            moveType = 'jump';
        } else {
            moveType = 'move';
        }

        return {
            moveType,
            from: { q: from.q, r: from.r },
            to: { q: to.q, r: to.r },
            captures: captures.length > 0 ? captures : null
        };
    }

    // Fallback
    return { moveType: 'unknown', from: null, to: null, captures: null };
}

/**
 * Parse "q,r" key to {q, r} object
 */
function parseKey(key) {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
}

/**
 * Calculate hex distance between two positions (cube coordinates)
 */
function hexDistance(q1, r1, q2, r2) {
    const s1 = -q1 - r1;
    const s2 = -q2 - r2;
    return Math.max(Math.abs(q1 - q2), Math.abs(r1 - r2), Math.abs(s1 - s2));
}

module.exports = { diffStates };
