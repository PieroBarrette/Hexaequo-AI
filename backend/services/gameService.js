/**
 * Game Service
 * 
 * Business logic for game operations.
 * Uses PostgreSQL when available, falls back to in-memory storage.
 */

const { notFound } = require('../middleware/errorHandler');
const eloService = require('./eloService');

// Try to use database models, fall back to memory store
let Game, Move, User;
let useMemoryStore = false;

try {
    const models = require('../models');
    Game = models.Game;
    Move = models.Move;
    User = models.User;
} catch (err) {
    useMemoryStore = true;
}

const memoryGameStore = require('../models/memoryGameStore');

// Wrapper to try database first, then memory store
async function withFallback(dbOperation, memoryOperation) {
    if (useMemoryStore) {
        return memoryOperation();
    }
    try {
        return await dbOperation();
    } catch (err) {
        console.log('Database unavailable for games, using memory store');
        useMemoryStore = true;
        return memoryOperation();
    }
}

/**
 * Get games list
 */
exports.getGames = async ({ status, timeMode, playerId, page = 1, limit = 20 }) => {
    return withFallback(
        () => Game.findAll({ status, timeMode, playerId, page, limit }),
        () => memoryGameStore.findAll({ status, timeMode, playerId, page, limit })
    );
};

/**
 * Get game by ID
 */
exports.getGameById = async (gameId) => {
    const game = await withFallback(
        () => Game.findById(gameId),
        () => memoryGameStore.findById(gameId)
    );
    if (!game) {
        throw notFound('Game');
    }
    return formatGameResponse(game);
};

/**
 * Get game replay
 */
exports.getGameReplay = async (gameId) => {
    const replay = await withFallback(
        () => Game.getReplay(gameId),
        () => memoryGameStore.getReplay(gameId)
    );
    if (!replay) {
        throw notFound('Game');
    }

    // If moves table has data, use individual moves
    if (replay.moves && replay.moves.length > 0) {
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
    }

    // Fallback: use moveHistory from final_state (state snapshots)
    const finalState = replay.game.final_state;
    const moveHistoryData = finalState?.moveHistory || [];

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
        stateHistory: moveHistoryData,
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
exports.getLeaderboard = async ({ page = 1, limit = 50 } = {}) => {
    // Leaderboard requires database - return empty if not available
    if (useMemoryStore) {
        return { players: [], total: 0, page, totalPages: 0 };
    }
    try {
        return await User.getLeaderboard({ page, limit });
    } catch (err) {
        return { players: [], total: 0, page, totalPages: 0 };
    }
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
    // Get player ELOs (only if database available)
    // Default ELO is 1000 (Phase 0)
    let blackEloBefore = 1000;
    let whiteEloBefore = 1000;
    
    if (!useMemoryStore) {
        try {
            if (blackPlayerId && User) {
                const blackPlayer = await User.findById(blackPlayerId);
                if (blackPlayer) {
                    blackEloBefore = blackPlayer.elo || 1000;
                }
            }
            
            if (whitePlayerId && User) {
                const whitePlayer = await User.findById(whitePlayerId);
                if (whitePlayer) {
                    whiteEloBefore = whitePlayer.elo || 1000;
                }
            }
        } catch (err) {
            // Use default ELO
        }
    }
    
    const game = await withFallback(
        () => Game.create({
            roomCode,
            blackPlayerId,
            blackPseudo,
            blackEloBefore,
            whitePlayerId,
            whitePseudo,
            whiteEloBefore,
            timeMode
        }),
        () => memoryGameStore.create({
            roomCode,
            blackPlayerId,
            blackPseudo,
            blackEloBefore,
            whitePlayerId,
            whitePseudo,
            whiteEloBefore,
            timeMode
        })
    );

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
    return withFallback(
        () => Move.create({
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
        }),
        () => memoryGameStore.createMove({
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
        })
    );
};

/**
 * Get moves for a game
 */
exports.getMoves = async (gameId) => {
    return withFallback(
        () => Move.findByGameId(gameId),
        () => memoryGameStore.findMovesByGameId(gameId)
    );
};

/**
 * End game
 * @param {string} gameId
 * @param {Object} options
 * @param {string} options.winner - 'black', 'white', or 'draw'
 * @param {string} options.resultReason - reason for game end
 * @param {Object} [options.finalState] - final game state
 * @param {string} [options.originalTimeMode] - original time mode before remapping (for ELO; preserves 'none')
 */
exports.endGame = async (gameId, {
    winner,
    resultReason,
    finalState,
    originalTimeMode
}) => {
    const game = await withFallback(
        () => Game.findById(gameId),
        () => memoryGameStore.findById(gameId)
    );
    if (!game) {
        throw notFound('Game');
    }
    
    // Use original time mode for ELO calculation (preserves 'none' for friendly)
    const eloTimeMode = originalTimeMode || game.time_mode;
    const isDraw = winner === 'draw' || !winner;
    
    // Get games played counts for K-factor calculation
    let blackGamesPlayed = 0;
    let whiteGamesPlayed = 0;
    if (!useMemoryStore && User) {
        try {
            if (game.black_player_id) {
                const bp = await User.findById(game.black_player_id);
                if (bp) blackGamesPlayed = bp.games_played || 0;
            }
            if (game.white_player_id) {
                const wp = await User.findById(game.white_player_id);
                if (wp) whiteGamesPlayed = wp.games_played || 0;
            }
        } catch (err) {
            // Use default 0
        }
    }
    
    // Calculate ELO changes via eloService (handles K-factors, time mode multipliers, friendly exclusion)
    let blackEloChange = 0;
    let whiteEloChange = 0;
    let blackEloAfter = game.black_elo_before;
    let whiteEloAfter = game.white_elo_before;
    
    if (isDraw) {
        // For draws, use calculateNewRatings directly with result=0.5
        const result = eloService.calculateNewRatings(
            { rating: game.black_elo_before, gamesPlayed: blackGamesPlayed },
            { rating: game.white_elo_before, gamesPlayed: whiteGamesPlayed },
            0.5,
            eloTimeMode
        );
        blackEloChange = result.changeA;
        whiteEloChange = result.changeB;
        blackEloAfter = result.newRatingA;
        whiteEloAfter = result.newRatingB;
    } else {
        // Determine winner/loser data
        const isBlackWinner = winner === 'black';
        const winnerData = {
            id: isBlackWinner ? game.black_player_id : game.white_player_id,
            rating: isBlackWinner ? game.black_elo_before : game.white_elo_before,
            gamesPlayed: isBlackWinner ? blackGamesPlayed : whiteGamesPlayed
        };
        const loserData = {
            id: isBlackWinner ? game.white_player_id : game.black_player_id,
            rating: isBlackWinner ? game.white_elo_before : game.black_elo_before,
            gamesPlayed: isBlackWinner ? whiteGamesPlayed : blackGamesPlayed
        };
        
        const eloResult = eloService.processGameResult(winnerData, loserData, eloTimeMode, false);
        
        if (isBlackWinner) {
            blackEloChange = eloResult.winner.change;
            whiteEloChange = eloResult.loser.change;
            blackEloAfter = eloResult.winner.newRating;
            whiteEloAfter = eloResult.loser.newRating;
        } else {
            whiteEloChange = eloResult.winner.change;
            blackEloChange = eloResult.loser.change;
            whiteEloAfter = eloResult.winner.newRating;
            blackEloAfter = eloResult.loser.newRating;
        }
    }
    
    // Complete the game
    await withFallback(
        () => Game.complete(gameId, {
            winner,
            resultReason,
            finalState,
            blackEloAfter,
            whiteEloAfter
        }),
        () => memoryGameStore.complete(gameId, {
            winner,
            resultReason,
            finalState,
            blackEloAfter,
            whiteEloAfter
        })
    );
    
    // Update player ELOs and stats (only if database available)
    if (!useMemoryStore && User) {
        try {
            if (game.black_player_id) {
                const blackResult = winner === 'black' ? 'win' : winner === 'white' ? 'loss' : 'draw';
                await User.updateElo(game.black_player_id, blackEloAfter, blackEloChange, gameId);
                await User.updateStats(game.black_player_id, blackResult);
            }
            
            if (game.white_player_id) {
                const whiteResult = winner === 'white' ? 'win' : winner === 'black' ? 'loss' : 'draw';
                await User.updateElo(game.white_player_id, whiteEloAfter, whiteEloChange, gameId);
                await User.updateStats(game.white_player_id, whiteResult);
            }
        } catch (err) {
            console.error('Failed to update player stats:', err.message);
        }
    }

    return {
        gameId,
        winner,
        resultReason,
        eloChanges: {
            black: { change: blackEloChange, oldElo: game.black_elo_before, newElo: blackEloAfter },
            white: { change: whiteEloChange, oldElo: game.white_elo_before, newElo: whiteEloAfter }
        }
    };
};

/**
 * Find active game by room code
 */
exports.findGameByRoomCode = async (roomCode) => {
    return withFallback(
        () => Game.findByRoomCode(roomCode),
        () => memoryGameStore.findByRoomCode(roomCode)
    );
};

/**
 * Get head-to-head stats
 */
exports.getHeadToHead = async (playerId1, playerId2) => {
    return withFallback(
        () => Game.getHeadToHead(playerId1, playerId2),
        () => memoryGameStore.getHeadToHead(playerId1, playerId2)
    );
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
