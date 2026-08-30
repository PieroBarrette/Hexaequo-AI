/**
 * Authentication Routes
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate, optionalAuth } = require('../middleware/authMiddleware');
const { authLimiter, passwordResetLimiter } = require('../config/rateLimit');
const { validate, schemas } = require('../middleware/validationMiddleware');

// Public routes
router.post('/signup', 
    authLimiter, 
    validate(schemas.signup), 
    authController.signup
);

// Alias for compatibility with frontend
router.post('/register', 
    authLimiter, 
    validate(schemas.signup), 
    authController.signup
);

router.post('/login', 
    authLimiter, 
    validate(schemas.login), 
    authController.login
);

router.post('/logout', 
    authController.logout
);

router.post('/refresh', 
    authController.refreshToken
);

router.post('/verify-email', 
    authController.verifyEmail
);

router.post('/forgot-password', 
    passwordResetLimiter, 
    authController.forgotPassword
);

router.post('/reset-password', 
    validate(schemas.resetPassword), 
    authController.resetPassword
);

// Protected routes
router.post('/change-password', 
    authenticate, 
    validate(schemas.changePassword), 
    authController.changePassword
);

/* ── Sign in with Google ──────────────────────────────────────────────────
 * The browser sends the ID token Google handed it; the server verifies it
 * against Google's keys and issues its own session. Rate-limited like the
 * other credential endpoints.
 */
const googleAuthController = require('../controllers/googleAuthController');

router.get('/config', googleAuthController.config);
router.post('/google', authLimiter, googleAuthController.signInWithGoogle);
router.get('/me', authenticate, googleAuthController.me);
router.put('/pseudo', authenticate, googleAuthController.setPseudo);
router.get('/pseudo-available', optionalAuth, googleAuthController.pseudoAvailable);

module.exports = router;
