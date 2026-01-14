/**
 * invitationService.js - Gestion invitations (Phase 2)
 * 
 * Responsabilités:
 * - Création liens d'invitation avec code unique
 * - Validation et utilisation des codes
 * - Génération URL: https://hexaequo.com/?invite=ABC12345
 * - Expiration automatique (24h par défaut)
 * 
 * Flow invitation:
 * 1. Joueur A appelle createInvitation(roomSettings)
 * 2. Service génère code unique + sauvegarde
 * 3. Joueur A partage lien/QR code
 * 4. Joueur B ouvre lien, frontend détecte ?invite=CODE
 * 5. Joueur B s'authentifie si nécessaire
 * 6. Joueur B appelle acceptInvitation(code)
 * 7. Service valide code, crée room, retourne roomCode
 * 8. Les 2 joueurs rejoignent la room
 * 
 * Exports:
 * - createInvitation(userId, pseudo, roomSettings) → {code, url, expires_at}
 * - acceptInvitation(code, userId, pseudo, socketId) → {valid, roomCode?, error?}
 * - getInvitationInfo(code) → {valid, creator, settings, expires_at}
 * - cancelInvitation(code, userId) → boolean
 */

const invitationModel = require('../models/invitationModel');
const roomService = require('./roomService');

// Base URL for invitation links
const BASE_URL = process.env.FRONTEND_URL || 'https://hexaequo.com';

// In-memory fallback
const memoryInvitations = new Map();
let useMemoryStore = false;

/**
 * Create a new invitation
 * Creates a room immediately so the creator can wait
 */
async function createInvitation(userId, pseudo, elo, socketId, roomSettings = {}) {
    try {
        // Create room first so creator is waiting
        const room = await roomService.createRoom({
            hostId: userId,
            hostPseudo: pseudo,
            hostSocketId: socketId,
            timeMode: roomSettings.timeMode || 'none',
            allowSpectators: roomSettings.allowSpectators ?? true
        });
        
        const invitation = await withFallback(
            () => invitationModel.createInvitation(userId, pseudo, elo, { ...roomSettings, roomCode: room.code }, room.code),
            () => createMemoryInvitation(userId, pseudo, elo, { ...roomSettings, roomCode: room.code }, room.code)
        );

        const finalUrl = `${BASE_URL}/?invite=${invitation.code}`;
        console.log('[Invitation] createInvitation', {
            baseUrl: BASE_URL,
            code: invitation.code,
            roomCode: room.code,
            url: finalUrl,
            settings: invitation.roomSettings
        });
        
        return {
            code: invitation.code,
            url: finalUrl,
            expiresAt: invitation.expiresAt,
            roomSettings: invitation.roomSettings,
            roomCode: room.code,
            gameState: room.gameState
        };
    } catch (err) {
        console.error('[Invitation] Create error:', err);
        throw err;
    }
}

/**
 * Accept an invitation and join existing room
 */
async function acceptInvitation(code, acceptorId, acceptorPseudo, acceptorSocketId) {
    try {
        console.log('[Invitation] acceptInvitation request', {
            code,
            acceptorId,
            acceptorPseudo,
            acceptorSocketId
        });
        // Validate invitation
        const validation = await withFallback(
            () => invitationModel.isValidInvitation(code),
            () => isMemoryInvitationValid(code)
        );
        
        if (!validation.valid) {
            return { valid: false, error: validation.reason };
        }
        
        const invitation = validation.invitation;
        const roomCode = invitation.roomSettings?.roomCode;
        
        if (!roomCode) {
            return { valid: false, error: 'Invitation has no associated room' };
        }
        
        // Mark as used
        await withFallback(
            () => invitationModel.useInvitation(code),
            () => useMemoryInvitation(code)
        );
        
        // Join existing room as white (second player)
        const room = await roomService.joinRoom(roomCode, {
            whiteId: acceptorId,
            whitePseudo: acceptorPseudo,
            whiteSocketId: acceptorSocketId
        });
        
        return {
            valid: true,
            roomCode: roomCode,
            timeMode: invitation.roomSettings?.timeMode || 'none',
            creatorId: invitation.creatorUserId,
            creatorPseudo: invitation.creatorPseudo,
            creatorElo: invitation.creatorElo,
            gameState: room.gameState
        };
    } catch (err) {
        console.error('[Invitation] Accept error:', err);
        return { valid: false, error: err.message };
    }
}

/**
 * Get invitation info (for display before accepting)
 */
async function getInvitationInfo(code) {
    try {
        const validation = await withFallback(
            () => invitationModel.isValidInvitation(code),
            () => isMemoryInvitationValid(code)
        );
        
        if (!validation.valid) {
            return { valid: false, reason: validation.reason };
        }
        
        const invitation = validation.invitation;
        
        return {
            valid: true,
            creatorPseudo: invitation.creatorPseudo,
            creatorElo: invitation.creatorElo,
            timeMode: invitation.roomSettings?.timeMode || 'none',
            expiresAt: invitation.expiresAt
        };
    } catch (err) {
        console.error('[Invitation] Get info error:', err);
        return { valid: false, reason: 'Error retrieving invitation' };
    }
}

/**
 * Cancel an invitation and clean up the associated room
 */
async function cancelInvitation(code, userId) {
    try {
        // Get invitation to find room code
        const validation = await withFallback(
            () => invitationModel.isValidInvitation(code),
            () => isMemoryInvitationValid(code)
        );
        
        // If invitation exists and has a room, delete it
        if (validation.valid && validation.invitation?.roomSettings?.roomCode) {
            try {
                await roomService.deleteRoom(validation.invitation.roomSettings.roomCode);
            } catch (e) {
                console.log('[Invitation] Room cleanup during cancel failed (may already be deleted):', e.message);
            }
        }
        
        return await withFallback(
            () => invitationModel.cancelInvitation(code, userId),
            () => cancelMemoryInvitation(code, userId)
        );
    } catch (err) {
        console.error('[Invitation] Cancel error:', err);
        return false;
    }
}

/**
 * Cleanup expired invitations
 */
async function cleanupExpired() {
    try {
        const count = await withFallback(
            () => invitationModel.cleanupExpired(),
            () => cleanupMemoryInvitations()
        );
        
        if (count > 0) {
            console.log(`[Invitation] Cleaned up ${count} expired invitations`);
        }
        
        return count;
    } catch (err) {
        console.error('[Invitation] Cleanup error:', err);
        return 0;
    }
}

// ==================== Memory Fallback ====================

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function createMemoryInvitation(userId, pseudo, elo, roomSettings, customCode = null) {
    const code = customCode || generateCode();
    const invitation = {
        id: `mem_${Date.now()}`,
        code,
        creatorUserId: userId,
        creatorPseudo: pseudo,
        creatorElo: elo,
        roomSettings,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        used: false
    };
    
    memoryInvitations.set(code, invitation);
    return invitation;
}

function isMemoryInvitationValid(code) {
    const invitation = memoryInvitations.get(code?.toUpperCase());
    
    if (!invitation) {
        return { valid: false, reason: 'Invitation not found' };
    }
    if (invitation.used) {
        return { valid: false, reason: 'Invitation already used' };
    }
    if (invitation.expiresAt < new Date()) {
        return { valid: false, reason: 'Invitation expired' };
    }
    
    return { valid: true, invitation };
}

function useMemoryInvitation(code) {
    const invitation = memoryInvitations.get(code?.toUpperCase());
    if (invitation) {
        invitation.used = true;
        return true;
    }
    return false;
}

function cancelMemoryInvitation(code, userId) {
    const invitation = memoryInvitations.get(code?.toUpperCase());
    if (invitation && (!invitation.creatorUserId || invitation.creatorUserId === userId)) {
        memoryInvitations.delete(code?.toUpperCase());
        return true;
    }
    return false;
}

function cleanupMemoryInvitations() {
    const now = new Date();
    let count = 0;
    
    for (const [code, invitation] of memoryInvitations.entries()) {
        if (invitation.expiresAt < now || invitation.used) {
            memoryInvitations.delete(code);
            count++;
        }
    }
    
    return count;
}

// Wrapper to try database first, then memory store
async function withFallback(dbOperation, memoryOperation) {
    if (useMemoryStore) {
        return memoryOperation();
    }
    try {
        return await dbOperation();
    } catch (err) {
        console.log('[Invitation] Database unavailable, using memory store');
        useMemoryStore = true;
        return memoryOperation();
    }
}

module.exports = {
    createInvitation,
    acceptInvitation,
    getInvitationInfo,
    cancelInvitation,
    cleanupExpired
};
