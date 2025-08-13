// game.js
// Entry point for Hexaequo V2 game logic

let endTurnBtnBounds = null; // Used to track the End Turn button position for click detection
let placePieceBtnBounds = null; // Used to track contextual place disc/ring buttons
let placePieceBtnTile = null; // {q, r} for which tile the buttons are shown

window.onload = function() {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const btnCoords = document.getElementById('toggleCoordsBtn');
    const btnScheme = document.getElementById('toggleColorSchemeBtn');
    const playerStatus = document.getElementById('playerStatus');
    let showCoords = false;
    let colorScheme = 'classic'; // 'modern' or 'classic'
    let activePlayer = 'black'; // 'black' starts
    let gameState, updatedState; // explicit state holders to avoid implicit globals
    let selectedPiece = null; // {q, r} or null
    let captured = {
        black: {disc: 0, ring: 0},
        white: {disc: 0, ring: 0}
    };
    let ringInventory = {
        black: 3,
        white: 3
    };
    let showGrid = false;
    let multiJumping = false; // true if in a multi-jump sequence
    let multiJumpPos = null; // {q, r} of the piece in multi-jump
    // Track jump paths for highlighting
    window.currentJumpPath = null; // ["q,r", ...] during the sequence
    window.lastJumpPath = null;    // saved after the turn to highlight
    window.jumpMovesAnimated = false; // true if human multi-jump segments already animated inline
    // Simple animation state for piece translation (no lines)
    let animHidePieceKey = null; // key of destination tile to hide while animating a piece
    let animHideTileKey = null;  // key of destination tile to hide while animating a tile
    // Persistently hide a specific board piece across sequential animations (e.g., ring placement)
    let forceHidePieceKey = null;
    const boardGhosts = {}; // key: 'q,r' -> { type, color } shown until capture animation starts
        const anim = {
        active: false,
        mode: 'board', // 'board' | 'screen'
        pathBoard: null, // array of 'q,r'
        pathScreen: null, // array of {x,y}
        segmentIndex: 0,
        segmentStart: 0,
            durationPerSegmentMs: 250,
        render: null, // function(x, y)
        onComplete: null
    };

    // Simple animation queue for sequencing multiple animations (moves, placements, captures)
    const animationQueue = [];
    let animationInProgress = false;
    const hiddenInventorySlots = []; // { player: 'black'|'white', absIndex: number }
    
    // Utility: remove ghosts that are not in the provided key set
    function clearGhostsNotIn(keysSet) {
        for (const k in boardGhosts) {
            if (!keysSet.has(k)) delete boardGhosts[k];
        }
    }

    function enqueueAnimation(spec) {
        animationQueue.push(spec);
        if (!animationInProgress) {
            animationInProgress = true;
            runNextAnimation();
        }
    }

    function runNextAnimation() {
        const next = animationQueue.shift();
        if (!next) {
            animationInProgress = false;
            return;
        }
        const starter = () => {
            if (typeof next.onBefore === 'function') {
                try { next.onBefore(); } catch (e) {}
            }
            if (next.type === 'board') {
                if (typeof next.durationMs === 'number') {
                    anim.durationPerSegmentMs = next.durationMs;
                } else {
                    // Default board movement duration
                    anim.durationPerSegmentMs = 300;
                }
                startBoardAnimation(next.pathKeys, next.render, next.hidePieceKey || null, function() {
                    if (typeof next.onAfter === 'function') next.onAfter();
                    runNextAnimation();
                });
            } else if (next.type === 'screen') {
                if (typeof next.durationMs === 'number') {
                    anim.durationPerSegmentMs = next.durationMs;
                } else {
                    // Default inventory transition duration
                    anim.durationPerSegmentMs = 400;
                }
                startScreenAnimation(next.points, next.render, next.hideOptions || {}, function() {
                    if (typeof next.onAfter === 'function') next.onAfter();
                    runNextAnimation();
                });
            } else {
                runNextAnimation();
            }
        };
        if (next.delayMs && next.delayMs > 0) {
            setTimeout(starter, next.delayMs);
        } else {
            starter();
        }
    }

        // AI scheduling helpers to coordinate with animations
        let aiScheduled = false;

        function waitForAnimationEnd() {
            return new Promise((resolve) => {
                if (!anim.active && !animationInProgress && animationQueue.length === 0) {
                    resolve();
                    return;
                }
                function tick() {
                    if (!anim.active && !animationInProgress && animationQueue.length === 0) {
                        resolve();
                        return;
                    }
                    requestAnimationFrame(tick);
                }
                requestAnimationFrame(tick);
            });
        }

        function scheduleAiMoveIfNeeded() {
            // Only schedule if AI mode and it's AI's turn
            if (!isAiMode) return;
            if ((window.aiSide || 'white') !== activePlayer) return;
            if (aiScheduled) return;
            aiScheduled = true;
            waitForAnimationEnd().then(() => {
                aiScheduled = false;
                // Re-check it's still AI's turn and interactions aren't already disabled
                if ((window.aiSide || 'white') === activePlayer && canvas.style.pointerEvents !== 'none') {
                    sendToAI();
                }
            });
        }

    function startPieceAnimation(path, piece) {
        // Backward-compatible wrapper for board-based piece animation
        startBoardAnimation(
            path.map(p => (typeof p === 'string' ? p : `${p[0]},${p[1]}`)),
            (x, y) => drawPiece(x, y, piece, colorScheme),
            path[path.length - 1]
        );
    }

    function startBoardAnimation(pathKeys, render, hidePieceKey = null, onComplete = null) {
        if (!pathKeys || pathKeys.length < 2 || !render) return;
        anim.active = true;
        anim.mode = 'board';
        anim.pathBoard = pathKeys;
        anim.pathScreen = null;
        anim.segmentIndex = 0;
        anim.segmentStart = 0;
        anim.render = render;
        anim.onComplete = onComplete;
        animHidePieceKey = hidePieceKey;
        requestAnimationFrame(stepPieceAnimation);
    }

    function startScreenAnimation(points, render, hideOptions = {}, onComplete = null) {
        if (!points || points.length < 2 || !render) return;
        anim.active = true;
        anim.mode = 'screen';
        anim.pathBoard = null;
        anim.pathScreen = points.map(p => ({ x: p.x, y: p.y }));
        anim.segmentIndex = 0;
        anim.segmentStart = 0;
        anim.render = render;
        anim.onComplete = onComplete;
        animHidePieceKey = hideOptions.hidePieceKey || null;
        animHideTileKey = hideOptions.hideTileKey || null;
        requestAnimationFrame(stepPieceAnimation);
    }

    function stepPieceAnimation(timestamp) {
        if (!anim.active || !anim.path || anim.path.length < 2) {
            // Backward compatibility guard; new code uses pathBoard/pathScreen
        }
        // Resolve current path according to mode
        const isBoardMode = anim.mode === 'board';
        const pathKeys = anim.pathBoard;
        const pathPoints = anim.pathScreen;

        const tooShort = (isBoardMode && (!pathKeys || pathKeys.length < 2)) || (!isBoardMode && (!pathPoints || pathPoints.length < 2));
        if (tooShort) {
            anim.active = false;
            animHidePieceKey = null;
            animHideTileKey = null;
            anim.render = null;
            const done = anim.onComplete; anim.onComplete = null;
            if (typeof done === 'function') done();
            return;
        }
        if (!anim.segmentStart) anim.segmentStart = timestamp;
        let fx, fy, tx, ty;
        if (isBoardMode) {
            const fromKey = pathKeys[anim.segmentIndex];
            const toKey = pathKeys[anim.segmentIndex + 1];
            const [fq, fr] = fromKey.split(',').map(Number);
            const [tq, tr] = toKey.split(',').map(Number);
            [fx, fy] = hexToPixel(fq, fr, hexSize);
            [tx, ty] = hexToPixel(tq, tr, hexSize);
        } else {
            const fromPt = pathPoints[anim.segmentIndex];
            const toPt = pathPoints[anim.segmentIndex + 1];
            fx = fromPt.x; fy = fromPt.y; tx = toPt.x; ty = toPt.y;
        }

        const elapsed = timestamp - anim.segmentStart;
        const linear = Math.max(0, Math.min(1, elapsed / anim.durationPerSegmentMs));
        // ease-in-out (cubic)
        const progress = (linear < 0.5)
            ? 4 * linear * linear * linear
            : 1 - Math.pow(-2 * linear + 2, 3) / 2;

        // Redraw board without the destination piece
        drawGrid();
        // Draw moving sprite at interpolated coordinates
        const cx = fx + (tx - fx) * progress;
        const cy = fy + (ty - fy) * progress;
        if (typeof anim.render === 'function') anim.render(cx, cy);

        if (progress >= 1) {
            // Next segment
            anim.segmentIndex += 1;
            anim.segmentStart = timestamp;
            if (anim.segmentIndex >= ((isBoardMode ? pathKeys.length : pathPoints.length) - 1)) {
                // Finished
                anim.active = false;
                animHidePieceKey = null;
                animHideTileKey = null;
                anim.render = null;
                drawGrid();
                window.lastJumpPath = null;
                window.lastGenericPath = null;
                const done = anim.onComplete; anim.onComplete = null;
                if (typeof done === 'function') done();
                return;
            }
        }
        requestAnimationFrame(stepPieceAnimation);
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

    // Hex grid parameters
    const radius = 8; // grid radius in hexes
    const hexSize = 25; // pixel size from center to corner
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Initial tile content: key = 'q,r', value = 'black' or 'white'
    let tiles = {
        '0,0': 'black',
        '1,0': 'black',
        '-1,1': 'white',
        '0,1': 'white',
    };

    // Pieces: key = 'q,r', value = {type: 'disc'|'ring', color: 'black'|'white'}
    let pieces = {
        '1,0': {type: 'disc', color: 'black'},
        '-1,1': {type: 'disc', color: 'white'},
    };

    // Color palettes
    const schemes = {
        modern: {
            bg: '#222',
            black: '#222',
            white: '#fafafa',
            border: '#fff',
        },
        classic: {
            bg: '#d0c09bff',
            black: '#7a5230', // dark brown
            white: '#f5e2b6', // light brown
            border: '#7a5230',
        }
    };

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
        const y = size * 3/2 * r;
        return [centerX + x, centerY + y];
    }

    // Convert pixel coordinates to axial (q, r)
    function pixelToHex(x, y) {
        const px = x - centerX;
        const py = y - centerY;
        const q = (Math.sqrt(3)/3 * px - 1/3 * py) / hexSize;
        const r = (2/3 * py) / hexSize;
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

    // Draws contextual place disc/ring buttons centered at the top of the canvas
    function drawPlacePieceButtons(x, y, btns) {
        const btnW = 80, btnH = 28, gap = 10;
        const centerX = canvas.width / 2;
        const topY = 30;

        // Disc button
        ctx.save();
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.rect(centerX - btnW - gap / 2, topY, btnW, btnH);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#000a';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#222';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Place Disc', centerX - btnW / 2 - gap / 2, topY + btnH / 2);
        ctx.restore();

        // Ring button
        ctx.save();
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.rect(centerX + gap / 2, topY, btnW, btnH);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#000a';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#222';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Place Ring', centerX + btnW / 2 + gap / 2, topY + btnH / 2);
        ctx.restore();

        // Update btns for click detection
        btns.discBtn = { x: centerX - btnW - gap / 2, y: topY, w: btnW, h: btnH };
        btns.ringBtn = { x: centerX + gap / 2, y: topY, w: btnW, h: btnH };
    }

    // Draws a contextual End Turn button centered at the top of the canvas
    function drawEndTurnButton(x, y, q, r) {
        const btnW = 100, btnH = 32;
        const centerX = canvas.width / 2;
        const topY = 30;
        const btnX = centerX - btnW / 2;
        const btnY = topY;

        ctx.save();
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.rect(btnX, btnY, btnW, btnH);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#000a';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#222';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('End Turn', btnX + btnW / 2, btnY + btnH / 2);
        ctx.restore();

        // Store button bounds for click detection
        endTurnBtnBounds = { q, r, x: btnX, y: btnY, w: btnW, h: btnH };
    }

    // Draw all hexes in a hexagonal grid of given radius
    function drawGrid() {
        ctx.fillStyle = schemes[colorScheme].bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Draw all hexes and contents (with selection highlight if any)
        for (let q = -radius; q <= radius; q++) {
            for (let r = Math.max(-radius, -q-radius); r <= Math.min(radius, -q+radius); r++) {
                const [x, y] = hexToPixel(q, r, hexSize);
                if (showGrid) {
                    drawHex(x, y, hexSize, schemes[colorScheme].border);
                }
                // Draw tile if present
                const key = `${q},${r}`;
                if (tiles[key]) {
                    if (`${q},${r}` !== animHideTileKey) {
                        drawTile(x, y, tiles[key], colorScheme);
                    }
                    // Draw piece if present
                    if (pieces[key]) {
                        const shouldHide = (`${q},${r}` === animHidePieceKey) || (`${q},${r}` === forceHidePieceKey);
                        if (!shouldHide) {
                            drawPiece(x, y, pieces[key], colorScheme);
                        } else if (`${q},${r}` !== forceHidePieceKey && boardGhosts[key]) {
                            // For normal anim-hide we may show a ghost; for force-hide we show nothing
                            drawPiece(x, y, boardGhosts[key], colorScheme);
                        }
                    } else if (boardGhosts[key]) {
                        // Draw ghost on empty tile until its translation starts
                        drawPiece(x, y, boardGhosts[key], colorScheme);
                    }
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
                        drawEndTurnButton(x, y, q, r);
                    }
                    // Draw contextual place disc/ring buttons if needed
                    if (placePieceBtnTile && placePieceBtnTile.q === q && placePieceBtnTile.r === r && placePieceBtnBounds) {
                        drawPlacePieceButtons(x, y, placePieceBtnBounds);
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
        // removed per-frame listener attachment for Grid toggle; attached once during setup

        // Update player status
        if (playerStatus) {
            playerStatus.textContent = `Active player: ${activePlayer.charAt(0).toUpperCase() + activePlayer.slice(1)}`;
            playerStatus.style.color = colorScheme === 'modern'
                ? (activePlayer === 'black' ? schemes.modern.black : schemes.modern.white)
                : (activePlayer === 'black' ? schemes.classic.black : schemes.classic.white);
            playerStatus.style.textShadow = colorScheme === 'modern' ? '0 0 4px #fff, 0 0 2px #000' : '0 0 2px #b08b4f';
        }

        function drawInventory() {
            const boxWidth = 130;
            const padding = 10;

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
            const itemSize = 20;
            const gap = 25;
            const columns = 3;
            const startX = boxX + 20;
            const startY = boxY + 20;

            const items = [];

            // Pending captures during human multi-jump should not be shown yet
            function getPendingCaptureCountsForPlayer(p) {
                if (!multiJumping) return { disc: 0, ring: 0 };
                if (p !== activePlayer) return { disc: 0, ring: 0 };
                const list = Array.isArray(window.currentJumpCaptures) ? window.currentJumpCaptures : [];
                let d = 0, r = 0;
                for (const c of list) {
                    if (!c || !c.type) continue;
                    if (c.type === 'disc') d += 1;
                    else if (c.type === 'ring') r += 1;
                }
                return { disc: d, ring: r };
            }
            const pending = getPendingCaptureCountsForPlayer(player);

            // Add tiles, discs, rings, captured discs, and captured rings to the items array
            for (let i = 0; i < inventory[player]; i++) {
                items.push({ type: 'tile', color: player });
            }
            for (let i = 0; i < discInventory[player]; i++) {
                items.push({ type: 'disc', color: player });
            }
            for (let i = 0; i < ringInventory[player]; i++) {
                items.push({ type: 'ring', color: player });
            }
            // Hide pending captured discs until end of turn animations
            const visibleCapturedDiscs = Math.max(0, captured[player].disc - pending.disc);
            for (let i = 0; i < visibleCapturedDiscs; i++) {
                items.push({ type: 'disc', color: player === 'black' ? 'white' : 'black' });
            }
            // Hide pending captured rings until end of turn animations
            const visibleCapturedRings = Math.max(0, captured[player].ring - pending.ring);
            for (let i = 0; i < visibleCapturedRings; i++) {
                items.push({ type: 'ring', color: player === 'black' ? 'white' : 'black' });
            }

            // Draw items in a 3-column grid
            items.forEach((item, index) => {
                // Skip if this absolute slot is temporarily hidden
                if (hiddenInventorySlots.some(s => s.player === player && s.absIndex === index)) {
                    return;
                }
                const col = index % columns;
                const row = Math.floor(index / columns);
                const x = startX + col * (itemSize + gap);
                const y = startY + row * (itemSize + gap);

                ctx.save();
                if (item.type === 'tile') {
                    // Draw a small hex tile for inventory
                    ctx.save();
                    ctx.beginPath();
                    for (let i = 0; i < 6; i++) {
                        const angle = Math.PI / 3 * i + Math.PI / 6;
                        const hx = x + (itemSize) * Math.cos(angle);
                        const hy = y + (itemSize) * Math.sin(angle);
                        if (i === 0) ctx.moveTo(hx, hy);
                        else ctx.lineTo(hx, hy);
                    }
                    ctx.closePath();
                    ctx.fillStyle = item.color === 'black' ? '#7a5230' : '#f5e2b6';
                    ctx.shadowColor = '#000a';
                    ctx.shadowBlur = 2;
                    ctx.fill();
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = '#b08b4f';
                    ctx.stroke();
                    ctx.restore();
                } else if (item.type === 'disc') {
                    // Draw a disc with a border and subtle shadow for inventory
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(x, y, itemSize * 0.45, 0, 2 * Math.PI);
                    ctx.fillStyle = item.color === 'black' ? '#222' : '#fafafa';
                    ctx.shadowColor = '#000a';
                    ctx.shadowBlur = 2;
                    ctx.fill();
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = item.color === 'black' ? '#888' : '#bbb';
                    ctx.stroke();
                    ctx.restore();
                } else if (item.type === 'ring') {
                    // Draw a ring for inventory: thick outer circle, thin inner circle for the hole
                    ctx.save();
                    // Outer ring
                    ctx.strokeStyle = item.color === 'black' ? '#222' : '#fafafa';
                    ctx.lineWidth = 5;
                    ctx.beginPath();
                    ctx.arc(x, y, itemSize * 0.48, 0, 2 * Math.PI);
                    ctx.shadowColor = '#000a';
                    ctx.shadowBlur = 2;
                    ctx.stroke();
                    ctx.shadowBlur = 0;
                    // Inner hole (just a thin border for contrast)
                    ctx.beginPath();
                    ctx.arc(x, y, itemSize * 0.28, 0, 2 * Math.PI);
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = '#bbb';
                    ctx.stroke();
                    ctx.restore();
                }
                ctx.restore();
            });
        }

        drawInventory();

        // Update player status
        if (playerStatus) {
            playerStatus.textContent = `Active player: ${activePlayer.charAt(0).toUpperCase() + activePlayer.slice(1)}`;
            playerStatus.style.color = colorScheme === 'modern'
                ? (activePlayer === 'black' ? schemes.modern.black : schemes.modern.white)
                : (activePlayer === 'black' ? schemes.classic.black : schemes.classic.white);
            playerStatus.style.textShadow = colorScheme === 'modern' ? '0 0 4px #fff, 0 0 2px #000' : '0 0 2px #b08b4f';
        }
    }

    drawGrid();

    btnCoords.addEventListener('click', function() {
        showCoords = !showCoords;
        drawGrid();
    });

    btnScheme.addEventListener('click', function() {
        colorScheme = colorScheme === 'modern' ? 'classic' : 'modern';
        drawGrid();
    });

    // Attach grid toggle once (avoid re-attaching inside drawGrid)
    const btnGrid = document.getElementById('toggleGridBtn');
    if (btnGrid) {
        btnGrid.addEventListener('click', function() {
            showGrid = !showGrid;
            drawGrid();
        });
    }

    // Handle placing tiles on click
    // Returns array of [q, r] for neighbors
    function getNeighbors(q, r) {
        return [
            [q+1, r], [q-1, r], [q, r+1], [q, r-1], [q+1, r-1], [q-1, r+1]
        ];
    }

    canvas.addEventListener('click', function(e) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const [q, r] = pixelToHex(mx, my);

        // If End Turn button is visible and clicked, end multi-jump
        if (multiJumping && endTurnBtnBounds) {
            const bx = endTurnBtnBounds.x, by = endTurnBtnBounds.y, bw = endTurnBtnBounds.w, bh = endTurnBtnBounds.h;
            if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
                // End turn and switch active player immediately
                gameState = serializeGameState();
                // Save the current jump path and captures (if any) for animation
                if (window.currentJumpPath && window.currentJumpPath.length > 1) {
                    window.lastJumpPath = [...window.currentJumpPath];
                    if (Array.isArray(window.currentJumpCaptures)) {
                        window.lastJumpCaptures = [...window.currentJumpCaptures];
                    } else {
                        window.lastJumpCaptures = [];
                    }
                }
                window.currentJumpPath = null;
                window.currentJumpCaptures = null;
                multiJumping = false;
                multiJumpPos = null;
                selectedPiece = null;
                endTurnBtnBounds = null;
                activePlayer = activePlayer === 'black' ? 'white' : 'black';
                // Ensure we don't re-animate move segments after turn end
                window.jumpMovesAnimated = true;
                updatedState = serializeGameState();
                applyGameState(updatedState, gameState);
                return;
            }
        }
        // If contextual place disc/ring buttons are visible, check if clicked
        if (placePieceBtnBounds && placePieceBtnTile) {
            const {discBtn, ringBtn} = placePieceBtnBounds;
            // Disc button
            if (mx >= discBtn.x && mx <= discBtn.x + discBtn.w && my >= discBtn.y && my <= discBtn.y + discBtn.h) {
                // Place disc
                gameState = serializeGameState();
                const q = placePieceBtnTile.q, r = placePieceBtnTile.r;
                const key = `${q},${r}`;
                pieces[key] = {type: 'disc', color: activePlayer};
                discInventory[activePlayer]--;
                placePieceBtnBounds = null;
                placePieceBtnTile = null;
                window.lastGenericPath = [key];
                activePlayer = activePlayer === 'black' ? 'white' : 'black';
                updatedState = serializeGameState();
                applyGameState(updatedState, gameState);
                return;
            }
            // Ring button
            if (mx >= ringBtn.x && mx <= ringBtn.x + ringBtn.w && my >= ringBtn.y && my <= ringBtn.y + ringBtn.h) {
                // Place ring: must return a captured disc to opponent
                gameState = serializeGameState();
                const q = placePieceBtnTile.q, r = placePieceBtnTile.r;
                const key = `${q},${r}`;
                pieces[key] = {type: 'ring', color: activePlayer};
                ringInventory[activePlayer]--;
                // Return a captured disc to opponent
                const opp = activePlayer === 'black' ? 'white' : 'black';
                captured[activePlayer].disc--;
                discInventory[opp]++;
                placePieceBtnBounds = null;
                placePieceBtnTile = null;
                window.lastJumpPath = null; window.lastGenericPath = [key]; activePlayer = opp;
                updatedState = serializeGameState();
                applyGameState(updatedState, gameState);
                return;
            }
            // Clicked elsewhere: cancel buttons
            placePieceBtnBounds = null;
            placePieceBtnTile = null;
            drawGrid();
            return;
        }
        // Check if in bounds
        if (q < -radius || q > radius) { selectedPiece = null; drawGrid(); return; }
        if (r < Math.max(-radius, -q-radius) || r > Math.min(radius, -q+radius)) { selectedPiece = null; drawGrid(); return; }
        const key = `${q},${r}`;

        // If a piece is selected, try to move it (adjacent or jump)
        if (selectedPiece) {
            const {q: sq, r: sr} = selectedPiece;
            const selectedKey = `${sq},${sr}`;
            const selectedType = pieces[selectedKey].type;

            if (selectedType === 'ring') {
                const validMoves = getRingJumpPositions(sq, sr, activePlayer);

                for (const move of validMoves) {
                    if (move.q === q && move.r === r) {
                        // Perform the move
                        gameState = serializeGameState();
                    if (move.capture) {
                            const capturedKey = `${q},${r}`;
                            const capturedPiece = pieces[capturedKey];
                            // Track capture for animation sequencing
                            if (!window.currentJumpCaptures) window.currentJumpCaptures = [];
                            window.currentJumpCaptures.push({ key: capturedKey, type: capturedPiece.type, color: capturedPiece.color });
                        // Leave a ghost on board until translation starts
                        boardGhosts[capturedKey] = { type: capturedPiece.type, color: capturedPiece.color };
                            captured[activePlayer][capturedPiece.type]++;
                            delete pieces[capturedKey];
                        // Provide a generic-capture list for highlight/animation pipeline
                        window.lastGenericCaptures = [{ key: capturedKey, type: capturedPiece.type, color: capturedPiece.color }];
                        }

                        pieces[`${q},${r}`] = {type: 'ring', color: activePlayer};
                        delete pieces[selectedKey];

                        // End turn after ring move
                        selectedPiece = null;
                        // highlight path for 2-player ring move
                        window.lastGenericPath = [selectedKey, `${q},${r}`];
                        activePlayer = activePlayer === 'black' ? 'white' : 'black';
                        updatedState = serializeGameState();
                        applyGameState(updatedState, gameState);
                        return;
                    }
                }

                // If no valid move, unselect the piece
                selectedPiece = null;
                drawGrid();
                return;
            }

            // If in multi-jump, only allow further jumps (no adjacent move)
            if (!multiJumping) {
                // Check adjacent move
                for (const [nq, nr] of getNeighbors(sq, sr)) {
                    if (nq === q && nr === r && tiles[key] && !pieces[key]) {
                        gameState = serializeGameState();
                        pieces[key] = {type: 'disc', color: activePlayer};
                        delete pieces[`${sq},${sr}`];
                        // highlight adjacent disc move
                        window.lastGenericPath = [`${sq},${sr}`, key];
                        activePlayer = activePlayer === 'black' ? 'white' : 'black';
                        selectedPiece = null;
                        multiJumping = false;
                        multiJumpPos = null;
                        endTurnBtnBounds = null;
                        // Reset jump history
                        window.jumpHistory = [];
                        updatedState = serializeGameState();
                        applyGameState(updatedState, gameState);
                        return;
                    }
                }
            }
            // --- Track friendly pieces jumped over in this sequence ---
            if (!window.jumpHistory) window.jumpHistory = [];
            // Check jump move (over any piece, in any hex direction)
            const directions = [[1,0], [-1,0], [0,1], [0,-1], [1,-1], [-1,1]];
            let didJump = false;
            for (const [dq, dr] of directions) {
                const jq = sq + dq;
                const jr = sr + dr;
                const landingQ = sq + 2*dq;
                const landingR = sr + 2*dr;
                const jumpKey = `${jq},${jr}`;
                const landingKey = `${landingQ},${landingR}`;
                if (q === landingQ && r === landingR && pieces[jumpKey] && tiles[landingKey] && !pieces[landingKey]) {
                    gameState = serializeGameState();
                    // initialize jump path if first jump in sequence
                    if (!window.currentJumpPath) {
                        window.currentJumpPath = [selectedKey];
                        window.currentJumpCaptures = [];
                    }
                    // Prevent jumping over the same friendly piece twice in the same sequence
                    if (
                        pieces[jumpKey].color === activePlayer &&
                        window.jumpHistory.some(h => h.q === jq && h.r === jr)
                    ) {
                        continue; // Skip this jump, already jumped over this friendly piece
                    }
                    // If enemy piece, capture and remove; leave a ghost for animation
                    if (pieces[jumpKey].color !== activePlayer) {
                        const capPiece = pieces[jumpKey];
                        if (!window.currentJumpCaptures) window.currentJumpCaptures = [];
                        window.currentJumpCaptures.push({ key: jumpKey, type: capPiece.type, color: capPiece.color });
                        boardGhosts[jumpKey] = { type: capPiece.type, color: capPiece.color };
                        if (capPiece.type === 'disc') {
                            captured[activePlayer].disc++;
                        } else if (capPiece.type === 'ring') {
                            captured[activePlayer].ring++;
                        }
                        delete pieces[jumpKey];
                    }
                    pieces[landingKey] = {type: 'disc', color: activePlayer};
                    delete pieces[`${sq},${sr}`];
                    // extend the jump path
                    window.currentJumpPath.push(landingKey);
                    // Track friendly piece jumped over
                    if (pieces[jumpKey] && pieces[jumpKey].color === activePlayer) {
                        window.jumpHistory.push({q: jq, r: jr});
                    }
                    // Check if another jump is available from new position
                    if (canJumpAgain(landingQ, landingR, activePlayer, window.jumpHistory)) {
                        // Human multi-jump partial animation: animate just this jump segment now
                        const movedPiece = { type: 'disc', color: activePlayer };
                        const fromKeyLocal = selectedKey;
                        const toKeyLocal = landingKey;
                        enqueueAnimation({
                            type: 'board',
                            pathKeys: [fromKeyLocal, toKeyLocal],
                            render: (x, y) => drawPiece(x, y, movedPiece, colorScheme),
                            hidePieceKey: toKeyLocal,
                            durationMs: 300,
                            onAfter: () => { drawGrid(); }
                        });
                        window.jumpMovesAnimated = true;
                        // Stay on same player's turn, keep piece selected, show End Turn button
                        selectedPiece = {q: landingQ, r: landingR};
                        multiJumping = true;
                        multiJumpPos = {q: landingQ, r: landingR};
                        endTurnBtnBounds = null;
                        drawGrid();
                        return;
                    } else {
                        // Animate the final jump segment inline before ending the turn
                        const movedPiece = { type: 'disc', color: activePlayer };
                        const fromKeyFinal = selectedKey;
                        const toKeyFinal = landingKey;
                        enqueueAnimation({
                            type: 'board',
                            pathKeys: [fromKeyFinal, toKeyFinal],
                            render: (x, y) => drawPiece(x, y, movedPiece, colorScheme),
                            hidePieceKey: toKeyFinal,
                            durationMs: 300,
                            onAfter: () => {
                                // End turn right after animating the last segment
                                selectedPiece = null;
                                multiJumping = false;
                                multiJumpPos = null;
                                endTurnBtnBounds = null;
                                // finalize jump path for highlight (for capture animations only)
                                if (window.currentJumpPath && window.currentJumpPath.length > 1) {
                                    window.lastJumpPath = [...window.currentJumpPath];
                                    window.lastJumpCaptures = Array.isArray(window.currentJumpCaptures) ? [...window.currentJumpCaptures] : [];
                                }
                                window.currentJumpPath = null;
                                window.currentJumpCaptures = null;
                                activePlayer = activePlayer === 'black' ? 'white' : 'black';
                                // Reset jump history
                                window.jumpHistory = [];
                                // We already animated the human multi-jump segments inline; skip re-animation after turn
                                window.jumpMovesAnimated = true;
                                updatedState = serializeGameState();
                                applyGameState(updatedState, gameState);
                            }
                        });
                        return;
                    }
                }
            }
            // If in multi-jump and no valid jump, do nothing (must click End Turn)
            if (multiJumping) {
                // Only allow End Turn button
                return;
            }
            // Unselect if not a valid move
            selectedPiece = null;
            // Reset jump history
            window.jumpHistory = [];
            drawGrid();
            return;
        }
    // Returns true if another jump is available for the piece at (q, r)
    function canJumpAgain(q, r, player, jumpHistory = []) {
        const directions = [[1,0], [-1,0], [0,1], [0,-1], [1,-1], [-1,1]];
        for (const [dq, dr] of directions) {
            const jq = q + dq;
            const jr = r + dr;
            const landingQ = q + 2*dq;
            const landingR = r + 2*dr;
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

        // If clicking on own piece, select it
        if (pieces[key] && pieces[key].color === activePlayer) {
            selectedPiece = {q, r};
            drawGrid();
            return;
        }

        // If clicking elsewhere, unselect
        if (selectedPiece) {
            selectedPiece = null;
            drawGrid();
            return;
        }

        // Place disc or ring if possible (contextual buttons if both are available)
        if (tiles[key] === activePlayer && !pieces[key]) {
            const canPlaceDisc = discInventory[activePlayer] > 0;
            const canPlaceRing = ringInventory[activePlayer] > 0 && captured[activePlayer].disc > 0;
            if (canPlaceDisc && canPlaceRing) {
                // Show contextual buttons
                const [x, y] = hexToPixel(q, r, hexSize);
                const btnW = 80, btnH = 28, gap = 10;
                placePieceBtnBounds = {
                    discBtn: {x: x + hexSize + 10, y: y - btnH - gap, w: btnW, h: btnH},
                    ringBtn: {x: x + hexSize + 10, y: y + gap, w: btnW, h: btnH}
                };
                placePieceBtnTile = {q, r};
                drawGrid();
                return;
            } else if (canPlaceDisc) {
                gameState = serializeGameState();
                pieces[key] = {type: 'disc', color: activePlayer};
                discInventory[activePlayer]--;
                window.lastJumpPath = null;
                window.lastGenericPath = [key];
                activePlayer = activePlayer === 'black' ? 'white' : 'black';
                updatedState = serializeGameState();
                applyGameState(updatedState, gameState);
                return;
            } else if (canPlaceRing) {
                gameState = serializeGameState();
                pieces[key] = {type: 'ring', color: activePlayer};
                ringInventory[activePlayer]--;
                // Return a captured disc to opponent
                const opp = activePlayer === 'black' ? 'white' : 'black';
                captured[activePlayer].disc--;
                discInventory[opp]++;
                window.lastJumpPath = null; window.lastGenericPath = [key]; activePlayer = opp;
                updatedState = serializeGameState();
                applyGameState(updatedState, gameState);
                return;
            }
        }

        // Place tile if possible (old logic)
        if (tiles[key]) return; // already occupied
        if (inventory[activePlayer] <= 0) return; // no tiles left
        // Must be adjacent to at least 2 already placed tiles
        let adjacent = 0;
        for (const [nq, nr] of getNeighbors(q, r)) {
            if (tiles[`${nq},${nr}`]) adjacent++;
        }
        if (adjacent < 2) return;
        gameState = serializeGameState();
        tiles[key] = activePlayer;
        inventory[activePlayer]--;
        window.lastJumpPath = null; window.lastGenericPath = [key];
        activePlayer = activePlayer === 'black' ? 'white' : 'black';
        updatedState = serializeGameState();
        applyGameState(updatedState, gameState);
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
                    validPositions.push({q: landingQ, r: landingR, capture: true});
                }
            } else {
                // Allow landing on empty tiles only
                validPositions.push({q: landingQ, r: landingR, capture: false});
            }
        }

        return validPositions;
    }

    // Removed duplicate ring movement logic (handled inside main click handler above)

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
                for (let r = Math.max(-radius, -q-radius); r <= Math.min(radius, -q+radius); r++) {
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
                const directions = [[1,0], [-1,0], [0,1], [0,-1], [1,-1], [-1,1]];
                for (const [dq, dr] of directions) {
                    const jq = q + dq, jr = r + dr;
                    const landingQ = q + 2*dq, landingR = r + 2*dr;
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
        gameOverDiv.style.position = 'absolute';
        gameOverDiv.style.top = '50%';
        gameOverDiv.style.left = '50%';
        gameOverDiv.style.transform = 'translate(-50%, -50%)';
        gameOverDiv.style.backgroundColor = '#fff';
        gameOverDiv.style.padding = '20px';
        gameOverDiv.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
        gameOverDiv.style.textAlign = 'center';
        gameOverDiv.style.zIndex = '1000';

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
    }

    // Reset the game
    function resetGame() {
        // Clear all game state
        Object.keys(pieces).forEach(key => delete pieces[key]);
        Object.keys(tiles).forEach(key => delete tiles[key]);
        captured = {
            black: {disc: 0, ring: 0},
            white: {disc: 0, ring: 0}
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

        // Set initial tiles and pieces
        tiles['0,0'] = 'black';
        tiles['1,0'] = 'black';
        tiles['-1,1'] = 'white';
        tiles['0,1'] = 'white';

        pieces['1,0'] = {type: 'disc', color: 'black'};
        pieces['-1,1'] = {type: 'disc', color: 'white'};

        // Remove game over UI
        const gameOverDiv = document.getElementById('gameOver');
        if (gameOverDiv) {
            document.body.removeChild(gameOverDiv);
        }

        // Redraw the grid
        drawGrid();
    }

    // Serialize the game state to send to the AI (deep copy snapshot)
    function serializeGameState() {
        const piecesCopy = {};
        for (const k in pieces) {
            const p = pieces[k];
            piecesCopy[k] = { type: p.type, color: p.color };
        }
        const tilesCopy = { ...tiles };
        return {
            tiles: tilesCopy,
            pieces: piecesCopy,
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

        // If the server provides a jump path (AI multi-jump), store it for highlight
        if (updatedState.last_jump_path && Array.isArray(updatedState.last_jump_path) && updatedState.last_jump_path.length > 1) {
            window.lastJumpPath = [...updatedState.last_jump_path];
        }
        // If server provides a generic highlight_path (any move), capture it too
        // IMPORTANT: do not clear local lastGenericPath in 2-player mode when server provides none
        if (updatedState.highlight_path && Array.isArray(updatedState.highlight_path) && updatedState.highlight_path.length > 0) {
            window.lastGenericPath = [...updatedState.highlight_path];
        }

        // Redraw the grid with highlights
        drawGrid();
        highlightLastMove(previousState, updatedState);


        checkGameEnd(); // Check if the game has ended after applying AI's move
    }

        // Function to highlight the last move made
    function highlightLastMove(previousState, updatedState) {
        const nextPlayer = updatedState.activePlayer;
        const mover = nextPlayer === 'black' ? 'white' : 'black';
        let ringRefundAlreadyQueued = false; // ensure disc refund anim runs before ring placement and only once

        // Helpers to compute inventory slot centers consistent with drawInventoryItems
        function getInventoryStart(player) {
            const boxWidth = 130;
            const padding = 10;
            const startX = (player === 'black') ? (padding + 20) : (canvas.width - boxWidth - padding + 20);
            const startY = padding + 20;
            return { startX, startY };
        }
        function getInventoryCounts(state, player) {
            return {
                tiles: state.inventory[player].tiles,
                discs: state.inventory[player].discs,
                rings: state.inventory[player].rings,
                captured_discs: player === 'black' ? state.captured.black_discs : state.captured.white_discs,
                captured_rings: player === 'black' ? state.captured.black_rings : state.captured.white_rings
            };
        }
        function absoluteIndexForCategory(counts, category, idxWithinCategory) {
            const columns = 3;
            const baseTiles = 0;
            const baseDiscs = baseTiles + counts.tiles;
            const baseRings = baseDiscs + counts.discs;
            const baseCapturedDiscs = baseRings + counts.rings;
            const baseCapturedRings = baseCapturedDiscs + counts.captured_discs;
            let base = 0;
            switch (category) {
                case 'tiles': base = baseTiles; break;
                case 'discs': base = baseDiscs; break;
                case 'rings': base = baseRings; break;
                case 'captured_discs': base = baseCapturedDiscs; break;
                case 'captured_rings': base = baseCapturedRings; break;
            }
            return base + idxWithinCategory;
        }
        function getInventorySlotCenterForState(state, player, category, idxWithinCategory) {
            const { startX, startY } = getInventoryStart(player);
            const itemSize = 20;
            const gap = 25;
            const columns = 3;
            const counts = getInventoryCounts(state, player);
            const absIdx = absoluteIndexForCategory(counts, category, idxWithinCategory);
            const col = absIdx % columns;
            const row = Math.floor(absIdx / columns);
            const x = startX + col * (itemSize + gap);
            const y = startY + row * (itemSize + gap);
            return { x, y };
        }

            // If there was a multi-jump path, animate it (AI: whole path in one go; Human: per segment)
            if (window.lastJumpPath && window.lastJumpPath.length > 1) {
            const path = window.lastJumpPath;
            const startKey = path[0];
            const movedPiece = previousState.pieces[startKey]
                || updatedState.pieces[startKey]
                || updatedState.pieces[path[path.length - 1]]
                || {type: 'disc', color: mover};

            // Build per-segment capture info from captured list stored during the move
            const segments = [];
            for (let i = 0; i < path.length - 1; i++) {
                const fromKey = path[i];
                const toKey = path[i + 1];
                let capture = null;
                if (Array.isArray(window.lastJumpCaptures) && window.lastJumpCaptures[i]) {
                    const c = window.lastJumpCaptures[i];
                    capture = { key: c.key, type: c.type, color: c.color };
                }
                segments.push({ fromKey, toKey, capture });
            }

            // Compute destination indices for captured items (from end of updated inventory)
            let destDiscPtr = mover === 'black' ? updatedState.captured.black_discs - 1 : updatedState.captured.white_discs - 1;
            let destRingPtr = mover === 'black' ? updatedState.captured.black_rings - 1 : updatedState.captured.white_rings - 1;

            // Determine if this move came from the AI
            const aiMove = (typeof isAiMode !== 'undefined' && isAiMode) && ((window.aiSide || 'white') === mover);

            // First: enqueue board move(s)
            const finalEndKey = path[path.length - 1];
            if (!window.jumpMovesAnimated) {
                // Only animate moves after turn if not already animated inline during human multi-jump
                if (aiMove) {
                    // AI multi-jump: animate the entire path in one go
                    enqueueAnimation({
                        type: 'board',
                        pathKeys: path,
                        render: (x, y) => drawPiece(x, y, movedPiece, colorScheme),
                        hidePieceKey: finalEndKey,
                        durationMs: 300
                    });
                } else {
                    // Human: keep per-segment animation behavior
                    segments.forEach(seg => {
                        enqueueAnimation({
                            type: 'board',
                            pathKeys: [seg.fromKey, seg.toKey],
                            render: (x, y) => drawPiece(x, y, movedPiece, colorScheme),
                            // Always hide the final destination piece so it doesn't appear under the moving sprite
                            hidePieceKey: finalEndKey,
                            durationMs: 300
                        });
                    });
                }
            }

            // Then: enqueue capture translations, removing ghosts at start
            const allCaps = segments.map(s => s.capture).filter(Boolean);
            const removedKeysSet = new Set(allCaps.map(c => c.key));
            allCaps.forEach(c => {
                if (c) {
                    const [cq, cr] = c.key.split(',').map(Number);
                    const [sx, sy] = hexToPixel(cq, cr, hexSize);
                    const fromPos = { x: sx, y: sy };
                    if (!boardGhosts[c.key]) boardGhosts[c.key] = { type: c.type, color: c.color };
                    drawGrid();
                    if (c.type === 'disc') {
                        const targetIdxWithin = destDiscPtr--;
                        const toPos = getInventorySlotCenterForState(updatedState, mover, 'captured_discs', targetIdxWithin);
                        const counts = getInventoryCounts(updatedState, mover);
                        const absIndex = absoluteIndexForCategory(counts, 'captured_discs', targetIdxWithin);
                        hiddenInventorySlots.push({ player: mover, absIndex });
                        drawGrid();
                        enqueueAnimation({
                            type: 'screen',
                            points: [fromPos, toPos],
                            render: (x, y) => drawPiece(x, y, { type: 'disc', color: c.color }, colorScheme),
                            durationMs: 400,
                            onBefore: () => { delete boardGhosts[c.key]; drawGrid(); },
                            onAfter: () => {
                                const i = hiddenInventorySlots.findIndex(s => s.player === mover && s.absIndex === absIndex);
                                if (i >= 0) hiddenInventorySlots.splice(i, 1);
                                drawGrid();
                            }
                        });
                    } else if (c.type === 'ring') {
                        const targetIdxWithin = destRingPtr--;
                        const toPos = getInventorySlotCenterForState(updatedState, mover, 'captured_rings', targetIdxWithin);
                        const counts = getInventoryCounts(updatedState, mover);
                        const absIndex = absoluteIndexForCategory(counts, 'captured_rings', targetIdxWithin);
                        hiddenInventorySlots.push({ player: mover, absIndex });
                        drawGrid();
                        enqueueAnimation({
                            type: 'screen',
                            points: [fromPos, toPos],
                            render: (x, y) => drawPiece(x, y, { type: 'ring', color: c.color }, colorScheme),
                            durationMs: 400,
                            onBefore: () => { delete boardGhosts[c.key]; drawGrid(); },
                            onAfter: () => {
                                const i = hiddenInventorySlots.findIndex(s => s.player === mover && s.absIndex === absIndex);
                                if (i >= 0) hiddenInventorySlots.splice(i, 1);
                                drawGrid();
                            }
                        });
                    }
                }
            });
            // Prevent duplicate move animation if a highlight_path was also provided
            window.lastGenericPath = null;
            // Clear any stray ghosts from previous turns that are not part of this capture set
            clearGhostsNotIn(removedKeysSet);
        }

        // Otherwise, render/animate generic path if provided (placements: 1 point, moves: 2+ points)
        if (window.lastGenericPath && window.lastGenericPath.length > 0) {
            const path = window.lastGenericPath;
            if (path.length >= 2) {
                const startKey = path[0];
                const endKey = path[path.length - 1];
                const movedPiece = previousState.pieces[startKey]
                    || updatedState.pieces[startKey]
                    || updatedState.pieces[endKey]
                    || {type: 'disc', color: mover};
                enqueueAnimation({
                    type: 'board',
                    pathKeys: path,
                    render: (x, y) => drawPiece(x, y, movedPiece, colorScheme),
                    hidePieceKey: endKey
                });
                // continue to enqueue inventory animations
            } else {
                // single-point highlight (placement) now replaced by inventory animation below
                // leave window.lastGenericPath intact; we'll clear after enqueuing animations
            }
        }

            // Detect tile placement
        const newTiles = Object.keys(updatedState.tiles).filter(key => !previousState.tiles[key]);
        if (newTiles.length === 1) {
            // If mover's tile inventory decreased, animate from mover's inventory to board
            const moverPrevTiles = previousState.inventory[mover].tiles;
            const moverNowTiles = updatedState.inventory[mover].tiles;
            if (moverNowTiles < moverPrevTiles) {
                const destKey = newTiles[0];
                const [q, r] = destKey.split(',').map(Number);
                const [destX, destY] = hexToPixel(q, r, hexSize);
                const fromPos = getInventorySlotCenterForState(previousState, mover, 'tiles', moverPrevTiles - 1);
                enqueueAnimation({
                    type: 'screen',
                    points: [fromPos, { x: destX, y: destY }],
                    render: (x, y) => drawTile(x, y, mover, colorScheme),
                    hideOptions: { hideTileKey: destKey },
                    onAfter: () => { window.lastGenericPath = null; }
                });
            }
        }

        // Detect piece placement (must also be a change in the inventory)
        const newPieces = Object.keys(updatedState.pieces).filter(key => !previousState.pieces[key]);
        if (newPieces.length === 1) {
            const destKey = newPieces[0];
            const [q, r] = destKey.split(',').map(Number);
            const [destX, destY] = hexToPixel(q, r, hexSize);
            const prevInv = previousState.inventory[mover];
            const currInv = updatedState.inventory[mover];
            const discPlaced = currInv.discs < prevInv.discs;
            const ringPlaced = currInv.rings < prevInv.rings;
            if (discPlaced) {
                const fromPos = getInventorySlotCenterForState(previousState, mover, 'discs', prevInv.discs - 1);
                enqueueAnimation({
                    type: 'screen',
                    points: [fromPos, { x: destX, y: destY }],
                    render: (x, y) => drawPiece(x, y, { type: 'disc', color: mover }, colorScheme),
                    hideOptions: { hidePieceKey: destKey },
                    onAfter: () => { window.lastGenericPath = null; }
                });
            } else if (ringPlaced) {
                // Ensure the final ring on the tile remains hidden throughout the entire animation sequence
                forceHidePieceKey = destKey;
                drawGrid();
                // 1) Queue disc refund animation FIRST (from mover's captured to opponent's discs) if refund occurred
                const moverPrevCapturedDiscs = mover === 'black' ? previousState.captured.black_discs : previousState.captured.white_discs;
                const moverNowCapturedDiscs = mover === 'black' ? updatedState.captured.black_discs : updatedState.captured.white_discs;
                const oppPrevDiscs = previousState.inventory[nextPlayer].discs;
                const oppNowDiscs = updatedState.inventory[nextPlayer].discs;
                if (moverNowCapturedDiscs < moverPrevCapturedDiscs && oppNowDiscs > oppPrevDiscs) {
                    const fromPosRefund = getInventorySlotCenterForState(previousState, mover, 'captured_discs', moverPrevCapturedDiscs - 1);
                    const targetIdxWithinRefund = oppNowDiscs - 1;
                    const toPosRefund = getInventorySlotCenterForState(updatedState, nextPlayer, 'discs', targetIdxWithinRefund);
                    const countsOpp = getInventoryCounts(updatedState, nextPlayer);
                    const absIndexOpp = absoluteIndexForCategory(countsOpp, 'discs', targetIdxWithinRefund);
                    hiddenInventorySlots.push({ player: nextPlayer, absIndex: absIndexOpp });
                    drawGrid();
                    enqueueAnimation({
                        type: 'screen',
                        points: [fromPosRefund, toPosRefund],
                        render: (x, y) => drawPiece(x, y, { type: 'disc', color: nextPlayer }, colorScheme),
                        // Keep destination ring hidden during refund transfer
                        hideOptions: { hidePieceKey: destKey },
                        onAfter: () => {
                            const i = hiddenInventorySlots.findIndex(s => s.player === nextPlayer && s.absIndex === absIndexOpp);
                            if (i >= 0) hiddenInventorySlots.splice(i, 1);
                            drawGrid();
                        }
                    });
                    ringRefundAlreadyQueued = true;
                }

                // 2) Then queue ring placement to board
                const fromPos = getInventorySlotCenterForState(previousState, mover, 'rings', prevInv.rings - 1);
                enqueueAnimation({
                    type: 'screen',
                    points: [fromPos, { x: destX, y: destY }],
                    render: (x, y) => drawPiece(x, y, { type: 'ring', color: mover }, colorScheme),
                    hideOptions: { hidePieceKey: destKey },
                    onAfter: () => {
                        window.lastGenericPath = null;
                        // Unhide the ring on the tile only after the placement animation fully completes
                        forceHidePieceKey = null;
                        drawGrid();
                    }
                });
            }
        }

        // Detect piece movement with captures
        const movedFrom = Object.keys(previousState.pieces).find(
            key => !updatedState.pieces[key] && previousState.pieces[key].color === mover
        );
        const movedTo = Object.keys(updatedState.pieces).find(
            key => !previousState.pieces[key] && updatedState.pieces[key].color === mover
        );
        const capturedKeys = Object.keys(previousState.pieces).filter(key => {
            // A piece is considered captured if it's present previously for nextPlayer and not present now
            // Exclude the origin of mover's piece to avoid misclassifying ring-origin as ghost capture
            if (previousState.pieces[key].color !== nextPlayer) return false;
            if (key === movedFrom) return false;
            return !updatedState.pieces[key];
        });

        // Animate captured pieces moving to mover's captured inventory
        // Skip this block if we already handled captures per segment via lastJumpPath above
        if ((!window.lastJumpPath || window.lastJumpPath.length <= 1) && (capturedKeys.length > 0 || (Array.isArray(window.lastGenericCaptures) && window.lastGenericCaptures.length > 0))) {
            let capturedDiscsToAnimate = capturedKeys.filter(k => previousState.pieces[k].type === 'disc');
            let capturedRingsToAnimate = capturedKeys.filter(k => previousState.pieces[k].type === 'ring');

            // If explicit generic captures are provided (e.g., ring captures on landing), prefer them
            if (Array.isArray(window.lastGenericCaptures) && window.lastGenericCaptures.length > 0) {
                const genCaps = window.lastGenericCaptures.slice();
                const removedKeysSet = new Set(genCaps.map(c => c.key));
                genCaps.forEach(c => {
                    if (!boardGhosts[c.key]) boardGhosts[c.key] = { type: c.type, color: c.color };
                });
                drawGrid();

                let destDiscCount = mover === 'black' ? updatedState.captured.black_discs : updatedState.captured.white_discs;
                let destRingCount = mover === 'black' ? updatedState.captured.black_rings : updatedState.captured.white_rings;

                genCaps.forEach(c => {
                    const [cq, cr] = c.key.split(',').map(Number);
                    const [sx, sy] = hexToPixel(cq, cr, hexSize);
                    const fromPos = { x: sx, y: sy };
                    if (c.type === 'disc') {
                        const targetIdxWithin = --destDiscCount;
                        const toPos = getInventorySlotCenterForState(updatedState, mover, 'captured_discs', targetIdxWithin);
                        const counts = getInventoryCounts(updatedState, mover);
                        const absIndex = absoluteIndexForCategory(counts, 'captured_discs', targetIdxWithin);
                        hiddenInventorySlots.push({ player: mover, absIndex });
                        enqueueAnimation({
                            type: 'screen',
                            points: [fromPos, toPos],
                            render: (x, y) => drawPiece(x, y, { type: 'disc', color: c.color }, colorScheme),
                            durationMs: 400,
                            onBefore: () => { delete boardGhosts[c.key]; drawGrid(); },
                            onAfter: () => {
                                const i = hiddenInventorySlots.findIndex(s => s.player === mover && s.absIndex === absIndex);
                                if (i >= 0) hiddenInventorySlots.splice(i, 1);
                                drawGrid();
                            }
                        });
                    } else if (c.type === 'ring') {
                        const targetIdxWithin = --destRingCount;
                        const toPos = getInventorySlotCenterForState(updatedState, mover, 'captured_rings', targetIdxWithin);
                        const counts = getInventoryCounts(updatedState, mover);
                        const absIndex = absoluteIndexForCategory(counts, 'captured_rings', targetIdxWithin);
                        hiddenInventorySlots.push({ player: mover, absIndex });
                        enqueueAnimation({
                            type: 'screen',
                            points: [fromPos, toPos],
                            render: (x, y) => drawPiece(x, y, { type: 'ring', color: c.color }, colorScheme),
                            durationMs: 400,
                            onBefore: () => { delete boardGhosts[c.key]; drawGrid(); },
                            onAfter: () => {
                                const i = hiddenInventorySlots.findIndex(s => s.player === mover && s.absIndex === absIndex);
                                if (i >= 0) hiddenInventorySlots.splice(i, 1);
                                drawGrid();
                            }
                        });
                    }
                });
                window.lastGenericCaptures = null;
                clearGhostsNotIn(removedKeysSet);
                return;
            }

            let destDiscCount = mover === 'black' ? updatedState.captured.black_discs : updatedState.captured.white_discs;
            let destRingCount = mover === 'black' ? updatedState.captured.black_rings : updatedState.captured.white_rings;

            capturedDiscsToAnimate.forEach((key, idx) => {
                const [q, r] = key.split(',').map(Number);
                const [sx, sy] = hexToPixel(q, r, hexSize);
                const fromPos = { x: sx, y: sy };
                const targetIdxWithin = destDiscCount - 1 - idx;
                const toPos = getInventorySlotCenterForState(updatedState, mover, 'captured_discs', targetIdxWithin);
                // Hide destination captured slot until animation completes
                const counts = getInventoryCounts(updatedState, mover);
                const absIndex = absoluteIndexForCategory(counts, 'captured_discs', targetIdxWithin);
                hiddenInventorySlots.push({ player: mover, absIndex });
                drawGrid();
                enqueueAnimation({
                    type: 'screen',
                    points: [fromPos, toPos],
                    render: (x, y) => drawPiece(x, y, { type: 'disc', color: nextPlayer }, colorScheme),
                    durationMs: 400,
                    onBefore: () => { delete boardGhosts[key]; drawGrid(); },
                    onAfter: () => {
                        // Unhide the destination slot
                        const i = hiddenInventorySlots.findIndex(s => s.player === mover && s.absIndex === absIndex);
                        if (i >= 0) hiddenInventorySlots.splice(i, 1);
                        drawGrid();
                    }
                });
            });

            capturedRingsToAnimate.forEach((key, idx) => {
                const [q, r] = key.split(',').map(Number);
                const [sx, sy] = hexToPixel(q, r, hexSize);
                const fromPos = { x: sx, y: sy };
                const targetIdxWithin = destRingCount - 1 - idx;
                const toPos = getInventorySlotCenterForState(updatedState, mover, 'captured_rings', targetIdxWithin);
                const counts = getInventoryCounts(updatedState, mover);
                const absIndex = absoluteIndexForCategory(counts, 'captured_rings', targetIdxWithin);
                hiddenInventorySlots.push({ player: mover, absIndex });
                drawGrid();
                enqueueAnimation({
                    type: 'screen',
                    points: [fromPos, toPos],
                    render: (x, y) => drawPiece(x, y, { type: 'ring', color: nextPlayer }, colorScheme),
                    durationMs: 400,
                    onBefore: () => { delete boardGhosts[key]; drawGrid(); },
                    onAfter: () => {
                        const i = hiddenInventorySlots.findIndex(s => s.player === mover && s.absIndex === absIndex);
                        if (i >= 0) hiddenInventorySlots.splice(i, 1);
                        drawGrid();
                    }
                });
            });
        }

        // Animate transfer of a captured disc back to opponent on ring placement
        const moverPrevCapturedDiscs = mover === 'black' ? previousState.captured.black_discs : previousState.captured.white_discs;
        const moverNowCapturedDiscs = mover === 'black' ? updatedState.captured.black_discs : updatedState.captured.white_discs;
        const oppPrevDiscs = updatedState.activePlayer === 'black' ? previousState.inventory.black.discs : previousState.inventory.white.discs; // nextPlayer discs before
        const oppNowDiscs = updatedState.inventory[nextPlayer].discs;
        if (!ringRefundAlreadyQueued && moverNowCapturedDiscs < moverPrevCapturedDiscs && oppNowDiscs > oppPrevDiscs) {
            // From mover's captured (previous last) to opponent's discs (updated last)
            const fromPos = getInventorySlotCenterForState(previousState, mover, 'captured_discs', moverPrevCapturedDiscs - 1);
            const targetIdxWithin = oppNowDiscs - 1;
            const toPos = getInventorySlotCenterForState(updatedState, nextPlayer, 'discs', targetIdxWithin);
            const countsOpp = getInventoryCounts(updatedState, nextPlayer);
            const absIndexOpp = absoluteIndexForCategory(countsOpp, 'discs', targetIdxWithin);
            hiddenInventorySlots.push({ player: nextPlayer, absIndex: absIndexOpp });
            drawGrid();
            enqueueAnimation({
                type: 'screen',
                points: [fromPos, toPos],
                render: (x, y) => drawPiece(x, y, { type: 'disc', color: nextPlayer }, colorScheme),
                // If a ring placement is in progress, keep that destination ring hidden
                hideOptions: { hidePieceKey: (typeof forceHidePieceKey === 'string' ? forceHidePieceKey : null) },
                onAfter: () => {
                    const i = hiddenInventorySlots.findIndex(s => s.player === nextPlayer && s.absIndex === absIndexOpp);
                    if (i >= 0) hiddenInventorySlots.splice(i, 1);
                    drawGrid();
                }
            });
        }
    }

    // Step 1: Add sound effects for game actions
    const sounds = {
        tilePlacement: new Audio('sounds/tile_placement.mp3'),
        piecePlacement: new Audio('sounds/piece_placement.mp3'),
        capture: new Audio('sounds/capture.mp3'),
        move: new Audio('sounds/move.mp3'),
        gameEnd: new Audio('sounds/game_end.mp3'),
        buttonClick: new Audio('sounds/button_click.mp3') // Add button click sound
    };

    function playSound(action) {
        const audio = sounds[action];
        if (!audio) return;
        try {
            audio.currentTime = 0;
            const p = audio.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (e) {
            // ignore
        }
    }

    // Play button click sound when any button is clicked
    document.querySelectorAll('button').forEach(button => {
        button.addEventListener('click', () => {
            playSound('buttonClick');
        });
    });

    // Send the game state to the AI and handle the response
    async function sendToAI() {
        const gameState = serializeGameState();
        disableInteractions(); // Disable interactions while AI is thinking
        showLoader(); // Show loader

        console.log('Sending game state to AI:', gameState); // Log the move sent to the AI

        try {
            const response = await fetch('http://127.0.0.1:5000/process', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ...gameState,
                    aiSide: (window.aiSide || 'white'),
                    aiDepth: Math.max(1, Math.min(5, parseInt(window.aiDepth || 2, 10)))
                })
            });
            if (response.ok) {
                const updatedState = await response.json();
                applyGameState(updatedState, gameState); // Apply the updated state from AI
                // Wait for any AI move animation to complete before allowing interactions
                await waitForAnimationEnd();
            } else {
                console.error('Failed to communicate with AI:', response.statusText);
            }
        } catch (error) {
            console.error('Error communicating with AI:', error);
        } finally {
            hideLoader(); // Hide loader
            enableInteractions(); // Re-enable interactions after AI move
        }
    }

    // Function to disable event listeners
    function disableInteractions() {
        canvas.style.pointerEvents = 'none';
    }

    // Function to enable event listeners
    function enableInteractions() {
        canvas.style.pointerEvents = 'auto';
    }

    // Add a loader element to the DOM (positioned at top of canvas)
    const loader = document.createElement('div');
    loader.id = 'aiLoader';
    loader.style.position = 'absolute';
    // Position near top center of the canvas without covering the board
    const canvasRect = canvas.getBoundingClientRect();
    loader.style.top = (canvas.offsetTop + 8) + 'px';
    loader.style.left = (canvas.offsetLeft + canvas.width / 2) + 'px';
    loader.style.transform = 'translate(-50%, 0)';
    loader.style.padding = '8px 12px';
    loader.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
    loader.style.color = 'white';
    loader.style.borderRadius = '8px';
    loader.style.textAlign = 'center';
    loader.style.font = 'bold 14px sans-serif';
    loader.style.display = 'none';
    loader.style.pointerEvents = 'none';
    loader.innerText = 'AI is thinking...';
    // Insert relative to the canvas's offset parent
    (canvas.offsetParent || document.body).appendChild(loader);

    // Show the loader when waiting for AI
    function showLoader() {
        // Keep it aligned with the canvas top center on show
        loader.style.top = (canvas.offsetTop + 8) + 'px';
        loader.style.left = (canvas.offsetLeft + canvas.width / 2) + 'px';
        loader.style.display = 'block';
    }

    // Hide the loader after AI move
    function hideLoader() {
        loader.style.display = 'none';
    }

    // Call checkGameEnd after every click; if AI mode and it's AI turn, trigger AI once
    canvas.addEventListener('click', function(e) {
        if (checkGameEnd()) return;
        if (isAiMode && (window.aiSide || 'white') === activePlayer && canvas.style.pointerEvents !== 'none') {
            // Delay AI request until any ongoing player animation finishes
            scheduleAiMoveIfNeeded();
        }
    });

    // Toggle between AI and 2-player modes
    function toggleGameMode(isAiMode) {
        if (isAiMode) {
            console.log('Switched to AI Mode');
            // Additional setup for AI mode if needed
            if ((window.aiSide || 'white') === activePlayer && canvas.style.pointerEvents !== 'none') {
                // Trigger AI after any ongoing animation completes
                scheduleAiMoveIfNeeded();
            }
        } else {
            console.log('Switched to 2 Player Mode');
            // Additional setup for 2-player mode if needed
        }
    }

    // Expose helpers to the global scope
    window.toggleGameMode = toggleGameMode;
    window.requestAiMove = function() {
        if ((window.aiSide || 'white') === activePlayer && canvas.style.pointerEvents !== 'none') {
            sendToAI();
        }
    };
};
