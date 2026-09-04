/**
 * User Model
 * 
 * Database operations for users.
 */

const { query, transaction } = require('../config/database');
const bcrypt = require('bcryptjs');
const { BCRYPT_ROUNDS } = require('../config/env');

/**
 * Create a new user
 */
async function create({ email, pseudo, password }) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    /* pseudo_chosen matters: it is what tells the app whether to stop and ask
       for a nickname. Someone signing up with an address typed theirs into the
       form, unlike a Google sign-up where one is invented from their name — so
       it is chosen, and leaving it false reopened the account panel demanding a
       nickname on every single visit. */
    const result = await query(
        `INSERT INTO users (email, pseudo, password_hash, pseudo_chosen)
         VALUES ($1, $2, $3, TRUE)
         RETURNING id, email, pseudo, pseudo_chosen, created_at`,
        [email.toLowerCase(), pseudo, passwordHash]
    );
    
    return result.rows[0];
}

/**
 * Find user by ID
 */
async function findById(id) {
    const result = await query(
        `SELECT id, email, pseudo, email_verified,
                elo,
                games_played, wins, losses, draws,
                settings, avatar_url, country_code,
                created_at, last_seen
         FROM users WHERE id = $1`,
        [id]
    );
    
    return result.rows[0] || null;
}

/**
 * Find user by email
 */
async function findByEmail(email) {
    const result = await query(
        `SELECT id, email, pseudo, password_hash, email_verified,
                elo,
                games_played, wins, losses, draws,
                settings, created_at
         FROM users WHERE email = $1`,
        [email.toLowerCase()]
    );
    
    return result.rows[0] || null;
}

/**
 * Find user by pseudo
 */
async function findByPseudo(pseudo) {
    const result = await query(
        `SELECT id, email, pseudo, email_verified,
                elo,
                games_played, wins, losses, draws,
                settings, created_at
         FROM users WHERE LOWER(pseudo) = LOWER($1)`,
        [pseudo]
    );
    
    return result.rows[0] || null;
}

/**
 * Update user profile
 */
async function update(id, updates) {
    const allowedFields = ['pseudo', 'avatar_url', 'country_code'];
    const fields = [];
    const values = [];
    let paramIndex = 1;
    
    for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
            fields.push(`${key} = $${paramIndex}`);
            values.push(value);
            paramIndex++;
        }
    }
    
    if (fields.length === 0) return null;
    
    values.push(id);
    
    const result = await query(
        `UPDATE users SET ${fields.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING id, email, pseudo, avatar_url, country_code`,
        values
    );
    
    return result.rows[0] || null;
}

/**
 * Update user settings
 */
async function updateSettings(id, settings) {
    const result = await query(
        `UPDATE users
         SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb
         WHERE id = $2
         RETURNING settings`,
        [JSON.stringify(settings), id]
    );
    
    return result.rows[0]?.settings || null;
}

/**
 * Update password
 */
async function updatePassword(id, newPassword) {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    
    await query(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [passwordHash, id]
    );
}

/**
 * Verify password
 */
async function verifyPassword(user, password) {
    // An account that only signs in with Google has no hash to compare
    // against, and bcrypt throws rather than returning false when handed one.
    if (!user || !user.password_hash) return false;
    return bcrypt.compare(password, user.password_hash);
}

/**
 * Set verification token
 */
/*
 * Deadlines are computed by the database, not by us.
 *
 * verification_expires and reset_expires are TIMESTAMP WITHOUT TIME ZONE, and
 * they are compared against NOW() — the database's clock. Sending a JS Date
 * writes it in *this* machine's local time, so a server four hours behind the
 * database issued tokens that were already four hours expired. One clock owns
 * the deadline, and it is the one doing the comparing.
 */
async function setVerificationToken(id, token, ttl = '24 hours') {
    await query(
        `UPDATE users
         SET verification_token = $1, verification_expires = NOW() + $2::interval
         WHERE id = $3`,
        [token, ttl, id]
    );
}

/**
 * Verify email with token
 */
async function verifyEmail(token) {
    const result = await query(
        `UPDATE users 
         SET email_verified = TRUE, verification_token = NULL, verification_expires = NULL
         WHERE verification_token = $1 AND verification_expires > NOW()
         RETURNING id`,
        [token]
    );
    
    return result.rowCount > 0;
}

/**
 * Set password reset token
 */
async function setResetToken(email, token, ttl = '1 hour') {
    const result = await query(
        `UPDATE users
         SET reset_token = $1, reset_expires = NOW() + $2::interval
         WHERE email = $3
         RETURNING id`,
        [token, ttl, email.toLowerCase()]
    );
    
    return result.rowCount > 0;
}

/**
 * Reset password with token
 */
async function resetPassword(token, newPassword) {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    
    const result = await query(
        `UPDATE users 
         SET password_hash = $1, reset_token = NULL, reset_expires = NULL
         WHERE reset_token = $2 AND reset_expires > NOW()
         RETURNING id`,
        [passwordHash, token]
    );
    
    return result.rowCount > 0;
}

/**
 * Update ELO rating
 */
async function updateElo(id, newElo, eloChange, gameId) {
    return transaction(async (client) => {
        // Update user ELO
        await client.query(
            `UPDATE users SET elo = $1 WHERE id = $2`,
            [newElo, id]
        );
        
        // Record in history
        await client.query(
            `INSERT INTO elo_history (user_id, game_id, elo_before, elo_after, elo_change)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, gameId, newElo - eloChange, newElo, eloChange]
        );
    });
}

/**
 * Update game statistics
 */
async function updateStats(id, result) {
    const field = result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws';
    
    await query(
        `UPDATE users 
         SET games_played = games_played + 1, ${field} = ${field} + 1
         WHERE id = $1`,
        [id]
    );
}

/**
 * Update last seen timestamp
 */
async function updateLastSeen(id) {
    await query(
        `UPDATE users SET last_seen = NOW() WHERE id = $1`,
        [id]
    );
}

/**
 * Delete user
 */
async function deleteUser(id) {
    const result = await query(
        `DELETE FROM users WHERE id = $1`,
        [id]
    );
    
    return result.rowCount > 0;
}

/**
 * Get leaderboard
 */
/**
 * Everybody, in order.
 *
 * It used to be everybody who had finished a rated game, which made the table
 * a record of play — defensible, and not what a member wants to see when they
 * open it looking for their own name on the day they sign up. A rating of a
 * thousand is a real rating, the one every account starts at, so a player who
 * has not begun sits where a player who has broken even sits.
 *
 * Ties are broken by who got here first. Ordering by rating alone left the
 * order of equal ratings to the database, so two members on a thousand could
 * swap places between one visit and the next — and with a thousand being where
 * everyone starts, that is most of the table. Seniority is a fact, it never
 * changes, and it cannot be played for. The id settles the last hair of a tie
 * so that paging cannot show a row twice or miss one.
 */
async function getLeaderboard({ page = 1, limit = 50 } = {}) {
    const offset = (page - 1) * limit;

    /*
     * Except the ones that are not people.
     *
     * .invalid is the domain reserved by RFC 2606 for addresses that cannot
     * exist, which is what the test suites signed their accounts up with, and
     * a list of everybody turned out to be a list of everybody including seven
     * robots. Not a filter on a name or a guess at a pattern: an address in
     * that domain is one nobody can hold.
     */
    const REAL_PEOPLE = `WHERE email NOT LIKE '%.invalid'`;

    const [countResult, dataResult] = await Promise.all([
        query(`SELECT COUNT(*) FROM users ${REAL_PEOPLE}`),
        query(
            `SELECT id, pseudo, elo, games_played, wins, losses, draws,
                    CASE WHEN games_played > 0 THEN ROUND(wins::numeric / games_played * 100, 1) ELSE 0 END as win_rate
             FROM users
             ${REAL_PEOPLE}
             ORDER BY elo DESC, created_at ASC, id ASC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        )
    ]);
    
    const total = parseInt(countResult.rows[0].count);
    
    return {
        players: dataResult.rows.map((row, index) => ({
            rank: offset + index + 1,
            ...row
        })),
        total,
        page,
        totalPages: Math.ceil(total / limit)
    };
}

/**
 * Check if email exists
 */
async function emailExists(email) {
    const result = await query(
        `SELECT 1 FROM users WHERE email = $1`,
        [email.toLowerCase()]
    );
    return result.rowCount > 0;
}

/**
 * Check if pseudo exists
 */
async function pseudoExists(pseudo) {
    const result = await query(
        `SELECT 1 FROM users WHERE LOWER(pseudo) = LOWER($1)`,
        [pseudo]
    );
    return result.rowCount > 0;
}

module.exports = {
    create,
    findById,
    findByEmail,
    findByPseudo,
    update,
    updateSettings,
    updatePassword,
    verifyPassword,
    setVerificationToken,
    verifyEmail,
    setResetToken,
    resetPassword,
    updateElo,
    updateStats,
    updateLastSeen,
    deleteUser,
    getLeaderboard,
    emailExists,
    pseudoExists
};
