/**
 * User Routes
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, optionalAuth } = require('../middleware/authMiddleware');
const { validate, schemas } = require('../middleware/validationMiddleware');
const { notFound } = require('../middleware/errorHandler');

/* Account ids are UUIDs. Anything else is not an account that is missing but
   not an id at all, and handed to Postgres it came back as a 500 carrying the
   database's own message. It gets the 404 of an account nobody has, as
   /api/profile gives it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.param('id', (req, res, next, id) => next(UUID.test(id) ? undefined : notFound('User')));

// Protected routes - current user
router.get('/me', authenticate, userController.getProfile);
router.patch('/me', authenticate, validate(schemas.updateProfile), userController.updateProfile);
router.delete('/me', authenticate, userController.deleteAccount);

// Settings
router.get('/me/settings', authenticate, userController.getSettings);
router.patch('/me/settings', authenticate, userController.updateSettings);

// Public routes - user by ID
// Must come before /:id, or "leaderboard" would be taken for an account id.
router.get('/leaderboard', userController.getLeaderboard);
router.get('/:id', userController.getUserById);
// optionalAuth so the history can tell who is reading it: the player sees
// every game, anyone else the rated ones, as on /api/profile/:id/games.
router.get('/:id/matches', optionalAuth, userController.getMatchHistory);

module.exports = router;
