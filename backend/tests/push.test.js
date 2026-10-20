/**
 * Notifications, from the event that causes one to the bytes a phone receives.
 *
 * Run with: node tests/push.test.js
 *
 * No database: subscriptions are kept in memory (the model's own fallback),
 * the two accounts are answered the way onlineGame.test.js answers them, and
 * the push service is a small HTTP server on 127.0.0.1 standing in for
 * Google's or Apple's. What arrives there is encrypted exactly as a real one
 * would be, so every message is decrypted here with the receiving device's own
 * key before it is read — which is the only honest way to say what a phone
 * would have shown.
 */

require('./database').none();

const database = require('../config/database');
const KNOWN = new Map([
    ['acct-amelie', { id: 'acct-amelie', pseudo: 'Amelie', elo: 1200, games_played: 4 }],
    ['acct-bertrand', { id: 'acct-bertrand', pseudo: 'Bertrand', elo: 1180, games_played: 9 }],
]);
const realQuery = database.query;
database.query = (sql, params) => {
    if (/FROM users WHERE id = \$1/.test(sql) && KNOWN.has(params && params[0])) {
        return Promise.resolve({ rows: [KNOWN.get(params[0])] });
    }
    // The chat's lookup of names said after an "@".
    if (/LOWER\(pseudo\) = ANY/.test(sql)) {
        const wanted = new Set(params[0]);
        return Promise.resolve({
            rows: [...KNOWN.values()].filter((a) => wanted.has(a.pseudo.toLowerCase())),
        });
    }
    return realQuery(sql, params);
};

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const ece = require('http_ece');
const webpush = require('web-push');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');

const push = require('../services/pushService');
const Subscriptions = require('../models/pushSubscriptionModel');
const reminders = require('../services/reminderService');
const { attachOnlineGames } = require('../socket/onlineGame');
const { attachLobby, NOTIFIED_CHALLENGE_TTL_MS, CHALLENGE_TTL_MS } = require('../socket/lobby');
const { attachNotifications, unseen } = require('../socket/notify');

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

/* ── A push service of our own ─────────────────────────────────────────── */

/*
 * web-push speaks only HTTPS, and a certificate for 127.0.0.1 is more fixture
 * than this needs. Its request builder is public, though, and it is where the
 * work being tested happens — the encryption and the VAPID signature — so the
 * request is built by web-push itself and only carried over plain HTTP.
 */
webpush.sendNotification = (subscription, payload, options) => new Promise((resolve, reject) => {
    let details;
    try {
        details = webpush.generateRequestDetails(subscription, payload, options);
    } catch (error) {
        reject(error);
        return;
    }
    const request = http.request(details.endpoint, { method: details.method, headers: details.headers }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            if (response.statusCode < 200 || response.statusCode > 299) {
                reject(new webpush.WebPushError('Received unexpected response code',
                    response.statusCode, response.headers, body, details.endpoint));
            } else {
                resolve({ statusCode: response.statusCode, body, headers: response.headers });
            }
        });
    });
    request.on('error', reject);
    request.end(details.body);
});

const received = [];             // { device, headers, body }
const waiting = [];              // { device, resolve, timer }
const gone = new Set();          // devices whose endpoint now answers 410

const pushServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
        const device = req.url.split('/').pop();
        if (gone.has(device)) {
            res.writeHead(410);
            res.end();
            return;
        }
        const entry = { device, headers: req.headers, body: Buffer.concat(chunks) };
        const waiter = waiting.find((w) => w.device === device);
        if (waiter) {
            waiting.splice(waiting.indexOf(waiter), 1);
            clearTimeout(waiter.timer);
            waiter.resolve(entry);
        } else {
            received.push(entry);
        }
        res.writeHead(201);
        res.end();
    });
});

/** The next message that reaches this device, or a failure after `ms`. */
function nextPush(device, ms = 4000) {
    const already = received.findIndex((entry) => entry.device === device);
    if (already !== -1) return Promise.resolve(received.splice(already, 1)[0]);
    return new Promise((resolve, reject) => {
        const waiter = { device, resolve };
        waiter.timer = setTimeout(() => {
            waiting.splice(waiting.indexOf(waiter), 1);
            reject(new Error(`no notification reached ${device}`));
        }, ms);
        waiting.push(waiter);
    });
}

/** Nothing reaches this device for `ms`. */
async function silence(device, ms = 600) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    const stray = received.findIndex((entry) => entry.device === device);
    if (stray !== -1) {
        const entry = received.splice(stray, 1)[0];
        throw new Error(`${device} was sent something: ${JSON.stringify(read(entry))}`);
    }
}

/* ── Devices ───────────────────────────────────────────────────────────── */

const devices = new Map();

/** A browser's subscription, with the private half it keeps to itself. */
function makeDevice(name, base) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const auth = crypto.randomBytes(16);
    const device = {
        name,
        ecdh,
        auth,
        subscription: {
            endpoint: `${base}/push/${name}`,
            keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
        },
    };
    devices.set(name, device);
    return device;
}

/** What the device would have shown: decrypted with its own key. */
function read(entry) {
    const device = devices.get(entry.device);
    const plain = ece.decrypt(entry.body, { version: 'aes128gcm', privateKey: device.ecdh, authSecret: device.auth });
    return JSON.parse(plain.toString('utf8'));
}

/* ── Sockets ───────────────────────────────────────────────────────────── */

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

const signIn = (socket, id) => {
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../config/env');
    return ask(socket, 'hx:identify', { token: jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '1h' }) });
};

/** A legal intent for whoever is to move in `snapshot`. */
async function legalIntent(snapshot) {
    const { pathToFileURL } = require('url');
    const path = require('path');
    const dir = path.join(__dirname, '..', '..', 'web', 'src', 'game');
    const url = (f) => pathToFileURL(path.join(dir, f)).href;
    const [state, moves] = await Promise.all([import(url('state.js')), import(url('moves.js'))]);
    const position = state.deserializeState(snapshot);
    return moves.moveIntent(moves.generateMoves(position)[0]);
}

async function run() {
    await new Promise((resolve) => pushServer.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${pushServer.address().port}`;

    push.testing.configure(webpush.generateVAPIDKeys());
    push.testing.acceptEndpoints((url) => url.startsWith(base + '/'));

    const amelie = makeDevice('amelie-phone', base);
    const bertrand = makeDevice('bertrand-phone', base);

    console.log('\nPush notifications\n');

    await test('only the push services browsers use are accepted as addresses', () => {
        assert.ok(push.isPushServiceUrl('https://fcm.googleapis.com/fcm/send/abc'));
        assert.ok(push.isPushServiceUrl('https://updates.push.services.mozilla.com/wpush/v2/abc'));
        assert.ok(push.isPushServiceUrl('https://web.push.apple.com/QAbc'));
        assert.ok(push.isPushServiceUrl('https://wns2-par02p.notify.windows.com/w/?token=abc'));
        assert.ok(!push.isPushServiceUrl('http://fcm.googleapis.com/fcm/send/abc'), 'not without TLS');
        assert.ok(!push.isPushServiceUrl('https://fcm.googleapis.com.evil.example/x'), 'not a lookalike');
        assert.ok(!push.isPushServiceUrl('https://169.254.169.254/latest/meta-data'), 'not anywhere else');
        assert.ok(!push.isPushServiceUrl('not a url'));
    });

    await test('a subscription that is not one is refused', async () => {
        const bad = await push.subscribe('acct-amelie', { endpoint: base + '/push/x', keys: { p256dh: 'short', auth: 'x' } });
        assert.deepStrictEqual(bad, { ok: false, error: 'BAD_SUBSCRIPTION' });
        const elsewhere = await push.subscribe('acct-amelie', {
            endpoint: 'https://example.com/hook', keys: amelie.subscription.keys,
        });
        assert.strictEqual(elsewhere.ok, false, 'an address that is not a push service');
    });

    await test('the words come from the locale files, in the account\'s language', () => {
        assert.strictEqual(push.say('fr', 'push.turn.title'), 'À vous de jouer');
        assert.strictEqual(push.say('en', 'push.turn.title'), 'Your move');
        assert.strictEqual(push.say('fr', 'push.turn.bodyClock', { name: 'Amelie', time: '4:05' }),
            'Amelie a joué. Il vous reste 4:05 à la pendule.');
        assert.strictEqual(push.say('de', 'push.turn.title'), 'Your move', 'a language we lack falls to English');
        assert.strictEqual(push.cadenceName('fr', 'rapid'), 'Rapide · 10 min + 5 s');
    });

    await test('a test notification arrives, encrypted to the device and signed by us', async () => {
        assert.deepStrictEqual(await push.subscribe('acct-amelie', amelie.subscription,
            { timeZone: 'Europe/Paris', language: 'fr', userAgent: 'test' }), { ok: true });
        const reached = await push.notify('acct-amelie', 'test', {}, { url: '/#/settings', tag: 'test', badge: 2 });
        assert.strictEqual(reached, 1);
        const entry = await nextPush('amelie-phone');
        assert.strictEqual(entry.headers['content-encoding'], 'aes128gcm');
        assert.match(entry.headers.authorization, /^vapid t=.+, k=.+/, 'signed with the VAPID key');
        assert.strictEqual(entry.headers.urgency, 'high');
        const message = read(entry);
        assert.strictEqual(message.kind, 'test');
        assert.strictEqual(message.body, 'Les notifications fonctionnent sur cet appareil.', 'in French');
        assert.strictEqual(message.url, '/#/settings');
        assert.strictEqual(message.badge, 2);
    });

    await test('a switch turned off in the settings is obeyed', async () => {
        Subscriptions.useSettings('acct-amelie', { language: 'en', notifyMentions: false });
        assert.strictEqual(await push.notify('acct-amelie', 'mention', { name: 'X', text: 'hi' }), 0);
        await silence('amelie-phone', 200);
        assert.strictEqual(await push.reachable('acct-amelie', 'mention'), false);
        assert.strictEqual(await push.reachable('acct-amelie', 'challenge'), true);
        Subscriptions.useSettings('acct-amelie', {});
    });

    await test('an address the push service calls gone is forgotten', async () => {
        const stale = makeDevice('old-laptop', base);
        await push.subscribe('acct-amelie', stale.subscription);
        gone.add('old-laptop');
        const reached = await push.notify('acct-amelie', 'test');
        assert.strictEqual(reached, 1, 'the phone still took it');
        await nextPush('amelie-phone');
        const left = (await Subscriptions.forUser('acct-amelie')).map((row) => row.endpoint);
        assert.deepStrictEqual(left, [amelie.subscription.endpoint], 'the dead address is gone');
    });

    await test('unsubscribing by endpoint needs nothing but the endpoint', async () => {
        const spare = makeDevice('spare', base);
        await push.subscribe('acct-amelie', spare.subscription);
        await push.unsubscribe(spare.subscription.endpoint);
        assert.ok(!(await push.hasDevice('acct-amelie', spare.subscription.endpoint)));
        assert.ok(await push.hasDevice('acct-amelie', amelie.subscription.endpoint));
    });

    /* ── Reminders ──────────────────────────────────────────────────────── */

    const DAY = 24 * 60 * 60 * 1000;
    const evening = Date.UTC(2026, 9, 19, 18, 30);          // 18:30 in UTC
    const atNight = Date.UTC(2026, 9, 19, 3, 0);

    await test('a reminder is owed once per step of absence, in the evening only', () => {
        const away = (days, extra = {}) => ({
            settings: {}, time_zone: 'UTC', visited_at: new Date(evening - days * DAY), reminded_at: null, ...extra,
        });
        assert.strictEqual(reminders.comeBackDue(away(2), evening), null, 'two days is not yet a while');
        assert.deepStrictEqual(reminders.comeBackDue(away(3), evening), { days: 3 });
        assert.strictEqual(reminders.comeBackDue(away(3), atNight), null, 'never at night');
        assert.strictEqual(reminders.comeBackDue(away(3, { time_zone: 'Asia/Tokyo' }), evening), null,
            'evening where they are, not where the server is');
        assert.strictEqual(reminders.comeBackDue(
            away(4, { reminded_at: new Date(evening - 1 * DAY) }), evening), null, 'the three-day one is sent');
        assert.deepStrictEqual(reminders.comeBackDue(
            away(8, { reminded_at: new Date(evening - 5 * DAY) }), evening), { days: 7 }, 'then the week');
        assert.strictEqual(reminders.comeBackDue(
            away(60, { reminded_at: new Date(evening - 20 * DAY) }), evening), null, 'and after a month, silence');
        assert.strictEqual(reminders.comeBackDue(away(5, { settings: { notifyReminders: false } }), evening), null);
        assert.strictEqual(reminders.comeBackDue(
            away(9, { played_at: new Date(evening - 1 * DAY) }), evening), null, 'a game played counts as being here');
    });

    await test('the scheduler sends what is owed, and only once', async () => {
        for (const row of Subscriptions.memory.rows.values()) {
            row.time_zone = 'UTC';
            row.visited_at = new Date(evening - 3 * DAY - 1000);
            row.reminded_at = null;
        }
        assert.strictEqual(await reminders.tick(evening), 1);
        const message = read(await nextPush('amelie-phone'));
        assert.strictEqual(message.kind, 'reminder');
        assert.match(message.body, /3/);
        assert.strictEqual(await reminders.tick(evening + 15 * 60 * 1000), 0, 'not again a quarter of an hour later');
        await silence('amelie-phone', 200);
    });

    /* ── Through the sockets ────────────────────────────────────────────── */

    const server = http.createServer();
    const io = new Server(server, { cors: { origin: '*' } });
    attachOnlineGames(io);
    attachLobby(io);
    attachNotifications(io);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const open = () => new Promise((resolve, reject) => {
        const socket = connect(url, { transports: ['websocket'], forceNew: true });
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', reject);
    });

    await push.subscribe('acct-bertrand', bertrand.subscription, { language: 'en' });
    push.testing.forgetLimits();
    received.length = 0;

    await test('a challenge reaches somebody who is not on the site', async () => {
        const a = await open();
        await signIn(a, 'acct-amelie');
        const sent = await ask(a, 'hx:challenge', { userId: 'acct-bertrand', timeControl: 'rapid' });
        assert.ok(sent.ok, sent.error);
        assert.strictEqual(sent.away, true, 'and the one asking is told they are away');
        const message = read(await nextPush('bertrand-phone'));
        assert.strictEqual(message.kind, 'challenge');
        assert.strictEqual(message.title, 'Amelie (1200) challenges you');
        assert.strictEqual(message.body, 'Rapid · 10 min + 5 s. The challenge stands for 10 minutes.');
        assert.strictEqual(message.url, `/#/online?challenge=${sent.id}`);
        assert.strictEqual(message.badge, 1, 'the first thing waiting');

        // The question is still standing when he arrives.
        const b = await open();
        await signIn(b, 'acct-bertrand');
        const pending = await ask(b, 'hx:challenge:pending', {});
        assert.ok(pending.incoming && pending.incoming.id === sent.id, 'it waits for him');
        await ask(b, 'hx:challenge:decline', { id: sent.id });
        a.disconnect();
        b.disconnect();
    });

    await test('somebody who cannot be told is still simply not here', async () => {
        const a = await open();
        await signIn(a, 'acct-bertrand');
        const sent = await ask(a, 'hx:challenge', { userId: 'acct-nobody', timeControl: 'rapid' });
        assert.deepStrictEqual(sent, { ok: false, error: 'NOT_HERE' });
        a.disconnect();
    });

    await test('nobody is buzzed about what is already on their screen', async () => {
        push.testing.forgetLimits();
        const a = await open();
        const b = await open();
        await Promise.all([signIn(a, 'acct-amelie'), signIn(b, 'acct-bertrand')]);
        await ask(b, 'hx:visible', { visible: true });
        const incoming = waitFor(b, 'hx:challenge:incoming');
        const sent = await ask(a, 'hx:challenge', { userId: 'acct-bertrand', timeControl: 'blitz' });
        assert.ok(sent.ok && !sent.away);
        await incoming;
        await silence('bertrand-phone');
        await ask(b, 'hx:challenge:decline', { id: sent.id });

        // Put away, the same question goes to the phone instead.
        push.testing.forgetLimits();
        await ask(b, 'hx:visible', { visible: false });
        const again = await ask(a, 'hx:challenge', { userId: 'acct-bertrand', timeControl: 'blitz' });
        assert.ok(again.ok);
        assert.strictEqual(read(await nextPush('bertrand-phone')).kind, 'challenge');
        await ask(b, 'hx:challenge:decline', { id: again.id });
        a.disconnect();
        b.disconnect();
    });

    await test('looking at the app clears the count on its icon', async () => {
        const b = await open();
        await signIn(b, 'acct-bertrand');
        unseen.set('acct-bertrand', 3);
        await ask(b, 'hx:visible', { visible: true });
        assert.ok(!unseen.has('acct-bertrand'));
        b.disconnect();
    });

    await test('a yes given after the one who asked has left is carried to them', async () => {
        push.testing.forgetLimits();
        const a = await open();
        await signIn(a, 'acct-amelie');
        const sent = await ask(a, 'hx:challenge', { userId: 'acct-bertrand', timeControl: 'rapid' });
        await nextPush('bertrand-phone');
        a.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const b = await open();
        await signIn(b, 'acct-bertrand');
        await ask(b, 'hx:visible', { visible: true });
        const answer = await ask(b, 'hx:challenge:accept', { id: sent.id });
        assert.ok(answer.ok, answer.error);
        assert.strictEqual(answer.deferred, true);
        assert.strictEqual(answer.away, true, 'waiting on her rather than refused');
        const message = read(await nextPush('amelie-phone'));
        assert.strictEqual(message.kind, 'accepted');
        assert.strictEqual(message.title, 'Bertrand a accepté votre défi', 'in her language, French');

        // She comes back, and the game opens for both.
        const ready = waitFor(b, 'hx:challenge:ready', 6000);
        const back = await open();
        const readyToo = waitFor(back, 'hx:challenge:ready', 6000);
        await signIn(back, 'acct-amelie');
        await ask(back, 'hx:visible', { visible: true });
        const [one, two] = await Promise.all([ready, readyToo]);
        assert.strictEqual(one.code, two.code, 'the same room for both');
        await silence('amelie-phone', 300);   // she is looking: no "your game is starting"
        back.disconnect();
        b.disconnect();
    });

    await test('a move made while the other player has looked away tells them', async () => {
        push.testing.forgetLimits();
        const a = await open();
        const b = await open();
        await Promise.all([signIn(a, 'acct-amelie'), signIn(b, 'acct-bertrand')]);
        await ask(a, 'hx:visible', { visible: true });
        const created = await ask(a, 'hx:create', { timeControl: 'blitz' });
        const joined = await ask(b, 'hx:join', { code: created.code });
        assert.ok(joined.ok, joined.error);
        await ask(b, 'hx:visible', { visible: false });

        const moved = await ask(a, 'hx:move', { code: created.code, intent: await legalIntent(created.state) });
        assert.ok(moved.ok, moved.error);
        const message = read(await nextPush('bertrand-phone'));
        assert.strictEqual(message.kind, 'turn');
        assert.strictEqual(message.title, 'Your move');
        assert.match(message.body, /^Amelie has played\. You have \d:\d\d on the clock\.$/);
        assert.strictEqual(message.url, `/#/play?online=1&code=${created.code}`);
        assert.strictEqual(message.tag, `game-${created.code}`);
        await silence('amelie-phone', 200);   // she moved; she knows

        // His connection drops: the countdown to abandonment is his to hear about.
        b.disconnect();
        const comeBack = read(await nextPush('bertrand-phone'));
        assert.strictEqual(comeBack.kind, 'comeBack');
        assert.strictEqual(comeBack.body,
            'You have 0:30 to come back, or the game against Amelie is lost by abandonment.');
        await ask(a, 'hx:resign', { code: created.code });
        a.disconnect();
    });

    await test('a name said in the lobby reaches somebody who is away, once', async () => {
        push.testing.forgetLimits();
        const a = await open();
        await signIn(a, 'acct-amelie');
        await ask(a, 'hx:lobby:enter', {});
        const said = await ask(a, 'hx:lobby:chat', { text: 'partie ce soir @Bertrand ?' });
        assert.ok(said.ok, said.error);
        const message = read(await nextPush('bertrand-phone'));
        assert.strictEqual(message.kind, 'mention');
        assert.strictEqual(message.title, 'Amelie mentioned you in the lobby');
        assert.strictEqual(message.body, 'partie ce soir @Bertrand ?');

        await new Promise((resolve) => setTimeout(resolve, 800));    // past the chat's own throttle
        await ask(a, 'hx:lobby:chat', { text: '@bertrand ?' });
        await silence('bertrand-phone', 500);
        a.disconnect();
    });

    await test('the lifetimes say what the settings promise', () => {
        assert.strictEqual(NOTIFIED_CHALLENGE_TTL_MS, 10 * 60 * 1000);
        assert.strictEqual(CHALLENGE_TTL_MS, 60 * 1000);
    });

    io.close();
    server.close();
    pushServer.close();

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run().catch((error) => {
    console.error('harness crashed:', error);
    process.exit(1);
});
