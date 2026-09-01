/**
 * Quick match: pairing by rating band.
 *
 * Run with: node tests/matchmaking.test.js
 *
 * The band logic is pure and tested directly; the pairing itself runs over real
 * sockets, because what matters is that two players actually end up in the same
 * room, on opposite colours, with the game rated.
 */

// Before anything else: a database of its own, or nothing at all.
// See tests/database.js.
require('./database').requireThrowaway('matchmaking.test.js');


const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { pool, query } = require('../config/database');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/env');
const { attachOnlineGames, rooms } = require('../socket/onlineGame');
const mm = require('../socket/matchmaking');

let passed = 0;
let failed = 0;
const users = new Set();

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

function ask(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 8000);
        socket.emit(event, payload, (response) => { clearTimeout(timer); resolve(response); });
    });
}

function waitFor(socket, event, ms = 8000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${event}`)), ms);
        socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
    });
}

async function makeUser(tag, elo) {
    // An interrupted run leaves its rows behind; clear the way so the next one
    // fails on the code, not on a unique address.
    await query('DELETE FROM users WHERE email = $1', [`mm-test-${tag}@example.invalid`]);
    const { rows } = await query(
        `INSERT INTO users (email, pseudo, google_id, elo, email_verified, pseudo_chosen)
         VALUES ($1,$2,$3,$4,TRUE,TRUE) RETURNING *`,
        [`mm-test-${tag}@example.invalid`, `MMTest${tag}`, `mm-test-${tag}`, elo]
    );
    users.add(rows[0].id);
    return {
        user: rows[0],
        token: jwt.sign({ userId: rows[0].id, email: rows[0].email, pseudo: rows[0].pseudo },
            JWT_SECRET, { expiresIn: JWT_EXPIRES_IN || '1h' }),
    };
}

const entry = (elo, waitedMs = 0, timeControl = 'rapid', userId = String(Math.random())) => ({
    userId, elo, timeControl, joinedAt: Date.now() - waitedMs, pseudo: 'x', socketId: 's',
});

async function run() {
    console.log('\nQuick match\n');

    /* ── The band, on its own ─────────────────────────────────────────── */

    await test('the band starts narrow and widens with waiting', async () => {
        const fresh = entry(1000, 0);
        assert.strictEqual(mm.bandFor(fresh), mm.START_BAND);
        const waited = entry(1000, mm.STEP_MS * 3 + 100);
        assert.strictEqual(mm.bandFor(waited), mm.START_BAND + 3 * mm.WIDEN_PER_STEP);
    });

    await test('the band stops widening at the cap', async () => {
        assert.strictEqual(mm.bandFor(entry(1000, mm.STEP_MS * 1000)), mm.MAX_BAND);
    });

    await test('pairing needs both players to accept the gap', async () => {
        const now = Date.now();
        // 250 apart: too far for someone who just arrived...
        assert.strictEqual(mm.compatible(entry(1000, 0), entry(1250, 0), now), false);
        // ...but fine once one of them has waited, if the other has too.
        const patientA = entry(1000, mm.STEP_MS * 4);
        const patientB = entry(1250, mm.STEP_MS * 4);
        assert.strictEqual(mm.compatible(patientA, patientB, now), true);
        // One-sided patience is not enough: the newcomer has not agreed.
        assert.strictEqual(mm.compatible(patientA, entry(1250, 0), now), false);
    });

    await test('different cadences never meet', async () => {
        const now = Date.now();
        const a = entry(1000, mm.STEP_MS * 100, 'blitz');
        const b = entry(1000, mm.STEP_MS * 100, 'rapid');
        assert.strictEqual(mm.compatible(a, b, now), false);
    });

    await test('the closest rating wins among those who fit', async () => {
        mm.queue.clear();
        const waiting = entry(1000, mm.STEP_MS * 6, 'rapid', 'u-waiting');
        const near = entry(1030, mm.STEP_MS * 6, 'rapid', 'u-near');
        const far = entry(1290, mm.STEP_MS * 6, 'rapid', 'u-far');
        mm.queue.set(waiting.userId, waiting);
        mm.queue.set(far.userId, far);      // inserted before the near one
        mm.queue.set(near.userId, near);
        const pair = mm.findPair(Date.now());
        assert.ok(pair, 'a pair was found');
        const ids = pair.map((p) => p.userId).sort();
        assert.deepStrictEqual(ids, ['u-near', 'u-waiting'], `got ${ids.join(',')}`);
        mm.queue.clear();
    });

    /* ── Over real sockets ────────────────────────────────────────────── */

    const server = http.createServer();
    const io = new Server(server, { cors: { origin: '*' } });
    attachOnlineGames(io);
    mm.attachMatchmaking(io);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const open = () => new Promise((resolve, reject) => {
        const socket = connect(url, { transports: ['websocket'], forceNew: true });
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', reject);
    });

    await test('queueing without an account is refused', async () => {
        const a = await open();
        const response = await ask(a, 'hx:queue', { timeControl: 'rapid' });
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'SIGN_IN_REQUIRED');
        a.disconnect();
    });

    await test('two close ratings are paired into one room, on opposite colours', async () => {
        mm.queue.clear();
        const one = await makeUser('a', 1000);
        const two = await makeUser('b', 1040);
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(b, 'hx:identify', { token: two.token });

        const matchedA = waitFor(a, 'hx:matched', 10000);
        const matchedB = waitFor(b, 'hx:matched', 10000);
        await ask(a, 'hx:queue', { timeControl: 'rapid' });
        await ask(b, 'hx:queue', { timeControl: 'rapid' });

        const [eventA, eventB] = await Promise.all([matchedA, matchedB]);
        assert.strictEqual(eventA.code, eventB.code, 'the same room');
        assert.notStrictEqual(eventA.colour, eventB.colour, 'opposite colours');
        assert.strictEqual(eventA.opponent.pseudo, two.user.pseudo);
        assert.strictEqual(eventB.opponent.pseudo, one.user.pseudo);
        assert.strictEqual(mm.queue.size, 0, 'both left the queue');

        // And the room they were sent to is a real, rated one.
        const joinedA = await ask(a, 'hx:join', { code: eventA.code });
        const joinedB = await ask(b, 'hx:join', { code: eventB.code });
        assert.ok(joinedA.ok && joinedB.ok, 'both could take their seat');
        assert.strictEqual(joinedA.colour, eventA.colour, 'the seat they were promised');
        assert.strictEqual(joinedB.rated, true, 'and the game counts');
        a.disconnect();
        b.disconnect();
    });

    await test('a stranger cannot walk into a paired game', async () => {
        mm.queue.clear();
        const one = await makeUser('c', 1000);
        const two = await makeUser('d', 1010);
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(b, 'hx:identify', { token: two.token });
        const matched = waitFor(a, 'hx:matched', 10000);
        await ask(a, 'hx:queue', { timeControl: 'blitz' });
        await ask(b, 'hx:queue', { timeControl: 'blitz' });
        const event = await matched;

        const stranger = await open();
        const refused = await ask(stranger, 'hx:join', { code: event.code });
        assert.strictEqual(refused.ok, false);
        assert.strictEqual(refused.error, 'ROOM_FULL', 'the seats have names on them');
        stranger.disconnect();
        a.disconnect();
        b.disconnect();
    });

    await test('ratings far apart wait rather than being thrown together', async () => {
        mm.queue.clear();
        const weak = await makeUser('e', 800);
        const strong = await makeUser('f', 2000);
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: weak.token });
        await ask(b, 'hx:identify', { token: strong.token });
        await ask(a, 'hx:queue', { timeControl: 'classic' });
        await ask(b, 'hx:queue', { timeControl: 'classic' });

        let matched = false;
        a.once('hx:matched', () => { matched = true; });
        await new Promise((r) => setTimeout(r, 2500));
        assert.strictEqual(matched, false, '1200 points apart should not pair immediately');
        assert.strictEqual(mm.queue.size, 2, 'both are still waiting');

        // The band opens one step at a time; wait past the first one before
        // expecting it to have moved.
        await new Promise((r) => setTimeout(r, mm.STEP_MS + 400));
        const status = await ask(a, 'hx:queue:status', {});
        assert.ok(status.band > mm.START_BAND, `band should have widened, got ${status.band}`);
        assert.ok(status.waitingMs > mm.STEP_MS, 'and the wait is reported');
        a.disconnect();
        b.disconnect();
        mm.queue.clear();
    });

    await test('leaving the queue takes you out of it', async () => {
        mm.queue.clear();
        const solo = await makeUser('g', 1000);
        const a = await open();
        await ask(a, 'hx:identify', { token: solo.token });
        await ask(a, 'hx:queue', { timeControl: 'rapid' });
        assert.strictEqual(mm.queue.size, 1);
        const left = await ask(a, 'hx:queue:leave', {});
        assert.strictEqual(left.inQueue, false);
        assert.strictEqual(mm.queue.size, 0);
        a.disconnect();
    });

    await test('disconnecting takes you out of it too', async () => {
        mm.queue.clear();
        const solo = await makeUser('h', 1000);
        const a = await open();
        await ask(a, 'hx:identify', { token: solo.token });
        await ask(a, 'hx:queue', { timeControl: 'rapid' });
        assert.strictEqual(mm.queue.size, 1);
        a.disconnect();
        await new Promise((r) => setTimeout(r, 400));
        assert.strictEqual(mm.queue.size, 0, 'the slot was released');
    });

    mm.queue.clear();
    for (const id of users) await query('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
    const left = await query(
        "SELECT count(*)::int AS n FROM users WHERE email LIKE 'mm-test-%@example.invalid'");
    console.log(`\ncleanup: ${left.rows[0].n} test row(s) left behind`);

    io.close();
    server.close();
    await pool.end();
    console.log(`${passed} passed, ${failed} failed\n`);
    process.exit(failed || left.rows[0].n ? 1 : 0);
}

run().catch((error) => {
    console.error('harness crashed:', error);
    process.exit(1);
});
