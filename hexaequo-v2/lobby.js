/**
 * Hexaequo - Lobby Controller
 * 
 * Handles the main menu/lobby UI, game mode selection,
 * and online room creation/joining.
 */

(function() {
    'use strict';

    // ==================== Configuration ====================
    const API_BASE = 'http://localhost:3000/api';

    // ==================== State ====================
    let selectedDifficulty = 3;
    let selectedTimeControl = 'classic'; // Default time control for online games
    let socket = null;
    let isConnected = false;
    let currentRoomCode = null;
    let currentUser = null;
    let sessionToken = null;
    let currentOpponent = null; // Stores opponent info for online games
    
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
        playAiBtn: null,
        playOnlineBtn: null,
        // AI section
        aiOptions: null,
        startAiGameBtn: null,
        backFromAiBtn: null,
        difficultyBtns: null,
        // Online section
        onlineOptions: null,
        connectionStatus: null,
        roomActions: null,
        createRoomBtn: null,
        roomCodeInput: null,
        joinRoomBtn: null,
        waitingSection: null,
        roomCodeDisplay: null,
        copyCodeBtn: null,
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
        registerDisplayName: null,
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
        animationsToggle: null,
        // Footer
        rulesBtn: null,
        settingsBtn: null
    };

    // ==================== Initialization ====================
    function init() {
        // Cache DOM elements
        lobby.overlay = document.getElementById('lobbyOverlay');
        lobby.playLocalBtn = document.getElementById('playLocalBtn');
        lobby.playAiBtn = document.getElementById('playAiBtn');
        lobby.playOnlineBtn = document.getElementById('playOnlineBtn');
        
        lobby.aiOptions = document.getElementById('aiOptions');
        lobby.startAiGameBtn = document.getElementById('startAiGameBtn');
        lobby.backFromAiBtn = document.getElementById('backFromAiBtn');
        lobby.difficultyBtns = document.querySelectorAll('.diff-btn');
        
        lobby.onlineOptions = document.getElementById('onlineOptions');
        lobby.connectionStatus = document.getElementById('lobbyConnectionStatus');
        lobby.roomActions = document.getElementById('lobbyRoomActions');
        lobby.createRoomBtn = document.getElementById('lobbyCreateRoomBtn');
        lobby.roomCodeInput = document.getElementById('lobbyRoomCodeInput');
        lobby.joinRoomBtn = document.getElementById('lobbyJoinRoomBtn');
        lobby.waitingSection = document.getElementById('lobbyWaitingSection');
        lobby.roomCodeDisplay = document.getElementById('lobbyRoomCode');
        lobby.copyCodeBtn = document.getElementById('lobbyCopyCodeBtn');
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
        lobby.registerDisplayName = document.getElementById('registerDisplayName');
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
        lobby.animationsToggle = document.getElementById('lobbyAnimationsToggle');
        
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
        
        // Sync settings with existing toggles
        syncSettingsFromGame();
        
        // Check for existing session
        checkExistingSession();
        
        console.log('[Lobby] Initialized');
    }

    // ==================== Event Listeners ====================
    function setupEventListeners() {
        // Main menu buttons
        lobby.playLocalBtn?.addEventListener('click', startLocalGame);
        lobby.playAiBtn?.addEventListener('click', showAiOptions);
        lobby.playOnlineBtn?.addEventListener('click', showOnlineOptions);
        
        // AI options
        lobby.startAiGameBtn?.addEventListener('click', startAiGame);
        lobby.backFromAiBtn?.addEventListener('click', showMainMenu);
        lobby.difficultyBtns?.forEach(btn => {
            btn.addEventListener('click', () => selectDifficulty(btn));
        });
        
        // Online options
        lobby.createRoomBtn?.addEventListener('click', createRoom);
        lobby.copyCodeBtn?.addEventListener('click', copyRoomCode);
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
        lobby.settingsBtn?.addEventListener('click', showSettings);
        lobby.backFromSettingsBtn?.addEventListener('click', showMainMenu);
        lobby.themeToggle?.addEventListener('change', handleThemeChange);
        lobby.soundToggle?.addEventListener('change', handleSoundChange);
        lobby.validMovesToggle?.addEventListener('change', handleValidMovesChange);
        lobby.previousMoveToggle?.addEventListener('change', handlePreviousMoveChange);
        lobby.animationsToggle?.addEventListener('change', handleAnimationsChange);
        
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
        
        // Footer
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
        const gameAnimationsToggle = document.getElementById('animationsToggle');
        
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
        if (gameAnimationsToggle && lobby.animationsToggle) {
            lobby.animationsToggle.checked = gameAnimationsToggle.checked;
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
    }

    function handleSoundChange() {
        const gameToggle = document.getElementById('soundToggle');
        if (gameToggle) {
            gameToggle.checked = lobby.soundToggle?.checked;
            gameToggle.dispatchEvent(new Event('change'));
        }
    }

    function handleValidMovesChange() {
        const gameToggle = document.getElementById('validMovesToggle');
        if (gameToggle) {
            gameToggle.checked = lobby.validMovesToggle?.checked;
            gameToggle.dispatchEvent(new Event('change'));
        }
    }

    function handlePreviousMoveChange() {
        const gameToggle = document.getElementById('previousMoveToggle');
        if (gameToggle) {
            gameToggle.checked = lobby.previousMoveToggle?.checked;
            gameToggle.dispatchEvent(new Event('change'));
        }
    }

    function handleAnimationsChange() {
        const gameToggle = document.getElementById('animationsToggle');
        if (gameToggle) {
            gameToggle.checked = lobby.animationsToggle?.checked;
            gameToggle.dispatchEvent(new Event('change'));
        }
    }

    // ==================== Menu Navigation ====================
    function showMainMenu() {
        // Hide all sections
        document.querySelector('.mode-selection')?.style.setProperty('display', 'flex');
        lobby.aiOptions?.style.setProperty('display', 'none');
        lobby.onlineOptions?.style.setProperty('display', 'none');
        lobby.settingsSection?.style.setProperty('display', 'none');
        lobby.authSection?.style.setProperty('display', 'none');
        
        // Show footer
        document.querySelector('.lobby-footer')?.style.setProperty('display', 'flex');
        
        // Disconnect socket if in waiting state
        if (currentRoomCode && !isConnected) {
            currentRoomCode = null;
        }
        
        hideError();
        hideAuthError();
    }

    function showAiOptions() {
        document.querySelector('.mode-selection')?.style.setProperty('display', 'none');
        lobby.aiOptions?.style.setProperty('display', 'flex');
        lobby.onlineOptions?.style.setProperty('display', 'none');
        lobby.settingsSection?.style.setProperty('display', 'none');
        lobby.authSection?.style.setProperty('display', 'none');
        document.querySelector('.lobby-footer')?.style.setProperty('display', 'none');
    }

    function showOnlineOptions() {
        document.querySelector('.mode-selection')?.style.setProperty('display', 'none');
        lobby.aiOptions?.style.setProperty('display', 'none');
        lobby.onlineOptions?.style.setProperty('display', 'flex');
        lobby.settingsSection?.style.setProperty('display', 'none');
        lobby.authSection?.style.setProperty('display', 'none');
        document.querySelector('.lobby-footer')?.style.setProperty('display', 'none');
        
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
        lobby.aiOptions?.style.setProperty('display', 'none');
        lobby.onlineOptions?.style.setProperty('display', 'none');
        lobby.settingsSection?.style.setProperty('display', 'flex');
        lobby.authSection?.style.setProperty('display', 'none');
        document.querySelector('.lobby-footer')?.style.setProperty('display', 'none');
        
        // Sync settings
        syncSettingsFromGame();
    }
    
    function showAuthSection() {
        document.querySelector('.mode-selection')?.style.setProperty('display', 'none');
        lobby.aiOptions?.style.setProperty('display', 'none');
        lobby.onlineOptions?.style.setProperty('display', 'none');
        lobby.settingsSection?.style.setProperty('display', 'none');
        lobby.authSection?.style.setProperty('display', 'flex');
        document.querySelector('.lobby-footer')?.style.setProperty('display', 'none');
        
        // Clear forms
        lobby.loginForm?.reset();
        lobby.registerForm?.reset();
        hideAuthError();
    }

    // ==================== Game Start Functions ====================
    const difficultyNames = {
        1: 'Easy',
        2: 'Normal',
        3: 'Hard',
        4: 'Expert'
    };
    
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
                const userName = currentUser.pseudo || currentUser.username || 'Player';
                blackName.textContent = userName;
                blackRating.textContent = `ELO: ${currentUser.elo || 1000}`;
            } else {
                blackName.textContent = 'Player';
                blackRating.textContent = '';
            }
            
            whiteName.textContent = 'AI';
            whiteRating.textContent = difficultyNames[aiLevel] || 'Hard';
        } else if (mode === '2player') {
            blackName.textContent = 'Black';
            blackRating.textContent = '';
            whiteName.textContent = 'White';
            whiteRating.textContent = '';
        } else if (mode === 'online') {
            // Determine which player is local and which is opponent based on playerColor
            const localUser = currentUser;
            const localIsGuest = !localUser;
            const localName = localUser ? (localUser.pseudo || localUser.username) : 'Guest';
            const localElo = localIsGuest ? '?' : (localUser.elo || 1000);
            
            const opponentIsGuest = !opponentInfo || opponentInfo.isGuest;
            const opponentName = opponentInfo?.name || 'Guest';
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
    
    function startLocalGame() {
        console.log('[Lobby] Starting local 2-player game');
        
        // Set game mode via the existing select (game.js uses this)
        const gameModeSelect = document.getElementById('gameModeSelect');
        if (gameModeSelect) {
            gameModeSelect.value = '2player';
            gameModeSelect.dispatchEvent(new Event('change'));
        }
        
        // No timer for local games (friendly)
        if (window.GameTimer) {
            window.GameTimer.setTimeControl('none');
        }
        
        // Update player displays
        updatePlayerInfoDisplays('2player');
        
        // Hide lobby and start game
        hideLobby();
        
        // Trigger new game
        triggerNewGame();
    }

    function startAiGame() {
        console.log('[Lobby] Starting AI game with difficulty:', selectedDifficulty);
        
        // Set game mode
        const gameModeSelect = document.getElementById('gameModeSelect');
        if (gameModeSelect) {
            gameModeSelect.value = 'ai';
            gameModeSelect.dispatchEvent(new Event('change'));
        }
        
        // Set difficulty
        const difficultySelect = document.getElementById('difficultySelect');
        if (difficultySelect) {
            difficultySelect.value = selectedDifficulty.toString();
            difficultySelect.dispatchEvent(new Event('change'));
        }
        
        // No timer for AI games
        if (window.GameTimer) {
            window.GameTimer.setTimeControl('none');
        }
        
        // Update player displays
        updatePlayerInfoDisplays('ai', selectedDifficulty);
        
        hideLobby();
        triggerNewGame();
    }

    function selectDifficulty(btn) {
        lobby.difficultyBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedDifficulty = parseInt(btn.dataset.level, 10);
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
                onConnectionError('Could not connect to server');
            });
        } else {
            onConnectionError('Multiplayer not available');
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
            // Store opponent info
            currentOpponent = data.opponentInfo || { name: 'Guest', elo: null, isGuest: true };
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
        const statusDot = lobby.connectionStatus?.querySelector('.status-dot');
        const statusText = lobby.connectionStatus?.querySelector('.status-text');
        
        if (statusDot) {
            statusDot.classList.remove('connecting', 'error');
            statusDot.classList.add('connected');
        }
        if (statusText) {
            statusText.textContent = 'Connected';
        }
        
        lobby.roomActions?.style.setProperty('display', 'flex');
        
        // Set up real-time room list updates
        setupRoomListListeners();
        
        // Fetch initial room list
        fetchRoomList();
    }

    function onConnectionError(message) {
        isConnected = false;
        const statusDot = lobby.connectionStatus?.querySelector('.status-dot');
        const statusText = lobby.connectionStatus?.querySelector('.status-text');
        
        if (statusDot) {
            statusDot.classList.remove('connecting', 'connected');
            statusDot.classList.add('error');
        }
        if (statusText) {
            statusText.textContent = message || 'Connection failed';
        }
        
        lobby.roomActions?.style.setProperty('display', 'none');
    }

    function createRoom() {
        if (!isConnected) {
            showError('Not connected to server');
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
            showError(err.message || 'Failed to create room');
        });
    }

    function joinRoom(roomCode) {
        if (!isConnected) {
            showError('Not connected to server');
            return;
        }
        
        const code = roomCode || '';
        if (!code || code.length !== 4) {
            showError('Invalid room code');
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
                currentOpponent = result.opponentInfo || { name: 'Guest', elo: null, isGuest: true };
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
            showError(err.message || 'Failed to join room');
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
    
    // Fetch room list from server
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
        
        if (filteredRooms.length === 0) {
            emptyMsg?.style.setProperty('display', 'block');
            return;
        }
        
        emptyMsg?.style.setProperty('display', 'none');
        
        // Time control labels
        const timeLabels = {
            none: 'None',
            classic: '15|0',
            rapid: '10|5',
            blitz: '5|3',
            bullet: '2|1'
        };
        
        filteredRooms.forEach(room => {
            const tr = document.createElement('tr');
            tr.dataset.roomCode = room.roomCode;
            tr.addEventListener('click', () => joinRoom(room.roomCode));
            
            // Time control cell
            const tdTime = document.createElement('td');
            const badge = document.createElement('span');
            badge.className = `time-badge ${room.timeControl}`;
            badge.textContent = timeLabels[room.timeControl] || room.timeControl;
            tdTime.appendChild(badge);
            tr.appendChild(tdTime);
            
            // Player name cell
            const tdName = document.createElement('td');
            tdName.textContent = room.creatorName || 'Guest';
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
        lobby.roomActions?.style.setProperty('display', 'none');
        lobby.waitingSection?.style.setProperty('display', 'block');
        
        if (lobby.roomCodeDisplay) {
            lobby.roomCodeDisplay.textContent = roomCode;
        }
    }

    function copyRoomCode() {
        const code = lobby.roomCodeDisplay?.textContent;
        if (code && code !== '----') {
            navigator.clipboard.writeText(code).then(() => {
                // Visual feedback
                const btn = lobby.copyCodeBtn;
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 1500);
            });
        }
    }

    function cancelWaiting() {
        if (socket && currentRoomCode) {
            socket.emit('leaveRoom');
        }
        currentRoomCode = null;
        
        lobby.waitingSection?.style.setProperty('display', 'none');
        lobby.roomActions?.style.setProperty('display', 'flex');
    }

    function startOnlineGame(data) {
        console.log('[Lobby] Starting online game', data);
        
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
        lobby.overlay?.classList.add('hidden');
    }

    function showLobby() {
        lobby.overlay?.classList.remove('hidden');
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
        // Open the rules overlay and initialize PDF viewer if needed
        const rulesOverlay = document.getElementById('rulesOverlay');
        if (rulesOverlay) {
            rulesOverlay.classList.add('open');
            // Trigger PDF initialization if available
            if (window.initializePdfViewer && !window.pdfDoc) {
                window.initializePdfViewer();
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
                lobby.loginBtn.textContent = 'Sign Out';
            }
            if (lobby.profileBtn) {
                lobby.profileBtn.style.display = 'inline-block';
            }
        } else {
            // Guest
            if (lobby.userDisplayName) {
                lobby.userDisplayName.textContent = 'Guest';
            }
            if (lobby.userEloDisplay) {
                lobby.userEloDisplay.textContent = '';
            }
            if (lobby.loginBtn) {
                lobby.loginBtn.textContent = 'Sign In';
            }
            if (lobby.profileBtn) {
                lobby.profileBtn.style.display = 'none';
            }
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
            showAuthError('Please enter username and password');
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
                
                // Go back to online options
                showOnlineOptions();
            } else {
                showAuthError(data.error || 'Login failed');
            }
        } catch (err) {
            console.error('[Lobby] Login error:', err);
            showAuthError('Connection failed');
        }
    }
    
    async function handleRegister(e) {
        e.preventDefault();
        
        const username = lobby.registerUsername?.value?.trim();
        const displayName = lobby.registerDisplayName?.value?.trim();
        const password = lobby.registerPassword?.value;
        
        if (!username || !password) {
            showAuthError('Please enter username and password');
            return;
        }
        
        if (username.length < 3) {
            showAuthError('Username must be at least 3 characters');
            return;
        }
        
        if (password.length < 4) {
            showAuthError('Password must be at least 4 characters');
            return;
        }
        
        try {
            const response = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    username, 
                    password,
                    displayName: displayName || username
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                sessionToken = data.token;
                currentUser = data.user;
                localStorage.setItem('hexaequo_session', sessionToken);
                console.log('[Lobby] Registered and logged in as:', currentUser.pseudo);
                
                // Go back to online options
                showOnlineOptions();
            } else {
                showAuthError(data.error || 'Registration failed');
            }
        } catch (err) {
            console.error('[Lobby] Registration error:', err);
            showAuthError('Connection failed');
        }
    }
    
    async function handleLogout() {
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
                console.log('[Lobby] Updated user ELO to:', newElo);
            }
        }
    };

    // Also expose as window.Lobby for compatibility
    window.Lobby = window.GameLobby;

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
