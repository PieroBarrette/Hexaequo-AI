/**
 * AI Engine - Minimax algorithm with Alpha-Beta Pruning
 * 
 * Ported from hexaequo-v2/ai.js for ES module compatibility
 */

// Default search depth
let AI_SEARCH_DEPTH = 3;

/**
 * Deep clone a game state object
 */
function deepClone(obj) {
    if (typeof structuredClone === 'function') {
        return structuredClone(obj);
    }
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Process game state and return the AI's move
 * @param {Object} gameState - Current game state in AI format
 * @param {number} depth - Search depth (2-4)
 * @returns {Object} Updated game state after AI move
 */
export function processGameState(gameState, depth = 3) {
    // AI plays as white (opponent)
    if (gameState.activePlayer === 'black') {
        return gameState;
    }

    AI_SEARCH_DEPTH = depth;

    let bestMove = null;
    let bestScore = Infinity; // Minimizing for white

    // Generate direct children of the initial board state
    const children = getChildren(gameState, '1');

    if (children.length === 0) {
        console.warn('No valid moves found for AI');
        return gameState;
    }

    // Evaluate each child
    for (const child of children) {
        const [score] = minimax(child, AI_SEARCH_DEPTH, -Infinity, Infinity, true, child.branch || '1');

        if (score < bestScore) {
            bestScore = score;
            bestMove = child;
        }
    }

    if (!bestMove) {
        console.warn('No valid move found, returning current state');
        return gameState;
    }

    // Ensure proper formatting
    for (const player of ['black', 'white']) {
        if (bestMove.inventory[player]) {
            bestMove.inventory[player].tiles = parseInt(bestMove.inventory[player].tiles) || 0;
            bestMove.inventory[player].discs = parseInt(bestMove.inventory[player].discs) || 0;
            bestMove.inventory[player].rings = parseInt(bestMove.inventory[player].rings) || 0;
        }
        if (bestMove.captured) {
            bestMove.captured[`${player}_discs`] = parseInt(bestMove.captured[`${player}_discs`]) || 0;
            bestMove.captured[`${player}_rings`] = parseInt(bestMove.captured[`${player}_rings`]) || 0;
        }
    }

    // Switch active player
    bestMove.activePlayer = 'black';

    console.log(`AI (Level ${depth}) finished. Score: ${bestScore}`);

    return bestMove;
}

/**
 * Minimax algorithm with Alpha-Beta Pruning
 */
function minimax(state, depth, alpha, beta, maximizingPlayer, branchPrefix) {
    if (depth === 0 || isTerminal(state)) {
        return [evaluate(state), 0];
    }

    let prunedBranches = 0;
    const children = getChildren(state, branchPrefix);

    if (maximizingPlayer) {
        let maxEval = -Infinity;
        for (const child of children) {
            const [evalScore, childPruned] = minimax(
                child, depth - 1, alpha, beta, false, child.branch || branchPrefix
            );
            maxEval = Math.max(maxEval, evalScore);
            prunedBranches += childPruned;
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
            const [evalScore, childPruned] = minimax(
                child, depth - 1, alpha, beta, true, child.branch || branchPrefix
            );
            minEval = Math.min(minEval, evalScore);
            prunedBranches += childPruned;
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
    );

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
 * Positive = Good for Black, Negative = Good for White
 */
function evaluate(state) {
    let blackScore = 0;
    let whiteScore = 0;

    const W_DISC = 10;
    const W_RING = 30;
    const W_CAPTURED_DISC = 15;
    const W_CAPTURED_RING = 50;
    const W_TILE = 2;

    // Score pieces on the board
    for (const position in state.pieces) {
        const piece = state.pieces[position];
        if (piece.type === 'disc') {
            if (piece.color === 'black') blackScore += W_DISC;
            else whiteScore += W_DISC;
        } else if (piece.type === 'ring') {
            if (piece.color === 'black') blackScore += W_RING;
            else whiteScore += W_RING;
        }
    }

    // Score captured pieces
    blackScore += state.captured.black_discs * W_CAPTURED_DISC;
    blackScore += state.captured.black_rings * W_CAPTURED_RING;
    whiteScore += state.captured.white_discs * W_CAPTURED_DISC;
    whiteScore += state.captured.white_rings * W_CAPTURED_RING;

    // Score empty tiles
    for (const position in state.tiles) {
        if (!(position in state.pieces)) {
            const tileColor = state.tiles[position];
            if (tileColor === 'black') blackScore += W_TILE;
            else if (tileColor === 'white') whiteScore += W_TILE;
        }
    }

    // Win/Loss check
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

    return blackScore - whiteScore;
}

/**
 * Generate all possible child states
 */
function getChildren(state, branchPrefix) {
    const children = [];
    const player = state.activePlayer;
    let moveIndex = 1;

    // 1. Disc jumps (captures first for better pruning)
    const discJumps = getValidDiscJumps(state, player);
    for (const jumpSequence of discJumps) {
        const newState = deepClone(state);
        simulateDiscJumpSequence(newState, jumpSequence);
        newState.activePlayer = player === 'black' ? 'white' : 'black';
        newState.branch = `${branchPrefix}.${moveIndex}`;
        if (branchPrefix === '1') {
            newState.lastJumpPath = jumpSequence.map(pos => {
                const [q, r] = pos.split(',').map(Number);
                return { q, r };
            });
        }
        children.push(newState);
        moveIndex++;
    }

    // 2. Ring moves
    const ringMoves = getValidRingMoves(state, player);
    for (const [fromPosition, toPosition] of ringMoves) {
        const newState = deepClone(state);
        simulateRingMove(newState, fromPosition, toPosition);
        newState.activePlayer = player === 'black' ? 'white' : 'black';
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    // 3. Disc moves
    const discMoves = getValidDiscMoves(state, player);
    for (const [fromPosition, toPosition] of discMoves) {
        if (!(fromPosition in state.pieces)) continue;
        const newState = deepClone(state);
        simulateDiscMove(newState, fromPosition, toPosition);
        newState.activePlayer = player === 'black' ? 'white' : 'black';
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    // 4. Ring placements
    const ringPlacements = getValidRingPlacements(state, player);
    for (const position of ringPlacements) {
        const newState = deepClone(state);
        simulateRingPlacement(newState, position, player);
        newState.activePlayer = player === 'black' ? 'white' : 'black';
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    // 5. Disc placements
    const discPlacements = getValidDiscPlacements(state, player);
    for (const position of discPlacements) {
        const newState = deepClone(state);
        simulateDiscPlacement(newState, position, player);
        newState.activePlayer = player === 'black' ? 'white' : 'black';
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    // 6. Tile placements
    const tilePlacements = getValidTilePlacements(state, player);
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

// Helper functions

function getNeighbors(position) {
    if (Array.isArray(position)) {
        position = `${position[0]},${position[1]}`;
    }
    const [q, r] = position.split(',').map(Number);
    const directions = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return directions.map(([dq, dr]) => `${q + dq},${r + dr}`);
}

function simulateTilePlacement(state, position, player) {
    state.tiles[position] = player;
    state.inventory[player].tiles -= 1;
    return state;
}

function simulateDiscPlacement(state, position, player) {
    state.pieces[position] = { type: 'disc', color: player };
    state.inventory[player].discs -= 1;
    return state;
}

function simulateRingPlacement(state, position, player) {
    state.pieces[position] = { type: 'ring', color: player };
    state.inventory[player].rings -= 1;
    const opponent = player === 'black' ? 'white' : 'black';
    state.captured[`${player}_discs`] -= 1;
    state.inventory[opponent].discs += 1;
    return state;
}

function simulateDiscMove(state, fromPosition, toPosition) {
    if (Array.isArray(fromPosition)) fromPosition = `${fromPosition[0]},${fromPosition[1]}`;
    if (Array.isArray(toPosition)) toPosition = `${toPosition[0]},${toPosition[1]}`;
    state.pieces[toPosition] = state.pieces[fromPosition];
    delete state.pieces[fromPosition];
    return state;
}

function simulateJump(state, fromPosition, overPosition, toPosition) {
    if (!(fromPosition in state.pieces)) return state;

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

function simulateDiscJumpSequence(state, jumpSequence) {
    for (let i = 0; i < jumpSequence.length - 1; i++) {
        let fromPosition = jumpSequence[i];
        let toPosition = jumpSequence[i + 1];
        if (Array.isArray(fromPosition)) fromPosition = `${fromPosition[0]},${fromPosition[1]}`;
        if (Array.isArray(toPosition)) toPosition = `${toPosition[0]},${toPosition[1]}`;

        const [fromQ, fromR] = fromPosition.split(',').map(Number);
        const [toQ, toR] = toPosition.split(',').map(Number);
        const overPosition = `${Math.floor((fromQ + toQ) / 2)},${Math.floor((fromR + toR) / 2)}`;
        simulateJump(state, fromPosition, overPosition, toPosition);
    }
    return state;
}

function simulateRingMove(state, fromPosition, toPosition) {
    if (toPosition in state.pieces && state.pieces[toPosition].color !== state.pieces[fromPosition].color) {
        const capturedPiece = state.pieces[toPosition];
        delete state.pieces[toPosition];
        if (capturedPiece.type === 'disc') {
            state.captured[`${state.pieces[fromPosition].color}_discs`] += 1;
        } else if (capturedPiece.type === 'ring') {
            state.captured[`${state.pieces[fromPosition].color}_rings`] += 1;
        }
    }
    state.pieces[toPosition] = state.pieces[fromPosition];
    delete state.pieces[fromPosition];
    return state;
}

function getValidTilePlacements(state, player) {
    const validPositions = new Set();
    let tilesLeft = state.inventory[player]?.tiles || 0;
    if (typeof tilesLeft === 'object') tilesLeft = tilesLeft.tiles || 0;
    if (tilesLeft <= 0) return [];

    const emptyNeighbors = new Set();
    for (const position in state.tiles) {
        for (const neighbor of getNeighbors(position)) {
            if (!(neighbor in state.tiles)) {
                emptyNeighbors.add(neighbor);
            }
        }
    }

    for (const position of emptyNeighbors) {
        let adjacentCount = 0;
        for (const neighbor of getNeighbors(position)) {
            if (neighbor in state.tiles) adjacentCount++;
        }
        if (adjacentCount >= 2) {
            validPositions.add(position);
        }
    }

    return Array.from(validPositions);
}

function getValidDiscPlacements(state, player) {
    const validPositions = [];
    if (state.inventory[player]?.discs > 0) {
        for (const position in state.tiles) {
            if (state.tiles[position] === player && !(position in state.pieces)) {
                validPositions.push(position);
            }
        }
    }
    return validPositions;
}

function getValidRingPlacements(state, player) {
    const validPositions = [];
    if (state.inventory[player]?.rings > 0 && state.captured[`${player}_discs`] > 0) {
        for (const position in state.tiles) {
            if (state.tiles[position] === player && !(position in state.pieces)) {
                validPositions.push(position);
            }
        }
    }
    return validPositions;
}

function getValidDiscMoves(state, player) {
    const validMoves = [];
    for (const position in state.pieces) {
        const piece = state.pieces[position];
        if (piece.type === 'disc' && piece.color === player) {
            for (const neighbor of getNeighbors(position)) {
                if (neighbor in state.tiles && !(neighbor in state.pieces)) {
                    validMoves.push([position, neighbor]);
                }
            }
        }
    }
    return validMoves;
}

function getValidDiscJumps(state, player) {
    const validJumps = [];

    function findJumps(currentState, currentPosition, jumpSequence, visited, jumpedPieces, captureCount) {
        let hasJump = false;
        if (Array.isArray(currentPosition)) {
            currentPosition = `${currentPosition[0]},${currentPosition[1]}`;
        }
        if (!currentState || !currentState.pieces) return;

        for (const neighbor of getNeighbors(currentPosition)) {
            if (neighbor in currentState.pieces && ['disc', 'ring'].includes(currentState.pieces[neighbor].type)) {
                const [currentQ, currentR] = currentPosition.split(',').map(Number);
                const [neighborQ, neighborR] = neighbor.split(',').map(Number);
                const landingQ = currentQ + 2 * (neighborQ - currentQ);
                const landingR = currentR + 2 * (neighborR - currentR);
                const landingPosition = `${landingQ},${landingR}`;

                if (
                    landingPosition in currentState.tiles &&
                    !(landingPosition in currentState.pieces) &&
                    !jumpedPieces.has(neighbor)
                ) {
                    hasJump = true;
                    let newCaptureCount = captureCount;
                    const overPiece = currentState.pieces[neighbor];
                    const fromPiece = currentState.pieces[currentPosition];
                    if (overPiece.color !== fromPiece.color) {
                        newCaptureCount++;
                    }

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

        if (!hasJump && jumpSequence.length > 1) {
            const startPos = jumpSequence[0];
            const endPos = jumpSequence[jumpSequence.length - 1];
            if (startPos === endPos && captureCount === 0) return;
            validJumps.push(jumpSequence);
        }
    }

    for (const position in state.pieces) {
        const piece = state.pieces[position];
        if (piece.type === 'disc' && piece.color === player) {
            findJumps(state, position, [position], new Set([position]), new Set(), 0);
        }
    }

    return validJumps;
}

function getValidRingMoves(state, player) {
    const validMoves = [];
    const directions = [
        [-2, 0], [2, 0], [1, -2], [-1, 2], [0, -2], [0, 2],
        [2, -2], [-2, 2], [-1, -1], [1, 1], [-2, 1], [2, -1]
    ];

    for (const position in state.pieces) {
        const piece = state.pieces[position];
        if (piece.type === 'ring' && piece.color === player) {
            for (const [dx, dy] of directions) {
                const [q, r] = position.split(',').map(Number);
                const landingPosition = `${q + dx},${r + dy}`;

                if (landingPosition in state.tiles) {
                    if (!(landingPosition in state.pieces)) {
                        validMoves.push([position, landingPosition]);
                    } else if (state.pieces[landingPosition].color !== player) {
                        validMoves.push([position, landingPosition]);
                    }
                }
            }
        }
    }

    return validMoves;
}

export default { processGameState };
