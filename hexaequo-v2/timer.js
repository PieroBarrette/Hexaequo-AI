/**
 * Hexaequo - Game Timer Module
 * 
 * Handles chess-style game timers with increment support.
 * Timer presets: None, Classic (15|0), Rapid (10|5), Blitz (5|3), Bullet (2|1)
 */

(function() {
    'use strict';

    // Timer presets (time in seconds, increment in seconds)
    const TIME_CONTROLS = {
        none: { name: 'No Timer', time: null, increment: 0 },
        classic: { name: 'Classic', time: 15 * 60, increment: 0 },    // 15 minutes
        rapid: { name: 'Rapid', time: 10 * 60, increment: 5 },        // 10 minutes + 5s
        blitz: { name: 'Blitz', time: 5 * 60, increment: 3 },         // 5 minutes + 3s
        bullet: { name: 'Bullet', time: 2 * 60, increment: 1 }        // 2 minutes + 1s
    };

    // State
    let currentTimeControl = 'classic';
    let blackTime = null;  // milliseconds remaining
    let whiteTime = null;  // milliseconds remaining
    let activeTimer = null; // 'black' or 'white'
    let timerInterval = null;
    let lastTickTime = null;
    let isRunning = false;
    let onTimeOut = null;  // Callback when a player runs out of time
    let isOnlineMode = false;  // In online mode, server is authoritative
    let serverLastUpdate = null;  // Timestamp of last server update

    // DOM elements
    let blackTimerEl = null;
    let whiteTimerEl = null;

    /**
     * Initialize the timer system
     */
    function init() {
        blackTimerEl = document.getElementById('blackTimer');
        whiteTimerEl = document.getElementById('whiteTimer');
        updateDisplay();
    }

    /**
     * Set the time control for the game
     * @param {string} controlType - 'none', 'classic', 'rapid', 'blitz', or 'bullet'
     */
    function setTimeControl(controlType) {
        if (!TIME_CONTROLS[controlType]) {
            console.warn('[Timer] Unknown time control:', controlType);
            controlType = 'classic';
        }
        
        currentTimeControl = controlType;
        const control = TIME_CONTROLS[controlType];
        
        if (control.time === null) {
            // No timer mode
            blackTime = null;
            whiteTime = null;
        } else {
            // Convert to milliseconds
            blackTime = control.time * 1000;
            whiteTime = control.time * 1000;
        }
        
        console.log('[Timer] Time control set to:', controlType, control);
        updateDisplay();
    }

    /**
     * Get current time control info
     */
    function getTimeControl() {
        return {
            type: currentTimeControl,
            ...TIME_CONTROLS[currentTimeControl]
        };
    }

    /**
     * Get all available time controls
     */
    function getTimeControls() {
        return TIME_CONTROLS;
    }

    /**
     * Reset timers to the current time control's initial values
     */
    function reset() {
        stop();
        setTimeControl(currentTimeControl);
        activeTimer = null;
        updateDisplay();
    }

    /**
     * Start the timer for a specific player
     * @param {string} player - 'black' or 'white'
     */
    function start(player) {
        if (currentTimeControl === 'none' || blackTime === null) {
            return; // No timer mode
        }

        if (activeTimer === player && isRunning) {
            return; // Already running for this player
        }

        // If switching players, add increment to the player who just moved
        if (activeTimer && activeTimer !== player && isRunning) {
            addIncrement(activeTimer);
        }

        stop(); // Stop any existing timer
        
        activeTimer = player;
        isRunning = true;
        lastTickTime = performance.now();
        
        // Run timer at ~100ms intervals for smooth display
        timerInterval = setInterval(tick, 100);
        
        updateDisplay();
        console.log('[Timer] Started for:', player);
    }

    /**
     * Stop the timer (pause)
     */
    function stop() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        isRunning = false;
        updateDisplay();
    }

    /**
     * Add increment to a player's time
     * @param {string} player - 'black' or 'white'
     */
    function addIncrement(player) {
        const control = TIME_CONTROLS[currentTimeControl];
        if (control.increment > 0) {
            const incrementMs = control.increment * 1000;
            if (player === 'black') {
                blackTime += incrementMs;
            } else {
                whiteTime += incrementMs;
            }
            console.log('[Timer] Added increment to', player, ':', control.increment, 's');
        }
    }

    /**
     * Timer tick - called every 100ms
     */
    function tick() {
        if (!isRunning || !activeTimer) return;

        const now = performance.now();
        const elapsed = now - lastTickTime;
        lastTickTime = now;

        // Subtract elapsed time from active player
        if (activeTimer === 'black') {
            blackTime = Math.max(0, blackTime - elapsed);
            if (blackTime <= 0 && !isOnlineMode) {
                // In offline mode, local timer handles timeout
                handleTimeOut('black');
            }
        } else {
            whiteTime = Math.max(0, whiteTime - elapsed);
            if (whiteTime <= 0 && !isOnlineMode) {
                // In offline mode, local timer handles timeout
                handleTimeOut('white');
            }
        }

        updateDisplay();
    }

    /**
     * Handle when a player runs out of time
     * @param {string} player - 'black' or 'white'
     */
    function handleTimeOut(player) {
        stop();
        console.log('[Timer] Time out for:', player);
        
        if (onTimeOut) {
            onTimeOut(player);
        }
    }

    /**
     * Set callback for timeout events
     * @param {function} callback - Called with player color when time runs out
     */
    function setTimeoutCallback(callback) {
        onTimeOut = callback;
    }

    /**
     * Format time in milliseconds to MM:SS or M:SS
     * @param {number} ms - Time in milliseconds
     */
    function formatTime(ms) {
        if (ms === null) return '';
        
        const totalSeconds = Math.ceil(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    /**
     * Update the timer display elements
     */
    function updateDisplay() {
        if (!blackTimerEl || !whiteTimerEl) return;

        // Black timer
        if (blackTime !== null) {
            blackTimerEl.textContent = formatTime(blackTime);
            blackTimerEl.style.display = 'block';
            blackTimerEl.classList.toggle('active', activeTimer === 'black' && isRunning);
            blackTimerEl.classList.toggle('low-time', blackTime < 30000 && blackTime > 0);
        } else {
            blackTimerEl.style.display = 'none';
        }

        // White timer
        if (whiteTime !== null) {
            whiteTimerEl.textContent = formatTime(whiteTime);
            whiteTimerEl.style.display = 'block';
            whiteTimerEl.classList.toggle('active', activeTimer === 'white' && isRunning);
            whiteTimerEl.classList.toggle('low-time', whiteTime < 30000 && whiteTime > 0);
        } else {
            whiteTimerEl.style.display = 'none';
        }
    }

    /**
     * Get current timer state (for syncing in online mode)
     */
    function getState() {
        return {
            timeControl: currentTimeControl,
            blackTime,
            whiteTime,
            activeTimer,
            isRunning
        };
    }

    /**
     * Set timer state (for syncing in online mode)
     * @param {object} state - Timer state to restore
     */
    function setState(state) {
        if (!state) return;
        
        if (state.timeControl) {
            currentTimeControl = state.timeControl;
        }
        blackTime = state.blackTime ?? blackTime;
        whiteTime = state.whiteTime ?? whiteTime;
        activeTimer = state.activeTimer ?? activeTimer;
        
        if (state.isRunning && activeTimer) {
            start(activeTimer);
        } else {
            updateDisplay();
        }
    }

    /**
     * Sync timer state from server (authoritative in online mode)
     * @param {object} serverState - Timer state from server
     */
    function syncFromServer(serverState) {
        if (!serverState) return;
        
        console.log('[Timer] Syncing from server:', serverState);
        
        isOnlineMode = true;
        serverLastUpdate = Date.now();
        
        if (serverState.timeControl) {
            currentTimeControl = serverState.timeControl;
        }
        
        // Server times are authoritative
        if (serverState.blackTime !== undefined) {
            blackTime = serverState.blackTime;
        }
        if (serverState.whiteTime !== undefined) {
            whiteTime = serverState.whiteTime;
        }
        
        // Handle active timer - if game has started and there's an active timer
        if (serverState.gameStarted && serverState.activeTimer) {
            activeTimer = serverState.activeTimer;
            
            // Start local countdown for display purposes
            if (!isRunning) {
                isRunning = true;
                lastTickTime = performance.now();
                if (!timerInterval) {
                    timerInterval = setInterval(tick, 100);
                }
            }
        } else {
            // Game not started yet - show initial times but don't run
            activeTimer = null;
            stop();
        }
        
        updateDisplay();
    }

    /**
     * Set online mode (timer is server-authoritative)
     */
    function setOnlineMode(enabled) {
        isOnlineMode = enabled;
        if (!enabled) {
            serverLastUpdate = null;
        }
    }

    /**
     * Check if timers are enabled for current game
     */
    function isEnabled() {
        return currentTimeControl !== 'none' && blackTime !== null;
    }

    /**
     * Get remaining time for a player
     * @param {string} player - 'black' or 'white'
     * @returns {number|null} Time in milliseconds, or null if no timer
     */
    function getTime(player) {
        return player === 'black' ? blackTime : whiteTime;
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Export public API
    window.GameTimer = {
        init,
        setTimeControl,
        getTimeControl,
        getTimeControls,
        reset,
        start,
        stop,
        addIncrement,
        setTimeoutCallback,
        formatTime,
        getState,
        setState,
        syncFromServer,
        setOnlineMode,
        isEnabled,
        getTime,
        TIME_CONTROLS
    };

})();
