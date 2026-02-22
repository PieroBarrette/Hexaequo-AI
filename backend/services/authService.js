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
const { AppError, conflict, unauthorized, notFound } = require('../middleware/errorHandler');
const emailService = require('./emailService');
const { User, RefreshToken } = require('../models');

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
 */
exports.createUser = async ({ email, pseudo, password }) => {
    // Check if email already exists
    if (await User.emailExists(email)) {
        throw conflict('Email already registered');
    }
    
    if (await User.pseudoExists(pseudo)) {
        throw conflict('Pseudo already taken');
    }

    // Create user (password is hashed in model)
    const user = await User.create({ email, pseudo, password });

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await User.setVerificationToken(user.id, verificationToken, verificationExpires);

    // Send verification email (async, don't wait)
    emailService.sendVerificationEmail(email, verificationToken).catch(console.error);

    // Generate tokens so user is auto-logged-in after registration
    const tokens = await generateTokens(user);

    return { userId: user.id, email: user.email, pseudo: user.pseudo, ...tokens };
};

/**
 * Login user
 */
exports.loginUser = async ({ email, password }) => {
    // Find user by email
    const user = await User.findByEmail(email);
    
    if (!user) {
        throw unauthorized('Invalid email or password');
    }

    // Check password
    const isValidPassword = await User.verifyPassword(user, password);
    if (!isValidPassword) {
        throw unauthorized('Invalid email or password');
    }

    // Update last seen
    await User.updateLastSeen(user.id);

    // Generate tokens
    const tokens = await generateTokens(user);

    return {
        ...tokens,
        user: {
            id: user.id,
            pseudo: user.pseudo,
            email: user.email,
            elo: {
                classic: user.elo_classic,
                rapid: user.elo_rapid,
                blitz: user.elo_blitz
            }
        }
    };
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
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await User.setVerificationToken(user.id, verificationToken, verificationExpires);

    // Send verification email
    await emailService.sendVerificationEmail(email, verificationToken);
};

/**
 * Request password reset
 */
exports.requestPasswordReset = async (email) => {
    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    
    const success = await User.setResetToken(email, resetToken, resetExpires);
    
    if (success) {
        // Send reset email
        await emailService.sendPasswordResetEmail(email, resetToken);
    }
    // Don't reveal if email exists - same response either way
};

/**
 * Reset password
 */
exports.resetPassword = async (token, newPassword) => {
    const success = await User.resetPassword(token, newPassword);
    
    if (!success) {
        throw new AppError('Invalid or expired reset token', 400, 'INVALID_TOKEN');
    }
};

/**
 * Change password (authenticated)
 */
exports.changePassword = async (userId, currentPassword, newPassword) => {
    const user = await User.findById(userId);
    if (!user) {
        throw notFound('User');
    }
    
    // Get full user with password hash
    const fullUser = await User.findByEmail(user.email);

    // Verify current password
    const isValidPassword = await User.verifyPassword(fullUser, currentPassword);
    if (!isValidPassword) {
        throw unauthorized('Current password is incorrect');
    }

    // Update password
    await User.updatePassword(userId, newPassword);
    
    // Optionally invalidate all other sessions
    // await RefreshToken.deleteAllForUser(userId);
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
