/**
 * Rate Limiting Configuration
 * 
 * Configures rate limiting for API endpoints.
 */

const rateLimit = require('express-rate-limit');
const { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS, NODE_ENV } = require('./env');

/* A test suite signs in and out dozens of times from one address on purpose,
   which is exactly what these limits exist to stop. Off under test, and only
   under test — production sets NODE_ENV itself. */
const underTest = () => NODE_ENV === 'test';

// General API rate limiter
const apiLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX_REQUESTS,
    skip: underTest,
    message: {
        error: 'Too Many Requests',
        message: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false
});

/*
 * Stricter limiter for auth endpoints.
 *
 * Only failed attempts count. A limiter that counts successes too punishes the
 * wrong person: several people behind one address — a household, a school, a
 * café — share an IP, and one of them signing in normally would lock the rest
 * out. Guessing passwords still runs out after twenty tries.
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    skipSuccessfulRequests: true,
    skip: underTest,
    message: {
        error: 'Too Many Requests',
        message: 'Too many authentication attempts, please try again later.',
        retryAfter: 900
    },
    standardHeaders: true,
    legacyHeaders: false
});

/* Password reset: still tight, since each one sends mail, but not so tight
   that a household shares a single attempt. */
const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 8,
    skip: underTest,
    message: {
        error: 'Too Many Requests',
        message: 'Too many password reset attempts, please try again later.',
        retryAfter: 3600
    },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = {
    apiLimiter,
    authLimiter,
    passwordResetLimiter
};
