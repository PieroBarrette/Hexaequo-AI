// game.js
// Entry point for Hexaequo V2 game logic

let endTurnBtnBounds = null; // Used to track the End Turn button position for click detection
let placePieceBtnBounds = null; // Used to track contextual place disc/ring buttons
let placePieceBtnTile = null; // {q, r} for which tile the buttons are shown

// Global variables for game mode
let isAiMode = false;
let isSoundEnabled = true;
let aiDifficulty = 2; // 1: Easy, 2: Medium, 3: Hard

// Online multiplayer mode
let isOnlineMode = false;
let onlinePlayerColor = null; // 'black' or 'white'

// Global variables for valid moves indicator
let showValidMoves = false;
let showPreviousMove = true;
let validMovesHighlights = []; // Array of { q, r, type: 'tile'|'piece'|'move' }
let globalDrawGrid = null; // Reference to drawGrid function for redraw triggering

// Animation settings
let animationsEnabled = true;
const ANIMATION_DURATION_MS = 200; // Duration for all animations in milliseconds - easy to change globally

// Toggle between AI and 2-player modes
function toggleGameMode(aiMode) {
    isAiMode = aiMode;
    if (!aiMode) {
        // When switching away from AI mode, also disable online mode
        isOnlineMode = false;
        onlinePlayerColor = null;
    }
    if (isAiMode) {
        console.log('Switched to AI Mode');
    } else {
        console.log('Switched to 2 Player Mode');
    }
}

// Set online mode
function setOnlineMode(enabled, playerColor = null) {
    isOnlineMode = enabled;
    onlinePlayerColor = playerColor;
    if (enabled) {
        isAiMode = false; // Ensure AI mode is off
        console.log('Online Mode enabled, playing as:', playerColor);
    } else {
        onlinePlayerColor = null;
        console.log('Online Mode disabled');
    }
}

// Check if it's the local player's turn in online mode
function isMyTurn(activePlayer) {
    if (!isOnlineMode) return true;
    return onlinePlayerColor === activePlayer;
}

function setSoundEnabled(enabled) {
    isSoundEnabled = enabled;
    console.log('Sound enabled:', isSoundEnabled);
}

function setAiDifficulty(level) {
    aiDifficulty = level;
    console.log('AI Difficulty set to:', aiDifficulty);
}

function setShowValidMoves(enabled) {
    showValidMoves = enabled;
    console.log('Show valid moves:', showValidMoves);
    // Trigger redraw if drawGrid is available
    if (globalDrawGrid) {
        globalDrawGrid();
    }
}

function setShowPreviousMove(enabled) {
    showPreviousMove = enabled;
    console.log('Show previous move:', showPreviousMove);
    // Trigger redraw if drawGrid is available
    if (globalDrawGrid) {
        globalDrawGrid();
    }
}

function setAnimationsEnabled(enabled) {
    animationsEnabled = enabled;
    console.log('Animations enabled:', animationsEnabled);
    // Update graphics module
    if (window.GameGraphics && window.GameGraphics.setAnimationsEnabled) {
        window.GameGraphics.setAnimationsEnabled(enabled);
    }
}

function getAnimationDuration() {
    return ANIMATION_DURATION_MS;
}

// Expose to global scope
window.toggleGameMode = toggleGameMode;
window.isAiMode = isAiMode;
window.setSoundEnabled = setSoundEnabled;
window.setAiDifficulty = setAiDifficulty;
window.setShowValidMoves = setShowValidMoves;
window.setShowPreviousMove = setShowPreviousMove;
window.setAnimationsEnabled = setAnimationsEnabled;
window.getAnimationDuration = getAnimationDuration;
window.setOnlineMode = setOnlineMode;
window.isMyTurn = isMyTurn;

window.onload = function () {
    const canvas = document.getElementById('gameCanvas');
    const inventoryCanvas = document.getElementById('inventoryCanvas');
    const btnCoords = document.getElementById('toggleCoordsBtn');
    const btnScheme = document.getElementById('toggleColorSchemeBtn');
    const playerStatus = document.getElementById('playerStatus');
    let showCoords = false;
    let colorScheme = 'classic'; // 'modern' or 'classic'
    let activePlayer = 'black'; // 'black' starts
    let selectedPiece = null; // {q, r} or null
    let lastMove = null; // Stores the last move for highlighting
    let captured = {
        black: { disc: 0, ring: 0 },
        white: { disc: 0, ring: 0 }
    };
    let ringInventory = {
        black: 3,
        white: 3
    };
    let showGrid = false;
    let multiJumping = false; // true if in a multi-jump sequence
    let multiJumpPos = null; // {q, r} of the piece in multi-jump
    let turnStartState = null; // State at the beginning of a multi-jump sequence
    let turnStartPiecePos = null; // Position of the piece at the start of the sequence
    let jumpPath = []; // Array of {q, r} positions visited during a multi-jump sequence
    let lastJumpPath = null; // Stores the jump path to pass to highlightLastMove
    let jumpPathForOnline = null; // Stores jump path to send with online moves

    // Drag and drop state
    let isDragging = false;
    let draggedPiece = null; // { q, r, piece: {type, color} } - original position and piece data
    let dragCurrentX = 0; // Current canvas X position of dragged piece
    let dragCurrentY = 0; // Current canvas Y position of dragged piece
    let dragStartX = 0; // Starting canvas X position (for threshold detection)
    let dragStartY = 0; // Starting canvas Y position (for threshold detection)
    let dragThresholdMet = false; // Whether the drag threshold has been met
    const DRAG_THRESHOLD = 8; // Minimum pixels to move before drag starts

    // Move history for undo/redo functionality
    let moveHistory = []; // Array of {gameState, moveType}
    let currentMoveIndex = 0; // Index of the current position in move history
    let isRestoringState = false; // Flag to prevent recording moves during undo/redo restoration
    let initialGameState = null; // Store the initial state for undo to game start

    // Helper function to check if we're at the end of move history
    // In online mode, moves can only be made when at the end of history
    function isAtEndOfHistory() {
        return currentMoveIndex >= moveHistory.length - 1;
    }

    // Check if moves are allowed (for online mode: must be at end of history AND your turn)
    function canMakeMove() {
        if (!isOnlineMode) return true;
        return isAtEndOfHistory() && isMyTurn(activePlayer);
    }

    // Each player starts with 9 tiles, 2 are already placed
    let inventory = {
        black: 7,
        white: 7
    };
    // Each player starts with 6 discs, 1 is already placed
    let discInventory = {
        black: 5,
        white: 5
    };

    // Grid radius in hexes
    const radius = 8;

    // Initial tile content: key = 'q,r', value = 'black' or 'white'
    let tiles = {
        '0,0': 'black',
        '1,0': 'black',
        '-1,1': 'white',
        '0,1': 'white',
    };

    // Pieces: key = 'q,r', value = {type: 'disc'|'ring', color: 'black'|'white'}
    let pieces = {
        '1,0': { type: 'disc', color: 'black' },
        '-1,1': { type: 'disc', color: 'white' },
    };

    // Returns array of [q, r] for neighbors
    function getNeighbors(q, r) {
        return [
            [q + 1, r], [q - 1, r], [q, r + 1], [q, r - 1], [q + 1, r - 1], [q - 1, r + 1]
        ];
    }

    // Helper to check if any captures have been made during the current multi-jump sequence
    function hasCapturedDuringSequence() {
        if (!turnStartState) return false;

        const currentCaptured = captured[activePlayer];
        const startCaptured = turnStartState.captured;

        const startDiscs = activePlayer === 'black' ? startCaptured.black_discs : startCaptured.white_discs;
        const startRings = activePlayer === 'black' ? startCaptured.black_rings : startCaptured.white_rings;
        const currentDiscs = currentCaptured.disc;
        const currentRings = currentCaptured.ring;

        return (currentDiscs !== startDiscs) || (currentRings !== startRings);
    }

    // Helper to check if game state changed during multi-jump
    function isGameStateChanged() {
        if (!turnStartState || !turnStartPiecePos || !multiJumpPos) return true;

        const capturesChanged = hasCapturedDuringSequence();
        const positionChanged = (multiJumpPos.q !== turnStartPiecePos.q) || (multiJumpPos.r !== turnStartPiecePos.r);

        return capturesChanged || positionChanged;
    }

    /**
     * Get the current game state for the graphics module
     * This provides read-only access to game state
     */
    function getGameState() {
        return {
            tiles,
            pieces,
            inventory,
            discInventory,
            ringInventory,
            captured,
            activePlayer,
            selectedPiece,
            lastMove,
            multiJumping,
            multiJumpPos,
            showCoords,
            showGrid,
            colorScheme,
            endTurnBtnBounds,
            placePieceBtnBounds,
            placePieceBtnTile,
            validMovesHighlights,
            showValidMoves,
            showPreviousMove,
            isGameStateChanged,
            calculateAllValidMoves,
            calculateValidMovesForPiece,
            // Online mode helpers
            isAtEndOfHistory,
            canMakeMove,
            // Drag and drop state
            isDragging,
            draggedPiece,
            dragCurrentX,
            dragCurrentY,
            dragThresholdMet
        };
    }

    // Initialize GameGraphics module
    GameGraphics.init(canvas, inventoryCanvas, getGameState);

    // Helper function to trigger redraw via GameGraphics
    function drawGrid() {
        const bounds = GameGraphics.drawGrid();
        // Update button bounds from graphics return values
        if (bounds.endTurnBtnBounds) {
            endTurnBtnBounds = bounds.endTurnBtnBounds;
        }
        if (bounds.placePieceBtnBounds) {
            placePieceBtnBounds = bounds.placePieceBtnBounds;
        }
    }

    // Helper function to trigger inventory redraw
    function drawInventory() {
        GameGraphics.drawInventory();
    }

    // Helper function to update dynamic layout
    function updateDynamicLayout() {
        GameGraphics.updateDynamicLayout();
    }

    // Helper function for coordinate conversion
    function pixelToHex(x, y) {
        return GameGraphics.pixelToHex(x, y);
    }

    // Helper function for coordinate conversion
    function hexToPixel(q, r, size) {
        return GameGraphics.hexToPixel(q, r, size);
    }

    // Responsive canvas sizing - delegated to GameGraphics
    function resizeCanvas() {
        GameGraphics.resizeCanvas();
    }

    // Function to set the game theme
    function setGameTheme(theme) {
        if (theme === 'dark') {
            colorScheme = 'modern';
        } else {
            colorScheme = 'classic';
        }
        drawGrid();
        drawInventory();
    }
    window.setGameTheme = setGameTheme;

    // Initialize canvas size and set up resize listener
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Store reference to drawGrid for triggering redraws from global functions
    globalDrawGrid = drawGrid;

    // Set up undo/redo button listeners
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    
    if (undoBtn) {
        undoBtn.addEventListener('click', undoMove);
    }
    
    if (redoBtn) {
        redoBtn.addEventListener('click', redoMove);
    }

    btnCoords.addEventListener('click', function () {
        showCoords = !showCoords;
        drawGrid();
    });

    btnScheme.addEventListener('click', function () {
        colorScheme = colorScheme === 'modern' ? 'classic' : 'modern';
        drawGrid();
    });

    // Handle placing tiles on click
    // Returns array of [q, r] for neighbors
    function getNeighbors(q, r) {
        return [
            [q + 1, r], [q - 1, r], [q, r + 1], [q, r - 1], [q + 1, r - 1], [q - 1, r + 1]
        ];
    }

    // Calculate all valid moves for a player (returns pieces that can be moved, and placement locations)
    function calculateAllValidMoves(player) {
        const highlights = [];
        const addedPieces = new Set(); // Track pieces already added to avoid duplicates

        // 1. Pieces that can move (disc and ring pieces)
        for (const key in pieces) {
            const piece = pieces[key];
            if (piece.color !== player) continue;
            
            const [q, r] = key.split(',').map(Number);
            let canMove = false;

            if (piece.type === 'disc') {
                // Check adjacent moves (only if not already in multi-jump)
                if (!multiJumping) {
                    for (const [nq, nr] of getNeighbors(q, r)) {
                        const nkey = `${nq},${nr}`;
                        if (tiles[nkey] && !pieces[nkey]) {
                            canMove = true;
                            break;
                        }
                    }
                }

                // Check jump moves
                if (!canMove) {
                    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
                    for (const [dq, dr] of directions) {
                        const jq = q + dq;
                        const jr = r + dr;
                        const landingQ = q + 2 * dq;
                        const landingR = r + 2 * dr;
                        const jumpKey = `${jq},${jr}`;
                        const landingKey = `${landingQ},${landingR}`;

                        if (pieces[jumpKey] && tiles[landingKey] && !pieces[landingKey]) {
                            // Prevent jumping over same friendly piece twice during multi-jump
                            if (!(pieces[jumpKey].color === player && window.jumpHistory && window.jumpHistory.some(h => h.q === jq && h.r === jr))) {
                                canMove = true;
                                break;
                            }
                        }
                    }
                }
            } else if (piece.type === 'ring') {
                // Check ring moves
                const ringDirections = [[0, -2], [1, -2], [2, -2], [2, -1], [2, 0], [1, 1], [0, 2], [-1, 2], [-2, 2], [-2, 1], [-2, 0], [-1, -1]];
                for (const [dq, dr] of ringDirections) {
                    const landingQ = q + dq;
                    const landingR = r + dr;
                    const landingKey = `${landingQ},${landingR}`;

                    if (tiles[landingKey]) {
                        const targetPiece = pieces[landingKey];
                        if (!targetPiece || targetPiece.color !== player) {
                            canMove = true;
                            break;
                        }
                    }
                }
            }

            // Add piece location if it can move
            if (canMove) {
                const pieceKey = `${q},${r}`;
                if (!addedPieces.has(pieceKey)) {
                    highlights.push({ q, r, type: 'piece' });
                    addedPieces.add(pieceKey);
                }
            }
        }

        // 2. Valid tile placement locations
        if (inventory[player] > 0) {
            for (let q = -radius; q <= radius; q++) {
                for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
                    const key = `${q},${r}`;
                    if (tiles[key]) continue; // Occupied
                    
                    let adjacent = 0;
                    for (const [nq, nr] of getNeighbors(q, r)) {
                        if (tiles[`${nq},${nr}`]) adjacent++;
                    }
                    if (adjacent >= 2) {
                        highlights.push({ q, r, type: 'tile' });
                    }
                }
            }
        }

        // 3. Valid piece placement locations (disc/ring on player's own tiles)
        for (const key in tiles) {
            if (tiles[key] === player && !pieces[key]) {
                const [q, r] = key.split(',').map(Number);
                
                if (discInventory[player] > 0 || (ringInventory[player] > 0 && captured[player].disc > 0)) {
                    highlights.push({ q, r, type: 'placement' });
                }
            }
        }

        return highlights;
    }

    // Calculate valid moves for a specific piece
    function calculateValidMovesForPiece(q, r, player) {
        const moves = [];
        const piece = pieces[`${q},${r}`];
        if (!piece || piece.color !== player) return moves;

        if (piece.type === 'disc') {
            // Adjacent moves (only if not already in multi-jump)
            if (!multiJumping) {
                for (const [nq, nr] of getNeighbors(q, r)) {
                    const nkey = `${nq},${nr}`;
                    if (tiles[nkey] && !pieces[nkey]) {
                        moves.push({ q: nq, r: nr, type: 'adjacent' });
                    }
                }
            }

            // Jump moves
            const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
            for (const [dq, dr] of directions) {
                const jq = q + dq;
                const jr = r + dr;
                const landingQ = q + 2 * dq;
                const landingR = r + 2 * dr;
                const jumpKey = `${jq},${jr}`;
                const landingKey = `${landingQ},${landingR}`;

                if (pieces[jumpKey] && tiles[landingKey] && !pieces[landingKey]) {
                    // Prevent jumping over same friendly piece twice during multi-jump
                    if (pieces[jumpKey].color === player && window.jumpHistory && window.jumpHistory.some(h => h.q === jq && h.r === jr)) {
                        continue;
                    }

                    // Prevent showing origin tile as valid destination if no captures made during multi-jump
                    if (multiJumping && turnStartPiecePos && 
                        landingQ === turnStartPiecePos.q && landingR === turnStartPiecePos.r && 
                        !hasCapturedDuringSequence()) {
                        continue;
                    }

                    moves.push({ q: landingQ, r: landingR, type: 'jump' });
                }
            }
        } else if (piece.type === 'ring') {
            // Ring moves
            const ringDirections = [[0, -2], [1, -2], [2, -2], [2, -1], [2, 0], [1, 1], [0, 2], [-1, 2], [-2, 2], [-2, 1], [-2, 0], [-1, -1]];
            for (const [dq, dr] of ringDirections) {
                const landingQ = q + dq;
                const landingR = r + dr;
                const landingKey = `${landingQ},${landingR}`;

                if (tiles[landingKey]) {
                    const targetPiece = pieces[landingKey];
                    if (targetPiece && targetPiece.color !== player) {
                        // Can capture
                        moves.push({ q: landingQ, r: landingR, type: 'capture' });
                    } else if (!targetPiece) {
                        // Can move to empty tile
                        moves.push({ q: landingQ, r: landingR, type: 'move' });
                    }
                }
            }
        }

        return moves;
    }

    // Unified event handler for both click and touch
    function handleCanvasInteraction(e) {
        e.preventDefault(); // Prevent default touch behavior

        // In online mode, block input if it's not our turn OR if viewing history
        if (isOnlineMode && !canMakeMove()) {
            if (!isAtEndOfHistory()) {
                console.log('Cannot make moves while viewing history - navigate to current position first');
            } else {
                console.log('Not your turn');
            }
            return;
        }

        const { mx, my } = getCanvasCoordinates(e);
        const [q, r] = pixelToHex(mx, my);

        // 1. Handle UI Buttons (End Turn, Place Piece)
        if (handleUiButtons(mx, my)) return;

        // 2. Check bounds
        if (!isValidHex(q, r)) {
            selectedPiece = null;
            drawGrid();
            return;
        }

        const key = `${q},${r}`;

        // 3. Handle Piece Selection and Movement
        if (selectedPiece) {
            if (handlePieceMovement(q, r)) return;
        }

        // 4. Handle Selecting Own Piece
        if (pieces[key] && pieces[key].color === activePlayer) {
            selectedPiece = { q, r };
            drawGrid();
            return;
        }

        // 5. Handle Clicking Elsewhere (Unselect)
        if (selectedPiece) {
            selectedPiece = null;
            drawGrid();
            return;
        }

        // 6. Handle Placement (Disc, Ring, Tile)
        handlePlacement(q, r);
    }

    function getCanvasCoordinates(e) {
        const rect = canvas.getBoundingClientRect();
        let mx, my;

        if (e.type === 'touchstart' || e.type === 'touchend') {
            const touch = e.changedTouches[0];
            mx = touch.clientX - rect.left;
            my = touch.clientY - rect.top;
        } else {
            mx = e.clientX - rect.left;
            my = e.clientY - rect.top;
        }

        // Scale coordinates for canvas resolution
        mx = mx * (canvas.width / rect.width);
        my = my * (canvas.height / rect.height);
        return { mx, my };
    }

    function isValidHex(q, r) {
        if (q < -radius || q > radius) return false;
        if (r < Math.max(-radius, -q - radius) || r > Math.min(radius, -q + radius)) return false;
        return true;
    }

    function handleUiButtons(mx, my) {
        // If End Turn checkmark is visible and clicked
        if (multiJumping && endTurnBtnBounds) {
            const { x, y, checkSize } = endTurnBtnBounds;
            // Check if click is within the checkmark area (using a circular hit area)
            const distance = Math.hypot(mx - x, my - y);
            if (distance <= checkSize) {
                endTurn();
                return true;
            }
        }
        // If contextual place disc/ring buttons are visible
        // If contextual place disc/ring buttons are visible
        if (placePieceBtnBounds && placePieceBtnTile) {
            const { discBtn, ringBtn } = placePieceBtnBounds;
            // Disc button (check distance)
            if (Math.hypot(mx - discBtn.x, my - discBtn.y) <= discBtn.r) {
                placeDisc(placePieceBtnTile.q, placePieceBtnTile.r);
                return true;
            }
            // Ring button (check distance)
            if (Math.hypot(mx - ringBtn.x, my - ringBtn.y) <= ringBtn.r) {
                placeRing(placePieceBtnTile.q, placePieceBtnTile.r);
                return true;
            }
            // Clicked elsewhere: cancel buttons
            placePieceBtnBounds = null;
            placePieceBtnTile = null;
            drawGrid();
            return true; // Consumed click
        }
        return false;
    }

    function endTurn() {
        gameState = serializeGameState();
        multiJumping = false;
        multiJumpPos = null;
        selectedPiece = null;
        endTurnBtnBounds = null;
        turnStartState = null;
        turnStartPiecePos = null;
        // Store the jump path before clearing
        lastJumpPath = jumpPath.length > 1 ? [...jumpPath] : null;
        jumpPathForOnline = lastJumpPath; // Store for online move sending
        jumpPath = [];
        window.jumpHistory = []; // Clear jump history to prevent blocking valid jumps on next turn
        //recordMove('turn');
        activePlayer = activePlayer === 'black' ? 'white' : 'black';
        updatedState = serializeGameState();
        // Pass manuallyEndedTurn=true since user clicked the checkmark
        applyGameState(updatedState, gameState, lastJumpPath, false, true);
        lastJumpPath = null;
    }

    function placeDisc(q, r) {
        gameState = serializeGameState();
        const key = `${q},${r}`;
        pieces[key] = { type: 'disc', color: activePlayer };
        discInventory[activePlayer]--;
        placePieceBtnBounds = null;
        placePieceBtnTile = null;
        //recordMove('placeDisc');
        activePlayer = activePlayer === 'black' ? 'white' : 'black';
        updatedState = serializeGameState();
        applyGameState(updatedState, gameState);
    }

    function placeRing(q, r) {
        gameState = serializeGameState();
        const key = `${q},${r}`;
        pieces[key] = { type: 'ring', color: activePlayer };
        ringInventory[activePlayer]--;
        // Return a captured disc to opponent
        const opp = activePlayer === 'black' ? 'white' : 'black';
        captured[activePlayer].disc--;
        discInventory[opp]++;
        placePieceBtnBounds = null;
        placePieceBtnTile = null;
        //recordMove('placeRing');
        activePlayer = opp;
        updatedState = serializeGameState();
        applyGameState(updatedState, gameState);
    }

    function handlePieceMovement(q, r) {
        const { q: sq, r: sr } = selectedPiece;
        const selectedKey = `${sq},${sr}`;
        const selectedType = pieces[selectedKey].type;
        const key = `${q},${r}`;

        if (selectedType === 'ring') {
            const validMoves = getRingJumpPositions(sq, sr, activePlayer);
            for (const move of validMoves) {
                if (move.q === q && move.r === r) {
                    performRingMove(sq, sr, q, r, move.capture);
                    return true;
                }
            }
            // If no valid move, unselect (handled by caller)
            return false;
        }

        // Disc logic
        // If in multi-jump, only allow further jumps
        if (!multiJumping) {
            // Check adjacent move
            for (const [nq, nr] of getNeighbors(sq, sr)) {
                if (nq === q && nr === r && tiles[key] && !pieces[key]) {
                    performAdjacentMove(sq, sr, q, r);
                    return true;
                }
            }
        }

        // Check jump move
        return handleDiscJump(sq, sr, q, r);
    }

    function performRingMove(sq, sr, q, r, isCapture, skipMoveAnimation = false) {
        gameState = serializeGameState();
        if (isCapture) {
            const capturedKey = `${q},${r}`;
            const capturedPiece = pieces[capturedKey];
            captured[activePlayer][capturedPiece.type]++;
            delete pieces[capturedKey];
        }
        pieces[`${q},${r}`] = { type: 'ring', color: activePlayer };
        delete pieces[`${sq},${sr}`];
        selectedPiece = null;
        //recordMove('ringMove');
        activePlayer = activePlayer === 'black' ? 'white' : 'black';
        updatedState = serializeGameState();
        applyGameState(updatedState, gameState, null, false, false, skipMoveAnimation);
    }

    function performAdjacentMove(sq, sr, q, r, skipMoveAnimation = false) {
        gameState = serializeGameState();
        pieces[`${q},${r}`] = { type: 'disc', color: activePlayer };
        delete pieces[`${sq},${sr}`];
        selectedPiece = null;
        multiJumping = false;
        multiJumpPos = null;
        endTurnBtnBounds = null;
        window.jumpHistory = [];
        //recordMove('adjacentMove');
        activePlayer = activePlayer === 'black' ? 'white' : 'black';
        updatedState = serializeGameState();
        applyGameState(updatedState, gameState, null, false, false, skipMoveAnimation);
    }

    function handleDiscJump(sq, sr, q, r) {
        if (!window.jumpHistory) window.jumpHistory = [];
        const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

        for (const [dq, dr] of directions) {
            const jq = sq + dq;
            const jr = sr + dr;
            const landingQ = sq + 2 * dq;
            const landingR = sr + 2 * dr;
            const jumpKey = `${jq},${jr}`;
            const landingKey = `${landingQ},${landingR}`;

            if (q === landingQ && r === landingR && pieces[jumpKey] && tiles[landingKey] && !pieces[landingKey]) {
                // Prevent jumping over same friendly piece
                if (pieces[jumpKey].color === activePlayer && window.jumpHistory.some(h => h.q === jq && h.r === jr)) {
                    continue;
                }

                // Prevent returning to origin tile without any captures (invalid loop)
                if (multiJumping && turnStartPiecePos && 
                    landingQ === turnStartPiecePos.q && landingR === turnStartPiecePos.r && 
                    !hasCapturedDuringSequence()) {
                    continue;
                }

                performDiscJump(sq, sr, jq, jr, landingQ, landingR, jumpKey, landingKey);
                return true;
            }
        }

        // If in multi-jump and clicking elsewhere (invalid jump), cancel or reset
        if (multiJumping) {
            if (multiJumpPos && multiJumpPos.q === q && multiJumpPos.r === r) return true; // Clicked self

            // Cancel multi-jump
            if (turnStartState) {
                applyGameState(turnStartState, serializeGameState());
            }
            multiJumping = false;
            multiJumpPos = null;
            selectedPiece = null;
            endTurnBtnBounds = null;
            turnStartState = null;
            turnStartPiecePos = null;
            window.jumpHistory = [];
            drawGrid();
            return true;
        }

        return false;
    }

    function performDiscJump(sq, sr, jq, jr, landingQ, landingR, jumpKey, landingKey, skipMoveAnimation = false) {
        gameState = serializeGameState();

        if (!multiJumping) {
            turnStartState = JSON.parse(JSON.stringify(gameState));
            turnStartPiecePos = { q: sq, r: sr };
            // Start tracking jump path from the starting position
            jumpPath = [{ q: sq, r: sr }];
        }
        // Add landing position to jump path
        jumpPath.push({ q: landingQ, r: landingR });

        // Track if we captured something for animation purposes
        let capturedPiece = null;
        if (pieces[jumpKey].type === 'disc' && pieces[jumpKey].color !== activePlayer) {
            capturedPiece = { ...pieces[jumpKey] };
            captured[activePlayer].disc++;
            delete pieces[jumpKey];
        } else if (pieces[jumpKey].type === 'ring' && pieces[jumpKey].color !== activePlayer) {
            capturedPiece = { ...pieces[jumpKey] };
            captured[activePlayer].ring++;
            delete pieces[jumpKey];
        }

        pieces[landingKey] = { type: 'disc', color: activePlayer };
        delete pieces[`${sq},${sr}`];

        if (pieces[jumpKey] && pieces[jumpKey].color === activePlayer) {
            window.jumpHistory.push({ q: jq, r: jr });
        }

        if (canJumpAgain(landingQ, landingR, activePlayer, window.jumpHistory)) {
            selectedPiece = { q: landingQ, r: landingR };
            multiJumping = true;
            multiJumpPos = { q: landingQ, r: landingR };
            endTurnBtnBounds = null;
            
            // If drag & drop with capture, animate the capture only
            if (skipMoveAnimation && capturedPiece) {
                GameGraphics.queueCaptureAnimation(jq, jr, capturedPiece);
            }
            
            drawGrid();
        } else {
            selectedPiece = null;
            multiJumping = false;
            multiJumpPos = null;
            endTurnBtnBounds = null;
            window.jumpHistory = [];
            // Store the jump path before clearing
            lastJumpPath = jumpPath.length > 1 ? [...jumpPath] : null;
            jumpPathForOnline = lastJumpPath; // Store for online move sending
            jumpPath = [];
            //recordMove('jump');
            activePlayer = activePlayer === 'black' ? 'white' : 'black';
            updatedState = serializeGameState();
            applyGameState(updatedState, gameState, lastJumpPath, false, false, skipMoveAnimation);
            lastJumpPath = null;
        }
    }

    function handlePlacement(q, r) {
        const key = `${q},${r}`;

        // Place disc or ring if possible
        if (tiles[key] === activePlayer && !pieces[key]) {
            const canPlaceDisc = discInventory[activePlayer] > 0;
            const canPlaceRing = ringInventory[activePlayer] > 0 && captured[activePlayer].disc > 0;

            if (canPlaceDisc && canPlaceRing) {
                placePieceBtnBounds = { discBtn: {}, ringBtn: {} };
                placePieceBtnTile = { q, r };
                drawGrid();
                return;
            } else if (canPlaceDisc) {
                placeDisc(q, r);
                return;
            } else if (canPlaceRing) {
                placeRing(q, r);
                return;
            }
        }

        // Place tile
        if (tiles[key]) return; // Occupied
        if (inventory[activePlayer] <= 0) return; // No tiles

        let adjacent = 0;
        for (const [nq, nr] of getNeighbors(q, r)) {
            if (tiles[`${nq},${nr}`]) adjacent++;
        }
        if (adjacent < 2) return;

        gameState = serializeGameState();
        tiles[key] = activePlayer;
        inventory[activePlayer]--;
        //recordMove('tile');
        activePlayer = activePlayer === 'black' ? 'white' : 'black';
        updatedState = serializeGameState();
        applyGameState(updatedState, gameState);
    }

    // Returns true if another jump is available for the piece at (q, r)
    function canJumpAgain(q, r, player, jumpHistory = []) {
        const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
        for (const [dq, dr] of directions) {
            const jq = q + dq;
            const jr = r + dr;
            const landingQ = q + 2 * dq;
            const landingR = r + 2 * dr;
            const jumpKey = `${jq},${jr}`;
            const landingKey = `${landingQ},${landingR}`;
            if (pieces[jumpKey] && tiles[landingKey] && !pieces[landingKey]) {
                // Must jump over a piece (any color), land on empty tile
                // Prevent jumping over the same friendly piece twice
                if (
                    pieces[jumpKey].color === player &&
                    jumpHistory.some(h => h.q === jq && h.r === jr)
                ) {
                    continue;
                }
                // Prevent counting origin tile as valid if no captures made
                if (turnStartPiecePos && 
                    landingQ === turnStartPiecePos.q && landingR === turnStartPiecePos.r && 
                    !hasCapturedDuringSequence()) {
                    continue;
                }
                // At least one jump available
                return true;
            }
        }
        return false;
    }

    // ==================== Drag and Drop Handlers ====================

    /**
     * Check if a piece can be moved by the current player
     */
    function canPieceBeDragged(q, r, player) {
        const key = `${q},${r}`;
        const piece = pieces[key];
        if (!piece || piece.color !== player) return false;

        // In multi-jump mode, only the jumping piece can be moved
        if (multiJumping && multiJumpPos) {
            return q === multiJumpPos.q && r === multiJumpPos.r;
        }

        // Check if the piece has any valid moves
        if (piece.type === 'disc') {
            // Check adjacent moves (only if not in multi-jump)
            for (const [nq, nr] of getNeighbors(q, r)) {
                const nkey = `${nq},${nr}`;
                if (tiles[nkey] && !pieces[nkey]) {
                    return true;
                }
            }
            // Check jump moves
            const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
            for (const [dq, dr] of directions) {
                const jq = q + dq;
                const jr = r + dr;
                const landingQ = q + 2 * dq;
                const landingR = r + 2 * dr;
                const jumpKey = `${jq},${jr}`;
                const landingKey = `${landingQ},${landingR}`;
                if (pieces[jumpKey] && tiles[landingKey] && !pieces[landingKey]) {
                    // Prevent jumping over same friendly piece twice during multi-jump
                    if (!(pieces[jumpKey].color === player && window.jumpHistory && window.jumpHistory.some(h => h.q === jq && h.r === jr))) {
                        return true;
                    }
                }
            }
        } else if (piece.type === 'ring') {
            const ringDirections = [[0, -2], [1, -2], [2, -2], [2, -1], [2, 0], [1, 1], [0, 2], [-1, 2], [-2, 2], [-2, 1], [-2, 0], [-1, -1]];
            for (const [dq, dr] of ringDirections) {
                const landingQ = q + dq;
                const landingR = r + dr;
                const landingKey = `${landingQ},${landingR}`;
                if (tiles[landingKey]) {
                    const targetPiece = pieces[landingKey];
                    if (!targetPiece || targetPiece.color !== player) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Handle the start of a drag operation (mousedown/touchstart)
     */
    function handleDragStart(e) {
        e.preventDefault();

        // Block if not allowed to make moves (online mode: not our turn or viewing history)
        if (isOnlineMode && !canMakeMove()) {
            return;
        }

        // Block if animations are playing
        if (GameGraphics.isAnimating()) {
            return;
        }

        const { mx, my } = getCanvasCoordinates(e);
        const [q, r] = pixelToHex(mx, my);

        // Check if clicking on a piece that can be dragged
        if (!canPieceBeDragged(q, r, activePlayer)) {
            return;
        }

        const key = `${q},${r}`;
        const piece = pieces[key];

        // Initialize drag state
        dragStartX = mx;
        dragStartY = my;
        dragCurrentX = mx;
        dragCurrentY = my;
        draggedPiece = { q, r, piece: { ...piece } };
        isDragging = true;
        dragThresholdMet = false;

        // Select the piece
        selectedPiece = { q, r };

        // Change cursor
        canvas.style.cursor = 'grabbing';

        drawGrid();
    }

    /**
     * Handle drag movement (mousemove/touchmove)
     */
    function handleDragMove(e) {
        if (!isDragging || !draggedPiece) return;

        e.preventDefault();

        const { mx, my } = getCanvasCoordinates(e);

        // Check if threshold has been met
        if (!dragThresholdMet) {
            const distance = Math.hypot(mx - dragStartX, my - dragStartY);
            if (distance >= DRAG_THRESHOLD) {
                dragThresholdMet = true;
            }
        }

        // Update drag position
        dragCurrentX = mx;
        dragCurrentY = my;

        // Redraw to show piece following cursor
        drawGrid();
    }

    /**
     * Handle the end of a drag operation (mouseup/touchend)
     */
    function handleDragEnd(e) {
        if (!isDragging || !draggedPiece) {
            // Reset cursor just in case
            canvas.style.cursor = 'default';
            return;
        }

        e.preventDefault();

        const { mx, my } = getCanvasCoordinates(e);
        const [dropQ, dropR] = pixelToHex(mx, my);

        // Reset cursor
        canvas.style.cursor = 'default';

        // If threshold was not met, treat as a click (selection only)
        if (!dragThresholdMet) {
            isDragging = false;
            draggedPiece = null;
            dragThresholdMet = false;
            // selectedPiece is already set, just redraw
            // Don't set dragJustCompleted - let the click event process normally for piece selection
            drawGrid();
            return;
        }

        // Threshold was met - this was a drag, suppress subsequent click event
        dragJustCompleted = true;

        const { q: fromQ, r: fromR, piece } = draggedPiece;

        // Reset drag state BEFORE executing move (so drawGrid inside move functions doesn't show dragged piece)
        isDragging = false;
        draggedPiece = null;
        dragThresholdMet = false;

        // Store state before handling for online mode
        const stateBefore = isOnlineMode ? serializeGameState() : null;

        // Try to execute the move
        let moveExecuted = false;

        if (piece.type === 'disc') {
            // Check for adjacent move (only if not in multi-jump)
            if (!multiJumping) {
                for (const [nq, nr] of getNeighbors(fromQ, fromR)) {
                    if (nq === dropQ && nr === dropR && tiles[`${dropQ},${dropR}`] && !pieces[`${dropQ},${dropR}`]) {
                        performAdjacentMove(fromQ, fromR, dropQ, dropR, true); // skipAnimation = true
                        moveExecuted = true;
                        break;
                    }
                }
            }

            // Check for jump move
            if (!moveExecuted) {
                moveExecuted = handleDiscJumpForDrag(fromQ, fromR, dropQ, dropR);
            }
        } else if (piece.type === 'ring') {
            const validMoves = getRingJumpPositions(fromQ, fromR, activePlayer);
            for (const move of validMoves) {
                if (move.q === dropQ && move.r === dropR) {
                    performRingMove(fromQ, fromR, dropQ, dropR, move.capture, true); // skipAnimation = true
                    moveExecuted = true;
                    break;
                }
            }
        }

        // If move was not executed, just redraw (piece goes back)
        if (!moveExecuted) {
            drawGrid();
            return;
        }

        // Check if the game has ended
        if (checkGameEnd()) {
            return;
        }

        // Handle AI/online move sending after animations complete
        GameGraphics.onAllAnimationsComplete(function() {
            if (isOnlineMode && stateBefore && !isMyTurn(activePlayer) && canvas.style.pointerEvents !== 'none') {
                sendOnlineMove(stateBefore, jumpPathForOnline);
                jumpPathForOnline = null;
            }

            if (isAiMode && canvas.style.pointerEvents !== 'none') {
                sendToAI();
            }
        });
    }

    /**
     * Handle disc jump specifically for drag and drop
     * Returns true if jump was executed
     */
    function handleDiscJumpForDrag(sq, sr, q, r) {
        if (!window.jumpHistory) window.jumpHistory = [];
        const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

        for (const [dq, dr] of directions) {
            const jq = sq + dq;
            const jr = sr + dr;
            const landingQ = sq + 2 * dq;
            const landingR = sr + 2 * dr;
            const jumpKey = `${jq},${jr}`;
            const landingKey = `${landingQ},${landingR}`;

            if (q === landingQ && r === landingR && pieces[jumpKey] && tiles[landingKey] && !pieces[landingKey]) {
                // Prevent jumping over same friendly piece
                if (pieces[jumpKey].color === activePlayer && window.jumpHistory.some(h => h.q === jq && h.r === jr)) {
                    continue;
                }

                // Prevent returning to origin tile without any captures (invalid loop)
                if (multiJumping && turnStartPiecePos && 
                    landingQ === turnStartPiecePos.q && landingR === turnStartPiecePos.r && 
                    !hasCapturedDuringSequence()) {
                    continue;
                }

                performDiscJump(sq, sr, jq, jr, landingQ, landingR, jumpKey, landingKey, true); // skipAnimation = true
                return true;
            }
        }
        return false;
    }

    /**
     * Cancel any active drag operation
     */
    function cancelDrag() {
        if (isDragging) {
            isDragging = false;
            draggedPiece = null;
            dragThresholdMet = false;
            canvas.style.cursor = 'default';
            drawGrid();
        }
    }

    // Track if drag was just completed (to suppress click event)
    let dragJustCompleted = false;

    // Add both click and touch event listeners
    canvas.addEventListener('click', function (e) {
        // Skip click handling if drag was just completed
        if (dragJustCompleted) {
            dragJustCompleted = false;
            return;
        }

        // Store state before handling interaction for online mode
        const stateBefore = isOnlineMode ? serializeGameState() : null;
        
        handleCanvasInteraction(e);

        // Check if the game has ended
        if (checkGameEnd()) {
            return;
        }

        // Wait for all animations to complete before sending to AI/server
        GameGraphics.onAllAnimationsComplete(function() {
            // Send move to server if in online mode and it was our turn (turn has now switched)
            if (isOnlineMode && stateBefore && !isMyTurn(activePlayer) && canvas.style.pointerEvents !== 'none') {
                sendOnlineMove(stateBefore, jumpPathForOnline);
                jumpPathForOnline = null; // Clear after sending
            }

            // Serialize the board and send it to the AI if in AI mode
            if (isAiMode && canvas.style.pointerEvents !== 'none') {
                sendToAI();
            }
        });
    });
    canvas.addEventListener('touchend', function (e) {
        // Store state before handling interaction for online mode
        const stateBefore = isOnlineMode ? serializeGameState() : null;
        
        handleCanvasInteraction(e);

        // Check if the game has ended
        if (checkGameEnd()) {
            return;
        }

        // Wait for all animations to complete before sending to AI/server
        GameGraphics.onAllAnimationsComplete(function() {
            // Send move to server if in online mode and it was our turn (turn has now switched)
            if (isOnlineMode && stateBefore && !isMyTurn(activePlayer) && canvas.style.pointerEvents !== 'none') {
                sendOnlineMove(stateBefore, jumpPathForOnline);
                jumpPathForOnline = null; // Clear after sending
            }

            // Serialize the board and send it to the AI if in AI mode
            if (isAiMode && canvas.style.pointerEvents !== 'none') {
                sendToAI();
            }
        });
    });

    // ==================== Drag and Drop Event Listeners ====================
    // Mouse drag events
    canvas.addEventListener('mousedown', handleDragStart);
    canvas.addEventListener('mousemove', handleDragMove);
    canvas.addEventListener('mouseup', handleDragEnd);
    canvas.addEventListener('mouseleave', cancelDrag);

    // Touch drag events
    canvas.addEventListener('touchstart', handleDragStart, { passive: false });
    canvas.addEventListener('touchmove', handleDragMove, { passive: false });
    // Note: touchend is handled above for click behavior, but we also need it for drag
    canvas.addEventListener('touchend', function(e) {
        if (isDragging) {
            handleDragEnd(e);
        }
    }, { passive: false });
    canvas.addEventListener('touchcancel', cancelDrag);

    // Returns valid jump positions for a ring at (q, r)
    function getRingJumpPositions(q, r, player) {
        const directions = [[0, -2], [1, -2], [2, -2], [2, -1], [2, 0], [1, 1], [0, 2], [-1, 2], [-2, 2], [-2, 1], [-2, 0], [-1, -1]];
        const validPositions = [];

        for (const [dq, dr] of directions) {
            const landingQ = q + dq;
            const landingR = r + dr;
            const landingKey = `${landingQ},${landingR}`;

            // Check if landing spot contains a tile
            if (!tiles[landingKey]) continue;

            // Check if landing spot contains a piece
            if (pieces[landingKey]) {
                const piece = pieces[landingKey];
                // Allow capturing enemy pieces only
                if (piece.color !== player) {
                    validPositions.push({ q: landingQ, r: landingR, capture: true });
                }
            } else {
                // Allow landing on empty tiles only
                validPositions.push({ q: landingQ, r: landingR, capture: false });
            }
        }

        return validPositions;
    }



    // Check if the game has ended
    function checkGameEnd() {
        const blackCaptured = captured.black;
        const whiteCaptured = captured.white;

        // Check if a player has captured 6 opponent discs or 3 opponent rings
        if (blackCaptured.disc >= 6) {
            endGame('Black', 'capturing 6 discs');
            return true;
        }
        if (blackCaptured.ring >= 3) {
            endGame('Black', 'capturing 3 rings');
            return true;
        }
        if (!hasActivePieces('white')) {
            endGame('Black', 'eliminating all opponent pieces');
            return true;
        }
        
        if (whiteCaptured.disc >= 6) {
            endGame('White', 'capturing 6 discs');
            return true;
        }
        if (whiteCaptured.ring >= 3) {
            endGame('White', 'capturing 3 rings');
            return true;
        }
        if (!hasActivePieces('black')) {
            endGame('White', 'eliminating all opponent pieces');
            return true;
        }

        // Stalemate: if active player has no legal move, declare Ex Aequo!
        if (!hasAnyLegalMove(activePlayer)) {
            endGame('Ex Aequo', 'stalemate');
            return true;
        }

        // Threefold repetition: same position occurred 3 times
        if (checkThreefoldRepetition()) {
            endGame('Ex Aequo', 'threefold repetition');
            return true;
        }

        return false;
    }

    // Returns true if the player has any legal move available
    function hasAnyLegalMove(player) {
        // 1. Can place a tile?
        if (inventory[player] > 0) {
            // Try all possible positions
            for (let q = -radius; q <= radius; q++) {
                for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
                    const key = `${q},${r}`;
                    if (!tiles[key]) {
                        // Must be adjacent to at least 2 already placed tiles
                        let adjacent = 0;
                        for (const [nq, nr] of getNeighbors(q, r)) {
                            if (tiles[`${nq},${nr}`]) adjacent++;
                        }
                        if (adjacent >= 2) return true;
                    }
                }
            }
        }
        // 2. Can place a disc or ring?
        for (const key in tiles) {
            if (tiles[key] === player && !pieces[key]) {
                if (discInventory[player] > 0) return true;
                if (ringInventory[player] > 0 && captured[player].disc > 0) return true;
            }
        }
        // 3. Can move any piece?
        for (const key in pieces) {
            const piece = pieces[key];
            if (piece.color !== player) continue;
            const [q, r] = key.split(',').map(Number);
            if (piece.type === 'disc') {
                // Adjacent move
                for (const [nq, nr] of getNeighbors(q, r)) {
                    const nkey = `${nq},${nr}`;
                    if (tiles[nkey] && !pieces[nkey]) return true;
                }
                // Jump move
                const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
                for (const [dq, dr] of directions) {
                    const jq = q + dq, jr = r + dr;
                    const landingQ = q + 2 * dq, landingR = r + 2 * dr;
                    const jumpKey = `${jq},${jr}`;
                    const landingKey = `${landingQ},${landingR}`;
                    if (pieces[jumpKey] && tiles[landingKey] && !pieces[landingKey]) {
                        return true;
                    }
                }
            } else if (piece.type === 'ring') {
                // Ring jump positions
                const moves = getRingJumpPositions(q, r, player);
                if (moves.length > 0) return true;
            }
        }
        return false;
    }

    // Check if a player has any active pieces on the board
    function hasActivePieces(player) {
        return Object.values(pieces).some(piece => piece.color === player);
    }

    // End the game and display the winner
    // winner: 'Black', 'White', or 'Ex Aequo'
    // reason: explanation for why the game ended (e.g., 'capturing 6 discs', 'stalemate', 'threefold repetition')
    function endGame(winner, reason = '') {
        playSound('gameEnd');
        const gameOverDiv = document.createElement('div');
        gameOverDiv.id = 'gameOver';
        gameOverDiv.style.position = 'fixed';
        gameOverDiv.style.top = '20px';
        gameOverDiv.style.left = '50%';
        gameOverDiv.style.transform = 'translateX(-50%)';
        gameOverDiv.style.backgroundColor = '#fff';
        gameOverDiv.style.padding = '20px';
        gameOverDiv.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
        gameOverDiv.style.textAlign = 'center';
        gameOverDiv.style.zIndex = '1000';
        gameOverDiv.style.borderRadius = '8px';

        const winnerText = document.createElement('p');
        let messageText;
        if (winner === 'Ex Aequo') {
            messageText = 'Ex Aequo!';
        } else {
            messageText = `${winner} wins!`;
        }
        winnerText.textContent = messageText;
        winnerText.style.fontSize = '24px';
        winnerText.style.fontWeight = 'bold';
        winnerText.style.color = '#000';
        winnerText.style.marginBottom = '8px';
        gameOverDiv.appendChild(winnerText);

        // Add reason text
        if (reason) {
            const reasonText = document.createElement('p');
            if (winner === 'Ex Aequo') {
                reasonText.textContent = `by ${reason}`;
            } else {
                reasonText.textContent = `by ${reason}`;
            }
            reasonText.style.fontSize = '16px';
            reasonText.style.color = '#555';
            reasonText.style.marginTop = '0';
            reasonText.style.marginBottom = '16px';
            gameOverDiv.appendChild(reasonText);
        }

        const resetButton = document.createElement('button');
        resetButton.textContent = 'Reset Game';
        resetButton.style.marginTop = '10px';
        resetButton.style.padding = '10px 20px';
        resetButton.style.fontSize = '16px';
        resetButton.style.cursor = 'pointer';
        resetButton.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            resetGame();
        });
        gameOverDiv.appendChild(resetButton);

        document.body.appendChild(gameOverDiv);
        
        // Disable interactions while game over popup is displayed
        disableInteractions();
    }

    // Generate a hash string representing the current game state
    // Used for threefold repetition detection (like in chess)
    // Includes tiles, pieces, activePlayer, and inventory
    function getPositionHash(gameState) {
        // Sort keys for consistent ordering
        const tilesStr = Object.keys(gameState.tiles).sort().map(k => `${k}:${gameState.tiles[k]}`).join('|');
        const piecesStr = Object.keys(gameState.pieces).sort().map(k => {
            const p = gameState.pieces[k];
            return `${k}:${p.type}:${p.color}`;
        }).join('|');
        // Include inventory in the hash
        const inv = gameState.inventory;
        const inventoryStr = `b:${inv.black.tiles},${inv.black.discs},${inv.black.rings}|w:${inv.white.tiles},${inv.white.discs},${inv.white.rings}`;
        return `${gameState.activePlayer}#${tilesStr}#${piecesStr}#${inventoryStr}`;
    }

    // Check if the current position has occurred 3 times (threefold repetition)
    function checkThreefoldRepetition() {
        if (moveHistory.length < 5) return false; // Need at least 5 moves for repetition
        
        const positionCounts = {};
        
        // Count occurrences of each position hash in the history
        for (let i = 0; i <= currentMoveIndex; i++) {
            const entry = moveHistory[i];
            if (entry && entry.positionHash) {
                positionCounts[entry.positionHash] = (positionCounts[entry.positionHash] || 0) + 1;
                if (positionCounts[entry.positionHash] >= 3) {
                    return true;
                }
            }
        }
        
        return false;
    }

    // Record initial state when game starts or resets
    function recordInitialState() {
        isRestoringState = true; // Prevent any move recording
        
        const currentState = serializeGameState();
        const positionHash = getPositionHash(currentState);
        moveHistory = [{
            gameState: JSON.parse(JSON.stringify(currentState)),
            moveType: 'initial',
            positionHash: positionHash,
            timestamp: Date.now()
        }];
        currentMoveIndex = 0;
        initialGameState = JSON.parse(JSON.stringify(currentState));
        
        isRestoringState = false;
        updateUndoRedoButtons();
    }

    // Record a move in the move history (called after each turn completes)
    // jumpPathParam: optional array of positions for multi-jump path highlighting
    // isOpponentMove: true when this is an online opponent's move (don't truncate history)
    function recordMove(moveType, jumpPathParam = null, isOpponentMove = false) {
        // Don't record moves while restoring from undo/redo
        if (isRestoringState) return;
        
        const currentState = serializeGameState();
        const positionHash = getPositionHash(currentState);
        
        // If we're not at the end of history, truncate future moves
        // BUT: In online mode, if this is an opponent's move, don't truncate - just add to end
        if (currentMoveIndex < moveHistory.length - 1 && !isOpponentMove) {
            moveHistory = moveHistory.slice(0, currentMoveIndex + 1);
        }
        
        // Add the new move (include jumpPath if provided for multi-jump highlighting)
        moveHistory.push({
            gameState: JSON.parse(JSON.stringify(currentState)),
            moveType: moveType,
            jumpPath: jumpPathParam ? JSON.parse(JSON.stringify(jumpPathParam)) : null,
            positionHash: positionHash,
            timestamp: Date.now()
        });
        
        // For opponent moves in online mode when viewing history, don't update currentMoveIndex
        // The player stays at their current position, but can redo to see the new move
        if (!isOpponentMove || isAtEndOfHistory()) {
            currentMoveIndex = moveHistory.length - 1;
        }
        // If it IS an opponent move and we WERE viewing history, keep viewing position
        // but the UI will update to show "X moves back" and redo will be available
        
        // Save to IndexedDB
        saveGameSession();
        
        // Update undo/redo button states
        updateUndoRedoButtons();
    }

    // Record initial state at game start
    recordInitialState();

    // Undo the last move(s)
    function undoMove() {
        // In AI mode: undo 2 moves (back to player's turn), In 2-player mode: undo 1 move
        const movesToUndo = 1;
        
        if (currentMoveIndex - movesToUndo < 0) {
            console.log('Cannot undo: at the beginning of game');
            return;
        }
        
        currentMoveIndex -= movesToUndo;
        const historyEntry = moveHistory[currentMoveIndex];
        
        if (!historyEntry) return;
        
        // Restore the game state from history
        restoreGameState(historyEntry.gameState);
        
        // Save to IndexedDB
        saveGameSession();
        
        // Update button states
        updateUndoRedoButtons();
    }

    // Redo the last undone move(s)
    function redoMove() {
        // In AI mode: redo 2 moves, In 2-player mode: redo 1 move
        const movesToRedo = 1;
        
        if (currentMoveIndex + movesToRedo >= moveHistory.length) {
            console.log('Cannot redo: at the end of move history');
            return;
        }
        
        currentMoveIndex += movesToRedo;
        const historyEntry = moveHistory[currentMoveIndex];
        
        if (!historyEntry) return;
        
        // Restore the game state from history
        restoreGameState(historyEntry.gameState);
        
        // Save to IndexedDB
        saveGameSession();
        
        // Update button states
        updateUndoRedoButtons();
    }

    // Restore game state from a history entry
    function restoreGameState(savedState) {
        isRestoringState = true; // Prevent recording moves during restoration
        
        // Restore tiles
        tiles = JSON.parse(JSON.stringify(savedState.tiles));
        
        // Restore pieces
        pieces = JSON.parse(JSON.stringify(savedState.pieces));
        
        // Restore inventory
        inventory = {
            black: savedState.inventory.black.tiles,
            white: savedState.inventory.white.tiles
        };
        discInventory = {
            black: savedState.inventory.black.discs,
            white: savedState.inventory.white.discs
        };
        ringInventory = {
            black: savedState.inventory.black.rings,
            white: savedState.inventory.white.rings
        };
        
        // Restore captured
        captured = {
            black: {
                disc: savedState.captured.black_discs,
                ring: savedState.captured.black_rings
            },
            white: {
                disc: savedState.captured.white_discs,
                ring: savedState.captured.white_rings
            }
        };
        
        // Restore active player
        activePlayer = savedState.activePlayer;
        
        // Clear any in-progress selections
        selectedPiece = null;
        multiJumping = false;
        multiJumpPos = null;
        turnStartState = null;
        turnStartPiecePos = null;
        
        // Redraw
        updateDynamicLayout();

        //Use currentMoveIndex and moveHistory to call the highlightLastMove function
        if (moveHistory[currentMoveIndex - 1]) {
            const prevState = moveHistory[currentMoveIndex - 1].gameState;
            // Get jumpPath from the current history entry (the move that led to this state)
            const currentEntry = moveHistory[currentMoveIndex];
            const jumpPathFromHistory = currentEntry ? currentEntry.jumpPath : null;
            highlightLastMove(prevState, savedState, jumpPathFromHistory);
        }

        // Update button states
        updateUndoRedoButtons();

        drawGrid();
        
        isRestoringState = false; // Allow move recording again
    }

    // Initialize IndexedDB for game session persistence
    function initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('HexaequoGameDB', 1);
            
            request.onerror = () => {
                console.warn('IndexedDB initialization failed, game will not persist');
                resolve(null);
            };
            
            request.onsuccess = (event) => {
                resolve(event.target.result);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('gameSession')) {
                    db.createObjectStore('gameSession', { keyPath: 'id' });
                }
            };
        });
    }

    // Save the current game session to IndexedDB
    function saveGameSession() {
        if (!window.hexaequoDb) return; // DB not initialized
        
        const transaction = window.hexaequoDb.transaction(['gameSession'], 'readwrite');
        const objectStore = transaction.objectStore('gameSession');
        
        const sessionData = {
            id: 'currentGame',
            moveHistory: moveHistory,
            currentMoveIndex: currentMoveIndex,
            timestamp: Date.now()
        };
        
        const request = objectStore.put(sessionData);
        request.onerror = () => {
            console.warn('Failed to save game session to IndexedDB');
        };
    }

    // Load a saved game session from IndexedDB
    function loadGameSession() {
        return new Promise((resolve) => {
            if (!window.hexaequoDb) {
                resolve(false);
                return;
            }
            
            const transaction = window.hexaequoDb.transaction(['gameSession'], 'readonly');
            const objectStore = transaction.objectStore('gameSession');
            const request = objectStore.get('currentGame');
            
            request.onerror = () => {
                console.warn('Failed to load game session from IndexedDB');
                resolve(false);
            };
            
            request.onsuccess = (event) => {
                const sessionData = event.target.result;
                if (sessionData) {
                    moveHistory = sessionData.moveHistory || [];
                    currentMoveIndex = sessionData.currentMoveIndex || 0;
                    
                    // Restore the last saved state if available
                    if (currentMoveIndex >= 0 && moveHistory[currentMoveIndex]) {
                        restoreGameState(moveHistory[currentMoveIndex].gameState);
                        updateUndoRedoButtons();
                        console.log('Game session restored from IndexedDB');
                        resolve(true);
                        return;
                    }
                }
                resolve(false);
            };
        });
    }

    // Clear the saved game session from IndexedDB
    function clearGameSession() {
        if (!window.hexaequoDb) return;
        
        const transaction = window.hexaequoDb.transaction(['gameSession'], 'readwrite');
        const objectStore = transaction.objectStore('gameSession');
        const request = objectStore.delete('currentGame');
        
        request.onerror = () => {
            console.warn('Failed to clear game session from IndexedDB');
        };
    }

    // Update the state of undo/redo buttons
    function updateUndoRedoButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        const playerIndicator = document.getElementById('playerIndicator');
        
        // Determine how many moves we can undo
        const movesToUndo = 1;
        const canUndo = currentMoveIndex - movesToUndo >= 0;
        const movesToRedo = 1;
        const canRedo = currentMoveIndex + movesToRedo < moveHistory.length;
        

        //if (!undoBtn || !redoBtn) return;
        
        // Update button states
        undoBtn.disabled = !canUndo;
        redoBtn.disabled = !canRedo;
        
        // Update player indicator
        if (playerIndicator) {
            let indicatorText = `Player: ${activePlayer.charAt(0).toUpperCase() + activePlayer.slice(1)}`;
            
            // Add online mode indicator
            if (isOnlineMode) {
                // Check if viewing history (not at end)
                if (!isAtEndOfHistory()) {
                    const movesBack = moveHistory.length - 1 - currentMoveIndex;
                    indicatorText = `Viewing History (${movesBack} move${movesBack > 1 ? 's' : ''} back)`;
                } else if (isMyTurn(activePlayer)) {
                    indicatorText = `Your Turn (${onlinePlayerColor.charAt(0).toUpperCase() + onlinePlayerColor.slice(1)})`;
                } else {
                    indicatorText = `Opponent's Turn`;
                }
            }
            
            playerIndicator.textContent = indicatorText;
            playerIndicator.classList.toggle('player-black', activePlayer === 'black');
            playerIndicator.classList.toggle('player-white', activePlayer === 'white');
        }
    }

    // Reset the game
    function resetGame() {
        // Clear IndexedDB cache
        clearGameSession();
        
        // Clear all game state
        Object.keys(pieces).forEach(key => delete pieces[key]);
        Object.keys(tiles).forEach(key => delete tiles[key]);
        captured = {
            black: { disc: 0, ring: 0 },
            white: { disc: 0, ring: 0 }
        };
        ringInventory = {
            black: 3,
            white: 3
        };
        inventory = {
            black: 7,
            white: 7
        };
        discInventory = {
            black: 5,
            white: 5
        };
        activePlayer = 'black';
        selectedPiece = null;
        multiJumping = false;
        multiJumpPos = null;
        lastMove = null;
        window.jumpHistory = []; // Clear jump history on reset

        // Set initial tiles and pieces
        tiles['0,0'] = 'black';
        tiles['1,0'] = 'black';
        tiles['-1,1'] = 'white';
        tiles['0,1'] = 'white';

        pieces['1,0'] = { type: 'disc', color: 'black' };
        pieces['-1,1'] = { type: 'disc', color: 'white' };

        // Remove game over UI
        const gameOverDiv = document.getElementById('gameOver');
        if (gameOverDiv) {
            gameOverDiv.remove();
        }

        // Re-enable interactions after game reset
        enableInteractions();

        // Record the initial state so undo can go to the start
        recordInitialState();

        // Redraw the grid
        updateDynamicLayout();
        drawGrid();
    }
    window.resetGame = resetGame;

    // Serialize the game state to send to the AI
    function serializeGameState() {
        return {
            tiles: { ...tiles },
            pieces: JSON.parse(JSON.stringify(pieces)),
            inventory: {
                black: {
                    tiles: inventory.black,
                    discs: discInventory.black,
                    rings: ringInventory.black
                },
                white: {
                    tiles: inventory.white,
                    discs: discInventory.white,
                    rings: ringInventory.white
                }
            },
            captured: {
                black_discs: captured.black.disc,
                black_rings: captured.black.ring,
                white_discs: captured.white.disc,
                white_rings: captured.white.ring
            },
            activePlayer: activePlayer
        };
    }

    // Apply the updated game state received from the AI
    // jumpPathParam: optional array of {q, r} positions for multi-jump path highlighting
    // animateMultiJumps: whether to animate multi-jump sequences (true for AI/online moves, false for human moves)
    // manuallyEndedTurn: whether the user manually ended their turn with the checkmark (suppresses single jump animation)
    // skipMoveAnimation: whether to skip move animation (true for drag & drop) but still animate captures
    // isOpponentMove: whether this is an online opponent's move (affects how history is recorded)
    function applyGameState(updatedState, previousState, jumpPathParam = null, animateMultiJumps = false, manuallyEndedTurn = false, skipMoveAnimation = false, isOpponentMove = false) {
        
        // Determine the effective jump path (from param or from AI's lastJumpPath)
        const effectiveJumpPath = jumpPathParam || updatedState.lastJumpPath || null;
        
        // Queue animations if enabled
        if (animationsEnabled && GameGraphics && GameGraphics.queueMoveAnimation) {
            // Disable interactions while animations are playing
            disableInteractions();
            queueAnimationsForStateChange(previousState, updatedState, effectiveJumpPath, animateMultiJumps, manuallyEndedTurn, skipMoveAnimation);
            // Re-enable interactions after all animations complete
            GameGraphics.onAllAnimationsComplete(() => {
                enableInteractions();
            });
        }

        // Play sound for tile placement
        for (const key in updatedState.tiles) {
            if (!previousState.tiles[key] && updatedState.tiles[key]) {
                playSound('tilePlacement');
            }
        }

        // Play sound for piece placement based on inventory change
        for (const player of ['black', 'white']) {
            if (updatedState.inventory[player].discs < previousState.inventory[player].discs ||
                updatedState.inventory[player].rings < previousState.inventory[player].rings) {
                playSound('piecePlacement');
            }
        }

        // Play sound for captures if either player's captured discs or rings increased
        if (
            updatedState.captured.black_discs > previousState.captured.black_discs ||
            updatedState.captured.black_rings > previousState.captured.black_rings ||
            updatedState.captured.white_discs > previousState.captured.white_discs ||
            updatedState.captured.white_rings > previousState.captured.white_rings
        ) {
            playSound('capture');
        }

        // Play sound for moves (if a piece changes position)
        for (const key in previousState.pieces) {
            if (previousState.pieces[key] && !updatedState.pieces[key]) {
                playSound('move');
            }
        }

        // Update the game state
        tiles = updatedState.tiles;
        pieces = updatedState.pieces;
        inventory = {
            black: updatedState.inventory.black.tiles,
            white: updatedState.inventory.white.tiles
        };
        discInventory = {
            black: updatedState.inventory.black.discs,
            white: updatedState.inventory.white.discs
        };
        ringInventory = {
            black: updatedState.inventory.black.rings,
            white: updatedState.inventory.white.rings
        };
        captured = {
            black: {
                disc: updatedState.captured.black_discs,
                ring: updatedState.captured.black_rings
            },
            white: {
                disc: updatedState.captured.white_discs,
                ring: updatedState.captured.white_rings
            }
        };

        // Update active player
        activePlayer = updatedState.activePlayer;

        // Determine the jump path to use for recording
        const pathToRecord = jumpPathParam || updatedState.lastJumpPath || null;

        //recordMove player's move only when the game state changed
        if (JSON.stringify(previousState) !== JSON.stringify(updatedState)) {
            recordMove('move', pathToRecord, isOpponentMove);
        }

        updateDynamicLayout(); // Update targets based on new state

        //Use currentMoveIndex and moveHistory to call the highlightLastMove function
        if (moveHistory[currentMoveIndex - 1]) {
            const prevState = moveHistory[currentMoveIndex - 1].gameState;
            // Use the same path for highlighting
            highlightLastMove(prevState, updatedState, pathToRecord);
        }

        // Redraw the grid
        drawGrid();

        checkGameEnd(); // Check if the game has ended after applying AI's move
    }

    /**
     * Queue animations based on state changes
     * Detects tile placements, piece placements, moves, and captures
     * Queue animations for a state change (movement, capture, placement)
     * @param {Object} previousState - The game state before the change
     * @param {Object} updatedState - The game state after the change
     * @param {Array} jumpPathParam - Optional array of {q, r} positions for multi-jump path
     * @param {boolean} animateMultiJumps - Whether to animate multi-jump sequences (true for AI/online, false for human)
     * @param {boolean} manuallyEndedTurn - Whether the user manually ended their turn (suppresses animation)
     * @param {boolean} skipMoveAnimation - Whether to skip move animation (drag & drop) but still animate captures
     */
    function queueAnimationsForStateChange(previousState, updatedState, jumpPathParam, animateMultiJumps = false, manuallyEndedTurn = false, skipMoveAnimation = false) {
        const opponent = updatedState.activePlayer;
        const player = opponent === 'black' ? 'white' : 'black';

        // 1. Detect and animate tile placements
        for (const key in updatedState.tiles) {
            if (!previousState.tiles[key] && updatedState.tiles[key]) {
                const [q, r] = key.split(',').map(Number);
                GameGraphics.queueTilePlacementAnimation(q, r, updatedState.tiles[key]);
            }
        }

        // 2. Detect all captures (pieces that existed before but not after, or were replaced by opponent)
        const capturedPieces = [];
        for (const key in previousState.pieces) {
            const prevPiece = previousState.pieces[key];
            const currPiece = updatedState.pieces[key];
            
            if (prevPiece && prevPiece.color === opponent) {
                // Piece was removed entirely (disc jump capture)
                if (!currPiece) {
                    const [q, r] = key.split(',').map(Number);
                    capturedPieces.push({ q, r, piece: prevPiece });
                }
                // Piece was replaced by player's piece (ring capture - lands on captured position)
                else if (currPiece && currPiece.color === player) {
                    const [q, r] = key.split(',').map(Number);
                    capturedPieces.push({ q, r, piece: prevPiece });
                }
            }
        }

        // 3. Detect piece movements and placements
        // Find piece that moved (same type and color, different position)
        let movedFrom = null;
        let movedTo = null;
        let movedPiece = null;

        // Find pieces that were removed (moved from)
        for (const key in previousState.pieces) {
            if (previousState.pieces[key] && previousState.pieces[key].color === player) {
                if (!updatedState.pieces[key]) {
                    movedFrom = key;
                    movedPiece = previousState.pieces[key];
                }
            }
        }

        // Find pieces that were added (moved to or placed)
        for (const key in updatedState.pieces) {
            if (updatedState.pieces[key] && updatedState.pieces[key].color === player) {
                if (!previousState.pieces[key] || previousState.pieces[key].color !== player) {
                    movedTo = key;
                    if (!movedPiece) {
                        movedPiece = updatedState.pieces[key];
                    }
                }
            }
        }

        // Determine if it's a move or a placement
        if (movedFrom && movedTo && movedPiece) {
            // It's a move
            const [fromQ, fromR] = movedFrom.split(',').map(Number);
            const [toQ, toR] = movedTo.split(',').map(Number);

            // Check if we have a jump path for multi-jump animation
            let path = null;
            if (jumpPathParam && jumpPathParam.length > 1) {
                if (typeof jumpPathParam[0] === 'string') {
                    // AI format: ["q,r", "q,r", ...]
                    path = jumpPathParam.map(pos => {
                        const [q, r] = pos.split(',').map(Number);
                        return { q, r };
                    });
                } else {
                    // Game format: [{q, r}, {q, r}, ...]
                    path = jumpPathParam;
                }
            }

            // Handle drag & drop: skip move animation but still animate captures
            if (skipMoveAnimation) {
                // Only animate captures, not the move itself
                if (capturedPieces.length > 0) {
                    capturedPieces.forEach(cap => {
                        GameGraphics.queueCaptureAnimation(cap.q, cap.r, cap.piece);
                    });
                }
            } else if (path && path.length > 1 && animateMultiJumps) {
                // Multi-jump: animate each jump with its capture sequentially (only for AI/online moves)
                GameGraphics.queueJumpSequenceWithCaptures(path, movedPiece, capturedPieces);
            } else if (path && path.length > 2 && !animateMultiJumps) {
                // Multi-jump (3+ positions) from human player: no animation
                // (the piece just appears at the destination instantly)
            } else if (path && path.length === 2 && !animateMultiJumps && manuallyEndedTurn) {
                // Single jump but user manually ended turn (clicked checkmark): no animation
                // This means user could have continued jumping but chose to stop
            } else {
                // Single move (adjacent move or single jump or ring move)
                // Queue move animation followed by capture animations sequentially
                if (capturedPieces.length > 0) {
                    GameGraphics.queueSingleMoveWithCapture(fromQ, fromR, toQ, toR, movedPiece, capturedPieces);
                } else {
                    GameGraphics.queueMoveAnimation(fromQ, fromR, toQ, toR, movedPiece);
                }
            }
        } else if (movedTo && movedPiece && !movedFrom) {
            // It's a piece placement (disc or ring from inventory)
            const [q, r] = movedTo.split(',').map(Number);
            GameGraphics.queuePiecePlacementAnimation(q, r, movedPiece);
        } else if (!movedFrom && !movedTo && jumpPathParam && jumpPathParam.length > 1 && animateMultiJumps) {
            // Loop case: disc returned to starting position after captures
            // The piece didn't "move" between states (same key in both), but we have the path
            let path = null;
            if (typeof jumpPathParam[0] === 'string') {
                // AI format: ["q,r", "q,r", ...]
                path = jumpPathParam.map(pos => {
                    const [q, r] = pos.split(',').map(Number);
                    return { q, r };
                });
            } else {
                // Game format: [{q, r}, {q, r}, ...]
                path = jumpPathParam;
            }
            // Get the piece from the start/end position (they're the same in a loop)
            const startKey = `${path[0].q},${path[0].r}`;
            const loopPiece = updatedState.pieces[startKey];
            if (loopPiece && path.length > 1) {
                GameGraphics.queueJumpSequenceWithCaptures(path, loopPiece, capturedPieces);
            }
        }
    }

    // Function to calculate the last move made and store it in lastMove
    // jumpPathParam: optional array of {q, r} positions for multi-jump path
    function highlightLastMove(previousState, updatedState, jumpPathParam = null) {
        lastMove = null;
        const activePlayer = updatedState.activePlayer;
        const opponent = activePlayer === 'black' ? 'white' : 'black';

        // Detect tile placement
        const newTiles = Object.keys(updatedState.tiles).filter(
            key => !previousState.tiles[key]
        );
        if (newTiles.length === 1) {
            const [q, r] = newTiles[0].split(',').map(Number);
            lastMove = { type: 'tile', q, r };
            return;
        }

        // Detect piece placement
        const newPieces = Object.keys(updatedState.pieces).filter(
            key => !previousState.pieces[key]
        );
        if (newPieces.length === 1) {
            const [q, r] = newPieces[0].split(',').map(Number);
            const prevInv = previousState.inventory[opponent];
            const currInv = updatedState.inventory[opponent];
            const discPlaced = currInv.discs < prevInv.discs;
            const ringPlaced = currInv.rings < prevInv.rings;

            if (discPlaced || ringPlaced) {
                lastMove = { type: 'piece', q, r };
                return;
            }
        }

        // Detect piece movement (check for pieces that moved from opponent player)
        const movedFrom = Object.keys(previousState.pieces).find(
            key => !updatedState.pieces[key] && previousState.pieces[key].color === opponent
        );
        const movedTo = Object.keys(updatedState.pieces).find(
            key => (!previousState.pieces[key] || previousState.pieces[key].color === activePlayer) && updatedState.pieces[key].color === opponent
        );
        const capturedPieces = Object.keys(previousState.pieces).filter(
            key => (!updatedState.pieces[key] || updatedState.pieces[key].color === opponent) && previousState.pieces[key].color === activePlayer
        );

        // Convert jump path to consistent format
        let path = null;
        if (jumpPathParam && jumpPathParam.length > 1) {
            if (typeof jumpPathParam[0] === 'string') {
                // AI format: ["q,r", "q,r", ...]
                path = jumpPathParam.map(pos => {
                    const [q, r] = pos.split(',').map(Number);
                    return { q, r };
                });
            } else {
                // Game format: [{q, r}, {q, r}, ...]
                path = jumpPathParam;
            }
        }

        // Build captured positions array
        const capturedKeys = capturedPieces.map(key => {
            const [q, r] = key.split(',').map(Number);
            return { q, r };
        });

        if (movedFrom && movedTo) {
            const [fromQ, fromR] = movedFrom.split(',').map(Number);
            const [toQ, toR] = movedTo.split(',').map(Number);
            lastMove = { type: 'move', from: { q: fromQ, r: fromR }, to: { q: toQ, r: toR }, captured: capturedKeys, path: path };
        } else if (path && path.length > 1) {
            // Edge case: disc returned to starting position (loop with captures)
            // The piece didn't "move" between states, but we have the path
            const from = path[0];
            const to = path[path.length - 1];
            lastMove = { type: 'move', from: from, to: to, captured: capturedKeys, path: path };
        }
    }

    // Step 1: Add sound effects for game actions
    const sounds = {
        tilePlacement: new Audio('sounds/tile_placement.mp3'),
        piecePlacement: new Audio('sounds/piece_placement.mp3'),
        capture: new Audio('sounds/capture.mp3'),
        move: new Audio('sounds/move.mp3'),
        gameEnd: new Audio('sounds/game_end.mp3'),
        buttonClick: new Audio('sounds/button_click.mp3')
    };

    function playSound(action) {
        if (isSoundEnabled && sounds[action]) {
            sounds[action].play();
        }
    }

    // Play button click sound when any button is clicked
    document.querySelectorAll('button').forEach(button => {
        button.addEventListener('click', () => {
            playSound('buttonClick');
        });
    });

    // Initialize the AI Web Worker
    let aiWorker = null;
    let pendingGameState = null; // Store the game state before AI processes it

    if (typeof (Worker) !== "undefined") {
        aiWorker = new Worker('ai-worker.js');

        // Handle messages from the worker
        aiWorker.addEventListener('message', function (e) {
            const { type, updatedState, error } = e.data;

            if (type === 'moveComputed') {
                if (pendingGameState) {
                    applyGameState(updatedState, pendingGameState, null, true); // Apply the updated state from AI with multi-jump animation
                    pendingGameState = null; // Clear the pending state
                }
                hideLoader(); // Hide loader
            } else if (type === 'error') {
                console.error('AI Worker Error:', error);
                hideLoader();
            }
        });
    }

    // Send the game state to the AI and handle the response
    async function sendToAI() {
        const gameState = serializeGameState();
        pendingGameState = gameState; // Save for later comparison
        disableInteractions(); // Disable interactions while AI is thinking
        showLoader(); // Show loader

        console.log('Sending game state to AI:', gameState); // Log the move sent to the AI

        if (aiWorker) {
            // Use Web Worker
            aiWorker.postMessage({
                type: 'computeMove',
                gameState: gameState,
                difficulty: aiDifficulty
            });
        } else {
            // Fallback to direct computation if Web Workers not supported
            try {
                const updatedState = processGameState(gameState, aiDifficulty);
                applyGameState(updatedState, gameState, null, true); // Animate multi-jumps for AI
                pendingGameState = null;
            } catch (error) {
                console.error('Error communicating with AI:', error);
            } finally {
                hideLoader();
            }
        }
    }

    // Function to disable event listeners
    function disableInteractions() {
        canvas.style.pointerEvents = 'none';
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        if (undoBtn) undoBtn.disabled = true;
        if (redoBtn) redoBtn.disabled = true;
    }

    // Function to enable event listeners
    function enableInteractions() {
        canvas.style.pointerEvents = 'auto';
        // Re-enable undo/redo buttons based on history state
        updateUndoRedoButtons();
    }

    // Add a loader element to the DOM
    const loader = document.createElement('div');
    loader.id = 'aiLoader';
    loader.style.position = 'absolute';
    loader.style.padding = '12px 24px';
    loader.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    loader.style.color = 'white';
    loader.style.borderRadius = '8px';
    loader.style.textAlign = 'center';
    loader.style.display = 'none';
    loader.style.zIndex = '1000';
    loader.style.fontSize = '16px';
    loader.style.fontWeight = 'bold';
    loader.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.5)';
    loader.innerText = 'AI is thinking...';
    document.body.appendChild(loader);

    // Show the loader when waiting for AI
    function showLoader() {
        // Position loader at top center of canvas
        const canvasRect = canvas.getBoundingClientRect();
        loader.style.top = (canvasRect.top + 20) + 'px';
        loader.style.left = (canvasRect.left + canvasRect.width / 2) + 'px';
        loader.style.transform = 'translateX(-50%)';
        loader.style.display = 'block';
    }

    // Hide the loader after AI move
    function hideLoader() {
        loader.style.display = 'none';
    }

    // ===== Online Multiplayer Functions =====
    
    // Send a move to the online server
    function sendOnlineMove(previousState, jumpPathParam = null) {
        const currentState = serializeGameState();
        
        if (window.Multiplayer && window.Multiplayer.isOnlineMode) {
            window.Multiplayer.sendMove(currentState, previousState, jumpPathParam)
                .then(() => {
                    console.log('Move sent to server');
                })
                .catch((err) => {
                    console.error('Failed to send move:', err);
                    // Optionally show error to user
                });
        }
    }

    // Apply a move received from the online opponent
    function applyOnlineMove(gameState, previousState, jumpPath = null) {
        if (previousState) {
            // Pass isOpponentMove = true so history is handled correctly when viewing past moves
            applyGameState(gameState, previousState, jumpPath, true, false, false, true);
        } else {
            // Initial state sync - just apply without sounds
            tiles = gameState.tiles;
            pieces = gameState.pieces;
            inventory = {
                black: gameState.inventory.black.tiles,
                white: gameState.inventory.white.tiles
            };
            discInventory = {
                black: gameState.inventory.black.discs,
                white: gameState.inventory.white.discs
            };
            ringInventory = {
                black: gameState.inventory.black.rings,
                white: gameState.inventory.white.rings
            };
            captured = {
                black: {
                    disc: gameState.captured.black_discs,
                    ring: gameState.captured.black_rings
                },
                white: {
                    disc: gameState.captured.white_discs,
                    ring: gameState.captured.white_rings
                }
            };
            activePlayer = gameState.activePlayer;
            updateDynamicLayout();
            drawGrid();
        }
        
        // Check if game ended after opponent's move
        checkGameEnd();
    }
    window.applyOnlineMove = applyOnlineMove;

    // Start an online game
    function startOnlineGame(gameState) {
        // Apply the initial game state
        if (gameState) {
            applyOnlineMove(gameState, null);
        }
        
        console.log('Online game started');
    }
    window.startOnlineGame = startOnlineGame;

    // Initialize IndexedDB and load saved game session
    (async () => {
        window.hexaequoDb = await initIndexedDB();
        const sessionLoaded = await loadGameSession();
        if (!sessionLoaded) {
            // No saved session, record the initial game state only once
            if (moveHistory.length === 0) {
                moveHistory.push({
                    gameState: serializeGameState(),
                    moveType: 'initial',
                    timestamp: Date.now()
                });
                currentMoveIndex = 0;
            }
        }
        // Initialize button states
        updateUndoRedoButtons();
    })();

};
