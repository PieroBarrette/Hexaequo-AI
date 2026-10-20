/**
 * The account as the app sees it: what it may know, the nickname, and the
 * shape every way of signing in answers with.
 *
 * Accounts are an address and a password, and nothing else. Some older rows
 * have no password: they were made by the Google sign-in this site no longer
 * offers, mostly by attempts that never got as far as a session. Their owners
 * get in the way anyone who has forgotten a password does — a link sent to the
 * address sets one — and keep the account, its nickname and its rating.
 */

const { query } = require('../config/database');
const { AppError, validationError, notFound } = require('../middleware/errorHandler');

const PSEUDO_MIN = 3;
const PSEUDO_MAX = 20;
// Letters (accents included), digits, and single separators between them.
const PSEUDO_SHAPE = /^[\p{L}\p{N}](?:[\p{L}\p{N}]|[ _-](?![ _-])){1,18}[\p{L}\p{N}]$/u;

/* Enough to catch a slip of the keyboard. Whether the address is real is
   settled by the mail sent to it, not by a pattern. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
        createdAt: user.created_at,
        /* Whether there is a password to change. An older account may have
           none yet, and offering the form would be offering a dead end. */
        hasPassword: Boolean(user.password_hash),
    };
}

/**
 * The whole row behind an account.
 *
 * publicUser needs columns the narrower lookups in the user model leave out —
 * whether a password is set, whether the nickname was chosen — and building it
 * from one of those said "no password" to everybody who had just signed in
 * with theirs.
 */
async function loadAccount(id) {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
    if (!rows.length) throw notFound('Account');
    return rows[0];
}

/**
 * What every way in answers with: a session, the account, and whether a
 * nickname is still owed.
 */
async function sessionAnswer(id, tokens) {
    const row = await loadAccount(id);
    return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || null,
        user: publicUser(row),
        needsPseudo: row.pseudo_chosen !== true,
    };
}

/** Validate a nickname the player typed. Returns the trimmed value. */
function normalisePseudo(raw) {
    const value = String(raw || '').trim().replace(/\s+/g, ' ');
    if (value.length < PSEUDO_MIN || value.length > PSEUDO_MAX || !PSEUDO_SHAPE.test(value)) {
        throw new AppError(
            `Nickname must be ${PSEUDO_MIN} to ${PSEUDO_MAX} letters or digits, `
            + 'with single spaces, hyphens or underscores between them',
            400, 'BAD_PSEUDO');
    }
    return value;
}

/** Validate an address. Returns it trimmed and lower-cased, as it is stored. */
function normaliseEmail(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (value.length > 255 || !EMAIL_SHAPE.test(value)) {
        throw new AppError('That does not look like an email address', 400, 'BAD_EMAIL');
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
    if (clash.rows.length) throw new AppError('That nickname is taken', 409, 'PSEUDO_TAKEN');

    const { rows } = await query(
        'UPDATE users SET pseudo = $2, pseudo_chosen = TRUE WHERE id = $1 RETURNING *',
        [userId, pseudo]
    );
    if (!rows.length) throw validationError('Unknown account');
    return rows[0];
}

module.exports = {
    publicUser,
    loadAccount,
    sessionAnswer,
    normalisePseudo,
    normaliseEmail,
    setPseudo,
    PSEUDO_MIN,
    PSEUDO_MAX,
};
