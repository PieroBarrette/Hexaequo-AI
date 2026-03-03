/**
 * gameHistory.js - Game History List (Phase 4)
 * 
 * Renders paginated, filterable list of played games inside the profile tab.
 * Each row shows time mode, opponent, result, ELO change, date.
 * Click on a game → opens Replay Viewer.
 * 
 * Features:
 * - Result filter checkboxes (Win / Loss / Ex Aequo)
 * - Time mode dropdown
 * - Opponent name search (debounced)
 * - Date preset buttons (All time / 7 days / 30 days / 3 months)
 * - Numbered page navigation with selectable page size (10 / 25 / 50)
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
    const DEFAULT_PAGE_SIZE = 25;
    const SEARCH_DEBOUNCE_MS = 300;
    const MAX_VISIBLE_PAGES = 5;

    // ==================== State ====================
    let currentPage = 1;
    let totalPages = 1;
    let totalItems = 0;
    let pageSize = DEFAULT_PAGE_SIZE;
    let currentUserId = null;
    let containerEl = null;
    let searchDebounceTimer = null;

    // Filter state
    let filters = {
        result: ['win', 'loss', 'draw'], // all checked by default
        timeMode: '',       // '' = all
        opponentName: '',
        datePeriod: 'all'   // 'all', '7d', '30d', '3m'
    };

    // ==================== Time Mode Icons ====================
    const TIME_MODE_ICONS = {
        bullet: '⚡',
        blitz: '🔥',
        rapid: '⏱️',
        classic: '♟️',
        none: '🤝'
    };

    // ==================== Localization Helpers ====================
    function t(key, fallback) {
        return typeof i18nT === 'function' ? i18nT(key) : fallback;
    }

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
        currentPage = page || 1;

        // Build full UI on first call
        if (!container.querySelector('.gh-wrapper')) {
            container.innerHTML = '';
            buildUI(container);
        }

        await fetchAndRender();
    }

    // ==================== UI Construction ====================
    function buildUI(container) {
        const wrapper = document.createElement('div');
        wrapper.className = 'gh-wrapper';

        // Filter bar
        wrapper.appendChild(buildFilterBar());

        // List container
        const listEl = document.createElement('div');
        listEl.className = 'game-history-list';
        listEl.id = 'ghList';
        wrapper.appendChild(listEl);

        // Pagination bar
        wrapper.appendChild(buildPaginationBar());

        container.appendChild(wrapper);
    }

    function buildFilterBar() {
        const bar = document.createElement('div');
        bar.className = 'gh-filter-bar';

        // Row 1: Result checkboxes + Time mode dropdown
        const row1 = document.createElement('div');
        row1.className = 'gh-filter-row';

        // Result checkboxes
        const resultGroup = document.createElement('div');
        resultGroup.className = 'gh-filter-group gh-result-filters';

        const resultLabel = document.createElement('span');
        resultLabel.className = 'gh-filter-label';
        resultLabel.textContent = t('gameHistory.filterResult', 'Result');
        resultGroup.appendChild(resultLabel);

        ['win', 'loss', 'draw'].forEach(val => {
            const label = document.createElement('label');
            label.className = `gh-checkbox-label gh-cb-${val}`;
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = true;
            cb.value = val;
            cb.addEventListener('change', () => {
                updateResultFilter();
                resetAndFetch();
            });
            const span = document.createElement('span');
            if (val === 'win') span.textContent = t('gameHistory.win', 'Win');
            else if (val === 'loss') span.textContent = t('gameHistory.loss', 'Loss');
            else span.textContent = t('gameHistory.exAequo', 'Ex Aequo');
            label.appendChild(cb);
            label.appendChild(span);
            resultGroup.appendChild(label);
        });

        row1.appendChild(resultGroup);

        // Time mode dropdown
        const tmGroup = document.createElement('div');
        tmGroup.className = 'gh-filter-group';
        const tmSelect = document.createElement('select');
        tmSelect.className = 'gh-time-mode-select';
        tmSelect.id = 'ghTimeModeSelect';
        const modes = [
            { value: '', label: t('gameHistory.allModes', 'All') },
            { value: 'bullet', label: '⚡ Bullet' },
            { value: 'blitz', label: '🔥 Blitz' },
            { value: 'rapid', label: '⏱️ Rapid' },
            { value: 'classic', label: '♟️ Classic' },
            { value: 'none', label: '🤝 Friendly' }
        ];
        modes.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.value;
            opt.textContent = m.label;
            tmSelect.appendChild(opt);
        });
        tmSelect.addEventListener('change', () => {
            filters.timeMode = tmSelect.value;
            resetAndFetch();
        });
        tmGroup.appendChild(tmSelect);
        row1.appendChild(tmGroup);

        bar.appendChild(row1);

        // Row 2: Opponent search + Date presets
        const row2 = document.createElement('div');
        row2.className = 'gh-filter-row';

        // Opponent search
        const searchGroup = document.createElement('div');
        searchGroup.className = 'gh-filter-group gh-search-group';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'gh-opponent-search';
        searchInput.id = 'ghOpponentSearch';
        searchInput.placeholder = t('gameHistory.searchOpponent', 'Search opponent...');
        searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                filters.opponentName = searchInput.value.trim();
                resetAndFetch();
            }, SEARCH_DEBOUNCE_MS);
        });
        searchGroup.appendChild(searchInput);
        row2.appendChild(searchGroup);

        // Date presets
        const dateGroup = document.createElement('div');
        dateGroup.className = 'gh-filter-group gh-date-filters';
        const presets = [
            { value: 'all', label: t('gameHistory.allTime', 'All time') },
            { value: '7d', label: t('gameHistory.last7days', '7 days') },
            { value: '30d', label: t('gameHistory.last30days', '30 days') },
            { value: '3m', label: t('gameHistory.last3months', '3 months') }
        ];
        presets.forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'gh-date-btn' + (p.value === 'all' ? ' active' : '');
            btn.dataset.period = p.value;
            btn.textContent = p.label;
            btn.addEventListener('click', () => {
                dateGroup.querySelectorAll('.gh-date-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                filters.datePeriod = p.value;
                resetAndFetch();
            });
            dateGroup.appendChild(btn);
        });
        row2.appendChild(dateGroup);

        bar.appendChild(row2);

        return bar;
    }

    function buildPaginationBar() {
        const bar = document.createElement('div');
        bar.className = 'gh-pagination-bar';
        bar.id = 'ghPaginationBar';

        // Info text: "Showing X-Y of Z"
        const info = document.createElement('span');
        info.className = 'gh-pagination-info';
        info.id = 'ghPaginationInfo';
        bar.appendChild(info);

        // Page buttons container
        const pages = document.createElement('div');
        pages.className = 'gh-page-buttons';
        pages.id = 'ghPageButtons';
        bar.appendChild(pages);

        // Page size selector
        const sizeGroup = document.createElement('div');
        sizeGroup.className = 'gh-page-size';
        const sizeSelect = document.createElement('select');
        sizeSelect.className = 'gh-page-size-select';
        sizeSelect.id = 'ghPageSizeSelect';
        [10, 25, 50].forEach(n => {
            const opt = document.createElement('option');
            opt.value = n;
            opt.textContent = n;
            if (n === pageSize) opt.selected = true;
            sizeSelect.appendChild(opt);
        });
        sizeSelect.addEventListener('change', () => {
            pageSize = parseInt(sizeSelect.value, 10);
            resetAndFetch();
        });
        const sizeLabel = document.createElement('span');
        sizeLabel.className = 'gh-page-size-label';
        sizeLabel.textContent = t('gameHistory.perPage', 'per page');
        sizeGroup.appendChild(sizeSelect);
        sizeGroup.appendChild(sizeLabel);
        bar.appendChild(sizeGroup);

        return bar;
    }

    // ==================== Filter Helpers ====================
    function updateResultFilter() {
        const checkboxes = containerEl.querySelectorAll('.gh-result-filters input[type="checkbox"]');
        filters.result = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
    }

    function getDateRange() {
        const now = new Date();
        switch (filters.datePeriod) {
            case '7d': {
                const from = new Date(now);
                from.setDate(from.getDate() - 7);
                return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
            }
            case '30d': {
                const from = new Date(now);
                from.setDate(from.getDate() - 30);
                return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
            }
            case '3m': {
                const from = new Date(now);
                from.setMonth(from.getMonth() - 3);
                return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
            }
            default:
                return {};
        }
    }

    function resetAndFetch() {
        currentPage = 1;
        fetchAndRender();
    }

    // ==================== Data Fetching ====================
    async function fetchAndRender() {
        const listEl = containerEl.querySelector('#ghList');
        if (!listEl) return;

        // Show loading
        listEl.innerHTML = '';
        const loadingEl = document.createElement('div');
        loadingEl.className = 'game-history-loading';
        loadingEl.textContent = t('gameHistory.loading', 'Loading...');
        listEl.appendChild(loadingEl);

        try {
            const authFetch = window.GameLobby?.authenticatedFetch;
            if (!authFetch) throw new Error('Not authenticated');

            // Build query string
            const params = new URLSearchParams();
            params.set('page', currentPage);
            params.set('limit', pageSize);

            if (filters.result.length > 0 && filters.result.length < 3) {
                params.set('result', filters.result.join(','));
            }
            if (filters.timeMode) {
                params.set('timeMode', filters.timeMode);
            }
            if (filters.opponentName) {
                params.set('opponentName', filters.opponentName);
            }
            const dateRange = getDateRange();
            if (dateRange.dateFrom) params.set('dateFrom', dateRange.dateFrom);
            if (dateRange.dateTo) params.set('dateTo', dateRange.dateTo);

            const response = await authFetch(`${API_BASE}/users/${currentUserId}/matches?${params.toString()}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const result = await response.json();
            const matches = result.data || [];
            const meta = result.meta || {};
            totalPages = meta.totalPages || 1;
            totalItems = meta.total || 0;

            // Remove loading
            listEl.innerHTML = '';

            if (matches.length === 0) {
                const emptyEl = document.createElement('div');
                emptyEl.className = 'game-history-empty';
                emptyEl.textContent = t('gameHistory.noGames', 'No games played yet.');
                listEl.appendChild(emptyEl);
            } else {
                matches.forEach(match => {
                    listEl.appendChild(createMatchItem(match));
                });
            }

            // Update pagination
            updatePagination();

        } catch (err) {
            console.error('[GameHistory] Failed to load games:', err);
            listEl.innerHTML = '';
            const errEl = document.createElement('div');
            errEl.className = 'game-history-empty';
            errEl.textContent = t('gameHistory.error', 'Failed to load games.');
            listEl.appendChild(errEl);
            updatePagination();
        }
    }

    // ==================== Pagination ====================
    function updatePagination() {
        const infoEl = containerEl.querySelector('#ghPaginationInfo');
        const buttonsEl = containerEl.querySelector('#ghPageButtons');
        const barEl = containerEl.querySelector('#ghPaginationBar');

        if (!infoEl || !buttonsEl || !barEl) return;

        // Hide pagination if no results
        if (totalItems === 0) {
            barEl.style.display = 'none';
            return;
        }
        barEl.style.display = '';

        // Info text
        const start = (currentPage - 1) * pageSize + 1;
        const end = Math.min(currentPage * pageSize, totalItems);
        const showingText = t('gameHistory.showing', 'Showing {0}-{1} of {2}')
            .replace('{0}', start)
            .replace('{1}', end)
            .replace('{2}', totalItems);
        infoEl.textContent = showingText;

        // Page buttons
        buttonsEl.innerHTML = '';

        // Previous button
        const prevBtn = document.createElement('button');
        prevBtn.className = 'gh-page-btn';
        prevBtn.textContent = '‹';
        prevBtn.disabled = currentPage <= 1;
        prevBtn.addEventListener('click', () => goToPage(currentPage - 1));
        buttonsEl.appendChild(prevBtn);

        // Calculate visible page range
        const pages = getVisiblePages(currentPage, totalPages, MAX_VISIBLE_PAGES);
        pages.forEach(p => {
            if (p === '...') {
                const ellipsis = document.createElement('span');
                ellipsis.className = 'gh-page-ellipsis';
                ellipsis.textContent = '…';
                buttonsEl.appendChild(ellipsis);
            } else {
                const btn = document.createElement('button');
                btn.className = 'gh-page-btn' + (p === currentPage ? ' active' : '');
                btn.textContent = p;
                btn.addEventListener('click', () => goToPage(p));
                buttonsEl.appendChild(btn);
            }
        });

        // Next button
        const nextBtn = document.createElement('button');
        nextBtn.className = 'gh-page-btn';
        nextBtn.textContent = '›';
        nextBtn.disabled = currentPage >= totalPages;
        nextBtn.addEventListener('click', () => goToPage(currentPage + 1));
        buttonsEl.appendChild(nextBtn);
    }

    function getVisiblePages(current, total, maxVisible) {
        if (total <= maxVisible) {
            return Array.from({ length: total }, (_, i) => i + 1);
        }

        const pages = [];
        const half = Math.floor(maxVisible / 2);
        let start = Math.max(1, current - half);
        let end = Math.min(total, start + maxVisible - 1);

        if (end - start < maxVisible - 1) {
            start = Math.max(1, end - maxVisible + 1);
        }

        if (start > 1) {
            pages.push(1);
            if (start > 2) pages.push('...');
        }

        for (let i = start; i <= end; i++) {
            pages.push(i);
        }

        if (end < total) {
            if (end < total - 1) pages.push('...');
            pages.push(total);
        }

        return pages;
    }

    function goToPage(page) {
        if (page < 1 || page > totalPages || page === currentPage) return;
        currentPage = page;
        fetchAndRender();
    }

    // ==================== Rendering ====================
    function createMatchItem(match) {
        const item = document.createElement('div');
        item.className = 'game-history-item';
        item.addEventListener('click', () => {
            if (window.Router) {
                window.Router.navigate('#/replay/' + match.id);
            } else if (window.GameReplay?.openReplay) {
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
        const oppLabel = t('gameHistory.vs', 'vs');
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
            badge.textContent = t('gameHistory.win', 'Win');
        } else if (match.result === 'loss') {
            badge.classList.add('loss');
            badge.textContent = t('gameHistory.loss', 'Loss');
        } else {
            badge.classList.add('draw');
            badge.textContent = t('gameHistory.exAequo', 'Ex Aequo');
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
