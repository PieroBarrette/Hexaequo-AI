import { diffStatesForAnimation } from '../../../shared/game/animationDiff.js';

export function deriveMetadataPatch(previousState, nextState) {
	if (!previousState || !nextState || previousState === nextState) {
		return null;
	}

	const diff = diffStatesForAnimation(previousState, nextState, {
		jumpPath: nextState.metadata?.lastJumpPath ?? previousState.metadata?.lastJumpPath
	});
	if (!diff) {
		return null;
	}

	const lastMoveHighlight = buildLastMoveHighlight(diff);
	return lastMoveHighlight ? { lastMoveHighlight } : null;
}

function buildLastMoveHighlight(diff) {
	if (diff.tilePlacements && diff.tilePlacements.length === 1) {
		const [placement] = diff.tilePlacements;
		return { kind: 'tile', q: placement.q, r: placement.r, color: placement.color };
	}

	if (diff.placements && diff.placements.length === 1) {
		const [placement] = diff.placements;
		return { kind: 'piece', q: placement.q, r: placement.r, piece: placement.piece };
	}

	if (diff.move && diff.move.from && diff.move.to) {
		const captures = normaliseCaptures(diff.captures);
		return {
			kind: 'move',
			from: diff.move.from,
			to: diff.move.to,
			path: diff.move.jumpPath || diff.jumpPath || null,
			captures
		};
	}

	if (diff.loopMove && diff.jumpPath && diff.jumpPath.length > 1) {
		const start = diff.jumpPath[0];
		const end = diff.jumpPath[diff.jumpPath.length - 1];
		const captures = normaliseCaptures(diff.captures);
		return {
			kind: 'move',
			from: start,
			to: end,
			path: diff.jumpPath,
			captures
		};
	}

	if (diff.captures && diff.captures.length > 0) {
		return { kind: 'capture', captures: normaliseCaptures(diff.captures) };
	}

	return null;
}

function normaliseCaptures(captures = []) {
	return captures.map((entry) => ({ q: entry.q, r: entry.r }));
}
