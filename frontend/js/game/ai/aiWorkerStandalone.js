// aiWorkerStandalone.js
// Standalone Web Worker for AI computations (can be loaded directly)
// This file contains all necessary AI logic inline to work with importScripts

const AI_DEFAULT_DEPTH = 3;

/**
 * Deep clone game state
 */
function cloneGameState(state) {
	if (typeof structuredClone === 'function') {
		return structuredClone(state);
	}
	return JSON.parse(JSON.stringify(state));
}

/**
 * Compute best AI move
 */
function computeBestMove(gameState, depth = 3) {
	if (gameState.activePlayer === 'black') {
		console.warn('[AI Worker] Called for black player - AI plays white');
		return gameState;
	}

	let bestMove = null;
	let bestScore = Infinity;
	let totalPruned = 0;

	const children = generateChildren(gameState);

	for (const child of children) {
		const [score, pruned] = minimax(child, depth, -Infinity, Infinity, true);
		totalPruned += pruned;

		if (score < bestScore) {
			bestScore = score;
			bestMove = child;
		}
	}

	if (!bestMove) {
		return gameState;
	}

	bestMove.activePlayer = 'black';
	return bestMove;
}

/**
 * Minimax with alpha-beta pruning
 */
function minimax(state, depth, alpha, beta, maximizing) {
	if (depth === 0 || isTerminal(state)) {
		return [evaluate(state), 0];
	}

	let pruned = 0;
	const children = generateChildren(state);

	if (maximizing) {
		let max = -Infinity;
		for (const child of children) {
			const [score, p] = minimax(child, depth - 1, alpha, beta, false);
			max = Math.max(max, score);
			pruned += p;
			if (max >= beta) {
				pruned++;
				break;
			}
			alpha = Math.max(alpha, max);
		}
		return [max, pruned];
	} else {
		let min = Infinity;
		for (const child of children) {
			const [score, p] = minimax(child, depth - 1, alpha, beta, true);
			min = Math.min(min, score);
			pruned += p;
			if (min <= alpha) {
				pruned++;
				break;
			}
			beta = Math.min(beta, min);
		}
		return [min, pruned];
	}
}

/**
 * Check terminal state
 */
function isTerminal(state) {
	const c = state.captured || {};
	if ((c.black_discs || 0) >= 6 || (c.white_discs || 0) >= 6 ||
		(c.black_rings || 0) >= 3 || (c.white_rings || 0) >= 3) {
		return true;
	}

	let bp = 0, wp = 0;
	for (const k in state.pieces) {
		if (state.pieces[k].color === 'black') bp++;
		else wp++;
	}

	return bp === 0 || wp === 0 || generateChildren(state).length === 0;
}

/**
 * Evaluate position
 */
function evaluate(state) {
	const W_DISC = 10, W_RING = 30, W_CAP_DISC = 15, W_CAP_RING = 50, W_TILE = 2;
	let bs = 0, ws = 0;

	for (const pos in state.pieces) {
		const p = state.pieces[pos];
		const v = p.type === 'disc' ? W_DISC : W_RING;
		if (p.color === 'black') bs += v;
		else ws += v;
	}

	const c = state.captured || {};
	bs += (c.black_discs || 0) * W_CAP_DISC + (c.black_rings || 0) * W_CAP_RING;
	ws += (c.white_discs || 0) * W_CAP_DISC + (c.white_rings || 0) * W_CAP_RING;

	for (const pos in state.tiles) {
		if (!(pos in state.pieces)) {
			if (state.tiles[pos] === 'black') bs += W_TILE;
			else if (state.tiles[pos] === 'white') ws += W_TILE;
		}
	}

	let bp = 0, wp = 0;
	for (const k in state.pieces) {
		if (state.pieces[k].color === 'black') bp++;
		else wp++;
	}

	const cap = state.captured || {};
	if ((cap.black_discs || 0) >= 6 || (cap.black_rings || 0) >= 3 || wp === 0) return 10000;
	if ((cap.white_discs || 0) >= 6 || (cap.white_rings || 0) >= 3 || bp === 0) return -10000;
	if (generateChildren(state).length === 0) return 0;

	return bs - ws;
}

/**
 * Generate child states
 */
function generateChildren(state) {
	const children = [];
	const player = state.activePlayer;
	const opponent = player === 'black' ? 'white' : 'black';

	// Tile placements
	if ((state.inventory[player]?.tiles || 0) > 0) {
		const validTileSpots = getValidTilePlacements(state);
		for (const [q, r] of validTileSpots) {
			const child = cloneGameState(state);
			child.tiles[`${q},${r}`] = player;
			child.inventory[player].tiles--;
			child.activePlayer = opponent;
			children.push(child);
		}
	}

	// Disc placements
	if ((state.inventory[player]?.discs || 0) > 0) {
		for (const key in state.tiles) {
			if (state.tiles[key] === player && !(key in state.pieces)) {
				const [q, r] = key.split(',').map(Number);
				const child = cloneGameState(state);
				child.pieces[key] = { type: 'disc', color: player };
				child.inventory[player].discs--;
				child.activePlayer = opponent;
				children.push(child);
			}
		}
	}

	// Ring placements (requires having captured at least one opponent disc)
	if ((state.inventory[player]?.rings || 0) > 0 && (state.captured[`${player}_discs`] || 0) > 0) {
		for (const key in state.tiles) {
			if (state.tiles[key] === player && !(key in state.pieces)) {
				const child = cloneGameState(state);
				child.pieces[key] = { type: 'ring', color: player };
				child.inventory[player].rings--;
				// Return captured disc to opponent
				child.captured[`${player}_discs`]--;
				child.inventory[opponent].discs++;
				child.activePlayer = opponent;
				children.push(child);
			}
		}
	}

	// Piece moves
	for (const key in state.pieces) {
		const piece = state.pieces[key];
		if (piece.color !== player) continue;

		const [q, r] = key.split(',').map(Number);
		const moves = piece.type === 'disc' 
			? getValidDiscMoves(state, q, r, player)
			: getValidRingMoves(state, q, r, player);

		for (const move of moves) {
			const child = cloneGameState(state);
			const fromKey = `${q},${r}`;
			const toKey = `${move.q},${move.r}`;
			
			child.pieces[toKey] = child.pieces[fromKey];
			delete child.pieces[fromKey];

			if (move.captures) {
				for (const cap of move.captures) {
					const capKey = `${cap.q},${cap.r}`;
					const capPiece = child.pieces[capKey];
					if (capPiece) {
						const capType = capPiece.type === 'disc' ? 'discs' : 'rings';
						child.captured[`${player}_${capType}`]++;
					}
					delete child.pieces[capKey];
				}
			}

			child.activePlayer = opponent;
			children.push(child);
		}
	}

	return children;
}

/**
 * Get valid tile placements
 */
function getValidTilePlacements(state) {
	const valid = new Set();
	const hexDirs = [[1,0], [-1,0], [0,1], [0,-1], [1,-1], [-1,1]];

	for (const key in state.tiles) {
		const [q, r] = key.split(',').map(Number);
		for (const [dq, dr] of hexDirs) {
			const nq = q + dq, nr = r + dr;
			const nkey = `${nq},${nr}`;
			if (!(nkey in state.tiles)) {
				valid.add([nq, nr]);
			}
		}
	}

	return Array.from(valid);
}

/**
 * Get valid disc moves
 */
function getValidDiscMoves(state, q, r, player) {
	const moves = [];
	const hexDirs = [[1,0], [-1,0], [0,1], [0,-1], [1,-1], [-1,1]];

	// Adjacent moves
	for (const [dq, dr] of hexDirs) {
		const nq = q + dq, nr = r + dr;
		const nkey = `${nq},${nr}`;
		if (nkey in state.tiles && !(nkey in state.pieces)) {
			moves.push({ q: nq, r: nr });
		}
	}

	// Jumps
	const jumpMoves = findJumps(state, q, r, player, new Set());
	moves.push(...jumpMoves);

	return moves;
}

/**
 * Find all jump sequences
 */
function findJumps(state, q, r, player, visited) {
	const hexDirs = [[1,0], [-1,0], [0,1], [0,-1], [1,-1], [-1,1]];
	const jumps = [];
	const key = `${q},${r}`;

	for (const [dq, dr] of hexDirs) {
		const mq = q + dq, mr = r + dr;
		const midKey = `${mq},${mr}`;
		const jq = q + 2*dq, jr = r + 2*dr;
		const jumpKey = `${jq},${jr}`;

		if (midKey in state.pieces && jumpKey in state.tiles && !(jumpKey in state.pieces)) {
			const midPiece = state.pieces[midKey];
			// Removed restriction: discs CAN jump over the same piece multiple times
			if (midPiece.color !== player) {
				jumps.push({
					q: jq,
					r: jr,
					captures: [{ q: mq, r: mr }]
				});
			}
		}
	}

	return jumps;
}

/**
 * Get valid ring moves
 */
function getValidRingMoves(state, q, r, player) {
	const moves = [];
	// Ring knight-like moves: 2 hexes in 12 directions
	const ringDirs = [
		[2, 0], [-2, 0], [0, 2], [0, -2],
		[2, -2], [-2, 2], [1, 1], [-1, -1],
		[1, -2], [-1, 2], [2, -1], [-2, 1]
	];

	for (const [dq, dr] of ringDirs) {
		const nq = q + dq, nr = r + dr;
		const nkey = `${nq},${nr}`;
		
		if (nkey in state.tiles) {
			const targetPiece = state.pieces[nkey];
			if (!targetPiece) {
				moves.push({ q: nq, r: nr });
			} else if (targetPiece.color !== player) {
				moves.push({
					q: nq,
					r: nr,
					captures: [{ q: nq, r: nr }]
				});
			}
		}
	}

	return moves;
}

// Worker message handler
self.addEventListener('message', function (e) {
	const { type, gameState, difficulty } = e.data;

	if (type === 'computeMove') {
		try {
			const start = performance.now();
			const result = computeBestMove(gameState, difficulty || AI_DEFAULT_DEPTH);
			const elapsed = performance.now() - start;

			self.postMessage({
				type: 'moveComputed',
				updatedState: result,
				computeTime: elapsed
			});
		} catch (error) {
			self.postMessage({
				type: 'error',
				error: error.message,
				stack: error.stack
			});
		}
	} else if (type === 'ping') {
		self.postMessage({ type: 'pong' });
	}
});
