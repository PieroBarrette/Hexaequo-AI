/**
 * ELO Service
 * 
 * Handles ELO rating calculations.
 */

/**
 * ELO configuration
 */
const CONFIG = {
    // K-factor for new players (first 30 games)
    K_NEW_PLAYER: 40,
    // K-factor for established players
    K_ESTABLISHED: 20,
    // K-factor for high-rated players (>2400)
    K_HIGH_RATED: 10,
    // Games threshold for "new player" status
    NEW_PLAYER_GAMES: 30,
    // Rating threshold for high-rated status
    HIGH_RATED_THRESHOLD: 2400,
    // Default starting ELO
    DEFAULT_ELO: 1500
};

/**
 * Get K-factor for a player
 * @param {number} rating - Current rating
 * @param {number} gamesPlayed - Number of games played
 * @returns {number}
 */
function getKFactor(rating, gamesPlayed) {
    if (gamesPlayed < CONFIG.NEW_PLAYER_GAMES) {
        return CONFIG.K_NEW_PLAYER;
    }
    if (rating >= CONFIG.HIGH_RATED_THRESHOLD) {
        return CONFIG.K_HIGH_RATED;
    }
    return CONFIG.K_ESTABLISHED;
}

/**
 * Calculate expected score
 * @param {number} ratingA - Player A's rating
 * @param {number} ratingB - Player B's rating
 * @returns {number} Expected score for player A (0-1)
 */
function expectedScore(ratingA, ratingB) {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Calculate new ratings after a game
 * @param {Object} playerA - { rating, gamesPlayed }
 * @param {Object} playerB - { rating, gamesPlayed }
 * @param {number} result - 1 if A wins, 0 if B wins, 0.5 for draw
 * @returns {Object} { newRatingA, newRatingB, changeA, changeB }
 */
function calculateNewRatings(playerA, playerB, result) {
    const expectedA = expectedScore(playerA.rating, playerB.rating);
    const expectedB = 1 - expectedA;

    const kA = getKFactor(playerA.rating, playerA.gamesPlayed);
    const kB = getKFactor(playerB.rating, playerB.gamesPlayed);

    const changeA = Math.round(kA * (result - expectedA));
    const changeB = Math.round(kB * ((1 - result) - expectedB));

    return {
        newRatingA: playerA.rating + changeA,
        newRatingB: playerB.rating + changeB,
        changeA,
        changeB
    };
}

/**
 * Process game result and update ratings
 * @param {Object} winner - Winner's data { id, rating, gamesPlayed }
 * @param {Object} loser - Loser's data { id, rating, gamesPlayed }
 * @param {string} timeMode - Time control mode for rating pool
 * @param {boolean} isDraw - Whether the game was a draw
 * @returns {Object} Rating changes for both players
 */
exports.processGameResult = (winner, loser, timeMode, isDraw = false) => {
    const result = isDraw ? 0.5 : 1;

    const { newRatingA, newRatingB, changeA, changeB } = calculateNewRatings(
        { rating: winner.rating, gamesPlayed: winner.gamesPlayed },
        { rating: loser.rating, gamesPlayed: loser.gamesPlayed },
        result
    );

    return {
        winner: {
            id: winner.id,
            oldRating: winner.rating,
            newRating: newRatingA,
            change: changeA,
            timeMode
        },
        loser: {
            id: loser.id,
            oldRating: loser.rating,
            newRating: newRatingB,
            change: changeB,
            timeMode
        }
    };
};

/**
 * Get rating tier/rank name
 * @param {number} rating
 * @returns {string}
 */
exports.getRatingTier = (rating) => {
    if (rating >= 2400) return 'Grandmaster';
    if (rating >= 2200) return 'Master';
    if (rating >= 2000) return 'Expert';
    if (rating >= 1800) return 'Class A';
    if (rating >= 1600) return 'Class B';
    if (rating >= 1400) return 'Class C';
    if (rating >= 1200) return 'Class D';
    return 'Beginner';
};

/**
 * Calculate provisional rating (for players with few games)
 * @param {Array} results - Array of { opponentRating, won }
 * @returns {number}
 */
exports.calculateProvisionalRating = (results) => {
    if (results.length === 0) return CONFIG.DEFAULT_ELO;

    // Average opponent rating + 400 * (wins - losses) / games
    const avgOpponentRating = results.reduce((sum, r) => sum + r.opponentRating, 0) / results.length;
    const wins = results.filter(r => r.won).length;
    const losses = results.length - wins;

    return Math.round(avgOpponentRating + 400 * (wins - losses) / results.length);
};

module.exports = {
    ...exports,
    getKFactor,
    expectedScore,
    calculateNewRatings,
    CONFIG
};
