/**
 * In-Memory Game Storage
 * 
 * Fallback storage for game records when PostgreSQL is not available.
 */

// In-memory game storage
const games = new Map();
const moves = new Map(); // gameId -> [moves]

let gameIdCounter = 1;

async function create({
    roomCode,
    blackPlayerId,
    blackPseudo,
    blackEloBefore = 1000,
    whitePlayerId,
    whitePseudo,
    whiteEloBefore = 1000,
    timeMode
}) {
    const gameId = `game_${gameIdCounter++}_${Date.now()}`;
    
    const game = {
        id: gameId,
        room_code: roomCode,
        black_player_id: blackPlayerId,
        black_pseudo: blackPseudo,
        black_elo_before: blackEloBefore,
        white_player_id: whitePlayerId,
        white_pseudo: whitePseudo,
        white_elo_before: whiteEloBefore,
        time_mode: timeMode,
        winner: null,
        result_reason: null,
        final_state: null,
        black_elo_after: null,
        white_elo_after: null,
        started_at: new Date(),
        finished_at: null,
        move_count: 0
    };
    
    games.set(gameId, game);
    moves.set(gameId, []);
    
    return { id: gameId };
}

async function findById(id) {
    const game = games.get(id);
    if (!game) return null;
    
    game.move_count = (moves.get(id) || []).length;
    return game;
}

async function findByRoomCode(roomCode) {
    for (const game of games.values()) {
        if (game.room_code === roomCode && game.winner === null) {
            game.move_count = (moves.get(game.id) || []).length;
            return game;
        }
    }
    return null;
}

async function findAll({ status, timeMode, playerId, page = 1, limit = 20 }) {
    let gameList = Array.from(games.values());
    
    if (status === 'finished') {
        gameList = gameList.filter(g => g.winner !== null);
    } else if (status === 'playing') {
        gameList = gameList.filter(g => g.winner === null);
    }
    
    if (timeMode) {
        gameList = gameList.filter(g => g.time_mode === timeMode);
    }
    
    if (playerId) {
        gameList = gameList.filter(g => 
            g.black_player_id === playerId || g.white_player_id === playerId
        );
    }
    
    gameList.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
    
    const total = gameList.length;
    const offset = (page - 1) * limit;
    
    return {
        games: gameList.slice(offset, offset + limit),
        total,
        page,
        totalPages: Math.ceil(total / limit)
    };
}

async function getUserMatchHistory(userId, { page = 1, limit = 25, result: resultFilter, timeMode, opponentName, dateFrom, dateTo } = {}) {
    let gameList = Array.from(games.values())
        .filter(g => 
            (g.black_player_id === userId || g.white_player_id === userId) && 
            g.winner !== null
        );

    // Time mode filter
    if (timeMode) {
        gameList = gameList.filter(g => g.time_mode === timeMode);
    }

    // Opponent name filter
    if (opponentName) {
        const search = opponentName.toLowerCase();
        gameList = gameList.filter(g => {
            const opp = g.black_player_id === userId ? g.white_pseudo : g.black_pseudo;
            return opp && opp.toLowerCase().includes(search);
        });
    }

    // Date range filters
    if (dateFrom) {
        const from = new Date(dateFrom);
        gameList = gameList.filter(g => g.finished_at && new Date(g.finished_at) >= from);
    }
    if (dateTo) {
        const to = new Date(dateTo);
        gameList = gameList.filter(g => g.finished_at && new Date(g.finished_at) <= to);
    }

    // Result filter
    if (resultFilter && resultFilter.length > 0 && resultFilter.length < 3) {
        gameList = gameList.filter(g => {
            const isBlack = g.black_player_id === userId;
            let result;
            if ((isBlack && g.winner === 'black') || (!isBlack && g.winner === 'white')) {
                result = 'win';
            } else if (g.winner === 'draw') {
                result = 'draw';
            } else {
                result = 'loss';
            }
            return resultFilter.includes(result);
        });
    }
    
    gameList.sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at));
    
    const total = gameList.length;
    const offset = (page - 1) * limit;
    const paginatedGames = gameList.slice(offset, offset + limit);
    
    const matches = paginatedGames.map(g => {
        const isBlack = g.black_player_id === userId;
        return {
            id: g.id,
            time_mode: g.time_mode,
            winner: g.winner,
            result_reason: g.result_reason,
            finished_at: g.finished_at,
            player_color: isBlack ? 'black' : 'white',
            opponent_pseudo: isBlack ? g.white_pseudo : g.black_pseudo,
            opponent_elo: isBlack ? g.white_elo_before : g.black_elo_before,
            elo_change: isBlack 
                ? (g.black_elo_after - g.black_elo_before) 
                : (g.white_elo_after - g.white_elo_before),
            result: (isBlack && g.winner === 'black') || (!isBlack && g.winner === 'white')
                ? 'win'
                : g.winner === 'draw' ? 'draw' : 'loss'
        };
    });
    
    return {
        matches,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    };
}

async function complete(id, {
    winner,
    resultReason,
    finalState,
    blackEloAfter,
    whiteEloAfter
}) {
    const game = games.get(id);
    if (!game) return null;
    
    game.winner = winner;
    game.result_reason = resultReason;
    game.final_state = finalState;
    game.black_elo_after = blackEloAfter;
    game.white_elo_after = whiteEloAfter;
    game.finished_at = new Date();
    
    return game;
}

async function getReplay(gameId) {
    const game = games.get(gameId);
    if (!game) return null;
    
    return {
        game,
        moves: moves.get(gameId) || []
    };
}

async function getHeadToHead(playerId1, playerId2) {
    const relevantGames = Array.from(games.values()).filter(g =>
        ((g.black_player_id === playerId1 && g.white_player_id === playerId2) ||
         (g.black_player_id === playerId2 && g.white_player_id === playerId1)) &&
        g.winner !== null
    );
    
    let player1Wins = 0;
    let player2Wins = 0;
    let draws = 0;
    
    relevantGames.forEach(g => {
        if (g.winner === 'draw') {
            draws++;
        } else if (
            (g.black_player_id === playerId1 && g.winner === 'black') ||
            (g.white_player_id === playerId1 && g.winner === 'white')
        ) {
            player1Wins++;
        } else {
            player2Wins++;
        }
    });
    
    return {
        total_games: relevantGames.length,
        player1_wins: player1Wins,
        player2_wins: player2Wins,
        draws
    };
}

// Move operations
async function createMove({
    gameId,
    moveNumber,
    player,
    moveType,
    fromQ,
    fromR,
    toQ,
    toR,
    captures,
    stateSnapshot,
    timeRemainingBlack,
    timeRemainingWhite,
    moveTime
}) {
    const gameMoves = moves.get(gameId) || [];
    
    const move = {
        id: gameMoves.length + 1,
        game_id: gameId,
        move_number: moveNumber,
        player,
        move_type: moveType,
        from_q: fromQ,
        from_r: fromR,
        to_q: toQ,
        to_r: toR,
        captures,
        state_snapshot: stateSnapshot,
        time_remaining_black: timeRemainingBlack,
        time_remaining_white: timeRemainingWhite,
        move_time: moveTime,
        created_at: new Date()
    };
    
    gameMoves.push(move);
    moves.set(gameId, gameMoves);
    
    return { id: move.id };
}

async function findMovesByGameId(gameId) {
    return moves.get(gameId) || [];
}

module.exports = {
    create,
    findById,
    findByRoomCode,
    findAll,
    getUserMatchHistory,
    complete,
    getReplay,
    getHeadToHead,
    createMove,
    findMovesByGameId
};
