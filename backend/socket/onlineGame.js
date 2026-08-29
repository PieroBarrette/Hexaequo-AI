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

const CHAT_MAX_LENGTH = 300;
const CHAT_MIN_INTERVAL_MS = 400;
const CHAT_HISTORY = 60;                      // enough to read the room on arrival

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

/* ── Presence ─────────────────────────────────────────────────────────────
 *
 * Who is on the site, not merely who has walked into the lobby. A green light
 * beside a name has to answer for someone reading their own profile page or
 * halfway through a game, so the map is filled from hx:identify — the one
 * thing every signed-in socket does, wherever it is.
 *
 * One entry per account however many tabs are open: the newest socket holds
 * it, and only that socket can clear it.
 */
const online = new Map();

/** Whether this account is at a board right now. */
function isPlaying(userId) {
    for (const room of rooms.values()) {
        if (room.result) continue;
        for (let seat = 0; seat < 2; seat++) {
            const player = room.players[seat];
            if (player && player.userId === userId && room.seats[seat]) return true;
        }
    }
    return false;
}

/** 'free' — here and able to start; 'playing' — here but at a board; 'offline'. */
function statusOf(userId) {
    if (!online.has(userId)) return 'offline';
    return isPlaying(userId) ? 'playing' : 'free';
}

/**
 * Tell whoever is watching this account that its light has changed.
 *
 * Watching is per socket and by name, so a page showing one player is not sent
 * the comings and goings of everyone else.
 */
function announcePresence(io, userId) {
    const status = statusOf(userId);
    for (const socket of io.sockets.sockets.values()) {
        const watching = socket.data && socket.data.hxWatching;
        if (watching && watching.has(userId)) {
            socket.emit('hx:presence', { statuses: { [userId]: status } });
        }
    }
}

/* Anything that ends a game changes two lights at once. */
const gameOverListeners = new Set();
function onGameFinished(fn) { gameOverListeners.add(fn); return () => gameOverListeners.delete(fn); }

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
        settled: room.settled.slice(),
        names: room.names,
        chat: room.chat,
        // A rematch already agreed: whoever arrives late is sent to the new room
        // rather than left looking at a finished one.
        rematchCode: room.rematchCode || null,
        rematchOfferedBy: room.rematch ? room.rematch.seat : null,
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

/**
 * An empty room, seats unfilled.
 *
 * Shared by hx:create and by matchmaking, which needs the same room but
 * reserves both seats in advance for the two players it paired.
 */
async function createRoom({ timeControl = 'none', reserved = null } = {}) {
    const state = await engine.createGame();
    const code = makeCode();
    const room = {
        code,
        state,
        moves: [],
        notations: [],
        seats: [null, null],
        players: [null, null],
        names: [null, null],
        chat: [],
        rematch: null,          // { seat } while one side has offered
        rematchCode: null,      // the room that replaced this one, once agreed
        // When set, only these accounts may take the matching seat — a paired
        // game is not something a passer-by can walk into.
        reserved,
        signatures: new Map(),
        result: null,
        lastSeen: Date.now(),
        timeControl: Object.prototype.hasOwnProperty.call(TIME_CONTROLS, timeControl) ? timeControl : 'none',
        everFull: false,
        /*
         * Whether each seat is settled: true once that seat has played a move.
         * Until then whoever holds it may still sign in and have the seat take
         * their name, which is also what decides whether the game counts. The
         * window closes per seat rather than at the game's first move, or the
         * second player — who cannot move until the first has — would never
         * have one. It closes at all so that nobody can wait to see whether
         * they are winning before making the game rated.
         */
        settled: [false, false],
        grace: null,
        clock: null,
    };
    room.clock = makeClock(room.timeControl);
    rooms.set(code, room);
    return room;
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

    /* Both players are free again: their lights, and anyone who agreed to
       play them next, are waiting on exactly this. */
    for (const player of room.players) {
        if (player) announcePresence(io, player.userId);
    }
    for (const fn of gameOverListeners) {
        try { fn(room); } catch (error) { console.error('[online] game-over hook:', error.message); }
    }

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
                /* Seats already held by this socket adopt the identity, so a
                   player who signs in while waiting still gets a rated game —
                   but only a seat that has not played yet. Once someone has
                   moved from a seat, it stays whoever moved. */
                for (const code of socket.data.hxRooms) {
                    const room = rooms.get(code);
                    if (!room) continue;
                    const seat = seatOf(room, socket.id);
                    if (seat === -1 || room.result || room.settled[seat]) continue;
                    room.players[seat] = { ...socket.data.user };
                    room.names[seat] = user.pseudo;
                    io.to(code).emit('hx:seats', {
                        code, players: room.players.map(seatView), rated: isRated(room),
                        settled: room.settled.slice(),
                    });
                }
                online.set(user.id, {
                    userId: user.id, pseudo: user.pseudo, elo: user.elo, socketId: socket.id,
                });
                announcePresence(io, user.id);
                reply(callback, { ok: true, user: { pseudo: user.pseudo, elo: user.elo } });
            } catch (error) {
                socket.data.user = null;
                reply(callback, { ok: false, error: 'BAD_TOKEN' });
            }
        });

        /**
         * Watch a handful of accounts and be told when their lights change.
         *
         * The reply carries the answer as it stands, so a page never has to
         * draw a light it does not know yet; the pushes carry the changes.
         */
        socket.on('hx:presence:watch', (payload, callback) => {
            const ids = Array.isArray(payload && payload.userIds) ? payload.userIds : [];
            socket.data.hxWatching = new Set(ids.slice(0, 200).map(String));
            const statuses = {};
            for (const id of socket.data.hxWatching) statuses[id] = statusOf(id);
            reply(callback, { ok: true, statuses });
        });

        /** Open a room and take the black seat. */
        socket.on('hx:create', async (options, callback) => {
            if (typeof options === 'function') { callback = options; options = {}; }
            options = options || {};
            if (socket.data.hxRooms.size >= MAX_ROOMS_PER_SOCKET) {
                return reply(callback, { ok: false, error: 'TOO_MANY_ROOMS' });
            }
            let room;
            try {
                room = await createRoom({ timeControl: options.timeControl });
            } catch (error) {
                return reply(callback, { ok: false, error: 'ENGINE_UNAVAILABLE' });
            }
            room.seats[0] = socket.id;
            room.players[0] = socket.data.user ? { ...socket.data.user } : null;
            room.names[0] = (socket.data.user && socket.data.user.pseudo)
                || String(options.name || '').slice(0, 24) || null;
            socket.join(room.code);
            socket.data.hxRooms.add(room.code);
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
                if (room.reserved) {
                    // A paired game: each player has a seat with their name on it.
                    const mine = socket.data.user
                        ? room.reserved.indexOf(socket.data.user.userId)
                        : -1;
                    if (mine === -1) return reply(callback, { ok: false, error: 'ROOM_FULL' });
                    seat = mine;
                } else {
                    seat = room.seats[0] === null ? 0 : (room.seats[1] === null ? 1 : -1);
                }
                if (seat === -1) return reply(callback, { ok: false, error: 'ROOM_FULL' });
                room.seats[seat] = socket.id;
                room.players[seat] = socket.data.user ? { ...socket.data.user } : null;
                const name = (socket.data.user && socket.data.user.pseudo)
                    || String((payload && payload.name) || '').slice(0, 24);
                room.names[seat] = name || null;
            } else if (socket.data.user && !room.settled[seat]) {
                // Returning to a seat we already held, before playing from it:
                // take the identity, which is also what makes the game rated.
                // Once the seat has moved it keeps whoever it started with.
                room.players[seat] = { ...socket.data.user };
                room.names[seat] = socket.data.user.pseudo;
            }
            if (room.seats[0] && room.seats[1]) {
                const firstTime = !room.everFull;
                room.everFull = true;
                if (firstTime) startClock(io, room);   // the game begins when both are seated
                // Both are at a board now, so both lights turn amber.
                for (const player of room.players) {
                    if (player) announcePresence(io, player.userId);
                }
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
            // And who it is: the player already seated learns the newcomer's
            // name, and whether the game they are in now counts.
            socket.to(code).emit('hx:seats', {
                code, players: room.players.map(seatView), rated: isRated(room),
                settled: room.settled.slice(),
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
            room.settled[seat] = true;   // this seat is now whoever played from it
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

        /**
         * Say something to the other player.
         *
         * Kept on the room rather than broadcast blindly, so a player who
         * reconnects reads what they missed. Only the two seats may write:
         * a room code is easy to guess at, and nobody should be able to talk
         * into a stranger's game.
         */
        socket.on('hx:chat', (payload, callback) => {
            const code = String((payload && payload.code) || '').toUpperCase().trim();
            const room = rooms.get(code);
            if (!room) return reply(callback, { ok: false, error: 'NO_SUCH_ROOM' });
            const seat = seatOf(room, socket.id);
            if (seat === -1) return reply(callback, { ok: false, error: 'NOT_A_PLAYER' });

            const text = String((payload && payload.text) || '').replace(/\s+/g, ' ').trim();
            if (!text) return reply(callback, { ok: false, error: 'EMPTY' });

            const now = Date.now();
            if (now - (socket.data.hxLastChatAt || 0) < CHAT_MIN_INTERVAL_MS) {
                return reply(callback, { ok: false, error: 'TOO_FAST' });
            }
            socket.data.hxLastChatAt = now;

            const message = {
                seat,
                name: room.names[seat] || null,
                text: text.slice(0, CHAT_MAX_LENGTH),
                at: now,
            };
            room.chat.push(message);
            if (room.chat.length > CHAT_HISTORY) room.chat.shift();
            touch(room);
            io.to(code).emit('hx:chat', { code, message });
            reply(callback, { ok: true });
        });

        /**
         * Offer a rematch, or accept the one waiting.
         *
         * The same event does both: the first seat to send it makes the offer,
         * and the second accepts it. Colours swap, so a rematch is not a rerun
         * of the same advantage.
         */
        socket.on('hx:rematch', async (payload, callback) => {
            const code = String((payload && payload.code) || '').toUpperCase().trim();
            const room = rooms.get(code);
            if (!room) return reply(callback, { ok: false, error: 'NO_SUCH_ROOM' });
            const seat = seatOf(room, socket.id);
            if (seat === -1) return reply(callback, { ok: false, error: 'NOT_A_PLAYER' });
            if (!room.result) return reply(callback, { ok: false, error: 'GAME_IN_PROGRESS' });
            touch(room);

            // Already agreed: hand back the room that was made, however many
            // times this is clicked.
            if (room.rematchCode) {
                return reply(callback, { ok: true, code: room.rematchCode, ready: true });
            }
            if (!room.rematch) {
                room.rematch = { seat, at: Date.now() };
                socket.to(code).emit('hx:rematch:offer', { code, seat });
                return reply(callback, { ok: true, ready: false, offered: true });
            }
            if (room.rematch.seat === seat) {
                return reply(callback, { ok: true, ready: false, offered: true });
            }

            // Both want it. The new room seats them the other way round.
            const [black, white] = [room.players[1], room.players[0]];
            let next;
            try {
                next = await createRoom({
                    timeControl: room.timeControl,
                    // Reserved only when both are signed in; a guest has no
                    // identity that outlives the socket, so their rematch room
                    // is an ordinary one and colours follow arrival.
                    reserved: black && white && black.userId && white.userId
                        ? [black.userId, white.userId]
                        : null,
                });
            } catch (error) {
                return reply(callback, { ok: false, error: 'ENGINE_UNAVAILABLE' });
            }
            room.rematchCode = next.code;
            room.rematch = null;
            io.to(code).emit('hx:rematch:ready', { code, next: next.code });
            reply(callback, { ok: true, code: next.code, ready: true });
        });

        /** Turn a rematch down, so the other side stops waiting on an answer. */
        socket.on('hx:rematch:decline', (payload, callback) => {
            const code = String((payload && payload.code) || '').toUpperCase().trim();
            const room = rooms.get(code);
            if (!room) return reply(callback, { ok: false, error: 'NO_SUCH_ROOM' });
            const seat = seatOf(room, socket.id);
            if (seat === -1) return reply(callback, { ok: false, error: 'NOT_A_PLAYER' });
            if (room.rematch && room.rematch.seat !== seat) {
                room.rematch = null;
                socket.to(code).emit('hx:rematch:declined', { code, seat });
            }
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
            const who = socket.data.user;
            if (who) {
                const entry = online.get(who.userId);
                // Another tab may hold the entry; only its own socket clears it.
                if (entry && entry.socketId === socket.id) {
                    online.delete(who.userId);
                    announcePresence(io, who.userId);
                }
            }
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

module.exports = {
    attachOnlineGames, rooms, createRoom, publicView, isRated,
    online, statusOf, isPlaying, announcePresence, onGameFinished,
    RECONNECT_GRACE_MS, TIME_CONTROLS,
};
