import assert from 'node:assert/strict';
import { diffStatesForAnimation } from '../../shared/game/animationDiff.js';
import { buildAnimationQueue } from '../../frontend/js/game/animationController.js';

function testCaptureDiff() {
    const previousState = {
        activePlayer: 'black',
        tiles: { '0,0': 'black', '0,1': 'black', '0,2': 'black' },
        pieces: {
            '0,0': { type: 'disc', color: 'black' },
            '0,1': { type: 'disc', color: 'white' }
        }
    };

    const updatedState = {
        activePlayer: 'white',
        tiles: previousState.tiles,
        pieces: {
            '0,2': { type: 'disc', color: 'black' }
        },
        lastJumpPath: ['0,0', '0,2']
    };

    const diff = diffStatesForAnimation(previousState, updatedState, {
        jumpPath: [{ q: 0, r: 0 }, { q: 0, r: 2 }]
    });

    assert.equal(diff.captures.length, 1, 'capture detected');
    assert.deepEqual(diff.captures[0], { q: 0, r: 1, piece: { type: 'disc', color: 'white' } });
    assert.deepEqual(diff.move.from, { q: 0, r: 0 });
    assert.deepEqual(diff.move.to, { q: 0, r: 2 });
}

function testLoopPathDetection() {
    const previousState = {
        activePlayer: 'black',
        tiles: { '0,0': 'black' },
        pieces: {
            '0,0': { type: 'disc', color: 'black' }
        }
    };

    const updatedState = {
        activePlayer: 'white',
        tiles: previousState.tiles,
        pieces: {
            '0,0': { type: 'disc', color: 'black' }
        },
        lastJumpPath: ['0,0', '1,-1', '0,-2', '-1,-1', '0,0']
    };

    const diff = diffStatesForAnimation(previousState, updatedState, {});
    assert(diff.loopMove, 'loopMove present');
    assert.equal(diff.loopMove.path.length, 5);
    assert.equal(diff.loopMove.piece.color, 'black');
}

function testAnimationQueueMultiJump() {
    const previousState = {
        activePlayer: 'black',
        tiles: { '0,0': 'black', '0,1': 'black', '0,2': 'black' },
        pieces: {
            '0,0': { type: 'disc', color: 'black' },
            '0,1': { type: 'disc', color: 'white' }
        }
    };

    const updatedState = {
        activePlayer: 'white',
        tiles: previousState.tiles,
        pieces: {
            '0,2': { type: 'disc', color: 'black' }
        }
    };

    const { events } = buildAnimationQueue(previousState, updatedState, {
        jumpPath: [{ q: 0, r: 0 }, { q: 0, r: 2 }],
        animateMultiJumps: true
    });

    assert.equal(events.length, 1, 'single jump-sequence event');
    assert.equal(events[0].type, 'jump-sequence');
    assert.deepEqual(events[0].path[0], { q: 0, r: 0 });
    assert.deepEqual(events[0].path.at(-1), { q: 0, r: 2 });
    assert.equal(events[0].captures.length, 1);
}

function testAnimationQueuePlacement() {
    const previousState = {
        activePlayer: 'black',
        tiles: { '0,0': 'black' },
        pieces: {}
    };

    const updatedState = {
        activePlayer: 'white',
        tiles: previousState.tiles,
        pieces: {
            '0,0': { type: 'disc', color: 'black' }
        }
    };

    const { events } = buildAnimationQueue(previousState, updatedState);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'piece-placement');
}

function run() {
    testCaptureDiff();
    testLoopPathDetection();
    testAnimationQueueMultiJump();
    testAnimationQueuePlacement();
    console.log('Animation tests passed');
}

try {
    run();
} catch (err) {
    console.error('Animation tests failed');
    console.error(err);
    process.exitCode = 1;
}
