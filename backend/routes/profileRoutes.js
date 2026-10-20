/**
 * A player's own record, history and games.
 *
 * Stats are public and so are rated games — a leaderboard that hides the games
 * behind it is not much of a leaderboard. Unrated games are not: a friendly
 * belongs to the two who played it, so it is left out of a visitor's view of
 * the history and refused to a stranger asking for it by id. Your own profile,
 * and /me, still show everything you have played.
 */

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/authMiddleware');
const profile = require('../services/profileService');
const push = require('../services/pushService');
const streaks = require('../services/streakService');

const fail = (res, code, message) => res.status(code).json({ error: message });

/* Days in a row, counted in the zone the browser asking says it is in
   (?tz=Europe/Paris): a player's day ends at their own midnight. Only ever
   the player's own; nobody else's page shows it. A count that fails leaves
   the rest of the page standing. */
const streakOf = (req) => streaks.forUser(req.user.id, req.query.tz).catch(() => null);

/* Account and game ids are UUIDs. Anything else is not a record that is
   missing, it is not an id at all — and handing it to Postgres would come
   back as a 500 rather than a 404. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notAnId = (res, value) => (UUID.test(String(value)) ? false : fail(res, 404, 'No such record'));

/** Your own record, without having to know your id. */
router.get('/me', authenticate, async (req, res, next) => {
    try {
        const data = await profile.stats(req.user.id);
        if (!data) return fail(res, 404, 'No such account');
        data.streak = await streakOf(req);
        res.json(data);
    } catch (error) { next(error); }
});

/* The streak alone: what the card at the end of a game asks for, once the
   server has said the game is written. */
router.get('/me/streak', authenticate, async (req, res, next) => {
    try {
        res.json(await streaks.forUser(req.user.id, req.query.tz));
    } catch (error) { next(error); }
});

router.get('/me/games', authenticate, async (req, res, next) => {
    try {
        res.json(await profile.history(req.user.id, req.query));
    } catch (error) { next(error); }
});

router.get('/games/:id', optionalAuth, async (req, res, next) => {
    try {
        const viewer = req.user ? req.user.id : null;
        if (notAnId(res, req.params.id)) return;
        const game = await profile.replay(req.params.id, viewer);
        if (!game) return fail(res, 404, 'No such game');
        res.json(game);
    } catch (error) { next(error); }
});

/* Anyone's record, by account id — what a name in the lobby or on the
   leaderboard links to. Public: a leaderboard whose names lead nowhere is a
   list, not a community. */
router.get('/:id', optionalAuth, async (req, res, next) => {
    try {
        if (notAnId(res, req.params.id)) return;
        const data = await profile.stats(req.params.id, req.user ? req.user.id : null);
        if (!data) return fail(res, 404, 'No such account');
        // How the person looking has fared against them, when there is a
        // person looking and they have met.
        data.versus = req.user ? await profile.versus(req.user.id, req.params.id) : null;
        data.isYou = Boolean(req.user && req.user.id === req.params.id);
        if (data.isYou) data.streak = await streakOf(req);
        /* Whether a challenge would reach them when they are not on the site:
           only somebody signed in can send one, so only they are told. */
        data.notifiable = Boolean(req.user && !data.isYou)
            && await push.reachable(req.params.id, 'challenge');
        res.json(data);
    } catch (error) { next(error); }
});

/* optionalAuth so the service can tell whose history is being read: your own
   is all of it, someone else's is the rated games only. */
router.get('/:id/games', optionalAuth, async (req, res, next) => {
    try {
        if (notAnId(res, req.params.id)) return;
        res.json(await profile.history(req.params.id, req.query, req.user ? req.user.id : null));
    } catch (error) { next(error); }
});

module.exports = router;
