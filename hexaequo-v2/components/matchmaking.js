/**
 * matchmaking.js - Système Play/Invite (Phase 2)
 * 
 * Responsabilités:
 * - Bouton "Play": rejoint queue matchmaking selon critères utilisateur
 *   - Affiche loader "waiting for opponent..." avec timer
 *   - Bouton "Cancel" pour quitter la queue
 * - Bouton "Invite": ouvre modal QR code (qrCodeModal.js)
 * - Gestion événement "match-found" → transition vers game
 * 
 * Critères matchmaking:
 * - Time control (bullet/blitz/rapid/classic)
 * - Plage ELO (user_preferences: elo_range_min/max)
 * - Friendly mode toggle
 * 
 * Dépendances:
 * - multiplayer.js: joinMatchmakingQueue(), leaveMatchmakingQueue()
 * - Socket events: join-matchmaking-queue, leave-queue, match-found
 * - qrCodeModal.js pour invitations
 */

const Matchmaking = (function() {
    // State
    let isInQueue = false;
    let queueStartTime = null;
    let timerInterval = null;
    let currentTimeMode = 'classic';
    let currentElo = 1000;
    let currentPreferences = {};
    let isInitialized = false;
    
    // Callbacks
    let onMatchFound = null;
    let onQueueStatusChange = null;
    
    // DOM Elements
    let playBtn = null;
    let inviteBtn = null;
    let waitingSection = null;
    let waitingTimer = null;
    let cancelBtn = null;
    let timeModeSelect = null;
    
    /**
     * Initialize matchmaking UI
     */
    function init(options = {}) {
        playBtn = document.getElementById('matchmakingPlayBtn');
        inviteBtn = document.getElementById('matchmakingInviteBtn');
        waitingSection = document.getElementById('matchmakingWaiting');
        waitingTimer = document.getElementById('matchmakingTimer');
        cancelBtn = document.getElementById('matchmakingCancelBtn');
        timeModeSelect = document.getElementById('timeControlSelect');
        
        // Get initial time mode
        if (timeModeSelect) {
            currentTimeMode = timeModeSelect.value || 'classic';
            timeModeSelect.addEventListener('change', () => {
                currentTimeMode = timeModeSelect.value;
            });
        }
        
        // Set up button handlers
        if (playBtn) {
            playBtn.addEventListener('click', handlePlayClick);
        }
        
        if (inviteBtn) {
            inviteBtn.addEventListener('click', handleInviteClick);
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', handleCancelClick);
        }
        
        // Set options
        if (options.elo) currentElo = options.elo;
        if (options.preferences) currentPreferences = options.preferences;
        if (options.onMatchFound) onMatchFound = options.onMatchFound;
        if (options.onQueueStatusChange) onQueueStatusChange = options.onQueueStatusChange;
        
        console.log('[Matchmaking] Initialized');
    }
    
    /**
     * Handle Play button click - join matchmaking queue
     */
    async function handlePlayClick() {
        if (isInQueue) return;
        
        try {
            const result = await joinQueue(currentTimeMode, currentElo, currentPreferences);
            
            if (result.matched) {
                // Match found immediately - set room info in Multiplayer
                if (window.Multiplayer && result.roomCode) {
                    window.Multiplayer.setRoomInfo(result.roomCode, result.color);
                }
                // Match found immediately
                if (onMatchFound) {
                    onMatchFound(result);
                }
            } else {
                // Added to queue, show waiting UI
                showWaitingUI();
            }
        } catch (err) {
            console.error('[Matchmaking] Join queue error:', err);
            if (window.showError) {
                window.showError(err.message || 'Failed to join matchmaking');
            }
        }
    }
    
    /**
     * Handle Invite button click - create invitation
     */
    async function handleInviteClick() {
        try {
            // Open QR code modal with callback for when opponent joins
            if (window.QrCodeModal) {
                window.QrCodeModal.open({
                    timeMode: currentTimeMode,
                    onOpponentJoined: handleOpponentJoinedFromInvite
                });
            } else {
                console.error('[Matchmaking] QrCodeModal not loaded');
            }
        } catch (err) {
            console.error('[Matchmaking] Create invitation error:', err);
        }
    }
    
    /**
     * Handle opponent joining from invitation
     * This is called when someone accepts our invitation
     */
    function handleOpponentJoinedFromInvite(data) {
        console.log('[Matchmaking] Opponent joined from invite:', data);
        
        // This triggers the same flow as matchmaking match-found
        if (onMatchFound) {
            onMatchFound({
                roomCode: window.Multiplayer?.roomCode,
                color: window.Multiplayer?.playerColor || 'black',
                gameState: data.gameState,
                opponentInfo: data.opponent || data.opponentInfo,
                timeMode: data.timeMode
            });
        }
    }
    
    /**
     * Handle Cancel button click - leave queue
     */
    async function handleCancelClick() {
        try {
            await leaveQueue();
            hideWaitingUI();
        } catch (err) {
            console.error('[Matchmaking] Leave queue error:', err);
            hideWaitingUI();
        }
    }
    
    /**
     * Join the matchmaking queue
     */
    async function joinQueue(timeMode, elo, preferences) {
        return new Promise((resolve, reject) => {
            const socket = window.Multiplayer?.getSocket();
            
            if (!socket || !socket.connected) {
                reject(new Error('Not connected to server'));
                return;
            }
            
            // Get current user info for pseudo
            const currentUser = window.GameLobby?.getUser();
            const pseudo = currentUser?.pseudo || currentUser?.username || 'Guest';
            
            socket.emit('join-matchmaking-queue', {
                timeMode: timeMode || 'classic',
                elo: elo || 1000,
                pseudo: pseudo,
                preferences: preferences || {}
            }, (response) => {
                if (response.success) {
                    if (response.matched) {
                        resolve(response);
                    } else {
                        isInQueue = true;
                        queueStartTime = Date.now();
                        if (onQueueStatusChange) onQueueStatusChange({ inQueue: true });
                        resolve(response);
                    }
                } else {
                    reject(new Error(response.error || 'Failed to join queue'));
                }
            });
        });
    }
    
    /**
     * Leave the matchmaking queue
     */
    async function leaveQueue() {
        return new Promise((resolve, reject) => {
            const socket = window.Multiplayer?.getSocket();
            
            if (!socket || !socket.connected) {
                isInQueue = false;
                resolve({ removed: true });
                return;
            }
            
            socket.emit('leave-matchmaking-queue', {}, (response) => {
                isInQueue = false;
                queueStartTime = null;
                if (onQueueStatusChange) onQueueStatusChange({ inQueue: false });
                
                if (response.success) {
                    resolve(response);
                } else {
                    reject(new Error(response.error || 'Failed to leave queue'));
                }
            });
        });
    }
    
    /**
     * Show waiting UI with timer
     */
    function showWaitingUI() {
        isInQueue = true;
        queueStartTime = Date.now();
        
        // Update setup info display
        updateSetupInfoDisplay();
        
        // Hide play/invite buttons, show waiting section
        if (playBtn) playBtn.style.display = 'none';
        if (inviteBtn) inviteBtn.style.display = 'none';
        if (waitingSection) waitingSection.style.display = 'flex';
        
        // Start timer
        updateTimer();
        timerInterval = setInterval(updateTimer, 1000);
    }
    
    /**
     * Update the setup info display (time control and ELO range)
     */
    function updateSetupInfoDisplay() {
        const timeModeDisplay = document.getElementById('matchmakingTimeMode');
        const eloRangeDisplay = document.getElementById('matchmakingEloRange');
        
        // Get localized time mode label
        if (timeModeDisplay && timeModeSelect) {
            const selectedOption = timeModeSelect.options[timeModeSelect.selectedIndex];
            timeModeDisplay.textContent = selectedOption ? selectedOption.textContent : currentTimeMode;
        }
        
        // Calculate ELO range (±200 from current ELO)
        if (eloRangeDisplay) {
            const eloMin = Math.max(0, currentElo - 200);
            const eloMax = currentElo + 200;
            eloRangeDisplay.textContent = `${eloMin} - ${eloMax}`;
        }
    }
    
    /**
     * Hide waiting UI
     */
    function hideWaitingUI() {
        isInQueue = false;
        queueStartTime = null;
        
        // Stop timer
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        
        // Show play/invite buttons, hide waiting section
        if (playBtn) playBtn.style.display = '';
        if (inviteBtn) inviteBtn.style.display = '';
        if (waitingSection) waitingSection.style.display = 'none';
    }
    
    /**
     * Update timer display
     */
    function updateTimer() {
        if (!waitingTimer || !queueStartTime) return;
        
        const elapsed = Math.floor((Date.now() - queueStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        
        waitingTimer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    
    /**
     * Handle match found event (called from multiplayer.js)
     */
    function handleMatchFound(data) {
        hideWaitingUI();
        
        if (onMatchFound) {
            onMatchFound(data);
        }
    }
    
    /**
     * Set user ELO for matchmaking
     */
    function setElo(elo) {
        currentElo = elo || 1000;
    }
    
    /**
     * Set user preferences for matchmaking
     */
    function setPreferences(prefs) {
        currentPreferences = prefs || {};
    }
    
    /**
     * Clean up (call when leaving online mode)
     */
    function cleanup() {
        if (isInQueue) {
            leaveQueue().catch(() => {});
        }
        hideWaitingUI();
    }
    
    // Public API
    return {
        init,
        joinQueue,
        leaveQueue,
        handleMatchFound,
        setElo,
        setPreferences,
        cleanup,
        get isInQueue() { return isInQueue; },
        set onMatchFound(fn) { onMatchFound = fn; },
        set onQueueStatusChange(fn) { onQueueStatusChange = fn; }
    };
})();

// Export globally
window.Matchmaking = Matchmaking;
