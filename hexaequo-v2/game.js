// game.js
// Entry point for Hexaequo V2 game logic

let endTurnBtnBounds = null; // Used to track the End Turn button position for click detection
let placePieceBtnBounds = null; // Used to track contextual place disc/ring buttons
let placePieceBtnTile = null; // {q, r} for which tile the buttons are shown

// Global variables for game mode
let isAiMode = false;
let isSoundEnabled = true;
let aiDifficulty = 2; // 1: Easy, 2: Medium, 3: Hard

// Toggle between AI and 2-player modes
function toggleGameMode(aiMode) {
    isAiMode = aiMode;
    if (isAiMode) {
        console.log('Switched to AI Mode');
    } else {
        console.log('Switched to 2 Player Mode');
    }
}

function setSoundEnabled(enabled) {
    isSoundEnabled = enabled;
    console.log('Sound enabled:', isSoundEnabled);
}

function setAiDifficulty(level) {
    aiDifficulty = level;
    console.log('AI Difficulty set to:', aiDifficulty);
}

// Expose to global scope
window.toggleGameMode = toggleGameMode;
window.isAiMode = isAiMode;
window.setSoundEnabled = setSoundEnabled;
window.setAiDifficulty = setAiDifficulty;

window.onload = function () {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const inventoryCanvas = document.getElementById('inventoryCanvas');
    const inventoryCtx = inventoryCanvas.getContext('2d');
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
    let inventoryItemSize = 20;
    let inventoryItemGap = 42;

    // Move history for undo/redo functionality
    let moveHistory = []; // Array of {gameState, moveType}
    let currentMoveIndex = 0; // Index of the current position in move history
    let isRestoringState = false; // Flag to prevent recording moves during undo/redo restoration
    let initialGameState = null; // Store the initial state for undo to game start

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

    // Hex grid parameters
    const radius = 8; // grid radius in hexes
    let hexSize = 25; // pixel size from center to corner (will be adjusted)
    let centerX = canvas.width / 2;
    let centerY = canvas.height / 2;

    // Target values for animation
    let targetHexSize = hexSize;
    let targetCenterX = centerX;
    let targetCenterY = centerY;

    // Initial tile content: key = 'q,r', value = 'black' or 'white'
    let tiles = {
        '0,0': 'black',
        '1,0': 'black',
        '-1,1': 'white',
        '0,1': 'white',
    };

    // Update hex size and center dynamically based on placed tiles
    function updateDynamicLayout() {
        const tileKeys = Object.keys(tiles);
        if (tileKeys.length === 0) {
            // Default if no tiles (shouldn't happen in normal game)
            targetCenterX = canvas.width / 2;
            targetCenterY = canvas.height / 2;
            targetHexSize = Math.min(canvas.width, canvas.height) / 10;
            return;
        }

        // Calculate bounding box of all tiles in axial coordinates
        let minQ = Infinity, maxQ = -Infinity;
        let minR = Infinity, maxR = -Infinity;
        let minS = Infinity, maxS = -Infinity; // s = -q-r

        // We need to convert to pixel coordinates to get the true bounding box
        // because hex grid is not a simple rectangle in q,r
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        // Use a temporary size of 1 to calculate relative positions
        const tempSize = 1;

        // Set of all hexes to include in the bounds (tiles + their neighbors)
        const hexesToInclude = new Set(tileKeys);

        tileKeys.forEach(key => {
            const [q, r] = key.split(',').map(Number);
            const neighbors = getNeighbors(q, r);
            neighbors.forEach(([nq, nr]) => {
                hexesToInclude.add(`${nq},${nr}`);
            });
        });

        hexesToInclude.forEach(key => {
            const [q, r] = key.split(',').map(Number);

            // Calculate center of this hex
            const x = tempSize * Math.sqrt(3) * (q + r / 2);
            const y = tempSize * 3 / 2 * r;

            // Add hex dimensions to bounds (width is sqrt(3)*size, height is 2*size)
            // We use the corners to be precise
            // Top/Bottom points are at y +/- size
            // Side points are at x +/- sqrt(3)/2 * size

            const hWidth = Math.sqrt(3) * tempSize;
            const hHeight = 2 * tempSize;

            minX = Math.min(minX, x - hWidth / 2);
            maxX = Math.max(maxX, x + hWidth / 2);
            minY = Math.min(minY, y - hHeight / 2);
            maxY = Math.max(maxY, y + hHeight / 2);
        });

        // Add some padding (in relative units)
        // We want to fit this bounding box into the canvas
        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;

        // Available space in canvas (with padding)
        const padding = 40; // pixels
        const availWidth = canvas.width - padding * 2;
        const availHeight = canvas.height - padding * 2;

        // Calculate scale
        // If content width is 0 (1 tile), avoid division by zero
        const scaleX = contentWidth > 0 ? availWidth / contentWidth : availWidth / (Math.sqrt(3));
        const scaleY = contentHeight > 0 ? availHeight / contentHeight : availHeight / 2;

        // Choose the smaller scale to fit both dimensions
        let newHexSize = Math.min(scaleX, scaleY);

        // Clamp hex size to reasonable limits
        const maxHexSize = Math.min(canvas.width, canvas.height) / 4; // Don't let one tile take up whole screen
        const minHexSize = 15; // Don't let it get too small
        newHexSize = Math.min(Math.max(newHexSize, minHexSize), maxHexSize);

        targetHexSize = newHexSize;

        // Calculate center offset
        // The center of the content in pixel coords (relative to 0,0) is:
        const contentCenterX = (minX + maxX) / 2 * targetHexSize; // Scale up
        const contentCenterY = (minY + maxY) / 2 * targetHexSize;

        // We want this content center to be at canvas center
        // contentCenterX/Y are the pixel coordinates of the center of the bounding box relative to the grid origin (0,0)
        targetCenterX = (canvas.width / 2) - contentCenterX;
        targetCenterY = (canvas.height / 2) - contentCenterY;
    }

    // Animation loop for smooth transitions
    function animateView() {
        // Interpolation factor (0.1 for smooth, fast movement)
        const ease = 0.1;
        const epsilon = 0.1;

        let changed = false;

        if (Math.abs(targetHexSize - hexSize) > epsilon) {
            hexSize += (targetHexSize - hexSize) * ease;
            changed = true;
        } else {
            hexSize = targetHexSize;
        }

        if (Math.abs(targetCenterX - centerX) > epsilon) {
            centerX += (targetCenterX - centerX) * ease;
            changed = true;
        } else {
            centerX = targetCenterX;
        }

        if (Math.abs(targetCenterY - centerY) > epsilon) {
            centerY += (targetCenterY - centerY) * ease;
            changed = true;
        } else {
            centerY = targetCenterY;
        }

        if (changed) {
            drawGrid();
        }

        requestAnimationFrame(animateView);
    }
    // Start animation loop
    requestAnimationFrame(animateView);

    // Responsive canvas sizing
    function resizeCanvas() {
        const isMobile = window.innerWidth <= 768;
        const isSmallMobile = window.innerWidth <= 480;

        // Set canvas to full window size
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        if (isSmallMobile) {
            inventoryItemSize = 10; // Much smaller for very small screens
            inventoryItemGap = 18;
        } else if (isMobile) {
            inventoryItemSize = 12; // Smaller for mobile screens
            inventoryItemGap = 22;
        } else {
            inventoryItemSize = 20; // Default size for larger screens
            inventoryItemGap = 42;
        }

        inventoryCanvas.width = canvas.width;
        inventoryCanvas.height = canvas.height;

        updateDynamicLayout(); // Recalculate targets on resize
        drawGrid();
    }

    // Pieces: key = 'q,r', value = {type: 'disc'|'ring', color: 'black'|'white'}
    let pieces = {
        '1,0': { type: 'disc', color: 'black' },
        '-1,1': { type: 'disc', color: 'white' },
    };

    // Color palettes
    const schemes = {
        modern: {
            bg: '#121212',
            black: '#333333', // Dark gray tile
            white: '#cccccc', // Light gray tile
            border: '#666666', // Gray grid lines
        },
        classic: {
            bg: '#d0c09bff',
            black: '#7a5230', // dark brown
            white: '#f5e2b6', // light brown
            border: '#7a5230',
        }
    };

    // Function to set the game theme
    function setGameTheme(theme) {
        if (theme === 'dark') {
            colorScheme = 'modern';
        } else {
            colorScheme = 'classic';
        }
        drawGrid();
        // Also redraw inventory
        drawInventory();
    }
    window.setGameTheme = setGameTheme;

    // Draw a single hex at (cx, cy)
    function drawHex(cx, cy, size, color = '#fff') {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 3 * i + Math.PI / 6;
            const x = cx + size * Math.cos(angle);
            const y = cy + size * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Draw a tile (hexagonal, fills the hex) at (cx, cy)
    function drawTile(cx, cy, color, scheme) {
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 3 * i + Math.PI / 6;
            const x = cx + hexSize * Math.cos(angle);
            const y = cy + hexSize * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = schemes[scheme][color];
        ctx.shadowColor = '#000a';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = scheme === 'classic' ? '#b08b4f' : '#888';
        ctx.stroke();
        ctx.restore();
    }

    // Draw a disc piece on a tile
    function drawPiece(cx, cy, piece, scheme) {
        if (!piece) return;
        if (piece.type === 'disc') {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, hexSize * 0.45, 0, 2 * Math.PI);
            ctx.fillStyle = piece.color === 'black' ? (scheme === 'classic' ? '#222' : '#000') : (scheme === 'classic' ? '#fafafa' : '#fff');
            ctx.shadowColor = '#000a';
            ctx.shadowBlur = 4;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = piece.color === 'black' ? '#888' : '#bbb';
            ctx.stroke();
            ctx.restore();
        } else if (piece.type === 'ring') {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, hexSize * 0.45, 0, 2 * Math.PI);
            ctx.lineWidth = 7;
            ctx.strokeStyle = piece.color === 'black'
                ? (scheme === 'classic' ? '#222' : '#000')
                : (scheme === 'classic' ? '#fafafa' : '#fff');
            ctx.shadowColor = '#000a';
            ctx.shadowBlur = 4;
            ctx.stroke();

            // Add a gray inner line for contrast (inner edge of ring)
            ctx.beginPath();
            ctx.arc(cx, cy, hexSize * 0.32, 0, 2 * Math.PI);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#bbb';
            ctx.shadowBlur = 0;
            ctx.stroke();

            // Add a gray outer line for contrast (outer edge of ring)
            ctx.beginPath();
            ctx.arc(cx, cy, hexSize * 0.6, 0, 2 * Math.PI);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#bbb';
            ctx.shadowBlur = 0;
            ctx.stroke();

            ctx.restore();
        }
    }

    // Convert axial coordinates (q, r) to pixel coordinates
    function hexToPixel(q, r, size) {
        const x = size * Math.sqrt(3) * (q + r / 2);
        const y = size * 3 / 2 * r;
        return [centerX + x, centerY + y];
    }

    // Convert pixel coordinates to axial (q, r)
    function pixelToHex(x, y) {
        const px = x - centerX;
        const py = y - centerY;
        const q = (Math.sqrt(3) / 3 * px - 1 / 3 * py) / hexSize;
        const r = (2 / 3 * py) / hexSize;
        // Round to nearest hex
        let rq = Math.round(q);
        let rr = Math.round(r);
        let rs = Math.round(-q - r);
        const q_diff = Math.abs(rq - q);
        const r_diff = Math.abs(rr - r);
        const s_diff = Math.abs(rs - (-q - r));
        if (q_diff > r_diff && q_diff > s_diff) rq = -rr - rs;
        else if (r_diff > s_diff) rr = -rq - rs;
        return [rq, rr];
    }

    function drawInventory() {
        inventoryCtx.clearRect(0, 0, inventoryCanvas.width, inventoryCanvas.height);

        const isMobile = window.innerWidth <= 768;
        const isSmallMobile = window.innerWidth <= 480;

        // Smaller inventory box on mobile
        const boxWidth = isSmallMobile ? 80 : (isMobile ? 100 : 130);
        const padding = isSmallMobile ? 5 : (isMobile ? 8 : 10);

        // Black player inventory box (top-left)
        const blackBoxX = padding;
        const blackBoxY = padding;

        // White player inventory box (top-right)
        const whiteBoxX = canvas.width - boxWidth - padding;
        const whiteBoxY = padding;

        // Draw black player's inventory items
        drawInventoryItems(blackBoxX, blackBoxY, 'black');

        // Draw white player's inventory items
        drawInventoryItems(whiteBoxX, whiteBoxY, 'white');
    }

    function drawInventoryItems(boxX, boxY, player) {
        const isMobile = window.innerWidth <= 768;
        const isSmallMobile = window.innerWidth <= 480;

        const itemSize = inventoryItemSize;
        const gap = inventoryItemGap;
        const columns = isSmallMobile ? 4 : (isMobile ? 4 : 3); // More columns on mobile to save space
        const startX = boxX + (isSmallMobile ? 8 : (isMobile ? 12 : 20));
        const startY = boxY + (isSmallMobile ? 8 : (isMobile ? 12 : 20));

        const items = [];

        // Add tiles, discs, rings (player's own pieces)
        for (let i = 0; i < inventory[player]; i++) {
            items.push({ type: 'tile', color: player });
        }
        for (let i = 0; i < discInventory[player]; i++) {
            items.push({ type: 'disc', color: player });
        }
        for (let i = 0; i < ringInventory[player]; i++) {
            items.push({ type: 'ring', color: player });
        }

        // Count player's pieces (before captured pieces)
        const playerPiecesCount = items.length;

        // Add captured discs and rings (opponent's pieces)
        for (let i = 0; i < captured[player].disc; i++) {
            items.push({ type: 'disc', color: player === 'black' ? 'white' : 'black' });
        }
        for (let i = 0; i < captured[player].ring; i++) {
            items.push({ type: 'ring', color: player === 'black' ? 'white' : 'black' });
        }

        // Draw player's pieces first
        for (let index = 0; index < playerPiecesCount; index++) {
            const item = items[index];
            const col = index % columns;
            const row = Math.floor(index / columns);
            const x = startX + col * gap;
            const y = startY + row * gap;

            drawSingleInventoryItem(inventoryCtx, x, y, item, itemSize);
        }

        // Calculate the last row of player's pieces (0-indexed)
        const lastPlayerRow = playerPiecesCount > 0 ? Math.floor((playerPiecesCount - 1) / columns) : -1;
        const capturedPiecesCount = items.length - playerPiecesCount;

        // Draw separator line between player's pieces and captured pieces
        if (playerPiecesCount > 0 && capturedPiecesCount > 0) {
            // Calculate the Y position for the separator line
            // It should be between the last row of player pieces and the first row of captured pieces
            const separatorY = startY + (lastPlayerRow + 1) * gap - gap / 2;
            const boxWidth = isSmallMobile ? 80 : (isMobile ? 100 : 130);
            const lineStartX = boxX + (isSmallMobile ? 4 : (isMobile ? 6 : 10));
            const lineEndX = boxX + boxWidth - (isSmallMobile ? 4 : (isMobile ? 6 : 10));

            inventoryCtx.save();
            inventoryCtx.strokeStyle = '#999';
            inventoryCtx.lineWidth = 1;
            inventoryCtx.setLineDash([3, 3]);
            inventoryCtx.beginPath();
            inventoryCtx.moveTo(lineStartX, separatorY);
            inventoryCtx.lineTo(lineEndX, separatorY);
            inventoryCtx.stroke();
            inventoryCtx.setLineDash([]);
            inventoryCtx.restore();
        }

        // Draw captured pieces starting on a new row
        // Calculate the starting row for captured pieces (after player's pieces + separator)
        // Always start on a new row, even if the last player row is incomplete
        const capturedStartRow = lastPlayerRow + 1;

        for (let i = 0; i < capturedPiecesCount; i++) {
            const index = playerPiecesCount + i;
            const item = items[index];
            const col = i % columns;
            const row = capturedStartRow + Math.floor(i / columns);
            const x = startX + col * gap;
            const y = startY + row * gap;

            drawSingleInventoryItem(inventoryCtx, x, y, item, itemSize);
        }
    }

    function drawSingleInventoryItem(ctx, x, y, item, size) {
        ctx.save();

        if (item.type === 'tile') {
            // Draw a hexagonal tile
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = Math.PI / 3 * i + Math.PI / 6;
                const hx = x + size * Math.cos(angle);
                const hy = y + size * Math.sin(angle);
                if (i === 0) ctx.moveTo(hx, hy);
                else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
            // Use scheme colors for tiles
            ctx.fillStyle = schemes[colorScheme][item.color];
            ctx.shadowColor = '#000a';
            ctx.shadowBlur = 2;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = colorScheme === 'classic' ? '#b08b4f' : '#888';
            ctx.stroke();
        } else if (item.type === 'disc') {
            // Draw a disc with a border and subtle shadow for inventory
            ctx.beginPath();
            ctx.arc(x, y, size * 0.45, 0, 2 * Math.PI);
            // Use scheme-aware colors for pieces
            ctx.fillStyle = item.color === 'black'
                ? (colorScheme === 'classic' ? '#222' : '#000')
                : (colorScheme === 'classic' ? '#fafafa' : '#fff');
            ctx.shadowColor = '#000a';
            ctx.shadowBlur = 2;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = item.color === 'black' ? '#888' : '#bbb';
            ctx.stroke();
        } else if (item.type === 'ring') {
            // Draw a ring for inventory matching the board appearance
            // Main ring (thick outer circle)
            ctx.beginPath();
            ctx.arc(x, y, size * 0.45, 0, 2 * Math.PI);
            ctx.lineWidth = 7;
            ctx.strokeStyle = item.color === 'black'
                ? (colorScheme === 'classic' ? '#222' : '#000')
                : (colorScheme === 'classic' ? '#fafafa' : '#fff');
            ctx.shadowColor = '#000a';
            ctx.shadowBlur = 2;
            ctx.stroke();

            // Inner gray line for contrast (inner edge of ring)
            ctx.beginPath();
            ctx.arc(x, y, size * 0.32, 0, 2 * Math.PI);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#bbb';
            ctx.shadowBlur = 0;
            ctx.stroke();

            // Outer gray line for contrast (outer edge of ring)
            ctx.beginPath();
            ctx.arc(x, y, size * 0.6, 0, 2 * Math.PI);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#bbb';
            ctx.shadowBlur = 0;
            ctx.stroke();
        }
        ctx.restore();
    }

    // Draw all hexes in a hexagonal grid of given radius
    function drawGrid() {
        // updateDynamicLayout() is now called only when state changes, not every frame
        ctx.fillStyle = schemes[colorScheme].bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Draw all hexes and contents (with selection highlight if any)
        for (let q = -radius; q <= radius; q++) {
            for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
                const [x, y] = hexToPixel(q, r, hexSize);
                if (showGrid) {
                    drawHex(x, y, hexSize, schemes[colorScheme].border);
                }
                // Draw tile if present
                const key = `${q},${r}`;
                if (tiles[key]) {
                    drawTile(x, y, tiles[key], colorScheme);
                    // Draw piece if present
                    if (pieces[key]) {
                        drawPiece(x, y, pieces[key], colorScheme);
                        // Draw selection highlight if selected
                        if (selectedPiece && selectedPiece.q === q && selectedPiece.r === r) {
                            ctx.save();
                            ctx.beginPath();
                            ctx.arc(x, y, hexSize * 0.45, 0, 2 * Math.PI);
                            ctx.strokeStyle = 'orange';
                            ctx.lineWidth = 4;
                            ctx.setLineDash([4, 4]);
                            ctx.stroke();
                            ctx.setLineDash([]);
                            ctx.restore();
                        }
                        // Draw contextual End Turn button if in multi-jump and this is the jumping piece
                        if (multiJumping && multiJumpPos && multiJumpPos.q === q && multiJumpPos.r === r) {
                            if (isGameStateChanged()) {
                                drawEndTurnButton(x, y, q, r);
                            }
                        }
                    }

                }
                if (showCoords) {
                    ctx.save();
                    ctx.font = '11px monospace';
                    ctx.fillStyle = '#ff0';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(`${q},${r}`, x, y);
                    ctx.restore();
                }
            }
        }

        // Draw contextual place disc/ring buttons on top of everything
        if (placePieceBtnTile && placePieceBtnBounds) {
            const [px, py] = hexToPixel(placePieceBtnTile.q, placePieceBtnTile.r, hexSize);
            drawPlacePieceButtons(px, py, placePieceBtnBounds);
        }

        // Draw last move highlight
        if (lastMove) {
            if (lastMove.type === 'tile') {
                const [x, y] = hexToPixel(lastMove.q, lastMove.r, hexSize);
                ctx.save();
                ctx.beginPath();
                const highlightSize = hexSize * 0.75;
                for (let i = 0; i < 6; i++) {
                    const angle = Math.PI / 3 * i + Math.PI / 6;
                    const hx = x + highlightSize * Math.cos(angle);
                    const hy = y + highlightSize * Math.sin(angle);
                    if (i === 0) ctx.moveTo(hx, hy);
                    else ctx.lineTo(hx, hy);
                }
                ctx.closePath();
                ctx.strokeStyle = 'gray';
                ctx.lineWidth = 4;
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            } else if (lastMove.type === 'piece') {
                const [x, y] = hexToPixel(lastMove.q, lastMove.r, hexSize);
                ctx.save();
                ctx.beginPath();
                ctx.arc(x, y, hexSize * 0.45, 0, 2 * Math.PI);
                ctx.strokeStyle = 'gray';
                ctx.lineWidth = 4;
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            } else if (lastMove.type === 'move') {
                const [fromX, fromY] = hexToPixel(lastMove.from.q, lastMove.from.r, hexSize);
                const [toX, toY] = hexToPixel(lastMove.to.q, lastMove.to.r, hexSize);

                // Highlight the move
                ctx.save();
                ctx.strokeStyle = 'gray';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(fromX, fromY);
                ctx.lineTo(toX, toY);
                ctx.stroke();

                // Highlight the destination hex
                ctx.beginPath();
                ctx.arc(toX, toY, hexSize * 0.45, 0, 2 * Math.PI);
                ctx.strokeStyle = 'gray';
                ctx.lineWidth = 4;
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();

                // Highlight captured pieces
                if (lastMove.captured) {
                    lastMove.captured.forEach(pos => {
                        const [x, y] = hexToPixel(pos.q, pos.r, hexSize);
                        ctx.save();
                        ctx.beginPath();
                        ctx.arc(x, y, hexSize * 0.45, 0, 2 * Math.PI);
                        ctx.strokeStyle = 'gray';
                        ctx.lineWidth = 4;
                        ctx.setLineDash([4, 4]);
                        ctx.stroke();
                        ctx.setLineDash([]);
                        ctx.restore();
                    });
                }
            }
        }

        function drawPlacePieceButtons(x, y, btns) {
            // Position buttons inside the tile, closer to center
            const offset = hexSize * 0.5;

            const discX = x - offset;
            const discY = y;

            const ringX = x + offset;
            const ringY = y;

            // Draw Disc symbol
            drawSingleInventoryItem(ctx, discX, discY, { type: 'disc', color: activePlayer }, inventoryItemSize * 2);

            // Draw Ring symbol
            drawSingleInventoryItem(ctx, ringX, ringY, { type: 'ring', color: activePlayer }, inventoryItemSize * 2);

            // Update btns for click detection
            const hitRadius = inventoryItemSize * 2;

            btns.discBtn = { x: discX, y: discY, r: hitRadius };
            btns.ringBtn = { x: ringX, y: ringY, r: hitRadius };
        }

        function drawEndTurnButton(x, y, q, r) {
            // Draw a green checkmark on the tile to indicate end turn option
            const checkSize = inventoryItemSize * 2;

            ctx.save();
            ctx.strokeStyle = '#00ff00'; // Green color
            ctx.lineWidth = 6;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Draw checkmark (✓)
            // Start point (bottom-left of check)
            const startX = x - checkSize * 0.4;
            const startY = y;

            // Middle point (bottom of check)
            const midX = x - checkSize * 0.1;
            const midY = y + checkSize * 0.4;

            // End point (top-right of check)
            const endX = x + checkSize * 0.5;
            const endY = y - checkSize * 0.5;

            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(midX, midY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
            ctx.restore();

            // Store the checkmark position for click detection
            endTurnBtnBounds = { q, r, x, y, checkSize };
        }

        const btnGrid = document.getElementById('toggleGridBtn');
        btnGrid.addEventListener('click', function () {
            showGrid = !showGrid;
            drawGrid();
        });

        // Update player status
        if (playerStatus) {
            playerStatus.textContent = `Active player: ${activePlayer.charAt(0).toUpperCase() + activePlayer.slice(1)}`;
            playerStatus.style.color = colorScheme === 'modern'
                ? (activePlayer === 'black' ? schemes.modern.black : schemes.modern.white)
                : (activePlayer === 'black' ? schemes.classic.black : schemes.classic.white);
            playerStatus.style.textShadow = colorScheme === 'modern' ? '0 0 4px #fff, 0 0 2px #000' : '0 0 2px #b08b4f';
        }
        drawInventory();
    }

    // Helper to check if game state changed during multi-jump
    function isGameStateChanged() {
        if (!turnStartState || !turnStartPiecePos || !multiJumpPos) return true; // Should not happen if multiJumping

        const currentCaptured = captured[activePlayer];
        const startCaptured = turnStartState.captured;

        // Note: turnStartState.captured structure from serializeGameState is { black_discs: ..., ... }
        const startDiscs = activePlayer === 'black' ? startCaptured.black_discs : startCaptured.white_discs;
        const startRings = activePlayer === 'black' ? startCaptured.black_rings : startCaptured.white_rings;
        const currentDiscs = currentCaptured.disc;
        const currentRings = currentCaptured.ring;

        const capturesChanged = (currentDiscs !== startDiscs) || (currentRings !== startRings);
        const positionChanged = (multiJumpPos.q !== turnStartPiecePos.q) || (multiJumpPos.r !== turnStartPiecePos.r);

        return capturesChanged || positionChanged;
    }

    // Initialize canvas size and set up resize listener
    // This must be called AFTER all variables (schemes, tiles, pieces) are defined
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

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

    // Unified event handler for both click and touch
    function handleCanvasInteraction(e) {
        e.preventDefault(); // Prevent default touch behavior

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
        //recordMove('turn');
        activePlayer = activePlayer === 'black' ? 'white' : 'black';
        updatedState = serializeGameState();
        applyGameState(updatedState, gameState);
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

    function performRingMove(sq, sr, q, r, isCapture) {
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
        applyGameState(updatedState, gameState);
    }

    function performAdjacentMove(sq, sr, q, r) {
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
        applyGameState(updatedState, gameState);
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

    function performDiscJump(sq, sr, jq, jr, landingQ, landingR, jumpKey, landingKey) {
        gameState = serializeGameState();

        if (!multiJumping) {
            turnStartState = JSON.parse(JSON.stringify(gameState));
            turnStartPiecePos = { q: sq, r: sr };
        }

        if (pieces[jumpKey].type === 'disc' && pieces[jumpKey].color !== activePlayer) {
            captured[activePlayer].disc++;
            delete pieces[jumpKey];
        } else if (pieces[jumpKey].type === 'ring' && pieces[jumpKey].color !== activePlayer) {
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
            drawGrid();
        } else {
            selectedPiece = null;
            multiJumping = false;
            multiJumpPos = null;
            endTurnBtnBounds = null;
            window.jumpHistory = [];
            //recordMove('jump');
            activePlayer = activePlayer === 'black' ? 'white' : 'black';
            updatedState = serializeGameState();
            applyGameState(updatedState, gameState);
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
                // At least one jump available
                return true;
            }
        }
        return false;
    }

    // Add both click and touch event listeners
    canvas.addEventListener('click', function (e) {
        handleCanvasInteraction(e);

        // Check if the game has ended
        if (checkGameEnd()) {
            return;
        }

        // Serialize the board and send it to the AI if in AI mode
        if (isAiMode && canvas.style.pointerEvents !== 'none') {
            sendToAI();
        }
    });
    canvas.addEventListener('touchend', function (e) {
        handleCanvasInteraction(e);

        // Check if the game has ended
        if (checkGameEnd()) {
            return;
        }

        // Serialize the board and send it to the AI if in AI mode
        if (isAiMode && canvas.style.pointerEvents !== 'none') {
            sendToAI();
        }
    });

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
        if (blackCaptured.disc >= 6 || blackCaptured.ring >= 3 || !hasActivePieces('white')) {
            endGame('Black');
            return true;
        }
        if (whiteCaptured.disc >= 6 || whiteCaptured.ring >= 3 || !hasActivePieces('black')) {
            endGame('White');
            return true;
        }

        // Stalemate: if active player has no legal move, declare Ex Aequo!
        if (!hasAnyLegalMove(activePlayer)) {
            endGame('Ex Aequo!');
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
    function endGame(winner) {
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
        winnerText.textContent = winner === 'Ex Aequo!' ? 'Ex Aequo!' : `${winner} wins the game!`;
        winnerText.style.fontSize = '20px';
        winnerText.style.fontWeight = 'bold';
        winnerText.style.color = '#000'; // Set text color to black for contrast
        gameOverDiv.appendChild(winnerText);

        const resetButton = document.createElement('button');
        resetButton.textContent = 'Reset Game';
        resetButton.style.marginTop = '10px';
        resetButton.style.padding = '10px 20px';
        resetButton.style.fontSize = '16px';
        resetButton.style.cursor = 'pointer';
        resetButton.addEventListener('click', resetGame);
        gameOverDiv.appendChild(resetButton);

        document.body.appendChild(gameOverDiv);
        
        // Disable interactions while game over popup is displayed
        disableInteractions();
    }

    // Record initial state when game starts or resets
    function recordInitialState() {
        isRestoringState = true; // Prevent any move recording
        
        const currentState = serializeGameState();
        moveHistory = [{
            gameState: JSON.parse(JSON.stringify(currentState)),
            moveType: 'initial',
            timestamp: Date.now()
        }];
        currentMoveIndex = 0;
        initialGameState = JSON.parse(JSON.stringify(currentState));
        
        isRestoringState = false;
        updateUndoRedoButtons();
    }

    // Record a move in the move history (called after each turn completes)
    function recordMove(moveType) {
        // Don't record moves while restoring from undo/redo
        if (isRestoringState) return;
        
        const currentState = serializeGameState();
        
        // If we're not at the end of history, truncate future moves
        if (currentMoveIndex < moveHistory.length - 1) {
            moveHistory = moveHistory.slice(0, currentMoveIndex + 1);
        }
        
        // Add the new move
        moveHistory.push({
            gameState: JSON.parse(JSON.stringify(currentState)),
            moveType: moveType,
            timestamp: Date.now()
        });
        currentMoveIndex++;
        
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
            highlightLastMove(prevState, savedState);
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
            playerIndicator.textContent = `Player: ${activePlayer.charAt(0).toUpperCase() + activePlayer.slice(1)}`;
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
            document.body.removeChild(gameOverDiv);
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
    function applyGameState(updatedState, previousState) {

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

        //recordMove player's move only when the game state changed
        if (JSON.stringify(previousState) !== JSON.stringify(updatedState)) {
            recordMove();
        }

        updateDynamicLayout(); // Update targets based on new state

        //Use currentMoveIndex and moveHistory to call the highlightLastMove function
        if (moveHistory[currentMoveIndex - 1]) {
            const prevState = moveHistory[currentMoveIndex - 1].gameState;
            highlightLastMove(prevState, updatedState);
        }

        // Redraw the grid
        drawGrid();

        enableInteractions();

        checkGameEnd(); // Check if the game has ended after applying AI's move
    }

    // Function to calculate the last move made and store it in lastMove
    function highlightLastMove(previousState, updatedState) {
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

        // Detect piece placement (must also be a change in the inventory)
        const newPieces = Object.keys(updatedState.pieces).filter(
            key => !previousState.pieces[key]
        );
        if (newPieces.length === 1) {
            const [q, r] = newPieces[0].split(',').map(Number);

            // Check if inventory for the active player decreased (disc or ring placed)
            const prevInv = previousState.inventory[opponent];
            const currInv = updatedState.inventory[opponent];
            const discPlaced = currInv.discs < prevInv.discs;
            const ringPlaced = currInv.rings < prevInv.rings;

            if (discPlaced || ringPlaced) {
                lastMove = { type: 'piece', q, r };
                return;
            }
        }

        // Detect piece movement with captures
        const movedFrom = Object.keys(previousState.pieces).find(
            key => !updatedState.pieces[key] && previousState.pieces[key].color === opponent
        );
        const movedTo = Object.keys(updatedState.pieces).find(
            key => !previousState.pieces[key] && updatedState.pieces[key].color === opponent
        );
        const captured = Object.keys(previousState.pieces).filter(
            key => !updatedState.pieces[key] && previousState.pieces[key].color === activePlayer
        );

        if (movedFrom && movedTo) {
            const [fromQ, fromR] = movedFrom.split(',').map(Number);
            const [toQ, toR] = movedTo.split(',').map(Number);
            const capturedKeys = captured.map(key => {
                const [q, r] = key.split(',').map(Number);
                return { q, r };
            });
            lastMove = { type: 'move', from: { q: fromQ, r: fromR }, to: { q: toQ, r: toR }, captured: capturedKeys };
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
                    applyGameState(updatedState, pendingGameState); // Apply the updated state from AI
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
                applyGameState(updatedState, gameState);
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
