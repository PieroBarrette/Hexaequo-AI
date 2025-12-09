import { pixelToAxial } from './hexMath.js';
import { getGameState, updateGameState } from '../store/gameStore.js';
import { calculateValidMovesForPiece, getNeighbors } from '../../../shared/game/moveValidator.js';
import { DEFAULT_BOARD_RADIUS } from '../../../shared/game/constants.js';

const controllerState = {
	selection: null,
	validMoves: [],
	pendingPlacement: null
};

export function initGameController(canvas, options = {}) {
	if (!canvas) {
		console.warn('[gameController] Missing canvas element');
		return () => {};
	}

	const hexSize = options.hexSize ?? 40;

	const handleClick = (event) => {
		const rect = canvas.getBoundingClientRect();
		const scaledX = (event.clientX - rect.left) * (canvas.width / rect.width);
		const scaledY = (event.clientY - rect.top) * (canvas.height / rect.height);
		const { q, r } = pixelToAxial(scaledX, scaledY, hexSize);
		handleBoardInteraction(Math.round(q), Math.round(r));
	};

	canvas.addEventListener('click', handleClick);
	canvas.addEventListener('touchend', (event) => {
		event.preventDefault();
		if (!event.changedTouches?.length) return;
		const touch = event.changedTouches[0];
		const rect = canvas.getBoundingClientRect();
		const scaledX = (touch.clientX - rect.left) * (canvas.width / rect.width);
		const scaledY = (touch.clientY - rect.top) * (canvas.height / rect.height);
		const { q, r } = pixelToAxial(scaledX, scaledY, hexSize);
		handleBoardInteraction(Math.round(q), Math.round(r));
	}, { passive: false });

	return () => {
		canvas.removeEventListener('click', handleClick);
	};
}

function handleBoardInteraction(q, r) {
	if (!isInsideBoard(q, r)) {
		clearSelection();
		return;
	}

	const state = getGameState();
	const key = `${q},${r}`;
	const piece = state.pieces?.[key];
	const ownsPiece = piece && piece.color === state.activePlayer;

	if (controllerState.selection) {
		const moved = tryMoveSelectedPiece(q, r, state);
		if (moved) {
			return;
		}
	}

	if (ownsPiece) {
		selectPiece(q, r, state);
		return;
	}

	clearSelection();
	tryHandlePlacement(q, r, state);
}

function tryHandlePlacement(q, r, state) {
	if (tryPlacePiece(q, r, state)) {
		return true;
	}
	return tryPlaceTile(q, r, state);
}

function tryPlacePiece(q, r, state) {
	const key = `${q},${r}`;
	const tileOwner = state.tiles?.[key];
	if (!tileOwner || tileOwner !== state.activePlayer) {
		return false;
	}
	if (state.pieces?.[key]) {
		return false;
	}

	const canPlaceDisc = (state.discInventory?.[state.activePlayer] ?? 0) > 0;
	const canPlaceRing = (state.ringInventory?.[state.activePlayer] ?? 0) > 0 && (state.captured?.[state.activePlayer]?.disc ?? 0) > 0;

	if (canPlaceDisc) {
		mutateState((draft) => {
			draft.pieces[key] = { type: 'disc', color: draft.activePlayer };
			draft.discInventory[draft.activePlayer] = Math.max(0, (draft.discInventory[draft.activePlayer] ?? 0) - 1);
			advanceTurn(draft);
		});
		return true;
	}

	if (canPlaceRing) {
		mutateState((draft) => {
			draft.pieces[key] = { type: 'ring', color: draft.activePlayer };
			draft.ringInventory[draft.activePlayer] = Math.max(0, (draft.ringInventory[draft.activePlayer] ?? 0) - 1);
			draft.captured[draft.activePlayer].disc = Math.max(0, draft.captured[draft.activePlayer].disc - 1);
			const opponent = draft.activePlayer === 'black' ? 'white' : 'black';
			draft.discInventory[opponent] = (draft.discInventory[opponent] ?? 0) + 1;
			advanceTurn(draft);
		});
		return true;
	}

	return false;
}

function tryPlaceTile(q, r, state) {
	const key = `${q},${r}`;
	if (state.tiles?.[key] || state.pieces?.[key]) {
		return false;
	}

	const available = state.inventory?.[state.activePlayer] ?? 0;
	if (available <= 0) {
		return false;
	}

	const adjacentCount = countAdjacentTiles(state.tiles, q, r);
	if (adjacentCount < 2) {
		return false;
	}

	mutateState((draft) => {
		draft.tiles[key] = draft.activePlayer;
		draft.inventory[draft.activePlayer] = Math.max(0, (draft.inventory[draft.activePlayer] ?? 0) - 1);
		advanceTurn(draft);
	});
	return true;
}

function tryMoveSelectedPiece(q, r, state) {
	const selection = controllerState.selection;
	if (!selection) return false;
	const moves = controllerState.validMoves || [];
	const matchingMove = moves.find((move) => move.q === q && move.r === r);
	if (!matchingMove) {
		return false;
	}

	const fromKey = `${selection.q},${selection.r}`;
	const toKey = `${q},${r}`;
	const selectedPiece = state.pieces?.[fromKey];
	if (!selectedPiece) {
		clearSelection();
		return false;
	}

	if (selectedPiece.type === 'ring') {
		mutateState((draft) => {
			const occupant = draft.pieces[toKey];
			if (occupant && occupant.color !== draft.activePlayer) {
				draft.captured[draft.activePlayer][occupant.type] = (draft.captured[draft.activePlayer][occupant.type] ?? 0) + 1;
			}
			draft.pieces[toKey] = { ...draft.pieces[fromKey] };
			delete draft.pieces[fromKey];
			advanceTurn(draft);
		});
		clearSelection();
		return true;
	}

	if (selectedPiece.type === 'disc') {
		if (matchingMove.type === 'adjacent') {
			mutateState((draft) => {
				draft.pieces[toKey] = { ...draft.pieces[fromKey] };
				delete draft.pieces[fromKey];
				advanceTurn(draft);
			});
			clearSelection();
			return true;
		}

		if (matchingMove.type === 'jump') {
			const midQ = (selection.q + q) / 2;
			const midR = (selection.r + r) / 2;
			const jumpedKey = `${midQ},${midR}`;

			mutateState((draft) => {
				const capturedPiece = draft.pieces[jumpedKey];
				if (capturedPiece && capturedPiece.color !== draft.activePlayer) {
					draft.captured[draft.activePlayer][capturedPiece.type] = (draft.captured[draft.activePlayer][capturedPiece.type] ?? 0) + 1;
				}
				draft.pieces[toKey] = { ...draft.pieces[fromKey] };
				delete draft.pieces[fromKey];
				delete draft.pieces[jumpedKey];
				advanceTurn(draft);
			});
			clearSelection();
			return true;
		}
	}

	return false;
}

function selectPiece(q, r, state) {
	controllerState.selection = { q, r };
	const moves = calculateValidMovesForPiece(state, q, r, { player: state.activePlayer }) || [];
	controllerState.validMoves = moves;
	updateMetadata({ selection: { q, r }, validMoves: moves });
}

function clearSelection() {
	controllerState.selection = null;
	controllerState.validMoves = [];
	updateMetadata({ selection: null, validMoves: [] });
}

function mutateState(mutateFn) {
	updateGameState((state) => {
		const next = cloneState(state);
		mutateFn(next);
		return next;
	}, { reason: 'gameplay' });
}

function updateMetadata(patch) {
	updateGameState((state) => ({
		...state,
		metadata: {
			...(state.metadata ?? {}),
			...patch
		}
	}), { reason: 'metadata' });
}

function advanceTurn(state) {
	state.activePlayer = state.activePlayer === 'black' ? 'white' : 'black';
}

function countAdjacentTiles(tiles = {}, q, r) {
	let count = 0;
	for (const [nq, nr] of getNeighbors(q, r)) {
		if (tiles[`${nq},${nr}`]) {
			count++;
		}
	}
	return count;
}

function isInsideBoard(q, r) {
	const radius = DEFAULT_BOARD_RADIUS;
	if (q < -radius || q > radius) return false;
	if (r < Math.max(-radius, -q - radius) || r > Math.min(radius, -q + radius)) return false;
	return true;
}

function cloneState(state) {
	return {
		...state,
		tiles: { ...(state.tiles ?? {}) },
		pieces: clonePieces(state.pieces),
		inventory: { ...(state.inventory ?? {}) },
		discInventory: { ...(state.discInventory ?? {}) },
		ringInventory: { ...(state.ringInventory ?? {}) },
		captured: {
			black: { ...(state.captured?.black ?? { disc: 0, ring: 0 }) },
			white: { ...(state.captured?.white ?? { disc: 0, ring: 0 }) }
		},
		metadata: { ...(state.metadata ?? {}) }
	};
}

function clonePieces(source = {}) {
	const copy = {};
	for (const key of Object.keys(source)) {
		const piece = source[key];
		copy[key] = piece ? { ...piece } : piece;
	}
	return copy;
}

