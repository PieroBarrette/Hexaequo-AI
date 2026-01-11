/**
 * qrCodeModal.js - Modal QR code invitation (Phase 2)
 * 
 * Responsabilités:
 * - Génération lien invitation: https://hexaequo.com/?invite=ABC12345
 * - Affichage QR code scannable (pure JS implementation)
 * - Bouton "Copy Link" 
 * - Boutons partage natif (Web Share API): Messenger, WhatsApp, Email, etc.
 * - Affichage code texte pour copie manuelle
 * 
 * Format invitation:
 * - Code: 8 caractères alphanumériques
 * - Expiration: 24h
 * - Room settings encodés (time_mode, etc.)
 */

const QrCodeModal = (function() {
    // State
    let isOpen = false;
    let currentCode = null;
    let currentUrl = null;
    
    // DOM Elements
    let modal = null;
    let qrCanvas = null;
    let codeDisplay = null;
    let copyBtn = null;
    let shareBtn = null;
    let closeBtn = null;
    let backdrop = null;
    
    /**
     * Initialize modal elements
     */
    function init() {
        modal = document.getElementById('qrCodeModal');
        qrCanvas = document.getElementById('qrCodeCanvas');
        codeDisplay = document.getElementById('inviteCodeDisplay');
        copyBtn = document.getElementById('copyInviteLinkBtn');
        shareBtn = document.getElementById('shareInviteBtn');
        closeBtn = document.getElementById('closeQrModalBtn');
        backdrop = document.getElementById('qrModalBackdrop');
        
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
        
        if (closeBtn) {
            closeBtn.addEventListener('click', close);
        }
        
        if (backdrop) {
            backdrop.addEventListener('click', close);
        }
        
        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen) {
                close();
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
            
            isOpen = true;
        } catch (err) {
            console.error('[QrCodeModal] Error creating invitation:', err);
            if (window.showError) {
                window.showError(err.message || 'Failed to create invitation');
            }
        }
    }
    
    /**
     * Close modal
     */
    function close() {
        if (!isOpen) return;
        
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
            
            // Visual feedback
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✓ Copied!';
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
            await navigator.share({
                title: 'Join my Hexaequo game!',
                text: 'Click to join my game on Hexaequo',
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
        get isOpen() { return isOpen; },
        get currentCode() { return currentCode; },
        get currentUrl() { return currentUrl; }
    };
})();

// Export globally
window.QrCodeModal = QrCodeModal;
