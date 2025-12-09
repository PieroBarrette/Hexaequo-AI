// Stateless move generation helpers extracted from the legacy Hexaequo game loop.
// The new frontend can consume these functions to keep rendering/input layers lean.

import { HEX_DIRECTIONS, RING_DIRECTIONS, DEFAULT_BOARD_RADIUS } from './constants.js';

const DISC_JUMP_DIRECTIONS = HEX_DIRECTIONS;

/**
 * Return all neighboring axial coordinates for a given hex.
 * @param {number} q axial q coordinate
 * @param {number} r axial r coordinate
 * @returns {Array<[number, number]>}
 */
export function getNeighbors(q, r) {
	return HEX_DIRECTIONS.map(([dq, dr]) => [q + dq, r + dr]);
}

/**
 * Compute every actionable highlight for the active player.
 * Mirrors the legacy calculateAllValidMoves but expects immutable inputs.
 * @param {object} state board snapshot
 * @param {object} context supplemental flags (optional)
 * @returns {Array<{q:number,r:number,type:'piece'|'tile'|'placement'}>}
 */
export function calculateAllValidMoves(state, context = {}) {
	const player = context.player ?? state.activePlayer ?? 'black';
	const radius = Math.max(1, context.radius ?? state.radius ?? DEFAULT_BOARD_RADIUS);
	const multiJumping = Boolean(context.multiJumping);
	const jumpHistory = normaliseJumpHistory(context.jumpHistory);
	const sequenceSnapshot = context.sequenceCapturedSnapshot ?? null;

	const tiles = state.tiles ?? {};
	const pieces = state.pieces ?? {};
	const inventory = state.inventory ?? { black: 0, white: 0 };
	const discInventory = state.discInventory ?? { black: 0, white: 0 };
	const ringInventory = state.ringInventory ?? { black: 0, white: 0 };
	const captured = state.captured ?? {
		black: { disc: 0, ring: 0 },
		white: { disc: 0, ring: 0 }
	};

	const highlights = [];
	const addedPieces = new Set();

	for (const key of Object.keys(pieces)) {
		const piece = pieces[key];
		if (!piece || piece.color !== player) continue;

		const [q, r] = key.split(',').map(Number);
		let canMove = false;

		if (piece.type === 'disc') {
			if (!multiJumping) {
				for (const [nq, nr] of getNeighbors(q, r)) {
					const nkey = `${nq},${nr}`;
					if (tiles[nkey] && !pieces[nkey]) {
						canMove = true;
						break;
					}
				}
			}

			if (!canMove) {
				canMove = DISC_JUMP_DIRECTIONS.some(([dq, dr]) => {
					const jq = q + dq;
					const jr = r + dr;
					const landingQ = q + 2 * dq;
					const landingR = r + 2 * dr;
					const jumpKey = `${jq},${jr}`;
					const landingKey = `${landingQ},${landingR}`;
					if (!pieces[jumpKey] || !tiles[landingKey] || pieces[landingKey]) {
						return false;
					}
					if (pieces[jumpKey].color === player && hasVisitedJump(jumpHistory, jq, jr)) {
						return false;
					}
					if (
						multiJumping &&
						context.turnStartPiecePos &&
						landingQ === context.turnStartPiecePos.q &&
						landingR === context.turnStartPiecePos.r &&
						!hasCapturedDuringSequence(player, captured, sequenceSnapshot)
					) {
						return false;
					}
					return true;
				});
			}
		} else if (piece.type === 'ring') {
			canMove = RING_DIRECTIONS.some(([dq, dr]) => {
				const landingQ = q + dq;
				const landingR = r + dr;
				const landingKey = `${landingQ},${landingR}`;
				const occupant = tiles[landingKey] ? pieces[landingKey] : null;
				return Boolean(tiles[landingKey]) && (!occupant || occupant.color !== player);
			});
		}

		if (canMove) {
			const pieceKey = `${q},${r}`;
			if (!addedPieces.has(pieceKey)) {
				highlights.push({ q, r, type: 'piece' });
				addedPieces.add(pieceKey);
			}
		}
	}

	if ((inventory[player] ?? 0) > 0) {
		for (let q = -radius; q <= radius; q++) {
			const minR = Math.max(-radius, -q - radius);
			const maxR = Math.min(radius, -q + radius);
			for (let r = minR; r <= maxR; r++) {
				const key = `${q},${r}`;
				if (tiles[key]) continue;
				if (countAdjacentTiles(tiles, q, r) >= 2) {
					highlights.push({ q, r, type: 'tile' });
				}
			}
		}
	}

	for (const key of Object.keys(tiles)) {
		if (tiles[key] !== player || pieces[key]) continue;
		const [q, r] = key.split(',').map(Number);
		const hasDiscs = (discInventory[player] ?? 0) > 0;
		const hasRings = (ringInventory[player] ?? 0) > 0 && (captured[player]?.disc ?? 0) > 0;
		if (hasDiscs || hasRings) {
			highlights.push({ q, r, type: 'placement' });
		}
	}

	return highlights;
}

/**
 * Generate valid targets for a single piece.
 * @param {object} state board snapshot
 * @param {number} q piece q
 * @param {number} r piece r
 * @param {object} context extra flags
 * @returns {Array<{q:number,r:number,type:string}>}
 */
export function calculateValidMovesForPiece(state, q, r, context = {}) {
	const pieces = state.pieces ?? {};
	const tiles = state.tiles ?? {};
	const player = context.player ?? state.activePlayer ?? 'black';
	const multiJumping = Boolean(context.multiJumping);
	const jumpHistory = normaliseJumpHistory(context.jumpHistory);
	const sequenceSnapshot = context.sequenceCapturedSnapshot ?? null;
	const turnStartPiecePos = context.turnStartPiecePos ?? null;
	const captured = state.captured ?? {
		black: { disc: 0, ring: 0 },
		white: { disc: 0, ring: 0 }
	};

	const piece = pieces[`${q},${r}`];
	if (!piece || piece.color !== player) return [];

	const moves = [];

	if (piece.type === 'disc') {
		if (!multiJumping) {
			for (const [nq, nr] of getNeighbors(q, r)) {
				const nkey = `${nq},${nr}`;
				if (tiles[nkey] && !pieces[nkey]) {
					moves.push({ q: nq, r: nr, type: 'adjacent' });
				}
			}
		}

		for (const [dq, dr] of DISC_JUMP_DIRECTIONS) {
			const jq = q + dq;
			const jr = r + dr;
			const landingQ = q + 2 * dq;
			const landingR = r + 2 * dr;
			const jumpKey = `${jq},${jr}`;
			const landingKey = `${landingQ},${landingR}`;

			if (!pieces[jumpKey] || !tiles[landingKey] || pieces[landingKey]) {
				continue;
			}

			if (pieces[jumpKey].color === player && hasVisitedJump(jumpHistory, jq, jr)) {
				continue;
			}

			if (
				multiJumping &&
				turnStartPiecePos &&
				landingQ === turnStartPiecePos.q &&
				landingR === turnStartPiecePos.r &&
				!hasCapturedDuringSequence(player, captured, sequenceSnapshot)
			) {
				continue;
			}

			moves.push({ q: landingQ, r: landingR, type: 'jump' });
		}
	} else if (piece.type === 'ring') {
		for (const [dq, dr] of RING_DIRECTIONS) {
			const landingQ = q + dq;
			const landingR = r + dr;
			const landingKey = `${landingQ},${landingR}`;
			if (!tiles[landingKey]) continue;

			const occupant = pieces[landingKey];
			if (occupant && occupant.color === player) continue;

			moves.push({
				q: landingQ,
				r: landingR,
				type: occupant ? 'capture' : 'move'
			});
		}
	}

	return moves;
}

function countAdjacentTiles(tiles, q, r) {
	let count = 0;
	for (const [nq, nr] of getNeighbors(q, r)) {
		if (tiles[`${nq},${nr}`]) {
			count++;
		}
	}
	return count;
}

function hasVisitedJump(jumpHistory, q, r) {
	return jumpHistory.some((entry) => entry.q === q && entry.r === r);
}

function hasCapturedDuringSequence(player, captured, sequenceSnapshot) {
	if (!sequenceSnapshot) return false;
	const start = extractCapturedCounts(sequenceSnapshot, player);
	const current = extractCapturedCounts(captured, player);
	return start.disc !== current.disc || start.ring !== current.ring;
}

function extractCapturedCounts(source, player) {
	if (!source) {
		return { disc: 0, ring: 0 };
	}
	if (source[player]) {
		return {
			disc: source[player].disc ?? 0,
			ring: source[player].ring ?? 0
		};
	}
	const prefix = player === 'black' ? 'black' : 'white';
	return {
		disc: source[`${prefix}_discs`] ?? 0,
		ring: source[`${prefix}_rings`] ?? 0
	};
}

function normaliseJumpHistory(history = []) {
	return history.map((entry) => {
		if (typeof entry === 'string') {
			const [q, r] = entry.split(',').map(Number);
			return { q, r };
		}
		if (typeof entry === 'object' && entry !== null && 'q' in entry && 'r' in entry) {
			return { q: Number(entry.q), r: Number(entry.r) };
		}
		return { q: NaN, r: NaN };
	}).filter((entry) => Number.isFinite(entry.q) && Number.isFinite(entry.r));
}
