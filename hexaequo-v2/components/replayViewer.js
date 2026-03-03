/**
 * replayViewer.js - Game Replay Viewer (Phase 4 - Rewritten)
 * 
 * Thin controller that delegates rendering to the main GameGraphics engine.
 * Manages replay navigation (prev/next/slider) and calls game.js
 * enterReplayMode / loadReplayState / exitReplayMode.
 * 
 * Dependencies:
 * - API: GET /api/games/:id/replay
 * - window.GameLobby (authenticatedFetch)
 * - window.enterReplayMode, window.loadReplayState, window.exitReplayMode (game.js)
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

    // ==================== State ====================
    let stateHistory = [];   // Array of {gameState, moveType, timeRemainingBlack, timeRemainingWhite}
    let currentIndex = 0;
    let replayData = null;   // Full replay response from API
    let isOpen = false;
    let profileWasOpen = false; // Track if profile was open before replay

    // ==================== DOM Cache ====================
    const els = {};

    function cacheElements() {
        els.controls = document.getElementById('replayControls');
        els.closeBtn = document.getElementById('replayCloseBtn');
        els.progress = document.getElementById('replayProgress');
        els.moveInfo = document.getElementById('replayMoveInfo');
        els.prevBtn = document.getElementById('replayPrev');
        els.nextBtn = document.getElementById('replayNext');
        els.resultBadge = document.getElementById('replayResultBadge');
    }

    // ==================== Initialization ====================
    function init() {
        cacheElements();
        setupEventListeners();
        console.log('[ReplayViewer] Initialized');
    }

    function setupEventListeners() {
        els.closeBtn?.addEventListener('click', closeReplay);
        els.prevBtn?.addEventListener('click', prevMove);
        els.nextBtn?.addEventListener('click', nextMove);
        els.progress?.addEventListener('input', onProgressChange);

        document.addEventListener('keydown', onKeyDown);
    }

    function onKeyDown(e) {
        if (!isOpen) return;
        switch(e.key) {
            case 'ArrowLeft':  prevMove(); e.preventDefault(); break;
            case 'ArrowRight': nextMove(); e.preventDefault(); break;
            case 'Escape':     closeReplay(); e.preventDefault(); break;
        }
    }

    // ==================== Open / Close ====================
    async function openReplay(gameId) {
        // Navigate to replay route (route handler will call openReplayDirect)
        if (window.Router && !window.Router.is('/replay/:id')) {
            window.Router.navigate('#/replay/' + gameId);
            return;
        }
        await openReplayDirect(gameId);
    }

    async function openReplayDirect(gameId) {
        stateHistory = [];
        currentIndex = 0;
        replayData = null;

        // Check if profile view is currently open
        const profileView = document.getElementById('profileView');
        profileWasOpen = profileView && profileView.style.display !== 'none';

        // Hide profile view if open
        if (profileWasOpen && profileView) {
            profileView.style.display = 'none';
        }

        try {
            const fetchFn = window.GameLobby?.authenticatedFetch || window.fetch.bind(window);

            const response = await fetchFn(`${API_BASE}/games/${gameId}/replay`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const result = await response.json();
            replayData = result.data;

            if (!replayData) throw new Error('No replay data');

            // Build state history with time data
            if (replayData.stateHistory && replayData.stateHistory.length > 0) {
                stateHistory = replayData.stateHistory.map(entry => ({
                    gameState: entry.gameState || entry,
                    moveType: entry.moveType,
                    timeRemainingBlack: entry.timeRemainingBlack ?? null,
                    timeRemainingWhite: entry.timeRemainingWhite ?? null
                }));
            } else {
                showError();
                return;
            }

            if (stateHistory.length === 0) {
                showError();
                return;
            }

            // Enter replay mode in game.js (hides lobby, shows game canvas, sets up toolbar)
            if (window.enterReplayMode) {
                window.enterReplayMode(replayData);
            }

            isOpen = true;

            // Show replay controls bar
            if (els.controls) {
                els.controls.style.display = 'flex';
            }

            // Setup progress bar
            els.progress.min = 0;
            els.progress.max = stateHistory.length - 1;
            els.progress.value = 0;

            // Show result badge
            updateResultBadge();

            // Load initial state (no animation, no previous state)
            goToMove(0);

        } catch (err) {
            console.error('[ReplayViewer] Failed to load replay:', err);
            showError();
        }
    }

    function closeReplay() {
        isOpen = false;

        // Hide replay controls
        if (els.controls) {
            els.controls.style.display = 'none';
        }

        // Exit replay mode in game.js (restores lobby)
        if (window.exitReplayMode) {
            window.exitReplayMode();
        }

        // Re-show profile view if it was open before
        if (profileWasOpen) {
            profileWasOpen = false;
            // Navigate to profile route
            if (window.Router) {
                window.Router.navigate('#/profile');
            } else {
                const profileView = document.getElementById('profileView');
                if (profileView) profileView.style.display = 'flex';
            }
        } else {
            // Navigate back to main menu
            if (window.Router) {
                window.Router.navigate('#/');
            }
        }

        stateHistory = [];
        replayData = null;
    }

    function showError() {
        // Restore profile if replay fails
        if (profileWasOpen) {
            const profileView = document.getElementById('profileView');
            if (profileView) profileView.style.display = 'flex';
            profileWasOpen = false;
        }
        console.error('[ReplayViewer] No replay data available');
    }

    // ==================== Result Badge ====================
    function updateResultBadge() {
        if (!els.resultBadge || !replayData?.result) return;
        const r = replayData.result;
        const players = replayData.players;

        if (r.winner === 'draw') {
            els.resultBadge.textContent = typeof i18nT === 'function' ? i18nT('gameHistory.exAequo') : 'Ex Aequo';
            els.resultBadge.className = 'replay-result-badge replay-result-draw';
        } else {
            const winnerPseudo = r.winner === 'black' 
                ? (players.black?.pseudo || '?') 
                : (players.white?.pseudo || '?');
            const winsLabel = typeof i18nT === 'function' ? i18nT('replay.wins') : 'wins';
            els.resultBadge.textContent = `${winnerPseudo} ${winsLabel}`;
            els.resultBadge.className = 'replay-result-badge replay-result-win';
        }
    }

    // ==================== Navigation ====================
    function goToMove(index) {
        if (index < 0 || index >= stateHistory.length) return;

        const entry = stateHistory[index];
        const prevEntry = index > 0 ? stateHistory[index - 1] : null;

        currentIndex = index;
        els.progress.value = index;

        // Load state into game renderer
        if (window.loadReplayState) {
            window.loadReplayState(
                entry.gameState,
                prevEntry?.gameState || null,
                {
                    timeRemainingBlack: entry.timeRemainingBlack,
                    timeRemainingWhite: entry.timeRemainingWhite
                },
                index,
                stateHistory.length
            );
        }

        updateMoveInfo();
        updateButtons();
    }

    function nextMove() {
        if (currentIndex < stateHistory.length - 1) goToMove(currentIndex + 1);
    }

    function prevMove() {
        if (currentIndex > 0) goToMove(currentIndex - 1);
    }

    function onProgressChange() {
        goToMove(parseInt(els.progress.value, 10));
    }

    function updateButtons() {
        const atStart = currentIndex <= 0;
        const atEnd = currentIndex >= stateHistory.length - 1;
        if (els.prevBtn) els.prevBtn.disabled = atStart;
        if (els.nextBtn) els.nextBtn.disabled = atEnd;
    }

    function updateMoveInfo() {
        if (!els.moveInfo) return;
        const total = stateHistory.length;
        const moveLabel = typeof i18nT === 'function' ? i18nT('replay.move') : 'Move';
        const state = stateHistory[currentIndex]?.gameState;
        const playerLabel = state?.activePlayer === 'black' ? '\u25cf' : '\u25cb';
        els.moveInfo.textContent = `${moveLabel} ${currentIndex + 1} / ${total}  ${playerLabel}`;
    }

    // ==================== Exports ====================
    window.GameReplay = {
        init,
        openReplay,
        openReplayDirect,
        closeReplay
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
