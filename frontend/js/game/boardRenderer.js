// Responsible for wiring the canonical animation diff into whichever rendering
// surface we decide to use (canvas, SVG, WebGL, etc.).
// Rendering primitives live behind a `graphicsApi` interface so that tests and
// future UIs can reuse the same event stream that the legacy canvas consumes.

import { buildAnimationQueue, playQueueWithGraphics } from './animationController.js';
import { subscribeToGameState } from '../store/gameStore.js';

export function mountBoardRenderer(options = {}) {
	const {
		graphicsApi,
		selectJumpPath,
		animateMultiJumps = true,
		manuallyEndedTurn = () => false,
		skipMoveAnimation = () => false,
		onQueueBuilt
	} = options;

	if (!graphicsApi) {
		throw new Error('mountBoardRenderer requires a graphicsApi. Pass a console adapter during early development.');
	}

	let previousState = null;

	const unsubscribe = subscribeToGameState((nextState) => {
		if (!previousState) {
			graphicsApi.renderStatic?.(nextState);
			previousState = nextState;
			return;
		}

		const queueResult = buildAnimationQueue(previousState, nextState, {
			jumpPath: selectJumpPath ? selectJumpPath(previousState, nextState) : null,
			animateMultiJumps,
			manuallyEndedTurn: manuallyEndedTurn(previousState, nextState),
			skipMoveAnimation: skipMoveAnimation(previousState, nextState)
		});

		onQueueBuilt?.(queueResult);

		if (queueResult.events.length > 0) {
			playQueueWithGraphics(queueResult, graphicsApi);
		}

		graphicsApi.renderStatic?.(nextState);

		previousState = nextState;
	});

	return {
		dispose: unsubscribe
	};
}

export function createConsoleGraphicsAdapter(label = 'BoardRenderer') {
	return {
		renderStatic(state) {
			console.log(`[${label}] renderStatic`, state);
		},
		queueTilePlacementAnimation(q, r, color) {
			console.log(`[${label}] tile-placement`, { q, r, color });
		},
		queuePiecePlacementAnimation(q, r, piece) {
			console.log(`[${label}] piece-placement`, { q, r, piece });
		},
		queueJumpSequenceWithCaptures(path, piece, captures = []) {
			console.log(`[${label}] jump-sequence`, { path, piece, captures });
		},
		queueSingleMoveWithCapture(fromQ, fromR, toQ, toR, piece, captures = []) {
			console.log(`[${label}] move-with-captures`, { fromQ, fromR, toQ, toR, piece, captures });
		},
		queueMoveAnimation(fromQ, fromR, toQ, toR, piece) {
			console.log(`[${label}] move`, { fromQ, fromR, toQ, toR, piece });
		},
		queueCaptureAnimation(q, r, piece) {
			console.log(`[${label}] capture`, { q, r, piece });
		}
	};
}
