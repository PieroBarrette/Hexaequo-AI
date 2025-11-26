// ai.js
// Hexaequo AI - JavaScript conversion from Python AI.py
// Minimax algorithm with Alpha-Beta Pruning

// ============================================
// CONFIGURATION
// ============================================
// Profondeur de recherche de l'algorithme Minimax
// Plus la profondeur est élevée, plus l'IA est forte mais plus le calcul est long
// Valeurs recommandées: 2 (rapide), 3 (moyen), 4 (fort mais lent)
let AI_SEARCH_DEPTH = 3;

// ============================================

/**
 * Deep clone a game state object
 * structuredClone is much faster than JSON.parse(JSON.stringify)
 */
function deepClone(obj) {
    if (typeof structuredClone === 'function') {
        return structuredClone(obj);
    }
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Log the differences between the original game state and the proposed game state.
 */
function logMoveDifferences(originalState, proposedState) {
    // ... (logging logic kept simple or removed for performance in production, but keeping for debugging if needed)
    // For optimization, we can skip detailed logging in the worker loop
}

/**
 * Process game state and return the AI's move
 */
function processGameState(gameState, depth = 3) {
    if (gameState.activePlayer === 'black') {
        return gameState;
    }

    // Update global depth if provided
    AI_SEARCH_DEPTH = depth;

    // Determine the best move using Minimax
    let bestMove = null;
    let bestScore = Infinity; // Minimizing for white

    // Total pruned branches counter
    let totalPrunedBranches = 0;

    // Generate direct children of the initial board state
    const children = getChildren(gameState, '1');

    // Sort children to improve pruning (Move Ordering)
    // We want to explore promising moves first.
    // Since we are minimizing for White, we want to see moves with lower evaluation scores first.
    // However, accurate evaluation is expensive. A simple heuristic is to prioritize captures.
    // getChildren already puts captures (jumps) early in the list usually, but let's be explicit if needed.
    // For now, we rely on the order from getChildren which puts captures/moves before placements.

    // Evaluate each child
    for (const child of children) {
        const [score, pruned] = minimax(child, AI_SEARCH_DEPTH, -Infinity, Infinity, true, child.branch || '1');
        totalPrunedBranches += pruned;

        // Update best_move and best_score for white
        if (score < bestScore) {
            bestScore = score;
            bestMove = child;
        }
    }

    // Ensure the returned game state is properly formatted
    if (!bestMove || !['tiles', 'pieces', 'inventory', 'captured'].every(key => key in bestMove)) {
        console.warn('No valid move found or the chosen move is missing required keys. Returning the current state.');
        return gameState;
    }

    // Convert inventory and captured data to integers (safety check)
    for (const player of ['black', 'white']) {
        bestMove.inventory[player].tiles = parseInt(bestMove.inventory[player].tiles);
        bestMove.inventory[player].discs = parseInt(bestMove.inventory[player].discs);
        bestMove.inventory[player].rings = parseInt(bestMove.inventory[player].rings);
        bestMove.captured[`${player}_discs`] = parseInt(bestMove.captured[`${player}_discs`]);
        bestMove.captured[`${player}_rings`] = parseInt(bestMove.captured[`${player}_rings`]);
    }

    // Switch the active player to the opponent after the AI's move
    bestMove.activePlayer = 'black';

    console.log(`AI (Level ${depth}) finished. Score: ${bestScore}. Pruned: ${totalPrunedBranches}`);

    return bestMove;
}

/**
 * Minimax algorithm with Alpha-Beta Pruning
 */
function minimax(state, depth, alpha, beta, maximizingPlayer, branchPrefix) {
    // Check for terminal state or depth limit
    if (depth === 0 || isTerminal(state)) {
        const score = evaluate(state);
        return [score, 0]; // Return 0 pruned branches at leaf nodes
    }

    let prunedBranches = 0;
    const children = getChildren(state, branchPrefix);

    if (maximizingPlayer) {
        let maxEval = -Infinity;
        for (const child of children) {
            const [evalScore, childPrunedBranches] = minimax(
                child,
                depth - 1,
                alpha,
                beta,
                false,
                child.branch || branchPrefix
            );
            maxEval = Math.max(maxEval, evalScore);
            prunedBranches += childPrunedBranches;
            if (maxEval >= beta) {
                prunedBranches += 1;
                break;
            }
            alpha = Math.max(alpha, maxEval);
        }
        return [maxEval, prunedBranches];
    } else {
        let minEval = Infinity;
        for (const child of children) {
            const [evalScore, childPrunedBranches] = minimax(
                child,
                depth - 1,
                alpha,
                beta,
                true,
                child.branch || branchPrefix
            );
            minEval = Math.min(minEval, evalScore);
            prunedBranches += childPrunedBranches;
            if (minEval <= alpha) {
                prunedBranches += 1;
                break;
            }
            beta = Math.min(beta, minEval);
        }
        return [minEval, prunedBranches];
    }
}

/**
 * Check if the game state is terminal
 */
function isTerminal(state) {
    // Victory conditions:
    // 1. A player has 6 captured discs
    // 2. A player has 3 captured rings
    // 3. A player has no active pieces on the board

    // Check if either player has no active pieces
    // Optimization: Pass active pieces count if possible, but for now iterate
    let blackPieces = 0;
    let whitePieces = 0;
    for (const key in state.pieces) {
        if (state.pieces[key].color === 'black') blackPieces++;
        else whitePieces++;
    }

    const terminal = (
        state.captured.black_discs >= 6 ||
        state.captured.white_discs >= 6 ||
        state.captured.black_rings >= 3 ||
        state.captured.white_rings >= 3 ||
        blackPieces === 0 || whitePieces === 0
        // Note: Stalemate check (no moves) is expensive here, usually handled by getChildren returning empty
    );
//evaluate stalemate condition
    if (!terminal) {
        const children = getChildren(state, '1');
        if (children.length === 0) {
            return true; // Stalemate
        }
    }
    return terminal;
}

/**
 * Evaluate the game state
 * Positive score = Good for Black
 * Negative score = Good for White
 */
function evaluate(state) {
    let blackScore = 0;
    let whiteScore = 0;

    // Material weights
    const W_DISC = 10;
    const W_RING = 30;
    const W_CAPTURED_DISC = 15; // Capturing is better than just having
    const W_CAPTURED_RING = 50;
    const W_TILE = 2;
    //const W_MOBILITY = 0.5;
    //const W_CENTER = 1;

    // Score pieces on the board
    for (const position in state.pieces) {
        const piece = state.pieces[position];
        const [q, r] = position.split(',').map(Number);

        // Distance from center (0,0)
        // Hex distance = max(|q|, |r|, |s|) where s = -q-r
        //const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
        //const centerBonus = (5 - dist) * W_CENTER; // Closer to center is better

        if (piece.type === 'disc') {
            if (piece.color === 'black') {
                blackScore += W_DISC /*+ centerBonus*/;
            } else {
                whiteScore += W_DISC /*+ centerBonus*/;
            }
        } else if (piece.type === 'ring') {
            if (piece.color === 'black') {
                blackScore += W_RING /*+ centerBonus*/;
            } else {
                whiteScore += W_RING /*+ centerBonus*/;
            }
        }
    }

    // Score captured pieces
    blackScore += state.captured.black_discs * W_CAPTURED_DISC;
    blackScore += state.captured.black_rings * W_CAPTURED_RING;
    whiteScore += state.captured.white_discs * W_CAPTURED_DISC;
    whiteScore += state.captured.white_rings * W_CAPTURED_RING;

    // Score empty tiles of own color (territory)
    for (const position in state.tiles) {
        if (!(position in state.pieces)) {
            const tileColor = state.tiles[position];
            if (tileColor === 'black') {
                blackScore += W_TILE;
            } else if (tileColor === 'white') {
                whiteScore += W_TILE;
            }
        }
    }

    // Win/Loss check (High priority)
    let blackPieces = 0;
    let whitePieces = 0;
    for (const key in state.pieces) {
        if (state.pieces[key].color === 'black') blackPieces++;
        else whitePieces++;
    }

    if (state.captured.black_discs >= 6 || state.captured.black_rings >= 3 || whitePieces === 0) {
        return 10000;
    } else if (state.captured.white_discs >= 6 || state.captured.white_rings >= 3 || blackPieces === 0) {
        return -10000;
    }

    // Mobility (expensive to calculate fully, maybe skip for performance or use simplified version)
    // For now, skipping full mobility calculation to keep AI fast enough for depth 4

    //score = 0 if stalemate
    const children = getChildren(state, '1');  
    if (children.length === 0) {
        return 0; // Stalemate
    }

    return blackScore - whiteScore;
}

/**
 * Generate all possible child states (moves)
 */
function getChildren(state, branchPrefix) {
    const children = [];
    const player = state.activePlayer;

    // Generate all possible moves for the current player
    // Order matters for Alpha-Beta pruning!
    // 1. Captures (Jumps) - Most likely to drastically change score
    // 2. Ring Moves - High value pieces
    // 3. Disc Moves
    // 4. Placements

    const discJumps = getValidDiscJumps(state, player);
    const ringMoves = getValidRingMoves(state, player);
    const discMoves = getValidDiscMoves(state, player);
    const ringPlacements = getValidRingPlacements(state, player);
    const discPlacements = getValidDiscPlacements(state, player);
    const tilePlacements = getValidTilePlacements(state, player);

    let moveIndex = 1;

    // Simulate disc jumps (Captures)
    for (const jumpSequence of discJumps) {
        const newState = deepClone(state);
        simulateDiscJumpSequence(newState, jumpSequence);
        newState.activePlayer = player === 'black' ? 'white' : 'black';
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    // Simulate ring moves (Potential captures)
    for (const [fromPosition, toPosition] of ringMoves) {
        const newState = deepClone(state);
        simulateRingMove(newState, fromPosition, toPosition);
        newState.activePlayer = player === 'black' ? 'white' : 'black';
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    // Simulate disc moves
    for (const [fromPosition, toPosition] of discMoves) {
        if (!(fromPosition in state.pieces)) {
            continue;
        }
        const newState = deepClone(state);
        simulateDiscMove(newState, fromPosition, toPosition);
        newState.activePlayer = player === 'black' ? 'white' : 'black';
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    // Simulate ring placements
    for (const position of ringPlacements) {
        const newState = deepClone(state);
        simulateRingPlacement(newState, position, player);
        newState.activePlayer = player === 'black' ? 'white' : 'black';
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    // Simulate disc placements
    for (const position of discPlacements) {
        const newState = deepClone(state);
        simulateDiscPlacement(newState, position, player);
        newState.activePlayer = player === 'black' ? 'white' : 'black';
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    // Simulate tile placements
    for (const position of tilePlacements) {
        const newState = deepClone(state);
        simulateTilePlacement(newState, position, player);
        newState.activePlayer = player === 'black' ? 'white' : 'black';
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    return children;
}

/**
 * Simulate placing a tile
 */
function simulateTilePlacement(state, position, player) {
    state.tiles[position] = player;
    state.inventory[player].tiles -= 1;
    return state;
}

/**
 * Simulate placing a disc
 */
function simulateDiscPlacement(state, position, player) {
    state.pieces[position] = {
        type: 'disc',
        color: player
    };
    state.inventory[player].discs -= 1;
    return state;
}

/**
 * Simulate placing a ring
 */
function simulateRingPlacement(state, position, player) {
    state.pieces[position] = {
        type: 'ring',
        color: player
    };
    state.inventory[player].rings -= 1;

    // Return one captured disc to the opponent's inventory
    const opponent = player === 'black' ? 'white' : 'black';
    state.captured[`${player}_discs`] -= 1;
    state.inventory[opponent].discs += 1;

    return state;
}

/**
 * Simulate moving a disc
 */
function simulateDiscMove(state, fromPosition, toPosition) {
    // Ensure positions are strings in "q,r" format
    if (Array.isArray(fromPosition)) {
        fromPosition = `${fromPosition[0]},${fromPosition[1]}`;
    }
    if (Array.isArray(toPosition)) {
        toPosition = `${toPosition[0]},${toPosition[1]}`;
    }

    // Move the disc to the new position
    state.pieces[toPosition] = state.pieces[fromPosition];
    delete state.pieces[fromPosition];

    return state;
}

/**
 * Simulate a single jump
 */
function simulateJump(state, fromPosition, overPosition, toPosition) {
    if (!(fromPosition in state.pieces)) {
        return state;
    }

    if (overPosition in state.pieces) {
        const overPiece = state.pieces[overPosition];
        const fromPiece = state.pieces[fromPosition];
        if (overPiece.color !== fromPiece.color) {
            delete state.pieces[overPosition];
            if (overPiece.type === 'disc') {
                state.captured[`${fromPiece.color}_discs`] += 1;
            }
            if (overPiece.type === 'ring') {
                state.captured[`${fromPiece.color}_rings`] += 1;
            }
        }
    }
    state.pieces[toPosition] = state.pieces[fromPosition];
    delete state.pieces[fromPosition];

    return state;
}

/**
 * Simulate a sequence of disc jumps
 */
function simulateDiscJumpSequence(state, jumpSequence) {
    for (let i = 0; i < jumpSequence.length - 1; i++) {
        let fromPosition = jumpSequence[i];
        let toPosition = jumpSequence[i + 1];

        if (Array.isArray(fromPosition)) {
            fromPosition = `${fromPosition[0]},${fromPosition[1]}`;
        }
        if (Array.isArray(toPosition)) {
            toPosition = `${toPosition[0]},${toPosition[1]}`;
        }

        // Calculate the position of the piece being jumped over
        const [fromQ, fromR] = fromPosition.split(',').map(Number);
        const [toQ, toR] = toPosition.split(',').map(Number);
        const overPosition = `${Math.floor((fromQ + toQ) / 2)},${Math.floor((fromR + toR) / 2)}`;

        simulateJump(state, fromPosition, overPosition, toPosition);
    }

    return state;
}

/**
 * Simulate moving a ring
 */
function simulateRingMove(state, fromPosition, toPosition) {
    // Check if the target position contains an opponent's piece
    if (toPosition in state.pieces && state.pieces[toPosition].color !== state.pieces[fromPosition].color) {
        // Capture the opponent's piece
        const capturedPiece = state.pieces[toPosition];
        delete state.pieces[toPosition];
        if (capturedPiece.type === 'disc') {
            state.captured[`${state.pieces[fromPosition].color}_discs`] += 1;
        } else if (capturedPiece.type === 'ring') {
            state.captured[`${state.pieces[fromPosition].color}_rings`] += 1;
        }
    }

    // Move the ring to the new position
    state.pieces[toPosition] = state.pieces[fromPosition];
    delete state.pieces[fromPosition];

    return state;
}

/**
 * Get valid tile placements
 */
function getValidTilePlacements(state, player) {
    const validPositions = new Set();

    // Only allow tile placement if player has tiles left
    let tilesLeft = state.inventory[player].tiles;
    if (typeof tilesLeft === 'object') {
        tilesLeft = tilesLeft.tiles || 0;
    }

    if (tilesLeft <= 0) {
        return [];
    }

    // Collect all empty neighboring positions of existing tiles
    const emptyNeighbors = new Set();
    for (const position in state.tiles) {
        for (const neighbor of getNeighbors(position)) {
            if (!(neighbor in state.tiles)) {
                emptyNeighbors.add(neighbor);
            }
        }
    }

    // For each empty neighbor, check if it has at least 2 adjacent tiles
    for (const position of emptyNeighbors) {
        let adjacentCount = 0;
        for (const neighbor of getNeighbors(position)) {
            if (neighbor in state.tiles) {
                adjacentCount++;
            }
        }
        if (adjacentCount >= 2) {
            validPositions.add(position);
        }
    }

    return Array.from(validPositions);
}

/**
 * Get neighbors of a hex position
 */
function getNeighbors(position) {
    if (Array.isArray(position)) {
        position = `${position[0]},${position[1]}`;
    }

    const [q, r] = position.split(',').map(Number);
    const directions = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const neighbors = directions.map(([dq, dr]) => `${q + dq},${r + dr}`);
    return neighbors;
}

/**
 * Get valid disc placements
 */
function getValidDiscPlacements(state, player) {
    const validPositions = [];

    // Check if the player has at least one disc in their inventory
    if (state.inventory[player] && state.inventory[player].discs > 0) {
        // Loop through all board positions
        for (const position in state.tiles) {
            const tileColor = state.tiles[position];
            if (tileColor === player && !(position in state.pieces)) {
                validPositions.push(position);
            }
        }
    }

    return validPositions;
}

/**
 * Get valid ring placements
 */
function getValidRingPlacements(state, player) {
    const validPositions = [];

    // Check if the player has a ring and a captured disc to return
    if (state.inventory[player].rings > 0 && state.captured[`${player}_discs`] > 0) {
        // Loop through all board positions
        for (const position in state.tiles) {
            const tileColor = state.tiles[position];
            if (tileColor === player && !(position in state.pieces)) {
                validPositions.push(position);
            }
        }
    }

    return validPositions;
}

/**
 * Get valid disc moves
 */
function getValidDiscMoves(state, player) {
    const validMoves = [];

    // Loop through all pieces on the board
    for (const position in state.pieces) {
        const piece = state.pieces[position];
        if (piece.type === 'disc' && piece.color === player) {
            for (const neighbor of getNeighbors(position)) {
                if (neighbor in state.tiles && state.tiles[neighbor] && !(neighbor in state.pieces)) {
                    validMoves.push([position, neighbor]);
                }
            }
        }
    }

    return validMoves;
}

/**
 * Get valid disc jumps
 */
function getValidDiscJumps(state, player) {
    const validJumps = [];

    // Helper function to recursively find all jump sequences
    function findJumps(currentState, currentPosition, jumpSequence, visited, jumpedPieces, captureCount) {
        let hasJump = false;

        // Ensure current_position is a string "q,r"
        if (Array.isArray(currentPosition)) {
            currentPosition = `${currentPosition[0]},${currentPosition[1]}`;
        }

        // Ensure currentState.pieces is not null
        if (!currentState || !currentState.pieces) {
            return;
        }

        for (const neighbor of getNeighbors(currentPosition)) {
            // Check if the neighbor is a piece
            if (neighbor in currentState.pieces && ['disc', 'ring'].includes(currentState.pieces[neighbor].type)) {
                // Calculate the landing position
                const [currentQ, currentR] = currentPosition.split(',').map(Number);
                const [neighborQ, neighborR] = neighbor.split(',').map(Number);
                const dx = neighborQ - currentQ;
                const dy = neighborR - currentR;
                const landingQ = currentQ + 2 * dx;
                const landingR = currentR + 2 * dy;
                const landingPosition = `${landingQ},${landingR}`;

                // Check if the landing position is valid
                if (
                    landingPosition in currentState.tiles &&
                    !(landingPosition in currentState.pieces) &&
                    !jumpedPieces.has(neighbor)
                ) {
                    hasJump = true;

                    // Check for capture
                    let newCaptureCount = captureCount;
                    const overPiece = currentState.pieces[neighbor];
                    const fromPiece = currentState.pieces[currentPosition];
                    if (overPiece.color !== fromPiece.color) {
                        newCaptureCount++;
                    }

                    // Simulate the jump
                    const newState = deepClone(currentState);
                    simulateJump(newState, currentPosition, neighbor, landingPosition);
                    const newJumpedPieces = new Set(jumpedPieces);
                    newJumpedPieces.add(neighbor);
                    findJumps(
                        newState,
                        landingPosition,
                        [...jumpSequence, landingPosition],
                        new Set([...visited, landingPosition]),
                        newJumpedPieces,
                        newCaptureCount
                    );
                }
            }
        }

        // If no further jumps are possible, add the jump sequence to valid jumps
        if (!hasJump && jumpSequence.length > 1) {
            // Check if the move is valid: must change state (position changed OR captured something)
            const startPos = jumpSequence[0];
            const endPos = jumpSequence[jumpSequence.length - 1];

            if (startPos === endPos && captureCount === 0) {
                // Invalid move: loop back with no capture
                return;
            }

            validJumps.push(jumpSequence);
        }
    }

    // Loop through all pieces on the board
    for (const position in state.pieces) {
        const piece = state.pieces[position];
        if (piece.type === 'disc' && piece.color === player) {
            findJumps(state, position, [position], new Set([position]), new Set(), 0);
        }
    }

    return validJumps;
}

/**
 * Get valid ring moves
 */
function getValidRingMoves(state, player) {
    const validMoves = [];

    // Define the 12 possible directions for a ring to move exactly 2 tiles away
    const directions = [
        [-2, 0], [2, 0],      // Horizontal
        [1, -2], [-1, 2],     // Vertical
        [0, -2], [0, 2],      // Diagonal top-left to bottom-right
        [2, -2], [-2, 2],     // Diagonal top-right to bottom-left
        [-1, -1], [1, 1],     // L-shaped moves
        [-2, 1], [2, -1]      // L-shaped moves
    ];

    // Loop through all pieces on the board
    for (const position in state.pieces) {
        const piece = state.pieces[position];
        if (piece.type === 'ring' && piece.color === player) {
            for (const [dx, dy] of directions) {
                // Parse position
                let q, r;
                if (typeof position === 'string') {
                    [q, r] = position.split(',').map(Number);
                } else {
                    [q, r] = position;
                }

                // Calculate the landing position
                const landingPosition = `${q + dx},${r + dy}`;

                // Check if the landing position is valid
                if (landingPosition in state.tiles) {
                    if (!(landingPosition in state.pieces)) {
                        // Empty tile
                        validMoves.push([position, landingPosition]);
                    } else if (state.pieces[landingPosition].color !== player) {
                        // Enemy piece to capture
                        validMoves.push([position, landingPosition]);
                    }
                }
            }
        }
    }

    return validMoves;
}

// Export functions for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        processGameState,
        minimax,
        evaluate,
        isTerminal,
        getChildren
    };
}

