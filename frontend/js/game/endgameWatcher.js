import { subscribeToGameState, getGameState, updateGameState } from '../store/gameStore.js';
import { serializeState } from './gameState.js';
import { HistoryManager } from '../../../shared/game/history.js';
import { calculateAllValidMoves } from '../../../shared/game/moveValidator.js';
import { DEFAULT_BOARD_RADIUS } from '../../../shared/game/constants.js';

const historyManager = new HistoryManager();

export function initEndgameWatcher() {
	historyManager.reset();
	historyManager.recordInitialState(serializeState(getGameState()));

	const unsubscribe = subscribeToGameState((state, previous, payload = {}) => {
		if (payload.reason === 'reset') {
			historyManager.reset();
			historyManager.recordInitialState(serializeState(state));
			return;
		}

		if (previous && previous.activePlayer !== state.activePlayer) {
			historyManager.recordMove(serializeState(state));
		}

		if (state.metadata?.gameOver) {
			return;
		}

		const result = evaluateVictory(state);
		if (result) {
			markGameOver(result);
		}
	});

	return () => {
		unsubscribe?.();
	};
}

function evaluateVictory(state) {
	const captured = state.captured ?? {};
	const blackCaptured = captured.black ?? { disc: 0, ring: 0 };
	const whiteCaptured = captured.white ?? { disc: 0, ring: 0 };

	if ((blackCaptured.disc ?? 0) >= 6) {
		return { winner: 'black', reason: 'capturing 6 discs' };
	}
	if ((blackCaptured.ring ?? 0) >= 3) {
		return { winner: 'black', reason: 'capturing 3 rings' };
	}
	if (!hasActivePieces(state, 'white')) {
		return { winner: 'black', reason: 'eliminating all opponent pieces' };
	}

	if ((whiteCaptured.disc ?? 0) >= 6) {
		return { winner: 'white', reason: 'capturing 6 discs' };
	}
	if ((whiteCaptured.ring ?? 0) >= 3) {
		return { winner: 'white', reason: 'capturing 3 rings' };
	}
	if (!hasActivePieces(state, 'black')) {
		return { winner: 'white', reason: 'eliminating all opponent pieces' };
	}

	const activePlayer = state.activePlayer ?? 'black';
	if (!hasAnyLegalMove(state, activePlayer)) {
		return { winner: 'ex-aequo', reason: 'stalemate' };
	}

	if (historyManager.hasThreefoldRepetition()) {
		return { winner: 'ex-aequo', reason: 'threefold repetition' };
	}

	return null;
}

function hasActivePieces(state, color) {
	const pieces = state.pieces ?? {};
	return Object.values(pieces).some((piece) => piece && piece.color === color);
}

function hasAnyLegalMove(state, player) {
	const highlights = calculateAllValidMoves(state, {
		player,
		radius: DEFAULT_BOARD_RADIUS,
		multiJumping: false,
		jumpHistory: [],
		sequenceCapturedSnapshot: null
	}) || [];
	return highlights.length > 0;
}

function markGameOver(details) {
	updateGameState((state) => ({
		...state,
		metadata: {
			...(state.metadata ?? {}),
			gameOver: details
		}
	}), { reason: 'game-over' });
}
