/**
 * Turning a finished online game into a record and a rating change.
 *
 * A game counts for the rating only when both seats were held by two different
 * signed-in players. Guest games and games against yourself are recorded as
 * unrated, so a link shared with a friend never moves anyone's rating.
 *
 * Elo here is strictly symmetric: whatever a win is worth, the same loss costs.
 * The time control scales both sides by the same factor, so no cadence is a
 * cheap way to farm rating.
 */

const { query, transaction, hasDatabase } = require('../config/database');
const elo = require('./eloService');

/** Winner as the schema stores it. */
const WINNER_LABEL = { 0: 'black', 1: 'white' };

/**
 * @param {object} room  a room from socket/onlineGame.js
 * @param {object} result { winner: 0|1|null, reason }
 * @returns {Promise<object|null>} what changed, or null if nothing was recorded
 */
async function recordGame(room, result) {
    /* Nothing to write to, so nothing is written and nothing is complained
       about. The socket suites run this way on purpose: they are about the
       protocol, and a game they play to the end should not leave a row
       anywhere. A real server always has a database, so this is never the
       reason a genuine game goes unrecorded. */
    if (!hasDatabase()) return null;

    const black = room.players && room.players[0];
    const white = room.players && room.players[1];

    const rated = Boolean(
        black && white && black.userId && white.userId && black.userId !== white.userId
    );

    let saved;
    try {
        saved = await persistGame(room, result, black, white, rated);
    } catch (error) {
        // A game that cannot be written must not break the room; the players
        // have already seen their result.
        console.error('[rated] could not persist game:', error.message);
        return null;
    }

    if (!rated) return { rated: false, gameId: saved.id };

    const ratings = await applyRatings(saved.id, black, white, result, room.timeControl);
    return { rated: true, gameId: saved.id, ratings };
}

async function persistGame(room, result, black, white, rated) {
    const winner = result.winner === null || result.winner === undefined
        ? 'draw'
        : WINNER_LABEL[result.winner];

    const { rows } = await query(
        `INSERT INTO games (
            room_code, black_player_id, black_pseudo, black_elo_before,
            white_player_id, white_pseudo, white_elo_before,
            time_mode, winner, result_reason, final_state, finished_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CURRENT_TIMESTAMP)
         RETURNING id`,
        [
            room.code,
            (black && black.userId) || null, (black && black.pseudo) || null,
            rated ? (black && black.elo) : null,
            (white && white.userId) || null, (white && white.pseudo) || null,
            rated ? (white && white.elo) : null,
            room.timeControl, winner, result.reason,
            JSON.stringify(room.state),
        ]
    );
    const gameId = rows[0].id;

    /* The ordered intents are the whole game; storing them makes replays
       possible without trusting anything the clients kept. Kept apart from the
       game row on purpose: if the move list cannot be written, the players
       still get their result and their rating, and all that is lost is the
       ability to watch it back. */
    if (room.moves && room.moves.length) {
        try {
            await storeMoves(gameId, room);
        } catch (error) {
            console.error('[rated] could not store the moves of ' + room.code + ':', error.message);
        }
    }
    return { id: gameId };
}

async function storeMoves(gameId, room) {
    await transaction(async (client) => {
        for (let i = 0; i < room.moves.length; i++) {
            const move = room.moves[i];
            await client.query(
                `INSERT INTO moves (game_id, move_number, player, move_type, to_q, to_r,
                                    intent, notation, state_snapshot, move_time)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [
                    gameId,
                    i + 1,
                    i % 2 === 0 ? 'black' : 'white',
                    move.type,
                    // The board is keyed by a single packed integer; the older
                    // columns want a pair, so the key goes in to_q and to_r
                    // stays 0. They are a summary — `intent` is the move.
                    intentCell(move), 0,
                    JSON.stringify(move),
                    (room.notations && room.notations[i]) || null,
                    i === room.moves.length - 1 ? JSON.stringify(room.state) : null,
                    /* Milliseconds, and null where the room never knew — a
                       column that has been in the schema unused since the
                       beginning. Nothing reads a missing one as zero: the
                       review leaves the space blank instead of claiming the
                       move was instant. */
                    (room.times && room.times[i] != null) ? room.times[i] : null,
                ]
            );
        }
    });
}

function intentCell(intent) {
    if (intent.type === 'tile' || intent.type === 'piece') return intent.cell;
    if (intent.type === 'ring') return intent.to;
    return intent.path[intent.path.length - 1];
}

/** Move both ratings, record the history, and update the win/loss tallies. */
async function applyRatings(gameId, black, white, result, timeControl) {
    const isDraw = result.winner === null || result.winner === undefined;
    const blackWon = result.winner === 0;

    const winnerSeat = isDraw || blackWon ? black : white;
    const loserSeat = isDraw || blackWon ? white : black;

    const outcome = elo.processGameResult(
        { id: winnerSeat.userId, rating: winnerSeat.elo, gamesPlayed: winnerSeat.gamesPlayed || 0 },
        { id: loserSeat.userId, rating: loserSeat.elo, gamesPlayed: loserSeat.gamesPlayed || 0 },
        timeControl === 'none' ? 'rapid' : timeControl,
        isDraw
    );

    // Never let a rating fall through the floor, however long a losing streak.
    const floor = (value) => Math.max(100, value);

    await transaction(async (client) => {
        for (const [side, seat] of [[outcome.winner, winnerSeat], [outcome.loser, loserSeat]]) {
            const newRating = floor(side.newRating);
            await client.query('UPDATE users SET elo = $1 WHERE id = $2', [newRating, seat.userId]);
            await client.query(
                `INSERT INTO elo_history (user_id, game_id, elo_before, elo_after, elo_change)
                 VALUES ($1,$2,$3,$4,$5)`,
                [seat.userId, gameId, side.oldRating, newRating, newRating - side.oldRating]
            );
        }

        const tally = async (userId, field) => client.query(
            `UPDATE users SET games_played = games_played + 1, ${field} = ${field} + 1 WHERE id = $1`,
            [userId]
        );
        if (isDraw) {
            await tally(winnerSeat.userId, 'draws');
            await tally(loserSeat.userId, 'draws');
        } else {
            await tally(winnerSeat.userId, 'wins');
            await tally(loserSeat.userId, 'losses');
        }

        await client.query(
            `UPDATE games SET black_elo_after = $2, white_elo_after = $3 WHERE id = $1`,
            [
                gameId,
                floor(blackWon || isDraw ? outcome.winner.newRating : outcome.loser.newRating),
                floor(blackWon || isDraw ? outcome.loser.newRating : outcome.winner.newRating),
            ]
        );
    });

    // Answer in seat order, which is what the clients speak.
    const bySeat = (seat, side) => ({
        userId: seat.userId,
        pseudo: seat.pseudo,
        before: side.oldRating,
        after: floor(side.newRating),
        change: floor(side.newRating) - side.oldRating,
    });
    return isDraw || blackWon
        ? [bySeat(black, outcome.winner), bySeat(white, outcome.loser)]
        : [bySeat(black, outcome.loser), bySeat(white, outcome.winner)];
}

module.exports = { recordGame };
