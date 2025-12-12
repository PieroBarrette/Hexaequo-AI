/**
 * Game Routes
 */

const express = require('express');
const router = express.Router();
const gameController = require('../controllers/gameController');

// Public routes
router.get('/', gameController.getGames);
router.get('/leaderboard', gameController.getLeaderboard);
router.get('/:id', gameController.getGameById);
router.get('/:id/replay', gameController.getReplay);

module.exports = router;
