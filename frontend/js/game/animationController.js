import { diffStatesForAnimation } from './animationDiff.js';

/**
 * Build a normalized list of animation events describing how the board changed.
 * Rendering layers can iterate over the returned events array and call
 * whichever drawing primitives they expose.
 */
export function buildAnimationQueue(previousState, updatedState, options = {}) {
    const {
        jumpPath = null,
        animateMultiJumps = false,
        manuallyEndedTurn = false,
        skipMoveAnimation = false
    } = options;

    const diff = diffStatesForAnimation(previousState, updatedState, { jumpPath });
    const events = [];

    for (const placement of diff.tilePlacements || []) {
        events.push({ type: 'tile-placement', ...placement });
    }

    for (const piecePlacement of diff.placements || []) {
        events.push({ type: 'piece-placement', ...piecePlacement });
    }

    const captures = diff.captures || [];
    const hasCaptures = captures.length > 0;

    if (diff.move) {
        const { from, to, piece } = diff.move;
        const path = diff.jumpPath;

        if (skipMoveAnimation) {
            captures.forEach((cap) => events.push({ type: 'capture', ...cap }));
            return { events, diff };
        }

        if (path && path.length > 1 && animateMultiJumps) {
            events.push({ type: 'jump-sequence', path, piece, captures });
            return { events, diff };
        }

        if (path && path.length > 2 && !animateMultiJumps) {
            return { events, diff };
        }

        if (path && path.length === 2 && !animateMultiJumps && manuallyEndedTurn) {
            return { events, diff };
        }

        if (hasCaptures) {
            events.push({ type: 'move-with-captures', from, to, piece, captures });
        } else {
            events.push({ type: 'move', from, to, piece });
        }

        return { events, diff };
    }

    if (diff.loopMove && diff.loopMove.path && diff.loopMove.piece && animateMultiJumps) {
        events.push({ type: 'jump-sequence', path: diff.loopMove.path, piece: diff.loopMove.piece, captures });
        return { events, diff };
    }

    if (!skipMoveAnimation && hasCaptures) {
        captures.forEach((cap) => events.push({ type: 'capture', ...cap }));
    }

    return { events, diff };
}

/**
 * Optional helper for the legacy-style GameGraphics API. Pass in the queue
 * returned by buildAnimationQueue and the concrete graphics adapter that
 * exposes the familiar queue* methods.
 */
export function playQueueWithGraphics(queueResult, graphicsApi) {
    if (!queueResult || !graphicsApi) return;
    const { events } = queueResult;

    events.forEach((event) => {
        switch (event.type) {
            case 'tile-placement':
                graphicsApi.queueTilePlacementAnimation(event.q, event.r, event.color);
                break;
            case 'piece-placement':
                graphicsApi.queuePiecePlacementAnimation(event.q, event.r, event.piece);
                break;
            case 'jump-sequence':
                graphicsApi.queueJumpSequenceWithCaptures(event.path, event.piece, event.captures || []);
                break;
            case 'move-with-captures':
                graphicsApi.queueSingleMoveWithCapture(
                    event.from.q,
                    event.from.r,
                    event.to.q,
                    event.to.r,
                    event.piece,
                    event.captures || []
                );
                break;
            case 'move':
                graphicsApi.queueMoveAnimation(event.from.q, event.from.r, event.to.q, event.to.r, event.piece);
                break;
            case 'capture':
                graphicsApi.queueCaptureAnimation(event.q, event.r, event.piece);
                break;
            default:
                break;
        }
    });
}
