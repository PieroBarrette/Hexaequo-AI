/**
 * Hexaequo - Lobby Controller
 * 
 * Handles the main menu/lobby UI, game mode selection,
 * and online room creation/joining.
 */

(function() {
    'use strict';

    // ==================== State ====================
    let selectedDifficulty = 3;
    let socket = null;
    let isConnected = false;
    let currentRoomCode = null;

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
        
        lobby.rulesBtn = document.getElementById('lobbyRulesBtn');
        lobby.settingsBtn = document.getElementById('lobbySettingsBtn');

        // Set up event listeners
        setupEventListeners();
        
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
        lobby.joinRoomBtn?.addEventListener('click', joinRoom);
        lobby.roomCodeInput?.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') joinRoom();
        });
        lobby.copyCodeBtn?.addEventListener('click', copyRoomCode);
        lobby.cancelBtn?.addEventListener('click', cancelWaiting);
        lobby.backFromOnlineBtn?.addEventListener('click', showMainMenu);
        
        // Footer
        lobby.rulesBtn?.addEventListener('click', openRules);
        lobby.settingsBtn?.addEventListener('click', openSettings);
    }

    // ==================== Menu Navigation ====================
    function showMainMenu() {
        // Hide all sections
        document.querySelector('.mode-selection')?.style.setProperty('display', 'flex');
        lobby.aiOptions?.style.setProperty('display', 'none');
        lobby.onlineOptions?.style.setProperty('display', 'none');
        
        // Disconnect socket if connected
        if (socket && currentRoomCode) {
            socket.emit('leaveRoom');
            currentRoomCode = null;
        }
        
        hideError();
    }

    function showAiOptions() {
        document.querySelector('.mode-selection')?.style.setProperty('display', 'none');
        lobby.aiOptions?.style.setProperty('display', 'flex');
        lobby.onlineOptions?.style.setProperty('display', 'none');
    }

    function showOnlineOptions() {
        document.querySelector('.mode-selection')?.style.setProperty('display', 'none');
        lobby.aiOptions?.style.setProperty('display', 'none');
        lobby.onlineOptions?.style.setProperty('display', 'flex');
        
        // Reset online UI state
        lobby.roomActions?.style.setProperty('display', 'none');
        lobby.waitingSection?.style.setProperty('display', 'none');
        
        // Connect to server
        connectToServer();
    }

    // ==================== Game Start Functions ====================
    function startLocalGame() {
        console.log('[Lobby] Starting local 2-player game');
        
        // Set game mode via the existing select (game.js uses this)
        const gameModeSelect = document.getElementById('gameModeSelect');
        if (gameModeSelect) {
            gameModeSelect.value = '2player';
            gameModeSelect.dispatchEvent(new Event('change'));
        }
        
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
        // Use existing multiplayer connection if available
        if (typeof window.GameMultiplayer !== 'undefined' && window.GameMultiplayer.getSocket) {
            socket = window.GameMultiplayer.getSocket();
            if (socket && socket.connected) {
                onConnected();
                return;
            }
        }
        
        // Initialize multiplayer connection
        if (typeof window.GameMultiplayer !== 'undefined' && window.GameMultiplayer.connect) {
            window.GameMultiplayer.connect();
            
            // Wait for connection with timeout
            let attempts = 0;
            const checkConnection = setInterval(() => {
                socket = window.GameMultiplayer.getSocket();
                if (socket && socket.connected) {
                    clearInterval(checkConnection);
                    setupSocketListeners();
                    onConnected();
                } else if (attempts++ > 50) { // 5 seconds timeout
                    clearInterval(checkConnection);
                    onConnectionError('Could not connect to server');
                }
            }, 100);
        } else {
            onConnectionError('Multiplayer not available');
        }
    }

    function setupSocketListeners() {
        if (!socket) return;
        
        socket.on('roomCreated', (data) => {
            console.log('[Lobby] Room created:', data.roomCode);
            currentRoomCode = data.roomCode;
            showWaitingForOpponent(data.roomCode);
        });
        
        socket.on('roomJoined', (data) => {
            console.log('[Lobby] Joined room:', data.roomCode);
            currentRoomCode = data.roomCode;
        });
        
        socket.on('gameStart', (data) => {
            console.log('[Lobby] Game starting! Playing as:', data.playerColor);
            startOnlineGame(data);
        });
        
        socket.on('roomError', (data) => {
            console.error('[Lobby] Room error:', data.message);
            showError(data.message);
            // Reset to room actions view
            lobby.waitingSection?.style.setProperty('display', 'none');
            lobby.roomActions?.style.setProperty('display', 'flex');
        });
        
        socket.on('disconnect', () => {
            console.log('[Lobby] Disconnected from server');
            if (lobby.onlineOptions?.style.display !== 'none') {
                onConnectionError('Disconnected from server');
            }
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
            statusText.textContent = 'Connected to server';
        }
        
        lobby.roomActions?.style.setProperty('display', 'flex');
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
        if (!socket || !isConnected) {
            showError('Not connected to server');
            return;
        }
        
        hideError();
        console.log('[Lobby] Creating room...');
        socket.emit('createRoom');
    }

    function joinRoom() {
        if (!socket || !isConnected) {
            showError('Not connected to server');
            return;
        }
        
        const code = lobby.roomCodeInput?.value?.trim().toUpperCase();
        if (!code || code.length !== 4) {
            showError('Please enter a valid 4-character room code');
            return;
        }
        
        hideError();
        console.log('[Lobby] Joining room:', code);
        socket.emit('joinRoom', { roomCode: code });
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
                const originalText = lobby.copyCodeBtn.textContent;
                lobby.copyCodeBtn.textContent = '✓';
                setTimeout(() => {
                    lobby.copyCodeBtn.textContent = originalText;
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
        console.log('[Lobby] Starting online game');
        
        // Set game mode to online
        const gameModeSelect = document.getElementById('gameModeSelect');
        if (gameModeSelect) {
            gameModeSelect.value = 'online';
            gameModeSelect.dispatchEvent(new Event('change'));
        }
        
        // Let game.js handle the online game setup through its existing listeners
        hideLobby();
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
        // Use existing rules button
        const rulesBtn = document.getElementById('rulesBtn');
        if (rulesBtn) {
            rulesBtn.click();
        }
    }

    function openSettings() {
        // Show hamburger menu
        const hamburgerBtn = document.getElementById('hamburgerBtn');
        if (hamburgerBtn) {
            hamburgerBtn.click();
        }
    }

    // ==================== Public API ====================
    window.GameLobby = {
        init,
        show: showLobby,
        hide: hideLobby
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
