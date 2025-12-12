/**
 * Room Routes
 */

const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');
const { authenticate, optionalAuth } = require('../middleware/authMiddleware');
const { validate, schemas } = require('../middleware/validationMiddleware');

// Public routes
router.get('/', roomController.getRooms);
router.get('/:code', roomController.getRoomByCode);

// Routes with optional auth
router.post('/', optionalAuth, validate(schemas.createRoom), roomController.createRoom);
router.post('/:code/join', optionalAuth, roomController.joinRoom);
router.post('/:code/leave', optionalAuth, roomController.leaveRoom);

module.exports = router;
