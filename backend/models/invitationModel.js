/**
 * invitationModel.js - Liens d'invitation (Phase 2)
 * 
 * Table: invitations
 * - id UUID (PK)
 * - code VARCHAR(20) UNIQUE (8 chars alphanumériques)
 * - creator_user_id UUID (FK → users, nullable pour guests)
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

const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// TODO: Implémenter Phase 2

module.exports = {
    // createInvitation,
    // getInvitation,
    // useInvitation,
    // isValidInvitation,
    // cleanupExpired
};
