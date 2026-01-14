/**
 * Hexaequo - Lobby Controller
 * 
 * Handles the main menu/lobby UI, game mode selection,
 * and online room creation/joining.
 */

(function() {
    'use strict';

    // ==================== Configuration ====================
    const BACKEND_PORT = 3000;
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
    let currentOpponent = null; // Stores opponent info for online games
    let pendingInviteAfterAuth = null; // Stores invite info while user is signing in
    
    // Local game configuration
    let localGameConfig = {
        blackPlayer: 'human',  // 'human' or 'ai'
        blackAiLevel: 3,
        whitePlayer: 'human',  // 'human' or 'ai'
        whiteAiLevel: 3,
        timeControl: 'none'
    };
    
    // Room list state
    let allRooms = []; // All rooms from server
    let filteredRooms = []; // Rooms after filtering
    let sortColumn = null;
    let sortDirection = 'asc'; // 'asc' or 'desc'

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
    function init() {
        // Cache DOM elements
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
        lobby.createRoomBtn = document.getElementById('lobbyCreateRoomBtn');
        lobby.roomCodeInput = document.getElementById('lobbyRoomCodeInput');
        lobby.joinRoomBtn = document.getElementById('lobbyJoinRoomBtn');
        lobby.waitingSection = document.getElementById('lobbyWaitingSection');
        lobby.cancelBtn = document.getElementById('lobbyCancelBtn');
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
        
        // Room browser
        lobby.refreshRoomsBtn = document.getElementById('refreshRoomsBtn');
        lobby.roomListBody = document.getElementById('roomListBody');
        lobby.roomListEmpty = document.getElementById('roomListEmpty');
        lobby.filterNone = document.getElementById('filterNone');
        lobby.filterClassic = document.getElementById('filterClassic');
        lobby.filterRapid = document.getElementById('filterRapid');
        lobby.filterBlitz = document.getElementById('filterBlitz');
        lobby.filterBullet = document.getElementById('filterBullet');
        lobby.filterGuests = document.getElementById('filterGuests');
        lobby.filterUsers = document.getElementById('filterUsers');
        lobby.eloMin = document.getElementById('eloMin');
        lobby.eloMax = document.getElementById('eloMax');
        lobby.sortableHeaders = document.querySelectorAll('.room-list-table th.sortable');
        
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
        
        // Filter toggle
        lobby.filterToggleBtn = document.getElementById('filterToggleBtn');
        lobby.roomFilters = document.getElementById('roomFilters');

        // Set up event listeners
        setupEventListeners();
        
        // Load saved preferences from localStorage
        loadLocalGameConfig();
        
        // Sync settings with existing toggles
        syncSettingsFromGame();
        
        // Initialize language selector
        initializeLanguageSelect();
        
        // Check for existing session, then check for invite code
        checkExistingSession().then(() => {
            handleEarlyInviteCheck();
        });
        
        // Initialize Matchmaking system (Phase 2)
        if (window.Matchmaking) {
            window.Matchmaking.init({
                elo: currentUser?.elo || 1000,
                onMatchFound: handleMatchFound,
                onQueueStatusChange: (status) => {
                    console.log('[Lobby] Queue status changed:', status);
                }
            });
        }
        
        // Initialize QR Code modal (Phase 2)
        if (window.QrCodeModal) {
            window.QrCodeModal.init();
        }
        
        console.log('[Lobby] Initialized');
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
        lobby.createRoomBtn?.addEventListener('click', createRoom);
        lobby.cancelBtn?.addEventListener('click', cancelWaiting);
        lobby.backFromOnlineBtn?.addEventListener('click', showMainMenu);
        
        // Room browser
        lobby.refreshRoomsBtn?.addEventListener('click', refreshRoomList);
        lobby.filterNone?.addEventListener('change', applyFiltersAndRender);
        lobby.filterClassic?.addEventListener('change', applyFiltersAndRender);
        lobby.filterRapid?.addEventListener('change', applyFiltersAndRender);
        lobby.filterBlitz?.addEventListener('change', applyFiltersAndRender);
        lobby.filterBullet?.addEventListener('change', applyFiltersAndRender);
        lobby.filterGuests?.addEventListener('change', applyFiltersAndRender);
        lobby.filterUsers?.addEventListener('change', applyFiltersAndRender);
        lobby.eloMin?.addEventListener('input', debounce(applyFiltersAndRender, 300));
        lobby.eloMax?.addEventListener('input', debounce(applyFiltersAndRender, 300));
        lobby.sortableHeaders?.forEach(th => {
            th.addEventListener('click', () => handleSortClick(th.dataset.sort));
        });
        
        // User status / auth
        lobby.loginBtn?.addEventListener('click', handleLoginBtnClick);
        
        // Auth section
        lobby.authTabs?.forEach(tab => {
            tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
        });
        lobby.loginForm?.addEventListener('submit', handleLogin);
        lobby.registerForm?.addEventListener('submit', handleRegister);
        lobby.backFromAuthBtn?.addEventListener('click', showOnlineOptions);
        
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
        
        // Filter toggle
        lobby.filterToggleBtn?.addEventListener('click', toggleFilters);
        
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
                await fetch(`${API_BASE}/users/me/settings`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${sessionToken}`
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
            const response = await fetch(`${API_BASE}/users/me/settings`, {
                headers: { 'Authorization': `Bearer ${sessionToken}` }
            });
            
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
        
        // Update user status display
        updateUserStatusUI();
        
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
            const localIsGuest = !localUser;
            const localName = localUser ? (localUser.pseudo || localUser.username) : i18nT('lobby.guest');
            const localElo = localIsGuest ? '?' : (localUser.elo || 1000);
            
            const opponentIsGuest = !opponentInfo || opponentInfo.isGuest;
            const opponentName = opponentInfo?.name || i18nT('lobby.guest');
            const opponentElo = opponentIsGuest ? '?' : (opponentInfo?.elo || 1000);
            
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
                name: oppData.pseudo || oppData.name || i18nT('lobby.guest'), 
                elo: oppData.elo || null, 
                isGuest: oppData.isGuest ?? true 
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

    function createRoom() {
        if (!isConnected) {
            showError(i18nT('lobby.notConnected'));
            return;
        }
        
        hideError();
        console.log('[Lobby] Creating room with time control:', selectedTimeControl);
        
        // Use Multiplayer module's createRoom which handles the protocol correctly
        window.Multiplayer.createRoom(selectedTimeControl).then((result) => {
            console.log('[Lobby] Room created:', result.roomCode, 'timeControl:', result.timeControl);
            currentRoomCode = result.roomCode;
            showWaitingForOpponent(result.roomCode);
        }).catch((err) => {
            console.error('[Lobby] Failed to create room:', err);
            showError(err.message || i18nT('errors.failedToCreateRoom'));
        });
    }

    function joinRoom(roomCode) {
        if (!isConnected) {
            showError(i18nT('lobby.notConnected'));
            return;
        }
        
        const code = roomCode || '';
        if (!code || code.length !== 4) {
            showError(i18nT('errors.invalidRoomCode'));
            return;
        }
        
        // Prevent joining own room (client-side check)
        if (currentRoomCode && code.toUpperCase() === currentRoomCode.toUpperCase()) {
            showError(i18nT('errors.cantJoinOwnRoom'));
            return;
        }
        
        hideError();
        console.log('[Lobby] Joining room:', code);
        
        // Use Multiplayer module's joinRoom
        window.Multiplayer.joinRoom(code).then((result) => {
            console.log('[Lobby] Joined room:', result.roomCode, 'timeControl:', result.timeControl);
            currentRoomCode = result.roomCode;
            if (result.waiting) {
                showWaitingForOpponent(result.roomCode);
            } else {
                // Game is starting - we're the joining player (white)
                // Store opponent info (black player)
                currentOpponent = result.opponentInfo || { name: i18nT('lobby.guest'), elo: null, isGuest: true };
                startOnlineGame({ 
                    playerColor: result.color, 
                    gameState: result.gameState,
                    opponentInfo: currentOpponent,
                    timeControl: result.timeControl,  // Use server's time control
                    timerState: result.timerState     // Sync timer from server
                });
            }
        }).catch((err) => {
            console.error('[Lobby] Failed to join room:', err);
            showError(err.message || i18nT('errors.failedToJoinRoom'));
        });
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
        const inviteCode = urlParams.get('invite');
        
        if (!inviteCode) return false;
        
        console.log('[Lobby] Found invite code in URL:', inviteCode);
        
        // Clear the invite code from URL (without page reload)
        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, newUrl);
        
        // Get invitation info first
        socket.emit('get-invitation-info', { code: inviteCode }, (response) => {
            if (!response.success) {
                // Show browser alert for expired/invalid invite
                const errorMessage = response.error || i18nT('errors.invalidInvite');
                alert(errorMessage);
                return;
            }
            
            // Show the invite landing modal
            showInviteLandingModal(inviteCode, response);
        });
        
        return true; // Indicate that an invite code was found
    }
    
    /**
     * Check for invite code immediately on page load (before connection)
     * Returns true if an invite code is present in URL
     */
    function hasInviteCodeInUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('invite');
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
        const guestBtn = document.getElementById('inviteGuestBtn');
        const signInBtn = document.getElementById('inviteSignInBtn');
        
        // Populate info - show actual host name or Guest if it's a guest
        if (hostPseudoEl) {
            const hostName = inviteInfo.creatorPseudo || i18nT('lobby.guest');
            hostPseudoEl.textContent = hostName;
        }
        
        // Show host ELO if available
        if (hostEloEl) {
            if (inviteInfo.creatorElo && !inviteInfo.creatorIsGuest) {
                hostEloEl.textContent = inviteInfo.creatorElo;
                hostEloEl.style.display = '';
            } else {
                hostEloEl.textContent = '?';
                hostEloEl.style.display = '';
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
            joinBtn.onclick = () => acceptInvitationFromModal(false);
        }
        
        if (guestBtn) {
            guestBtn.style.display = 'block';
            guestBtn.onclick = () => acceptInvitationFromModal(true);
        }
        
        if (signInBtn) {
            // Show sign in button if not logged in
            signInBtn.style.display = isLoggedIn ? 'none' : 'block';
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
    function acceptInvitationFromModal(asGuest) {
        console.log('[Lobby] acceptInvitationFromModal called, asGuest:', asGuest, 'currentInviteCode:', currentInviteCode);
        if (!currentInviteCode) {
            console.error('[Lobby] No currentInviteCode!');
            return;
        }
        
        hideInviteLandingModal();
        acceptInvitation(currentInviteCode, currentInviteInfo, asGuest);
    }
    
    /**
     * Accept an invitation and join the game
     */
    function acceptInvitation(code, inviteInfo, asGuest = false) {
        console.log('[Lobby] Accepting invitation:', code, inviteInfo, asGuest ? '(as guest)' : '');
        console.log('[Lobby] Socket available:', !!socket, 'Connected:', socket?.connected);
        
        if (!socket || !socket.connected) {
            console.error('[Lobby] Socket not available for accept-invitation!');
            showError(i18nT('errors.connectionFailed'));
            return;
        }
        
        // Include ELO when joining so host sees our rating
        const userElo = asGuest ? null : (currentUser?.elo || null);
        
        const payload = { 
            code,
            asGuest,
            pseudo: asGuest ? i18nT('lobby.guest') : (currentUser?.pseudo || currentUser?.username || i18nT('lobby.guest')),
            elo: userElo
        };
        
        socket.emit('accept-invitation', payload, (response) => {
            if (!response.success) {
                showError(response.error || i18nT('errors.failedToJoin'));
                return;
            }
            
            console.log('[Lobby] Invitation accepted, joined room:', response.roomCode);
            currentRoomCode = response.roomCode;
            
            // Set room info in Multiplayer
            if (window.Multiplayer && response.roomCode) {
                window.Multiplayer.setRoomInfo(response.roomCode, response.color || 'white');
            }
            
            // Store opponent info
            currentOpponent = {
                name: response.opponentInfo?.name || inviteInfo.creatorPseudo || i18nT('lobby.guest'),
                elo: response.opponentInfo?.elo,
                isGuest: response.opponentInfo?.isGuest ?? true
            };
            
            // Start the game as white (guest)
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
        currentOpponent = data.opponentInfo || { name: 'Opponent', elo: null, isGuest: true };
        
        startOnlineGame({
            playerColor: data.color,
            gameState: data.gameState,
            opponentInfo: currentOpponent,
            timeControl: data.timeMode
        });
    }

    // ==================== Room List Functions ====================
    
    // Debounce helper
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    // Fetch room list from server (legacy - kept for compatibility)
    function fetchRoomList() {
        if (!socket || !socket.connected) {
            console.log('[Lobby] Cannot fetch rooms - not connected');
            return;
        }
        
        socket.emit('get-room-list', (response) => {
            if (response.success) {
                allRooms = response.rooms || [];
                console.log('[Lobby] Fetched', allRooms.length, 'rooms');
                applyFiltersAndRender();
            } else {
                console.error('[Lobby] Failed to fetch rooms:', response.error);
                allRooms = [];
                renderRoomList();
            }
        });
    }
    
    // Refresh room list with animation
    function refreshRoomList() {
        const btn = lobby.refreshRoomsBtn;
        if (btn) {
            btn.classList.add('spinning');
            setTimeout(() => btn.classList.remove('spinning'), 500);
        }
        fetchRoomList();
    }
    
    // Apply filters to the room list
    function applyFiltersAndRender() {
        const filters = {
            timeControls: {
                none: lobby.filterNone?.checked ?? true,
                classic: lobby.filterClassic?.checked ?? true,
                rapid: lobby.filterRapid?.checked ?? true,
                blitz: lobby.filterBlitz?.checked ?? true,
                bullet: lobby.filterBullet?.checked ?? true
            },
            showGuests: lobby.filterGuests?.checked ?? true,
            showUsers: lobby.filterUsers?.checked ?? true,
            eloMin: parseInt(lobby.eloMin?.value) || 0,
            eloMax: parseInt(lobby.eloMax?.value) || Infinity
        };
        
        filteredRooms = allRooms.filter(room => {
            // Time control filter
            if (!filters.timeControls[room.timeControl]) return false;
            
            // Guest/User filter
            if (room.isGuest && !filters.showGuests) return false;
            if (!room.isGuest && !filters.showUsers) return false;
            
            // ELO filter (only applies to non-guests with ELO)
            if (room.creatorElo !== null) {
                if (room.creatorElo < filters.eloMin) return false;
                if (room.creatorElo > filters.eloMax) return false;
            }
            
            return true;
        });
        
        // Apply sorting
        if (sortColumn) {
            sortRooms();
        }
        
        renderRoomList();
    }
    
    // Handle sort header click
    function handleSortClick(column) {
        // Toggle direction if same column, else set to asc
        if (sortColumn === column) {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            sortColumn = column;
            sortDirection = 'asc';
        }
        
        // Update header UI
        lobby.sortableHeaders?.forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === sortColumn) {
                th.classList.add(sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
        
        sortRooms();
        renderRoomList();
    }
    
    // Sort the filtered rooms
    function sortRooms() {
        const timeControlOrder = { none: 0, bullet: 1, blitz: 2, rapid: 3, classic: 4 };
        
        filteredRooms.sort((a, b) => {
            let comparison = 0;
            
            switch (sortColumn) {
                case 'timeControl':
                    comparison = timeControlOrder[a.timeControl] - timeControlOrder[b.timeControl];
                    break;
                case 'creatorName':
                    comparison = (a.creatorName || '').localeCompare(b.creatorName || '');
                    break;
                case 'creatorElo':
                    const eloA = a.creatorElo ?? -1;
                    const eloB = b.creatorElo ?? -1;
                    comparison = eloA - eloB;
                    break;
            }
            
            return sortDirection === 'desc' ? -comparison : comparison;
        });
    }
    
    // Render room list to DOM
    function renderRoomList() {
        const tbody = lobby.roomListBody;
        const emptyMsg = lobby.roomListEmpty;
        
        if (!tbody) return;
        
        // Clear existing rows
        tbody.innerHTML = '';
        
        // Time labels - these are universal abbreviations, kept as-is
        const timeLabels = {
            none: i18nT('lobby.none'),
            classic: '15|0',
            rapid: '10|5',
            blitz: '5|3',
            bullet: '2|1'
        };
        
        if (filteredRooms.length === 0) {
            emptyMsg?.style.setProperty('display', 'block');
            return;
        }
        
        emptyMsg?.style.setProperty('display', 'none');
        
        filteredRooms.forEach(room => {
            const tr = document.createElement('tr');
            tr.dataset.roomCode = room.roomCode;
            
            // Check if this is the user's own room
            const isOwnRoom = currentRoomCode && room.roomCode.toUpperCase() === currentRoomCode.toUpperCase();
            
            if (isOwnRoom) {
                tr.classList.add('own-room');
                tr.title = 'Your room';
            } else {
                tr.addEventListener('click', () => joinRoom(room.roomCode));
            }
            
            // Time control cell
            const tdTime = document.createElement('td');
            const badge = document.createElement('span');
            badge.className = `time-badge ${room.timeControl}`;
            badge.textContent = timeLabels[room.timeControl] || room.timeControl;
            tdTime.appendChild(badge);
            tr.appendChild(tdTime);
            
            // Player name cell
            const tdName = document.createElement('td');
            tdName.textContent = room.creatorName || i18nT('lobby.guest');
            if (isOwnRoom) {
                tdName.textContent += ' ' + i18nT('lobby.you');
            }
            tr.appendChild(tdName);
            
            // ELO cell
            const tdElo = document.createElement('td');
            tdElo.textContent = room.creatorElo !== null ? room.creatorElo : '-';
            tr.appendChild(tdElo);
            
            tbody.appendChild(tr);
        });
    }
    
    // Set up real-time room list updates
    function setupRoomListListeners() {
        if (!socket) return;
        
        // Remove existing listeners
        socket.off('room-created');
        socket.off('room-filled');
        socket.off('room-cancelled');
        
        // New room created
        socket.on('room-created', (room) => {
            console.log('[Lobby] Room created:', room.roomCode);
            // Add to list if not already present
            if (!allRooms.find(r => r.roomCode === room.roomCode)) {
                allRooms.push(room);
                applyFiltersAndRender();
            }
        });
        
        // Room was joined (no longer available)
        socket.on('room-filled', (data) => {
            console.log('[Lobby] Room filled:', data.roomCode);
            allRooms = allRooms.filter(r => r.roomCode !== data.roomCode);
            applyFiltersAndRender();
        });
        
        // Room was cancelled
        socket.on('room-cancelled', (data) => {
            console.log('[Lobby] Room cancelled:', data.roomCode);
            allRooms = allRooms.filter(r => r.roomCode !== data.roomCode);
            applyFiltersAndRender();
        });
    }

    function showWaitingForOpponent(roomCode) {
        // Show waiting section but keep room browser visible
        lobby.waitingSection?.style.setProperty('display', 'flex');
        
        // Store current room code for own-room detection
        currentRoomCode = roomCode;
        
        // Hide the create room button while waiting
        if (lobby.createRoomBtn) {
            lobby.createRoomBtn.style.display = 'none';
        }
    }

    function cancelWaiting() {
        if (currentRoomCode) {
            // Use Multiplayer.leaveRoom which handles the protocol correctly
            if (window.Multiplayer && window.Multiplayer.leaveRoom) {
                window.Multiplayer.leaveRoom().catch(err => {
                    console.error('[Lobby] Failed to leave room:', err);
                });
            }
        }
        currentRoomCode = null;
        
        lobby.waitingSection?.style.setProperty('display', 'none');
        
        // Show create room button again
        if (lobby.createRoomBtn) {
            lobby.createRoomBtn.style.display = '';
        }
    }

    function startOnlineGame(data) {
        console.log('[Lobby] Starting online game', data);
        
        // Close any open modals
        if (window.QrCodeModal && window.QrCodeModal.isOpen) {
            window.QrCodeModal.close();
        }
        
        const playerColor = data.playerColor || window.Multiplayer.playerColor;
        const opponentInfo = data.opponentInfo || currentOpponent;
        
        console.log('[Lobby] playerColor:', playerColor);
        console.log('[Lobby] opponentInfo:', opponentInfo);
        console.log('[Lobby] currentUser:', currentUser);
        
        // Set online mode directly in game.js (don't trigger gameModeSelect change which opens old modal)
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
        updatePlayerInfoDisplays('online', null, playerColor, opponentInfo);
        
        // Set the time control and sync timer from server
        const timeControl = data.timeControl || selectedTimeControl;
        if (window.GameTimer) {
            window.GameTimer.setTimeControl(timeControl);
            window.GameTimer.setOnlineMode(true);
            
            // Sync timer state from server if available
            if (data.timerState) {
                window.GameTimer.syncFromServer(data.timerState);
            }
        }
        
        // Hide lobby
        hideLobby();
        
        // Trigger new game
        triggerNewGame();
        
        // Apply initial game state from server if available
        if (data.gameState && window.applyOnlineMove) {
            console.log('[Lobby] Applying initial game state from server');
            // Pass null as previousState to indicate initial sync
            setTimeout(() => {
                window.applyOnlineMove(data.gameState, null);
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
        if (lobby.profileModal) {
            lobby.profileModal.style.display = 'flex';
        }
    }
    
    function closeProfileModal() {
        if (lobby.profileModal) {
            lobby.profileModal.style.display = 'none';
        }
    }
    
    // ==================== Filter Toggle ====================
    function toggleFilters() {
        lobby.filterToggleBtn?.classList.toggle('collapsed');
        lobby.roomFilters?.classList.toggle('collapsed');
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
        // Click the New Game button in the existing menu
        const newGameBtn = document.getElementById('newGameBtn');
        if (newGameBtn) {
            newGameBtn.click();
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
        // Check for stored session token
        sessionToken = localStorage.getItem('hexaequo_session');
        if (!sessionToken) {
            currentUser = null;
            return;
        }
        
        try {
            const response = await fetch(`${API_BASE}/auth/me`, {
                headers: {
                    'Authorization': `Bearer ${sessionToken}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                currentUser = data.user;
                console.log('[Lobby] Session restored for:', currentUser.pseudo);
                
                // Load user settings from backend
                await loadSettingsFromBackend();
                
                // Update user menu display
                window.UserMenu?.updateDisplay?.();
            } else {
                // Invalid session, clear it
                localStorage.removeItem('hexaequo_session');
                sessionToken = null;
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
        } else {
            // Guest
            if (lobby.userDisplayName) {
                lobby.userDisplayName.textContent = i18nT('lobby.guest');
            }
            if (lobby.userEloDisplay) {
                lobby.userEloDisplay.textContent = '';
            }
            if (lobby.loginBtn) {
                lobby.loginBtn.textContent = i18nT('auth.signIn');
            }
            if (lobby.profileBtn) {
                lobby.profileBtn.style.display = 'none';
            }
        }
        
        // Update matchmaking section based on login status
        updateMatchmakingUI();
    }
    
    /**
     * Update matchmaking section UI based on login status
     * Shows/hides invite button and guest restriction message
     */
    function updateMatchmakingUI() {
        const inviteBtn = document.getElementById('matchmakingInviteBtn');
        const guestRestriction = document.getElementById('guestInviteRestriction');
        const guestSignInBtn = document.getElementById('guestSignInBtn');
        
        if (currentUser) {
            // Logged in - show invite button, hide restriction
            if (inviteBtn) inviteBtn.style.display = '';
            if (guestRestriction) guestRestriction.style.display = 'none';
        } else {
            // Guest - hide invite button, show restriction
            if (inviteBtn) inviteBtn.style.display = 'none';
            if (guestRestriction) guestRestriction.style.display = 'flex';
        }
        
        // Set up sign in button handler
        if (guestSignInBtn) {
            guestSignInBtn.onclick = () => showAuthSection();
        }
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
                currentUser = data.user;
                localStorage.setItem('hexaequo_session', sessionToken);
                console.log('[Lobby] Logged in as:', currentUser.pseudo);
                
                // Load user settings from backend
                await loadSettingsFromBackend();
                
                // Update user menu display
                window.UserMenu?.updateDisplay?.();
                
                // Check if we have a pending invite
                if (pendingInviteAfterAuth) {
                    const invite = pendingInviteAfterAuth;
                    pendingInviteAfterAuth = null;
                    showInviteLandingModal(invite.code, invite.info);
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
                currentUser = data.user;
                localStorage.setItem('hexaequo_session', sessionToken);
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
                
                // Update user menu display
                window.UserMenu?.updateDisplay?.();
                
                // Check if we have a pending invite to show
                if (pendingInviteAfterAuth) {
                    const invite = pendingInviteAfterAuth;
                    pendingInviteAfterAuth = null;
                    showInviteLandingModal(invite.code, invite.info);
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
        
        localStorage.removeItem('hexaequo_session');
        sessionToken = null;
        currentUser = null;
        
        updateUserStatusUI();
        window.UserMenu?.updateDisplay?.();
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

    function onCreateRoom() {
        const playerName = document.getElementById('playerNameInput').value.trim();
        if (!playerName) {
            alert('Please enter your name');
            return;
        }

        window.isLocalMode = false;
        window.isOnlineMode = true;

        createRoom(playerName);
    }

    function onJoinRoom() {
        const playerName = document.getElementById('playerNameInput').value.trim();
        const roomCode = document.getElementById('roomCodeInput').value.trim();

        if (!playerName || !roomCode) {
            alert('Please enter both your name and room code');
            return;
        }

        window.isLocalMode = false;
        window.isOnlineMode = true;

        joinRoom(playerName, roomCode);
    }
})();
