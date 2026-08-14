/**
 * Sign in with Google.
 *
 * The browser runs Google Identity Services, which hands it a signed ID token.
 * The token comes here and is verified against Google's public keys — the
 * client is never believed about who it is. Nothing else is needed: no client
 * secret, no redirect URI, no session with Google afterwards.
 *
 * Google is only an identity provider. The player's name on Hexaequo is the
 * pseudo they choose here, not their Google name.
 */

const { OAuth2Client } = require('google-auth-library');
const { query } = require('../config/database');
const { GOOGLE_CLIENT_ID } = require('../config/env');
const { validationError, conflict, unauthorized } = require('../middleware/errorHandler');

const client = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const PSEUDO_MIN = 3;
const PSEUDO_MAX = 20;
// Letters (accents included), digits, and single separators between them.
const PSEUDO_SHAPE = /^[\p{L}\p{N}](?:[\p{L}\p{N}]|[ _-](?![ _-])){1,18}[\p{L}\p{N}]$/u;

/** Verify an ID token and return the claims we care about. */
async function verifyIdToken(credential) {
    if (!client) throw validationError('Google sign-in is not configured on this server');
    if (!credential || typeof credential !== 'string') throw validationError('Missing Google credential');

    let ticket;
    try {
        ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    } catch (error) {
        throw unauthorized('Google rejected this sign-in');
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.sub) throw unauthorized('Google returned no account identifier');
    if (!payload.email) throw unauthorized('This Google account has no email address');
    // Google sets this false for accounts whose address was never confirmed;
    // trusting it would let someone claim an address they do not own.
    if (payload.email_verified === false) throw unauthorized('This Google email address is not verified');

    return {
        googleId: String(payload.sub),
        email: String(payload.email).toLowerCase(),
        name: payload.name || '',
        picture: payload.picture || null,
    };
}

/** Strip a Google display name down to something usable as a pseudo. */
function seedFromName(name, email) {
    const base = (name || email.split('@')[0] || 'player')
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N} _-]/gu, '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, PSEUDO_MAX);
    return base.length >= PSEUDO_MIN ? base : 'Player';
}

/** A free pseudo close to `seed`, suffixed only if it is taken. */
async function availablePseudo(seed) {
    const taken = async (value) => {
        const { rows } = await query('SELECT 1 FROM users WHERE lower(pseudo) = lower($1) LIMIT 1', [value]);
        return rows.length > 0;
    };
    if (!await taken(seed)) return seed;
    for (let attempt = 0; attempt < 50; attempt++) {
        const suffix = String(Math.floor(Math.random() * 9000) + 1000);
        const candidate = seed.slice(0, PSEUDO_MAX - suffix.length - 1) + '-' + suffix;
        if (!await taken(candidate)) return candidate;
    }
    throw conflict('Could not allocate a nickname');
}

/**
 * Find or create the account behind a Google identity.
 *
 * Three cases: a returning Google user, an existing password account with the
 * same address adopting Google, and a brand-new player.
 */
async function findOrCreateUser({ googleId, email, name, picture }) {
    const byGoogle = await query('SELECT * FROM users WHERE google_id = $1', [googleId]);
    if (byGoogle.rows.length) {
        const user = byGoogle.rows[0];
        await query(
            'UPDATE users SET last_seen = CURRENT_TIMESTAMP, avatar_url = COALESCE($2, avatar_url) WHERE id = $1',
            [user.id, picture]
        );
        return { user, created: false };
    }

    const byEmail = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    if (byEmail.rows.length) {
        // Same address, already registered with a password: link the two rather
        // than refusing, or creating a second account for the same person.
        const user = byEmail.rows[0];
        const { rows } = await query(
            `UPDATE users
                SET google_id = $2, email_verified = TRUE, last_seen = CURRENT_TIMESTAMP,
                    avatar_url = COALESCE($3, avatar_url)
              WHERE id = $1 RETURNING *`,
            [user.id, googleId, picture]
        );
        return { user: rows[0], created: false, linked: true };
    }

    const pseudo = await availablePseudo(seedFromName(name, email));
    const { rows } = await query(
        `INSERT INTO users (email, pseudo, google_id, email_verified, pseudo_chosen, avatar_url)
         VALUES ($1, $2, $3, TRUE, FALSE, $4)
         RETURNING *`,
        [email, pseudo, googleId, picture]
    );
    return { user: rows[0], created: true };
}

/** What the client is allowed to know about an account — never the hash. */
function publicUser(user) {
    return {
        id: user.id,
        pseudo: user.pseudo,
        pseudoChosen: user.pseudo_chosen === true,
        email: user.email,
        elo: user.elo,
        gamesPlayed: user.games_played,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
        avatarUrl: user.avatar_url,
        createdAt: user.created_at,
    };
}

/** Validate a nickname the player typed. Returns the trimmed value. */
function normalisePseudo(raw) {
    const value = String(raw || '').trim().replace(/\s+/g, ' ');
    if (value.length < PSEUDO_MIN || value.length > PSEUDO_MAX) {
        throw validationError(`Nickname must be between ${PSEUDO_MIN} and ${PSEUDO_MAX} characters`);
    }
    if (!PSEUDO_SHAPE.test(value)) {
        throw validationError('Nickname may use letters, digits, spaces, hyphens and underscores');
    }
    return value;
}

/** Claim a nickname for an account, refusing one already in use. */
async function setPseudo(userId, raw) {
    const pseudo = normalisePseudo(raw);
    const clash = await query(
        'SELECT 1 FROM users WHERE lower(pseudo) = lower($1) AND id <> $2 LIMIT 1',
        [pseudo, userId]
    );
    if (clash.rows.length) throw conflict('That nickname is taken');

    const { rows } = await query(
        'UPDATE users SET pseudo = $2, pseudo_chosen = TRUE WHERE id = $1 RETURNING *',
        [userId, pseudo]
    );
    if (!rows.length) throw validationError('Unknown account');
    return rows[0];
}

module.exports = {
    verifyIdToken,
    findOrCreateUser,
    publicUser,
    setPseudo,
    normalisePseudo,
    availablePseudo,
    seedFromName,
    isConfigured: () => Boolean(client),
    PSEUDO_MIN,
    PSEUDO_MAX,
};
