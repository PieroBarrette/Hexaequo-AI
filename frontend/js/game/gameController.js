/**
 * GameController - Handles user input and game logic
 * 
 * Responsibilities:
 * - Process click/touch events on the canvas
 * - Validate and execute moves
 * - Manage piece selection and movement
 * - Coordinate between game state and rendering
 * - Handle multi-jump sequences
 * - Handle tile and piece placement
 * - Drag and drop support
 */

import { getNeighbors, getOpponent, GAME_CONSTANTS } from '../../../shared/game/constants.js';

// Grid radius
const GRID_RADIUS = 8;

// Drag threshold before drag starts
const DRAG_THRESHOLD = 8;

// Ring movement directions (2 spaces in each of 12 directions)
const RING_DIRECTIONS = [
    [0, -2], [1, -2], [2, -2], [2, -1], [2, 0], [1, 1],
    [0, 2], [-1, 2], [-2, 2], [-2, 1], [-2, 0], [-1, -1]
];

// Jump directions for discs
const JUMP_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

export class GameController {
    constructor(gameStore, boardRenderer, canvasGraphics, options = {}) {
        this.gameStore = gameStore;
        this.boardRenderer = boardRenderer;
        this.canvasGraphics = canvasGraphics;
        this.canvas = options.canvas;
        
        // Callbacks
        this.onMoveComplete = options.onMoveComplete || (() => {});
        this.onTurnEnd = options.onTurnEnd || (() => {});
        this.onGameEnd = options.onGameEnd || (() => {});
        this.playSound = options.playSound || (() => {});
        
        // Mode flags
        this.isOnlineMode = false;
        this.onlinePlayerColor = null;
        this.isAiMode = false;
        this.aiThinking = false;
        
        // UI button bounds (set by graphics during render)
        this.endTurnBtnBounds = null;
        this.placePieceBtnBounds = null;
        this.placePieceBtnTile = null;
        
        // Drag and drop state
        this.isDragging = false;
        this.draggedPiece = null;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragCurrentX = 0;
        this.dragCurrentY = 0;
        this.dragThresholdMet = false;
        
        // Multi-jump tracking
        this.turnStartState = null;
        this.turnStartPiecePos = null;
        this.jumpPath = [];
        this.jumpHistory = [];
        
        // Bind event handlers
        this.handleClick = this.handleClick.bind(this);
        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseUp = this.handleMouseUp.bind(this);
        this.handleTouchStart = this.handleTouchStart.bind(this);
        this.handleTouchMove = this.handleTouchMove.bind(this);
        this.handleTouchEnd = this.handleTouchEnd.bind(this);
    }

    /**
     * Initialize the controller
     */
    init(canvas = null) {
        if (canvas) {
            this.canvas = canvas;
        }
        
        if (!this.canvas) {
            console.error('GameController: No canvas provided');
            return;
        }

        // Set up event listeners
        this.canvas.addEventListener('click', this.handleClick);
        this.canvas.addEventListener('mousedown', this.handleMouseDown);
        this.canvas.addEventListener('mousemove', this.handleMouseMove);
        this.canvas.addEventListener('mouseup', this.handleMouseUp);
        this.canvas.addEventListener('mouseleave', this.handleMouseUp);
        this.canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
        this.canvas.addEventListener('touchmove', this.handleTouchMove, { passive: false });
        this.canvas.addEventListener('touchend', this.handleTouchEnd, { passive: false });
    }

    /**
     * Set online mode
     */
    setOnlineMode(enabled, playerColor = null) {
        this.isOnlineMode = enabled;
        this.onlinePlayerColor = playerColor;
        if (enabled) {
            this.isAiMode = false;
        }
    }

    /**
     * Set AI mode
     */
    setAiMode(enabled) {
        this.isAiMode = enabled;
        if (enabled) {
            this.isOnlineMode = false;
        }
    }

    /**
     * Check if it's the local player's turn
     */
    isMyTurn() {
        if (!this.isOnlineMode) return true;
        const state = this.gameStore.getState();
        return this.onlinePlayerColor === state.activePlayer;
    }

    /**
     * Check if moves are allowed
     */
    canMakeMove() {
        if (this.aiThinking) return false;
        if (this.canvasGraphics?.isAnimating?.()) return false;
        if (!this.isOnlineMode) return true;
        return this.isMyTurn();
    }

    /**
     * Update button bounds from graphics
     */
    setButtonBounds(endTurnBounds, placePieceBounds, placePieceTile) {
        this.endTurnBtnBounds = endTurnBounds;
        this.placePieceBtnBounds = placePieceBounds;
        this.placePieceBtnTile = placePieceTile;
    }

    /**
     * Get canvas coordinates from event
     */
    getCanvasCoordinates(event) {
        const rect = this.canvas.getBoundingClientRect();
        let mx, my;

        if (event.touches) {
            const touch = event.changedTouches?.[0] || event.touches[0];
            mx = touch.clientX - rect.left;
            my = touch.clientY - rect.top;
        } else {
            mx = event.clientX - rect.left;
            my = event.clientY - rect.top;
        }

        // Scale for canvas resolution
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        
        return {
            x: mx * scaleX,
            y: my * scaleY,
            rawX: mx,
            rawY: my
        };
    }

    /**
     * Check if hex coordinates are valid
     */
    isValidHex(q, r) {
        if (q < -GRID_RADIUS || q > GRID_RADIUS) return false;
        if (r < Math.max(-GRID_RADIUS, -q - GRID_RADIUS) || r > Math.min(GRID_RADIUS, -q + GRID_RADIUS)) return false;
        return true;
    }

    /**
     * Handle click events
     */
    handleClick(event) {
        // Ignore if we just finished a drag
        if (this.dragThresholdMet) {
            this.dragThresholdMet = false;
            return;
        }

        if (!this.canMakeMove()) return;

        const { x, y } = this.getCanvasCoordinates(event);

        // 1. Check UI buttons first
        if (this.handleUiButtons(x, y)) return;

        // 2. Get hex coordinates
        const hex = this.boardRenderer.pixelToHex(x, y);
        if (!hex || !this.isValidHex(hex.q, hex.r)) {
            this.clearSelection();
            return;
        }

        const state = this.gameStore.getState();
        const { q, r } = hex;
        const key = `${q},${r}`;
        const selection = state.metadata?.selection;
        const multiJumping = state.metadata?.multiJumping;

        // 3. Handle piece movement if something is selected
        if (selection) {
            if (this.handlePieceMovement(selection.q, selection.r, q, r)) {
                return;
            }
        }

        // 4. Handle selecting own piece
        const piece = state.pieces[key];
        if (piece && piece.color === state.activePlayer) {
            // In multi-jump, can only select the jumping piece
            if (multiJumping) {
                const multiJumpPos = state.metadata?.multiJumpPos;
                if (multiJumpPos && (q !== multiJumpPos.q || r !== multiJumpPos.r)) {
                    return;
                }
            }
            this.selectPiece(q, r);
            return;
        }

        // 5. Clear selection if clicking elsewhere
        if (selection) {
            // Cancel multi-jump if clicking elsewhere
            if (multiJumping && this.turnStartState) {
                this.cancelMultiJump();
            } else {
                this.clearSelection();
            }
            return;
        }

        // 6. Handle placement (disc, ring, tile)
        this.handlePlacement(q, r);
    }

    /**
     * Handle UI button clicks
     */
    handleUiButtons(x, y) {
        const state = this.gameStore.getState();
        const multiJumping = state.metadata?.multiJumping;

        // End Turn button (during multi-jump)
        if (multiJumping && this.endTurnBtnBounds) {
            const { x: bx, y: by, checkSize } = this.endTurnBtnBounds;
            const distance = Math.hypot(x - bx, y - by);
            if (distance <= checkSize) {
                this.endTurn();
                return true;
            }
        }

        // Place disc/ring buttons
        if (this.placePieceBtnBounds && this.placePieceBtnTile) {
            const { discBtn, ringBtn } = this.placePieceBtnBounds;
            
            if (discBtn && Math.hypot(x - discBtn.x, y - discBtn.y) <= discBtn.r) {
                this.placeDisc(this.placePieceBtnTile.q, this.placePieceBtnTile.r);
                return true;
            }
            
            if (ringBtn && Math.hypot(x - ringBtn.x, y - ringBtn.y) <= ringBtn.r) {
                this.placeRing(this.placePieceBtnTile.q, this.placePieceBtnTile.r);
                return true;
            }

            // Clicked elsewhere - cancel buttons
            this.placePieceBtnBounds = null;
            this.placePieceBtnTile = null;
            this.boardRenderer.render();
            return true;
        }

        return false;
    }

    /**
     * Select a piece
     */
    selectPiece(q, r) {
        this.gameStore.update(state => ({
            ...state,
            metadata: {
                ...state.metadata,
                selection: { q, r }
            }
        }));
        this.boardRenderer.render();
    }

    /**
     * Clear selection
     */
    clearSelection() {
        this.gameStore.update(state => ({
            ...state,
            metadata: {
                ...state.metadata,
                selection: null
            }
        }));
        this.boardRenderer.render();
    }

    /**
     * Handle piece movement
     */
    handlePieceMovement(fromQ, fromR, toQ, toR) {
        const state = this.gameStore.getState();
        const fromKey = `${fromQ},${fromR}`;
        const piece = state.pieces[fromKey];

        if (!piece) return false;

        if (piece.type === 'ring') {
            return this.handleRingMove(fromQ, fromR, toQ, toR);
        } else {
            return this.handleDiscMove(fromQ, fromR, toQ, toR);
        }
    }

    /**
     * Handle ring movement
     */
    handleRingMove(fromQ, fromR, toQ, toR) {
        const state = this.gameStore.getState();
        const validMoves = this.getRingValidMoves(fromQ, fromR, state.activePlayer);

        for (const move of validMoves) {
            if (move.q === toQ && move.r === toR) {
                this.executeRingMove(fromQ, fromR, toQ, toR, move.isCapture);
                return true;
            }
        }

        return false;
    }

    /**
     * Get valid moves for a ring
     */
    getRingValidMoves(q, r, player) {
        const state = this.gameStore.getState();
        const moves = [];

        for (const [dq, dr] of RING_DIRECTIONS) {
            const landingQ = q + dq;
            const landingR = r + dr;
            const landingKey = `${landingQ},${landingR}`;

            if (state.tiles[landingKey]) {
                const targetPiece = state.pieces[landingKey];
                if (targetPiece && targetPiece.color !== player) {
                    moves.push({ q: landingQ, r: landingR, isCapture: true });
                } else if (!targetPiece) {
                    moves.push({ q: landingQ, r: landingR, isCapture: false });
                }
            }
        }

        return moves;
    }

    /**
     * Execute ring move
     */
    executeRingMove(fromQ, fromR, toQ, toR, isCapture) {
        const fromKey = `${fromQ},${fromR}`;
        const toKey = `${toQ},${toR}`;
        const state = this.gameStore.getState();

        // Queue animation
        if (this.canvasGraphics) {
            this.canvasGraphics.queueMoveAnimation(fromQ, fromR, toQ, toR, state.pieces[fromKey]);
            if (isCapture) {
                this.canvasGraphics.queueCaptureAnimation(toQ, toR, state.pieces[toKey]);
            }
        }

        this.gameStore.update(s => {
            const newPieces = { ...s.pieces };
            const newCaptured = JSON.parse(JSON.stringify(s.captured));

            // Capture if needed
            if (isCapture && newPieces[toKey]) {
                const captured = newPieces[toKey];
                newCaptured[s.activePlayer] = newCaptured[s.activePlayer] || { disc: 0, ring: 0 };
                newCaptured[s.activePlayer][captured.type]++;
                delete newPieces[toKey];
            }

            // Move ring
            newPieces[toKey] = { ...newPieces[fromKey] };
            delete newPieces[fromKey];

            // Switch turns
            const nextPlayer = getOpponent(s.activePlayer);

            return {
                ...s,
                pieces: newPieces,
                captured: newCaptured,
                activePlayer: nextPlayer,
                lastMove: { from: { q: fromQ, r: fromR }, to: { q: toQ, r: toR }, type: isCapture ? 'capture' : 'move' },
                metadata: {
                    ...s.metadata,
                    selection: null,
                    multiJumping: false,
                    multiJumpPos: null
                }
            };
        });

        this.playSound(isCapture ? 'capture' : 'move');
        this.onMoveComplete();
        this.onTurnEnd();
        this.checkGameEnd();
    }

    /**
     * Handle disc movement
     */
    handleDiscMove(fromQ, fromR, toQ, toR) {
        const state = this.gameStore.getState();
        const multiJumping = state.metadata?.multiJumping;

        // Check adjacent move (only if not in multi-jump)
        if (!multiJumping) {
            const neighbors = getNeighbors(fromQ, fromR);
            for (const [nq, nr] of neighbors) {
                if (nq === toQ && nr === toR) {
                    const toKey = `${toQ},${toR}`;
                    if (state.tiles[toKey] && !state.pieces[toKey]) {
                        this.executeAdjacentMove(fromQ, fromR, toQ, toR);
                        return true;
                    }
                }
            }
        }

        // Check jump move
        return this.handleDiscJump(fromQ, fromR, toQ, toR);
    }

    /**
     * Execute adjacent (non-jump) disc move
     */
    executeAdjacentMove(fromQ, fromR, toQ, toR) {
        const fromKey = `${fromQ},${fromR}`;
        const toKey = `${toQ},${toR}`;
        const state = this.gameStore.getState();

        // Queue animation
        if (this.canvasGraphics) {
            this.canvasGraphics.queueMoveAnimation(fromQ, fromR, toQ, toR, state.pieces[fromKey]);
        }

        this.gameStore.update(s => {
            const newPieces = { ...s.pieces };
            newPieces[toKey] = { ...newPieces[fromKey] };
            delete newPieces[fromKey];

            const nextPlayer = getOpponent(s.activePlayer);

            return {
                ...s,
                pieces: newPieces,
                activePlayer: nextPlayer,
                lastMove: { from: { q: fromQ, r: fromR }, to: { q: toQ, r: toR }, type: 'move' },
                metadata: {
                    ...s.metadata,
                    selection: null,
                    multiJumping: false,
                    multiJumpPos: null
                }
            };
        });

        // Reset multi-jump state
        this.resetMultiJumpState();

        this.playSound('move');
        this.onMoveComplete();
        this.onTurnEnd();
        this.checkGameEnd();
    }

    /**
     * Handle disc jump
     */
    handleDiscJump(fromQ, fromR, toQ, toR) {
        const state = this.gameStore.getState();

        for (const [dq, dr] of JUMP_DIRECTIONS) {
            const jumpQ = fromQ + dq;
            const jumpR = fromR + dr;
            const landingQ = fromQ + 2 * dq;
            const landingR = fromR + 2 * dr;
            const jumpKey = `${jumpQ},${jumpR}`;
            const landingKey = `${landingQ},${landingR}`;

            if (toQ === landingQ && toR === landingR &&
                state.pieces[jumpKey] && 
                state.tiles[landingKey] && 
                !state.pieces[landingKey]) {

                // Check if jumping over same friendly piece twice
                const jumpedPiece = state.pieces[jumpKey];
                if (jumpedPiece.color === state.activePlayer) {
                    if (this.jumpHistory.some(h => h.q === jumpQ && h.r === jumpR)) {
                        continue;
                    }
                }

                // Prevent returning to origin without captures
                if (state.metadata?.multiJumping && this.turnStartPiecePos) {
                    if (landingQ === this.turnStartPiecePos.q && 
                        landingR === this.turnStartPiecePos.r && 
                        !this.hasCapturedDuringSequence()) {
                        continue;
                    }
                }

                this.executeDiscJump(fromQ, fromR, jumpQ, jumpR, landingQ, landingR);
                return true;
            }
        }

        // Invalid click during multi-jump - cancel if no valid move
        if (state.metadata?.multiJumping) {
            // Clicking on same piece does nothing
            if (fromQ === toQ && fromR === toR) return true;
            // Cancel multi-jump
            this.cancelMultiJump();
            return true;
        }

        return false;
    }

    /**
     * Execute disc jump
     */
    executeDiscJump(fromQ, fromR, jumpQ, jumpR, landingQ, landingR) {
        const fromKey = `${fromQ},${fromR}`;
        const jumpKey = `${jumpQ},${jumpR}`;
        const landingKey = `${landingQ},${landingR}`;
        const state = this.gameStore.getState();
        const jumpedPiece = state.pieces[jumpKey];
        const isCapture = jumpedPiece.color !== state.activePlayer;

        // Initialize multi-jump state if starting new sequence
        if (!state.metadata?.multiJumping) {
            this.turnStartState = this.serializeState(state);
            this.turnStartPiecePos = { q: fromQ, r: fromR };
            this.jumpPath = [{ q: fromQ, r: fromR }];
        }
        this.jumpPath.push({ q: landingQ, r: landingR });

        // Track jumped friendly pieces
        if (!isCapture) {
            this.jumpHistory.push({ q: jumpQ, r: jumpR });
        }

        // Queue animations
        if (this.canvasGraphics) {
            this.canvasGraphics.queueMoveAnimation(fromQ, fromR, landingQ, landingR, state.pieces[fromKey]);
            if (isCapture) {
                this.canvasGraphics.queueCaptureAnimation(jumpQ, jumpR, jumpedPiece);
            }
        }

        this.gameStore.update(s => {
            const newPieces = { ...s.pieces };
            const newCaptured = JSON.parse(JSON.stringify(s.captured));

            // Handle capture
            if (isCapture) {
                newCaptured[s.activePlayer] = newCaptured[s.activePlayer] || { disc: 0, ring: 0 };
                newCaptured[s.activePlayer][jumpedPiece.type]++;
                delete newPieces[jumpKey];
            }

            // Move piece
            newPieces[landingKey] = { ...newPieces[fromKey] };
            delete newPieces[fromKey];

            // Check if can continue jumping
            const canContinue = this.canJumpAgain(landingQ, landingR, s.activePlayer, newPieces, s.tiles);

            if (canContinue) {
                return {
                    ...s,
                    pieces: newPieces,
                    captured: newCaptured,
                    lastMove: { from: { q: fromQ, r: fromR }, to: { q: landingQ, r: landingR }, type: 'jump' },
                    metadata: {
                        ...s.metadata,
                        selection: { q: landingQ, r: landingR },
                        multiJumping: true,
                        multiJumpPos: { q: landingQ, r: landingR }
                    }
                };
            } else {
                // End turn
                const nextPlayer = getOpponent(s.activePlayer);
                return {
                    ...s,
                    pieces: newPieces,
                    captured: newCaptured,
                    activePlayer: nextPlayer,
                    lastMove: { from: { q: fromQ, r: fromR }, to: { q: landingQ, r: landingR }, type: 'jump', path: [...this.jumpPath] },
                    metadata: {
                        ...s.metadata,
                        selection: null,
                        multiJumping: false,
                        multiJumpPos: null
                    }
                };
            }
        });

        const newState = this.gameStore.getState();
        
        if (newState.metadata?.multiJumping) {
            this.playSound(isCapture ? 'capture' : 'jump');
            this.boardRenderer.render();
        } else {
            // Turn ended
            this.resetMultiJumpState();
            this.playSound(isCapture ? 'capture' : 'jump');
            this.onMoveComplete();
            this.onTurnEnd();
            this.checkGameEnd();
        }
    }

    /**
     * Check if piece can jump again
     */
    canJumpAgain(q, r, player, pieces, tiles) {
        for (const [dq, dr] of JUMP_DIRECTIONS) {
            const jumpQ = q + dq;
            const jumpR = r + dr;
            const landingQ = q + 2 * dq;
            const landingR = r + 2 * dr;
            const jumpKey = `${jumpQ},${jumpR}`;
            const landingKey = `${landingQ},${landingR}`;

            if (pieces[jumpKey] && tiles[landingKey] && !pieces[landingKey]) {
                // Check friendly piece jump restriction
                if (pieces[jumpKey].color === player) {
                    if (this.jumpHistory.some(h => h.q === jumpQ && h.r === jumpR)) {
                        continue;
                    }
                }

                // Check origin restriction
                if (this.turnStartPiecePos &&
                    landingQ === this.turnStartPiecePos.q &&
                    landingR === this.turnStartPiecePos.r &&
                    !this.hasCapturedDuringSequence()) {
                    continue;
                }

                return true;
            }
        }
        return false;
    }

    /**
     * Check if captures were made during multi-jump sequence
     */
    hasCapturedDuringSequence() {
        if (!this.turnStartState) return false;

        const currentState = this.gameStore.getState();
        const startCaptured = this.turnStartState.captured;
        const currentCaptured = currentState.captured;
        const player = currentState.activePlayer;

        const startDiscs = startCaptured[player]?.disc || 0;
        const startRings = startCaptured[player]?.ring || 0;
        const currentDiscs = currentCaptured[player]?.disc || 0;
        const currentRings = currentCaptured[player]?.ring || 0;

        return currentDiscs > startDiscs || currentRings > startRings;
    }

    /**
     * End turn (called from End Turn button during multi-jump)
     */
    endTurn() {
        const state = this.gameStore.getState();
        const jumpPathCopy = [...this.jumpPath];
        
        this.gameStore.update(s => {
            const nextPlayer = getOpponent(s.activePlayer);
            return {
                ...s,
                activePlayer: nextPlayer,
                lastMove: s.lastMove ? { ...s.lastMove, path: jumpPathCopy } : null,
                metadata: {
                    ...s.metadata,
                    selection: null,
                    multiJumping: false,
                    multiJumpPos: null
                }
            };
        });

        this.resetMultiJumpState();
        this.endTurnBtnBounds = null;

        this.playSound('turnEnd');
        this.onMoveComplete();
        this.onTurnEnd();
        this.checkGameEnd();
    }

    /**
     * Cancel multi-jump and restore state
     */
    cancelMultiJump() {
        if (this.turnStartState) {
            this.restoreState(this.turnStartState);
        }
        this.resetMultiJumpState();
        this.clearSelection();
    }

    /**
     * Reset multi-jump tracking state
     */
    resetMultiJumpState() {
        this.turnStartState = null;
        this.turnStartPiecePos = null;
        this.jumpPath = [];
        this.jumpHistory = [];
    }

    /**
     * Handle placement (tile, disc, ring)
     */
    handlePlacement(q, r) {
        const state = this.gameStore.getState();
        const key = `${q},${r}`;
        const player = state.activePlayer;

        // Check if clicking on own tile without piece (disc/ring placement)
        if (state.tiles[key] === player && !state.pieces[key]) {
            const canPlaceDisc = (state.discInventory?.[player] || 0) > 0;
            const canPlaceRing = (state.ringInventory?.[player] || 0) > 0 && 
                                 (state.captured?.[player]?.disc || 0) > 0;

            if (canPlaceDisc && canPlaceRing) {
                // Show both buttons
                this.placePieceBtnTile = { q, r };
                // Bounds will be set by graphics during render
                this.boardRenderer.render();
                return;
            } else if (canPlaceDisc) {
                this.placeDisc(q, r);
                return;
            } else if (canPlaceRing) {
                this.placeRing(q, r);
                return;
            }
        }

        // Check tile placement
        if (!state.tiles[key]) {
            if ((state.inventory?.[player] || 0) <= 0) return;

            // Count adjacent tiles
            let adjacent = 0;
            for (const [nq, nr] of getNeighbors(q, r)) {
                if (state.tiles[`${nq},${nr}`]) adjacent++;
            }

            if (adjacent >= 2) {
                this.placeTile(q, r);
            }
        }
    }

    /**
     * Place a tile
     */
    placeTile(q, r) {
        const key = `${q},${r}`;
        const state = this.gameStore.getState();

        // Queue animation
        if (this.canvasGraphics) {
            this.canvasGraphics.queueTilePlacementAnimation(q, r, state.activePlayer);
        }

        this.gameStore.update(s => {
            const newTiles = { ...s.tiles, [key]: s.activePlayer };
            const newInventory = { ...s.inventory };
            newInventory[s.activePlayer]--;

            const nextPlayer = getOpponent(s.activePlayer);

            return {
                ...s,
                tiles: newTiles,
                inventory: newInventory,
                activePlayer: nextPlayer,
                lastMove: { type: 'tile', position: { q, r } },
                metadata: { ...s.metadata, selection: null }
            };
        });

        this.playSound('place');
        this.onMoveComplete();
        this.onTurnEnd();
        this.checkGameEnd();
    }

    /**
     * Place a disc
     */
    placeDisc(q, r) {
        const key = `${q},${r}`;
        const state = this.gameStore.getState();

        // Queue animation
        if (this.canvasGraphics) {
            this.canvasGraphics.queuePiecePlacementAnimation(q, r, { type: 'disc', color: state.activePlayer });
        }

        this.gameStore.update(s => {
            const newPieces = { ...s.pieces, [key]: { type: 'disc', color: s.activePlayer } };
            const newDiscInventory = { ...s.discInventory };
            newDiscInventory[s.activePlayer]--;

            const nextPlayer = getOpponent(s.activePlayer);

            return {
                ...s,
                pieces: newPieces,
                discInventory: newDiscInventory,
                activePlayer: nextPlayer,
                lastMove: { type: 'placeDisc', position: { q, r } },
                metadata: { ...s.metadata, selection: null }
            };
        });

        this.placePieceBtnBounds = null;
        this.placePieceBtnTile = null;

        this.playSound('place');
        this.onMoveComplete();
        this.onTurnEnd();
        this.checkGameEnd();
    }

    /**
     * Place a ring
     */
    placeRing(q, r) {
        const key = `${q},${r}`;
        const state = this.gameStore.getState();

        // Queue animation
        if (this.canvasGraphics) {
            this.canvasGraphics.queuePiecePlacementAnimation(q, r, { type: 'ring', color: state.activePlayer });
        }

        this.gameStore.update(s => {
            const newPieces = { ...s.pieces, [key]: { type: 'ring', color: s.activePlayer } };
            const newRingInventory = { ...s.ringInventory };
            newRingInventory[s.activePlayer]--;

            // Return captured disc to opponent
            const opponent = getOpponent(s.activePlayer);
            const newCaptured = JSON.parse(JSON.stringify(s.captured));
            newCaptured[s.activePlayer].disc--;

            const newDiscInventory = { ...s.discInventory };
            newDiscInventory[opponent]++;

            const nextPlayer = opponent;

            return {
                ...s,
                pieces: newPieces,
                ringInventory: newRingInventory,
                discInventory: newDiscInventory,
                captured: newCaptured,
                activePlayer: nextPlayer,
                lastMove: { type: 'placeRing', position: { q, r } },
                metadata: { ...s.metadata, selection: null }
            };
        });

        this.placePieceBtnBounds = null;
        this.placePieceBtnTile = null;

        this.playSound('place');
        this.onMoveComplete();
        this.onTurnEnd();
        this.checkGameEnd();
    }

    /**
     * Calculate all valid moves for current player
     */
    calculateAllValidMoves(player) {
        const state = this.gameStore.getState();
        const highlights = [];
        const addedPieces = new Set();

        // 1. Pieces that can move
        for (const key in state.pieces) {
            const piece = state.pieces[key];
            if (piece.color !== player) continue;

            const [q, r] = key.split(',').map(Number);
            let canMove = false;

            if (piece.type === 'disc') {
                // Check adjacent moves (only if not in multi-jump)
                if (!state.metadata?.multiJumping) {
                    for (const [nq, nr] of getNeighbors(q, r)) {
                        const nkey = `${nq},${nr}`;
                        if (state.tiles[nkey] && !state.pieces[nkey]) {
                            canMove = true;
                            break;
                        }
                    }
                }

                // Check jump moves
                if (!canMove) {
                    for (const [dq, dr] of JUMP_DIRECTIONS) {
                        const jq = q + dq;
                        const jr = r + dr;
                        const landingQ = q + 2 * dq;
                        const landingR = r + 2 * dr;
                        const jumpKey = `${jq},${jr}`;
                        const landingKey = `${landingQ},${landingR}`;

                        if (state.pieces[jumpKey] && state.tiles[landingKey] && !state.pieces[landingKey]) {
                            if (!(state.pieces[jumpKey].color === player &&
                                  this.jumpHistory.some(h => h.q === jq && h.r === jr))) {
                                canMove = true;
                                break;
                            }
                        }
                    }
                }
            } else if (piece.type === 'ring') {
                const ringMoves = this.getRingValidMoves(q, r, player);
                canMove = ringMoves.length > 0;
            }

            if (canMove && !addedPieces.has(key)) {
                highlights.push({ q, r, type: 'piece' });
                addedPieces.add(key);
            }
        }

        // 2. Valid tile placement locations
        if ((state.inventory?.[player] || 0) > 0) {
            for (let q = -GRID_RADIUS; q <= GRID_RADIUS; q++) {
                for (let r = Math.max(-GRID_RADIUS, -q - GRID_RADIUS); r <= Math.min(GRID_RADIUS, -q + GRID_RADIUS); r++) {
                    const key = `${q},${r}`;
                    if (state.tiles[key]) continue;

                    let adjacent = 0;
                    for (const [nq, nr] of getNeighbors(q, r)) {
                        if (state.tiles[`${nq},${nr}`]) adjacent++;
                    }
                    if (adjacent >= 2) {
                        highlights.push({ q, r, type: 'tile' });
                    }
                }
            }
        }

        // 3. Valid piece placement locations
        for (const key in state.tiles) {
            if (state.tiles[key] === player && !state.pieces[key]) {
                const [q, r] = key.split(',').map(Number);
                const canPlaceDisc = (state.discInventory?.[player] || 0) > 0;
                const canPlaceRing = (state.ringInventory?.[player] || 0) > 0 &&
                                     (state.captured?.[player]?.disc || 0) > 0;

                if (canPlaceDisc || canPlaceRing) {
                    highlights.push({ q, r, type: 'placement' });
                }
            }
        }

        return highlights;
    }

    /**
     * Calculate valid moves for a specific piece
     */
    calculateValidMovesForPiece(q, r, player) {
        const state = this.gameStore.getState();
        const moves = [];
        const piece = state.pieces[`${q},${r}`];
        if (!piece || piece.color !== player) return moves;

        if (piece.type === 'disc') {
            // Adjacent moves
            if (!state.metadata?.multiJumping) {
                for (const [nq, nr] of getNeighbors(q, r)) {
                    const nkey = `${nq},${nr}`;
                    if (state.tiles[nkey] && !state.pieces[nkey]) {
                        moves.push({ q: nq, r: nr, type: 'adjacent' });
                    }
                }
            }

            // Jump moves
            for (const [dq, dr] of JUMP_DIRECTIONS) {
                const jq = q + dq;
                const jr = r + dr;
                const landingQ = q + 2 * dq;
                const landingR = r + 2 * dr;
                const jumpKey = `${jq},${jr}`;
                const landingKey = `${landingQ},${landingR}`;

                if (state.pieces[jumpKey] && state.tiles[landingKey] && !state.pieces[landingKey]) {
                    // Friendly piece restriction
                    if (state.pieces[jumpKey].color === player &&
                        this.jumpHistory.some(h => h.q === jq && h.r === jr)) {
                        continue;
                    }

                    // Origin restriction
                    if (state.metadata?.multiJumping && this.turnStartPiecePos &&
                        landingQ === this.turnStartPiecePos.q &&
                        landingR === this.turnStartPiecePos.r &&
                        !this.hasCapturedDuringSequence()) {
                        continue;
                    }

                    moves.push({ q: landingQ, r: landingR, type: 'jump' });
                }
            }
        } else if (piece.type === 'ring') {
            const ringMoves = this.getRingValidMoves(q, r, player);
            for (const m of ringMoves) {
                moves.push({ q: m.q, r: m.r, type: m.isCapture ? 'capture' : 'move' });
            }
        }

        return moves;
    }

    /**
     * Check for game end conditions
     */
    checkGameEnd() {
        const state = this.gameStore.getState();
        
        // Check captured rings (capturing 3 rings wins)
        for (const player of ['black', 'white']) {
            if ((state.captured?.[player]?.ring || 0) >= 3) {
                this.onGameEnd(player, 'rings');
                return;
            }
        }

        // Check if current player has no valid moves (loses)
        const validMoves = this.calculateAllValidMoves(state.activePlayer);
        if (validMoves.length === 0) {
            const winner = getOpponent(state.activePlayer);
            this.onGameEnd(winner, 'noMoves');
        }
    }

    /**
     * Serialize current state for undo/restore
     */
    serializeState(state) {
        return JSON.parse(JSON.stringify({
            tiles: state.tiles,
            pieces: state.pieces,
            inventory: state.inventory,
            discInventory: state.discInventory,
            ringInventory: state.ringInventory,
            captured: state.captured,
            activePlayer: state.activePlayer
        }));
    }

    /**
     * Restore state from serialized data
     */
    restoreState(savedState) {
        this.gameStore.update(s => ({
            ...s,
            ...savedState,
            metadata: {
                ...s.metadata,
                selection: null,
                multiJumping: false,
                multiJumpPos: null
            }
        }));
        this.boardRenderer.render();
    }

    // ==================== Drag and Drop Handlers ====================

    /**
     * Check if a piece can be dragged
     */
    canPieceBeDragged(q, r, player) {
        const state = this.gameStore.getState();
        const key = `${q},${r}`;
        const piece = state.pieces[key];
        if (!piece || piece.color !== player) return false;

        // In multi-jump, only the jumping piece can be moved
        if (state.metadata?.multiJumping && state.metadata?.multiJumpPos) {
            const mjp = state.metadata.multiJumpPos;
            return q === mjp.q && r === mjp.r;
        }

        // Check if piece has any valid moves
        const moves = this.calculateValidMovesForPiece(q, r, player);
        return moves.length > 0;
    }

    /**
     * Handle mouse down for drag
     */
    handleMouseDown(event) {
        if (!this.canMakeMove()) return;

        const { x, y } = this.getCanvasCoordinates(event);
        const hex = this.boardRenderer.pixelToHex(x, y);

        if (!hex) return;

        const state = this.gameStore.getState();
        
        if (!this.canPieceBeDragged(hex.q, hex.r, state.activePlayer)) {
            return;
        }

        const key = `${hex.q},${hex.r}`;
        const piece = state.pieces[key];

        // Initialize drag state
        this.dragStartX = x;
        this.dragStartY = y;
        this.dragCurrentX = x;
        this.dragCurrentY = y;
        this.draggedPiece = { q: hex.q, r: hex.r, piece: { ...piece } };
        this.isDragging = true;
        this.dragThresholdMet = false;

        // Select the piece
        this.selectPiece(hex.q, hex.r);

        this.canvas.style.cursor = 'grabbing';
    }

    /**
     * Handle mouse move for drag
     */
    handleMouseMove(event) {
        if (!this.isDragging || !this.draggedPiece) return;

        const { x, y } = this.getCanvasCoordinates(event);

        // Check threshold
        if (!this.dragThresholdMet) {
            const distance = Math.hypot(x - this.dragStartX, y - this.dragStartY);
            if (distance >= DRAG_THRESHOLD) {
                this.dragThresholdMet = true;
            }
        }

        this.dragCurrentX = x;
        this.dragCurrentY = y;

        // Update drag state for rendering
        if (this.dragThresholdMet) {
            this.gameStore.update(s => ({
                ...s,
                metadata: {
                    ...s.metadata,
                    dragState: {
                        piece: this.draggedPiece.piece,
                        fromQ: this.draggedPiece.q,
                        fromR: this.draggedPiece.r,
                        x: this.dragCurrentX,
                        y: this.dragCurrentY
                    }
                }
            }), true);

            this.boardRenderer.render();
        }
    }

    /**
     * Handle mouse up for drag
     */
    handleMouseUp(event) {
        if (!this.isDragging || !this.draggedPiece) {
            this.canvas.style.cursor = 'default';
            return;
        }

        const { x, y } = this.getCanvasCoordinates(event);
        const hex = this.boardRenderer.pixelToHex(x, y);

        // Clear drag state
        this.gameStore.update(s => ({
            ...s,
            metadata: {
                ...s.metadata,
                dragState: null
            }
        }), true);

        if (this.dragThresholdMet && hex) {
            // Try to move to drop location
            this.handlePieceMovement(this.draggedPiece.q, this.draggedPiece.r, hex.q, hex.r);
        }

        this.isDragging = false;
        this.draggedPiece = null;
        this.canvas.style.cursor = 'default';

        this.boardRenderer.render();
    }

    /**
     * Handle touch start
     */
    handleTouchStart(event) {
        event.preventDefault();
        if (event.touches.length === 1) {
            this.handleMouseDown(event);
        }
    }

    /**
     * Handle touch move
     */
    handleTouchMove(event) {
        event.preventDefault();
        if (event.touches.length === 1) {
            this.handleMouseMove(event);
        }
    }

    /**
     * Handle touch end
     */
    handleTouchEnd(event) {
        event.preventDefault();
        this.handleMouseUp(event);
    }

    /**
     * Apply a move received from network/AI
     */
    applyExternalMove(move) {
        // Apply move from multiplayer or AI
        if (move.type === 'tile') {
            this.placeTile(move.position.q, move.position.r);
        } else if (move.type === 'placeDisc') {
            this.placeDisc(move.position.q, move.position.r);
        } else if (move.type === 'placeRing') {
            this.placeRing(move.position.q, move.position.r);
        } else if (move.from && move.to) {
            // Piece movement
            this.handlePieceMovement(move.from.q, move.from.r, move.to.q, move.to.r);
        }
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
