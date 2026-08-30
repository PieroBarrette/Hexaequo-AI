/**
 * The lobby: presence, chat and challenges.
 *
 * Run with: node tests/lobby.test.js
 */

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { pool, query } = require('../config/database');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/env');
const { attachOnlineGames, rooms } = require('../socket/onlineGame');
const lobby = require('../socket/lobby');

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

async function makeUser(tag, elo = 1000) {
    await query('DELETE FROM users WHERE email = $1', [`lobby-test-${tag}@example.invalid`]);
    const { rows } = await query(
        `INSERT INTO users (email, pseudo, google_id, elo, email_verified, pseudo_chosen)
         VALUES ($1,$2,$3,$4,TRUE,TRUE) RETURNING *`,
        [`lobby-test-${tag}@example.invalid`, `LobbyTest${tag}`, `lobby-test-${tag}`, elo]
    );
    users.add(rows[0].id);
    return {
        user: rows[0],
        token: jwt.sign({ userId: rows[0].id, email: rows[0].email, pseudo: rows[0].pseudo },
            JWT_SECRET, { expiresIn: JWT_EXPIRES_IN || '1h' }),
    };
}

async function run() {
    const server = http.createServer();
    const io = new Server(server, { cors: { origin: '*' } });
    attachOnlineGames(io);
    lobby.attachLobby(io);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const open = () => new Promise((resolve, reject) => {
        const socket = connect(url, { transports: ['websocket'], forceNew: true });
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', reject);
    });
    const reset = () => {
        lobby.present.clear();
        lobby.challenges.clear();
        lobby.agreements.clear();
        lobby.chat.length = 0;
    };

    console.log('\nLobby\n');

    await test('anyone may read the lobby; only a name goes on the list', async () => {
        /* Reading who is about and what is being said asks for nothing — it is
           most of what makes the site look inhabited, and a visitor with no
           account can still watch a game or open a private one. Writing, and
           being on the list to be challenged, need a name. */
        reset();
        const named = await makeUser('aa');
        const known = await open();
        await ask(known, 'hx:identify', { token: named.token });
        await ask(known, 'hx:lobby:enter', {});

        const stranger = await open();
        const response = await ask(stranger, 'hx:lobby:enter', {});
        assert.strictEqual(response.ok, true, 'the door is open');
        assert.strictEqual(response.you, null, 'but they are nobody in particular');
        assert.strictEqual(response.players.length, 1, 'and are not on the list');
        assert.ok(Array.isArray(response.chat), 'the conversation is readable');

        const refused = await ask(stranger, 'hx:lobby:chat', { text: 'hello' });
        assert.strictEqual(refused.ok, false, 'saying something is not');
        assert.strictEqual(refused.error, 'SIGN_IN_REQUIRED');

        /* And they hear what is said, which is the point of letting them in. */
        const heard = waitFor(stranger, 'hx:lobby:chat');
        await ask(known, 'hx:lobby:chat', { text: 'bonsoir' });
        assert.strictEqual((await heard).message.text, 'bonsoir');

        known.disconnect();
        stranger.disconnect();
    });

    await test('entering shows you who else is here', async () => {
        reset();
        const one = await makeUser('a', 1400);
        const two = await makeUser('b', 1100);
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(b, 'hx:identify', { token: two.token });

        const first = await ask(a, 'hx:lobby:enter', {});
        assert.ok(first.ok);
        assert.strictEqual(first.players.length, 1, 'alone at first');

        const second = await ask(b, 'hx:lobby:enter', {});
        assert.strictEqual(second.players.length, 2);
        assert.deepStrictEqual(second.players.map((p) => p.pseudo),
            [one.user.pseudo, two.user.pseudo], 'strongest first');
        assert.ok(!('email' in second.players[0]), 'no addresses in the roster');
        a.disconnect();
        b.disconnect();
    });

    await test('leaving takes you off the list', async () => {
        reset();
        const one = await makeUser('c');
        const a = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(a, 'hx:lobby:enter', {});
        assert.strictEqual(lobby.present.size, 1);
        await ask(a, 'hx:lobby:leave', {});
        assert.strictEqual(lobby.present.size, 0);
        a.disconnect();
    });

    await test('disconnecting takes you off it too', async () => {
        reset();
        const one = await makeUser('d');
        const a = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(a, 'hx:lobby:enter', {});
        a.disconnect();
        await new Promise((r) => setTimeout(r, 400));
        assert.strictEqual(lobby.present.size, 0);
    });

    await test('the chat reaches the room and is kept for latecomers', async () => {
        reset();
        const one = await makeUser('e');
        const two = await makeUser('f');
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(b, 'hx:identify', { token: two.token });
        await ask(a, 'hx:lobby:enter', {});
        await ask(b, 'hx:lobby:enter', {});

        const heard = waitFor(b, 'hx:lobby:chat');
        const sent = await ask(a, 'hx:lobby:chat', { text: '  bonjour   tout le monde  ' });
        assert.ok(sent.ok, sent.error);
        const event = await heard;
        assert.strictEqual(event.message.text, 'bonjour tout le monde', 'whitespace tidied');
        assert.strictEqual(event.message.pseudo, one.user.pseudo);

        // Someone arriving now reads what was said.
        const c = await open();
        const three = await makeUser('g');
        await ask(c, 'hx:identify', { token: three.token });
        const arrival = await ask(c, 'hx:lobby:enter', {});
        assert.strictEqual(arrival.chat.length, 1);
        assert.strictEqual(arrival.chat[0].text, 'bonjour tout le monde');
        a.disconnect();
        b.disconnect();
        c.disconnect();
    });

    await test('the conversation survives the server being restarted', async () => {
        reset();
        await query("DELETE FROM lobby_messages WHERE pseudo LIKE 'LobbyTest%'");
        const one = await makeUser('v');
        const a = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(a, 'hx:lobby:enter', {});
        const sent = await ask(a, 'hx:lobby:chat', { text: 'toujours là demain' });
        assert.ok(sent.ok, sent.error);

        /* The write is deliberately not awaited by the server — saying a thing
           should not wait on a disk — so wait for it here. */
        let stored = 0;
        for (let i = 0; i < 40 && !stored; i++) {
            stored = (await query(
                "SELECT count(*)::int n FROM lobby_messages WHERE pseudo = $1", [one.user.pseudo]
            )).rows[0].n;
            if (!stored) await new Promise((r) => setTimeout(r, 150));
        }

        /* What a restart looks like from here: the memory is gone, and the
           only thing left is what was written down. Before this, a deploy or
           an idle spin-down silently erased the room's history. */
        lobby.chat.length = 0;
        await lobby.loadChat();
        const kept = lobby.chat.filter((m) => m.pseudo === one.user.pseudo);
        assert.strictEqual(kept.length, 1, 'the message was written down');
        assert.strictEqual(kept[0].text, 'toujours là demain');

        // And somebody arriving after the restart is given it.
        const b = await open();
        const two = await makeUser('w');
        await ask(b, 'hx:identify', { token: two.token });
        const arrival = await ask(b, 'hx:lobby:enter', {});
        assert.ok(arrival.chat.some((m) => m.text === 'toujours là demain'),
            'and handed to whoever arrives next');
        await query("DELETE FROM lobby_messages WHERE pseudo LIKE 'LobbyTest%'");
        a.disconnect();
        b.disconnect();
    });

    await test('an empty message is not a message', async () => {
        reset();
        const one = await makeUser('h');
        const a = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(a, 'hx:lobby:enter', {});
        const response = await ask(a, 'hx:lobby:chat', { text: '    ' });
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'EMPTY');
        a.disconnect();
    });

    await test('a challenge reaches its target and opens a room when accepted', async () => {
        reset();
        const one = await makeUser('i', 1200);
        const two = await makeUser('j', 1300);
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(b, 'hx:identify', { token: two.token });
        await ask(a, 'hx:lobby:enter', {});
        await ask(b, 'hx:lobby:enter', {});

        const incoming = waitFor(b, 'hx:challenge:incoming');
        const sent = await ask(a, 'hx:challenge', { userId: two.user.id, timeControl: 'blitz' });
        assert.ok(sent.ok, sent.error);
        const invitation = await incoming;
        assert.strictEqual(invitation.from.pseudo, one.user.pseudo);
        assert.strictEqual(invitation.timeControl, 'blitz');

        const readyA = waitFor(a, 'hx:challenge:ready');
        const readyB = waitFor(b, 'hx:challenge:ready');
        await ask(b, 'hx:challenge:accept', { id: invitation.id });
        const [eventA, eventB] = await Promise.all([readyA, readyB]);
        assert.strictEqual(eventA.code, eventB.code);
        assert.notStrictEqual(eventA.colour, eventB.colour, 'opposite colours');
        assert.strictEqual(eventA.timeControl, 'blitz', 'the cadence that was offered');
        assert.strictEqual(lobby.challenges.size, 0, 'the invitation is spent');

        const joinedA = await ask(a, 'hx:join', { code: eventA.code });
        const joinedB = await ask(b, 'hx:join', { code: eventB.code });
        assert.strictEqual(joinedA.colour, eventA.colour, 'the seat that was promised');
        assert.strictEqual(joinedB.rated, true);
        a.disconnect();
        b.disconnect();
    });

    await test('only the person challenged can accept', async () => {
        reset();
        const one = await makeUser('k');
        const two = await makeUser('l');
        const three = await makeUser('m');
        const [a, b, c] = [await open(), await open(), await open()];
        await ask(a, 'hx:identify', { token: one.token });
        await ask(b, 'hx:identify', { token: two.token });
        await ask(c, 'hx:identify', { token: three.token });
        for (const s of [a, b, c]) await ask(s, 'hx:lobby:enter', {});

        const sent = await ask(a, 'hx:challenge', { userId: two.user.id, timeControl: 'rapid' });
        const stolen = await ask(c, 'hx:challenge:accept', { id: sent.id });
        assert.strictEqual(stolen.ok, false);
        assert.strictEqual(stolen.error, 'NOT_YOURS');
        assert.strictEqual(lobby.challenges.size, 1, 'and the invitation still stands');
        a.disconnect(); b.disconnect(); c.disconnect();
    });

    await test('declining tells the challenger', async () => {
        reset();
        const one = await makeUser('n');
        const two = await makeUser('o');
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(b, 'hx:identify', { token: two.token });
        await ask(a, 'hx:lobby:enter', {});
        await ask(b, 'hx:lobby:enter', {});

        const sent = await ask(a, 'hx:challenge', { userId: two.user.id, timeControl: 'rapid' });
        const told = waitFor(a, 'hx:challenge:declined');
        await ask(b, 'hx:challenge:decline', { id: sent.id });
        const event = await told;
        assert.strictEqual(event.id, sent.id);
        assert.strictEqual(lobby.challenges.size, 0);
        a.disconnect();
        b.disconnect();
    });

    await test('challenging the same player twice does not send two invitations', async () => {
        reset();
        const one = await makeUser('p');
        const two = await makeUser('q');
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(b, 'hx:identify', { token: two.token });
        await ask(a, 'hx:lobby:enter', {});
        await ask(b, 'hx:lobby:enter', {});
        const first = await ask(a, 'hx:challenge', { userId: two.user.id, timeControl: 'rapid' });
        const again = await ask(a, 'hx:challenge', { userId: two.user.id, timeControl: 'rapid' });
        assert.strictEqual(again.id, first.id, 'the same invitation');
        assert.strictEqual(lobby.challenges.size, 1);
        a.disconnect();
        b.disconnect();
    });

    await test('leaving the lobby does not put you out of reach', async () => {
        /* Presence is the site, not the room: somebody reading their own
           profile page is still somebody you can ask for a game. */
        reset();
        const one = await makeUser('r');
        const two = await makeUser('s');
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(b, 'hx:identify', { token: two.token });
        await ask(a, 'hx:lobby:enter', {});
        await ask(b, 'hx:lobby:enter', {});
        await ask(b, 'hx:lobby:leave', {});
        assert.strictEqual(lobby.present.has(two.user.id), false, 'gone from the roster');

        const heard = waitFor(b, 'hx:challenge:incoming');
        const response = await ask(a, 'hx:challenge', { userId: two.user.id, timeControl: 'rapid' });
        assert.ok(response.ok, response.error);
        const event = await heard;
        assert.strictEqual(event.from.pseudo, one.user.pseudo, 'and still reachable');
        assert.strictEqual(event.busy, false, 'they are free to play now');
        a.disconnect();
        b.disconnect();
    });

    await test('you cannot challenge someone who has gone', async () => {
        reset();
        const one = await makeUser('v');
        const two = await makeUser('w');
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(b, 'hx:identify', { token: two.token });
        await ask(a, 'hx:lobby:enter', {});
        b.disconnect();
        await new Promise((r) => setTimeout(r, 300));
        const response = await ask(a, 'hx:challenge', { userId: two.user.id, timeControl: 'rapid' });
        assert.strictEqual(response.ok, false);
        assert.strictEqual(response.error, 'NOT_HERE');
        a.disconnect();
    });

    await test('a player at another board can agree to play next', async () => {
        /* An amber light is not a closed door. Accepting mid-game schedules
           the room rather than opening it, and it opens by itself the moment
           the board they are at clears. */
        reset();
        const one = await makeUser('x');
        const two = await makeUser('y');
        const three = await makeUser('z');
        const a = await open();
        const b = await open();
        const c = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(b, 'hx:identify', { token: two.token });
        await ask(c, 'hx:identify', { token: three.token });

        // Two of them sit down to a game; the third asks one of them for one.
        const busyRoom = await ask(a, 'hx:create', { timeControl: 'none' });
        await ask(b, 'hx:join', { code: busyRoom.code });

        const asked = waitFor(a, 'hx:challenge:incoming');
        const sent = await ask(c, 'hx:challenge', { userId: one.user.id, timeControl: 'rapid' });
        assert.ok(sent.ok, sent.error);
        assert.strictEqual(sent.busy, true, 'the challenger is told they are at a board');
        const incoming = await asked;
        assert.strictEqual(incoming.busy, true, 'and so is the person asked');

        const agreedByChallenger = waitFor(c, 'hx:challenge:agreed');
        const accepted = await ask(a, 'hx:challenge:accept', { id: incoming.id });
        assert.strictEqual(accepted.ok, true);
        assert.strictEqual(accepted.deferred, true, 'said yes, but not yet');
        const deal = await agreedByChallenger;
        assert.strictEqual(deal.opponent.pseudo, one.user.pseudo);
        assert.strictEqual(lobby.agreements.size, 1, 'held, not spent');

        // The board clears, and the agreed game opens on its own.
        const readyForBoth = Promise.all([waitFor(a, 'hx:challenge:ready'), waitFor(c, 'hx:challenge:ready')]);
        await ask(a, 'hx:resign', { code: busyRoom.code });
        const [forOne, forThree] = await readyForBoth;
        assert.strictEqual(forOne.code, forThree.code, 'the same room');
        assert.notStrictEqual(forOne.colour, forThree.colour, 'one of each colour');
        assert.strictEqual(lobby.agreements.size, 0, 'and the agreement is spent');

        rooms.delete(busyRoom.code);
        rooms.delete(forOne.code);
        a.disconnect();
        b.disconnect();
        c.disconnect();
    });

    await test('one invitation at a time, in both directions', async () => {
        reset();
        const one = await makeUser('aa');
        const two = await makeUser('ab');
        const three = await makeUser('ac');
        const a = await open();
        const b = await open();
        const c = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(b, 'hx:identify', { token: two.token });
        await ask(c, 'hx:identify', { token: three.token });

        const first = await ask(a, 'hx:challenge', { userId: two.user.id, timeControl: 'rapid' });
        assert.ok(first.ok, first.error);

        // The same person again is the same invitation, not a second one.
        const again = await ask(a, 'hx:challenge', { userId: two.user.id, timeControl: 'rapid' });
        assert.strictEqual(again.resent, true);
        assert.strictEqual(lobby.challenges.size, 1);

        // Somebody else while one is outstanding: no.
        const other = await ask(a, 'hx:challenge', { userId: three.user.id, timeControl: 'rapid' });
        assert.strictEqual(other.ok, false);
        assert.strictEqual(other.error, 'ALREADY_ASKING');

        // And nobody else may ask the person already being asked.
        const piling = await ask(c, 'hx:challenge', { userId: two.user.id, timeControl: 'rapid' });
        assert.strictEqual(piling.ok, false);
        assert.strictEqual(piling.error, 'ALREADY_ASKED');

        a.disconnect();
        b.disconnect();
        c.disconnect();
    });

    await test('the roster says who is in a game', async () => {
        reset();
        const one = await makeUser('t');
        const two = await makeUser('u');
        const a = await open();
        const b = await open();
        await ask(a, 'hx:identify', { token: one.token });
        await ask(b, 'hx:identify', { token: two.token });
        await ask(a, 'hx:lobby:enter', {});
        await ask(b, 'hx:lobby:enter', {});
        assert.ok(lobby.roster().every((p) => !p.playing), 'nobody is playing yet');

        const created = await ask(a, 'hx:create', { timeControl: 'none' });
        await ask(b, 'hx:join', { code: created.code });
        const busy = lobby.roster();
        assert.ok(busy.every((p) => p.playing), 'both are now in a game');

        // And a finished game frees them again.
        await ask(a, 'hx:resign', { code: created.code });
        assert.ok(lobby.roster().every((p) => !p.playing), 'the game is over');
        rooms.delete(created.code);
        a.disconnect();
        b.disconnect();
    });

    reset();
    for (const id of users) await query('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
    const left = await query(
        "SELECT count(*)::int AS n FROM users WHERE email LIKE 'lobby-test-%@example.invalid'");
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
