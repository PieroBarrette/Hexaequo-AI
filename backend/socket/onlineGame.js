/**
 * Authoritative online games.
 *
 * The legacy handler in socketHandler.js lets a client post its whole game
 * state and simply relays it, which cannot support a rating. This module is the
 * replacement: clients send *intents*, the server owns the position, and every
 * broadcast carries the state the server computed.
 *
 * Scope for now: guest games joined through an invitation code, unrated, held
 * in memory. Accounts, persistence and Elo build on top of this — the room
 * already keeps the ordered list of intents, which is all that is needed to
 * write a game to the database and to replay it later.
 */

const jwt = require('jsonwebtoken');
const engine = require('../game/engine');
const { query } = require('../config/database');
const { JWT_SECRET } = require('../config/env');
const ratedGames = require('../services/ratedGameService');

/* Codes a person has to read aloud: no O/0, I/1, S/5, B/8, Z/2. */
const CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679';
const CODE_LENGTH = 6;
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;      // forget rooms nobody has touched for two hours
const SWEEP_MS = 10 * 60 * 1000;
const MAX_ROOMS_PER_SOCKET = 5;
const MIN_MOVE_INTERVAL_MS = 150;             // a human cannot legitimately move faster

/**
 * How long a disconnected player has to come back before losing by abandonment.
 *
 * Proportional to the time control, the way chess sites do it: in bullet a
 * thirty-second wait is most of the game, while an untimed game can afford to
 * be patient. Clocks are not implemented yet, so every room is 'none' for now
 * and the table is already in place for when they arrive.
 */
const RECONNECT_GRACE_MS = {
    bullet: 15000,
    blitz: 30000,
    rapid: 60000,
    classic: 120000,
    none: 120000,
};

/**
 * Available cadences.
 *
 * Hexaequo games run long — a hundred plies is ordinary and two hundred
 * happens — so these are more generous than their chess namesakes, and every
 * cadence carries an increment so a long endgame cannot be won on the clock
 * alone.
 */
const TIME_CONTROLS = {
    none: { initialMs: 0, incrementMs: 0 },
    bullet: { initialMs: 2 * 60000, incrementMs: 1000 },
    blitz: { initialMs: 5 * 60000, incrementMs: 3000 },
    rapid: { initialMs: 10 * 60000, incrementMs: 5000 },
    classic: { initialMs: 20 * 60000, incrementMs: 10000 },
};

const rooms = new Map();

function makeCode() {
    let code;
    do {
        code = '';
        for (let i = 0; i < CODE_LENGTH; i++) {
            code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
        }
    } while (rooms.has(code));
    return code;
}

/**
 * A game counts for the rating only when two different signed-in players hold
 * the seats. Anything else — a guest, a link shared with yourself — is a
 * friendly.
 */
function isRated(room) {
    const [black, white] = room.players;
    return Boolean(black && white && black.userId && white.userId && black.userId !== white.userId);
}

/** What each side may know about the other: a name and a rating, never an email. */
function seatView(seat) {
    if (!seat || !seat.userId) return null;
    return { pseudo: seat.pseudo, elo: seat.elo, userId: seat.userId };
}

function publicView(room) {
    return {
        rated: isRated(room),
        players: room.players.map(seatView),
        code: room.code,
        state: room.state,
        moves: room.moves,
        notations: room.notations,
        result: room.result,
        seats: [Boolean(room.seats[0]), Boolean(room.seats[1])],
        names: room.names,
        timeControl: room.timeControl,
        clock: clockView(room),
        graceMs: RECONNECT_GRACE_MS[room.timeControl] || RECONNECT_GRACE_MS.none,
        // Absolute deadline so a client can render a countdown without needing
        // its clock to agree with ours.
        awaitingReturn: room.grace
            ? { seat: room.grace.seat, msLeft: Math.max(0, room.grace.deadline - Date.now()) }
            : null,
    };
}

/* ── Clocks ─────────────────────────────────────────────────────────────── */

/*
 * The server owns the time. A client is told what is left and interpolates for
 * display, but every deduction happens here, on the same event that accepts the
 * move, so a lagging or lying client cannot gain a second.
 *
 * Clocks are not paused when a player disconnects: their reconnection
 * countdown runs alongside, and whichever expires first ends the game. That is
 * the convention on chess sites, and it stops "pull the plug when losing on
 * time" from being a strategy.
 */

function makeClock(control) {
    const spec = TIME_CONTROLS[control] || TIME_CONTROLS.none;
    if (!spec.initialMs) return null;              // untimed
    return {
        control,
        initialMs: spec.initialMs,
        incrementMs: spec.incrementMs,
        remaining: [spec.initialMs, spec.initialMs],
        turnStartedAt: 0,
        running: false,
        timer: null,
    };
}

/** Milliseconds left for each seat right now, the running side included. */
function liveRemaining(room) {
    const clock = room.clock;
    if (!clock) return null;
    const out = clock.remaining.slice();
    if (clock.running) {
        const turn = room.state.turn;
        out[turn] = Math.max(0, out[turn] - (Date.now() - clock.turnStartedAt));
    }
    return out;
}

function clockView(room) {
    const clock = room.clock;
    if (!clock) return null;
    return {
        control: clock.control,
        initialMs: clock.initialMs,
        incrementMs: clock.incrementMs,
        remaining: liveRemaining(room),
        running: clock.running,
        turn: room.state.turn,
    };
}

function disarmFlag(room) {
    if (room.clock && room.clock.timer) {
        clearTimeout(room.clock.timer);
        room.clock.timer = null;
    }
}

/** Schedule the flag fall for whoever is on move. */
function armFlag(io, room) {
    disarmFlag(room);
    const clock = room.clock;
    if (!clock || !clock.running || room.result) return;
    const turn = room.state.turn;
    const left = Math.max(0, clock.remaining[turn] - (Date.now() - clock.turnStartedAt));
    clock.timer = setTimeout(() => {
        const current = rooms.get(room.code);
        if (!current || current.result || !current.clock || !current.clock.running) return;
        const flagged = current.state.turn;
        current.clock.remaining[flagged] = 0;
        current.clock.running = false;
        finish(io, current, { winner: 1 - flagged, reason: 'timeout' });
    }, left);
    if (clock.timer.unref) clock.timer.unref();
}

/** Both seats are filled for the first time: the game is on. */
function startClock(io, room) {
    if (!room.clock || room.clock.running) return;
    room.clock.running = true;
    room.clock.turnStartedAt = Date.now();
    armFlag(io, room);
}

/**
 * Charge the elapsed time to the player who just moved and grant the
 * increment. Returns true if they ran out mid-move.
 */
function chargeClock(room, seat) {
    const clock = room.clock;
    if (!clock || !clock.running) return false;
    const now = Date.now();
    const left = clock.remaining[seat] - (now - clock.turnStartedAt);
    if (left <= 0) {
        clock.remaining[seat] = 0;
        clock.running = false;
        return true;
    }
    clock.remaining[seat] = left + clock.incrementMs;
    clock.turnStartedAt = now;
    return false;
}

function seatOf(room, socketId) {
    if (room.seats[0] === socketId) return 0;
    if (room.seats[1] === socketId) return 1;
    return -1;
}

function touch(room) {
    room.lastSeen = Date.now();
}

/**
 * Finish a room and tell both seats why.
 *
 * The result is announced first and recorded afterwards: the players should
 * never wait on a database write to learn they have won, and a failed write
 * must not cost them the result.
 */
function finish(io, room, result) {
    cancelGrace(room);
    disarmFlag(room);
    if (room.clock) room.clock.running = false;
    if (room.result) return;                     // a game ends exactly once
    room.result = result;
    io.to(room.code).emit('hx:ended', {
        code: room.code, result, clock: clockView(room), rated: isRated(room),
    });

    ratedGames.recordGame(room, result)
        .then((record) => {
            if (!record || !record.rated) return;
            room.ratings = record.ratings;
            io.to(room.code).emit('hx:rated', {
                code: room.code, gameId: record.gameId, ratings: record.ratings,
            });
        })
        .catch((error) => console.error('[online] recording failed:', error.message));
}

function cancelGrace(room) {
    if (!room.grace) return;
    clearTimeout(room.grace.timer);
    room.grace = null;
}

/**
 * A player has dropped. Start their countdown; if it runs out, the opponent
 * wins by abandonment. Only worth doing once both seats have been occupied and
 * the game is still live — nobody abandons a game that has not begun.
 */
function startGrace(io, room, seat) {
    cancelGrace(room);
    if (room.result) return;
    if (!room.everFull) return;
    const graceMs = RECONNECT_GRACE_MS[room.timeControl] || RECONNECT_GRACE_MS.none;
    const deadline = Date.now() + graceMs;
    const timer = setTimeout(() => {
        const current = rooms.get(room.code);
        if (!current || current.result) return;
        if (current.seats[seat]) return;          // they came back in time
        finish(io, current, { winner: 1 - seat, reason: 'abandoned' });
    }, graceMs);
    if (timer.unref) timer.unref();
    room.grace = { seat, deadline, timer };
    return { seat, deadline, graceMs };
}

function attachOnlineGames(io) {
    // Warm the engine so the first move of the first game is not slowed by the
    // dynamic import.
    engine.ready().catch((error) => {
        console.error('[online] engine failed to load:', error.message);
    });

    const sweeper = setInterval(() => {
        const cutoff = Date.now() - ROOM_IDLE_MS;
        for (const [code, room] of rooms) {
            if (room.lastSeen < cutoff) rooms.delete(code);
        }
    }, SWEEP_MS);
    if (sweeper.unref) sweeper.unref();

    io.on('connection', (socket) => {
        socket.data.hxRooms = new Set();
        socket.data.hxLastMoveAt = 0;
        socket.data.user = null;

        const reply = (callback, payload) => {
            if (typeof callback === 'function') callback(payload);
        };

        /**
         * Attach an account to this socket.
         *
         * Sent after connecting, and again after signing in, so that signing in
         * mid-session does not require dropping the connection. Without it the
         * socket stays anonymous and its games are unrated.
         */
        socket.on('hx:identify', async (payload, callback) => {
            const token = payload && payload.token;
            if (!token) {
                socket.data.user = null;
                return reply(callback, { ok: true, user: null });
            }
            try {
                const claims = jwt.verify(String(token), JWT_SECRET);
                const { rows } = await query(
                    'SELECT id, pseudo, elo, games_played FROM users WHERE id = $1',
                    [claims.userId]
                );
                if (!rows.length) throw new Error('unknown account');
                const user = rows[0];
                socket.data.user = {
                    userId: user.id,
                    pseudo: user.pseudo,
                    elo: user.elo,
                    gamesPlayed: user.games_played,
                };
                // Seats already held by this socket adopt the identity, so a
                // player who signs in while waiting still gets a rated game.
                for (const code of socket.data.hxRooms) {
                    const room = rooms.get(code);
                    if (!room) continue;
                    const seat = seatOf(room, socket.id);
                    if (seat === -1 || room.result) continue;
                    room.players[seat] = { ...socket.data.user };
                    room.names[seat] = user.pseudo;
                    io.to(code).emit('hx:seats', {
                        code, players: room.players.map(seatView), rated: isRated(room),
                    });
                }
                reply(callback, { ok: true, user: { pseudo: user.pseudo, elo: user.elo } });
            } catch (error) {
                socket.data.user = null;
                reply(callback, { ok: false, error: 'BAD_TOKEN' });
            }
        });

        /** Open a room and take the black seat. */
        socket.on('hx:create', async (options, callback) => {
            if (typeof options === 'function') { callback = options; options = {}; }
            options = options || {};
            if (socket.data.hxRooms.size >= MAX_ROOMS_PER_SOCKET) {
                return reply(callback, { ok: false, error: 'TOO_MANY_ROOMS' });
            }
            let state;
            try {
                state = await engine.createGame();
            } catch (error) {
                return reply(callback, { ok: false, error: 'ENGINE_UNAVAILABLE' });
            }
            const code = makeCode();
            const room = {
                code,
                state,
                moves: [],
                notations: [],
                seats: [socket.id, null],
                players: [socket.data.user ? { ...socket.data.user } : null, null],
                names: [
                    (socket.data.user && socket.data.user.pseudo)
                        || String(options.name || '').slice(0, 24) || null,
                    null,
                ],
                signatures: new Map(),
                result: null,
                lastSeen: Date.now(),
                timeControl: Object.prototype.hasOwnProperty.call(TIME_CONTROLS, options.timeControl)
                    ? options.timeControl : 'none',
                everFull: false,
                grace: null,
                clock: null,
            };
            room.clock = makeClock(room.timeControl);
            rooms.set(code, room);
            socket.join(code);
            socket.data.hxRooms.add(code);
            reply(callback, { ok: true, colour: 0, ...publicView(room) });
        });

        /** Take the free seat in an existing room, or rejoin one's own. */
        socket.on('hx:join', async (payload, callback) => {
            const code = String((payload && payload.code) || '').toUpperCase().trim();
            const room = rooms.get(code);
            if (!room) return reply(callback, { ok: false, error: 'NO_SUCH_ROOM' });
            touch(room);

            let seat = seatOf(room, socket.id);
            if (seat === -1) {
                seat = room.seats[0] === null ? 0 : (room.seats[1] === null ? 1 : -1);
                if (seat === -1) return reply(callback, { ok: false, error: 'ROOM_FULL' });
                room.seats[seat] = socket.id;
                room.players[seat] = socket.data.user ? { ...socket.data.user } : null;
                const name = (socket.data.user && socket.data.user.pseudo)
                    || String((payload && payload.name) || '').slice(0, 24);
                room.names[seat] = name || null;
            } else if (socket.data.user) {
                // Returning to a seat we already held: refresh the identity in
                // case the player signed in since.
                room.players[seat] = { ...socket.data.user };
                room.names[seat] = socket.data.user.pseudo;
            }
            if (room.seats[0] && room.seats[1]) {
                const firstTime = !room.everFull;
                room.everFull = true;
                if (firstTime) startClock(io, room);   // the game begins when both are seated
            }
            // Back in time: call off the abandonment countdown.
            if (room.grace && room.grace.seat === seat) cancelGrace(room);

            socket.join(code);
            socket.data.hxRooms.add(code);
            // The clock goes with the news: the player already seated must learn
            // that it has started, or their display will sit frozen while the
            // server counts down.
            socket.to(code).emit('hx:opponent', {
                code, seat, name: room.names[seat], joined: true, clock: clockView(room),
            });
            reply(callback, { ok: true, colour: seat, ...publicView(room) });
        });

        /**
         * Play a move. The client sends only what it wants to do; the server
         * regenerates the legal moves and applies its own.
         */
        socket.on('hx:move', async (payload, callback) => {
            const code = String((payload && payload.code) || '').toUpperCase().trim();
            const room = rooms.get(code);
            if (!room) return reply(callback, { ok: false, error: 'NO_SUCH_ROOM' });
            if (room.result) return reply(callback, { ok: false, error: 'GAME_OVER' });

            const seat = seatOf(room, socket.id);
            if (seat === -1) return reply(callback, { ok: false, error: 'NOT_A_PLAYER' });

            const now = Date.now();
            if (now - socket.data.hxLastMoveAt < MIN_MOVE_INTERVAL_MS) {
                return reply(callback, { ok: false, error: 'TOO_FAST' });
            }

            let outcome;
            try {
                outcome = await engine.applyIntent(room.state, payload && payload.intent, seat);
            } catch (error) {
                return reply(callback, { ok: false, error: 'ENGINE_ERROR' });
            }
            if (!outcome.ok) return reply(callback, { ok: false, error: outcome.error });

            socket.data.hxLastMoveAt = now;
            room.state = outcome.state;
            room.moves.push(outcome.move);
            room.notations.push(outcome.notation);
            touch(room);

            let result = outcome.result;

            // Charge the clock before anything else: a move played after the
            // flag has fallen does not count, even if it was legal.
            if (chargeClock(room, seat)) {
                result = { winner: 1 - seat, reason: 'timeout' };
            } else {
                armFlag(io, room);
            }

            // Threefold repetition, counted on the server so neither client can
            // claim or deny a draw.
            if (!result) {
                try {
                    const signature = await engine.positionSignature(room.state);
                    const seen = (room.signatures.get(signature) || 0) + 1;
                    room.signatures.set(signature, seen);
                    if (seen >= 3) result = { winner: null, reason: 'repetition' };
                } catch { /* a signature failure must not void a legal move */ }
            }

            const broadcast = {
                code,
                state: room.state,
                move: outcome.move,
                notation: outcome.notation,
                captures: outcome.captures,
                by: seat,
                ply: room.moves.length,
                clock: clockView(room),
                result: result || null,
            };
            io.to(code).emit('hx:moved', broadcast);
            reply(callback, { ok: true, ...broadcast });

            if (result) finish(io, room, result);
        });

        /** Give up; the opponent wins. */
        socket.on('hx:resign', (payload, callback) => {
            const code = String((payload && payload.code) || '').toUpperCase().trim();
            const room = rooms.get(code);
            if (!room) return reply(callback, { ok: false, error: 'NO_SUCH_ROOM' });
            const seat = seatOf(room, socket.id);
            if (seat === -1) return reply(callback, { ok: false, error: 'NOT_A_PLAYER' });
            if (room.result) return reply(callback, { ok: false, error: 'GAME_OVER' });
            touch(room);
            finish(io, room, { winner: 1 - seat, reason: 'resigned' });
            reply(callback, { ok: true });
        });

        /** Re-read the position, after a reconnection or a lost packet. */
        socket.on('hx:sync', (payload, callback) => {
            const code = String((payload && payload.code) || '').toUpperCase().trim();
            const room = rooms.get(code);
            if (!room) return reply(callback, { ok: false, error: 'NO_SUCH_ROOM' });
            touch(room);
            reply(callback, { ok: true, colour: seatOf(room, socket.id), ...publicView(room) });
        });

        socket.on('disconnect', () => {
            for (const code of socket.data.hxRooms) {
                const room = rooms.get(code);
                if (!room) continue;
                const seat = seatOf(room, socket.id);
                if (seat === -1) continue;
                // Free the seat so the same player can come back to it, and give
                // them a window to do so before the game is awarded away.
                room.seats[seat] = null;
                const grace = startGrace(io, room, seat);
                socket.to(code).emit('hx:opponent', {
                    code,
                    seat,
                    name: room.names[seat],
                    joined: false,
                    clock: clockView(room),
                    graceMs: grace ? grace.graceMs : null,
                    msLeft: grace ? Math.max(0, grace.deadline - Date.now()) : null,
                });
            }
        });
    });
}

module.exports = { attachOnlineGames, rooms, RECONNECT_GRACE_MS, TIME_CONTROLS };
