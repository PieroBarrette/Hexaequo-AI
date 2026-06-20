/**
 * profile.js - User Profile Page (Phase 4)
 * 
 * Manages profile view: user info display, online
 * preferences, and tabs (Game History / Stats).
 * 
 * Dependencies:
 * - window.GameLobby (authenticatedFetch, getUser)
 * - window.GameHistory (loadGames)
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
    let currentTab = 'history';
    let preferencesLoaded = false;

    // ==================== DOM Cache ====================
    const els = {};

    function cacheElements() {
        els.view = document.getElementById('profileView');
        els.backBtn = document.getElementById('profileBackBtn');
        els.avatar = document.getElementById('profileAvatar');
        els.pseudo = document.getElementById('profilePseudo');
        els.elo = document.getElementById('profileElo');
        els.memberSince = document.getElementById('profileMemberSince');
        els.prefEloMin = document.getElementById('prefEloMin');
        els.prefEloMax = document.getElementById('prefEloMax');
        els.prefFriendly = document.getElementById('prefFriendlyGames');
        els.saveBtn = document.getElementById('prefSaveBtn');
        els.saveStatus = document.getElementById('prefSaveStatus');
        els.tabContent = document.getElementById('profileTabContent');
        els.statsPlaceholder = document.getElementById('profileStatsPlaceholder');
        els.tabs = document.querySelectorAll('.profile-tab');
    }

    // ==================== Initialization ====================
    function init() {
        cacheElements();
        setupEventListeners();
        console.log('[Profile] Initialized');
    }

    function setupEventListeners() {
        els.backBtn?.addEventListener('click', () => {
            // Use Router navigation to go back
            if (window.Router) {
                window.Router.navigate('#/');
            } else {
                closeProfile();
            }
        });

        els.saveBtn?.addEventListener('click', savePreferences);

        els.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                if (tabName) showTab(tabName);
            });
        });
    }

    // ==================== Profile Open / Close ====================
    function openProfile() {
        if (!els.view) return;
        els.view.style.display = 'flex';
        // Navigate to profile route if not already there
        if (window.Router && !window.Router.is('/profile')) {
            window.Router.navigate('#/profile');
            return; // Route handler will call openProfile again
        }
        loadUserInfo();
        loadPreferences();
        showTab('history');
    }

    /**
     * Open profile view without triggering navigation (called by route handler).
     */
    function openProfileDirect() {
        if (!els.view) return;
        els.view.style.display = 'flex';
        loadUserInfo();
        loadPreferences();
        showTab('history');
    }

    function closeProfile() {
        if (els.view) els.view.style.display = 'none';
    }

    // ==================== User Info ====================
    function loadUserInfo() {
        const user = window.GameLobby?.getUser?.();
        if (!user) return;

        const displayName = user.pseudo || user.username || '—';

        if (els.avatar) els.avatar.textContent = displayName.charAt(0).toUpperCase();
        if (els.pseudo) els.pseudo.textContent = displayName;
        if (els.elo) els.elo.textContent = `ELO: ${user.elo || 1000}`;

        if (els.memberSince && user.created_at) {
            const date = new Date(user.created_at);
            const formatted = date.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
            const label = typeof i18nT === 'function' ? i18nT('profile.memberSince') : 'Member since';
            els.memberSince.textContent = `${label} ${formatted}`;
        }
    }

    // ==================== Preferences ====================
    async function loadPreferences() {
        if (preferencesLoaded) return;
        const authFetch = window.GameLobby?.authenticatedFetch;
        if (!authFetch) return;

        try {
            const response = await authFetch(`${API_BASE}/users/me/preferences`);
            if (!response.ok) return;
            const result = await response.json();
            const prefs = result.data || {};

            if (els.prefEloMin) els.prefEloMin.value = prefs.elo_range_min ?? -200;
            if (els.prefEloMax) els.prefEloMax.value = prefs.elo_range_max ?? 200;
            if (els.prefFriendly) els.prefFriendly.checked = prefs.allow_friendly_games !== false;

            preferencesLoaded = true;
        } catch (err) {
            console.error('[Profile] Failed to load preferences:', err);
        }
    }

    async function savePreferences() {
        const authFetch = window.GameLobby?.authenticatedFetch;
        if (!authFetch) return;

        const body = {
            elo_range_min: parseInt(els.prefEloMin?.value, 10) || -200,
            elo_range_max: parseInt(els.prefEloMax?.value, 10) || 200,
            allow_friendly_games: els.prefFriendly?.checked !== false
        };

        try {
            els.saveBtn.disabled = true;
            const response = await authFetch(`${API_BASE}/users/me/preferences`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (response.ok) {
                showSaveStatus(typeof i18nT === 'function' ? i18nT('profile.saved') : 'Saved!', '#4caf50');
            } else {
                showSaveStatus(typeof i18nT === 'function' ? i18nT('profile.saveError') : 'Error', '#f44336');
            }
        } catch (err) {
            console.error('[Profile] Failed to save preferences:', err);
            showSaveStatus('Error', '#f44336');
        } finally {
            els.saveBtn.disabled = false;
        }
    }

    function showSaveStatus(text, color) {
        if (!els.saveStatus) return;
        els.saveStatus.textContent = text;
        els.saveStatus.style.color = color;
        setTimeout(() => {
            if (els.saveStatus) els.saveStatus.textContent = '';
        }, 3000);
    }

    // ==================== Tabs ====================
    function showTab(tabName) {
        currentTab = tabName;

        // Update tab buttons
        els.tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        if (tabName === 'history') {
            if (els.statsPlaceholder) els.statsPlaceholder.style.display = 'none';
            loadHistory();
        } else if (tabName === 'stats') {
            if (els.statsPlaceholder) els.statsPlaceholder.style.display = 'block';
            // Clear history content
            const list = els.tabContent?.querySelector('.game-history-list');
            if (list) list.remove();
            const loadMoreBtn = els.tabContent?.querySelector('.game-history-load-more');
            if (loadMoreBtn) loadMoreBtn.remove();
        }
    }

    function loadHistory() {
        const user = window.GameLobby?.getUser?.();
        if (!user) return;
        if (window.GameHistory?.loadGames) {
            window.GameHistory.loadGames(user.id, 1, els.tabContent);
        }
    }

    // ==================== Public API ====================
    window.GameProfile = {
        init,
        openProfile,
        openProfileDirect,
        closeProfile
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
