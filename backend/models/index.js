/**
 * Models Index
 * 
 * Export all database models.
 */

const userModel = require('./userModel');
const roomModel = require('./roomModel');
const gameModel = require('./gameModel');
const moveModel = require('./moveModel');
const spectatorModel = require('./spectatorModel');
const aiRatingModel = require('./aiRatingModel');
const refreshTokenModel = require('./refreshTokenModel');

module.exports = {
    User: userModel,
    Room: roomModel,
    Game: gameModel,
    Move: moveModel,
    Spectator: spectatorModel,
    AIRating: aiRatingModel,
    RefreshToken: refreshTokenModel
};
