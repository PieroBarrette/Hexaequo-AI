/**
 * Endpoints for Google sign-in and the nickname that goes with it.
 */

const googleAuth = require('../services/googleAuthService');
const authService = require('../services/authService');
const { query } = require('../config/database');
const { notFound } = require('../middleware/errorHandler');

/**
 * POST /api/auth/google  { credential }
 *
 * Exchange a Google ID token for a Hexaequo session. Answers with the account
 * and whether the player still has to choose a nickname.
 */
exports.signInWithGoogle = async (req, res, next) => {
    try {
        const claims = await googleAuth.verifyIdToken(req.body && req.body.credential);
        const { user, created } = await googleAuth.findOrCreateUser(claims);
        const tokens = await authService.generateTokens(user);

        res.json({
            user: googleAuth.publicUser(user),
            ...tokens,
            created: Boolean(created),
            needsPseudo: user.pseudo_chosen !== true,
        });
    } catch (error) {
        next(error);
    }
};

/** GET /api/auth/me — the signed-in account, or 401. */
exports.me = async (req, res, next) => {
    try {
        const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        if (!rows.length) throw notFound('Account');
        await query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [req.user.id]);
        res.json({
            user: googleAuth.publicUser(rows[0]),
            needsPseudo: rows[0].pseudo_chosen !== true,
        });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/auth/pseudo  { pseudo } */
exports.setPseudo = async (req, res, next) => {
    try {
        const user = await googleAuth.setPseudo(req.user.id, req.body && req.body.pseudo);
        res.json({ user: googleAuth.publicUser(user), needsPseudo: false });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/auth/pseudo-available?pseudo=… — so the form can react as you type
 * rather than only on submit.
 */
exports.pseudoAvailable = async (req, res, next) => {
    try {
        const pseudo = googleAuth.normalisePseudo(req.query.pseudo);
        const { rows } = await query(
            'SELECT 1 FROM users WHERE lower(pseudo) = lower($1) AND id <> $2 LIMIT 1',
            [pseudo, req.user.id]
        );
        res.json({ pseudo, available: rows.length === 0 });
    } catch (error) {
        // A malformed nickname is an answer, not a failure: report why.
        if (error && error.statusCode === 400) {
            return res.json({ available: false, reason: error.message });
        }
        next(error);
    }
};

/**
 * GET /api/auth/config — what the browser needs to draw Google's button.
 * The client id is public by design; it identifies the app, it does not
 * authenticate it.
 */
exports.config = (req, res) => {
    res.json({
        googleClientId: require('../config/env').GOOGLE_CLIENT_ID || null,
        googleEnabled: googleAuth.isConfigured(),
    });
};
