/**
 * Models Index
 * 
 * Export all database models.
 */

const userModel = require('./userModel');
const gameModel = require('./gameModel');
const refreshTokenModel = require('./refreshTokenModel');

module.exports = {
    User: userModel,
    Game: gameModel,
    RefreshToken: refreshTokenModel
};
