# Hexaequo Usage Notes

Living document that captures how to run the in-progress architecture and how shared modules are intended to be consumed. Update this file whenever a new refactor adds cross-cutting instructions.

## Serving the project locally
- Always serve the repository root so both `frontend` and `hexaequo-v2` can read the `/shared` modules directly.
- From PowerShell, run `cd C:\Users\ebarp018\Documents\GitHub\Hexaequo-AI; npx http-server . -c-1` (or any equivalent static server) and open `http://localhost:8080/hexaequo-v2/` or `/frontend/`.
- Opening files directly via `file://` is also valid as long as the directory layout is preserved, but a server mirrors production more closely.

## Shared game modules
The canonical game logic now resides under `shared/game/`. Modules are re-exported from `frontend/js/game` for the new UI, while the legacy client imports them directly.

| Module | Purpose | Notes |
| --- | --- | --- |
| `constants.js` | Hex math, piece counts, default radius | Used by move generation and game state helpers |
| `moveValidator.js` | Stateless move generation (`calculateAllValidMoves`, `calculateValidMovesForPiece`) | Shared by both clients and any AI layer |
| `gameState.js` | Initialization, serialization, snapshot helpers | Provides `serializeState`, `applySnapshot`, `createInitialState` |
| `history.js` | `HistoryManager` class for undo/redo, persistence, repetition detection | Legacy game now instantiates a single shared manager |
| `animationDiff.js` *(new)* | Describes how to animate a transition between states | Consumed by `GameGraphics` to queue motion/capture sequences |

## History manager quick-start
```js
import { HistoryManager } from '../shared/game/history.js';
const history = new HistoryManager();
history.recordInitialState(serializeState());
// After each accepted move:
history.recordMove(serializeState(), { moveType: 'move', jumpPath, isOpponentMove });
if (history.canUndo()) {
    const previous = history.stepBackward();
    restoreGameState(previous.gameState);
}
```
The manager clones snapshots internally, so callers can pass the objects returned by `shared/game/gameState.js` without worrying about mutation.

## Animation pipeline
- `shared/game/animationDiff.js` exposes `diffStatesForAnimation(previousState, updatedState, { jumpPath })` and `normaliseJumpPath`.
- Call it with the two serialized states that bracket a move; the helper returns tile placements, piece placements, captures, a normalized jump path, and loop metadata for edge cases where a disc ends where it started.
- Feed the diff into your renderer. Example:

    ```js
    import { diffStatesForAnimation } from '../shared/game/animationDiff.js';

    const diff = diffStatesForAnimation(prev, next, { jumpPath });
    diff.tilePlacements.forEach(({ q, r, color }) => queueTilePlacementAnimation(q, r, color));
    if (diff.move && diff.jumpPath) {
        queueJumpSequenceWithCaptures(diff.jumpPath, diff.move.piece, diff.captures);
    }
    ```

- Because the helper always prefers the provided `jumpPath` (falling back to `updatedState.lastJumpPath`), discs that traverse multi-jump loops animate deterministically even when their origin and destination tiles are identical.

### Animation smoke tests
- Run `node tests/animation/animationTests.mjs` from the repo root to exercise both `diffStatesForAnimation` and `buildAnimationQueue` end-to-end.
- The script relies on the local `frontend/` and `shared/` package manifests declaring `"type": "module"`, which lets Node import the browser-oriented ES modules without a bundler.

## Local testing procedure
Use this checklist when you want to play with the refactor locally without touching production or provisioning the backend/database yet.

1. **Serve the repo root** (already described above). Any simple static server works; the key is exposing `/shared` so both `frontend` and `hexaequo-v2` can load the shared modules.
2. **Open the UIs directly**:
    - `http://localhost:8080/hexaequo-v2/` gives you the legacy experience (uses `GameGraphics`, AI worker, etc.).
    - `http://localhost:8080/frontend/` renders the modern shell. Many feature panels are still stubs, but asset loading paths work.
3. **No backend/DB needed yet**. All current refactors (move validation, history, animation diffing) run entirely in the browser. You can leave PostgreSQL, Redis, and the Node backend off until multiplayer/auth work begins.
4. **Optional AI worker**: the legacy UI auto-loads `ai-worker.js` when available (no extra setup). If you see console errors about the worker, double-check the static server root so relative paths resolve.
5. **Cache busting**: the static server command above disables caching (`-c-1`). If you use another tool, make sure it doesn’t cache modules aggressively or the browser may hold on to outdated shared files.

When you later need backend features, run `node backend/server.js` (or the server package’s entry point) in parallel, but that is not required for the current gameplay refactor work.

Keep adding notes here whenever a refactor introduces new steps or conventions.
