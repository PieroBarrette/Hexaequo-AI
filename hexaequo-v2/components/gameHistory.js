/**
 * gameHistory.js - Game History List (Phase 4)
 * 
 * Renders paginated list of played games inside the profile tab.
 * Each row shows time mode, opponent, result, ELO change, date.
 * Click on a game → opens Replay Viewer.
 * 
 * Dependencies:
 * - window.GameLobby (authenticatedFetch)
 * - window.GameReplay (openReplay)
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
    const PAGE_SIZE = 20;

    // ==================== State ====================
    let currentPage = 0;
    let totalPages = 1;
    let currentUserId = null;
    let containerEl = null;
    let listEl = null;
    let loadMoreBtn = null;

    // ==================== Time Mode Icons ====================
    const TIME_MODE_ICONS = {
        bullet: '⚡',
        blitz: '🔥',
        rapid: '⏱️',
        classic: '♟️',
        none: '🤝'
    };

    // ==================== Public API ====================
    /**
     * Load games into a container element.
     * @param {string} userId 
     * @param {number} page 
     * @param {HTMLElement} container 
     */
    async function loadGames(userId, page, container) {
        if (!container) return;
        containerEl = container;
        currentUserId = userId;
        currentPage = page;

        // Clear existing history content if starting fresh (page 1)
        if (page === 1) {
            const existingList = container.querySelector('.game-history-list');
            if (existingList) existingList.remove();
            const existingBtn = container.querySelector('.game-history-load-more');
            if (existingBtn) existingBtn.remove();
            const existingEmpty = container.querySelector('.game-history-empty');
            if (existingEmpty) existingEmpty.remove();
            const existingLoading = container.querySelector('.game-history-loading');
            if (existingLoading) existingLoading.remove();
            listEl = null;
            loadMoreBtn = null;
        }

        // Show loading
        const loadingEl = document.createElement('div');
        loadingEl.className = 'game-history-loading';
        loadingEl.textContent = typeof i18nT === 'function' ? i18nT('gameHistory.loading') : 'Loading...';
        container.appendChild(loadingEl);

        try {
            const authFetch = window.GameLobby?.authenticatedFetch;
            if (!authFetch) throw new Error('Not authenticated');

            const response = await authFetch(`${API_BASE}/users/${userId}/matches?page=${page}&limit=${PAGE_SIZE}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const result = await response.json();
            const matches = result.data || [];
            const meta = result.meta || {};
            totalPages = meta.totalPages || 1;

            // Remove loading indicator
            loadingEl.remove();

            if (page === 1 && matches.length === 0) {
                const emptyEl = document.createElement('div');
                emptyEl.className = 'game-history-empty';
                emptyEl.textContent = typeof i18nT === 'function' ? i18nT('gameHistory.noGames') : 'No games played yet.';
                container.appendChild(emptyEl);
                return;
            }

            // Create list container if needed
            if (!listEl) {
                listEl = document.createElement('div');
                listEl.className = 'game-history-list';
                container.appendChild(listEl);
            }

            // Render matches
            matches.forEach(match => {
                listEl.appendChild(createMatchItem(match));
            });

            // Load more button
            if (loadMoreBtn) loadMoreBtn.remove();
            if (currentPage < totalPages) {
                loadMoreBtn = document.createElement('button');
                loadMoreBtn.className = 'game-history-load-more';
                loadMoreBtn.textContent = typeof i18nT === 'function' ? i18nT('gameHistory.loadMore') : 'Load more';
                loadMoreBtn.addEventListener('click', () => loadGames(currentUserId, currentPage + 1, containerEl));
                container.appendChild(loadMoreBtn);
            }
        } catch (err) {
            console.error('[GameHistory] Failed to load games:', err);
            loadingEl.textContent = typeof i18nT === 'function' ? i18nT('gameHistory.error') : 'Failed to load games.';
        }
    }

    // ==================== Rendering ====================
    function createMatchItem(match) {
        const item = document.createElement('div');
        item.className = 'game-history-item';
        item.addEventListener('click', () => {
            if (window.GameReplay?.openReplay) {
                window.GameReplay.openReplay(match.id);
            }
        });

        // Time mode icon
        const timeIcon = document.createElement('span');
        timeIcon.className = 'gh-time-mode';
        timeIcon.textContent = TIME_MODE_ICONS[match.time_mode] || '♟️';
        timeIcon.title = match.time_mode || '';

        // Details (opponent + date)
        const details = document.createElement('div');
        details.className = 'gh-details';

        const opponent = document.createElement('span');
        opponent.className = 'gh-opponent';
        const oppLabel = typeof i18nT === 'function' ? i18nT('gameHistory.vs') : 'vs';
        opponent.textContent = `${oppLabel} ${match.opponent_pseudo || '?'}`;
        if (match.opponent_elo) {
            opponent.textContent += ` (${match.opponent_elo})`;
        }

        const dateEl = document.createElement('span');
        dateEl.className = 'gh-date';
        if (match.finished_at) {
            const d = new Date(match.finished_at);
            dateEl.textContent = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        }

        details.appendChild(opponent);
        details.appendChild(dateEl);

        // Result section
        const resultSection = document.createElement('div');
        resultSection.className = 'gh-result-section';

        const badge = document.createElement('span');
        badge.className = 'gh-result-badge';
        if (match.result === 'win') {
            badge.classList.add('win');
            badge.textContent = typeof i18nT === 'function' ? i18nT('gameHistory.win') : 'Win';
        } else if (match.result === 'loss') {
            badge.classList.add('loss');
            badge.textContent = typeof i18nT === 'function' ? i18nT('gameHistory.loss') : 'Loss';
        } else {
            badge.classList.add('draw');
            badge.textContent = typeof i18nT === 'function' ? i18nT('gameHistory.draw') : 'Draw';
        }

        const eloChange = document.createElement('span');
        eloChange.className = 'gh-elo-change';
        const change = match.elo_change || 0;
        if (change > 0) {
            eloChange.classList.add('positive');
            eloChange.textContent = `+${change}`;
        } else if (change < 0) {
            eloChange.classList.add('negative');
            eloChange.textContent = `${change}`;
        } else {
            eloChange.classList.add('neutral');
            eloChange.textContent = '±0';
        }

        resultSection.appendChild(badge);
        resultSection.appendChild(eloChange);

        item.appendChild(timeIcon);
        item.appendChild(details);
        item.appendChild(resultSection);

        return item;
    }

    // ==================== Exports ====================
    window.GameHistory = {
        loadGames
    };
})();
