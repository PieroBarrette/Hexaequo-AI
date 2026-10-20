/**
 * Authentication Service
 * 
 * Business logic for user authentication using PostgreSQL database.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { 
    JWT_SECRET, 
    JWT_EXPIRES_IN, 
    JWT_REFRESH_EXPIRES_IN
} = require('../config/env');
const { AppError, unauthorized, notFound } = require('../middleware/errorHandler');
const emailService = require('./emailService');
const { User, RefreshToken } = require('../models');
const { normaliseEmail, normalisePseudo } = require('./accountService');

/*
 * Every refusal here carries a code the app can say in the reader's language;
 * the message is for logs and for anybody calling the API by hand.
 *
 * A wrong password is a 403, not a 401. The app reads a 401 as "your session
 * is over" -- it spends the refresh token, asks again, and signs out -- so a
 * mistyped current password on the change-password form used to sign the
 * player out. Only the session decides whether they are signed in.
 */
const invalidCredentials = () => new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
const noPassword = () => new AppError('This account has no password yet', 401, 'NO_PASSWORD');
const wrongPassword = () => new AppError('Current password is incorrect', 403, 'WRONG_PASSWORD');
const weakPassword = () => new AppError('Password must be at least 8 characters', 400, 'WEAK_PASSWORD');

/**
 * Parse time string to milliseconds
 */
function parseExpiry(expiryString) {
    const match = expiryString.match(/^(\d+)([smhd])$/);
    if (!match) return 24 * 60 * 60 * 1000; // Default 24 hours
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return 24 * 60 * 60 * 1000;
    }
}

/**
 * Generate JWT tokens
 */
async function generateTokens(user) {
    const accessToken = jwt.sign(
        { userId: user.id, email: user.email, pseudo: user.pseudo },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );

    // Calculate refresh token expiry
    const refreshExpiryMs = parseExpiry(JWT_REFRESH_EXPIRES_IN);
    const refreshExpiresAt = new Date(Date.now() + refreshExpiryMs);
    
    // Store refresh token in database
    const refreshToken = await RefreshToken.create(user.id, refreshExpiresAt);

    return { accessToken, refreshToken };
}

/**
 * Create a new user
 *
 * The nickname follows the same rules as renaming one later, so nothing the
 * sign-up form accepts can be refused by the profile, or the other way round.
 */
exports.createUser = async ({ email, pseudo, password }) => {
    const address = normaliseEmail(email);
    const name = normalisePseudo(pseudo);
    if (String(password || '').length < 8) throw weakPassword();

    /* An address with an account but no password is an older account, made
       through the Google sign-in this site no longer has: the same person at
       a door that is gone. Saying so, rather than "taken", lets the app offer
       the link that sets a password -- which is how that person gets in. */
    const existing = await User.findByEmail(address);
    if (existing) {
        throw existing.password_hash
            ? new AppError('Email already registered', 409, 'EMAIL_TAKEN')
            : new AppError('This address has an account with no password yet', 409, 'NO_PASSWORD');
    }
    if (await User.pseudoExists(name)) {
        throw new AppError('That nickname is taken', 409, 'PSEUDO_TAKEN');
    }

    let user;
    try {
        user = await User.create({ email: address, pseudo: name, password });
    } catch (error) {
        /* Two sign-ups racing for the same address or nickname: the checks
           above both passed, and the unique index settled it. Answer as they
           would have, not with a 500. */
        if (error && error.code === '23505') {
            throw /email/i.test(error.constraint || error.detail || '')
                ? new AppError('Email already registered', 409, 'EMAIL_TAKEN')
                : new AppError('That nickname is taken', 409, 'PSEUDO_TAKEN');
        }
        throw error;
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    await User.setVerificationToken(user.id, verificationToken);

    // Sent in the background: a mail server being slow must not hold up the
    // account, which works without the address being confirmed.
    emailService.sendVerificationEmail(address, verificationToken).catch(console.error);

    // Signed in at once.
    const tokens = await generateTokens(user);
    return { userId: user.id, ...tokens };
};

/**
 * Login user
 */
exports.loginUser = async ({ email, password }) => {
    const user = await User.findByEmail(String(email || '').trim());
    if (!user) throw invalidCredentials();

    /* An older account may have no password. Saying so is worth the small
       disclosure -- sign-up already answers "taken" for an address that
       exists -- because the alternative is sending someone round a loop they
       cannot get out of. The app answers it with the link that sets one. */
    if (!user.password_hash) throw noPassword();

    if (!await User.verifyPassword(user, password)) throw invalidCredentials();

    await User.updateLastSeen(user.id);
    const tokens = await generateTokens(user);
    return { userId: user.id, ...tokens };
};

/**
 * Logout user
 */
exports.logoutUser = async (refreshToken) => {
    await RefreshToken.deleteToken(refreshToken);
};

/**
 * Logout from all devices
 */
exports.logoutAllDevices = async (userId) => {
    return await RefreshToken.deleteAllForUser(userId);
};

/**
 * Refresh access token
 */
exports.refreshAccessToken = async (refreshToken) => {
    const tokenData = await RefreshToken.findValid(refreshToken);
    
    if (!tokenData) {
        throw unauthorized('Invalid refresh token');
    }

    const user = await User.findById(tokenData.user_id);
    
    if (!user) {
        await RefreshToken.deleteToken(refreshToken);
        throw unauthorized('User not found');
    }

    // Invalidate old refresh token
    await RefreshToken.deleteToken(refreshToken);

    // Generate new tokens
    return await generateTokens(user);
};

/**
 * Verify email
 */
exports.verifyEmail = async (token) => {
    const success = await User.verifyEmail(token);
    
    if (!success) {
        throw new AppError('Invalid or expired verification token', 400, 'INVALID_TOKEN');
    }
};

/**
 * Resend verification email
 */
exports.resendVerification = async (email) => {
    const user = await User.findByEmail(email);
    
    if (!user) {
        // Don't reveal if email exists
        return;
    }
    
    if (user.email_verified) {
        throw new AppError('Email already verified', 400, 'ALREADY_VERIFIED');
    }

    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    await User.setVerificationToken(user.id, verificationToken);

    // Send verification email
    await emailService.sendVerificationEmail(email, verificationToken);
};

/**
 * Request password reset
 *
 * Also how an account with no password gets its first one: the link proves
 * the address, which is all a password would have proved.
 */
exports.requestPasswordReset = async (email) => {
    const address = String(email || '').trim().toLowerCase();
    if (!address) return;
    const resetToken = crypto.randomBytes(32).toString('hex');
    if (await User.setResetToken(address, resetToken)) {
        await emailService.sendPasswordResetEmail(address, resetToken);
    }
    // Don't reveal if email exists - same response either way
};

/**
 * Reset password
 *
 * Answers with the account, so that following the link signs the player in
 * rather than sending them round to the sign-in form to type what they have
 * just chosen. Every other session of the account is ended: a reset is often
 * the answer to somebody else having had the old password.
 */
exports.resetPassword = async (token, newPassword) => {
    if (String(newPassword || '').length < 8) throw weakPassword();
    const userId = await User.resetPassword(token, newPassword);
    if (!userId) {
        throw new AppError('Invalid or expired reset token', 400, 'INVALID_TOKEN');
    }
    await RefreshToken.deleteAllForUser(userId);
    const tokens = await generateTokens(await User.findById(userId));
    return { userId, ...tokens };
};

/**
 * Change password (authenticated)
 */
exports.changePassword = async (userId, currentPassword, newPassword) => {
    const user = await User.findById(userId);
    if (!user) {
        throw notFound('User');
    }
    if (String(newPassword || '').length < 8) throw weakPassword();

    // Get full user with password hash
    const fullUser = await User.findByEmail(user.email);
    if (!fullUser || !fullUser.password_hash) {
        throw new AppError('This account has no password yet', 400, 'NO_PASSWORD');
    }
    if (!await User.verifyPassword(fullUser, currentPassword)) throw wrongPassword();

    await User.updatePassword(userId, newPassword);
};

/**
 * Validate token and get user
 */
exports.validateToken = async (token) => {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            throw unauthorized('User not found');
        }
        
        return {
            userId: user.id,
            email: user.email,
            pseudo: user.pseudo
        };
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            throw unauthorized('Invalid token');
        }
        if (error.name === 'TokenExpiredError') {
            throw unauthorized('Token expired');
        }
        throw error;
    }
};
