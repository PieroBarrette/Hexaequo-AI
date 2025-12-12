/**
 * Hexaequo - Main Application Entry Point
 * 
 * Initializes the application, sets up routing, and coordinates between modules.
 */

import { gameStore, resetGameState, getGameState, updateGameState } from './store/gameStore.js';
import { appStore, setAppState, getAppState, subscribeToAppState } from './store/appStore.js';
import { GameController } from './game/gameController.js';
import { BoardRenderer } from './game/boardRenderer.js';
import { CanvasGraphics } from './game/canvasGraphics.js';
import { AIClient } from './game/ai/aiClient.js';
import { SocketClient } from './api/socketClient.js';

// Sound effects
const SOUNDS = {
    move: null,
    capture: null,
    place: null,
    tile: null,
    click: null,
    gameEnd: null
};

/**
 * Main Application Class
 */
class HexaequoApp {
    constructor() {
        this.gameController = null;
        this.boardRenderer = null;
        this.canvasGraphics = null;
        this.aiClient = null;
        this.socketClient = null;
        this.initialized = false;
        this.soundEnabled = true;
        this.currentRoomCode = null;
        this.playerColor = null;
    }

    /**
     * Initialize the application
     */
    async init() {
        if (this.initialized) return;

        console.log('Initializing Hexaequo...');

        // Load sounds
        this.loadSounds();

        // Initialize graphics system
        const canvas = document.getElementById('gameCanvas');
        
        if (canvas) {
            this.canvasGraphics = new CanvasGraphics(canvas);
            
            this.boardRenderer = new BoardRenderer(this.canvasGraphics, gameStore);
            this.boardRenderer.init();  // This will init graphics with gameStore.getState()
            
            this.gameController = new GameController(gameStore, this.boardRenderer, this.canvasGraphics, {
                canvas: canvas,
                onMoveComplete: () => this.onMoveComplete(),
                onTurnEnd: () => this.onTurnEnd(),
                onGameEnd: (winner, reason) => this.onGameEnd(winner, reason),
                playSound: (sound) => this.playSound(sound)
            });
            this.gameController.init();

            // Handle window resize
            window.addEventListener('resize', () => {
                if (this.canvasGraphics) {
                    this.canvasGraphics.resizeCanvas();
                }
            });
        }

        // Initialize AI client
        this.aiClient = new AIClient();

        // Initialize socket client for multiplayer
        this.socketClient = new SocketClient();
        this.setupSocketCallbacks();

        // Set up state subscriptions
        this.setupSubscriptions();

        // Apply saved preferences
        this.loadSavedPreferences();

        // Set up event listeners
        this.setupEventListeners();

        this.initialized = true;
        console.log('Hexaequo initialized successfully');

        // Initial render
        if (this.boardRenderer) {
            this.boardRenderer.render();
        }

        // Expose for debugging
        window.hexaequo = {
            gameStore,
            appStore,
            app: this,
            getState: () => getGameState(),
            reset: () => this.resetGame()
        };
    }

    /**
     * Load sound effects
     */
    loadSounds() {
        const soundFiles = {
            move: 'move.mp3',
            capture: 'capture.mp3',
            place: 'piece_placement.mp3',
            tile: 'tile_placement.mp3',
            click: 'button_click.mp3',
            gameEnd: 'game_end.mp3'
        };

        for (const [name, file] of Object.entries(soundFiles)) {
            try {
                const audio = new Audio(`sounds/${file}`);
                audio.preload = 'auto';
                SOUNDS[name] = audio;
            } catch (e) {
                console.warn(`Failed to load sound: ${file}`);
            }
        }
    }

    /**
     * Play a sound effect
     */
    playSound(soundName) {
        if (!this.soundEnabled) return;
        const appState = getAppState();
        if (!appState.sounds) return;

        const sound = SOUNDS[soundName];
        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(() => {}); // Ignore autoplay errors
        }
    }

    /**
     * Setup Socket.IO callbacks
     */
    setupSocketCallbacks() {
        this.socketClient.on('onOpponentJoined', (data) => {
            this.showToast('Opponent joined!', 'success');
            setAppState({ opponentConnected: true });
        });

        this.socketClient.on('onOpponentMoved', (data) => {
            // Apply opponent's move
            if (data.gameState) {
                this.applyOpponentMove(data.gameState, data.jumpPath);
            }
        });

        this.socketClient.on('onOpponentDisconnected', () => {
            this.showToast('Opponent disconnected', 'warning');
            setAppState({ opponentConnected: false });
        });

        this.socketClient.on('onOpponentReconnected', () => {
            this.showToast('Opponent reconnected', 'success');
            setAppState({ opponentConnected: true });
        });

        this.socketClient.on('onOpponentLeft', () => {
            this.showToast('Opponent left the game', 'info');
            setAppState({ opponentConnected: false });
        });

        this.socketClient.on('onConnectionStatusChange', (status) => {
            setAppState({ connectionStatus: status });
        });

        this.socketClient.on('onError', (error) => {
            this.showToast(error, 'error');
        });
    }

    /**
     * Set up state change subscriptions
     */
    setupSubscriptions() {
        // Subscribe to game state changes for rendering
        gameStore.subscribe((state) => {
            if (this.boardRenderer) {
                this.boardRenderer.render(state);
            }
        });

        // Subscribe to app state changes for UI updates
        subscribeToAppState((state) => {
            this.handleAppStateChange(state);
        });
    }

    /**
     * Handle app state changes
     */
    handleAppStateChange(state) {
        // Update theme
        document.body.setAttribute('data-theme', state.theme);

        // Update color scheme in graphics
        if (this.canvasGraphics) {
            const scheme = state.theme === 'dark' ? 'modern' : 'classic';
            this.canvasGraphics.setColorScheme(scheme);
        }

        // Update sound setting
        this.soundEnabled = state.sounds;

        // Update animations
        if (this.canvasGraphics) {
            this.canvasGraphics.setAnimationsEnabled(state.animations);
        }
        if (this.boardRenderer) {
            this.boardRenderer.setAnimationsEnabled(state.animations);
        }

        // Update view
        this.updateView(state.view);

        // Update player status display
        this.updatePlayerStatus();
    }

    /**
     * Update player status display
     */
    updatePlayerStatus() {
        const statusEl = document.getElementById('playerStatus');
        if (!statusEl) return;

        const gameState = getGameState();
        const appState = getAppState();
        const player = gameState.activePlayer;

        let statusText = `${player === 'black' ? 'Black' : 'White'}'s Turn`;

        if (appState.gameMode === 'online') {
            if (this.playerColor === player) {
                statusText = 'Your Turn';
            } else {
                statusText = "Opponent's Turn";
            }
        } else if (appState.gameMode === 'ai' && player === 'white') {
            statusText = 'AI is thinking...';
        }

        statusEl.textContent = statusText;
        statusEl.className = `player-status ${player}`;
    }

    /**
     * Update the current view/screen
     */
    updateView(view) {
        // Hide all views
        document.querySelectorAll('[data-view]').forEach(el => {
            el.classList.remove('active');
        });

        // Show current view
        const currentView = document.querySelector(`[data-view="${view}"]`);
        if (currentView) {
            currentView.classList.add('active');
        }
    }

    /**
     * Load saved user preferences
     */
    loadSavedPreferences() {
        const state = getAppState();
        document.body.setAttribute('data-theme', state.theme);
        this.soundEnabled = state.sounds;
        
        if (this.canvasGraphics) {
            const scheme = state.theme === 'dark' ? 'modern' : 'classic';
            this.canvasGraphics.setColorScheme(scheme);
            this.canvasGraphics.setAnimationsEnabled(state.animations);
        }
    }

    /**
     * Set up DOM event listeners
     */
    setupEventListeners() {
        // Navigation
        document.querySelectorAll('[data-nav]').forEach(el => {
            el.addEventListener('click', (e) => {
                const view = e.currentTarget.dataset.nav;
                setAppState({ view });
            });
        });

        // Game mode selection
        document.querySelectorAll('[data-mode]').forEach(el => {
            el.addEventListener('click', (e) => {
                const mode = e.currentTarget.dataset.mode;
                this.startGame(mode);
            });
        });

        // Settings toggles
        document.querySelectorAll('[data-setting]').forEach(el => {
            el.addEventListener('change', (e) => {
                const setting = e.currentTarget.dataset.setting;
                const value = e.currentTarget.type === 'checkbox' 
                    ? e.currentTarget.checked 
                    : e.currentTarget.value;
                setAppState({ [setting]: value });
            });
        });

        // Theme toggle
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const current = getAppState().theme;
                setAppState({ theme: current === 'light' ? 'dark' : 'light' });
            });
        }

        // Create room button
        const createRoomBtn = document.getElementById('createRoomBtn');
        if (createRoomBtn) {
            createRoomBtn.addEventListener('click', () => this.createRoom());
        }

        // Join room button
        const joinRoomBtn = document.getElementById('joinRoomBtn');
        if (joinRoomBtn) {
            joinRoomBtn.addEventListener('click', () => {
                const code = document.getElementById('roomCodeInput')?.value;
                if (code) this.joinRoom(code);
            });
        }

        // New game button
        const newGameBtn = document.getElementById('newGameBtn');
        if (newGameBtn) {
            newGameBtn.addEventListener('click', () => this.resetGame());
        }

        // Back to menu button
        const menuBtn = document.getElementById('menuBtn');
        if (menuBtn) {
            menuBtn.addEventListener('click', () => {
                this.leaveGame();
                setAppState({ view: 'menu' });
            });
        }

        // Undo/Redo buttons
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
        if (redoBtn) redoBtn.addEventListener('click', () => this.redo());

        // Close modals
        document.querySelectorAll('[data-close-modal]').forEach(el => {
            el.addEventListener('click', () => this.closeAllModals());
        });
    }

    /**
     * Start a new game with the specified mode
     */
    startGame(mode) {
        resetGameState();
        
        if (this.gameController) {
            this.gameController.resetMultiJumpState();
        }

        if (mode === 'local') {
            if (this.gameController) {
                this.gameController.setAiMode(false);
                this.gameController.setOnlineMode(false);
            }
            setAppState({ 
                gameMode: mode,
                view: 'game'
            });
        } else if (mode === 'ai') {
            if (this.gameController) {
                this.gameController.setAiMode(true);
                this.gameController.setOnlineMode(false);
            }
            setAppState({ 
                gameMode: mode,
                view: 'game',
                aiThinking: false
            });
        } else if (mode === 'online') {
            setAppState({ 
                gameMode: mode,
                view: 'lobby'
            });
            this.connectMultiplayer();
        }

        if (this.boardRenderer) {
            this.boardRenderer.forceRender();
        }
    }

    /**
     * Reset the current game
     */
    resetGame() {
        resetGameState();
        if (this.gameController) {
            this.gameController.resetMultiJumpState();
        }
        if (this.boardRenderer) {
            this.boardRenderer.forceRender();
        }
        this.playSound('place');
    }

    /**
     * Leave the current game
     */
    async leaveGame() {
        const appState = getAppState();
        if (appState.gameMode === 'online' && this.currentRoomCode) {
            try {
                await this.socketClient.leaveRoom();
            } catch (e) {
                console.error('Error leaving room:', e);
            }
            this.currentRoomCode = null;
            this.playerColor = null;
        }
        resetGameState();
    }

    /**
     * Called when a move is completed
     */
    onMoveComplete() {
        const appState = getAppState();
        
        // Send move to server if online
        if (appState.gameMode === 'online' && this.socketClient.isConnected) {
            this.sendMoveToServer();
        }
    }

    /**
     * Called when a turn ends
     */
    onTurnEnd() {
        const appState = getAppState();
        const gameState = getGameState();

        this.updatePlayerStatus();

        // Trigger AI move if it's AI's turn
        if (appState.gameMode === 'ai' && gameState.activePlayer === 'white') {
            this.triggerAiMove();
        }
    }

    /**
     * Called when game ends
     */
    onGameEnd(winner, reason) {
        this.playSound('gameEnd');
        
        let message = '';
        if (reason === 'rings') {
            message = `${winner === 'black' ? 'Black' : 'White'} wins by capturing 3 rings!`;
        } else if (reason === 'noMoves') {
            message = `${winner === 'black' ? 'Black' : 'White'} wins! Opponent has no valid moves.`;
        }

        this.showGameEndModal(winner, message);
    }

    /**
     * Show game end modal
     */
    showGameEndModal(winner, message) {
        const modal = document.getElementById('gameEndModal');
        const messageEl = document.getElementById('gameEndMessage');
        
        if (modal && messageEl) {
            messageEl.textContent = message;
            modal.classList.add('active');
        }
    }

    /**
     * Trigger AI move
     */
    async triggerAiMove() {
        if (!this.aiClient) return;
        
        setAppState({ aiThinking: true });
        this.gameController.aiThinking = true;

        try {
            const gameState = getGameState();
            const difficulty = getAppState().aiDifficulty || 3;
            
            const result = await this.aiClient.computeMove(gameState, difficulty);
            
            if (result.gameState) {
                // Apply AI move with animation
                updateGameState(result.gameState);
                this.boardRenderer.forceRender();
                this.playSound('move');
            }
        } catch (error) {
            console.error('AI error:', error);
            this.showToast('AI error: ' + error.message, 'error');
        } finally {
            setAppState({ aiThinking: false });
            this.gameController.aiThinking = false;
            this.updatePlayerStatus();
        }
    }

    /**
     * Connect to multiplayer server
     */
    async connectMultiplayer() {
        try {
            setAppState({ connectionStatus: 'connecting' });
            await this.socketClient.connect();
            setAppState({ connectionStatus: 'connected' });
        } catch (error) {
            console.error('Failed to connect:', error);
            setAppState({ 
                connectionStatus: 'disconnected',
                lastError: error.message
            });
            this.showToast('Failed to connect to server', 'error');
        }
    }

    /**
     * Create a new online room
     */
    async createRoom() {
        try {
            const response = await this.socketClient.createRoom();
            this.currentRoomCode = response.roomCode;
            this.playerColor = response.color;
            
            if (this.gameController) {
                this.gameController.setOnlineMode(true, this.playerColor);
            }

            // Show room code
            this.showRoomCode(response.roomCode);
            setAppState({ view: 'game' });
            resetGameState();
            this.boardRenderer?.forceRender();
            
            this.showToast(`Room created! Code: ${response.roomCode}`, 'success');
        } catch (error) {
            console.error('Failed to create room:', error);
            this.showToast('Failed to create room', 'error');
        }
    }

    /**
     * Join an existing room
     */
    async joinRoom(roomCode) {
        try {
            const response = await this.socketClient.joinRoom(roomCode.toUpperCase());
            this.currentRoomCode = response.roomCode;
            this.playerColor = response.color;
            
            if (this.gameController) {
                this.gameController.setOnlineMode(true, this.playerColor);
            }

            setAppState({ view: 'game', opponentConnected: true });
            
            // Apply game state if provided
            if (response.gameState) {
                updateGameState(response.gameState);
            } else {
                resetGameState();
            }
            
            this.boardRenderer?.forceRender();
            this.showToast('Joined room!', 'success');
        } catch (error) {
            console.error('Failed to join room:', error);
            this.showToast(error.message || 'Failed to join room', 'error');
        }
    }

    /**
     * Send move to server
     */
    async sendMoveToServer() {
        if (!this.socketClient.isConnected || !this.currentRoomCode) return;

        try {
            const gameState = getGameState();
            await this.socketClient.makeMove(gameState);
        } catch (error) {
            console.error('Failed to send move:', error);
            this.showToast('Failed to sync move', 'error');
        }
    }

    /**
     * Apply opponent's move
     */
    applyOpponentMove(newState, jumpPath) {
        updateGameState(newState);
        this.boardRenderer?.forceRender();
        this.playSound('move');
        this.updatePlayerStatus();
    }

    /**
     * Show room code
     */
    showRoomCode(code) {
        const el = document.getElementById('roomCodeDisplay');
        if (el) {
            el.textContent = code;
            el.classList.add('active');
        }
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer') || this.createToastContainer();
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        
        container.appendChild(toast);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    /**
     * Create toast container
     */
    createToastContainer() {
        const container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
        return container;
    }

    /**
     * Close all modals
     */
    closeAllModals() {
        document.querySelectorAll('.modal.active').forEach(modal => {
            modal.classList.remove('active');
        });
    }

    /**
     * Undo last move (local games only)
     */
    undo() {
        const appState = getAppState();
        if (appState.gameMode === 'online') return;
        // TODO: Implement undo with move history
        this.showToast('Undo not yet implemented', 'info');
    }

    /**
     * Redo last undone move (local games only)
     */
    redo() {
        const appState = getAppState();
        if (appState.gameMode === 'online') return;
        // TODO: Implement redo with move history
        this.showToast('Redo not yet implemented', 'info');
    }
}

// Create and export app instance
export const app = new HexaequoApp();

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    app.init();
}
