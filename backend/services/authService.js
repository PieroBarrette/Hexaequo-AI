/**
 * Authentication Service
 * 
 * Business logic for user authentication.
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { 
    JWT_SECRET, 
    JWT_EXPIRES_IN, 
    JWT_REFRESH_EXPIRES_IN,
    BCRYPT_ROUNDS 
} = require('../config/env');
const { AppError, conflict, unauthorized, notFound } = require('../middleware/errorHandler');
const emailService = require('./emailService');

// Temporary in-memory storage (replace with database)
const users = new Map();
const refreshTokens = new Set();
const verificationTokens = new Map();
const resetTokens = new Map();

/**
 * Generate JWT tokens
 */
function generateTokens(user) {
    const accessToken = jwt.sign(
        { userId: user.id, email: user.email, pseudo: user.pseudo },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );

    const refreshToken = jwt.sign(
        { userId: user.id, type: 'refresh' },
        JWT_SECRET,
        { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );

    refreshTokens.add(refreshToken);

    return { accessToken, refreshToken };
}

/**
 * Create a new user
 */
exports.createUser = async ({ email, pseudo, password }) => {
    // Check if email already exists
    for (const user of users.values()) {
        if (user.email === email.toLowerCase()) {
            throw conflict('Email already registered');
        }
        if (user.pseudo.toLowerCase() === pseudo.toLowerCase()) {
            throw conflict('Pseudo already taken');
        }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create user
    const userId = crypto.randomUUID();
    const user = {
        id: userId,
        email: email.toLowerCase(),
        pseudo,
        password: hashedPassword,
        emailVerified: false,
        elo: {
            classic: 1500,
            rapid: 1500,
            blitz: 1500
        },
        stats: {
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            draws: 0
        },
        settings: {
            theme: 'dark',
            sounds: true,
            animations: true
        },
        createdAt: new Date().toISOString()
    };

    users.set(userId, user);

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    verificationTokens.set(verificationToken, { userId, expires: Date.now() + 24 * 60 * 60 * 1000 });

    // Send verification email (async, don't wait)
    emailService.sendVerificationEmail(email, verificationToken).catch(console.error);

    return { userId: user.id, email: user.email, pseudo: user.pseudo };
};

/**
 * Login user
 */
exports.loginUser = async ({ email, password }) => {
    // Find user by email
    let user = null;
    for (const u of users.values()) {
        if (u.email === email.toLowerCase()) {
            user = u;
            break;
        }
    }

    if (!user) {
        throw unauthorized('Invalid email or password');
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
        throw unauthorized('Invalid email or password');
    }

    // Generate tokens
    const tokens = generateTokens(user);

    return {
        ...tokens,
        user: {
            id: user.id,
            pseudo: user.pseudo,
            email: user.email,
            elo: user.elo
        }
    };
};

/**
 * Logout user
 */
exports.logoutUser = async (refreshToken) => {
    refreshTokens.delete(refreshToken);
};

/**
 * Refresh access token
 */
exports.refreshAccessToken = async (refreshToken) => {
    if (!refreshTokens.has(refreshToken)) {
        throw unauthorized('Invalid refresh token');
    }

    try {
        const decoded = jwt.verify(refreshToken, JWT_SECRET);
        const user = users.get(decoded.userId);

        if (!user) {
            throw unauthorized('User not found');
        }

        // Invalidate old refresh token
        refreshTokens.delete(refreshToken);

        // Generate new tokens
        return generateTokens(user);
    } catch (error) {
        refreshTokens.delete(refreshToken);
        throw unauthorized('Invalid refresh token');
    }
};

/**
 * Verify email
 */
exports.verifyEmail = async (token) => {
    const tokenData = verificationTokens.get(token);

    if (!tokenData || tokenData.expires < Date.now()) {
        throw new AppError('Invalid or expired verification token', 400, 'INVALID_TOKEN');
    }

    const user = users.get(tokenData.userId);
    if (user) {
        user.emailVerified = true;
    }

    verificationTokens.delete(token);
};

/**
 * Request password reset
 */
exports.requestPasswordReset = async (email) => {
    let user = null;
    for (const u of users.values()) {
        if (u.email === email.toLowerCase()) {
            user = u;
            break;
        }
    }

    if (!user) {
        // Don't reveal if email exists
        return;
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    resetTokens.set(resetToken, { userId: user.id, expires: Date.now() + 60 * 60 * 1000 });

    // Send reset email
    await emailService.sendPasswordResetEmail(email, resetToken);
};

/**
 * Reset password
 */
exports.resetPassword = async (token, newPassword) => {
    const tokenData = resetTokens.get(token);

    if (!tokenData || tokenData.expires < Date.now()) {
        throw new AppError('Invalid or expired reset token', 400, 'INVALID_TOKEN');
    }

    const user = users.get(tokenData.userId);
    if (!user) {
        throw notFound('User');
    }

    // Hash new password
    user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    resetTokens.delete(token);
};

/**
 * Change password (authenticated)
 */
exports.changePassword = async (userId, currentPassword, newPassword) => {
    const user = users.get(userId);
    if (!user) {
        throw notFound('User');
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
        throw unauthorized('Current password is incorrect');
    }

    // Hash new password
    user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
};
