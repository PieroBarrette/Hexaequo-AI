/**
 * invitationModel.js - Liens d'invitation (Phase 2)
 * 
 * Table: invitations
 * - id UUID (PK)
 * - code VARCHAR(20) UNIQUE (8 chars alphanumériques)
 * - creator_user_id UUID (FK → users, required - authentication mandatory)
 * - room_settings JSONB (time_mode, etc.)
 * - created_at TIMESTAMP
 * - expires_at TIMESTAMP (défaut: created_at + 24h)
 * - used BOOLEAN (défaut: false)
 * 
 * Responsabilités:
 * - Génération codes uniques (8 caractères)
 * - CRUD invitations
 * - Validation code (existe, non expiré, non utilisé)
 * - Marquer invitation comme utilisée
 * - Cleanup invitations expirées
 * 
 * Exports:
 * - createInvitation(creatorUserId, roomSettings) → {code, expires_at}
 * - getInvitation(code) → invitation | null
 * - useInvitation(code) → boolean
 * - isValidInvitation(code) → {valid, reason?}
 * - cleanupExpired() → deletedCount
 */

const { query } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// Invitation expiration time in hours
const INVITATION_EXPIRATION_HOURS = 24;

// Code generation characters (alphanumeric, no ambiguous chars like 0/O, 1/l)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/**
 * Generate a unique invitation code
 */
function generateCode() {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    }
    return code;
}

/**
 * Create a new invitation
 */
async function createInvitation(creatorUserId, creatorPseudo, creatorElo, roomSettings = {}, customCode = null) {
    // Use custom code (e.g. room code) if provided, otherwise generate random
    const code = customCode || generateCode();
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRATION_HOURS * 60 * 60 * 1000);
    
    try {
        const result = await query(
            `INSERT INTO invitations (id, code, creator_user_id, creator_pseudo, creator_elo, room_settings, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [uuidv4(), code, creatorUserId, creatorPseudo, creatorElo, JSON.stringify(roomSettings), expiresAt]
        );
        
        return formatInvitation(result.rows[0]);
    } catch (err) {
        // Code collision (very rare), retry once if it was auto-generated
        if (err.code === '23505' && !customCode) {
            const newCode = generateCode();
            const result = await query(
                `INSERT INTO invitations (id, code, creator_user_id, creator_pseudo, creator_elo, room_settings, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [uuidv4(), newCode, creatorUserId, creatorPseudo, creatorElo, JSON.stringify(roomSettings), expiresAt]
            );
            return formatInvitation(result.rows[0]);
        }
        throw err;
    }
}

/**
 * Get invitation by code
 */
async function getInvitation(code) {
    if (!code) return null;
    
    const result = await query(
        `SELECT * FROM invitations WHERE code = $1`,
        [code.toUpperCase()]
    );
    
    if (result.rows.length === 0) {
        return null;
    }
    
    return formatInvitation(result.rows[0]);
}

/**
 * Check if invitation is valid (exists, not expired, not used)
 */
async function isValidInvitation(code) {
    const invitation = await getInvitation(code);
    
    if (!invitation) {
        return { valid: false, reason: 'Invitation not found' };
    }
    
    if (invitation.used) {
        return { valid: false, reason: 'Invitation already used' };
    }
    
    if (new Date(invitation.expiresAt) < new Date()) {
        return { valid: false, reason: 'Invitation expired' };
    }
    
    return { valid: true, invitation };
}

/**
 * Mark invitation as used
 */
async function useInvitation(code) {
    if (!code) return false;
    
    const result = await query(
        `UPDATE invitations 
         SET used = TRUE 
         WHERE code = $1 AND used = FALSE AND expires_at > NOW()
         RETURNING id`,
        [code.toUpperCase()]
    );
    
    return result.rowCount > 0;
}

/**
 * Cancel/delete an invitation (creator only)
 */
async function cancelInvitation(code, userId) {
    if (!code) return false;
    
    const result = await query(
        `DELETE FROM invitations 
         WHERE code = $1 AND (creator_user_id = $2 OR creator_user_id IS NULL)
         RETURNING id`,
        [code.toUpperCase(), userId]
    );
    
    return result.rowCount > 0;
}

/**
 * Clean up expired invitations
 */
async function cleanupExpired() {
    const result = await query(
        `DELETE FROM invitations WHERE expires_at < NOW() OR used = TRUE RETURNING id`
    );
    
    return result.rowCount;
}

/**
 * Get all active invitations for a user
 */
async function getUserInvitations(userId) {
    if (!userId) return [];
    
    const result = await query(
        `SELECT * FROM invitations 
         WHERE creator_user_id = $1 AND used = FALSE AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [userId]
    );
    
    return result.rows.map(formatInvitation);
}

/**
 * Format invitation for external use
 */
function formatInvitation(row) {
    if (!row) return null;
    
    return {
        id: row.id,
        code: row.code,
        creatorUserId: row.creator_user_id,
        creatorPseudo: row.creator_pseudo,
        creatorElo: row.creator_elo,
        roomSettings: typeof row.room_settings === 'string' ? JSON.parse(row.room_settings) : row.room_settings,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        used: row.used
    };
}

module.exports = {
    createInvitation,
    getInvitation,
    isValidInvitation,
    useInvitation,
    cancelInvitation,
    cleanupExpired,
    getUserInvitations,
    INVITATION_EXPIRATION_HOURS
};
