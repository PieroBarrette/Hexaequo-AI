/**
 * Matchmaking Routes
 * 
 * Routes for matchmaking preferences and invitations.
 */

const express = require('express');
const router = express.Router();
const matchmakingController = require('../controllers/matchmakingController');
const { authenticate, optionalAuth } = require('../middleware/authMiddleware');

// Preferences routes (requires auth for update)
router.get('/preferences', optionalAuth, matchmakingController.getPreferences);
router.put('/preferences', authenticate, matchmakingController.updatePreferences);

// Invitation routes
router.post('/invitations', optionalAuth, matchmakingController.createInvitation);
router.get('/invitations/:code', matchmakingController.getInvitation);
router.post('/invitations/:code/accept', optionalAuth, matchmakingController.acceptInvitation);
router.delete('/invitations/:code', optionalAuth, matchmakingController.cancelInvitation);

module.exports = router;
