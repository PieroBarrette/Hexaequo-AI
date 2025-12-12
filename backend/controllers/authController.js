/**
 * Authentication Controller
 * 
 * Handles user registration, login, logout, and password management.
 */

const authService = require('../services/authService');

/**
 * Register a new user
 * POST /api/auth/signup
 */
exports.signup = async (req, res, next) => {
    try {
        const { email, pseudo, password } = req.body;

        const result = await authService.createUser({ email, pseudo, password });

        res.status(201).json({
            data: {
                userId: result.userId,
                email: result.email,
                pseudo: result.pseudo
            },
            meta: {
                message: 'Account created successfully. Please check your email to verify your account.'
            }
        });
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
        const { email, password } = req.body;

        const result = await authService.loginUser({ email, password });

        res.json({
            data: {
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                user: {
                    id: result.user.id,
                    pseudo: result.user.pseudo,
                    email: result.user.email,
                    elo: result.user.elo
                }
            }
        });
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
 */
exports.forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;

        await authService.requestPasswordReset(email);

        // Always return success to prevent email enumeration
        res.json({
            data: null,
            meta: {
                message: 'If an account exists with this email, a password reset link will be sent.'
            }
        });
    } catch (error) {
        // Log error but return generic response
        console.error('Password reset error:', error);
        res.json({
            data: null,
            meta: {
                message: 'If an account exists with this email, a password reset link will be sent.'
            }
        });
    }
};

/**
 * Reset password
 * POST /api/auth/reset-password
 */
exports.resetPassword = async (req, res, next) => {
    try {
        const { token, newPassword } = req.body;

        await authService.resetPassword(token, newPassword);

        res.json({
            data: null,
            meta: {
                message: 'Password reset successfully'
            }
        });
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
