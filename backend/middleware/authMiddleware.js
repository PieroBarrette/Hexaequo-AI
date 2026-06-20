/**
 * Authentication Middleware
 * 
 * Validates JWT tokens and attaches user to request.
 */

const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');

/**
 * Verify JWT token and attach user to request
 */
exports.authenticate = async (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required'
            });
        }

        const token = authHeader.split(' ')[1];

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);

        // Attach user to request
        req.user = {
            id: decoded.userId,
            email: decoded.email,
            pseudo: decoded.pseudo
        };

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Token expired'
            });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid token'
            });
        }
        next(error);
    }
};

/**
 * Optional authentication - attaches user if token present but doesn't require it
 */
exports.optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return next();
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        req.user = {
            id: decoded.userId,
            email: decoded.email,
            pseudo: decoded.pseudo
        };

        next();
    } catch (error) {
        // Token invalid but optional, continue without user
        next();
    }
};

/**
 * Check if user has verified email
 */
exports.requireVerifiedEmail = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Authentication required'
        });
    }

    // Future: Check verified status from database
    // const user = await User.findById(req.user.id);
    // if (!user.emailVerified) {
    //     return res.status(403).json({
    //         error: 'Forbidden',
    //         message: 'Email verification required'
    //     });
    // }

    next();
};
