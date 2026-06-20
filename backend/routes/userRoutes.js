/**
 * User Routes
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate } = require('../middleware/authMiddleware');
const { validate, schemas } = require('../middleware/validationMiddleware');

// Protected routes - current user
router.get('/me', authenticate, userController.getProfile);
router.patch('/me', authenticate, validate(schemas.updateProfile), userController.updateProfile);
router.delete('/me', authenticate, userController.deleteAccount);

// Settings
router.get('/me/settings', authenticate, userController.getSettings);
router.patch('/me/settings', authenticate, userController.updateSettings);

// Preferences (matchmaking ELO range, friendly games)
router.get('/me/preferences', authenticate, userController.getPreferences);
router.put('/me/preferences', authenticate, validate(schemas.updatePreferences), userController.updatePreferences);

// Public routes - user by ID
router.get('/:id', userController.getUserById);
router.get('/:id/matches', userController.getMatchHistory);

module.exports = router;
