/**
 * Refresh Token Model
 * 
 * Database operations for JWT refresh tokens.
 */

const { query } = require('../config/database');
const crypto = require('crypto');

/**
 * Create a refresh token
 */
async function create(userId, expiresAt) {
    const token = crypto.randomBytes(64).toString('hex');
    
    const result = await query(
        `INSERT INTO refresh_tokens (user_id, token, expires_at)
         VALUES ($1, $2, $3)
         RETURNING token`,
        [userId, token, expiresAt]
    );
    
    return result.rows[0].token;
}

/**
 * Find token and verify validity
 */
async function findValid(token) {
    const result = await query(
        `SELECT rt.*, u.id as user_id, u.email, u.pseudo
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
         WHERE rt.token = $1 AND rt.expires_at > NOW()`,
        [token]
    );
    
    return result.rows[0] || null;
}

/**
 * Delete a specific token
 */
async function deleteToken(token) {
    const result = await query(
        `DELETE FROM refresh_tokens WHERE token = $1`,
        [token]
    );
    
    return result.rowCount > 0;
}

/**
 * Delete all tokens for a user (logout all devices)
 */
async function deleteAllForUser(userId) {
    const result = await query(
        `DELETE FROM refresh_tokens WHERE user_id = $1`,
        [userId]
    );
    
    return result.rowCount;
}

/**
 * Clean up expired tokens
 */
async function cleanupExpired() {
    const result = await query(
        `DELETE FROM refresh_tokens WHERE expires_at < NOW()`
    );
    
    return result.rowCount;
}

/**
 * Count active tokens for a user
 */
async function countForUser(userId) {
    const result = await query(
        `SELECT COUNT(*) FROM refresh_tokens 
         WHERE user_id = $1 AND expires_at > NOW()`,
        [userId]
    );
    
    return parseInt(result.rows[0].count);
}

module.exports = {
    create,
    findValid,
    deleteToken,
    deleteAllForUser,
    cleanupExpired,
    countForUser
};
