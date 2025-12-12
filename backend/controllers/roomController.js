/**
 * Room Controller
 * 
 * Handles room-related operations for the lobby.
 */

const roomService = require('../services/roomService');

/**
 * Get available rooms list
 * GET /api/rooms
 */
exports.getRooms = async (req, res, next) => {
    try {
        const { status = 'waiting', timeMode, allowSpectators, page = 1, limit = 20 } = req.query;

        const result = await roomService.getRooms({
            status,
            timeMode,
            allowSpectators: allowSpectators === 'true',
            page: parseInt(page),
            limit: parseInt(limit)
        });

        res.json({
            data: result.rooms,
            meta: {
                total: result.total,
                page: result.page,
                totalPages: result.totalPages
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get room by code
 * GET /api/rooms/:code
 */
exports.getRoomByCode = async (req, res, next) => {
    try {
        const { code } = req.params;
        const room = await roomService.getRoomByCode(code.toUpperCase());

        res.json({
            data: room
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Create a new room
 * POST /api/rooms
 */
exports.createRoom = async (req, res, next) => {
    try {
        const { timeMode = 'none', allowSpectators = true } = req.body;
        const userId = req.user?.id || null;

        const room = await roomService.createRoom({
            hostId: userId,
            timeMode,
            allowSpectators
        });

        res.status(201).json({
            data: {
                roomCode: room.code,
                url: `/game/${room.code}`
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Join a room
 * POST /api/rooms/:code/join
 */
exports.joinRoom = async (req, res, next) => {
    try {
        const { code } = req.params;
        const userId = req.user?.id || null;

        const result = await roomService.joinRoom(code.toUpperCase(), userId);

        res.json({
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Leave a room
 * POST /api/rooms/:code/leave
 */
exports.leaveRoom = async (req, res, next) => {
    try {
        const { code } = req.params;
        const userId = req.user?.id || null;

        await roomService.leaveRoom(code.toUpperCase(), userId);

        res.json({
            data: null,
            meta: {
                message: 'Left room successfully'
            }
        });
    } catch (error) {
        next(error);
    }
};
