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

const engine = require('../game/engine');

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

function publicView(room) {
    return {
        code: room.code,
        state: room.state,
        moves: room.moves,
        notations: room.notations,
        result: room.result,
        seats: [Boolean(room.seats[0]), Boolean(room.seats[1])],
        names: room.names,
        timeControl: room.timeControl,
        graceMs: RECONNECT_GRACE_MS[room.timeControl] || RECONNECT_GRACE_MS.none,
        // Absolute deadline so a client can render a countdown without needing
        // its clock to agree with ours.
        awaitingReturn: room.grace
            ? { seat: room.grace.seat, msLeft: Math.max(0, room.grace.deadline - Date.now()) }
            : null,
    };
}

function seatOf(room, socketId) {
    if (room.seats[0] === socketId) return 0;
    if (room.seats[1] === socketId) return 1;
    return -1;
}

function touch(room) {
    room.lastSeen = Date.now();
}

/** Finish a room and tell both seats why. */
function finish(io, room, result) {
    cancelGrace(room);
    room.result = result;
    io.to(room.code).emit('hx:ended', { code: room.code, result });
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

        const reply = (callback, payload) => {
            if (typeof callback === 'function') callback(payload);
        };

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
                names: [String(options.name || '').slice(0, 24) || null, null],
                signatures: new Map(),
                result: null,
                lastSeen: Date.now(),
                timeControl: Object.prototype.hasOwnProperty.call(RECONNECT_GRACE_MS, options.timeControl)
                    ? options.timeControl : 'none',
                everFull: false,
                grace: null,
            };
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
                const name = String((payload && payload.name) || '').slice(0, 24);
                room.names[seat] = name || null;
            }
            if (room.seats[0] && room.seats[1]) room.everFull = true;
            // Back in time: call off the abandonment countdown.
            if (room.grace && room.grace.seat === seat) cancelGrace(room);

            socket.join(code);
            socket.data.hxRooms.add(code);
            socket.to(code).emit('hx:opponent', { code, seat, name: room.names[seat], joined: true });
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
                    graceMs: grace ? grace.graceMs : null,
                    msLeft: grace ? Math.max(0, grace.deadline - Date.now()) : null,
                });
            }
        });
    });
}

module.exports = { attachOnlineGames, rooms, RECONNECT_GRACE_MS };
