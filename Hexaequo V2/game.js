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
            bg: '#e0c68a',
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
            ctx.strokeStyle = piece.color === 'black' ? (scheme === 'classic' ? '#222' : '#000') : (scheme === 'classic' ? '#fafafa' : '#fff');
            ctx.shadowColor = '#000a';
            ctx.shadowBlur = 4;
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
                            drawEndTurnButton(x, y, q, r);
                        }
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
        // Draws contextual buttons for placing disc or ring centered at the top of the canvas
        function drawPlacePieceButtons(x, y, btns) {
            const btnW = 80, btnH = 28, gap = 10;
            // Center horizontally at the top of the canvas
            const canvasRect = canvas.getBoundingClientRect();
            const centerX = canvas.width / 2;
            const topY = 30; // 30px from the top

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
            const topY = 30; // 30px from the top
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

        const btnGrid = document.getElementById('toggleGridBtn');
        btnGrid.addEventListener('click', function() {
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

        // Update inventories (show Black and White only once at the top)
        const blackInv = document.getElementById('blackInventory');
        const whiteInv = document.getElementById('whiteInventory');
        const blackDiscInv = document.getElementById('blackDiscInventory');
        const whiteDiscInv = document.getElementById('whiteDiscInventory');
        const blackRingInv = document.getElementById('blackRingInventory');
        const whiteRingInv = document.getElementById('whiteRingInventory');
        const blackCaptured = document.getElementById('blackCaptured');
        const whiteCaptured = document.getElementById('whiteCaptured');

        if (blackInv && blackDiscInv && blackRingInv && blackCaptured) {
            blackInv.innerHTML =
                `<span style="color:${schemes[colorScheme].black};font-weight:bold;">Black</span><br>` +
                `Tiles: ${inventory.black}<br>` +
                `Discs: ${discInventory.black}<br>` +
                `Rings: ${ringInventory.black}<br>` +
                `Captured Discs: ${captured.black.disc}<br>` +
                `Captured Rings: ${captured.black.ring}`;
            // Clear the other black sections
            blackDiscInv.innerHTML = '';
            blackRingInv.innerHTML = '';
            blackCaptured.innerHTML = '';
        }
        if (whiteInv && whiteDiscInv && whiteRingInv && whiteCaptured) {
            whiteInv.innerHTML =
                `<span style="color:${schemes[colorScheme].white};font-weight:bold;">White</span><br>` +
                `Tiles: ${inventory.white}<br>` +
                `Discs: ${discInventory.white}<br>` +
                `Rings: ${ringInventory.white}<br>` +
                `Captured Discs: ${captured.white.disc}<br>` +
                `Captured Rings: ${captured.white.ring}`;
            // Clear the other white sections
            whiteDiscInv.innerHTML = '';
            whiteRingInv.innerHTML = '';
            whiteCaptured.innerHTML = '';
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
                multiJumping = false;
                multiJumpPos = null;
                selectedPiece = null;
                endTurnBtnBounds = null;
                activePlayer = activePlayer === 'black' ? 'white' : 'black';
                drawGrid();
                return;
            }
        }
        // If contextual place disc/ring buttons are visible, check if clicked
        if (placePieceBtnBounds && placePieceBtnTile) {
            const {discBtn, ringBtn} = placePieceBtnBounds;
            // Disc button
            if (mx >= discBtn.x && mx <= discBtn.x + discBtn.w && my >= discBtn.y && my <= discBtn.y + discBtn.h) {
                // Place disc
                const q = placePieceBtnTile.q, r = placePieceBtnTile.r;
                const key = `${q},${r}`;
                pieces[key] = {type: 'disc', color: activePlayer};
                discInventory[activePlayer]--;
                placePieceBtnBounds = null;
                placePieceBtnTile = null;
                activePlayer = activePlayer === 'black' ? 'white' : 'black';
                drawGrid();
                return;
            }
            // Ring button
            if (mx >= ringBtn.x && mx <= ringBtn.x + ringBtn.w && my >= ringBtn.y && my <= ringBtn.y + ringBtn.h) {
                // Place ring: must return a captured disc to opponent
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
                activePlayer = opp;
                drawGrid();
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
                        if (move.capture) {
                            const capturedKey = `${q},${r}`;
                            const capturedPiece = pieces[capturedKey];
                            captured[activePlayer][capturedPiece.type]++;
                            delete pieces[capturedKey];
                        }

                        pieces[`${q},${r}`] = {type: 'ring', color: activePlayer};
                        delete pieces[selectedKey];

                        // End turn after ring move
                        selectedPiece = null;
                        activePlayer = activePlayer === 'black' ? 'white' : 'black';
                        drawGrid();
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
                        pieces[key] = {type: 'disc', color: activePlayer};
                        delete pieces[`${sq},${sr}`];
                        activePlayer = activePlayer === 'black' ? 'white' : 'black';
                        selectedPiece = null;
                        multiJumping = false;
                        multiJumpPos = null;
                        endTurnBtnBounds = null;
                        drawGrid();
                        return;
                    }
                }
            }
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
                    // If enemy disc, capture and remove; if friendly, do not remove
                    if (pieces[jumpKey].type === 'disc' && pieces[jumpKey].color !== activePlayer) {
                        captured[activePlayer].disc++;
                        delete pieces[jumpKey];
                    } else if (pieces[jumpKey].type === 'ring' && pieces[jumpKey].color !== activePlayer) {
                        captured[activePlayer].ring++;
                        delete pieces[jumpKey];
                    }
                    pieces[landingKey] = {type: 'disc', color: activePlayer};
                    delete pieces[`${sq},${sr}`];
                    // Check if another jump is available from new position
                    if (canJumpAgain(landingQ, landingR, activePlayer)) {
                        // Stay on same player's turn, keep piece selected, show End Turn button
                        selectedPiece = {q: landingQ, r: landingR};
                        multiJumping = true;
                        multiJumpPos = {q: landingQ, r: landingR};
                        endTurnBtnBounds = null;
                        drawGrid();
                        return;
                    } else {
                        // No more jumps, end turn
                        selectedPiece = null;
                        multiJumping = false;
                        multiJumpPos = null;
                        endTurnBtnBounds = null;
                        activePlayer = activePlayer === 'black' ? 'white' : 'black';
                        drawGrid();
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
            drawGrid();
            return;
        }
    // Returns true if another jump is available for the piece at (q, r)
    function canJumpAgain(q, r, player) {
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
                if (pieces[jumpKey] !== player || pieces[jumpKey] === player) {
                    // At least one jump available
                    return true;
                }
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
                pieces[key] = {type: 'disc', color: activePlayer};
                discInventory[activePlayer]--;
                activePlayer = activePlayer === 'black' ? 'white' : 'black';
                drawGrid();
                return;
            } else if (canPlaceRing) {
                pieces[key] = {type: 'ring', color: activePlayer};
                ringInventory[activePlayer]--;
                // Return a captured disc to opponent
                const opp = activePlayer === 'black' ? 'white' : 'black';
                captured[activePlayer].disc--;
                discInventory[opp]++;
                activePlayer = opp;
                drawGrid();
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
        tiles[key] = activePlayer;
        inventory[activePlayer]--;
        activePlayer = activePlayer === 'black' ? 'white' : 'black';
        drawGrid();
    });

    // Returns valid jump positions for a ring at (q, r)
    function getRingJumpPositions(q, r, player) {
        const directions = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, -2], [-2, 2], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, -1], [-2, 1]];
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

    // Update ring movement logic in canvas click handler
    if (selectedPiece && pieces[`${selectedPiece.q},${selectedPiece.r}`].type === 'ring') {
        const {q: sq, r: sr} = selectedPiece;
        const validMoves = getRingJumpPositions(sq, sr, activePlayer);

        for (const move of validMoves) {
            if (move.q === q && move.r === r) {
                // Perform the move
                if (move.capture) {
                    const capturedKey = `${q},${r}`;
                    const capturedPiece = pieces[capturedKey];
                    captured[activePlayer][capturedPiece.type]++;
                    delete pieces[capturedKey];
                }

                pieces[`${q},${r}`] = {type: 'ring', color: activePlayer};
                delete pieces[`${sq},${sr}`];

                // End turn after ring move
                selectedPiece = null;
                activePlayer = activePlayer === 'black' ? 'white' : 'black';
                drawGrid();
                return;
            }
        }

        // If no valid move, unselect the piece
        selectedPiece = null;
        drawGrid();
        return;
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
        return false;
    }

    // Check if a player has any active pieces on the board
    function hasActivePieces(player) {
        return Object.values(pieces).some(piece => piece.color === player);
    }

    // End the game and display the winner
    function endGame(winner) {
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
        winnerText.textContent = `${winner} wins the game!`;
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

    // Serialize the game state to send to the AI
    function serializeGameState() {
        return {
            tiles: tiles,
            pieces: pieces,
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
    function applyGameState(updatedState) {
        if (!updatedState || !updatedState.tiles || !updatedState.pieces || !updatedState.inventory || !updatedState.captured || !updatedState.activePlayer) {
            console.error('Invalid game state received from AI:', updatedState);
            return;
        }

        // Update tiles and pieces
        tiles = updatedState.tiles;
        pieces = updatedState.pieces;

        // Update inventory
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

        // Update captured pieces
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

        // Redraw the grid
        drawGrid();

        checkGameEnd(); // Check if the game has ended after applying AI's move

        // Log the received state for debugging
        console.log('Received game state from AI:', updatedState);
    }

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
                body: JSON.stringify(gameState)
            });
            if (response.ok) {
                const updatedState = await response.json();
                applyGameState(updatedState);
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

    // Add a loader element to the DOM
    const loader = document.createElement('div');
    loader.id = 'aiLoader';
    loader.style.position = 'absolute';
    loader.style.top = '50%';
    loader.style.left = '50%';
    loader.style.transform = 'translate(-50%, -50%)';
    loader.style.padding = '20px';
    loader.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    loader.style.color = 'white';
    loader.style.borderRadius = '10px';
    loader.style.textAlign = 'center';
    loader.style.display = 'none';
    loader.innerText = 'AI is thinking...';
    document.body.appendChild(loader);

    // Show the loader when waiting for AI
    function showLoader() {
        loader.style.display = 'block';
    }

    // Hide the loader after AI move
    function hideLoader() {
        loader.style.display = 'none';
    }

    // Example usage: Show loader before sending request to AI
    function requestAiMove() {
        showLoader();

        // Simulate AI request (replace with actual AI request logic)
        setTimeout(() => {
            // Simulate AI response
            hideLoader();
            drawGrid(); // Update the board after AI move
        }, 2000); // Simulate 2 seconds delay for AI thinking
    }

    // Call checkGameEnd after every move
    canvas.addEventListener('click', function(e) {
        // ...existing code...

        // Check if the game has ended
        if (checkGameEnd()) {
            return;
        }

        // If in AI mode and it's the AI's turn, serialize the board and send it to the AI
        if (isAiMode && canvas.style.pointerEvents !== 'none') {
            sendToAI();
        }

        // ...existing code...
    });

    // Toggle between AI and 2-player modes
    function toggleGameMode(isAiMode) {
        if (isAiMode) {
            console.log('Switched to AI Mode');
            // Additional setup for AI mode if needed
        } else {
            console.log('Switched to 2 Player Mode');
            // Additional setup for 2-player mode if needed
        }
    }

    // Expose toggleGameMode to the global scope
    window.toggleGameMode = toggleGameMode;
};
