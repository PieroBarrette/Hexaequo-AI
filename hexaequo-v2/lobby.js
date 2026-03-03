/**
 * Hexaequo - Lobby Controller
 * 
 * Handles the main menu/lobby UI, game mode selection,
 * and online room creation/joining.
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
    let selectedDifficulty = 3;
    let selectedTimeControl = 'classic'; // Default time control for online games
    let socket = null;
    let isConnected = false;
    let currentRoomCode = null;
    let currentUser = null;
    let sessionToken = null;
    let refreshToken = null;
    let currentOpponent = null; // Stores opponent info for online games
    let pendingInviteAfterAuth = null; // Stores invite info while user is signing in
    
    // ==================== Session Storage Helpers ====================
    const SESSION_KEY = 'hexaequo_session';
    const REFRESH_KEY = 'hexaequo_refresh';
    const PERSIST_KEY = 'hexaequo_persistent';

    /**
     * Get the appropriate storage based on user's "keep me signed in" preference.
     * Falls back: checks localStorage first, then sessionStorage.
     */
    function getTokenStorage() {
        if (localStorage.getItem(PERSIST_KEY) === 'true') return localStorage;
        if (sessionStorage.getItem(SESSION_KEY)) return sessionStorage;
        if (localStorage.getItem(SESSION_KEY)) return localStorage;
        return sessionStorage;
    }

    function getStoredToken(key) {
        return localStorage.getItem(key) || sessionStorage.getItem(key);
    }

    function setSessionTokens(access, refresh, persistent) {
        const storage = persistent ? localStorage : sessionStorage;
        if (access) storage.setItem(SESSION_KEY, access);
        if (refresh) storage.setItem(REFRESH_KEY, refresh);
        // Always store preference in localStorage so we know where to look on next visit
        localStorage.setItem(PERSIST_KEY, persistent ? 'true' : 'false');
        // Clear the other storage to avoid stale tokens
        const other = persistent ? sessionStorage : localStorage;
        other.removeItem(SESSION_KEY);
        other.removeItem(REFRESH_KEY);
    }

    function clearSessionTokens() {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(REFRESH_KEY);
        localStorage.removeItem(PERSIST_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(REFRESH_KEY);
    }

    // ==================== Authenticated Fetch ====================
    /**
     * Wrapper around fetch that attaches auth headers and handles token refresh on 401.
     */
    async function authenticatedFetch(url, options = {}) {
        const headers = { ...options.headers };
        if (sessionToken) {
            headers['Authorization'] = `Bearer ${sessionToken}`;
        }

        let response = await fetch(url, { ...options, headers });

        // If 401 and we have a refresh token, attempt silent refresh
        if (response.status === 401 && refreshToken) {
            const refreshed = await refreshAccessToken();
            if (refreshed) {
                headers['Authorization'] = `Bearer ${sessionToken}`;
                response = await fetch(url, { ...options, headers });
            }
        }

        return response;
    }

    /**
     * Attempt to refresh the access token using the stored refresh token.
     * Returns true on success, false on failure.
     */
    async function refreshAccessToken() {
        if (!refreshToken) return false;

        try {
            const response = await fetch(`${API_BASE}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });

            if (response.ok) {
                const data = await response.json();
                sessionToken = data.data.accessToken;
                refreshToken = data.data.refreshToken;
                // Preserve the user's persistence preference
                const persistent = localStorage.getItem(PERSIST_KEY) === 'true';
                setSessionTokens(sessionToken, refreshToken, persistent);
                console.log('[Lobby] Token refreshed successfully');
                return true;
            }
        } catch (err) {
            console.error('[Lobby] Token refresh failed:', err);
        }

        // Refresh failed — clear session
        clearSessionTokens();
        sessionToken = null;
        refreshToken = null;
        currentUser = null;
        updateUserStatusUI();
        window.UserMenu?.updateDisplay?.();
        return false;
    }
    
    // Local game configuration
    let localGameConfig = {
        blackPlayer: 'human',  // 'human' or 'ai'
        blackAiLevel: 3,
        whitePlayer: 'human',  // 'human' or 'ai'
        whiteAiLevel: 3,
        timeControl: 'none'
    };

    // ==================== DOM Elements ====================
    const lobby = {
        overlay: null,
        // Main buttons
        playLocalBtn: null,
        playOnlineBtn: null,
        // Local config section
        localConfigSection: null,
        blackPlayerType: null,
        blackAiLevel: null,
        whitePlayerType: null,
        whiteAiLevel: null,
        localTimeControl: null,
        startLocalGameBtn: null,
        backFromLocalBtn: null,
        // Online section
        onlineOptions: null,
        connectionStatus: null,
        roomActions: null,
        createRoomBtn: null,
        roomCodeInput: null,
        joinRoomBtn: null,
        waitingSection: null,
        cancelBtn: null,
        backFromOnlineBtn: null,
        errorDisplay: null,
        // User status (in online section)
        userStatus: null,
        userDisplayName: null,
        loginBtn: null,
        // Auth section
        authSection: null,
        authTabs: null,
        loginForm: null,
        registerForm: null,
        loginUsername: null,
        loginPassword: null,
        registerUsername: null,
        registerPassword: null,
        authError: null,
        backFromAuthBtn: null,
        // Settings section
        settingsSection: null,
        backFromSettingsBtn: null,
        themeToggle: null,
        soundToggle: null,
        validMovesToggle: null,
        previousMoveToggle: null,
        // Footer
        rulesBtn: null,
        settingsBtn: null,
        // Main menu Rules button
        mainRulesBtn: null
    };

    // ==================== Initialization ====================
    
    /**
     * Detect system theme preference
     * Returns 'light' or 'dark'
     */
    function getSystemTheme() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            return 'light';
        }
        return 'dark';
    }
    
    /**
     * Apply theme to the page
     */
    function applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        
        // Update theme toggle if it exists
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.checked = theme === 'light';
        }
        
        // Update meta theme color
        const themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) {
            themeColor.content = theme === 'light' ? '#ffffff' : '#000000';
        }
    }
    
    /**
     * Hide the loading screen with fade animation
     */
    function hideLoadingScreen() {
        const loadingScreen = document.getElementById('loadingScreen');
        if (loadingScreen) {
            loadingScreen.classList.add('fade-out');
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 300);
        }
    }
    
    /**
     * Main initialization - handles async loading in correct order
     */
    async function init() {
        // Step 1: Apply theme immediately (localStorage or system preference)
        const savedTheme = localStorage.getItem('hexaequo.theme');
        const theme = savedTheme || getSystemTheme();
        applyTheme(theme);
        
        // Step 2: Initialize i18n (must complete before any UI text updates)
        if (window.i18n) {
            await window.i18n.init();
        }
        
        // Step 3: Cache DOM elements
        cacheDOM();
        
        // Step 4: Set up event listeners
        setupEventListeners();
        
        // Step 5: Load saved preferences from localStorage
        loadLocalGameConfig();
        
        // Step 6: Sync settings with existing toggles
        syncSettingsFromGame();
        
        // Step 7: Initialize language selector (now safe to use i18nT)
        initializeLanguageSelect();
        
        // Step 8: Check for existing session
        await checkExistingSession();
        
        // Step 9: Update UI (now safe - i18n is loaded, user state known)
        updateUserStatusUI();
        
        // Step 10: Update i18n DOM elements
        if (window.i18n?.updateDOM) {
            window.i18n.updateDOM();
        }
        
        // Step 11: Initialize Matchmaking system (Phase 2)
        if (window.Matchmaking) {
            window.Matchmaking.init({
                elo: currentUser?.elo || 1000,
                onMatchFound: handleMatchFound,
                onQueueStatusChange: (status) => {
                    console.log('[Lobby] Queue status changed:', status);
                }
            });
        }
        
        // Step 12: Initialize QR Code modal (Phase 2)
        if (window.QrCodeModal) {
            window.QrCodeModal.init({
                onOpponentJoined: (data) => {
                    console.log('[Lobby] Opponent joined via QR code:', data);
                    
                    // Host is always black in invitation mode
                    const playerColor = 'black';
                    
                    // Parse opponent info
                    const oppData = data.opponent || data.opponentInfo || {};
                    const opponentInfo = { 
                        name: oppData.pseudo || oppData.name || 'Opponent', 
                        elo: oppData.elo || null
                    };
                    
                    // Start the game
                    startOnlineGame({
                        playerColor: playerColor,
                        gameState: data.gameState,
                        opponentInfo: opponentInfo,
                        timerState: data.timerState
                    });
                }
            });
        }
        
        // Step 13: Hide loading screen and check for invite
        hideLoadingScreen();
        
        // Step 14: Handle invite code in URL (after everything is ready)
        handleEarlyInviteCheck();

        // Step 15: Handle ?replay=GAME_ID in URL (save to sessionStorage for game.js to pick up)
        checkReplayParam();
        
        console.log('[Lobby] Initialized');
    }
    
    /**
     * Cache all DOM elements
     */
    function cacheDOM() {
        lobby.overlay = document.getElementById('lobbyOverlay');
        lobby.playLocalBtn = document.getElementById('playLocalBtn');
        lobby.playOnlineBtn = document.getElementById('playOnlineBtn');
        
        // Local config section
        lobby.localConfigSection = document.getElementById('localConfigSection');
        lobby.blackPlayerType = document.getElementById('blackPlayerType');
        lobby.blackAiLevel = document.getElementById('blackAiLevel');
        lobby.whitePlayerType = document.getElementById('whitePlayerType');
        lobby.whiteAiLevel = document.getElementById('whiteAiLevel');
        lobby.localTimeControl = document.getElementById('localTimeControl');
        lobby.startLocalGameBtn = document.getElementById('startLocalGameBtn');
        lobby.backFromLocalBtn = document.getElementById('backFromLocalBtn');
        
        lobby.onlineOptions = document.getElementById('onlineOptions');
        lobby.connectionStatus = document.getElementById('lobbyConnectionStatus');
        lobby.roomActions = document.getElementById('lobbyRoomActions');
        lobby.backFromOnlineBtn = document.getElementById('backFromOnlineBtn');
        lobby.errorDisplay = document.getElementById('lobbyError');
        
        // User status
        lobby.userStatus = document.getElementById('userStatus');
        lobby.userDisplayName = document.getElementById('userDisplayName');
        lobby.loginBtn = document.getElementById('loginBtn');
        
        // Auth section
        lobby.authSection = document.getElementById('authSection');
        lobby.authTabs = document.querySelectorAll('.auth-tab');
        lobby.loginForm = document.getElementById('loginForm');
        lobby.registerForm = document.getElementById('registerForm');
        lobby.loginUsername = document.getElementById('loginUsername');
        lobby.loginPassword = document.getElementById('loginPassword');
        lobby.registerUsername = document.getElementById('registerUsername');
        lobby.registerPassword = document.getElementById('registerPassword');
        lobby.authError = document.getElementById('authError');
        lobby.backFromAuthBtn = document.getElementById('backFromAuthBtn');
        
        // Settings
        lobby.settingsSection = document.getElementById('lobbySettingsSection');
        lobby.backFromSettingsBtn = document.getElementById('backFromSettingsBtn');
        lobby.themeToggle = document.getElementById('lobbyThemeToggle');
        lobby.soundToggle = document.getElementById('lobbySoundToggle');
        lobby.validMovesToggle = document.getElementById('lobbyValidMovesToggle');
        lobby.previousMoveToggle = document.getElementById('lobbyPreviousMoveToggle');
        lobby.languageSelect = document.getElementById('languageSelect');
        
        // Time control
        lobby.timeControlSelect = document.getElementById('timeControlSelect');
        
        lobby.rulesBtn = document.getElementById('lobbyRulesBtn');
        lobby.settingsBtn = document.getElementById('lobbySettingsBtn');
        
        // Main menu Rules button
        lobby.mainRulesBtn = document.getElementById('mainRulesBtn');
        
        // Profile
        lobby.profileBtn = document.getElementById('profileBtn');
        lobby.profileModal = document.getElementById('profileModal');
        lobby.profileCloseBtn = document.getElementById('profileCloseBtn');
        
        // ELO display
        lobby.userEloDisplay = document.getElementById('userEloDisplay');
    }

    // ==================== Event Listeners ====================
    function setupEventListeners() {
        // Main menu buttons
        lobby.playLocalBtn?.addEventListener('click', showLocalConfig);
        lobby.playOnlineBtn?.addEventListener('click', showOnlineOptions);
        
        // Local config section
        lobby.startLocalGameBtn?.addEventListener('click', startConfiguredLocalGame);
        lobby.backFromLocalBtn?.addEventListener('click', showMainMenu);
        lobby.blackPlayerType?.addEventListener('change', handleBlackPlayerTypeChange);
        lobby.whitePlayerType?.addEventListener('change', handleWhitePlayerTypeChange);
        lobby.blackAiLevel?.addEventListener('change', () => {
            localGameConfig.blackAiLevel = parseInt(lobby.blackAiLevel.value);
            saveLocalGameConfig();
        });
        lobby.whiteAiLevel?.addEventListener('change', () => {
            localGameConfig.whiteAiLevel = parseInt(lobby.whiteAiLevel.value);
            saveLocalGameConfig();
        });
        lobby.localTimeControl?.addEventListener('change', () => {
            localGameConfig.timeControl = lobby.localTimeControl.value;
            saveLocalGameConfig();
        });
        
        // Online options
        lobby.backFromOnlineBtn?.addEventListener('click', showMainMenu);
        
        // User status / auth
        lobby.loginBtn?.addEventListener('click', handleLoginBtnClick);
        
        // Auth section
        lobby.authTabs?.forEach(tab => {
            tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
        });
        lobby.loginForm?.addEventListener('submit', handleLogin);
        lobby.registerForm?.addEventListener('submit', handleRegister);
        lobby.backFromAuthBtn?.addEventListener('click', showMainMenu);
        
        // Settings
        // Note: Settings button moved to user menu (Phase 1)
        lobby.backFromSettingsBtn?.addEventListener('click', showMainMenu);
        lobby.themeToggle?.addEventListener('change', handleThemeChange);
        lobby.soundToggle?.addEventListener('change', handleSoundChange);
        lobby.validMovesToggle?.addEventListener('change', handleValidMovesChange);
        lobby.previousMoveToggle?.addEventListener('change', handlePreviousMoveChange);
        lobby.languageSelect?.addEventListener('change', handleLanguageChange);
        
        // Time control select
        lobby.timeControlSelect?.addEventListener('change', (e) => {
            selectedTimeControl = e.target.value;
            console.log('[Lobby] Time control changed to:', selectedTimeControl);
        });
        
        // Profile button
        lobby.profileBtn?.addEventListener('click', openProfileModal);
        lobby.profileCloseBtn?.addEventListener('click', closeProfileModal);
        lobby.profileModal?.addEventListener('click', (e) => {
            if (e.target === lobby.profileModal) closeProfileModal();
        });
        
        // Main menu Rules button
        lobby.mainRulesBtn?.addEventListener('click', openRules);
        
        // Footer (legacy - Rules also in main menu now)
        lobby.rulesBtn?.addEventListener('click', openRules);
    }

    // ==================== Settings Sync ====================
    function syncSettingsFromGame() {
        // Sync theme
        const isLightTheme = document.body.getAttribute('data-theme') === 'light';
        if (lobby.themeToggle) lobby.themeToggle.checked = isLightTheme;
        
        // Sync with game settings toggles if they exist
        const gameThemeToggle = document.getElementById('themeToggle');
        const gameSoundToggle = document.getElementById('soundToggle');
        const gameValidMovesToggle = document.getElementById('validMovesToggle');
        const gamePreviousMoveToggle = document.getElementById('previousMoveToggle');
        
        if (gameThemeToggle && lobby.themeToggle) {
            lobby.themeToggle.checked = gameThemeToggle.checked;
        }
        if (gameSoundToggle && lobby.soundToggle) {
            lobby.soundToggle.checked = gameSoundToggle.checked;
        }
        if (gameValidMovesToggle && lobby.validMovesToggle) {
            lobby.validMovesToggle.checked = gameValidMovesToggle.checked;
        }
        if (gamePreviousMoveToggle && lobby.previousMoveToggle) {
            lobby.previousMoveToggle.checked = gamePreviousMoveToggle.checked;
        }
    }

    function handleThemeChange() {
        const isLight = lobby.themeToggle?.checked;
        document.body.setAttribute('data-theme', isLight ? 'light' : 'dark');
        
        // Sync with game toggle
        const gameToggle = document.getElementById('themeToggle');
        if (gameToggle) {
            gameToggle.checked = isLight;
            gameToggle.dispatchEvent(new Event('change'));
        }
        
        // Save to backend if logged in
        saveSettingToBackend('theme', isLight ? 'light' : 'dark');
    }

    function handleSoundChange() {
        const gameToggle = document.getElementById('soundToggle');
        if (gameToggle) {
            gameToggle.checked = lobby.soundToggle?.checked;
            gameToggle.dispatchEvent(new Event('change'));
        }
        
        // Save to backend if logged in
        saveSettingToBackend('sound', lobby.soundToggle?.checked);
    }

    function handleValidMovesChange() {
        const gameToggle = document.getElementById('validMovesToggle');
        if (gameToggle) {
            gameToggle.checked = lobby.validMovesToggle?.checked;
            gameToggle.dispatchEvent(new Event('change'));
        }
        
        // Save to backend if logged in
        saveSettingToBackend('showValidMoves', lobby.validMovesToggle?.checked);
    }

    function handlePreviousMoveChange() {
        const gameToggle = document.getElementById('previousMoveToggle');
        if (gameToggle) {
            gameToggle.checked = lobby.previousMoveToggle?.checked;
            gameToggle.dispatchEvent(new Event('change'));
        }
        
        // Save to backend if logged in
        saveSettingToBackend('showPreviousMove', lobby.previousMoveToggle?.checked);
    }

    async function handleLanguageChange() {
        const lang = lobby.languageSelect?.value;
        if (lang && window.i18n) {
            await window.i18n.setLanguage(lang);
            window.i18n.updateDOM();
            console.log('[Lobby] Language changed to:', lang);
            
            // Save to backend if logged in
            saveSettingToBackend('language', lang);
        }
    }
    
    // Save a single setting to the backend (debounced)
    let saveSettingsTimeout = null;
    let pendingSettings = {};
    
    function saveSettingToBackend(key, value) {
        if (!sessionToken) return; // Not logged in
        
        pendingSettings[key] = value;
        
        // Debounce: wait 500ms before sending to avoid multiple rapid requests
        if (saveSettingsTimeout) {
            clearTimeout(saveSettingsTimeout);
        }
        
        saveSettingsTimeout = setTimeout(async () => {
            const settingsToSave = { ...pendingSettings };
            pendingSettings = {};
            
            try {
                await authenticatedFetch(`${API_BASE}/users/me/settings`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(settingsToSave)
                });
                console.log('[Lobby] Settings saved to backend:', settingsToSave);
            } catch (err) {
                console.error('[Lobby] Failed to save settings:', err);
            }
        }, 500);
    }
    
    // Load settings from backend and apply them
    async function loadSettingsFromBackend() {
        if (!sessionToken) return;
        
        try {
            const response = await authenticatedFetch(`${API_BASE}/users/me/settings`);
            
            if (response.ok) {
                const { data: settings } = await response.json();
                applySettings(settings);
                console.log('[Lobby] Settings loaded from backend:', settings);
            }
        } catch (err) {
            console.error('[Lobby] Failed to load settings:', err);
        }
    }
    
    // Apply settings to the UI
    function applySettings(settings) {
        if (!settings) return;
        
        // Theme
        if (settings.theme) {
            const isLight = settings.theme === 'light';
            document.body.setAttribute('data-theme', settings.theme);
            if (lobby.themeToggle) lobby.themeToggle.checked = isLight;
            const gameThemeToggle = document.getElementById('themeToggle');
            if (gameThemeToggle) gameThemeToggle.checked = isLight;
        }
        
        // Sound
        if (typeof settings.sound === 'boolean') {
            if (lobby.soundToggle) lobby.soundToggle.checked = settings.sound;
            const gameSoundToggle = document.getElementById('soundToggle');
            if (gameSoundToggle) {
                gameSoundToggle.checked = settings.sound;
                gameSoundToggle.dispatchEvent(new Event('change'));
            }
        }
        
        // Show Valid Moves
        if (typeof settings.showValidMoves === 'boolean') {
            if (lobby.validMovesToggle) lobby.validMovesToggle.checked = settings.showValidMoves;
            const gameValidMovesToggle = document.getElementById('validMovesToggle');
            if (gameValidMovesToggle) {
                gameValidMovesToggle.checked = settings.showValidMoves;
                gameValidMovesToggle.dispatchEvent(new Event('change'));
            }
        }
        
        // Show Previous Move
        if (typeof settings.showPreviousMove === 'boolean') {
            if (lobby.previousMoveToggle) lobby.previousMoveToggle.checked = settings.showPreviousMove;
            const gamePreviousMoveToggle = document.getElementById('previousMoveToggle');
            if (gamePreviousMoveToggle) {
                gamePreviousMoveToggle.checked = settings.showPreviousMove;
                gamePreviousMoveToggle.dispatchEvent(new Event('change'));
            }
        }
        
        // Language
        if (settings.language && window.i18n) {
            window.i18n.setLanguage(settings.language).then(() => {
                window.i18n.updateDOM();
                if (lobby.languageSelect) lobby.languageSelect.value = settings.language;
            });
        }
    }
    
    // Initialize language select with current language
    function initializeLanguageSelect() {
        if (lobby.languageSelect && window.i18n) {
            lobby.languageSelect.value = window.i18n.getCurrentLanguage();
        }
    }

    // ==================== Local Game Config ====================
    function loadLocalGameConfig() {
        try {
            const saved = localStorage.getItem('hexaequo.localGameConfig');
            if (saved) {
                const parsed = JSON.parse(saved);
                localGameConfig = { ...localGameConfig, ...parsed };
            }
        } catch (e) {
            console.warn('[Lobby] Failed to load local game config:', e);
        }
        
        // Apply saved config to UI
        if (lobby.blackPlayerType) {
            lobby.blackPlayerType.value = localGameConfig.blackPlayer;
            lobby.blackAiLevel.style.display = localGameConfig.blackPlayer === 'ai' ? 'block' : 'none';
            lobby.blackAiLevel.value = localGameConfig.blackAiLevel;
        }
        if (lobby.whitePlayerType) {
            lobby.whitePlayerType.value = localGameConfig.whitePlayer;
            lobby.whiteAiLevel.style.display = localGameConfig.whitePlayer === 'ai' ? 'block' : 'none';
            lobby.whiteAiLevel.value = localGameConfig.whiteAiLevel;
        }
        if (lobby.localTimeControl) {
            lobby.localTimeControl.value = localGameConfig.timeControl;
        }
    }
    
    function saveLocalGameConfig() {
        try {
            localStorage.setItem('hexaequo.localGameConfig', JSON.stringify(localGameConfig));
        } catch (e) {
            console.warn('[Lobby] Failed to save local game config:', e);
        }
    }
    
    function handleBlackPlayerTypeChange() {
        const type = lobby.blackPlayerType.value;
        localGameConfig.blackPlayer = type;
        lobby.blackAiLevel.style.display = type === 'ai' ? 'block' : 'none';
        saveLocalGameConfig();
    }
    
    function handleWhitePlayerTypeChange() {
        const type = lobby.whitePlayerType.value;
        localGameConfig.whitePlayer = type;
        lobby.whiteAiLevel.style.display = type === 'ai' ? 'block' : 'none';
        saveLocalGameConfig();
    }
    
    function showLocalConfig() {
        document.querySelector('.mode-selection')?.style.setProperty('display', 'none');
        lobby.localConfigSection?.style.setProperty('display', 'flex');
        lobby.onlineOptions?.style.setProperty('display', 'none');
        lobby.settingsSection?.style.setProperty('display', 'none');
        lobby.authSection?.style.setProperty('display', 'none');
        document.querySelector('.lobby-footer')?.style.setProperty('display', 'none');
        
        // Hide lobby logo (logo is in header on sub-pages)
        document.querySelector('.lobby-logo')?.classList.add('hidden');
        
        // Set header to show logo (not main menu)
        if (window.UserMenu?.setMainMenuMode) {
            window.UserMenu.setMainMenuMode(false);
        }
        
        // Ensure UI reflects current config
        loadLocalGameConfig();
    }

    // ==================== Menu Navigation ====================
    
    /**
     * Cancel any active waiting state (room, matchmaking queue, invitation)
     */
    function cancelWaiting() {
        // Leave the multiplayer room
        if (window.Multiplayer?.leaveRoom) {
            window.Multiplayer.leaveRoom().catch(err => {
                console.error('[Lobby] Error leaving room:', err);
            });
        }
        
        // Leave matchmaking queue if active
        if (window.Matchmaking?.isInQueue) {
            window.Matchmaking.cleanup();
        }
        
        // Cancel any active invitation
        if (window.QrCodeModal?.hide) {
            window.QrCodeModal.hide();
        }
        
        currentRoomCode = null;
    }
    
    function showMainMenu() {
        // Cancel any waiting room before going back
        if (currentRoomCode) {
            cancelWaiting();
        }
        
        // Hide all sections
        document.querySelector('.mode-selection')?.style.setProperty('display', 'flex');
        lobby.localConfigSection?.style.setProperty('display', 'none');
        lobby.onlineOptions?.style.setProperty('display', 'none');
        lobby.settingsSection?.style.setProperty('display', 'none');
        lobby.authSection?.style.setProperty('display', 'none');
        
        // Show footer
        document.querySelector('.lobby-footer')?.style.setProperty('display', 'flex');
        
        // Show lobby logo (main menu has logo in page content)
        document.querySelector('.lobby-logo')?.classList.remove('hidden');
        
        // Set header to main menu mode (hide logo in header)
        if (window.UserMenu?.setMainMenuMode) {
            window.UserMenu.setMainMenuMode(true);
        }
        
        hideError();
        hideAuthError();
    }

    function showOnlineOptions() {
        // Require sign-in to access online play
        if (!currentUser) {
            showAuthSection();
            return;
        }
        
        document.querySelector('.mode-selection')?.style.setProperty('display', 'none');
        lobby.localConfigSection?.style.setProperty('display', 'none');
        lobby.onlineOptions?.style.setProperty('display', 'flex');
        lobby.settingsSection?.style.setProperty('display', 'none');
        lobby.authSection?.style.setProperty('display', 'none');
        document.querySelector('.lobby-footer')?.style.setProperty('display', 'none');
        
        // Hide lobby logo (logo is in header on sub-pages)
        document.querySelector('.lobby-logo')?.classList.add('hidden');
        
        // Set header to show logo (not main menu)
        if (window.UserMenu?.setMainMenuMode) {
            window.UserMenu.setMainMenuMode(false);
        }
        
        // Reset online UI state
        lobby.roomActions?.style.setProperty('display', 'none');
        lobby.waitingSection?.style.setProperty('display', 'none');
        
        // Connect to server
        connectToServer();
    }

    function showSettings() {
        document.querySelector('.mode-selection')?.style.setProperty('display', 'none');
        lobby.localConfigSection?.style.setProperty('display', 'none');
        lobby.onlineOptions?.style.setProperty('display', 'none');
        lobby.settingsSection?.style.setProperty('display', 'flex');
        lobby.authSection?.style.setProperty('display', 'none');
        document.querySelector('.lobby-footer')?.style.setProperty('display', 'none');
        
        // Set header to show logo (not main menu)
        if (window.UserMenu?.setMainMenuMode) {
            window.UserMenu.setMainMenuMode(false);
        }
        
        // Sync settings
        syncSettingsFromGame();
    }
    
    function showAuthSection() {
        document.querySelector('.mode-selection')?.style.setProperty('display', 'none');
        lobby.localConfigSection?.style.setProperty('display', 'none');
        lobby.onlineOptions?.style.setProperty('display', 'none');
        lobby.settingsSection?.style.setProperty('display', 'none');
        lobby.authSection?.style.setProperty('display', 'flex');
        document.querySelector('.lobby-footer')?.style.setProperty('display', 'none');
        
        // Set header to show logo (not main menu)
        if (window.UserMenu?.setMainMenuMode) {
            window.UserMenu.setMainMenuMode(false);
        }
        
        // Clear forms
        lobby.loginForm?.reset();
        lobby.registerForm?.reset();
        hideAuthError();
    }
    
    /**
     * Show auth section when coming from invite flow
     * After successful auth, returns to invite modal
     */
    function showAuthSectionForInvite() {
        showAuthSection();
        // pendingInviteAfterAuth is already set before calling this
    }

    // ==================== Game Start Functions ====================
    // Helper function for i18n
    function i18nT(key, params) {
        return window.i18n?.t(key, params) || key;
    }
    
    // Difficulty names are now localized dynamically
    function getDifficultyName(level) {
        const keys = {
            0: 'lobby.beginner',
            1: 'lobby.easy',
            2: 'lobby.normal',
            3: 'lobby.hard',
            4: 'lobby.expert'
        };
        return i18nT(keys[level] || keys[3]);
    }
    
    function updatePlayerInfoDisplays(mode, aiLevel = null, playerColor = null, opponentInfo = null) {
        const blackInfo = document.getElementById('blackPlayerInfo');
        const whiteInfo = document.getElementById('whitePlayerInfo');
        
        if (!blackInfo || !whiteInfo) return;
        
        const blackName = blackInfo.querySelector('.player-name');
        const blackRating = blackInfo.querySelector('.player-rating');
        const whiteName = whiteInfo.querySelector('.player-name');
        const whiteRating = whiteInfo.querySelector('.player-rating');
        
        if (mode === 'ai') {
            // Black player is the user, White is AI
            if (currentUser) {
                // Use pseudo for display name
                const userName = currentUser.pseudo || currentUser.username || i18nT('game.player');
                blackName.textContent = userName;
                blackRating.textContent = `ELO: ${currentUser.elo || 1000}`;
            } else {
                blackName.textContent = i18nT('game.player');
                blackRating.textContent = '';
            }
            
            whiteName.textContent = i18nT('lobby.ai');
            whiteRating.textContent = getDifficultyName(aiLevel);
        } else if (mode === '2player') {
            blackName.textContent = i18nT('lobby.black');
            blackRating.textContent = '';
            whiteName.textContent = i18nT('lobby.white');
            whiteRating.textContent = '';
        } else if (mode === 'online') {
            // Determine which player is local and which is opponent based on playerColor
            const localUser = currentUser;
            const localName = localUser ? (localUser.pseudo || localUser.username) : 'Player';
            const localElo = localUser?.elo || 1000;
            
            const opponentName = opponentInfo?.name || 'Opponent';
            const opponentElo = opponentInfo?.elo || '?';
            
            if (playerColor === 'black') {
                // Local player is black
                blackName.textContent = localName;
                blackRating.textContent = `ELO: ${localElo}`;
                whiteName.textContent = opponentName;
                whiteRating.textContent = `ELO: ${opponentElo}`;
            } else {
                // Local player is white
                blackName.textContent = opponentName;
                blackRating.textContent = `ELO: ${opponentElo}`;
                whiteName.textContent = localName;
                whiteRating.textContent = `ELO: ${localElo}`;
            }
        }
    }
    
    function startConfiguredLocalGame() {
        console.log('[Lobby] Starting configured local game:', localGameConfig);
        
        // Close any open modals
        if (window.QrCodeModal && window.QrCodeModal.isOpen) {
            window.QrCodeModal.close();
        }
        
        const blackIsAi = localGameConfig.blackPlayer === 'ai';
        const whiteIsAi = localGameConfig.whitePlayer === 'ai';
        const bothAi = blackIsAi && whiteIsAi;
        const anyAi = blackIsAi || whiteIsAi;
        
        // Store config in window for game.js to access
        window.localGameConfig = {
            blackPlayer: localGameConfig.blackPlayer,
            blackAiLevel: localGameConfig.blackAiLevel,
            whitePlayer: localGameConfig.whitePlayer,
            whiteAiLevel: localGameConfig.whiteAiLevel,
            timeControl: localGameConfig.timeControl,
            isAiVsAi: bothAi
        };
        
        // Determine game mode
        let gameMode;
        if (bothAi) {
            gameMode = 'ai-vs-ai';
        } else if (anyAi) {
            gameMode = 'ai';
        } else {
            gameMode = '2player';
        }
        
        // Set game mode via the existing select (game.js uses this)
        const gameModeSelect = document.getElementById('gameModeSelect');
        if (gameModeSelect) {
            // For AI games, use 'ai' mode
            gameModeSelect.value = anyAi ? 'ai' : '2player';
            gameModeSelect.dispatchEvent(new Event('change'));
        }
        
        // Set AI difficulty (use highest level if both are AI)
        if (anyAi) {
            const difficultySelect = document.getElementById('difficultySelect');
            const aiLevel = whiteIsAi ? localGameConfig.whiteAiLevel : localGameConfig.blackAiLevel;
            if (difficultySelect) {
                difficultySelect.value = aiLevel.toString();
                difficultySelect.dispatchEvent(new Event('change'));
            }
        }
        
        // Set timer
        if (window.GameTimer) {
            window.GameTimer.setTimeControl(localGameConfig.timeControl);
        }
        
        // Update player displays
        updatePlayerInfoDisplaysForConfig(localGameConfig);
        
        // Hide lobby and start game
        hideLobby();
        
        // Trigger new game
        triggerNewGame();
    }
    
    function updatePlayerInfoDisplaysForConfig(config) {
        const blackInfo = document.getElementById('blackPlayerInfo');
        const whiteInfo = document.getElementById('whitePlayerInfo');
        
        if (!blackInfo || !whiteInfo) return;
        
        const blackName = blackInfo.querySelector('.player-name');
        const blackRating = blackInfo.querySelector('.player-rating');
        const whiteName = whiteInfo.querySelector('.player-name');
        const whiteRating = whiteInfo.querySelector('.player-rating');
        
        if (config.blackPlayer === 'ai') {
            blackName.textContent = i18nT('lobby.ai');
            blackRating.textContent = getDifficultyName(config.blackAiLevel);
        } else {
            blackName.textContent = currentUser ? (currentUser.pseudo || i18nT('game.player')) : i18nT('lobby.black');
            blackRating.textContent = '';
        }
        
        if (config.whitePlayer === 'ai') {
            whiteName.textContent = i18nT('lobby.ai');
            whiteRating.textContent = getDifficultyName(config.whiteAiLevel);
        } else {
            whiteName.textContent = currentUser ? (currentUser.pseudo || i18nT('game.player')) : i18nT('lobby.white');
            whiteRating.textContent = '';
        }
    }

    // ==================== Online Functions ====================
    function connectToServer() {
        // Use existing multiplayer module
        if (typeof window.Multiplayer !== 'undefined') {
            window.Multiplayer.connect().then(() => {
                socket = window.Multiplayer.getSocket();
                setupSocketListeners();
                onConnected();
            }).catch((err) => {
                console.error('[Lobby] Connection error:', err);
                onConnectionError(i18nT('lobby.couldNotConnect'));
            });
        } else {
            onConnectionError(i18nT('errors.multiplayerNotAvailable'));
        }
    }

    function setupSocketListeners() {
        if (!socket) return;
        
        // Remove existing listeners to prevent duplicates
        socket.off('opponent-joined');
        socket.off('roomError');
        
        // When opponent joins our room, start the game
        socket.on('opponent-joined', (data) => {
            console.log('[Lobby] Opponent joined!', data);
            // Get our color from Multiplayer module
            const playerColor = window.Multiplayer.playerColor;
            // Store opponent info (handle both 'opponentInfo' and 'opponent' keys for compatibility)
            const oppData = data.opponentInfo || data.opponent || {};
            currentOpponent = { 
                name: oppData.pseudo || oppData.name || 'Opponent', 
                elo: oppData.elo || null
            };
            startOnlineGame({ 
                playerColor, 
                gameState: data.gameState, 
                opponentInfo: currentOpponent,
                timerState: data.timerState  // Sync timer from server
            });
        });
        
        socket.on('roomError', (data) => {
            console.error('[Lobby] Room error:', data.message);
            showError(data.message);
            // Reset to room actions view
            lobby.waitingSection?.style.setProperty('display', 'none');
            lobby.roomActions?.style.setProperty('display', 'flex');
        });
    }

    function onConnected() {
        isConnected = true;
        // Connection status indicator is hidden (Phase 1) - users don't need to see this
        // Just hide the connecting indicator and show room actions
        lobby.connectionStatus?.style.setProperty('display', 'none');
        
        lobby.roomActions?.style.setProperty('display', 'flex');
        
        // Update matchmaking UI based on login status
        updateMatchmakingUI();
        
        // Note: Matchmaking and QrCodeModal are initialized at DOMContentLoaded
        // Here we just update the ELO for matchmaking if user is logged in
        if (window.Matchmaking && currentUser) {
            window.Matchmaking.setElo(currentUser.elo || 1000);
        }
        
        // Check for invite code in URL
        checkInviteCode();
    }

    function onConnectionError(message) {
        isConnected = false;
        const statusDot = lobby.connectionStatus?.querySelector('.status-dot');
        const statusText = lobby.connectionStatus?.querySelector('.status-text');
        
        // Show connection status only when there's an error
        lobby.connectionStatus?.style.setProperty('display', 'flex');
        
        if (statusDot) {
            statusDot.classList.remove('connecting', 'connected');
            statusDot.classList.add('error');
        }
        if (statusText) {
            statusText.textContent = message || i18nT('errors.connectionFailed');
        }
        
        lobby.roomActions?.style.setProperty('display', 'none');
    }

    // ==================== Matchmaking Functions (Phase 2) ====================
    
    // Invite landing modal state
    let currentInviteCode = null;
    let currentInviteInfo = null;
    
    /**
     * Check URL for invite code and handle invitation flow
     * This should be called as soon as connection is established
     */
    function checkInviteCode() {
        const urlParams = new URLSearchParams(window.location.search);
        let inviteCode = urlParams.get('invite');
        
        // Fallback: check sessionStorage (survives page reload on mobile)
        if (!inviteCode) {
            inviteCode = sessionStorage.getItem('hexaequo_pending_invite');
            if (inviteCode) {
                sessionStorage.removeItem('hexaequo_pending_invite');
                console.log('[Lobby] Restored invite code from sessionStorage:', inviteCode);
            }
        }
        
        if (!inviteCode) return false;
        
        console.log('[Lobby] Found invite code:', inviteCode);
        
        // Save to sessionStorage before removing from URL (resilience for mobile reloads)
        sessionStorage.setItem('hexaequo_pending_invite', inviteCode);
        
        // Clear the invite code from URL (without page reload)
        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, newUrl);
        
        // Get invitation info first
        socket.emit('get-invitation-info', { code: inviteCode }, (response) => {
            if (!response.success) {
                // Show browser alert for expired/invalid invite
                const errorMessage = response.error || i18nT('errors.invalidInvite');
                alert(errorMessage);
                // Clear sessionStorage on invalid/expired invite
                sessionStorage.removeItem('hexaequo_pending_invite');
                sessionStorage.removeItem('hexaequo_pending_invite_info');
                return;
            }
            
            // Keep sessionStorage alive — cleared only after acceptInvitation succeeds
            // Also persist invite info for page-refresh resilience
            sessionStorage.setItem('hexaequo_pending_invite_info', JSON.stringify(response));
            
            // Show the invite landing modal
            showInviteLandingModal(inviteCode, response);
        });
        
        return true; // Indicate that an invite code was found
    }
    
    /**
     * Check for ?replay=GAME_ID URL parameter.
     * Saves the game ID to sessionStorage and clears the URL param.
     * game.js will pick it up after window.onload and open the replay viewer.
     */
    function checkReplayParam() {
        const urlParams = new URLSearchParams(window.location.search);
        const replayId = urlParams.get('replay');
        if (!replayId) return;

        console.log('[Lobby] Replay param detected:', replayId);
        sessionStorage.setItem('hexaequo_pending_replay', replayId);

        // Clear the replay param from URL (without page reload)
        urlParams.delete('replay');
        const remaining = urlParams.toString();
        const newUrl = window.location.pathname + (remaining ? '?' + remaining : '') + window.location.hash;
        window.history.replaceState({}, document.title, newUrl);
    }

    /**
     * Check for invite code immediately on page load (before connection)
     * Returns true if an invite code is present in URL
     */
    function hasInviteCodeInUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('invite') || !!sessionStorage.getItem('hexaequo_pending_invite');
    }
    
    /**
     * Disconnect old (unauthenticated) socket and reconnect with auth token.
     * Called after login/register when a pending invite needs an authenticated socket.
     */
    async function reconnectSocketForInvite() {
        if (typeof window.Multiplayer === 'undefined') return;
        
        console.log('[Lobby] Reconnecting socket with auth token for invite...');
        // Disconnect old unauthenticated socket
        window.Multiplayer.disconnect();
        socket = null;
        
        // Reconnect — will pick up the new auth token from storage
        await window.Multiplayer.connect();
        socket = window.Multiplayer.getSocket();
        if (socket && socket.connected) {
            setupSocketListeners();
            console.log('[Lobby] Socket reconnected with auth for invite');
        } else {
            console.error('[Lobby] Failed to reconnect socket for invite');
        }
    }
    
    /**
     * Handle invite flow on page load
     * Connects to server and processes invite code
     */
    async function handleEarlyInviteCheck() {
        if (!hasInviteCodeInUrl()) return;
        
        console.log('[Lobby] Invite code detected in URL, connecting to process...');
        
        // Connect to server first
        if (typeof window.Multiplayer !== 'undefined') {
            try {
                await window.Multiplayer.connect();
                socket = window.Multiplayer.getSocket();
                
                if (socket && socket.connected) {
                    setupSocketListeners();
                    checkInviteCode();
                } else {
                    alert(i18nT('errors.connectionFailed'));
                }
            } catch (err) {
                console.error('[Lobby] Connection failed for invite:', err);
                alert(i18nT('errors.connectionFailed'));
            }
        }
    }
    
    /**
     * Show the invite landing modal with game info
     */
    function showInviteLandingModal(code, inviteInfo) {
        currentInviteCode = code;
        currentInviteInfo = inviteInfo;
        
        const landingBackdrop = document.getElementById('inviteLandingBackdrop');
        const landingModal = document.getElementById('inviteLandingModal');
        const hostPseudoEl = document.getElementById('inviteHostPseudo');
        const hostEloEl = document.getElementById('inviteHostElo');
        const timeModeEl = document.getElementById('inviteTimeMode');
        const joinBtn = document.getElementById('inviteJoinBtn');
        const signInBtn = document.getElementById('inviteSignInBtn');
        
        // Populate info - show actual host name
        if (hostPseudoEl) {
            const hostName = inviteInfo.creatorPseudo || 'Host';
            hostPseudoEl.textContent = hostName;
        }
        
        // Show host ELO if available
        if (hostEloEl) {
            if (inviteInfo.creatorElo) {
                hostEloEl.textContent = inviteInfo.creatorElo;
                hostEloEl.style.display = '';
            } else {
                hostEloEl.textContent = '';
                hostEloEl.style.display = 'none';
            }
        }
        
        if (timeModeEl) {
            // Translate time mode
            const timeModeKey = `lobby.${inviteInfo.timeMode}`;
            timeModeEl.textContent = i18nT(timeModeKey) || inviteInfo.timeMode;
        }
        
        // Show/hide buttons based on login status
        const isLoggedIn = !!currentUser;
        
        if (joinBtn) {
            joinBtn.style.display = isLoggedIn ? 'block' : 'none';
            joinBtn.onclick = () => acceptInvitationFromModal();
        }
        
        if (signInBtn) {
            // Show sign in button if not logged in
            signInBtn.style.display = isLoggedIn ? 'none' : 'block';
            signInBtn.textContent = i18nT('invite.signInToJoin');
            signInBtn.onclick = () => {
                // Store invite info, show auth section, then return
                pendingInviteAfterAuth = { code, info: inviteInfo };
                hideInviteLandingModal();
                showAuthSectionForInvite();
            };
        }
        
        // Show modal
        if (landingBackdrop) landingBackdrop.style.display = 'block';
        if (landingModal) landingModal.style.display = 'flex';
    }
    
    /**
     * Hide the invite landing modal
     */
    function hideInviteLandingModal() {
        const landingBackdrop = document.getElementById('inviteLandingBackdrop');
        const landingModal = document.getElementById('inviteLandingModal');
        
        if (landingBackdrop) landingBackdrop.style.display = 'none';
        if (landingModal) landingModal.style.display = 'none';
        
        currentInviteCode = null;
        currentInviteInfo = null;
    }
    
    /**
     * Accept invitation from the landing modal
     */
    function acceptInvitationFromModal() {
        console.log('[Lobby] acceptInvitationFromModal called, currentInviteCode:', currentInviteCode);
        if (!currentInviteCode) {
            console.error('[Lobby] No currentInviteCode!');
            return;
        }
        
        // Pass stored values to acceptInvitation (modal hidden on success)
        acceptInvitation(currentInviteCode, currentInviteInfo);
    }
    
    /**
     * Accept an invitation and join the game
     */
    function acceptInvitation(code, inviteInfo) {
        console.log('[Lobby] Accepting invitation:', code, inviteInfo);
        console.log('[Lobby] Socket available:', !!socket, 'Connected:', socket?.connected);
        
        if (!socket || !socket.connected) {
            console.error('[Lobby] Socket not available for accept-invitation!');
            showError(i18nT('errors.connectionFailed'));
            return;
        }
        
        // User must be logged in at this point
        if (!currentUser) {
            showError(i18nT('invite.signInToJoin'));
            return;
        }
        
        const payload = { 
            code,
            pseudo: currentUser.pseudo || currentUser.username,
            elo: currentUser.elo || null
        };

        console.log('[Lobby] accept-invitation payload', {
            payload,
            socketId: socket?.id,
            socketConnected: socket?.connected
        });
        
        socket.emit('accept-invitation', payload, (response) => {
            if (!response.success) {
                showError(response.error || i18nT('errors.failedToJoin'));
                return;
            }
            
            // Clear invite data from sessionStorage now that it's accepted
            sessionStorage.removeItem('hexaequo_pending_invite');
            sessionStorage.removeItem('hexaequo_pending_invite_info');
            
            // Hide landing modal only after successful connection
            hideInviteLandingModal();
            
            console.log('[Lobby] Invitation accepted, joined room:', response.roomCode);
            currentRoomCode = response.roomCode;
            
            // Set room info in Multiplayer
            if (window.Multiplayer && response.roomCode) {
                window.Multiplayer.setRoomInfo(response.roomCode, response.color || 'white');
            }
            
            // Store opponent info
            currentOpponent = {
                name: response.opponentInfo?.name || inviteInfo.creatorPseudo || 'Host',
                elo: response.opponentInfo?.elo
            };
            
            // Start the game as white (invitee)
            startOnlineGame({
                playerColor: response.color || 'white',
                gameState: response.gameState,
                opponentInfo: currentOpponent,
                timeControl: response.timeMode
            });
        });
    }
    
    /**
     * Handle match found from matchmaking queue
     */
    function handleMatchFound(data) {
        console.log('[Lobby] Match found:', data);
        
        currentRoomCode = data.roomCode;
        currentOpponent = data.opponentInfo || { name: 'Opponent', elo: null };
        
        startOnlineGame({
            playerColor: data.color,
            gameState: data.gameState,
            opponentInfo: currentOpponent,
            timeControl: data.timeMode
        });
    }

    function startOnlineGame(data) {
        console.log('[Lobby] Starting online game', data);
        
        try {
            // Close any open modals
            if (window.QrCodeModal && window.QrCodeModal.isOpen) {
                window.QrCodeModal.close();
            }
            
            const playerColor = data.playerColor || window.Multiplayer.playerColor;
            const opponentInfo = data.opponentInfo || currentOpponent;
            
            console.log('[Lobby] playerColor:', playerColor);
            console.log('[Lobby] opponentInfo:', opponentInfo);
            
            // Set online mode directly in game.js
            if (window.setOnlineMode) {
                window.setOnlineMode(true, playerColor);
            }
            
            // Update Multiplayer module
            if (window.Multiplayer) {
                window.Multiplayer.setOnlineMode(true);
            }
            
            // Update the gameModeSelect visually without triggering change event
            const gameModeSelect = document.getElementById('gameModeSelect');
            if (gameModeSelect) {
                gameModeSelect.value = 'online';
            }
            
            // Hide difficulty selector for online mode
            const difficultyContainer = document.getElementById('difficultyContainer');
            if (difficultyContainer) {
                difficultyContainer.style.display = 'none';
            }
            
            // Update player info displays with online mode data
            try {
                updatePlayerInfoDisplays('online', null, playerColor, opponentInfo);
            } catch (e) {
                console.warn('[Lobby] Failed to update player info displays:', e);
            }
            
            // Set the time control and sync timer from server
            const timeControl = data.timeControl || selectedTimeControl;
            if (window.GameTimer) {
                try {
                    window.GameTimer.setTimeControl(timeControl);
                    window.GameTimer.setOnlineMode(true);
                    
                    // Sync timer state from server if available
                    if (data.timerState) {
                        window.GameTimer.syncFromServer(data.timerState);
                    }
                } catch (e) {
                    console.warn('[Lobby] Failed to setup timer:', e);
                }
            }
        } catch (err) {
            console.error('[Lobby] Error during startOnlineGame setup:', err);
        }
        
        // CRITICAL: Hide lobby and trigger game engine
        // These are wrapped in try-catches to ensure one failure doesn't stop the other
        try {
            console.log('[Lobby] Hiding lobby...');
            hideLobby();
        } catch (e) {
            console.error('[Lobby] Failed to hide lobby:', e);
            // Fallback: force overlay hiding via ID
            const overlay = document.getElementById('lobbyOverlay');
            if (overlay) overlay.style.display = 'none';
        }
        
        try {
            console.log('[Lobby] Triggering new game sequence...');
            triggerNewGame();
        } catch (e) {
            console.error('[Lobby] Failed to trigger new game:', e);
        }
        
        // Apply initial game state from server if available
        if (data.gameState && window.applyOnlineMove) {
            console.log('[Lobby] Applying initial game state from server');
            // Pass null as previousState to indicate initial sync
            setTimeout(() => {
                try {
                    window.applyOnlineMove(data.gameState, null);
                } catch (e) {
                    console.error('[Lobby] Failed to apply initial state:', e);
                }
            }, 100); // Small delay to ensure board is reset
        } else {
            console.warn('[Lobby] No game state or applyFunction available:', { 
                hasState: !!data.gameState, 
                hasApply: !!window.applyOnlineMove 
            });
        }
    }

    // ==================== Profile Functions ====================
    function openProfileModal() {
        if (window.GameProfile?.openProfile) {
            window.GameProfile.openProfile();
        }
    }
    
    function closeProfileModal() {
        if (window.GameProfile?.closeProfile) {
            window.GameProfile.closeProfile();
        }
    }
    
    // ==================== Utility Functions ====================
    function hideLobby() {
        if (lobby.overlay) {
            lobby.overlay.classList.add('hidden');
            // Remove inline styles to ensure CSS class works properly
            lobby.overlay.style.display = '';
            lobby.overlay.style.visibility = '';
            lobby.overlay.style.pointerEvents = '';
            lobby.overlay.style.opacity = '';
        }
        // Hide user menu when entering a game
        if (window.UserMenu?.hide) {
            window.UserMenu.hide();
        }
    }

    function showLobby() {
        if (lobby.overlay) {
            lobby.overlay.classList.remove('hidden');
        }
        // Show user menu when returning to lobby
        if (window.UserMenu?.show) {
            window.UserMenu.show();
        }
        showMainMenu();
    }

    function triggerNewGame() {
        console.log('[Lobby] Triggering new game...');
        if (window.resetGame) {
            window.resetGame();
        } else {
            // Fallback to clicking button
            const newGameBtn = document.getElementById('newGameBtn');
            if (newGameBtn) {
                newGameBtn.click();
            } else {
                console.warn('[Lobby] Could not trigger new game: resetGame not found and button missing');
            }
        }
    }

    function showError(message) {
        if (lobby.errorDisplay) {
            lobby.errorDisplay.textContent = message;
            lobby.errorDisplay.style.display = 'block';
        }
    }

    function hideError() {
        if (lobby.errorDisplay) {
            lobby.errorDisplay.style.display = 'none';
        }
    }

    function openRules() {
        // Open the rules viewer (HTML-based)
        if (window.RulesViewer) {
            window.RulesViewer.open();
        } else {
            // Fallback for legacy PDF viewer
            const rulesOverlay = document.getElementById('rulesOverlay');
            if (rulesOverlay) {
                rulesOverlay.classList.add('open');
            }
        }
    }

    // ==================== Authentication Functions ====================
    async function checkExistingSession() {
        // Check for stored session token (could be in localStorage or sessionStorage)
        sessionToken = getStoredToken(SESSION_KEY);
        refreshToken = getStoredToken(REFRESH_KEY);
        if (!sessionToken) {
            currentUser = null;
            return;
        }
        
        try {
            const response = await authenticatedFetch(`${API_BASE}/users/me`);
            
            if (response.ok) {
                const data = await response.json();
                currentUser = data.data;
                // Normalize ELO to number (backward compat: API may return object or number)
                if (currentUser.elo && typeof currentUser.elo === 'object') {
                    currentUser.elo = currentUser.elo.classic ?? 1000;
                } else if (currentUser.elo === undefined) {
                    currentUser.elo = 1000;
                }
                console.log('[Lobby] Session restored for:', currentUser.pseudo);
                
                // Load user settings from backend
                await loadSettingsFromBackend();
                
                // Update user menu display
                window.UserMenu?.updateDisplay?.();
            } else {
                // Invalid session, clear it
                clearSessionTokens();
                sessionToken = null;
                refreshToken = null;
                currentUser = null;
            }
        } catch (err) {
            console.error('[Lobby] Session check failed:', err);
            currentUser = null;
        }
    }
    
    function updateUserStatusUI() {
        if (currentUser) {
            // Logged in
            if (lobby.userDisplayName) {
                lobby.userDisplayName.textContent = currentUser.pseudo;
            }
            if (lobby.userEloDisplay) {
                lobby.userEloDisplay.textContent = currentUser.elo !== undefined ? currentUser.elo : '';
            }
            if (lobby.loginBtn) {
                lobby.loginBtn.textContent = i18nT('auth.signOut');
            }
            if (lobby.profileBtn) {
                lobby.profileBtn.style.display = 'inline-block';
            }
            // Update Play Online button text
            if (lobby.playOnlineBtn) {
                lobby.playOnlineBtn.textContent = i18nT('lobby.playOnline');
            }
        } else {
            // Not logged in - show sign in prompt on button
            if (lobby.playOnlineBtn) {
                lobby.playOnlineBtn.textContent = i18nT('lobby.signInToPlayOnline');
            }
        }
        
        // Update matchmaking section
        updateMatchmakingUI();
    }
    
    /**
     * Update matchmaking section UI based on login status
     */
    function updateMatchmakingUI() {
        const inviteBtn = document.getElementById('matchmakingInviteBtn');
        
        // Since users must be signed in to access online play,
        // both Play and Invite buttons are always available
        if (inviteBtn) inviteBtn.style.display = '';
    }
    
    function handleLoginBtnClick() {
        if (currentUser) {
            // Already logged in - log out
            handleLogout();
        } else {
            // Not logged in - show auth section
            showAuthSection();
        }
    }
    
    function switchAuthTab(tab) {
        lobby.authTabs?.forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        
        if (tab === 'login') {
            lobby.loginForm?.style.setProperty('display', 'flex');
            lobby.registerForm?.style.setProperty('display', 'none');
        } else {
            lobby.loginForm?.style.setProperty('display', 'none');
            lobby.registerForm?.style.setProperty('display', 'flex');
        }
        
        hideAuthError();
    }
    
    async function handleLogin(e) {
        e.preventDefault();
        
        const username = lobby.loginUsername?.value?.trim();
        const password = lobby.loginPassword?.value;
        
        if (!username || !password) {
            showAuthError(i18nT('errors.enterUsernamePassword'));
            return;
        }
        
        try {
            const response = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                sessionToken = data.token;
                refreshToken = data.data?.refreshToken || null;
                currentUser = data.user;
                // Normalize ELO to number (backward compat)
                if (currentUser.elo && typeof currentUser.elo === 'object') {
                    currentUser.elo = currentUser.elo.classic ?? 1000;
                } else if (currentUser.elo === undefined) {
                    currentUser.elo = 1000;
                }
                const persistent = document.getElementById('loginRememberMe')?.checked || false;
                setSessionTokens(sessionToken, refreshToken, persistent);
                console.log('[Lobby] Logged in as:', currentUser.pseudo);
                
                // Load user settings from backend
                await loadSettingsFromBackend();
                
                // Update UI displays
                updateUserStatusUI();
                window.UserMenu?.updateDisplay?.();
                
                // Check if we have a pending invite
                if (pendingInviteAfterAuth) {
                    const invite = pendingInviteAfterAuth;
                    pendingInviteAfterAuth = null;
                    // Reconnect socket with auth token (old socket was unauthenticated)
                    await reconnectSocketForInvite();
                    showInviteLandingModal(invite.code, invite.info);
                } else if (sessionStorage.getItem('hexaequo_pending_invite')) {
                    // Page was refreshed during auth — restore invite from sessionStorage
                    handleEarlyInviteCheck();
                } else {
                    // Go back to online options
                    showOnlineOptions();
                }
            } else {
                showAuthError(data.error || i18nT('auth.loginFailed'));
            }
        } catch (err) {
            console.error('[Lobby] Login error:', err);
            showAuthError(i18nT('errors.connectionFailed'));
        }
    }
    
    async function handleRegister(e) {
        e.preventDefault();
        
        const username = lobby.registerUsername?.value?.trim();
        const password = lobby.registerPassword?.value;
        
        if (!username || !password) {
            showAuthError(i18nT('auth.fillAllFields'));
            return;
        }
        
        if (username.length < 3) {
            showAuthError(i18nT('auth.usernameMinLength'));
            return;
        }
        
        if (password.length < 4) {
            showAuthError(i18nT('auth.passwordMinLength'));
            return;
        }
        
        try {
            const response = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    username, 
                    password
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                sessionToken = data.token;
                refreshToken = data.data?.refreshToken || null;
                currentUser = data.user;
                // Normalize ELO to number (backward compat: new users always get flat 1000)
                if (currentUser.elo && typeof currentUser.elo === 'object') {
                    currentUser.elo = currentUser.elo.classic ?? 1000;
                } else if (currentUser.elo === undefined) {
                    currentUser.elo = 1000;
                }
                const persistent = document.getElementById('registerRememberMe')?.checked || false;
                setSessionTokens(sessionToken, refreshToken, persistent);
                console.log('[Lobby] Registered and logged in as:', currentUser.pseudo);
                
                // Save current settings to backend for new user
                const currentSettings = {
                    theme: document.body.getAttribute('data-theme') || 'dark',
                    sound: lobby.soundToggle?.checked ?? true,
                    showValidMoves: lobby.validMovesToggle?.checked ?? false,
                    showPreviousMove: lobby.previousMoveToggle?.checked ?? true,
                    language: window.i18n?.getCurrentLanguage() || 'en'
                };
                saveSettingToBackend('theme', currentSettings.theme);
                saveSettingToBackend('sound', currentSettings.sound);
                saveSettingToBackend('showValidMoves', currentSettings.showValidMoves);
                saveSettingToBackend('showPreviousMove', currentSettings.showPreviousMove);
                saveSettingToBackend('language', currentSettings.language);
                
                // Update UI displays
                updateUserStatusUI();
                window.UserMenu?.updateDisplay?.();
                
                // Check if we have a pending invite to show
                if (pendingInviteAfterAuth) {
                    const invite = pendingInviteAfterAuth;
                    pendingInviteAfterAuth = null;
                    // Reconnect socket with auth token (old socket was unauthenticated)
                    await reconnectSocketForInvite();
                    showInviteLandingModal(invite.code, invite.info);
                } else if (sessionStorage.getItem('hexaequo_pending_invite')) {
                    // Page was refreshed during auth — restore invite from sessionStorage
                    handleEarlyInviteCheck();
                } else {
                    showOnlineOptions();
                }
            } else {
                showAuthError(data.error || i18nT('auth.registrationFailed'));
            }
        } catch (err) {
            console.error('[Lobby] Registration error:', err);
            showAuthError(i18nT('errors.connectionFailed'));
        }
    }
    
    async function handleLogout() {
        // Cancel any waiting room first
        if (currentRoomCode) {
            cancelWaiting();
        }
        
        if (sessionToken) {
            try {
                await fetch(`${API_BASE}/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${sessionToken}`
                    }
                });
            } catch (err) {
                console.error('[Lobby] Logout error:', err);
            }
        }
        
        clearSessionTokens();
        sessionToken = null;
        refreshToken = null;
        currentUser = null;
        
        updateUserStatusUI();
        window.UserMenu?.updateDisplay?.();
        showMainMenu();
        console.log('[Lobby] Logged out');
    }
    
    function showAuthError(message) {
        if (lobby.authError) {
            lobby.authError.textContent = message;
            lobby.authError.style.display = 'block';
        }
    }
    
    function hideAuthError() {
        if (lobby.authError) {
            lobby.authError.style.display = 'none';
        }
    }

    // ==================== Public API ====================
    window.GameLobby = {
        init,
        show: showLobby,
        hide: hideLobby,
        getUser: () => currentUser,
        getOpponent: () => currentOpponent,
        getSessionToken: () => sessionToken,
        authenticatedFetch,
        updatePlayerInfoDisplays,
        setTimeControl: (control) => {
            selectedTimeControl = control;
        },
        getTimeControl: () => selectedTimeControl,
        updateUserElo: (newElo) => {
            if (currentUser) {
                currentUser.elo = newElo;
                updateUserStatusUI();
                window.UserMenu?.updateDisplay?.();
                console.log('[Lobby] Updated user ELO to:', newElo);
            }
        },
        logout: handleLogout
    };

    // Also expose as window.Lobby for compatibility
    window.Lobby = window.GameLobby;
    
    // Expose showMainMenu for hamburger menu access
    window.showLobbyMainMenu = showMainMenu;

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
