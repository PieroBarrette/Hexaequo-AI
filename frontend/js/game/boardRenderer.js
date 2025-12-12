/**
 * Board Renderer - Bridges game state to graphics
 * 
 * Handles the rendering pipeline and animation diffing.
 */

/**
 * Board Renderer Class
 */
export class BoardRenderer {
    constructor(canvasGraphics, gameStore) {
        this.graphics = canvasGraphics;
        this.gameStore = gameStore;
        this.previousState = null;
        this.initialized = false;
    }

    /**
     * Initialize the renderer with state callback
     */
    init() {
        if (this.initialized) return;
        
        // Initialize graphics with state getter
        this.graphics.init(() => this.gameStore.getState());
        
        // Initial layout calculation
        this.graphics.updateDynamicLayout();
        
        this.initialized = true;
    }

    /**
     * Render the current game state
     */
    render(state) {
        if (!this.graphics) return;

        // First render - just draw
        if (!this.previousState) {
            this.previousState = this.deepClone(state);
            this.graphics.render();
            return;
        }

        // Calculate diff and queue animations
        const diff = this.calculateDiff(this.previousState, state);
        
        if (diff.hasChanges) {
            this.queueAnimationsFromDiff(diff, this.previousState, state);
        }
        
        this.previousState = this.deepClone(state);
        
        // Trigger render (animations will be handled in animation loop)
        this.graphics.render();
    }

    /**
     * Force re-render without diff
     */
    forceRender() {
        if (this.graphics) {
            this.graphics.updateDynamicLayout();
            this.graphics.render();
        }
    }

    /**
     * Deep clone state
     */
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    /**
     * Calculate diff between states
     */
    calculateDiff(prevState, newState) {
        const diff = {
            hasChanges: false,
            tilesAdded: [],
            tilesRemoved: [],
            piecesAdded: [],
            piecesRemoved: [],
            piecesMoved: [],
            piecesChanged: []
        };

        // Check tiles
        const prevTiles = Object.keys(prevState.tiles || {});
        const newTiles = Object.keys(newState.tiles || {});

        for (const key of newTiles) {
            if (!prevState.tiles[key]) {
                const [q, r] = key.split(',').map(Number);
                diff.tilesAdded.push({ q, r, color: newState.tiles[key] });
                diff.hasChanges = true;
            }
        }

        for (const key of prevTiles) {
            if (!newState.tiles[key]) {
                const [q, r] = key.split(',').map(Number);
                diff.tilesRemoved.push({ q, r });
                diff.hasChanges = true;
            }
        }

        // Check pieces
        const prevPieces = Object.keys(prevState.pieces || {});
        const newPieces = Object.keys(newState.pieces || {});

        // Find removed pieces (potential captures or moves)
        for (const key of prevPieces) {
            if (!newState.pieces[key]) {
                const [q, r] = key.split(',').map(Number);
                const piece = prevState.pieces[key];
                
                // Check if this piece moved somewhere else
                let foundAt = null;
                for (const newKey of newPieces) {
                    if (!prevState.pieces[newKey]) {
                        const newPiece = newState.pieces[newKey];
                        if (newPiece.type === piece.type && newPiece.color === piece.color) {
                            foundAt = newKey;
                            break;
                        }
                    }
                }

                if (foundAt) {
                    const [toQ, toR] = foundAt.split(',').map(Number);
                    diff.piecesMoved.push({ 
                        fromQ: q, fromR: r, 
                        toQ, toR, 
                        piece 
                    });
                } else {
                    diff.piecesRemoved.push({ q, r, piece });
                }
                diff.hasChanges = true;
            }
        }

        // Find added pieces (placements)
        for (const key of newPieces) {
            if (!prevState.pieces[key]) {
                const [q, r] = key.split(',').map(Number);
                const piece = newState.pieces[key];
                
                // Check if this was from a move
                const wasMove = diff.piecesMoved.some(m => m.toQ === q && m.toR === r);
                if (!wasMove) {
                    diff.piecesAdded.push({ q, r, piece });
                    diff.hasChanges = true;
                }
            }
        }

        return diff;
    }

    /**
     * Queue animations based on diff
     */
    queueAnimationsFromDiff(diff, prevState, newState) {
        // Tile placements
        for (const tile of diff.tilesAdded) {
            this.graphics.queueTilePlacementAnimation(tile.q, tile.r, tile.color);
        }

        // Piece movements
        for (const move of diff.piecesMoved) {
            this.graphics.queueMoveAnimation(
                move.fromQ, move.fromR,
                move.toQ, move.toR,
                move.piece
            );
        }

        // Piece captures (removed pieces that weren't moves)
        for (const removed of diff.piecesRemoved) {
            this.graphics.queueCaptureAnimation(removed.q, removed.r, removed.piece);
        }

        // Piece placements
        for (const placed of diff.piecesAdded) {
            this.graphics.queuePiecePlacementAnimation(placed.q, placed.r, placed.piece);
        }

        // Update layout after state changes
        this.graphics.updateDynamicLayout();
    }

    /**
     * Convert pixel coordinates to hex coordinates
     */
    pixelToHex(x, y) {
        if (!this.graphics) return null;
        return this.graphics.pixelToHex(x, y);
    }

    /**
     * Convert hex coordinates to pixel coordinates
     */
    hexToPixel(q, r) {
        if (!this.graphics) return null;
        return this.graphics.hexToPixel(q, r);
    }

    /**
     * Set color scheme
     */
    setColorScheme(scheme) {
        if (this.graphics) {
            this.graphics.setColorScheme(scheme);
            this.graphics.render();
        }
    }

    /**
     * Set animations enabled
     */
    setAnimationsEnabled(enabled) {
        if (this.graphics) {
            this.graphics.setAnimationsEnabled(enabled);
        }
    }

    /**
     * Check if currently animating
     */
    isAnimating() {
        return this.graphics?.isAnimating() || false;
    }

    /**
     * Resize handler
     */
    resize() {
        if (this.graphics) {
            this.graphics.resize();
        }
    }
}

export default BoardRenderer;
