/**
 * Authentication Routes
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');
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

module.exports = router;
