/**
 * Quick match: pairing by rating band.
 *
 * A player joins the queue for one cadence. Everyone carries a tolerance that
 * starts narrow and widens the longer they wait, and two players are paired
 * only when the rating gap sits inside *both* tolerances. Mutual acceptance is
 * the point: a newcomer who has waited two minutes should not be handed a
 * grandmaster who has just arrived.
 *
 * Queueing requires an account, because a band needs a rating. Guests still
 * have invitation links.
 */

const { createRoom, rooms } = require('./onlineGame');

const START_BAND = 100;          // rating points either side, on arrival
const WIDEN_PER_STEP = 50;
const STEP_MS = 5000;            // how often the band opens up
const MAX_BAND = 1200;           // beyond this, effectively anyone
const TICK_MS = 1000;
const STALE_MS = 10 * 60 * 1000; // give up on a queue nobody is watching

/** userId → entry. One queue slot per account, however many tabs are open. */
const queue = new Map();

/** How far this player is willing to reach, given how long they have waited. */
function bandFor(entry, now = Date.now()) {
    const steps = Math.floor((now - entry.joinedAt) / STEP_MS);
    return Math.min(MAX_BAND, START_BAND + steps * WIDEN_PER_STEP);
}

function statusOf(entry, now = Date.now()) {
    return {
        inQueue: true,
        timeControl: entry.timeControl,
        elo: entry.elo,
        band: bandFor(entry, now),
        waitingMs: now - entry.joinedAt,
        queued: countFor(entry.timeControl),
    };
}

function countFor(timeControl) {
    let n = 0;
    for (const entry of queue.values()) if (entry.timeControl === timeControl) n++;
    return n;
}

/** Two players are paired only if each is willing to reach the other. */
function compatible(a, b, now) {
    if (a.timeControl !== b.timeControl) return false;
    if (a.userId === b.userId) return false;
    const gap = Math.abs(a.elo - b.elo);
    return gap <= bandFor(a, now) && gap <= bandFor(b, now);
}

/**
 * Find one pair, preferring the closest ratings among those who have waited
 * longest — so nobody is left behind while near-equals keep matching around
 * them.
 */
function findPair(now) {
    const waiting = [...queue.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    for (let i = 0; i < waiting.length; i++) {
        let best = null;
        let bestGap = Infinity;
        for (let j = i + 1; j < waiting.length; j++) {
            if (!compatible(waiting[i], waiting[j], now)) continue;
            const gap = Math.abs(waiting[i].elo - waiting[j].elo);
            if (gap < bestGap) { best = waiting[j]; bestGap = gap; }
        }
        if (best) return [waiting[i], best];
    }
    return null;
}

function attachMatchmaking(io) {
    const sweeper = setInterval(() => tick(io), TICK_MS);
    if (sweeper.unref) sweeper.unref();

    io.on('connection', (socket) => {
        const reply = (callback, payload) => {
            if (typeof callback === 'function') callback(payload);
        };

        /** hx:queue { timeControl } — enter the pool. */
        socket.on('hx:queue', (payload, callback) => {
            if (typeof payload === 'function') { callback = payload; payload = {}; }
            payload = payload || {};
            const user = socket.data.user;
            if (!user) return reply(callback, { ok: false, error: 'SIGN_IN_REQUIRED' });

            const timeControl = String(payload.timeControl || 'rapid');
            // Re-queueing replaces the old slot rather than stacking; the wait
            // restarts, which is the honest reading of changing your mind.
            queue.set(user.userId, {
                userId: user.userId,
                socketId: socket.id,
                pseudo: user.pseudo,
                elo: user.elo,
                gamesPlayed: user.gamesPlayed || 0,
                timeControl,
                joinedAt: Date.now(),
            });
            reply(callback, { ok: true, ...statusOf(queue.get(user.userId)) });
            tick(io);
        });

        socket.on('hx:queue:leave', (payload, callback) => {
            const user = socket.data.user;
            if (user) queue.delete(user.userId);
            reply(callback, { ok: true, inQueue: false });
        });

        socket.on('hx:queue:status', (payload, callback) => {
            const user = socket.data.user;
            const entry = user && queue.get(user.userId);
            reply(callback, entry ? { ok: true, ...statusOf(entry) } : { ok: true, inQueue: false });
        });

        socket.on('disconnect', () => {
            const user = socket.data.user;
            if (!user) return;
            const entry = queue.get(user.userId);
            // Only drop the slot if this is the socket that holds it: another
            // tab may have taken over.
            if (entry && entry.socketId === socket.id) queue.delete(user.userId);
        });
    });
}

/** One pass: pair whoever can be paired, then tell the rest where they stand. */
async function tick(io) {
    const now = Date.now();

    for (const [userId, entry] of queue) {
        if (now - entry.joinedAt > STALE_MS) queue.delete(userId);
    }

    let pair;
    // Keep pairing until nothing else fits, so a burst of arrivals is handled
    // in one pass rather than one per second.
    while ((pair = findPair(Date.now()))) {
        const [a, b] = pair;
        queue.delete(a.userId);
        queue.delete(b.userId);
        try {
            await pairUp(io, a, b);
        } catch (error) {
            console.error('[matchmaking] could not seat a pair:', error.message);
            // They are out of the queue and have no room: say so, or both sit
            // watching a search that will never end.
            for (const entry of [a, b]) {
                io.to(entry.socketId).emit('hx:queue:update', {
                    inQueue: false, error: 'ENGINE_UNAVAILABLE',
                });
            }
        }
    }

    for (const entry of queue.values()) {
        io.to(entry.socketId).emit('hx:queue:update', statusOf(entry, now));
    }
}

/** Build the room and invite both players into it. */
async function pairUp(io, a, b) {
    // Colours by coin toss: neither rating nor arrival order should decide who
    // gets the first move.
    const [black, white] = Math.random() < 0.5 ? [a, b] : [b, a];

    const room = await createRoom({
        timeControl: a.timeControl,
        reserved: [black.userId, white.userId],
    });

    const announce = (entry, seat, opponent) => {
        io.to(entry.socketId).emit('hx:matched', {
            code: room.code,
            colour: seat,
            timeControl: room.timeControl,
            opponent: { pseudo: opponent.pseudo, elo: opponent.elo },
        });
    };
    announce(black, 0, white);
    announce(white, 1, black);

    // If neither player turns up, the room should not linger.
    const abandon = setTimeout(() => {
        const current = rooms.get(room.code);
        if (current && !current.seats[0] && !current.seats[1]) rooms.delete(room.code);
    }, 60000);
    if (abandon.unref) abandon.unref();

    return room;
}

module.exports = {
    attachMatchmaking,
    queue,
    bandFor,
    compatible,
    findPair,
    START_BAND,
    WIDEN_PER_STEP,
    STEP_MS,
    MAX_BAND,
};
