/**
 * replayViewer.js - Game Replay Viewer (Phase 4)
 * 
 * Fullscreen overlay with standalone canvas renderer.
 * Navigates through serialized game state snapshots.
 * 
 * Dependencies:
 * - API: GET /api/games/:id/replay
 * - window.GameLobby (authenticatedFetch)
 * - i18n (i18nT)
 */

(function() {
    'use strict';

    // ==================== Configuration ====================
    const BACKEND_PORT = 3001;
    const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? `http://localhost:${BACKEND_PORT}`
        : 'https://hexaequo-server.onrender.com';
    const API_BASE = `${SERVER_URL}/api`;
    const AUTO_PLAY_INTERVAL = 1500; // ms between moves

    // Board hex grid
    const BOARD_RADIUS = 8;

    // ==================== State ====================
    let stateHistory = [];   // Array of serialized game states
    let currentIndex = 0;
    let autoPlayTimer = null;
    let replayData = null;   // Full replay response from API

    // ==================== DOM Cache ====================
    const els = {};

    function cacheElements() {
        els.viewer = document.getElementById('replayViewer');
        els.closeBtn = document.getElementById('replayCloseBtn');
        els.blackInfo = document.getElementById('replayBlackInfo');
        els.whiteInfo = document.getElementById('replayWhiteInfo');
        els.result = document.getElementById('replayResult');
        els.canvas = document.getElementById('replayCanvas');
        els.invCanvas = document.getElementById('replayInventoryCanvas');
        els.progress = document.getElementById('replayProgress');
        els.moveInfo = document.getElementById('replayMoveInfo');
        els.firstBtn = document.getElementById('replayFirst');
        els.prevBtn = document.getElementById('replayPrev');
        els.autoPlayBtn = document.getElementById('replayAutoPlay');
        els.nextBtn = document.getElementById('replayNext');
        els.lastBtn = document.getElementById('replayLast');
    }

    // ==================== Initialization ====================
    function init() {
        cacheElements();
        setupEventListeners();
        console.log('[ReplayViewer] Initialized');
    }

    function setupEventListeners() {
        els.closeBtn?.addEventListener('click', closeReplay);
        els.firstBtn?.addEventListener('click', firstMove);
        els.prevBtn?.addEventListener('click', prevMove);
        els.autoPlayBtn?.addEventListener('click', toggleAutoPlay);
        els.nextBtn?.addEventListener('click', nextMove);
        els.lastBtn?.addEventListener('click', lastMove);
        els.progress?.addEventListener('input', onProgressChange);

        document.addEventListener('keydown', onKeyDown);
    }

    function onKeyDown(e) {
        if (!els.viewer || els.viewer.style.display === 'none') return;
        switch(e.key) {
            case 'ArrowLeft':  prevMove(); e.preventDefault(); break;
            case 'ArrowRight': nextMove(); e.preventDefault(); break;
            case 'Home':       firstMove(); e.preventDefault(); break;
            case 'End':        lastMove(); e.preventDefault(); break;
            case ' ':          toggleAutoPlay(); e.preventDefault(); break;
            case 'Escape':     closeReplay(); e.preventDefault(); break;
        }
    }

    // ==================== Open / Close ====================
    async function openReplay(gameId) {
        if (!els.viewer) return;
        els.viewer.style.display = 'flex';
        stopAutoPlay();
        stateHistory = [];
        currentIndex = 0;
        replayData = null;

        // Show loading
        updateMoveInfo(typeof i18nT === 'function' ? i18nT('replay.loading') : 'Loading...');

        try {
            const authFetch = window.GameLobby?.authenticatedFetch;
            if (!authFetch) throw new Error('Not authenticated');

            const response = await authFetch(`${API_BASE}/games/${gameId}/replay`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const result = await response.json();
            replayData = result.data;

            if (!replayData) throw new Error('No replay data');

            // Populate player info
            populatePlayerInfo();

            // Build state history
            if (replayData.stateHistory && replayData.stateHistory.length > 0) {
                // State snapshots path (from final_state.moveHistory)
                stateHistory = replayData.stateHistory.map(entry => entry.gameState || entry);
            } else {
                // No replay data available
                showNoData();
                return;
            }

            if (stateHistory.length === 0) {
                showNoData();
                return;
            }

            // Setup progress bar
            els.progress.min = 0;
            els.progress.max = stateHistory.length - 1;
            els.progress.value = 0;

            // Size canvas and draw initial state
            sizeCanvases();
            goToMove(0);

        } catch (err) {
            console.error('[ReplayViewer] Failed to load replay:', err);
            showNoData();
        }
    }

    function closeReplay() {
        stopAutoPlay();
        if (els.viewer) els.viewer.style.display = 'none';
        stateHistory = [];
        replayData = null;
    }

    function showNoData() {
        updateMoveInfo(typeof i18nT === 'function' ? i18nT('replay.noData') : 'No replay data available for this game.');
        els.progress.max = 0;
        els.progress.value = 0;
        updateButtons();
        // Clear canvases
        const ctx = els.canvas?.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#121212';
            ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
        }
    }

    // ==================== Player Info ====================
    function populatePlayerInfo() {
        if (!replayData) return;
        const p = replayData.players;
        if (els.blackInfo) {
            els.blackInfo.textContent = `● ${p.black?.pseudo || '?'} (${p.black?.eloBefore || '?'})`;
        }
        if (els.whiteInfo) {
            els.whiteInfo.textContent = `○ ${p.white?.pseudo || '?'} (${p.white?.eloBefore || '?'})`;
        }
        if (els.result && replayData.result) {
            const r = replayData.result;
            if (r.winner === 'draw') {
                els.result.textContent = typeof i18nT === 'function' ? i18nT('gameHistory.draw') : 'Draw';
                els.result.style.background = 'rgba(158,158,158,0.2)';
                els.result.style.color = '#9e9e9e';
            } else {
                const winnerPseudo = r.winner === 'black' ? (replayData.players.black?.pseudo || '?') : (replayData.players.white?.pseudo || '?');
                els.result.textContent = `${winnerPseudo} ${typeof i18nT === 'function' ? i18nT('replay.wins') : 'wins'}`;
                els.result.style.background = 'rgba(76,175,80,0.2)';
                els.result.style.color = '#4caf50';
            }
        }
    }

    // ==================== Navigation ====================
    function goToMove(index) {
        if (index < 0 || index >= stateHistory.length) return;
        currentIndex = index;
        els.progress.value = index;
        drawState(stateHistory[index]);
        updateMoveInfo();
        updateButtons();
    }

    function nextMove() {
        if (currentIndex < stateHistory.length - 1) goToMove(currentIndex + 1);
    }

    function prevMove() {
        if (currentIndex > 0) goToMove(currentIndex - 1);
    }

    function firstMove() {
        goToMove(0);
    }

    function lastMove() {
        goToMove(stateHistory.length - 1);
    }

    function onProgressChange() {
        goToMove(parseInt(els.progress.value, 10));
    }

    function toggleAutoPlay() {
        if (autoPlayTimer) {
            stopAutoPlay();
        } else {
            startAutoPlay();
        }
    }

    function startAutoPlay() {
        if (currentIndex >= stateHistory.length - 1) goToMove(0);
        els.autoPlayBtn?.classList.add('playing');
        if (els.autoPlayBtn) els.autoPlayBtn.textContent = '⏸';
        autoPlayTimer = setInterval(() => {
            if (currentIndex >= stateHistory.length - 1) {
                stopAutoPlay();
                return;
            }
            nextMove();
        }, AUTO_PLAY_INTERVAL);
    }

    function stopAutoPlay() {
        if (autoPlayTimer) clearInterval(autoPlayTimer);
        autoPlayTimer = null;
        els.autoPlayBtn?.classList.remove('playing');
        if (els.autoPlayBtn) els.autoPlayBtn.textContent = '▶';
    }

    function updateButtons() {
        const atStart = currentIndex <= 0;
        const atEnd = currentIndex >= stateHistory.length - 1;
        if (els.firstBtn) els.firstBtn.disabled = atStart;
        if (els.prevBtn) els.prevBtn.disabled = atStart;
        if (els.nextBtn) els.nextBtn.disabled = atEnd;
        if (els.lastBtn) els.lastBtn.disabled = atEnd;
    }

    function updateMoveInfo(text) {
        if (!els.moveInfo) return;
        if (text) {
            els.moveInfo.textContent = text;
            return;
        }
        const total = stateHistory.length;
        const moveLabel = typeof i18nT === 'function' ? i18nT('replay.move') : 'Move';
        const state = stateHistory[currentIndex];
        const playerLabel = state?.activePlayer === 'black' ? '●' : '○';
        els.moveInfo.textContent = `${moveLabel} ${currentIndex + 1} / ${total}  ${playerLabel}`;
    }

    // ==================== Canvas Sizing ====================
    function sizeCanvases() {
        if (!els.canvas || !els.invCanvas) return;
        const container = els.canvas.parentElement;
        if (!container) return;

        const w = container.clientWidth;
        const h = container.clientHeight;

        // Main canvas: square, fitting container minus inventory height
        const invH = 80;
        const availH = h - invH - 16;
        const side = Math.min(w, availH);

        els.canvas.width = side;
        els.canvas.height = side;
        els.invCanvas.width = w;
        els.invCanvas.height = invH;
    }

    // ==================== Rendering ====================
    // Standalone renderer — does NOT share with GameGraphics

    const SCHEME = {
        bg: '#121212',
        black: '#333333',
        white: '#cccccc',
        border: '#666666'
    };

    function hexToPixel(q, r, size, cx, cy) {
        const x = size * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r) + cx;
        const y = size * (3 / 2 * r) + cy;
        return [x, y];
    }

    function drawHex(ctx, x, y, size, strokeColor) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 3 * i + Math.PI / 6;
            const hx = x + size * Math.cos(angle);
            const hy = y + size * Math.sin(angle);
            if (i === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    function drawTile(ctx, x, y, color, size) {
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 3 * i + Math.PI / 6;
            const hx = x + size * Math.cos(angle);
            const hy = y + size * Math.sin(angle);
            if (i === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.fillStyle = SCHEME[color] || '#555';
        ctx.shadowColor = '#000a';
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#888';
        ctx.stroke();
        ctx.restore();
    }

    function drawPiece(ctx, x, y, piece, size) {
        if (!piece) return;
        ctx.save();
        if (piece.type === 'disc') {
            ctx.beginPath();
            ctx.arc(x, y, size * 0.45, 0, 2 * Math.PI);
            ctx.fillStyle = piece.color === 'black' ? '#000' : '#fff';
            ctx.shadowColor = '#000a';
            ctx.shadowBlur = 3;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = piece.color === 'black' ? '#888' : '#bbb';
            ctx.stroke();
        } else if (piece.type === 'ring') {
            ctx.beginPath();
            ctx.arc(x, y, size * 0.45, 0, 2 * Math.PI);
            ctx.lineWidth = 5;
            ctx.strokeStyle = piece.color === 'black' ? '#000' : '#fff';
            ctx.shadowColor = '#000a';
            ctx.shadowBlur = 3;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x, y, size * 0.32, 0, 2 * Math.PI);
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#bbb';
            ctx.shadowBlur = 0;
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawState(state) {
        if (!state || !els.canvas) return;
        const ctx = els.canvas.getContext('2d');
        const invCtx = els.invCanvas?.getContext('2d');

        const w = els.canvas.width;
        const h = els.canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        // Calculate hex size to fit board
        const hexSize = Math.min(w, h) / (BOARD_RADIUS * 2 + 2) / Math.sqrt(3) * 1.1;

        // Clear
        ctx.fillStyle = SCHEME.bg;
        ctx.fillRect(0, 0, w, h);

        const tiles = state.tiles || {};
        const pieces = state.pieces || {};

        // Draw tiles and pieces
        for (let q = -BOARD_RADIUS; q <= BOARD_RADIUS; q++) {
            for (let r = Math.max(-BOARD_RADIUS, -q - BOARD_RADIUS); r <= Math.min(BOARD_RADIUS, -q + BOARD_RADIUS); r++) {
                const key = `${q},${r}`;
                const [x, y] = hexToPixel(q, r, hexSize, cx, cy);

                if (tiles[key]) {
                    drawTile(ctx, x, y, tiles[key], hexSize);
                    if (pieces[key]) {
                        drawPiece(ctx, x, y, pieces[key], hexSize);
                    }
                }
            }
        }

        // Draw inventory
        if (invCtx && els.invCanvas) {
            drawInventory(invCtx, els.invCanvas, state);
        }
    }

    function drawInventory(invCtx, invCanvas, state) {
        invCtx.clearRect(0, 0, invCanvas.width, invCanvas.height);
        const inv = state.inventory || {};
        const cap = state.captured || {};
        const cw = invCanvas.width;
        const itemSize = 12;
        const gap = 28;

        drawPlayerInventory(invCtx, 10, 10, 'black', inv, cap, itemSize, gap);
        drawPlayerInventory(invCtx, cw - 130, 10, 'white', inv, cap, itemSize, gap);
    }

    function drawPlayerInventory(ctx, boxX, boxY, player, inv, cap, itemSize, gap) {
        const pInv = inv[player] || {};
        const tiles = pInv.tiles || 0;
        const discs = pInv.discs || 0;
        const rings = pInv.rings || 0;

        // Captured pieces (opponent's)
        const capDiscs = player === 'black' ? (cap.black_discs || 0) : (cap.white_discs || 0);
        const capRings = player === 'black' ? (cap.black_rings || 0) : (cap.white_rings || 0);
        const oppColor = player === 'black' ? 'white' : 'black';

        const items = [];
        for (let i = 0; i < tiles; i++) items.push({ type: 'tile', color: player });
        for (let i = 0; i < discs; i++) items.push({ type: 'disc', color: player });
        for (let i = 0; i < rings; i++) items.push({ type: 'ring', color: player });
        const ownCount = items.length;
        for (let i = 0; i < capDiscs; i++) items.push({ type: 'disc', color: oppColor });
        for (let i = 0; i < capRings; i++) items.push({ type: 'ring', color: oppColor });

        const cols = 4;
        const startX = boxX + 10;
        const startY = boxY + 6;

        items.forEach((item, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = startX + col * gap;
            const y = startY + row * gap;

            ctx.save();
            if (item.type === 'tile') {
                ctx.beginPath();
                for (let j = 0; j < 6; j++) {
                    const angle = Math.PI / 3 * j + Math.PI / 6;
                    const hx = x + itemSize * Math.cos(angle);
                    const hy = y + itemSize * Math.sin(angle);
                    if (j === 0) ctx.moveTo(hx, hy);
                    else ctx.lineTo(hx, hy);
                }
                ctx.closePath();
                ctx.fillStyle = SCHEME[item.color] || '#555';
                ctx.fill();
                ctx.lineWidth = 1;
                ctx.strokeStyle = '#888';
                ctx.stroke();
            } else if (item.type === 'disc') {
                ctx.beginPath();
                ctx.arc(x, y, itemSize * 0.45, 0, 2 * Math.PI);
                ctx.fillStyle = item.color === 'black' ? '#000' : '#fff';
                ctx.fill();
                ctx.lineWidth = 1;
                ctx.strokeStyle = item.color === 'black' ? '#888' : '#bbb';
                ctx.stroke();
            } else if (item.type === 'ring') {
                ctx.beginPath();
                ctx.arc(x, y, itemSize * 0.45, 0, 2 * Math.PI);
                ctx.lineWidth = 4;
                ctx.strokeStyle = item.color === 'black' ? '#000' : '#fff';
                ctx.stroke();
            }
            ctx.restore();

            // Draw separator between own and captured
            if (i === ownCount - 1 && items.length > ownCount) {
                const sepY = startY + (Math.floor(ownCount / cols) + (ownCount % cols > 0 ? 0 : -1)) * gap + gap * 0.65;
                ctx.save();
                ctx.strokeStyle = '#999';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(boxX + 4, sepY);
                ctx.lineTo(boxX + 120, sepY);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }
        });

        // Player label
        ctx.save();
        ctx.fillStyle = '#aaa';
        ctx.font = '10px sans-serif';
        ctx.fillText(player === 'black' ? '● Black' : '○ White', boxX, boxY - 2);
        ctx.restore();
    }

    // ==================== Resize handling ====================
    window.addEventListener('resize', () => {
        if (els.viewer && els.viewer.style.display !== 'none') {
            sizeCanvases();
            if (stateHistory[currentIndex]) drawState(stateHistory[currentIndex]);
        }
    });

    // ==================== Exports ====================
    window.GameReplay = {
        init,
        openReplay,
        closeReplay
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

// TODO: Implémenter Phase 4
