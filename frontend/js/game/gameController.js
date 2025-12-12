/**
 * Game Controller - Handles user input and game flow
 */

import { validateMove, getValidMoves, hasAvailableJump } from '../../../shared/game/moveValidator.js';
import { getOpponent } from '../../../shared/game/gameState.js';

/**
 * Game Controller Class
 */
export class GameController {
    constructor(gameStore, boardRenderer) {
        this.gameStore = gameStore;
        this.boardRenderer = boardRenderer;
        this.canvas = null;
        this.selectedPiece = null;
        this.validMoves = [];
        this.isDragging = false;
        this.draggedPiece = null;

        // Input handlers bound to this
        this.handleClick = this.handleClick.bind(this);
        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseUp = this.handleMouseUp.bind(this);
        this.handleTouchStart = this.handleTouchStart.bind(this);
        this.handleTouchMove = this.handleTouchMove.bind(this);
        this.handleTouchEnd = this.handleTouchEnd.bind(this);
    }

    /**
     * Initialize controller with canvas
     */
    init(canvas) {
        this.canvas = canvas;

        // Mouse events
        canvas.addEventListener('click', this.handleClick);
        canvas.addEventListener('mousedown', this.handleMouseDown);
        canvas.addEventListener('mousemove', this.handleMouseMove);
        canvas.addEventListener('mouseup', this.handleMouseUp);
        canvas.addEventListener('mouseleave', this.handleMouseUp);

        // Touch events
        canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
        canvas.addEventListener('touchmove', this.handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', this.handleTouchEnd, { passive: false });
    }

    /**
     * Handle click on canvas
     */
    handleClick(event) {
        if (this.isDragging) return;

        const pos = this.getCanvasPosition(event);
        const hex = this.boardRenderer.pixelToHex(pos.x, pos.y);

        if (!hex) return;

        this.handleHexClick(hex.q, hex.r);
    }

    /**
     * Handle hex tile click
     */
    handleHexClick(q, r) {
        const state = this.gameStore.getState();
        const key = `${q},${r}`;

        // Check if clicking on a piece
        const piece = state.pieces[key];

        if (piece && piece.color === state.activePlayer) {
            // Select this piece
            this.selectPiece(q, r);
        } else if (this.selectedPiece) {
            // Try to move selected piece
            this.tryMove(this.selectedPiece.q, this.selectedPiece.r, q, r);
        } else if (state.tiles[key] === state.activePlayer && !piece) {
            // Empty owned tile - could place piece
            this.handleTilePlacement(q, r);
        }
    }

    /**
     * Select a piece
     */
    selectPiece(q, r) {
        const state = this.gameStore.getState();

        this.selectedPiece = { q, r };
        this.validMoves = getValidMoves(
            state.tiles,
            state.pieces,
            q, r,
            state.activePlayer,
            state.metadata?.jumpHistory || []
        );

        // Update state metadata
        this.gameStore.update(s => ({
            ...s,
            metadata: {
                ...s.metadata,
                selection: { q, r },
                validMoves: this.validMoves
            }
        }));
    }

    /**
     * Clear piece selection
     */
    clearSelection() {
        this.selectedPiece = null;
        this.validMoves = [];

        this.gameStore.update(s => ({
            ...s,
            metadata: {
                ...s.metadata,
                selection: null,
                validMoves: []
            }
        }));
    }

    /**
     * Try to move a piece
     */
    tryMove(fromQ, fromR, toQ, toR) {
        const state = this.gameStore.getState();

        const result = validateMove(
            state.tiles,
            state.pieces,
            fromQ, fromR,
            toQ, toR,
            state.activePlayer,
            state.metadata?.jumpHistory || []
        );

        if (!result.valid) {
            console.log('Invalid move:', result.reason);
            this.clearSelection();
            return false;
        }

        // Apply the move
        this.applyMove(fromQ, fromR, toQ, toR, result);
        return true;
    }

    /**
     * Apply a valid move to the game state
     */
    applyMove(fromQ, fromR, toQ, toR, moveResult) {
        this.gameStore.update(state => {
            const newState = { ...state };
            const fromKey = `${fromQ},${fromR}`;
            const toKey = `${toQ},${toR}`;

            // Move the piece
            const piece = { ...newState.pieces[fromKey] };
            newState.pieces = { ...newState.pieces };
            delete newState.pieces[fromKey];
            newState.pieces[toKey] = piece;

            // Handle captures
            if (moveResult.captured) {
                const capturedKey = `${moveResult.captured.q},${moveResult.captured.r}`;
                const capturedPiece = newState.pieces[capturedKey];

                if (capturedPiece) {
                    // Remove captured piece
                    delete newState.pieces[capturedKey];

                    // Update capture count
                    newState.captured = { ...newState.captured };
                    newState.captured[state.activePlayer] = {
                        ...newState.captured[state.activePlayer]
                    };
                    newState.captured[state.activePlayer][capturedPiece.type]++;
                }
            }

            // Check for multi-jump
            if (moveResult.isJump) {
                const canContinueJumping = hasAvailableJump(
                    newState.tiles,
                    newState.pieces,
                    toQ, toR,
                    state.activePlayer,
                    [...(state.metadata?.jumpHistory || []), { q: fromQ, r: fromR }]
                );

                if (canContinueJumping) {
                    // Continue multi-jump
                    newState.metadata = {
                        ...newState.metadata,
                        multiJumping: true,
                        jumpHistory: [...(state.metadata?.jumpHistory || []), { q: fromQ, r: fromR }],
                        selection: { q: toQ, r: toR }
                    };
                } else {
                    // End turn
                    newState.activePlayer = getOpponent(state.activePlayer);
                    newState.metadata = {
                        ...newState.metadata,
                        multiJumping: false,
                        jumpHistory: [],
                        selection: null
                    };
                }
            } else {
                // Non-jump move ends turn
                newState.activePlayer = getOpponent(state.activePlayer);
                newState.metadata = {
                    ...newState.metadata,
                    multiJumping: false,
                    jumpHistory: [],
                    selection: null
                };
            }

            // Record last move
            newState.lastMove = {
                from: { q: fromQ, r: fromR },
                to: { q: toQ, r: toR },
                type: moveResult.isJump ? 'jump' : 'move'
            };

            return newState;
        });

        this.clearSelection();
    }

    /**
     * Handle tile placement (placeholder)
     */
    handleTilePlacement(q, r) {
        // TODO: Implement tile placement UI
        console.log('Tile placement at:', q, r);
    }

    /**
     * Get canvas position from event
     */
    getCanvasPosition(event) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    }

    /**
     * Handle mouse down
     */
    handleMouseDown(event) {
        const pos = this.getCanvasPosition(event);
        const hex = this.boardRenderer.pixelToHex(pos.x, pos.y);

        if (!hex) return;

        const state = this.gameStore.getState();
        const key = `${hex.q},${hex.r}`;
        const piece = state.pieces[key];

        if (piece && piece.color === state.activePlayer) {
            this.isDragging = true;
            this.draggedPiece = { q: hex.q, r: hex.r, piece };
            this.selectPiece(hex.q, hex.r);
        }
    }

    /**
     * Handle mouse move
     */
    handleMouseMove(event) {
        if (!this.isDragging || !this.draggedPiece) return;

        const pos = this.getCanvasPosition(event);

        // Update drag state for rendering
        this.gameStore.update(s => ({
            ...s,
            metadata: {
                ...s.metadata,
                dragState: {
                    piece: this.draggedPiece.piece,
                    x: pos.x,
                    y: pos.y
                }
            }
        }), true); // Skip notify to avoid excessive re-renders
    }

    /**
     * Handle mouse up
     */
    handleMouseUp(event) {
        if (!this.isDragging || !this.draggedPiece) {
            this.isDragging = false;
            return;
        }

        const pos = this.getCanvasPosition(event);
        const hex = this.boardRenderer.pixelToHex(pos.x, pos.y);

        if (hex) {
            this.tryMove(this.draggedPiece.q, this.draggedPiece.r, hex.q, hex.r);
        }

        this.isDragging = false;
        this.draggedPiece = null;

        // Clear drag state
        this.gameStore.update(s => ({
            ...s,
            metadata: {
                ...s.metadata,
                dragState: null
            }
        }));
    }

    /**
     * Handle touch start
     */
    handleTouchStart(event) {
        event.preventDefault();
        if (event.touches.length === 1) {
            const touch = event.touches[0];
            this.handleMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
        }
    }

    /**
     * Handle touch move
     */
    handleTouchMove(event) {
        event.preventDefault();
        if (event.touches.length === 1) {
            const touch = event.touches[0];
            this.handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
        }
    }

    /**
     * Handle touch end
     */
    handleTouchEnd(event) {
        event.preventDefault();
        const touch = event.changedTouches[0];
        this.handleMouseUp({ clientX: touch.clientX, clientY: touch.clientY });
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.canvas) {
            this.canvas.removeEventListener('click', this.handleClick);
            this.canvas.removeEventListener('mousedown', this.handleMouseDown);
            this.canvas.removeEventListener('mousemove', this.handleMouseMove);
            this.canvas.removeEventListener('mouseup', this.handleMouseUp);
            this.canvas.removeEventListener('mouseleave', this.handleMouseUp);
            this.canvas.removeEventListener('touchstart', this.handleTouchStart);
            this.canvas.removeEventListener('touchmove', this.handleTouchMove);
            this.canvas.removeEventListener('touchend', this.handleTouchEnd);
        }
    }
}

export default GameController;
