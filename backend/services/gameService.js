/**
 * Game Service
 * 
 * Business logic for game operations using PostgreSQL database.
 */

const { notFound } = require('../middleware/errorHandler');
const { Game, Move, User } = require('../models');

/**
 * Get games list
 */
exports.getGames = async ({ status, timeMode, playerId, page = 1, limit = 20 }) => {
    return await Game.findAll({ status, timeMode, playerId, page, limit });
};

/**
 * Get game by ID
 */
exports.getGameById = async (gameId) => {
    const game = await Game.findById(gameId);
    if (!game) {
        throw notFound('Game');
    }
    return formatGameResponse(game);
};

/**
 * Get game replay
 */
exports.getGameReplay = async (gameId) => {
    const replay = await Game.getReplay(gameId);
    if (!replay) {
        throw notFound('Game');
    }

    return {
        gameId: replay.game.id,
        players: {
            black: {
                id: replay.game.black_player_id,
                pseudo: replay.game.black_pseudo,
                eloBefore: replay.game.black_elo_before,
                eloAfter: replay.game.black_elo_after
            },
            white: {
                id: replay.game.white_player_id,
                pseudo: replay.game.white_pseudo,
                eloBefore: replay.game.white_elo_before,
                eloAfter: replay.game.white_elo_after
            }
        },
        moves: replay.moves.map(m => ({
            moveNumber: m.move_number,
            player: m.player,
            type: m.move_type,
            from: m.from_q !== null ? { q: m.from_q, r: m.from_r } : null,
            to: { q: m.to_q, r: m.to_r },
            captures: m.captures,
            timestamp: m.created_at
        })),
        result: {
            winner: replay.game.winner,
            reason: replay.game.result_reason
        },
        timeMode: replay.game.time_mode,
        startedAt: replay.game.started_at,
        finishedAt: replay.game.finished_at
    };
};

/**
 * Get leaderboard
 */
exports.getLeaderboard = async ({ timeMode = 'classic', page = 1, limit = 50 }) => {
    return await User.getLeaderboard(timeMode, { page, limit });
};

/**
 * Create game record
 */
exports.createGame = async ({
    roomCode,
    blackPlayerId,
    blackPseudo,
    whitePlayerId,
    whitePseudo,
    timeMode
}) => {
    // Get player ELOs
    const eloColumn = `elo_${timeMode === 'none' ? 'classic' : timeMode}`;
    
    let blackEloBefore = 1500;
    let whiteEloBefore = 1500;
    
    if (blackPlayerId) {
        const blackPlayer = await User.findById(blackPlayerId);
        if (blackPlayer) {
            blackEloBefore = blackPlayer[eloColumn] || 1500;
        }
    }
    
    if (whitePlayerId) {
        const whitePlayer = await User.findById(whitePlayerId);
        if (whitePlayer) {
            whiteEloBefore = whitePlayer[eloColumn] || 1500;
        }
    }
    
    const game = await Game.create({
        roomCode,
        blackPlayerId,
        blackPseudo,
        blackEloBefore,
        whitePlayerId,
        whitePseudo,
        whiteEloBefore,
        timeMode: timeMode === 'none' ? 'classic' : timeMode
    });

    return { gameId: game.id };
};

/**
 * Record move
 */
exports.recordMove = async (gameId, {
    moveNumber,
    player,
    moveType,
    from,
    to,
    captures,
    stateSnapshot,
    timeRemainingBlack,
    timeRemainingWhite,
    moveTime
}) => {
    return await Move.create({
        gameId,
        moveNumber,
        player,
        moveType,
        fromQ: from?.q,
        fromR: from?.r,
        toQ: to.q,
        toR: to.r,
        captures,
        stateSnapshot,
        timeRemainingBlack,
        timeRemainingWhite,
        moveTime
    });
};

/**
 * Get moves for a game
 */
exports.getMoves = async (gameId) => {
    return await Move.findByGameId(gameId);
};

/**
 * End game
 */
exports.endGame = async (gameId, {
    winner,
    resultReason,
    finalState
}) => {
    const game = await Game.findById(gameId);
    if (!game) {
        throw notFound('Game');
    }
    
    // Calculate ELO changes
    const timeMode = game.time_mode;
    const { blackEloAfter, whiteEloAfter, blackEloChange, whiteEloChange } = 
        calculateEloChanges(
            game.black_elo_before,
            game.white_elo_before,
            winner
        );
    
    // Complete the game
    const completedGame = await Game.complete(gameId, {
        winner,
        resultReason,
        finalState,
        blackEloAfter,
        whiteEloAfter
    });
    
    // Update player ELOs and stats
    if (game.black_player_id) {
        const blackResult = winner === 'black' ? 'win' : winner === 'white' ? 'loss' : 'draw';
        await User.updateElo(game.black_player_id, timeMode, blackEloAfter, blackEloChange, gameId);
        await User.updateStats(game.black_player_id, blackResult);
    }
    
    if (game.white_player_id) {
        const whiteResult = winner === 'white' ? 'win' : winner === 'black' ? 'loss' : 'draw';
        await User.updateElo(game.white_player_id, timeMode, whiteEloAfter, whiteEloChange, gameId);
        await User.updateStats(game.white_player_id, whiteResult);
    }

    return {
        gameId,
        winner,
        resultReason,
        eloChanges: {
            black: blackEloChange,
            white: whiteEloChange
        }
    };
};

/**
 * Calculate ELO changes
 */
function calculateEloChanges(blackElo, whiteElo, winner) {
    const K = 32; // K-factor
    
    // Expected scores
    const expectedBlack = 1 / (1 + Math.pow(10, (whiteElo - blackElo) / 400));
    const expectedWhite = 1 - expectedBlack;
    
    // Actual scores
    let actualBlack, actualWhite;
    if (winner === 'black') {
        actualBlack = 1;
        actualWhite = 0;
    } else if (winner === 'white') {
        actualBlack = 0;
        actualWhite = 1;
    } else {
        actualBlack = 0.5;
        actualWhite = 0.5;
    }
    
    // Calculate changes
    const blackEloChange = Math.round(K * (actualBlack - expectedBlack));
    const whiteEloChange = Math.round(K * (actualWhite - expectedWhite));
    
    return {
        blackEloAfter: blackElo + blackEloChange,
        whiteEloAfter: whiteElo + whiteEloChange,
        blackEloChange,
        whiteEloChange
    };
}

/**
 * Get head-to-head stats
 */
exports.getHeadToHead = async (playerId1, playerId2) => {
    return await Game.getHeadToHead(playerId1, playerId2);
};

/**
 * Format game response
 */
function formatGameResponse(game) {
    return {
        id: game.id,
        roomCode: game.room_code,
        players: {
            black: {
                id: game.black_player_id,
                pseudo: game.black_pseudo,
                eloBefore: game.black_elo_before,
                eloAfter: game.black_elo_after
            },
            white: {
                id: game.white_player_id,
                pseudo: game.white_pseudo,
                eloBefore: game.white_elo_before,
                eloAfter: game.white_elo_after
            }
        },
        timeMode: game.time_mode,
        winner: game.winner,
        resultReason: game.result_reason,
        moveCount: game.move_count,
        startedAt: game.started_at,
        finishedAt: game.finished_at
    };
}

module.exports = exports;
