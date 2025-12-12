/**
 * Hexaequo - Main Application Entry Point
 * 
 * Initializes the application, sets up routing, and coordinates between modules.
 */

import { gameStore, resetGameState } from './store/gameStore.js';
import { appStore, setAppState, getAppState, subscribeToAppState } from './store/appStore.js';
import { GameController } from './game/gameController.js';
import { BoardRenderer } from './game/boardRenderer.js';
import { CanvasGraphics } from './game/canvasGraphics.js';
import { AIClient } from './game/ai/aiClient.js';
import { SocketClient } from './api/socketClient.js';

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
    }

    /**
     * Initialize the application
     */
    async init() {
        if (this.initialized) return;

        console.log('Initializing Hexaequo...');

        // Initialize graphics system
        const canvas = document.getElementById('gameCanvas');
        if (canvas) {
            this.canvasGraphics = new CanvasGraphics(canvas);
            this.boardRenderer = new BoardRenderer(this.canvasGraphics, gameStore);
            this.gameController = new GameController(gameStore, this.boardRenderer);
        }

        // Initialize AI client
        this.aiClient = new AIClient();

        // Initialize socket client for multiplayer
        this.socketClient = new SocketClient();

        // Set up state subscriptions
        this.setupSubscriptions();

        // Apply saved preferences
        this.loadSavedPreferences();

        // Set up event listeners
        this.setupEventListeners();

        this.initialized = true;
        console.log('Hexaequo initialized successfully');

        // Expose for debugging
        window.hexaequoModern = {
            gameStore,
            appStore,
            app: this
        };
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

        // Update view
        this.updateView(state.view);
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
    }

    /**
     * Start a new game with the specified mode
     */
    startGame(mode) {
        resetGameState();
        setAppState({ 
            gameMode: mode,
            view: 'game'
        });

        if (mode === 'ai') {
            setAppState({ aiThinking: false });
        }
    }

    /**
     * Connect to multiplayer server
     */
    async connectMultiplayer() {
        try {
            await this.socketClient.connect();
            setAppState({ connectionStatus: 'connected' });
        } catch (error) {
            console.error('Failed to connect:', error);
            setAppState({ 
                connectionStatus: 'disconnected',
                lastError: error.message
            });
        }
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
