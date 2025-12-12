// aiEngine.js
// Client-side AI implementation using Minimax with Alpha-Beta pruning
// Migrated from hexaequo-v2/ai.js and adapted to main app architecture

import { cloneGameState } from '../../../../shared/game/gameState.js';
import { calculateAllValidMoves } from '../../../../shared/game/moveValidator.js';

// Default search depth for AI
let AI_SEARCH_DEPTH = 3;

/**
 * Process game state and return the AI's best move
 * @param {Object} gameState - Current game state
 * @param {number} depth - Search depth (2=easy, 3=medium, 4=hard)
 * @returns {Object} Best move state
 */
export function computeBestMove(gameState, depth = 3) {
	if (gameState.activePlayer === 'black') {
		console.warn('[AI] Called for black player - AI plays white');
		return gameState;
	}

	AI_SEARCH_DEPTH = depth;

	let bestMove = null;
	let bestScore = Infinity; // Minimizing for white
	let totalPrunedBranches = 0;

	const children = generateChildren(gameState);

	for (const child of children) {
		const [score, pruned] = minimax(child, AI_SEARCH_DEPTH, -Infinity, Infinity, true);
		totalPrunedBranches += pruned;

		if (score < bestScore) {
			bestScore = score;
			bestMove = child;
		}
	}

	if (!bestMove) {
		console.warn('[AI] No valid move found - returning current state');
		return gameState;
	}

	// Switch active player
	bestMove.activePlayer = 'black';

	console.log(`[AI] Level ${depth} finished. Score: ${bestScore.toFixed(2)}, Pruned: ${totalPrunedBranches}`);

	return bestMove;
}

/**
 * Minimax algorithm with Alpha-Beta pruning
 */
function minimax(state, depth, alpha, beta, maximizingPlayer) {
	if (depth === 0 || isTerminal(state)) {
		return [evaluate(state), 0];
	}

	let prunedBranches = 0;
	const children = generateChildren(state);

	if (maximizingPlayer) {
		let maxEval = -Infinity;
		for (const child of children) {
			const [evalScore, childPruned] = minimax(child, depth - 1, alpha, beta, false);
			maxEval = Math.max(maxEval, evalScore);
			prunedBranches += childPruned;
			if (maxEval >= beta) {
				prunedBranches += 1;
				break; // Beta cutoff
			}
			alpha = Math.max(alpha, maxEval);
		}
		return [maxEval, prunedBranches];
	} else {
		let minEval = Infinity;
		for (const child of children) {
			const [evalScore, childPruned] = minimax(child, depth - 1, alpha, beta, true);
			minEval = Math.min(minEval, evalScore);
			prunedBranches += childPruned;
			if (minEval <= alpha) {
				prunedBranches += 1;
				break; // Alpha cutoff
			}
			beta = Math.min(beta, minEval);
		}
		return [minEval, prunedBranches];
	}
}

/**
 * Check if state is terminal (game over)
 */
function isTerminal(state) {
	// Victory conditions
	const captured = state.captured || {};
	const blackDiscs = captured.black_discs || 0;
	const whiteDiscs = captured.white_discs || 0;
	const blackRings = captured.black_rings || 0;
	const whiteRings = captured.white_rings || 0;

	if (blackDiscs >= 6 || whiteDiscs >= 6 || blackRings >= 3 || whiteRings >= 3) {
		return true;
	}

	// Check if either player has no pieces
	let blackPieces = 0;
	let whitePieces = 0;
	for (const key in state.pieces) {
		if (state.pieces[key].color === 'black') blackPieces++;
		else whitePieces++;
	}

	if (blackPieces === 0 || whitePieces === 0) {
		return true;
	}

	// Stalemate check (no valid moves)
	const children = generateChildren(state);
	return children.length === 0;
}

/**
 * Evaluate board state
 * Positive = good for Black, Negative = good for White
 */
function evaluate(state) {
	const W_DISC = 10;
	const W_RING = 30;
	const W_CAPTURED_DISC = 15;
	const W_CAPTURED_RING = 50;
	const W_TILE = 2;

	let blackScore = 0;
	let whiteScore = 0;

	// Score pieces on board
	for (const position in state.pieces) {
		const piece = state.pieces[position];
		const value = piece.type === 'disc' ? W_DISC : W_RING;
		
		if (piece.color === 'black') {
			blackScore += value;
		} else {
			whiteScore += value;
		}
	}

	// Score captured pieces (more valuable)
	const captured = state.captured || {};
	blackScore += (captured.black_discs || 0) * W_CAPTURED_DISC;
	blackScore += (captured.black_rings || 0) * W_CAPTURED_RING;
	whiteScore += (captured.white_discs || 0) * W_CAPTURED_DISC;
	whiteScore += (captured.white_rings || 0) * W_CAPTURED_RING;

	// Score empty tiles (territory control)
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

	// Terminal state bonuses
	let blackPieces = 0;
	let whitePieces = 0;
	for (const key in state.pieces) {
		if (state.pieces[key].color === 'black') blackPieces++;
		else whitePieces++;
	}

	const capturedData = state.captured || {};
	if ((capturedData.black_discs || 0) >= 6 || (capturedData.black_rings || 0) >= 3 || whitePieces === 0) {
		return 10000; // Black wins
	}
	if ((capturedData.white_discs || 0) >= 6 || (capturedData.white_rings || 0) >= 3 || blackPieces === 0) {
		return -10000; // White wins
	}

	// Stalemate check
	const children = generateChildren(state);
	if (children.length === 0) {
		return 0; // Draw
	}

	return blackScore - whiteScore;
}

/**
 * Generate all valid child states
 */
function generateChildren(state) {
	const children = [];
	const player = state.activePlayer;

	// Get all valid moves from move validator
	const validMoves = calculateAllValidMoves(state, player);

	// Convert each valid move into a child state
	for (const move of validMoves) {
		const child = applyMove(state, move);
		if (child) {
			children.push(child);
		}
	}

	return children;
}

/**
 * Apply a move to create a new state
 */
function applyMove(state, move) {
	try {
		const newState = cloneGameState(state);
		
		// Handle different move types
		switch (move.type) {
			case 'placeTile':
				newState.tiles[`${move.q},${move.r}`] = move.color;
				if (newState.inventory[move.color]) {
					newState.inventory[move.color].tiles--;
				}
				break;

			case 'placeDisc':
				newState.pieces[`${move.q},${move.r}`] = { type: 'disc', color: move.color };
				if (newState.inventory[move.color]) {
					newState.inventory[move.color].discs--;
				}
				break;

			case 'placeRing':
				newState.pieces[`${move.q},${move.r}`] = { type: 'ring', color: move.color };
				if (newState.inventory[move.color]) {
					newState.inventory[move.color].rings--;
				}
				// Return captured disc if placing ring
				if (move.returnDisc && newState.captured) {
					const opponentColor = move.color === 'black' ? 'white' : 'black';
					newState.captured[`${opponentColor}_discs`] = Math.max(0, (newState.captured[`${opponentColor}_discs`] || 0) - 1);
					if (newState.inventory[opponentColor]) {
						newState.inventory[opponentColor].discs++;
					}
				}
				break;

			case 'moveDisc':
			case 'moveRing':
				const fromKey = `${move.fromQ},${move.fromR}`;
				const toKey = `${move.toQ},${move.toR}`;
				newState.pieces[toKey] = newState.pieces[fromKey];
				delete newState.pieces[fromKey];
				
				// Handle captures
				if (move.captures && move.captures.length > 0) {
					for (const capturePos of move.captures) {
						const captureKey = `${capturePos.q},${capturePos.r}`;
						const capturedPiece = newState.pieces[captureKey];
						if (capturedPiece && newState.captured) {
							const captureType = capturedPiece.type === 'disc' ? 'discs' : 'rings';
							const captureKey = `${move.color}_${captureType}`;
							newState.captured[captureKey] = (newState.captured[captureKey] || 0) + 1;
						}
						delete newState.pieces[captureKey];
					}
				}
				break;

			default:
				console.warn('[AI] Unknown move type:', move.type);
				return null;
		}

		// Switch active player for child state
		newState.activePlayer = player === 'black' ? 'white' : 'black';
		
		return newState;
	} catch (error) {
		console.error('[AI] Error applying move:', error);
		return null;
	}
}
