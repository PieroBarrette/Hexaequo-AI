// ai.js
// Hexaequo AI - JavaScript conversion from Python AI.py
// Minimax algorithm with Alpha-Beta Pruning

// ============================================
// CONFIGURATION
// ============================================
// Profondeur de recherche de l'algorithme Minimax
// Plus la profondeur est élevée, plus l'IA est forte mais plus le calcul est long
// Valeurs recommandées: 2 (rapide), 3 (moyen), 4 (fort mais lent)
const AI_SEARCH_DEPTH = 3;

// ============================================

/**
 * Deep clone a game state object
 */
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Log the differences between the original game state and the proposed game state.
 */
function logMoveDifferences(originalState, proposedState) {
    const differences = {
        tiles: {},
        pieces: {},
        inventory: {},
        captured: {},
        activePlayer: null
    };

    // Compare tiles
    for (const position in proposedState.tiles) {
        if (!(position in originalState.tiles) || originalState.tiles[position] !== proposedState.tiles[position]) {
            differences.tiles[position] = proposedState.tiles[position];
        }
    }

    for (const position in originalState.tiles) {
        if (!(position in proposedState.tiles)) {
            differences.tiles[position] = null;
        }
    }

    // Compare pieces
    for (const position in proposedState.pieces) {
        if (!(position in originalState.pieces) ||
            JSON.stringify(originalState.pieces[position]) !== JSON.stringify(proposedState.pieces[position])) {
            differences.pieces[position] = proposedState.pieces[position];
        }
    }

    for (const position in originalState.pieces) {
        if (!(position in proposedState.pieces)) {
            differences.pieces[position] = null;
        }
    }

    // Compare inventory
    for (const player of ['black', 'white']) {
        differences.inventory[player] = {};
        for (const key of ['tiles', 'discs', 'rings']) {
            if (proposedState.inventory[player][key] !== originalState.inventory[player][key]) {
                differences.inventory[player][key] = proposedState.inventory[player][key];
            }
        }
    }

    // Compare captured
    for (const key of ['black_discs', 'black_rings', 'white_discs', 'white_rings']) {
        if (proposedState.captured[key] !== originalState.captured[key]) {
            differences.captured[key] = proposedState.captured[key];
        }
    }

    // Compare active player
    if (proposedState.activePlayer !== originalState.activePlayer) {
        differences.activePlayer = proposedState.activePlayer;
    }

    console.log('Differences between original and proposed state:', differences);
}

/**
 * Process game state and return the AI's move
 */
function processGameState(gameState) {
    if (gameState.activePlayer === 'black') {
        return gameState;
    }

    // Determine the best move using Minimax
    let bestMove = null;
    let bestScore = Infinity; // Minimizing for white

    // Total pruned branches counter
    let totalPrunedBranches = 0;

    // Generate direct children of the initial board state
    const children = getChildren(gameState, '1');

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

    // Log the differences between the original and proposed game states
    logMoveDifferences(gameState, bestMove);

    // Convert inventory and captured data to integers
    for (const player of ['black', 'white']) {
        bestMove.inventory[player].tiles = parseInt(bestMove.inventory[player].tiles);
        bestMove.inventory[player].discs = parseInt(bestMove.inventory[player].discs);
        bestMove.inventory[player].rings = parseInt(bestMove.inventory[player].rings);
        bestMove.captured[`${player}_discs`] = parseInt(bestMove.captured[`${player}_discs`]);
        bestMove.captured[`${player}_rings`] = parseInt(bestMove.captured[`${player}_rings`]);
    }

    // Switch the active player to the opponent after the AI's move
    bestMove.activePlayer = 'black';

    // Log the total number of branches pruned during the Minimax execution
    console.log(`Total branches pruned during Minimax execution: ${totalPrunedBranches}`);

    // Log the evaluation score of the chosen move
    const evalScore = evaluate(bestMove);
    console.log(`Evaluation score of chosen move: ${evalScore}`);

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

    if (maximizingPlayer) {
        let maxEval = -Infinity;
        for (const child of getChildren(state, branchPrefix)) {
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
        for (const child of getChildren(state, branchPrefix)) {
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
    const blackHasPieces = Object.values(state.pieces).some(
        piece => piece.color === 'black' && ['disc', 'ring'].includes(piece.type)
    );
    const whiteHasPieces = Object.values(state.pieces).some(
        piece => piece.color === 'white' && ['disc', 'ring'].includes(piece.type)
    );

    const terminal = (
        state.captured.black_discs >= 6 ||
        state.captured.white_discs >= 6 ||
        state.captured.black_rings >= 3 ||
        state.captured.white_rings >= 3 ||
        !blackHasPieces || !whiteHasPieces ||
        getChildren(state, state.branch || '').length === 0 // Stalemate: no available moves
    );
    return terminal;
}

/**
 * Evaluate the game state
 */
function evaluate(state) {
    let blackScore = 0;
    let whiteScore = 0;

    // Score pieces on the board
    for (const position in state.pieces) {
        const piece = state.pieces[position];
        if (piece.type === 'disc') {
            if (piece.color === 'black') {
                blackScore += 1;
            } else {
                whiteScore += 1;
            }
        } else if (piece.type === 'ring') {
            if (piece.color === 'black') {
                blackScore += 3;
            } else {
                whiteScore += 3;
            }
        }
    }

    // Simple scoring for captured pieces
    blackScore += state.captured.black_discs * 1.5;
    blackScore += state.captured.black_rings * 4.5;
    whiteScore += state.captured.white_discs * 1.5;
    whiteScore += state.captured.white_rings * 4.5;

    // Score empty tiles of own color
    for (const position in state.tiles) {
        if (!(position in state.pieces)) {
            const tileColor = state.tiles[position];
            if (tileColor === 'black') {
                blackScore += 0.2;
            } else if (tileColor === 'white') {
                whiteScore += 0.2;
            }
        }
    }

    let score = blackScore - whiteScore;

    const blackHasPieces = Object.values(state.pieces).some(
        piece => piece.color === 'black' && ['disc', 'ring'].includes(piece.type)
    );
    const whiteHasPieces = Object.values(state.pieces).some(
        piece => piece.color === 'white' && ['disc', 'ring'].includes(piece.type)
    );

    if (state.captured.black_discs >= 6 || state.captured.black_rings >= 3 || !whiteHasPieces) {
        score = 999;
    } else if (state.captured.white_discs >= 6 || state.captured.white_rings >= 3 || !blackHasPieces) {
        score = -999;
    }

    // Stalemate: if the active player has no available moves, it's Ex Aequo (draw)
    if (getChildren(state, state.branch || '').length === 0) {
        score = 0;
    }

    return score;
}

/**
 * Generate all possible child states (moves)
 */
function getChildren(state, branchPrefix) {
    const children = [];
    const player = state.activePlayer;

    // Generate all possible moves for the current player
    const ringMoves = getValidRingMoves(state, player);
    const discJumps = getValidDiscJumps(state, player);
    const discMoves = getValidDiscMoves(state, player);
    const ringPlacements = getValidRingPlacements(state, player);
    const discPlacements = getValidDiscPlacements(state, player);
    const tilePlacements = getValidTilePlacements(state, player);

    let moveIndex = 1;

    // Simulate ring moves
    for (const [fromPosition, toPosition] of ringMoves) {
        const newState = deepClone(state);
        simulateRingMove(newState, fromPosition, toPosition);
        newState.activePlayer = player === 'black' ? 'white' : 'black';
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    // Simulate disc jumps
    for (const jumpSequence of discJumps) {
        const newState = deepClone(state);
        simulateDiscJumpSequence(newState, jumpSequence);
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

