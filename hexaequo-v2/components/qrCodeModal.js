/**
 * qrCodeModal.js - Modal QR code invitation (Phase 2)
 * 
 * Responsabilités:
 * - Génération lien invitation: https://hexaequo.com/?invite=ABC12345
 * - Affichage QR code scannable (pure JS implementation)
 * - Bouton "Copy Link" 
 * - Boutons partage natif (Web Share API): Messenger, WhatsApp, Email, etc.
 * - Affichage code texte pour copie manuelle
 * - Waiting state with timer while user waits for opponent
 * - Back button with confirmation to cancel invitation
 * 
 * Format invitation:
 * - Code: 8 caractères alphanumériques
 * - Expiration: 24h (or when creator closes modal)
 * - Room settings encodés (time_mode, etc.)
 */

const QrCodeModal = (function() {
    // State
    let isOpen = false;
    let currentCode = null;
    let currentUrl = null;
    let waitingStartTime = null;
    let timerInterval = null;
    
    // DOM Elements
    let modal = null;
    let qrCanvas = null;
    let codeDisplay = null;
    let copyBtn = null;
    let shareBtn = null;
    let backBtn = null;
    let backdrop = null;
    let waitingTimer = null;
    
    // Confirmation dialog elements
    let confirmBackdrop = null;
    let confirmDialog = null;
    let confirmYesBtn = null;
    let confirmNoBtn = null;
    
    // Callbacks
    let onOpponentJoined = null;
    
    /**
     * Initialize modal elements
     */
    function init() {
        modal = document.getElementById('qrCodeModal');
        qrCanvas = document.getElementById('qrCodeCanvas');
        codeDisplay = document.getElementById('inviteCodeDisplay');
        copyBtn = document.getElementById('copyInviteLinkBtn');
        shareBtn = document.getElementById('shareInviteBtn');
        backBtn = document.getElementById('qrBackBtn');
        backdrop = document.getElementById('qrModalBackdrop');
        waitingTimer = document.getElementById('qrWaitingTimer');
        
        // Confirmation dialog elements
        confirmBackdrop = document.getElementById('inviteCancelBackdrop');
        confirmDialog = document.getElementById('inviteCancelConfirm');
        confirmYesBtn = document.getElementById('inviteCancelYesBtn');
        confirmNoBtn = document.getElementById('inviteCancelNoBtn');
        
        // Set up event handlers
        if (copyBtn) {
            copyBtn.addEventListener('click', handleCopyClick);
        }
        
        if (shareBtn) {
            shareBtn.addEventListener('click', handleShareClick);
            // Hide share button if Web Share API not available
            if (!navigator.share) {
                shareBtn.style.display = 'none';
            }
        }
        
        if (backBtn) {
            backBtn.addEventListener('click', showConfirmation);
        }
        
        // Confirmation dialog handlers
        if (confirmYesBtn) {
            confirmYesBtn.addEventListener('click', confirmClose);
        }
        
        if (confirmNoBtn) {
            confirmNoBtn.addEventListener('click', hideConfirmation);
        }
        
        if (confirmBackdrop) {
            confirmBackdrop.addEventListener('click', hideConfirmation);
        }
        
        // Close on Escape key - show confirmation first
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen) {
                if (confirmDialog && confirmDialog.style.display !== 'none') {
                    hideConfirmation();
                } else {
                    showConfirmation();
                }
            }
        });
        
        console.log('[QrCodeModal] Initialized');
    }
    
    /**
     * Open modal and create invitation
     */
    async function open(options = {}) {
        if (isOpen) return;
        
        const timeMode = options.timeMode || 'classic';
        onOpponentJoined = options.onOpponentJoined || null;
        
        try {
            // Create invitation via socket
            const result = await createInvitation(timeMode);
            
            currentCode = result.code;
            currentUrl = result.url;
            
            // Display code
            if (codeDisplay) {
                codeDisplay.textContent = currentCode;
            }
            
            // Generate QR code
            if (qrCanvas) {
                generateQRCode(currentUrl, qrCanvas);
            }
            
            // Show modal
            if (modal) {
                modal.style.display = 'flex';
                modal.classList.add('visible');
            }
            if (backdrop) {
                backdrop.style.display = 'block';
            }
            
            // Start waiting timer
            startWaitingTimer();
            
            // Listen for opponent joining
            setupOpponentJoinedListener();
            
            isOpen = true;
        } catch (err) {
            console.error('[QrCodeModal] Error creating invitation:', err);
            if (window.showError) {
                window.showError(err.message || 'Failed to create invitation');
            }
        }
    }
    
    /**
     * Start the waiting timer
     */
    function startWaitingTimer() {
        waitingStartTime = Date.now();
        updateWaitingTimer();
        timerInterval = setInterval(updateWaitingTimer, 1000);
    }
    
    /**
     * Update waiting timer display
     */
    function updateWaitingTimer() {
        if (!waitingTimer || !waitingStartTime) return;
        
        const elapsed = Math.floor((Date.now() - waitingStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        
        waitingTimer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    
    /**
     * Stop the waiting timer
     */
    function stopWaitingTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        waitingStartTime = null;
    }
    
    /**
     * Setup listener for opponent joining
     */
    function setupOpponentJoinedListener() {
        const socket = window.Multiplayer?.getSocket();
        if (!socket) return;
        
        // Remove existing listener to prevent duplicates
        socket.off('opponent-joined.qrmodal');
        
        // Listen for opponent joining - the host will receive this event
        const handler = (data) => {
            console.log('[QrCodeModal] Opponent joined via invitation!', data);
            
            // Close the modal without confirmation (opponent already joined)
            closeWithoutConfirmation();
            
            // Call the callback if provided
            if (onOpponentJoined) {
                onOpponentJoined(data);
            }
        };
        
        socket.on('opponent-joined', handler);
        
        // Store reference for cleanup
        socket._qrModalHandler = handler;
    }
    
    /**
     * Remove opponent joined listener
     */
    function removeOpponentJoinedListener() {
        const socket = window.Multiplayer?.getSocket();
        if (socket && socket._qrModalHandler) {
            socket.off('opponent-joined', socket._qrModalHandler);
            delete socket._qrModalHandler;
        }
    }
    
    /**
     * Show confirmation dialog before closing
     */
    function showConfirmation() {
        if (confirmDialog) {
            confirmDialog.style.display = 'flex';
        }
        if (confirmBackdrop) {
            confirmBackdrop.style.display = 'block';
        }
    }
    
    /**
     * Hide confirmation dialog
     */
    function hideConfirmation() {
        if (confirmDialog) {
            confirmDialog.style.display = 'none';
        }
        if (confirmBackdrop) {
            confirmBackdrop.style.display = 'none';
        }
    }
    
    /**
     * Confirm close - cancel invitation and close modal
     */
    async function confirmClose() {
        hideConfirmation();
        
        // Cancel the invitation on server
        await cancelInvitationOnServer();
        
        closeWithoutConfirmation();
    }
    
    /**
     * Cancel invitation on server
     */
    async function cancelInvitationOnServer() {
        if (!currentCode) return;
        
        return new Promise((resolve) => {
            const socket = window.Multiplayer?.getSocket();
            
            if (!socket || !socket.connected) {
                resolve();
                return;
            }
            
            socket.emit('cancel-invitation', { code: currentCode }, (response) => {
                if (response.success) {
                    console.log('[QrCodeModal] Invitation cancelled');
                } else {
                    console.warn('[QrCodeModal] Failed to cancel invitation:', response.error);
                }
                resolve();
            });
        });
    }
    
    /**
     * Close modal without confirmation (used when opponent joins)
     */
    function closeWithoutConfirmation() {
        if (!isOpen) return;
        
        hideConfirmation();
        stopWaitingTimer();
        removeOpponentJoinedListener();
        
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('visible');
        }
        if (backdrop) {
            backdrop.style.display = 'none';
        }
        
        currentCode = null;
        currentUrl = null;
        isOpen = false;
    }
    
    /**
     * Close modal (legacy - now shows confirmation)
     */
    function close() {
        if (!isOpen) return;
        showConfirmation();
    }
    
    /**
     * Create invitation via socket
     */
    function createInvitation(timeMode) {
        return new Promise((resolve, reject) => {
            const socket = window.Multiplayer?.getSocket();
            
            if (!socket || !socket.connected) {
                // Use localized message
                const msg = window.i18nT ? window.i18nT('lobby.notConnectedForInvite') : 'Connect to server to create an invitation';
                reject(new Error(msg));
                return;
            }
            
            socket.emit('create-invitation', {
                timeMode: timeMode
            }, (response) => {
                if (response.success) {
                    // Set room info in Multiplayer since we're now in a room
                    if (window.Multiplayer && response.roomCode) {
                        window.Multiplayer.setRoomInfo(response.roomCode, response.color || 'black');
                    }
                    resolve({
                        code: response.code,
                        url: response.url,
                        expiresAt: response.expiresAt,
                        roomCode: response.roomCode,
                        gameState: response.gameState,
                        color: response.color
                    });
                } else {
                    reject(new Error(response.error || 'Failed to create invitation'));
                }
            });
        });
    }
    
    /**
     * Handle copy button click
     */
    async function handleCopyClick() {
        if (!currentUrl) return;
        
        try {
            await navigator.clipboard.writeText(currentUrl);
            
            // Visual feedback with localized text
            const originalText = copyBtn.textContent;
            const copiedText = window.i18nT ? window.i18nT('lobby.linkCopied') : '✓ Copied!';
            copyBtn.textContent = `✓ ${copiedText}`;
            copyBtn.classList.add('copied');
            
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.classList.remove('copied');
            }, 2000);
        } catch (err) {
            console.error('[QrCodeModal] Copy failed:', err);
            // Fallback: select text for manual copy
            if (codeDisplay) {
                const range = document.createRange();
                range.selectNode(codeDisplay);
                window.getSelection().removeAllRanges();
                window.getSelection().addRange(range);
            }
        }
    }
    
    /**
     * Handle share button click (Web Share API)
     */
    async function handleShareClick() {
        if (!currentUrl || !navigator.share) return;
        
        try {
            const shareTitle = window.i18nT ? window.i18nT('lobby.shareTitle') : 'Join my Hexaequo game!';
            const shareText = window.i18nT ? window.i18nT('lobby.shareText') : 'Click to join my game on Hexaequo';
            
            await navigator.share({
                title: shareTitle,
                text: shareText,
                url: currentUrl
            });
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('[QrCodeModal] Share failed:', err);
            }
        }
    }
    
    /**
     * Generate QR code on canvas using qrcode-generator library
     */
    function generateQRCode(text, canvas) {
        const ctx = canvas.getContext('2d');
        const size = canvas.width;
        
        // Clear canvas
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        
        // Use qrcode-generator library (from CDN)
        if (typeof qrcode !== 'undefined') {
            try {
                // Create QR code (Type 0 = auto-detect, L = low error correction)
                const qr = qrcode(0, 'L');
                qr.addData(text);
                qr.make();
                
                // Get module count and calculate cell size
                const moduleCount = qr.getModuleCount();
                const margin = 4;
                const cellSize = (size - margin * 2) / moduleCount;
                
                // Draw QR code
                for (let row = 0; row < moduleCount; row++) {
                    for (let col = 0; col < moduleCount; col++) {
                        ctx.fillStyle = qr.isDark(row, col) ? '#000000' : '#ffffff';
                        ctx.fillRect(
                            margin + col * cellSize,
                            margin + row * cellSize,
                            cellSize,
                            cellSize
                        );
                    }
                }
                return;
            } catch (e) {
                console.error('[QrCodeModal] QRCode generation error:', e);
            }
        }
        
        // Fallback if library not loaded
        console.warn('[QrCodeModal] QRCode library not available, using fallback');
        drawFallbackQR(ctx, text, size);
    }
    
    /**
     * Fallback QR display when library is unavailable
     * Shows a simple visual with the URL (not scannable)
     */
    function drawFallbackQR(ctx, text, size) {
        // Draw a placeholder pattern that looks like a QR code
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(10, 10, size - 20, size - 20);
        
        // Draw border
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.strokeRect(10, 10, size - 20, size - 20);
        
        // Draw corner position patterns (like real QR codes)
        drawPositionPattern(ctx, 20, 20, 40);
        drawPositionPattern(ctx, size - 60, 20, 40);
        drawPositionPattern(ctx, 20, size - 60, 40);
        
        // Draw "QR" text in center
        ctx.fillStyle = '#333';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('QR Code', size / 2, size / 2 - 10);
        ctx.font = '12px sans-serif';
        ctx.fillText('(Use link below)', size / 2, size / 2 + 10);
    }
    
    /**
     * Draw QR position pattern (finder pattern)
     */
    function drawPositionPattern(ctx, x, y, size) {
        const unit = size / 7;
        
        ctx.fillStyle = '#000000';
        ctx.fillRect(x, y, size, size);
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + unit, y + unit, size - 2 * unit, size - 2 * unit);
        
        ctx.fillStyle = '#000000';
        ctx.fillRect(x + 2 * unit, y + 2 * unit, size - 4 * unit, size - 4 * unit);
    }
    
    // Public API
    return {
        init,
        open,
        close,
        closeWithoutConfirmation,
        get isOpen() { return isOpen; },
        get currentCode() { return currentCode; },
        get currentUrl() { return currentUrl; }
    };
})();

// Export globally
window.QrCodeModal = QrCodeModal;
