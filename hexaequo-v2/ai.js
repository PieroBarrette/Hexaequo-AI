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
// TABLE DE TRANSPOSITION
// ============================================
const transpositionTable = new Map();
const MAX_TABLE_SIZE = 100000;

// ============================================
// DÉTECTION DE RÉPÉTITION TRIPLE (3-fold repetition)
// ============================================
// Historique des positions pour détecter les répétitions
let positionHistory = [];

/**
 * Génère un hash de position pour la détection de répétition
 * Similaire à getPositionHash dans game.js
 */
function getPositionHash(state) {
    const tilesStr = Object.keys(state.tiles).sort().map(k => `${k}:${state.tiles[k]}`).join('|');
    const piecesStr = Object.keys(state.pieces).sort().map(k => {
        const p = state.pieces[k];
        return `${k}:${p.type}:${p.color}`;
    }).join('|');
    const inv = state.inventory;
    const inventoryStr = `b:${inv.black.tiles},${inv.black.discs},${inv.black.rings}|w:${inv.white.tiles},${inv.white.discs},${inv.white.rings}`;
    return `${state.activePlayer}#${tilesStr}#${piecesStr}#${inventoryStr}`;
}

/**
 * Initialise l'historique des positions à partir du moveHistory du jeu
 * @param {Array} moveHistory - Historique des coups du jeu (optionnel)
 */
function initPositionHistory(moveHistory = []) {
    positionHistory = [];
    if (moveHistory && moveHistory.length > 0) {
        for (const entry of moveHistory) {
            if (entry.positionHash) {
                positionHistory.push(entry.positionHash);
            } else if (entry.gameState) {
                positionHistory.push(getPositionHash(entry.gameState));
            }
        }
    }
}

/**
 * Vérifie si une position causerait une répétition triple
 * @param {string} positionHash - Hash de la position à vérifier
 * @param {Array} history - Historique des positions (incluant la position actuelle)
 * @returns {boolean} true si répétition triple détectée
 */
function wouldCauseThreefoldRepetition(positionHash, history) {
    let count = 0;
    for (const hash of history) {
        if (hash === positionHash) {
            count++;
            if (count >= 2) { // 2 dans l'historique + la nouvelle = 3
                return true;
            }
        }
    }
    return false;
}

/**
 * Compte les occurrences d'une position dans l'historique
 * @param {string} positionHash - Hash de la position
 * @param {Array} history - Historique des positions
 * @returns {number} Nombre d'occurrences
 */
function countPositionOccurrences(positionHash, history) {
    let count = 0;
    for (const hash of history) {
        if (hash === positionHash) {
            count++;
        }
    }
    return count;
}

/**
 * Génère une clé de hachage pour un état de jeu
 */
function hashState(state) {
    const pieces = Object.entries(state.pieces)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pos, p]) => `${pos}:${p.type[0]}${p.color[0]}`)
        .join('|');
    
    const tiles = Object.entries(state.tiles)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pos, c]) => `${pos}:${c[0]}`)
        .join('|');
    
    return `${state.activePlayer}|${pieces}|${tiles}|${state.captured.black_discs},${state.captured.black_rings},${state.captured.white_discs},${state.captured.white_rings}`;
}

/**
 * Nettoyer la table de transposition entre les parties
 */
function clearTranspositionTable() {
    transpositionTable.clear();
}

// ============================================

/**
 * Deep clone a game state object (legacy - utiliser cloneGameState pour les performances)
 */
function deepClone(obj) {
    if (typeof structuredClone === 'function') {
        return structuredClone(obj);
    }
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Clone optimisé pour l'état de jeu (évite la sérialisation complète)
 */
function cloneGameState(state) {
    return {
        tiles: { ...state.tiles },
        pieces: Object.fromEntries(
            Object.entries(state.pieces).map(([k, v]) => [k, { ...v }])
        ),
        inventory: {
            black: { ...state.inventory.black },
            white: { ...state.inventory.white }
        },
        captured: { ...state.captured },
        activePlayer: state.activePlayer,
        branch: state.branch
    };
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
 * @param {Object} gameState - Current game state
 * @param {number} depth - Search depth (1-4)
 * @param {string} aiColor - Color the AI plays ('black' or 'white'). Defaults to 'white' for backwards compatibility.
 * @param {Array} moveHistory - Historique des coups pour la détection de répétition triple (optionnel)
 */
function processGameState(gameState, depth = 3, aiColor = 'white', moveHistory = []) {
    // AI only plays when it's its turn
    if (gameState.activePlayer !== aiColor) {
        return gameState;
    }

    // Initialiser l'historique des positions pour la détection de répétition
    initPositionHistory(moveHistory);
    
    // Ajouter la position actuelle à l'historique
    const currentHash = getPositionHash(gameState);
    positionHistory.push(currentHash);

    // Nettoyer la table de transposition pour une nouvelle recherche
    clearTranspositionTable();

    // Update global depth if provided
    AI_SEARCH_DEPTH = depth;

    // Determine if AI is maximizing (black) or minimizing (white)
    const aiIsBlack = aiColor === 'black';
    
    // Determine the best move using Minimax
    let bestMove = null;
    let bestScore = aiIsBlack ? -Infinity : Infinity;

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
        // For black (maximizing at root), start minimax with maximizing=false (opponent's turn next)
        // For white (minimizing at root), start minimax with maximizing=true (opponent's turn next)
        const startAsMaximizing = !aiIsBlack;
        const [score, pruned] = minimax(child, AI_SEARCH_DEPTH, -Infinity, Infinity, startAsMaximizing, child.branch || '1');
        totalPrunedBranches += pruned;

        // Update best_move and best_score based on AI color
        if (aiIsBlack) {
            // Black maximizes
            if (score > bestScore) {
                bestScore = score;
                bestMove = child;
            }
        } else {
            // White minimizes
            if (score < bestScore) {
                bestScore = score;
                bestMove = child;
            }
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
    const opponentColor = aiColor === 'black' ? 'white' : 'black';
    bestMove.activePlayer = opponentColor;

    console.log(`AI (${aiColor}, Level ${depth}) finished. Score: ${bestScore}. Pruned: ${totalPrunedBranches}`);

    return bestMove;
}

/**
 * Recherche quiescence - continue à chercher dans les positions "instables" (captures)
 */
/*function quiescenceSearch(state, alpha, beta, maximizingPlayer, maxDepth = 3) {
    const standPat = evaluateQuick(state);
    
    if (maxDepth === 0) return standPat;
    
    if (maximizingPlayer) {
        if (standPat >= beta) return beta;
        if (standPat > alpha) alpha = standPat;
        
        // Ne chercher que les captures (jumps)
        const captures = getValidDiscJumps(state, state.activePlayer);
        
        for (const jumpSeq of captures) {
            const newState = cloneGameState(state);
            simulateDiscJumpSequence(newState, jumpSeq);
            newState.activePlayer = state.activePlayer === 'black' ? 'white' : 'black';
            
            const score = quiescenceSearch(newState, alpha, beta, false, maxDepth - 1);
            if (score >= beta) return beta;
            if (score > alpha) alpha = score;
        }
        return alpha;
    } else {
        if (standPat <= alpha) return alpha;
        if (standPat < beta) beta = standPat;
        
        const captures = getValidDiscJumps(state, state.activePlayer);
        
        for (const jumpSeq of captures) {
            const newState = cloneGameState(state);
            simulateDiscJumpSequence(newState, jumpSeq);
            newState.activePlayer = state.activePlayer === 'black' ? 'white' : 'black';
            
            const score = quiescenceSearch(newState, alpha, beta, true, maxDepth - 1);
            if (score <= alpha) return alpha;
            if (score < beta) beta = score;
        }
        return beta;
    }
}*/

/**
 * Minimax algorithm with Alpha-Beta Pruning and Transposition Table
 * Inclut la détection de répétition triple (3-fold repetition)
 */
function minimax(state, depth, alpha, beta, maximizingPlayer, branchPrefix, searchHistory = null) {
    // Initialiser l'historique de recherche si non fourni
    if (searchHistory === null) {
        searchHistory = [...positionHistory];
    }
    
    // Vérifier la répétition triple - retourner 0 (match nul) si détectée
    const posHash = getPositionHash(state);
    if (wouldCauseThreefoldRepetition(posHash, searchHistory)) {
        return [0, 0]; // Match nul par répétition triple
    }
    
    const stateHash = hashState(state);
    const cached = transpositionTable.get(stateHash);
    
    // Vérifier le cache avec la profondeur suffisante
    if (cached && cached.depth >= depth) {
        if (cached.flag === 'exact') return [cached.score, 0];
        if (cached.flag === 'lower' && cached.score > alpha) alpha = cached.score;
        if (cached.flag === 'upper' && cached.score < beta) beta = cached.score;
        if (alpha >= beta) return [cached.score, 1];
    }

    // À profondeur 0, évaluer la position
    if (depth === 0) {
        const score = evaluate(state);
        return [score, 0];
    }
    
    if (isTerminal(state)) {
        const score = evaluate(state);
        return [score, 0];
    }

    let prunedBranches = 0;
    const children = getChildren(state, branchPrefix);
    
    if (children.length === 0) {
        return [0, 0]; // Pat
    }

    let bestScore;
    let flag = 'exact';

    if (maximizingPlayer) {
        bestScore = -Infinity;
        for (const child of children) {
            // Créer un nouvel historique avec la position de l'enfant ajoutée
            const childHistory = [...searchHistory, getPositionHash(child)];
            const [evalScore, childPrunedBranches] = minimax(
                child,
                depth - 1,
                alpha,
                beta,
                false,
                child.branch || branchPrefix,
                childHistory
            );
            prunedBranches += childPrunedBranches;
            
            if (evalScore > bestScore) bestScore = evalScore;
            if (bestScore > alpha) alpha = bestScore;
            if (bestScore >= beta) {
                flag = 'lower';
                prunedBranches++;
                break;
            }
        }
    } else {
        bestScore = Infinity;
        for (const child of children) {
            // Créer un nouvel historique avec la position de l'enfant ajoutée
            const childHistory = [...searchHistory, getPositionHash(child)];
            const [evalScore, childPrunedBranches] = minimax(
                child,
                depth - 1,
                alpha,
                beta,
                true,
                child.branch || branchPrefix,
                childHistory
            );
            prunedBranches += childPrunedBranches;
            
            if (evalScore < bestScore) bestScore = evalScore;
            if (bestScore < beta) beta = bestScore;
            if (bestScore <= alpha) {
                flag = 'upper';
                prunedBranches++;
                break;
            }
        }
    }

    // Stocker dans la table (avec limite de taille)
    if (transpositionTable.size < MAX_TABLE_SIZE) {
        transpositionTable.set(stateHash, { score: bestScore, depth, flag });
    }

    return [bestScore, prunedBranches];
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
 * Évaluation rapide pour la recherche quiescence (sans calculs coûteux)
 */
/*function evaluateQuick(state) {
    let blackScore = 0;
    let whiteScore = 0;
    
    let blackPieceCount = 0;
    let whitePieceCount = 0;
    
    // Score pièces sur le plateau
    for (const position in state.pieces) {
        const piece = state.pieces[position];
        if (piece.color === 'black') {
            blackPieceCount++;
            blackScore += piece.type === 'disc' ? 10 : 25;
        } else {
            whitePieceCount++;
            whiteScore += piece.type === 'disc' ? 10 : 25;
        }
    }
    
    // Victoires
    if (state.captured.black_discs >= 6 || state.captured.black_rings >= 3 || whitePieceCount === 0) {
        return 10000;
    }
    if (state.captured.white_discs >= 6 || state.captured.white_rings >= 3 || blackPieceCount === 0) {
        return -10000;
    }
    
    // Captures
    blackScore += state.captured.black_discs * 18 + state.captured.black_rings * 55;
    whiteScore += state.captured.white_discs * 18 + state.captured.white_rings * 55;
    
    return blackScore - whiteScore;
}*/

/**
 * Évaluation rapide d'un coup pour le tri (heuristique légère)
 */
/*function quickEvaluateMove(state, child, player) {
    let score = 0;
    
    // Captures de pièces (très prioritaires)
    const discCaptureDiff = child.captured[`${player}_discs`] - state.captured[`${player}_discs`];
    const ringCaptureDiff = child.captured[`${player}_rings`] - state.captured[`${player}_rings`];
    
    score += discCaptureDiff * 100;
    score += ringCaptureDiff * 300;
    
    // Vérifier victoire imminente
    if (child.captured[`${player}_discs`] >= 6 || child.captured[`${player}_rings`] >= 3) {
        score += 10000;
    }
    
    return score;
}

/**
 * Evaluate the game state (version enrichie)
 * Positive score = Good for Black
 * Negative score = Good for White
 */
function evaluate(state) {
    // Pré-calcul des positions des pièces par couleur
    let blackPieceCount = 0;
    let whitePieceCount = 0;
    const piecesByColor = { black: [], white: [] };
    
    for (const position in state.pieces) {
        const piece = state.pieces[position];
        const [q, r] = position.split(',').map(Number);
        piecesByColor[piece.color].push({ position, piece, q, r });
        if (piece.color === 'black') blackPieceCount++;
        else whitePieceCount++;
    }

    // Victoires (vérifier en premier pour éviter calculs inutiles)
    if (state.captured.black_discs >= 6 || state.captured.black_rings >= 3 || whitePieceCount === 0) {
        return 10000;
    }
    if (state.captured.white_discs >= 6 || state.captured.white_rings >= 3 || blackPieceCount === 0) {
        return -10000;
    }

    let blackScore = 0;
    let whiteScore = 0;

    // Poids ajustés pour une meilleure stratégie
    const WEIGHTS = {
        DISC_ON_BOARD: 10,
        RING_ON_BOARD: 30,
        CAPTURED_DISC: 15,
        CAPTURED_RING: 50,
        TILE_CONTROL: 2,
        //CENTER_BONUS: 1.5,
        //THREAT: 4,
        //CONNECTIVITY: 1.5,
        //NEAR_VICTORY_DISC: 20,
        //NEAR_VICTORY_RING: 30
    };

    // Score des pièces sur le plateau avec bonus de centralité
    for (const color of ['black', 'white']) {
        for (const { piece, q, r, position } of piecesByColor[color]) {
            const baseValue = piece.type === 'disc' ? WEIGHTS.DISC_ON_BOARD : WEIGHTS.RING_ON_BOARD;
            
            // Bonus de centralité (distance du centre)
            //const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
            //const centerBonus = Math.max(0, (4 - dist)) * WEIGHTS.CENTER_BONUS;
            
            // Connectivité (pièces alliées adjacentes)
            /*et connectivity = 0;
            for (const neighbor of getNeighbors(position)) {
                if (neighbor in state.pieces && state.pieces[neighbor].color === color) {
                    connectivity += WEIGHTS.CONNECTIVITY;
                }
            }*/
            
            const totalValue = baseValue /*+ centerBonus + connectivity / 2*/;
            
            if (color === 'black') {
                blackScore += totalValue;
            } else {
                whiteScore += totalValue;
            }
        }
    }

    // Score des captures
    blackScore += state.captured.black_discs * WEIGHTS.CAPTURED_DISC;
    blackScore += state.captured.black_rings * WEIGHTS.CAPTURED_RING;
    whiteScore += state.captured.white_discs * WEIGHTS.CAPTURED_DISC;
    whiteScore += state.captured.white_rings * WEIGHTS.CAPTURED_RING;

    // Contrôle territorial (tuiles vides de sa couleur)
    for (const position in state.tiles) {
        if (!(position in state.pieces)) {
            const tileColor = state.tiles[position];
            if (tileColor === 'black') {
                blackScore += WEIGHTS.TILE_CONTROL;
            } else if (tileColor === 'white') {
                whiteScore += WEIGHTS.TILE_CONTROL;
            }
        }
    }

    // Menaces (possibilités de capture au prochain tour)
    //const blackJumps = getValidDiscJumps(state, 'black');
    //const whiteJumps = getValidDiscJumps(state, 'white');
    //blackScore += blackJumps.length * WEIGHTS.THREAT;
    //whiteScore += whiteJumps.length * WEIGHTS.THREAT;

    // Bonus progressif de proximité de victoire
    /*if (state.captured.black_discs >= 4) {
        blackScore += (state.captured.black_discs - 3) * WEIGHTS.NEAR_VICTORY_DISC;
    }
    if (state.captured.black_rings >= 2) {
        blackScore += (state.captured.black_rings - 1) * WEIGHTS.NEAR_VICTORY_RING;
    }
    if (state.captured.white_discs >= 4) {
        whiteScore += (state.captured.white_discs - 3) * WEIGHTS.NEAR_VICTORY_DISC;
    }
    if (state.captured.white_rings >= 2) {
        whiteScore += (state.captured.white_rings - 1) * WEIGHTS.NEAR_VICTORY_RING;
    }*/

    return blackScore - whiteScore;
}

/**
 * Generate all possible child states (moves) with move ordering for better pruning
 */
function getChildren(state, branchPrefix) {
    const children = [];
    const player = state.activePlayer;
    const opponent = player === 'black' ? 'white' : 'black';

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
        const newState = cloneGameState(state);
        simulateDiscJumpSequence(newState, jumpSequence);
        newState.activePlayer = opponent;
        newState.branch = `${branchPrefix}.${moveIndex}`;
        // Attach the jump path for highlighting (only at depth 1, i.e., direct children)
        if (branchPrefix === '1') {
            newState.lastJumpPath = jumpSequence.map(pos => {
                const [q, r] = pos.split(',').map(Number);
                return { q, r };
            });
        }
        children.push(newState);
        moveIndex++;
    }

    // Simulate ring moves (Potential captures)
    for (const [fromPosition, toPosition] of ringMoves) {
        const newState = cloneGameState(state);
        simulateRingMove(newState, fromPosition, toPosition);
        newState.activePlayer = opponent;
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    // Simulate disc moves
    for (const [fromPosition, toPosition] of discMoves) {
        if (!(fromPosition in state.pieces)) {
            continue;
        }
        const newState = cloneGameState(state);
        simulateDiscMove(newState, fromPosition, toPosition);
        newState.activePlayer = opponent;
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    // Simulate ring placements
    for (const position of ringPlacements) {
        const newState = cloneGameState(state);
        simulateRingPlacement(newState, position, player);
        newState.activePlayer = opponent;
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    // Simulate disc placements
    for (const position of discPlacements) {
        const newState = cloneGameState(state);
        simulateDiscPlacement(newState, position, player);
        newState.activePlayer = opponent;
        newState.branch = `${branchPrefix}.${moveIndex}`;
        children.push(newState);
        moveIndex++;
    }

    // Simulate tile placements
    for (const position of tilePlacements) {
        const newState = cloneGameState(state);
        simulateTilePlacement(newState, position, player);
        newState.activePlayer = opponent;
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
        //evaluateQuick,
        //quiescenceSearch,
        isTerminal,
        getChildren,
        clearTranspositionTable,
        getPositionHash,
        initPositionHistory,
        wouldCauseThreefoldRepetition
    };
}

