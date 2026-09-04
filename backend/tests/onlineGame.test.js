/**
 * Authoritative online games, exercised through real socket.io clients.
 *
 * Run with: node tests/onlineGame.test.js
 *
 * No database and no Express app: the module under test only needs an io
 * instance, so the test stands up a bare HTTP server and connects two genuine
 * clients to it. What is being checked is that a hostile client gets nowhere.
 */

// Before anything else: this suite writes nothing, so it gets nothing to
// write to. See tests/database.js.
require('./database').none();


const assert = require('assert');
const http = require('http');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { attachOnlineGames, RECONNECT_GRACE_MS, TIME_CONTROLS } = require('../socket/onlineGame');

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ok    ${name}`);
    } catch (error) {
        failed++;
        console.log(`  FAIL  ${name}`);
        console.log(`        ${error.message}`);
    }
}

/** Promise wrapper around socket.io acknowledgements. */
function ask(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 5000);
        socket.emit(event, payload, (response) => {
            clearTimeout(timer);
            resolve(response);
        });
    });
}

function waitFor(socket, event, ms = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${event}`)), ms);
        socket.once(event, (payload) => {
            clearTimeout(timer);
            resolve(payload);
        });
    });
}

async function sharedEngine() {
    const { pathToFileURL } = require('url');
    const path = require('path');
    const dir = path.join(__dirname, '..', '..', 'web', 'src', 'game');
    const url = (f) => pathToFileURL(path.join(dir, f)).href;
    const [state, moves] = await Promise.all([import(url('state.js')), import(url('moves.js'))]);
    return { state, moves };
}

/** A legal intent for whoever is to move in `snapshot`. */
async function legalIntent(snapshot, index = 0) {
    const { state, moves } = await sharedEngine();
    const position = state.deserializeState(snapshot);
    const legal = moves.generateMoves(position);
    return moves.moveIntent(legal[index % legal.length]);
}

async function run() {
    const server = http.createServer();
    const io = new Server(server, { cors: { origin: '*' } });
    attachOnlineGames(io);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;

    const open = () => new Promise((resolve, reject) => {
        const socket = connect(url, { transports: ['websocket'], forceNew: true });
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', reject);
    });

    console.log('\nAuthoritative online games\n');

    const black = await open();
    const white = await open();

    let code = null;

    await test('a room can be opened and joined', async () => {
        const created = await ask(black, 'hx:create', { name: 'Noir' });
        assert.ok(created.ok, created.error);
        assert.strictEqual(created.colour, 0, 'the opener takes Black');
        assert.match(created.code, /^[ACDEFGHJKLMNPQRTUVWXY34679]{6}$/, 'readable room code');
        code = created.code;

        const joined = await ask(white, 'hx:join', { code, name: 'Blanc' });
        assert.ok(joined.ok, joined.error);
        assert.strictEqual(joined.colour, 1, 'the joiner takes White');
        assert.deepStrictEqual(joined.state, created.state, 'both see the same position');
    });

    await test('a third player is turned away', async () => {
        const third = await open();
        const response = await ask(third, 'hx:join', { code });
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'ROOM_FULL');
        third.disconnect();
    });

    /*
     * The one that had people sitting in the lobby with a green light beside
     * their name being told to sign in.
     *
     * A token that verifies is a token that says who you are. Reading the
     * profile behind it is a separate errand, and when that errand failed the
     * server used to answer BAD_TOKEN and sign the socket out — while the
     * lobby entry, put there by the identify that had worked, stayed exactly
     * where it was. This process has no database at all, so the lookup cannot
     * help but fail, which is the whole of the test.
     */
    await test('a good token that cannot be looked up is not a bad token', async () => {
        const jwt = require('jsonwebtoken');
        const { JWT_SECRET } = require('../config/env');
        const good = jwt.sign({ userId: 'someone' }, JWT_SECRET, { expiresIn: '1h' });
        const answer = await ask(black, 'hx:identify', { token: good });
        assert.strictEqual(answer.ok, false);
        assert.strictEqual(answer.error, 'LOOKUP_FAILED',
            'ours to fix, and never a reason to sign anybody out');
    });

    await test('a token that is not a token still is a bad token', async () => {
        const answer = await ask(black, 'hx:identify', { token: 'not-a-token' });
        assert.strictEqual(answer.ok, false);
        assert.strictEqual(answer.error, 'BAD_TOKEN');
    });

    await test('an unknown code is refused', async () => {
        const response = await ask(white, 'hx:join', { code: 'ZZZZZZ' });
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'NO_SUCH_ROOM');
    });

    await test('a legal move reaches the opponent', async () => {
        const view = await ask(black, 'hx:sync', { code });
        const intent = await legalIntent(view.state);
        const heard = waitFor(white, 'hx:moved');
        const response = await ask(black, 'hx:move', { code, intent });
        assert.ok(response.ok, response.error);
        const event = await heard;
        assert.strictEqual(event.by, 0);
        assert.strictEqual(event.state.turn, 1, 'the turn passes to White');
        assert.deepStrictEqual(event.state, response.state, 'broadcast matches the acknowledgement');
        /* What the move cost, measured by the server so that both players and
           anyone watching read the same number. A plausible reading rather
           than an exact one: the point is that it is measured at all, and that
           it is the time since the position appeared rather than since the
           room did. */
        assert.strictEqual(typeof event.ms, 'number', 'the broadcast carries how long the move took');
        assert.ok(event.ms >= 0 && event.ms < 60000, 'a plausible thinking time, got ' + event.ms);
    });

    await test('the times are part of the game, for anyone who joins later', async () => {
        const view = await ask(black, 'hx:sync', { code });
        assert.ok(Array.isArray(view.times), 'the room carries a time per move');
        assert.strictEqual(view.times.length, view.moves.length, 'one for one with the moves');
        assert.ok(view.times.every((ms) => ms === null || typeof ms === 'number'),
            'each is a number of milliseconds, or null where it was never known');
    });

    await test('playing out of turn is refused', async () => {
        // Wait past the anti-spam guard, which would otherwise answer first and
        // hide the check we are actually testing.
        await new Promise((r) => setTimeout(r, MIN_WAIT));
        const view = await ask(black, 'hx:sync', { code });
        const intent = await legalIntent(view.state);
        const response = await ask(black, 'hx:move', { code, intent });   // still White to move
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'NOT_YOUR_TURN');
    });

    await test('an illegal move is refused and the position is untouched', async () => {
        const before = await ask(white, 'hx:sync', { code });
        await new Promise((r) => setTimeout(r, 200));
        const response = await ask(white, 'hx:move', { code, intent: { type: 'tile', cell: 4095 } });
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'ILLEGAL_MOVE');
        const after = await ask(white, 'hx:sync', { code });
        assert.deepStrictEqual(after.state, before.state, 'a refused move must change nothing');
    });

    await test('a client cannot dictate the position', async () => {
        // There is no event that accepts a state: the only way in is an intent.
        const before = await ask(white, 'hx:sync', { code });
        await new Promise((r) => setTimeout(r, 200));
        const response = await ask(white, 'hx:move', {
            code,
            intent: { type: 'tile', cell: 4095 },
            state: { v: 1, tiles: [], pieces: [], turn: 0, capturedDisks: [6, 0], capturedRings: [0, 0] },
        });
        assert.strictEqual(response.ok, false);
        const after = await ask(white, 'hx:sync', { code });
        assert.deepStrictEqual(after.state, before.state);
        assert.deepStrictEqual(after.state.capturedDisks, [0, 0], 'no forged captures');
    });

    await test('a spectator socket cannot move', async () => {
        const stranger = await open();
        const response = await ask(stranger, 'hx:move', { code, intent: { type: 'tile', cell: 2080 } });
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'NOT_A_PLAYER');
        stranger.disconnect();
    });

    await test('moves fired faster than a human can play are throttled', async () => {
        const view = await ask(white, 'hx:sync', { code });
        const intent = await legalIntent(view.state);
        const first = await ask(white, 'hx:move', { code, intent });
        assert.ok(first.ok, first.error);
        const view2 = await ask(black, 'hx:sync', { code });
        const intent2 = await legalIntent(view2.state);
        const immediate = await ask(black, 'hx:move', { code, intent: intent2 });
        // Black has not moved recently, so this one is allowed; the guard is
        // per socket. Fire a second one straight away from the same socket.
        assert.ok(immediate.ok, immediate.error);
        const view3 = await ask(white, 'hx:sync', { code });
        const intent3 = await legalIntent(view3.state);
        const tooSoon = await ask(white, 'hx:move', { code, intent: intent3 });
        assert.strictEqual(tooSoon.ok, false);
        assert.strictEqual(tooSoon.error, 'TOO_FAST');
    });

    await test('a full game plays to a server-declared result', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', {});
        const room = created.code;
        await ask(b, 'hx:join', { code: room });

        let view = created;
        let plies = 0;
        let result = null;
        const seats = [a, b];
        while (plies < 400) {
            const mover = seats[view.state.turn];
            const intent = await legalIntent(view.state, Math.floor(Math.random() * 8));
            await new Promise((r) => setTimeout(r, MIN_WAIT));
            const response = await ask(mover, 'hx:move', { code: room, intent });
            if (!response.ok) throw new Error(`move refused: ${response.error}`);
            plies++;
            view = response;
            if (response.result) { result = response.result; break; }
        }
        assert.ok(result, `no result after ${plies} plies`);
        assert.ok(plies > 10, 'a real game, not an instant end');
        const final = await ask(a, 'hx:sync', { code: room });
        assert.ok(final.result, 'the room remembers the result');
        assert.strictEqual(final.moves.length, plies, 'every move was recorded');
        a.disconnect();
        b.disconnect();
    });

    await test('the same position a third time is a draw, and the move is marked', async () => {
        /* Nine plies: Black lays a tile, then the two discs walk back and
           forth until the position after White's fourth step has stood three
           times. The shortest such line from the opening, found by search.

           The rule is counted here and nowhere else -- neither client can
           claim a draw the server has not seen -- which is also why the mark
           is written here: the rules module is handed one position at a time
           and cannot know it has seen this one before. */
        const line = [
            { type: 'tile', cell: 2016 },
            { type: 'disk', path: [2017, 2081] },
            { type: 'disk', path: [2144, 2080] },
            { type: 'disk', path: [2081, 2017] },
            { type: 'disk', path: [2080, 2144] },
            { type: 'disk', path: [2017, 2081] },
            { type: 'disk', path: [2144, 2080] },
            { type: 'disk', path: [2081, 2017] },
            { type: 'disk', path: [2080, 2144] },
        ];
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', {});
        const room = created.code;
        await ask(b, 'hx:join', { code: room });

        const seats = [a, b];
        let last = null;
        for (let i = 0; i < line.length; i++) {
            await new Promise((r) => setTimeout(r, MIN_WAIT));
            const response = await ask(seats[i % 2], 'hx:move', { code: room, intent: line[i] });
            assert.ok(response.ok, `ply ${i + 1}: ${response.error}`);
            if (i < line.length - 1) {
                assert.strictEqual(response.result, null, `ply ${i + 1} does not end it`);
                assert.ok(!/[#=]$/.test(response.notation), `ply ${i + 1} is unmarked: ${response.notation}`);
            }
            last = response;
        }

        assert.ok(last.result, 'the ninth ply repeats the position for the third time');
        assert.strictEqual(last.result.reason, 'repetition');
        assert.strictEqual(last.result.winner, null, 'level, so nobody won');
        assert.ok(last.notation.endsWith('='), `got ${last.notation}`);

        /* And the room keeps the marked one, so a viewer joining later and a
           game written to the database read the same move list as the players. */
        const view = await ask(a, 'hx:sync', { code: room });
        assert.strictEqual(view.notations[view.notations.length - 1], last.notation);
        assert.strictEqual(view.notations.filter((text) => /[#=]$/.test(text)).length, 1,
            'one mark in the game');
        a.disconnect();
        b.disconnect();
    });

    await test('resigning ends the game for both sides', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });
        const heard = waitFor(b, 'hx:ended');
        const response = await ask(a, 'hx:resign', { code: created.code });
        assert.ok(response.ok, response.error);
        const event = await heard;
        assert.strictEqual(event.result.winner, 1, 'the opponent wins');
        assert.strictEqual(event.result.reason, 'resigned');
        const after = await ask(a, 'hx:move', { code: created.code, intent: { type: 'tile', cell: 2080 } });
        assert.strictEqual(after.ok, false);
        assert.strictEqual(after.error, 'GAME_OVER');
        a.disconnect();
        b.disconnect();
    });

    await test('an untimed room has no clock', async () => {
        const a = await open();
        const created = await ask(a, 'hx:create', { timeControl: 'none' });
        assert.strictEqual(created.clock, null);
        a.disconnect();
    });

    await test('a cadence sets both clocks and starts them when both are seated', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', { timeControl: 'blitz' });
        assert.ok(created.clock, 'the room has a clock');
        assert.strictEqual(created.clock.control, 'blitz');
        assert.strictEqual(created.clock.initialMs, TIME_CONTROLS.blitz.initialMs);
        assert.strictEqual(created.clock.running, false, 'not running with one player');
        assert.deepStrictEqual(created.clock.remaining,
            [TIME_CONTROLS.blitz.initialMs, TIME_CONTROLS.blitz.initialMs]);

        const joined = await ask(b, 'hx:join', { code: created.code });
        assert.strictEqual(joined.clock.running, true, 'the clock starts on the second arrival');
        await new Promise((r) => setTimeout(r, 300));
        const later = await ask(b, 'hx:sync', { code: created.code });
        assert.ok(later.clock.remaining[0] < TIME_CONTROLS.blitz.initialMs, "Black's time is ticking");
        assert.strictEqual(later.clock.remaining[1], TIME_CONTROLS.blitz.initialMs, "White's is not");
        a.disconnect();
        b.disconnect();
    });

    await test('the waiting player is told the clock has started', async () => {
        // Without this, whoever opened the room keeps showing the full time
        // while the server is already counting down.
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', { timeControl: 'blitz' });
        assert.strictEqual(created.clock.running, false);
        const heard = waitFor(a, 'hx:opponent');
        await ask(b, 'hx:join', { code: created.code });
        const event = await heard;
        assert.strictEqual(event.joined, true);
        assert.ok(event.clock, 'the arrival carries the clock');
        assert.strictEqual(event.clock.running, true, 'and says it is running');
        a.disconnect();
        b.disconnect();
    });

    await test('a move charges the mover and grants the increment', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', { timeControl: 'blitz' });
        await ask(b, 'hx:join', { code: created.code });
        await new Promise((r) => setTimeout(r, 400));
        const intent = await legalIntent(created.state);
        const response = await ask(a, 'hx:move', { code: created.code, intent });
        assert.ok(response.ok, response.error);
        const { initialMs, incrementMs } = TIME_CONTROLS.blitz;
        const black = response.clock.remaining[0];
        assert.ok(black < initialMs + incrementMs, 'time was spent');
        assert.ok(black > initialMs - 2000, 'but only what was actually used');
        assert.ok(black > initialMs - 400 + incrementMs - 200, 'the increment was granted');
        assert.strictEqual(response.clock.turn, 1, 'the clock now runs for White');
        a.disconnect();
        b.disconnect();
    });

    await test('running out of time loses the game', async () => {
        const original = TIME_CONTROLS.bullet.initialMs;
        TIME_CONTROLS.bullet.initialMs = 400;              // flag almost immediately
        try {
            const a = await open();
            const b = await open();
            const created = await ask(a, 'hx:create', { timeControl: 'bullet' });
            const ended = waitFor(a, 'hx:ended', 4000);
            await ask(b, 'hx:join', { code: created.code });   // starts the clock
            const event = await ended;
            assert.strictEqual(event.result.reason, 'timeout');
            assert.strictEqual(event.result.winner, 1, 'the player who did not flag wins');
            assert.strictEqual(event.clock.remaining[0], 0, "the flagged side's clock reads zero");
            const after = await ask(a, 'hx:move', { code: created.code, intent: { type: 'tile', cell: 2080 } });
            assert.strictEqual(after.ok, false);
            assert.strictEqual(after.error, 'GAME_OVER');
            a.disconnect();
            b.disconnect();
        } finally {
            TIME_CONTROLS.bullet.initialMs = original;
        }
    });

    await test('a clock does not start while a seat is empty', async () => {
        const original = TIME_CONTROLS.bullet.initialMs;
        TIME_CONTROLS.bullet.initialMs = 300;
        try {
            const a = await open();
            const created = await ask(a, 'hx:create', { timeControl: 'bullet' });
            await new Promise((r) => setTimeout(r, 700));    // longer than the whole clock
            const view = await ask(a, 'hx:sync', { code: created.code });
            assert.strictEqual(view.result, null, 'nobody flags in an empty room');
            assert.strictEqual(view.clock.remaining[0], 300, 'no time was spent');
            a.disconnect();
        } finally {
            TIME_CONTROLS.bullet.initialMs = original;
        }
    });

    await test('a disconnection starts an abandonment countdown', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });
        const heard = waitFor(a, 'hx:opponent');
        b.disconnect();
        const event = await heard;
        assert.strictEqual(event.joined, false);
        assert.strictEqual(event.graceMs, RECONNECT_GRACE_MS.none, 'grace matches the time control');
        assert.ok(event.msLeft > 0 && event.msLeft <= event.graceMs, 'a countdown is running');
        const view = await ask(a, 'hx:sync', { code: created.code });
        assert.ok(view.awaitingReturn, 'the room reports who it is waiting for');
        assert.strictEqual(view.awaitingReturn.seat, 1);
        a.disconnect();
    });

    await test('the countdown is called off when the player returns', async () => {
        const a = await open();
        let b = await open();
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });
        b.disconnect();
        await new Promise((r) => setTimeout(r, 120));
        b = await open();
        const back = await ask(b, 'hx:join', { code: created.code });
        assert.ok(back.ok, back.error);
        assert.strictEqual(back.awaitingReturn, null, 'no countdown left running');
        // And the game is still playable, not awarded away.
        await new Promise((r) => setTimeout(r, 350));
        const view = await ask(a, 'hx:sync', { code: created.code });
        assert.strictEqual(view.result, null, 'the game survived the round trip');
        a.disconnect();
        b.disconnect();
    });

    await test('running the countdown out awards the game to the opponent', async () => {
        const original = RECONNECT_GRACE_MS.none;
        RECONNECT_GRACE_MS.none = 250;                  // keep the test quick
        try {
            const a = await open();
            const b = await open();
            const created = await ask(a, 'hx:create', {});
            await ask(b, 'hx:join', { code: created.code });
            const ended = waitFor(a, 'hx:ended', 3000);
            b.disconnect();
            const event = await ended;
            assert.strictEqual(event.result.reason, 'abandoned');
            assert.strictEqual(event.result.winner, 0, 'the player still present wins');
            const after = await ask(a, 'hx:move', { code: created.code, intent: { type: 'tile', cell: 2080 } });
            assert.strictEqual(after.ok, false);
            assert.strictEqual(after.error, 'GAME_OVER');
            a.disconnect();
        } finally {
            RECONNECT_GRACE_MS.none = original;
        }
    });

    await test('leaving before the opponent arrives abandons nothing', async () => {
        const original = RECONNECT_GRACE_MS.none;
        RECONNECT_GRACE_MS.none = 200;
        try {
            const a = await open();
            const created = await ask(a, 'hx:create', {});   // nobody ever joined
            a.disconnect();
            await new Promise((r) => setTimeout(r, 500));
            const watcher = await open();
            const view = await ask(watcher, 'hx:sync', { code: created.code });
            assert.strictEqual(view.result, null, 'a game that never started cannot be abandoned');
            watcher.disconnect();
        } finally {
            RECONNECT_GRACE_MS.none = original;
        }
    });

    await test('a disconnection frees the seat and the player can return', async () => {
        const a = await open();
        let b = await open();
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });
        const heard = waitFor(a, 'hx:opponent');
        b.disconnect();
        const event = await heard;
        assert.strictEqual(event.joined, false);
        assert.strictEqual(event.seat, 1);
        b = await open();
        const back = await ask(b, 'hx:join', { code: created.code });
        assert.ok(back.ok, back.error);
        assert.strictEqual(back.colour, 1, 'the same seat is available again');
        assert.deepStrictEqual(back.state, created.state, 'the position survived');
        a.disconnect();
        b.disconnect();
    });

    /* ── Chat ─────────────────────────────────────────────────────────── */

    await test('the two seats can talk, and the room remembers', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });

        const heard = waitFor(b, 'hx:chat');
        const sent = await ask(a, 'hx:chat', { code: created.code, text: '  bien   joué  ' });
        assert.ok(sent.ok, sent.error);
        const event = await heard;
        assert.strictEqual(event.message.text, 'bien joué', 'whitespace tidied');
        assert.strictEqual(event.message.seat, 0);

        const view = await ask(b, 'hx:sync', { code: created.code });
        assert.strictEqual(view.chat.length, 1, 'kept for a player who reconnects');
        a.disconnect();
        b.disconnect();
    });

    await test('a passer-by holding the code cannot talk into the game', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });
        const stranger = await open();
        const response = await ask(stranger, 'hx:chat', { code: created.code, text: 'hello' });
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'NOT_A_PLAYER');
        stranger.disconnect();
        a.disconnect();
        b.disconnect();
    });

    /* ── Rematch ──────────────────────────────────────────────────────── */

    await test('a rematch needs both players, and swaps the colours', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', { timeControl: 'blitz' });
        await ask(b, 'hx:join', { code: created.code });
        await ask(a, 'hx:resign', { code: created.code });

        const offered = waitFor(b, 'hx:rematch:offer');
        const first = await ask(a, 'hx:rematch', { code: created.code });
        assert.strictEqual(first.ready, false, 'one player is only an offer');
        const offer = await offered;
        assert.strictEqual(offer.seat, 0, 'black asked');

        const ready = waitFor(a, 'hx:rematch:ready');
        const second = await ask(b, 'hx:rematch', { code: created.code });
        assert.strictEqual(second.ready, true);
        assert.ok(second.code && second.code !== created.code, 'a new room');
        const announced = await ready;
        assert.strictEqual(announced.next, second.code, 'and both are told which');

        // Colours swap: the one who was black joins as white.
        const seatB = await ask(b, 'hx:join', { code: second.code });
        const seatA = await ask(a, 'hx:join', { code: second.code });
        assert.strictEqual(seatB.colour, 0, 'white last time, black now');
        assert.strictEqual(seatA.colour, 1);
        assert.strictEqual(seatA.timeControl, 'blitz', 'the same cadence');
        a.disconnect();
        b.disconnect();
    });

    await test('asking twice does not open two rooms', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });
        await ask(a, 'hx:resign', { code: created.code });
        await ask(a, 'hx:rematch', { code: created.code });
        await ask(a, 'hx:rematch', { code: created.code });     // same player, again
        const agreed = await ask(b, 'hx:rematch', { code: created.code });
        const again = await ask(b, 'hx:rematch', { code: created.code });
        assert.strictEqual(again.code, agreed.code, 'the same new room');
        a.disconnect();
        b.disconnect();
    });

    await test('a rematch cannot be asked for mid-game', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });
        const response = await ask(a, 'hx:rematch', { code: created.code });
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'GAME_IN_PROGRESS');
        a.disconnect();
        b.disconnect();
    });

    await test('somebody can look in on a game without taking a seat', async () => {
        const a = await open();
        const b = await open();
        const eye = await open();
        const room = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: room.code });

        const seen = waitFor(a, 'hx:watchers');
        const view = await ask(eye, 'hx:watch', { code: room.code });
        assert.ok(view.ok, view.error);
        assert.strictEqual(view.watching, true, 'said plainly to be a look, not a seat');
        assert.strictEqual(view.colour, null, 'and it comes with no colour');
        assert.strictEqual(view.chat, undefined, 'what the players say is not sent here');
        const told = await seen;
        assert.strictEqual(told.n, 1, 'the players are told they are watched');

        /* The moves arrive. This is the whole point: a room is a broadcast,
           and a spectator is simply in it. */
        const heard = waitFor(eye, 'hx:moved');
        await ask(a, 'hx:move', { code: room.code, intent: await legalIntent(room.state) });
        const move = await heard;
        assert.strictEqual(move.code, room.code, 'the spectator saw it');

        a.disconnect();
        b.disconnect();
        eye.disconnect();
    });

    await test('a spectator cannot play, resign, chat or ask for a rematch', async () => {
        const a = await open();
        const b = await open();
        const eye = await open();
        const room = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: room.code });
        await ask(eye, 'hx:watch', { code: room.code });

        const intent = await legalIntent(room.state);
        for (const [event, payload] of [
            ['hx:move', { code: room.code, intent }],
            ['hx:resign', { code: room.code }],
            ['hx:chat', { code: room.code, text: 'hello' }],
            ['hx:rematch', { code: room.code }],
        ]) {
            const refused = await ask(eye, event, payload);
            assert.strictEqual(refused.ok, false, event + ' was refused');
            assert.strictEqual(refused.error, 'NOT_A_PLAYER', event + ' said why');
        }

        a.disconnect();
        b.disconnect();
        eye.disconnect();
    });

    await test('what the players say does not reach the people watching', async () => {
        /* The chat used to go to the whole socket.io room, and a spectator is
           in that room. It is addressed to the two seats now. */
        const a = await open();
        const b = await open();
        const eye = await open();
        const room = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: room.code });
        await ask(eye, 'hx:watch', { code: room.code });

        let leaked = false;
        eye.on('hx:chat', () => { leaked = true; });
        const heard = waitFor(b, 'hx:chat');
        await ask(a, 'hx:chat', { code: room.code, text: 'entre nous' });
        const message = await heard;
        assert.strictEqual(message.message.text, 'entre nous', 'the other player heard it');
        await new Promise((r) => setTimeout(r, 250));
        assert.strictEqual(leaked, false, 'and nobody else did');

        a.disconnect();
        b.disconnect();
        eye.disconnect();
    });

    await test('leaving takes you off the count', async () => {
        const a = await open();
        const b = await open();
        const eye = await open();
        const room = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: room.code });
        await ask(eye, 'hx:watch', { code: room.code });

        const dropped = waitFor(a, 'hx:watchers');
        await ask(eye, 'hx:unwatch', { code: room.code });
        assert.strictEqual((await dropped).n, 0, 'the players are told');

        // And a disconnection counts as leaving, since nothing else will say so.
        const other = await open();
        const back = waitFor(a, 'hx:watchers');
        await ask(other, 'hx:watch', { code: room.code });
        assert.strictEqual((await back).n, 1);
        const gone = waitFor(a, 'hx:watchers');
        other.disconnect();
        assert.strictEqual((await gone).n, 0, 'a closed tab is not a spectator');

        a.disconnect();
        b.disconnect();
        eye.disconnect();
    });

    await test('a player cannot watch the game they are sitting at', async () => {
        const a = await open();
        const b = await open();
        const room = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: room.code });
        const refused = await ask(a, 'hx:watch', { code: room.code });
        assert.strictEqual(refused.ok, false);
        assert.strictEqual(refused.error, 'ALREADY_PLAYING');
        a.disconnect();
        b.disconnect();
    });

    await test('a game can end level by agreement', async () => {
        const a = await open();
        const b = await open();
        const room = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: room.code });

        const asked = waitFor(b, 'hx:draw:offer');
        const offered = await ask(a, 'hx:draw', { code: room.code });
        assert.strictEqual(offered.offered, true, 'offered, not agreed');
        assert.strictEqual((await asked).seat, 0, 'and the other side is asked');

        const ended = waitFor(a, 'hx:ended');
        const taken = await ask(b, 'hx:draw', { code: room.code });
        assert.strictEqual(taken.agreed, true, 'the same event takes it up');
        const result = await ended;
        assert.strictEqual(result.result.winner, null, 'nobody won');
        assert.strictEqual(result.result.reason, 'agreed');

        a.disconnect();
        b.disconnect();
    });

    await test('playing on takes your own offer off the table', async () => {
        /* An offer left standing from twenty plies ago is a trap rather than
           an offer: whoever made it has since decided to play. */
        const a = await open();
        const b = await open();
        const room = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: room.code });
        await ask(a, 'hx:draw', { code: room.code });

        const withdrawn = waitFor(b, 'hx:draw:declined');
        await ask(a, 'hx:move', { code: room.code, intent: await legalIntent(room.state) });
        assert.strictEqual((await withdrawn).withdrawn, true, 'the other side is told');

        // And taking it up now offers rather than agrees, since there is
        // nothing left on the table.
        const late = await ask(b, 'hx:draw', { code: room.code });
        assert.strictEqual(late.agreed, undefined, 'no game was ended by it');
        assert.strictEqual(late.offered, true, 'it is a fresh offer from the other side');

        a.disconnect();
        b.disconnect();
    });

    await test('an offer can be refused, and the game goes on', async () => {
        const a = await open();
        const b = await open();
        const room = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: room.code });
        await ask(a, 'hx:draw', { code: room.code });

        const told = waitFor(a, 'hx:draw:declined');
        await ask(b, 'hx:draw:decline', { code: room.code });
        assert.strictEqual((await told).withdrawn, false, 'refused rather than withdrawn');

        const played = await ask(a, 'hx:move', { code: room.code, intent: await legalIntent(room.state) });
        assert.strictEqual(played.ok, true, 'the game is still live');

        a.disconnect();
        b.disconnect();
    });

    await test('a spectator cannot offer or refuse a draw', async () => {
        const a = await open();
        const b = await open();
        const eye = await open();
        const room = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: room.code });
        await ask(eye, 'hx:watch', { code: room.code });
        for (const event of ['hx:draw', 'hx:draw:decline']) {
            const refused = await ask(eye, event, { code: room.code });
            assert.strictEqual(refused.ok, false, event + ' was refused');
            assert.strictEqual(refused.error, 'NOT_A_PLAYER');
        }
        a.disconnect();
        b.disconnect();
        eye.disconnect();
    });

    await test('stepping away frees the seat and starts the countdown', async () => {
        /* Going elsewhere in the site is not the same as sitting there in
           silence: the opponent was left waiting for somebody who had gone. */
        const a = await open();
        const b = await open();
        const room = await ask(a, 'hx:create', { timeControl: 'bullet' });
        await ask(b, 'hx:join', { code: room.code });

        const told = waitFor(b, 'hx:opponent');
        await ask(a, 'hx:leave', { code: room.code });
        const event = await told;
        assert.strictEqual(event.joined, false, 'they are away');
        assert.ok(event.msLeft > 0, 'and the clock on their return is running');

        // Coming back calls it off, and the seat is theirs again.
        const back = waitFor(b, 'hx:opponent');
        const rejoined = await ask(a, 'hx:join', { code: room.code });
        assert.strictEqual(rejoined.colour, 0, 'the same seat');
        assert.strictEqual((await back).joined, true, 'and the other side is told');

        a.disconnect();
        b.disconnect();
    });

    await test('a room nobody joined can be called off', async () => {
        /* Leaving would free the seat and leave the room standing, so whoever
           followed the link afterwards would sit down opposite nobody. */
        const a = await open();
        const b = await open();
        const room = await ask(a, 'hx:create', {});
        const cancelled = await ask(a, 'hx:cancel', { code: room.code });
        assert.strictEqual(cancelled.ok, true);

        const late = await ask(b, 'hx:join', { code: room.code });
        assert.strictEqual(late.ok, false, 'the link leads nowhere now');
        assert.strictEqual(late.error, 'NO_SUCH_ROOM');
        a.disconnect();
        b.disconnect();
    });

    await test('a game that has started cannot be called off', async () => {
        const a = await open();
        const b = await open();
        const room = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: room.code });
        const refused = await ask(a, 'hx:cancel', { code: room.code });
        assert.strictEqual(refused.ok, false, 'there is a game to protect now');
        assert.strictEqual(refused.error, 'ALREADY_STARTED');
        a.disconnect();
        b.disconnect();
    });

    await test('declining a rematch clears the offer', async () => {
        const a = await open();
        const b = await open();
        const created = await ask(a, 'hx:create', {});
        await ask(b, 'hx:join', { code: created.code });
        await ask(a, 'hx:resign', { code: created.code });
        await ask(a, 'hx:rematch', { code: created.code });
        const told = waitFor(a, 'hx:rematch:declined');
        await ask(b, 'hx:rematch:decline', { code: created.code });
        await told;
        const view = await ask(a, 'hx:sync', { code: created.code });
        assert.strictEqual(view.rematchOfferedBy, null, 'nothing left on the table');
        a.disconnect();
        b.disconnect();
    });

    black.disconnect();
    white.disconnect();
    io.close();
    server.close();

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

const MIN_WAIT = 160;   // just over the server's per-socket move throttle

run().catch((error) => {
    console.error('harness crashed:', error);
    process.exit(1);
});
