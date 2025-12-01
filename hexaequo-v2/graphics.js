// graphics.js
// Graphics module for Hexaequo V2 - handles all rendering/drawing functions

const GameGraphics = (function () {
    // Private variables
    let canvas = null;
    let ctx = null;
    let inventoryCanvas = null;
    let inventoryCtx = null;
    let getGameState = null;

    // Grid parameters
    let hexSize = 25;
    let centerX = 0;
    let centerY = 0;
    let targetHexSize = 25;
    let targetCenterX = 0;
    let targetCenterY = 0;
    let inventoryItemSize = 20;
    let inventoryItemGap = 42;

    // Animation system
    let animationsEnabled = true;
    let activeAnimations = []; // Queue of active animations
    let animationCallbacks = []; // Callbacks to execute after all animations complete
    let pendingFinalDestinations = new Set(); // Track final destinations during multi-segment animations
    let pendingCaptures = new Map(); // Track captured pieces to render as ghost until their capture animation starts
    let ghostPieceOpacity = 1.0; // Opacity for ghost pieces (pieces waiting to be captured) - can be adjusted
    let pendingJumpPosition = null; // Track the jumping piece's current position during capture animations { q, r, piece }
    let jumpingPieceOpacity = 1.0; // Opacity for the jumping piece during capture animations - can be adjusted independently
    // Each animation: { type, fromQ, fromR, toQ, toR, startTime, duration, piece, opacity, scale, onComplete }

    // Color palettes
    const schemes = {
        modern: {
            bg: '#121212',
            black: '#333333',
            white: '#cccccc',
            border: '#666666',
        },
        classic: {
            bg: '#d0c09bff',
            black: '#7a5230',
            white: '#f5e2b6',
            border: '#7a5230',
        }
    };

    // Grid radius in hexes
    const radius = 8;

    // ==================== Initialization ====================

    /**
     * Initialize the graphics module
     * @param {HTMLCanvasElement} gameCanvas - The main game canvas
     * @param {HTMLCanvasElement} invCanvas - The inventory canvas
     * @param {Function} getStateFn - Callback that returns the current game state
     */
    function init(gameCanvas, invCanvas, getStateFn) {
        canvas = gameCanvas;
        ctx = canvas.getContext('2d');
        inventoryCanvas = invCanvas;
        inventoryCtx = inventoryCanvas.getContext('2d');
        getGameState = getStateFn;

        // Initialize center positions
        centerX = canvas.width / 2;
        centerY = canvas.height / 2;
        targetCenterX = centerX;
        targetCenterY = centerY;

        // Start animation loop
        startAnimationLoop();
    }

    // ==================== Coordinate Utilities ====================

    /**
     * Convert axial coordinates (q, r) to pixel coordinates
     */
    function hexToPixel(q, r, size) {
        const x = size * Math.sqrt(3) * (q + r / 2);
        const y = size * 3 / 2 * r;
        return [centerX + x, centerY + y];
    }

    /**
     * Convert pixel coordinates to axial (q, r)
     */
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

    // ==================== Layout Functions ====================

    /**
     * Get neighbors of a hex coordinate
     */
    function getNeighbors(q, r) {
        return [
            [q + 1, r], [q - 1, r], [q, r + 1], [q, r - 1], [q + 1, r - 1], [q - 1, r + 1]
        ];
    }

    /**
     * Update hex size and center dynamically based on placed tiles
     */
    function updateDynamicLayout() {
        const state = getGameState();
        const tiles = state.tiles;
        const tileKeys = Object.keys(tiles);

        if (tileKeys.length === 0) {
            targetCenterX = canvas.width / 2;
            targetCenterY = canvas.height / 2;
            targetHexSize = Math.min(canvas.width, canvas.height) / 10;
            return;
        }

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        const tempSize = 1;
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
            const x = tempSize * Math.sqrt(3) * (q + r / 2);
            const y = tempSize * 3 / 2 * r;
            const hWidth = Math.sqrt(3) * tempSize;
            const hHeight = 2 * tempSize;

            minX = Math.min(minX, x - hWidth / 2);
            maxX = Math.max(maxX, x + hWidth / 2);
            minY = Math.min(minY, y - hHeight / 2);
            maxY = Math.max(maxY, y + hHeight / 2);
        });

        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;

        const padding = 40;
        const availWidth = canvas.width - padding * 2;
        const availHeight = canvas.height - padding * 2;

        const scaleX = contentWidth > 0 ? availWidth / contentWidth : availWidth / (Math.sqrt(3));
        const scaleY = contentHeight > 0 ? availHeight / contentHeight : availHeight / 2;

        let newHexSize = Math.min(scaleX, scaleY);

        const maxHexSize = Math.min(canvas.width, canvas.height) / 4;
        const minHexSize = 15;
        newHexSize = Math.min(Math.max(newHexSize, minHexSize), maxHexSize);

        targetHexSize = newHexSize;

        const contentCenterX = (minX + maxX) / 2 * targetHexSize;
        const contentCenterY = (minY + maxY) / 2 * targetHexSize;

        targetCenterX = (canvas.width / 2) - contentCenterX;
        targetCenterY = (canvas.height / 2) - contentCenterY;
    }

    /**
     * Animation loop for smooth transitions
     */
    function animateView() {
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

        // Process active animations
        if (activeAnimations.length > 0) {
            changed = true;
            processAnimations();
        }

        if (changed) {
            drawGrid();
        }

        requestAnimationFrame(animateView);
    }

    /**
     * Easing function - ease out cubic for smooth deceleration
     */
    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    /**
     * Linear interpolation
     */
    function lerp(start, end, t) {
        return start + (end - start) * t;
    }

    /**
     * Get animation duration from game.js
     */
    function getAnimationDuration() {
        return window.getAnimationDuration ? window.getAnimationDuration() : 200;
    }

    /**
     * Set animations enabled state
     */
    function setAnimationsEnabled(enabled) {
        animationsEnabled = enabled;
    }

    /**
     * Check if animations are currently playing
     */
    function isAnimating() {
        return activeAnimations.length > 0;
    }

    /**
     * Process all active animations
     */
    function processAnimations() {
        const now = performance.now();
        const completedAnimations = [];

        for (let i = activeAnimations.length - 1; i >= 0; i--) {
            const anim = activeAnimations[i];
            const elapsed = now - anim.startTime;
            const progress = Math.min(elapsed / anim.duration, 1);
            anim.progress = easeOutCubic(progress);

            if (progress >= 1) {
                completedAnimations.push(anim);
                activeAnimations.splice(i, 1);
            }
        }

        // Execute callbacks for completed animations
        completedAnimations.forEach(anim => {
            if (anim.onComplete) {
                anim.onComplete();
            }
        });

        // If all animations are done, execute queued callbacks
        if (activeAnimations.length === 0 && animationCallbacks.length > 0) {
            const callbacks = [...animationCallbacks];
            animationCallbacks = [];
            callbacks.forEach(cb => cb());
        }
    }

    /**
     * Queue a piece movement animation
     * @param {number} fromQ - Starting Q coordinate
     * @param {number} fromR - Starting R coordinate
     * @param {number} toQ - Ending Q coordinate
     * @param {number} toR - Ending R coordinate
     * @param {Object} piece - The piece being moved {type, color}
     * @param {Function} onComplete - Callback when animation completes
     */
    function queueMoveAnimation(fromQ, fromR, toQ, toR, piece, onComplete) {
        if (!animationsEnabled) {
            if (onComplete) onComplete();
            return;
        }

        activeAnimations.push({
            type: 'move',
            fromQ, fromR,
            toQ, toR,
            piece: { ...piece },
            startTime: performance.now(),
            duration: getAnimationDuration(),
            progress: 0,
            onComplete
        });
    }

    /**
     * Queue a multi-jump animation sequence (each jump animated one at a time)
     * @param {Array} path - Array of {q, r} positions
     * @param {Object} piece - The piece being moved
     * @param {Function} onComplete - Callback when all jumps complete
     */
    function queueJumpSequence(path, piece, onComplete) {
        if (!animationsEnabled || !path || path.length < 2) {
            if (onComplete) onComplete();
            return;
        }

        // Chain animations: each jump starts after the previous one completes
        let currentIndex = 0;

        function animateNextJump() {
            if (currentIndex >= path.length - 1) {
                if (onComplete) onComplete();
                return;
            }

            const from = path[currentIndex];
            const to = path[currentIndex + 1];
            currentIndex++;

            queueMoveAnimation(from.q, from.r, to.q, to.r, piece, animateNextJump);
        }

        animateNextJump();
    }

    /**
     * Queue a multi-jump animation sequence with captures at each segment
     * Each jump is followed by its capture animation (if any), then the next jump
     * @param {Array} path - Array of {q, r} positions for the jump path
     * @param {Object} piece - The piece being moved
     * @param {Array} capturedPieces - Array of {q, r, piece} for all captured pieces
     * @param {Function} onComplete - Callback when all animations complete
     */
    function queueJumpSequenceWithCaptures(path, piece, capturedPieces, onComplete) {
        if (!animationsEnabled || !path || path.length < 2) {
            if (onComplete) onComplete();
            return;
        }

        // Track the final destination throughout the animation sequence
        const finalDestination = path[path.length - 1];
        pendingFinalDestinations.add(`${finalDestination.q},${finalDestination.r}`);

        // Register all captured pieces as pending (to render as ghost pieces)
        capturedPieces.forEach(cap => {
            pendingCaptures.set(`${cap.q},${cap.r}`, cap.piece);
        });

        // For each segment of the path, find if there's a capture in between
        // In hex grid, the jumped piece is at the midpoint between from and to
        let currentIndex = 0;

        function animateNextSegment() {
            if (currentIndex >= path.length - 1) {
                // Clear the final destination tracking when animation completes
                pendingFinalDestinations.delete(`${finalDestination.q},${finalDestination.r}`);
                if (onComplete) onComplete();
                return;
            }

            const from = path[currentIndex];
            const to = path[currentIndex + 1];
            currentIndex++;

            // Calculate the midpoint (the jumped-over hex)
            const midQ = (from.q + to.q) / 2;
            const midR = (from.r + to.r) / 2;

            // Find if there's a captured piece at this midpoint
            const captureAtMid = capturedPieces.find(cap => 
                cap.q === midQ && cap.r === midR
            );

            // Queue the movement animation
            queueMoveAnimation(from.q, from.r, to.q, to.r, piece, () => {
                // After movement completes, queue capture animation if there was a capture
                if (captureAtMid) {
                    // Set pending jump position to show the jumping piece during capture animation
                    pendingJumpPosition = { q: to.q, r: to.r, piece: { ...piece } };
                    // Remove from pending captures as we're now animating it
                    pendingCaptures.delete(`${captureAtMid.q},${captureAtMid.r}`);
                    queueCaptureAnimation(captureAtMid.q, captureAtMid.r, captureAtMid.piece, () => {
                        // Clear pending jump position when starting next move
                        pendingJumpPosition = null;
                        // After capture animation, continue to next segment
                        animateNextSegment();
                    });
                } else {
                    // No capture, continue to next segment
                    animateNextSegment();
                }
            });
        }

        animateNextSegment();
    }

    /**
     * Queue a single move animation followed by capture animation (sequential)
     * Used for single jumps with captures to ensure move completes before capture fades
     * @param {number} fromQ - Starting Q coordinate
     * @param {number} fromR - Starting R coordinate  
     * @param {number} toQ - Ending Q coordinate
     * @param {number} toR - Ending R coordinate
     * @param {Object} piece - The piece being moved
     * @param {Array} capturedPieces - Array of {q, r, piece} for captured pieces
     * @param {Function} onComplete - Callback when all animations complete
     */
    function queueSingleMoveWithCapture(fromQ, fromR, toQ, toR, piece, capturedPieces, onComplete) {
        if (!animationsEnabled) {
            if (onComplete) onComplete();
            return;
        }

        // Track the final destination throughout the animation sequence
        pendingFinalDestinations.add(`${toQ},${toR}`);

        // Register all captured pieces as pending (to render as ghost pieces)
        if (capturedPieces) {
            capturedPieces.forEach(cap => {
                pendingCaptures.set(`${cap.q},${cap.r}`, cap.piece);
            });
        }

        // Queue the movement animation first
        queueMoveAnimation(fromQ, fromR, toQ, toR, piece, () => {
            // After movement completes, queue capture animations sequentially
            if (capturedPieces && capturedPieces.length > 0) {
                // Set pending jump position to show the jumping piece during capture animations
                pendingJumpPosition = { q: toQ, r: toR, piece: { ...piece } };
                let captureIndex = 0;
                
                function animateNextCapture() {
                    if (captureIndex >= capturedPieces.length) {
                        // All captures done, clear tracking and call completion
                        pendingJumpPosition = null;
                        pendingFinalDestinations.delete(`${toQ},${toR}`);
                        if (onComplete) onComplete();
                        return;
                    }
                    
                    const cap = capturedPieces[captureIndex];
                    captureIndex++;
                    // Remove from pending captures as we're now animating it
                    pendingCaptures.delete(`${cap.q},${cap.r}`);
                    queueCaptureAnimation(cap.q, cap.r, cap.piece, animateNextCapture);
                }
                
                animateNextCapture();
            } else {
                pendingFinalDestinations.delete(`${toQ},${toR}`);
                if (onComplete) onComplete();
            }
        });
    }

    /**
     * Queue a capture (fade-out) animation
     * @param {number} q - Q coordinate of captured piece
     * @param {number} r - R coordinate of captured piece
     * @param {Object} piece - The piece being captured
     * @param {Function} onComplete - Callback when animation completes
     */
    function queueCaptureAnimation(q, r, piece, onComplete) {
        if (!animationsEnabled) {
            if (onComplete) onComplete();
            return;
        }

        activeAnimations.push({
            type: 'capture',
            q, r,
            piece: { ...piece },
            startTime: performance.now(),
            duration: getAnimationDuration(),
            progress: 0,
            onComplete
        });
    }

    /**
     * Queue a tile placement (scale-in) animation
     * @param {number} q - Q coordinate
     * @param {number} r - R coordinate
     * @param {string} color - Tile color
     * @param {Function} onComplete - Callback when animation completes
     */
    function queueTilePlacementAnimation(q, r, color, onComplete) {
        if (!animationsEnabled) {
            if (onComplete) onComplete();
            return;
        }

        activeAnimations.push({
            type: 'tilePlacement',
            q, r,
            color,
            startTime: performance.now(),
            duration: getAnimationDuration(),
            progress: 0,
            onComplete
        });
    }

    /**
     * Queue a piece placement (pop-in) animation
     * @param {number} q - Q coordinate
     * @param {number} r - R coordinate
     * @param {Object} piece - The piece being placed
     * @param {Function} onComplete - Callback when animation completes
     */
    function queuePiecePlacementAnimation(q, r, piece, onComplete) {
        if (!animationsEnabled) {
            if (onComplete) onComplete();
            return;
        }

        activeAnimations.push({
            type: 'piecePlacement',
            q, r,
            piece: { ...piece },
            startTime: performance.now(),
            duration: getAnimationDuration(),
            progress: 0,
            onComplete
        });
    }

    /**
     * Add a callback to execute when all animations complete
     */
    function onAllAnimationsComplete(callback) {
        if (activeAnimations.length === 0) {
            callback();
        } else {
            animationCallbacks.push(callback);
        }
    }

    /**
     * Clear all active animations
     */
    function clearAnimations() {
        activeAnimations = [];
        animationCallbacks = [];
        pendingCaptures.clear();
        pendingFinalDestinations.clear();
        pendingJumpPosition = null;
    }

    /**
     * Start the animation loop
     */
    function startAnimationLoop() {
        requestAnimationFrame(animateView);
    }

    /**
     * Responsive canvas sizing
     */
    function resizeCanvas() {
        const isMobile = window.innerWidth <= 768;
        const isSmallMobile = window.innerWidth <= 480;

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        if (isSmallMobile) {
            inventoryItemSize = 10;
            inventoryItemGap = 18;
        } else if (isMobile) {
            inventoryItemSize = 12;
            inventoryItemGap = 22;
        } else {
            inventoryItemSize = 20;
            inventoryItemGap = 42;
        }

        inventoryCanvas.width = canvas.width;
        inventoryCanvas.height = canvas.height;

        updateDynamicLayout();
        drawGrid();
    }

    // ==================== Drawing Functions ====================

    /**
     * Draw a single hex outline at (cx, cy)
     */
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

    /**
     * Draw a filled tile (hexagonal) at (cx, cy)
     */
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

    /**
     * Draw a piece (disc or ring) on a tile
     */
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

            ctx.beginPath();
            ctx.arc(cx, cy, hexSize * 0.32, 0, 2 * Math.PI);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#bbb';
            ctx.shadowBlur = 0;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(cx, cy, hexSize * 0.6, 0, 2 * Math.PI);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#bbb';
            ctx.shadowBlur = 0;
            ctx.stroke();

            ctx.restore();
        }
    }

    /**
     * Draw a single inventory item
     */
    function drawSingleInventoryItem(targetCtx, x, y, item, size) {
        const state = getGameState();
        const colorScheme = state.colorScheme;

        targetCtx.save();

        if (item.type === 'tile') {
            targetCtx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = Math.PI / 3 * i + Math.PI / 6;
                const hx = x + size * Math.cos(angle);
                const hy = y + size * Math.sin(angle);
                if (i === 0) targetCtx.moveTo(hx, hy);
                else targetCtx.lineTo(hx, hy);
            }
            targetCtx.closePath();
            targetCtx.fillStyle = schemes[colorScheme][item.color];
            targetCtx.shadowColor = '#000a';
            targetCtx.shadowBlur = 2;
            targetCtx.fill();
            targetCtx.lineWidth = 1.5;
            targetCtx.strokeStyle = colorScheme === 'classic' ? '#b08b4f' : '#888';
            targetCtx.stroke();
        } else if (item.type === 'disc') {
            targetCtx.beginPath();
            targetCtx.arc(x, y, size * 0.45, 0, 2 * Math.PI);
            targetCtx.fillStyle = item.color === 'black'
                ? (colorScheme === 'classic' ? '#222' : '#000')
                : (colorScheme === 'classic' ? '#fafafa' : '#fff');
            targetCtx.shadowColor = '#000a';
            targetCtx.shadowBlur = 2;
            targetCtx.fill();
            targetCtx.lineWidth = 1.5;
            targetCtx.strokeStyle = item.color === 'black' ? '#888' : '#bbb';
            targetCtx.stroke();
        } else if (item.type === 'ring') {
            targetCtx.beginPath();
            targetCtx.arc(x, y, size * 0.45, 0, 2 * Math.PI);
            targetCtx.lineWidth = 7;
            targetCtx.strokeStyle = item.color === 'black'
                ? (colorScheme === 'classic' ? '#222' : '#000')
                : (colorScheme === 'classic' ? '#fafafa' : '#fff');
            targetCtx.shadowColor = '#000a';
            targetCtx.shadowBlur = 2;
            targetCtx.stroke();

            targetCtx.beginPath();
            targetCtx.arc(x, y, size * 0.32, 0, 2 * Math.PI);
            targetCtx.lineWidth = 1.5;
            targetCtx.strokeStyle = '#bbb';
            targetCtx.shadowBlur = 0;
            targetCtx.stroke();

            targetCtx.beginPath();
            targetCtx.arc(x, y, size * 0.6, 0, 2 * Math.PI);
            targetCtx.lineWidth = 1.5;
            targetCtx.strokeStyle = '#bbb';
            targetCtx.shadowBlur = 0;
            targetCtx.stroke();
        }
        targetCtx.restore();
    }

    /**
     * Draw inventory items for a player
     */
    function drawInventoryItems(boxX, boxY, player) {
        const state = getGameState();
        const isMobile = window.innerWidth <= 768;
        const isSmallMobile = window.innerWidth <= 480;

        const itemSize = inventoryItemSize;
        const gap = inventoryItemGap;
        const columns = isSmallMobile ? 4 : (isMobile ? 4 : 3);
        const startX = boxX + (isSmallMobile ? 8 : (isMobile ? 12 : 20));
        const startY = boxY + (isSmallMobile ? 8 : (isMobile ? 12 : 20));

        const items = [];

        // Add tiles, discs, rings (player's own pieces)
        for (let i = 0; i < state.inventory[player]; i++) {
            items.push({ type: 'tile', color: player });
        }
        for (let i = 0; i < state.discInventory[player]; i++) {
            items.push({ type: 'disc', color: player });
        }
        for (let i = 0; i < state.ringInventory[player]; i++) {
            items.push({ type: 'ring', color: player });
        }

        const playerPiecesCount = items.length;

        // Add captured discs and rings (opponent's pieces)
        for (let i = 0; i < state.captured[player].disc; i++) {
            items.push({ type: 'disc', color: player === 'black' ? 'white' : 'black' });
        }
        for (let i = 0; i < state.captured[player].ring; i++) {
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

        const lastPlayerRow = playerPiecesCount > 0 ? Math.floor((playerPiecesCount - 1) / columns) : -1;
        const capturedPiecesCount = items.length - playerPiecesCount;

        // Draw separator line between player's pieces and captured pieces
        if (playerPiecesCount > 0 && capturedPiecesCount > 0) {
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

    /**
     * Draw the inventory panel
     */
    function drawInventory() {
        inventoryCtx.clearRect(0, 0, inventoryCanvas.width, inventoryCanvas.height);

        const isMobile = window.innerWidth <= 768;
        const isSmallMobile = window.innerWidth <= 480;

        const boxWidth = isSmallMobile ? 80 : (isMobile ? 100 : 130);
        const padding = isSmallMobile ? 5 : (isMobile ? 8 : 10);

        const blackBoxX = padding;
        const blackBoxY = padding;

        const whiteBoxX = canvas.width - boxWidth - padding;
        const whiteBoxY = padding;

        drawInventoryItems(blackBoxX, blackBoxY, 'black');
        drawInventoryItems(whiteBoxX, whiteBoxY, 'white');
    }

    /**
     * Draw place piece buttons (disc/ring)
     */
    function drawPlacePieceButtons(x, y, btns) {
        const state = getGameState();
        const offset = hexSize * 0.5;

        const discX = x - offset;
        const discY = y;

        const ringX = x + offset;
        const ringY = y;

        drawSingleInventoryItem(ctx, discX, discY, { type: 'disc', color: state.activePlayer }, inventoryItemSize * 2);
        drawSingleInventoryItem(ctx, ringX, ringY, { type: 'ring', color: state.activePlayer }, inventoryItemSize * 2);

        const hitRadius = inventoryItemSize * 2;

        btns.discBtn = { x: discX, y: discY, r: hitRadius };
        btns.ringBtn = { x: ringX, y: ringY, r: hitRadius };
    }

    /**
     * Draw end turn button (checkmark)
     * @returns {Object} Button bounds for click detection
     */
    function drawEndTurnButton(x, y, q, r) {
        const checkSize = inventoryItemSize * 2;

        ctx.save();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const startX = x - checkSize * 0.4;
        const startY = y;
        const midX = x - checkSize * 0.1;
        const midY = y + checkSize * 0.4;
        const endX = x + checkSize * 0.5;
        const endY = y - checkSize * 0.5;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(midX, midY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.restore();

        return { q, r, x, y, checkSize };
    }

    /**
     * Draw the main game grid
     * @returns {Object} Button bounds for click detection
     */
    function drawGrid() {
        const state = getGameState();
        const {
            tiles, pieces, selectedPiece, multiJumping, multiJumpPos,
            showCoords, showGrid, colorScheme, placePieceBtnTile, placePieceBtnBounds,
            lastMove, showValidMoves, showPreviousMove, activePlayer,
            isGameStateChanged, calculateAllValidMoves, calculateValidMovesForPiece
        } = state;

        // Result object for button bounds
        const result = {
            endTurnBtnBounds: null,
            placePieceBtnBounds: placePieceBtnBounds
        };

        ctx.fillStyle = schemes[colorScheme].bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Collect positions that are being animated (to skip drawing static pieces there)
        const animatedFromPositions = new Set();
        const animatedToPositions = new Set();
        activeAnimations.forEach(anim => {
            if (anim.type === 'move') {
                // Don't draw static piece at destination during move animation
                animatedToPositions.add(`${anim.toQ},${anim.toR}`);
            }
            if (anim.type === 'capture') {
                // Don't draw static piece at capture position
                animatedFromPositions.add(`${anim.q},${anim.r}`);
            }
            if (anim.type === 'piecePlacement') {
                // Don't draw static piece during placement animation
                animatedToPositions.add(`${anim.q},${anim.r}`);
            }
        });
        // Also include pending final destinations (for multi-segment animations)
        pendingFinalDestinations.forEach(pos => animatedToPositions.add(pos));
        // Pending captures should not be drawn from game state (they'll be drawn as ghost pieces)
        pendingCaptures.forEach((piece, pos) => animatedFromPositions.add(pos));

        // Draw all hexes and contents
        for (let q = -radius; q <= radius; q++) {
            for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
                const [x, y] = hexToPixel(q, r, hexSize);
                if (showGrid) {
                    drawHex(x, y, hexSize, schemes[colorScheme].border);
                }
                const key = `${q},${r}`;
                
                // Handle tile animations
                const tileAnim = activeAnimations.find(a => a.type === 'tilePlacement' && a.q === q && a.r === r);
                if (tileAnim) {
                    // Draw tile with scale animation
                    drawTileAnimated(x, y, tileAnim.color, colorScheme, tileAnim.progress);
                } else if (tiles[key]) {
                    drawTile(x, y, tiles[key], colorScheme);
                }
                
                // Draw static pieces (skip if being animated)
                if (tiles[key] && pieces[key] && !animatedToPositions.has(key) && !animatedFromPositions.has(key)) {
                    drawPiece(x, y, pieces[key], colorScheme);
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
                    if (multiJumping && multiJumpPos && multiJumpPos.q === q && multiJumpPos.r === r) {
                        if (isGameStateChanged()) {
                            result.endTurnBtnBounds = drawEndTurnButton(x, y, q, r);
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

        // Draw contextual place disc/ring buttons
        if (placePieceBtnTile && result.placePieceBtnBounds) {
            const [px, py] = hexToPixel(placePieceBtnTile.q, placePieceBtnTile.r, hexSize);
            drawPlacePieceButtons(px, py, result.placePieceBtnBounds);
        }

        // Draw last move highlight
        if (showPreviousMove && lastMove) {
            drawLastMoveHighlight(lastMove);
        }

        // Draw valid moves indicator
        if (showValidMoves) {
            const shouldShowValidMoves = window.isAiMode ? activePlayer === 'black' : true;

            if (shouldShowValidMoves) {
                let movesToDisplay = [];

                if (selectedPiece) {
                    movesToDisplay = calculateValidMovesForPiece(selectedPiece.q, selectedPiece.r, activePlayer);
                } else {
                    movesToDisplay = calculateAllValidMoves(activePlayer);
                }

                movesToDisplay.forEach(move => {
                    const [x, y] = hexToPixel(move.q, move.r, hexSize);
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(x, y, hexSize * 0.08, 0, 2 * Math.PI);
                    ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
                    ctx.fill();
                    ctx.restore();
                });
            }
        }

        // Draw animated elements on top
        drawAnimatedElements(colorScheme);

        drawInventory();

        return result;
    }

    /**
     * Draw all animated elements (pieces moving, captures fading, placements scaling)
     */
    function drawAnimatedElements(colorScheme) {
        // First, draw pending captures as ghost pieces (pieces waiting to be captured)
        pendingCaptures.forEach((piece, posKey) => {
            const [q, r] = posKey.split(',').map(Number);
            const [x, y] = hexToPixel(q, r, hexSize);
            drawPieceWithOpacity(x, y, piece, colorScheme, ghostPieceOpacity);
        });

        // Draw the jumping piece at its current position during capture animations
        if (pendingJumpPosition) {
            const [x, y] = hexToPixel(pendingJumpPosition.q, pendingJumpPosition.r, hexSize);
            drawPieceWithOpacity(x, y, pendingJumpPosition.piece, colorScheme, jumpingPieceOpacity);
        }

        // Then draw active animations
        activeAnimations.forEach(anim => {
            if (anim.type === 'move') {
                // Interpolate position
                const fromPixel = hexToPixel(anim.fromQ, anim.fromR, hexSize);
                const toPixel = hexToPixel(anim.toQ, anim.toR, hexSize);
                const currentX = lerp(fromPixel[0], toPixel[0], anim.progress);
                const currentY = lerp(fromPixel[1], toPixel[1], anim.progress);
                
                drawPiece(currentX, currentY, anim.piece, colorScheme);
            } else if (anim.type === 'capture') {
                // Fade out with opacity
                const [x, y] = hexToPixel(anim.q, anim.r, hexSize);
                const opacity = 1 - anim.progress;
                drawPieceWithOpacity(x, y, anim.piece, colorScheme, opacity);
            } else if (anim.type === 'piecePlacement') {
                // Scale in from small to full size
                const [x, y] = hexToPixel(anim.q, anim.r, hexSize);
                const scale = anim.progress;
                drawPieceWithScale(x, y, anim.piece, colorScheme, scale);
            }
        });
    }

    /**
     * Draw a piece with opacity (for capture fade-out)
     */
    function drawPieceWithOpacity(cx, cy, piece, scheme, opacity) {
        if (!piece || opacity <= 0) return;
        ctx.save();
        ctx.globalAlpha = opacity;
        drawPiece(cx, cy, piece, scheme);
        ctx.restore();
    }

    /**
     * Draw a piece with scale (for placement pop-in)
     */
    function drawPieceWithScale(cx, cy, piece, scheme, scale) {
        if (!piece || scale <= 0) return;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.translate(-cx, -cy);
        drawPiece(cx, cy, piece, scheme);
        ctx.restore();
    }

    /**
     * Draw a tile with scale animation (for placement)
     */
    function drawTileAnimated(cx, cy, color, scheme, progress) {
        const scale = progress;
        if (scale <= 0) return;
        
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.translate(-cx, -cy);
        drawTile(cx, cy, color, scheme);
        ctx.restore();
    }

    /**
     * Draw the last move highlight
     */
    function drawLastMoveHighlight(lastMove) {
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

            ctx.save();
            ctx.strokeStyle = 'gray';
            ctx.lineWidth = 2;
            ctx.beginPath();
            
            // If we have a path with multiple positions, draw each segment
            if (lastMove.path && lastMove.path.length > 1) {
                const [startX, startY] = hexToPixel(lastMove.path[0].q, lastMove.path[0].r, hexSize);
                ctx.moveTo(startX, startY);
                for (let i = 1; i < lastMove.path.length; i++) {
                    const [px, py] = hexToPixel(lastMove.path[i].q, lastMove.path[i].r, hexSize);
                    ctx.lineTo(px, py);
                }
            } else {
                // Fallback to simple from->to line
                ctx.moveTo(fromX, fromY);
                ctx.lineTo(toX, toY);
            }
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(toX, toY, hexSize * 0.45, 0, 2 * Math.PI);
            ctx.strokeStyle = 'gray';
            ctx.lineWidth = 4;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();

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

    // ==================== Public API ====================

    return {
        init,
        hexToPixel,
        pixelToHex,
        updateDynamicLayout,
        resizeCanvas,
        drawGrid,
        drawInventory,
        schemes,
        getHexSize: function () { return hexSize; },
        getCenterX: function () { return centerX; },
        getCenterY: function () { return centerY; },
        // Animation API
        setAnimationsEnabled,
        isAnimating,
        queueMoveAnimation,
        queueJumpSequence,
        queueJumpSequenceWithCaptures,
        queueSingleMoveWithCapture,
        queueCaptureAnimation,
        queueTilePlacementAnimation,
        queuePiecePlacementAnimation,
        onAllAnimationsComplete,
        clearAnimations
    };
})();

// Export for use in game.js
if (typeof window !== 'undefined') {
    window.GameGraphics = GameGraphics;
}
