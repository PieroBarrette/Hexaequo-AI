// Shared move-history manager for Hexaequo.
// Keeps undo/redo bookkeeping independent from any specific UI layer.

const DEFAULT_HISTORY_STEP = 1;

export class HistoryManager {
    constructor(options = {}) {
        this.movesPerStep = options.movesPerStep ?? DEFAULT_HISTORY_STEP;
        this.reset();
    }

    reset() {
        this.moveHistory = [];
        this.currentMoveIndex = -1;
        this.isRestoringState = false;
        this.initialGameState = null;
    }

    recordInitialState(state) {
        if (!state) return null;
        this.beginRestoration();
        const snapshot = createSnapshot(state, 'initial');
        this.moveHistory = [snapshot];
        this.currentMoveIndex = 0;
        this.initialGameState = deepClone(snapshot.gameState);
        this.endRestoration();
        return snapshot;
    }

    recordMove(state, options = {}) {
        if (!state || this.isRestoringState) {
            return null;
        }

        const { moveType = 'move', jumpPath = null, isOpponentMove = false } = options;

        if (this.currentMoveIndex < this.moveHistory.length - 1 && !isOpponentMove) {
            this.moveHistory = this.moveHistory.slice(0, this.currentMoveIndex + 1);
        }

        const snapshot = createSnapshot(state, moveType, jumpPath);
        this.moveHistory.push(snapshot);
        this.currentMoveIndex = this.moveHistory.length - 1;
        return snapshot;
    }

    canUndo(steps = this.movesPerStep) {
        return this.currentMoveIndex - steps >= 0;
    }

    canRedo(steps = this.movesPerStep) {
        return this.currentMoveIndex + steps < this.moveHistory.length;
    }

    stepBackward(steps = this.movesPerStep) {
        if (!this.canUndo(steps)) return null;
        this.currentMoveIndex -= steps;
        return this.getCurrentEntry();
    }

    stepForward(steps = this.movesPerStep) {
        if (!this.canRedo(steps)) return null;
        this.currentMoveIndex += steps;
        return this.getCurrentEntry();
    }

    getCurrentEntry() {
        if (this.currentMoveIndex < 0) return null;
        return this.moveHistory[this.currentMoveIndex] ?? null;
    }

    getEntryByIndex(index) {
        if (index < 0 || index >= this.moveHistory.length) return null;
        return this.moveHistory[index];
    }

    getEntryRelative(offset) {
        return this.getEntryByIndex(this.currentMoveIndex + offset);
    }

    getHistoryLength() {
        return this.moveHistory.length;
    }

    getCurrentIndex() {
        return this.currentMoveIndex;
    }

    getMovesBackFromEnd() {
        if (this.moveHistory.length === 0 || this.currentMoveIndex < 0) {
            return 0;
        }
        return this.moveHistory.length - 1 - this.currentMoveIndex;
    }

    isAtEnd() {
        if (this.moveHistory.length === 0) return true;
        return this.currentMoveIndex >= this.moveHistory.length - 1;
    }

    beginRestoration() {
        this.isRestoringState = true;
    }

    endRestoration() {
        this.isRestoringState = false;
    }

    hasThreefoldRepetition() {
        if (this.moveHistory.length < 5 || this.currentMoveIndex < 0) {
            return false;
        }

        const counts = Object.create(null);
        for (let i = 0; i <= this.currentMoveIndex; i++) {
            const entry = this.moveHistory[i];
            if (!entry?.positionHash) continue;
            counts[entry.positionHash] = (counts[entry.positionHash] || 0) + 1;
            if (counts[entry.positionHash] >= 3) {
                return true;
            }
        }
        return false;
    }

    exportState() {
        return {
            moveHistory: deepClone(this.moveHistory),
            currentMoveIndex: this.currentMoveIndex
        };
    }

    importState(payload = {}) {
        const history = Array.isArray(payload.moveHistory) ? payload.moveHistory : [];
        this.moveHistory = deepClone(history);

        if (this.moveHistory.length === 0) {
            this.currentMoveIndex = -1;
            return;
        }

        const providedIndex = typeof payload.currentMoveIndex === 'number'
            ? payload.currentMoveIndex
            : this.moveHistory.length - 1;
        this.currentMoveIndex = clamp(providedIndex, 0, this.moveHistory.length - 1);
    }
}

export function getPositionHash(gameState) {
    if (!gameState) return '';
    const tiles = Object.keys(gameState.tiles || {})
        .sort()
        .map((key) => `${key}:${gameState.tiles[key]}`)
        .join('|');
    const pieces = Object.keys(gameState.pieces || {})
        .sort()
        .map((key) => {
            const piece = gameState.pieces[key];
            if (!piece) return `${key}:empty`;
            return `${key}:${piece.type}:${piece.color}`;
        })
        .join('|');
    const inv = gameState.inventory || {};
    const inventoryStr = [
        `b:${inv.black?.tiles ?? 0},${inv.black?.discs ?? 0},${inv.black?.rings ?? 0}`,
        `w:${inv.white?.tiles ?? 0},${inv.white?.discs ?? 0},${inv.white?.rings ?? 0}`
    ].join('|');

    return `${gameState.activePlayer ?? 'black'}#${tiles}#${pieces}#${inventoryStr}`;
}

function createSnapshot(state, moveType, jumpPath) {
    return {
        gameState: deepClone(state),
        moveType,
        jumpPath: jumpPath ? deepClone(jumpPath) : null,
        positionHash: getPositionHash(state),
        timestamp: Date.now()
    };
}

function deepClone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
    if (Number.isNaN(value)) return min;
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}
