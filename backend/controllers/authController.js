/**
 * Authentication Controller
 *
 * An address and a password are the only way in. Every door that ends signed
 * in -- signing up, signing in, following a reset link -- answers in the same
 * shape (accountService.sessionAnswer), so the app has one way to adopt a
 * session.
 */

const authService = require('../services/authService');
const accounts = require('../services/accountService');
const { query } = require('../config/database');

/**
 * Register a new user
 * POST /api/auth/signup
 * POST /api/auth/register (alias)
 */
exports.signup = async (req, res, next) => {
    try {
        const body = req.body || {};
        const result = await authService.createUser({
            email: body.email || body.username,
            pseudo: body.pseudo || body.username,
            password: body.password,
        });
        res.status(201).json(await accounts.sessionAnswer(result.userId, result));
    } catch (error) {
        next(error);
    }
};

/**
 * Login user
 * POST /api/auth/login
 */
exports.login = async (req, res, next) => {
    try {
        const body = req.body || {};
        const result = await authService.loginUser({
            email: body.email || body.username,
            password: body.password,
        });
        res.json(await accounts.sessionAnswer(result.userId, result));
    } catch (error) {
        next(error);
    }
};

/**
 * Logout user
 * POST /api/auth/logout
 */
exports.logout = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        await authService.logoutUser(refreshToken);

        res.json({
            data: null,
            meta: {
                message: 'Logged out successfully'
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Refresh access token
 * POST /api/auth/refresh
 */
exports.refreshToken = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        const result = await authService.refreshAccessToken(refreshToken);

        res.json({
            data: {
                accessToken: result.accessToken,
                refreshToken: result.refreshToken
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Verify email
 * POST /api/auth/verify-email
 */
exports.verifyEmail = async (req, res, next) => {
    try {
        const { token } = req.body;

        await authService.verifyEmail(token);

        res.json({
            data: null,
            meta: {
                message: 'Email verified successfully'
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Request password reset
 * POST /api/auth/forgot-password
 *
 * The same answer whether or not the address has an account, so this cannot
 * be used to find out who plays here. A failure to send is logged, not shown,
 * for the same reason.
 */
exports.forgotPassword = async (req, res) => {
    try {
        await authService.requestPasswordReset(req.body && req.body.email);
    } catch (error) {
        console.error('Password reset error:', error);
    }
    res.json({
        data: null,
        meta: {
            message: 'If an account exists with this email, a password reset link will be sent.'
        }
    });
};

/**
 * Reset password, and sign in with it
 * POST /api/auth/reset-password
 */
exports.resetPassword = async (req, res, next) => {
    try {
        const { token, newPassword } = req.body;
        const result = await authService.resetPassword(token, newPassword);
        res.json(await accounts.sessionAnswer(result.userId, result));
    } catch (error) {
        next(error);
    }
};

/**
 * Change password (authenticated)
 * POST /api/auth/change-password
 */
exports.changePassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        await authService.changePassword(userId, currentPassword, newPassword);

        res.json({
            data: null,
            meta: {
                message: 'Password changed successfully'
            }
        });
    } catch (error) {
        next(error);
    }
};

/** GET /api/auth/me — the signed-in account, or 401. */
exports.me = async (req, res, next) => {
    try {
        const row = await accounts.loadAccount(req.user.id);
        await query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [req.user.id]);
        res.json({ user: accounts.publicUser(row), needsPseudo: row.pseudo_chosen !== true });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/auth/pseudo  { pseudo } */
exports.setPseudo = async (req, res, next) => {
    try {
        const user = await accounts.setPseudo(req.user.id, req.body && req.body.pseudo);
        res.json({ user: accounts.publicUser(user), needsPseudo: false });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/auth/pseudo-available?pseudo=… — so the form can react as you type
 * rather than only on submit.
 *
 * Answers signed out too, because that is when it matters most: the sign-up
 * form asks while the nickname is being typed, and there is no account yet to
 * ask on behalf of. It tells a stranger only whether a nickname is taken,
 * which the leaderboard and the lobby say out loud anyway, and the general
 * rate limit still applies.
 *
 * Signed in, your own nickname is not counted against you, so re-saving the
 * one you already have does not come back as unavailable.
 */
exports.pseudoAvailable = async (req, res, next) => {
    try {
        const pseudo = accounts.normalisePseudo(req.query.pseudo);
        const me = req.user ? req.user.id : null;
        const { rows } = await query(
            `SELECT 1 FROM users
             WHERE lower(pseudo) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`,
            [pseudo, me]
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
