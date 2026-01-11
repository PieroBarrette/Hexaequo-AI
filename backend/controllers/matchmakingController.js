/**
 * matchmakingController.js - Endpoints matchmaking REST (Phase 2)
 * 
 * Note: La majorité du matchmaking passe par Socket.IO pour le temps réel.
 * Ces endpoints REST sont complémentaires pour:
 * - Statut queue (polling fallback)
 * - Préférences utilisateur
 * - Invitations
 * 
 * Routes:
 * - GET /api/matchmaking/preferences → préférences utilisateur
 * - PUT /api/matchmaking/preferences → mise à jour préférences
 * - POST /api/matchmaking/invitations → créer invitation
 * - GET /api/matchmaking/invitations/:code → info invitation
 * - POST /api/matchmaking/invitations/:code/accept → accepter invitation
 * - DELETE /api/matchmaking/invitations/:code → annuler invitation
 * 
 * Socket.IO events (dans socketHandler.js):
 * - join-matchmaking-queue → rejoindre queue
 * - leave-matchmaking-queue → quitter queue
 * - match-found → notification match (server → client)
 */

const matchmakingService = require('../services/matchmakingService');
const invitationService = require('../services/invitationService');
const userPreferencesModel = require('../models/userPreferencesModel');

/**
 * Get user matchmaking preferences
 * GET /api/matchmaking/preferences
 */
exports.getPreferences = async (req, res, next) => {
    try {
        const userId = req.user?.id;
        
        if (!userId) {
            return res.json({
                data: userPreferencesModel.DEFAULT_PREFERENCES
            });
        }
        
        const preferences = await userPreferencesModel.getPreferences(userId);
        
        res.json({
            data: preferences
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update user matchmaking preferences
 * PUT /api/matchmaking/preferences
 */
exports.updatePreferences = async (req, res, next) => {
    try {
        const userId = req.user?.id;
        
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        const { elo_range_min, elo_range_max, allow_friendly_games } = req.body;
        
        const preferences = await userPreferencesModel.updatePreferences(userId, {
            elo_range_min,
            elo_range_max,
            allow_friendly_games
        });
        
        res.json({
            data: preferences
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Create invitation
 * POST /api/matchmaking/invitations
 */
exports.createInvitation = async (req, res, next) => {
    try {
        const userId = req.user?.id;
        const pseudo = req.user?.pseudo || 'Guest';
        const { timeMode, allowSpectators } = req.body;
        
        const roomSettings = {
            timeMode: timeMode || 'classic',
            allowSpectators: allowSpectators !== false
        };
        
        const invitation = await invitationService.createInvitation(userId, pseudo, roomSettings);
        
        res.status(201).json({
            data: {
                code: invitation.code,
                url: invitation.url,
                expiresAt: invitation.expiresAt
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get invitation info
 * GET /api/matchmaking/invitations/:code
 */
exports.getInvitation = async (req, res, next) => {
    try {
        const { code } = req.params;
        
        const info = await invitationService.getInvitationInfo(code);
        
        if (!info.valid) {
            return res.status(404).json({ error: info.reason });
        }
        
        res.json({
            data: {
                creatorPseudo: info.creatorPseudo,
                timeMode: info.timeMode,
                expiresAt: info.expiresAt
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Accept invitation (creates room, returns room code)
 * POST /api/matchmaking/invitations/:code/accept
 */
exports.acceptInvitation = async (req, res, next) => {
    try {
        const { code } = req.params;
        const userId = req.user?.id;
        const pseudo = req.user?.pseudo || req.body.pseudo || 'Guest';
        
        const result = await invitationService.acceptInvitation(code, userId, pseudo, null);
        
        if (!result.valid) {
            return res.status(400).json({ error: result.error });
        }
        
        res.json({
            data: {
                roomCode: result.roomCode,
                timeMode: result.timeMode,
                creatorPseudo: result.creatorPseudo
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Cancel invitation
 * DELETE /api/matchmaking/invitations/:code
 */
exports.cancelInvitation = async (req, res, next) => {
    try {
        const { code } = req.params;
        const userId = req.user?.id;
        
        const cancelled = await invitationService.cancelInvitation(code, userId);
        
        res.json({
            data: { cancelled }
        });
    } catch (error) {
        next(error);
    }
};
