/**
 * Signing up with an address and a password, and everything that follows.
 *
 * Run with: node tests/emailAccount.test.js
 *
 * Google sign-in is not the only door any more, so the two have to agree: the
 * session a password login issues must be the same kind of session Google's
 * issues, or an email account could sign in and then fail to play.
 */

/* Set before anything reads the configuration: this suite signs in and out
   far more often than a person would, and the rate limiter is right to stop
   that anywhere else. */
process.env.NODE_ENV = 'test';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { pool, query } = require('../config/database');
const { attachOnlineGames } = require('../socket/onlineGame');

let passed = 0;
let failed = 0;
const addresses = new Set();

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

const address = (tag) => `mail-test-${tag}@example.invalid`;

async function forget(tag) {
    addresses.add(address(tag));
    await query('DELETE FROM users WHERE email = $1', [address(tag)]);
}

function ask(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 8000);
        socket.emit(event, payload, (response) => { clearTimeout(timer); resolve(response); });
    });
}

async function run() {
    /* The API under test, without the rest of the server: no port to clash
       over, and nothing else running that could explain a pass. */
    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../routes/authRoutes'));
    app.use(require('../middleware/errorHandler').errorHandler);

    const api = http.createServer(app);
    await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${api.address().port}/api/auth`;

    const get = async (path, token) => {
        const response = await fetch(base + path, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        let json = null;
        try { json = await response.json(); } catch { /* empty body */ }
        return { status: response.status, body: json || {} };
    };

    const post = async (path, body, token) => {
        const response = await fetch(base + path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
        });
        let json = null;
        try { json = await response.json(); } catch { /* empty body */ }
        return { status: response.status, body: json || {} };
    };

    /* A socket server too, to prove the session a password login hands out is
       one the game accepts. */
    const games = http.createServer();
    const io = new Server(games, { cors: { origin: '*' } });
    attachOnlineGames(io);
    await new Promise((resolve) => games.listen(0, '127.0.0.1', resolve));
    const socketUrl = `http://127.0.0.1:${games.address().port}`;
    const openSocket = () => new Promise((resolve, reject) => {
        const socket = connect(socketUrl, { transports: ['websocket'], forceNew: true });
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', reject);
    });

    console.log('\nEmail accounts\n');

    await test('signing up creates an account and signs you in', async () => {
        await forget('a');
        const response = await post('/signup', {
            email: address('a'), pseudo: 'MailTestA', password: 'chevalDeBois42',
        });
        assert.strictEqual(response.status, 201, JSON.stringify(response.body));
        assert.ok(response.body.accessToken, 'a session comes back with it');

        const { rows } = await query('SELECT * FROM users WHERE email = $1', [address('a')]);
        assert.strictEqual(rows.length, 1);
        assert.ok(rows[0].password_hash, 'the password is stored hashed');
        assert.notStrictEqual(rows[0].password_hash, 'chevalDeBois42', 'and not in the clear');
        assert.strictEqual(rows[0].google_id, null, 'no Google account is involved');
        assert.ok(rows[0].verification_token, 'and a verification token is waiting');
    });

    await test('that session is one the game accepts', async () => {
        const signIn = await post('/login', { email: address('a'), password: 'chevalDeBois42' });
        assert.strictEqual(signIn.status, 200, JSON.stringify(signIn.body));

        const socket = await openSocket();
        const identified = await ask(socket, 'hx:identify', { token: signIn.body.accessToken });
        assert.ok(identified.ok, identified.error);
        assert.strictEqual(identified.user.pseudo, 'MailTestA',
            'the socket knows who this is, so their games can be rated');
        socket.disconnect();
    });

    await test('the session survives a reload', async () => {
        /* The app restores itself by asking /auth/me with the stored token. A
           401 there does not merely fail: the client throws the token away, so
           the player is silently signed out on every visit. This was never
           covered for an address-and-password account, only for Google. */
        const signIn = await post('/login', { email: address('a'), password: 'chevalDeBois42' });
        const me = await get('/me', signIn.body.accessToken);
        assert.strictEqual(me.status, 200, JSON.stringify(me.body));
        assert.strictEqual(me.body.user.pseudo, 'MailTestA');
        assert.strictEqual(me.body.user.email, address('a'));
        assert.strictEqual(me.body.needsPseudo, false, 'the nickname was chosen at sign-up');
        assert.ok(!('password_hash' in me.body.user), 'and the hash never leaves the server');
    });

    await test('a session with no token is refused, not crashed', async () => {
        const me = await get('/me');
        assert.strictEqual(me.status, 401);
    });

    await test('the wrong password gets nowhere', async () => {
        const response = await post('/login', { email: address('a'), password: 'notThePassword' });
        assert.strictEqual(response.status, 401);
        assert.ok(!response.body.accessToken, 'and hands out nothing');
    });

    await test('an address can only be taken once', async () => {
        const response = await post('/signup', {
            email: address('a'), pseudo: 'MailTestOther', password: 'unAutreMotDePasse7',
        });
        assert.strictEqual(response.status, 409, JSON.stringify(response.body));
    });

    await test('a nickname can only be taken once', async () => {
        await forget('b');
        const response = await post('/signup', {
            email: address('b'), pseudo: 'MailTestA', password: 'unAutreMotDePasse7',
        });
        assert.strictEqual(response.status, 409, JSON.stringify(response.body));
    });

    await test('a password too short to be one is refused', async () => {
        await forget('c');
        const response = await post('/signup', {
            email: address('c'), pseudo: 'MailTestC', password: 'abc',
        });
        assert.strictEqual(response.status, 400, JSON.stringify(response.body));
        const { rows } = await query('SELECT id FROM users WHERE email = $1', [address('c')]);
        assert.strictEqual(rows.length, 0, 'and no account is left behind');
    });

    await test('an account that only knows Google says so', async () => {
        await forget('d');
        await query(
            `INSERT INTO users (email, pseudo, google_id, elo, email_verified, pseudo_chosen)
             VALUES ($1,$2,$3,1000,TRUE,TRUE)`,
            [address('d'), 'MailTestD', 'mail-test-google-d']
        );
        const response = await post('/login', { email: address('d'), password: 'anything at all' });
        assert.strictEqual(response.status, 401, JSON.stringify(response.body));
        // The message must not confirm the address exists, but must not send
        // the player round in circles either.
        assert.ok(response.body.message, 'there is something to show the player');
    });

    await test('confirming an address marks it confirmed', async () => {
        const before = await query(
            'SELECT verification_token, email_verified FROM users WHERE email = $1', [address('a')]);
        assert.ok(before.rows[0].verification_token, 'a token was issued at sign-up');
        assert.strictEqual(before.rows[0].email_verified, false);

        const response = await post('/verify-email', { token: before.rows[0].verification_token });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));

        const after = await query(
            'SELECT verification_token, email_verified FROM users WHERE email = $1', [address('a')]);
        assert.strictEqual(after.rows[0].email_verified, true);
        assert.strictEqual(after.rows[0].verification_token, null, 'and the token is spent');
    });

    await test('a token nobody issued confirms nothing', async () => {
        const response = await post('/verify-email', { token: 'not-a-real-token' });
        assert.ok(response.status >= 400, 'refused');
    });

    await test('a forgotten password can be reset, and the old one stops working', async () => {
        const asked = await post('/forgot-password', { email: address('a') });
        assert.strictEqual(asked.status, 200, JSON.stringify(asked.body));

        const { rows } = await query(
            'SELECT reset_token, reset_expires FROM users WHERE email = $1', [address('a')]);
        assert.ok(rows[0].reset_token, 'a reset token is waiting');
        assert.ok(new Date(rows[0].reset_expires) > new Date(), 'and it has not expired yet');

        const reset = await post('/reset-password', {
            token: rows[0].reset_token, newPassword: 'unNouveauMotDePasse9',
        });
        assert.strictEqual(reset.status, 200, JSON.stringify(reset.body));

        const withNew = await post('/login', { email: address('a'), password: 'unNouveauMotDePasse9' });
        assert.strictEqual(withNew.status, 200, 'the new password works');
        const withOld = await post('/login', { email: address('a'), password: 'chevalDeBois42' });
        assert.strictEqual(withOld.status, 401, 'the old one does not');

        const spent = await query('SELECT reset_token FROM users WHERE email = $1', [address('a')]);
        assert.strictEqual(spent.rows[0].reset_token, null, 'and the token is spent');
    });

    await test('a Google account can be given a password and keep both doors', async () => {
        /* The two kinds of account are not separate species: one address, one
           person, and either way in. A Google-only account has no password, and
           the reset flow is how it gets one — after which both doors open the
           same account, with the same games behind it. */
        await forget('e');
        const { rows } = await query(
            `INSERT INTO users (email, pseudo, google_id, elo, email_verified, pseudo_chosen)
             VALUES ($1,$2,$3,1000,TRUE,TRUE) RETURNING id`,
            [address('e'), 'MailTestE', 'mail-test-google-e']
        );
        const id = rows[0].id;

        const refused = await post('/login', { email: address('e'), password: 'aPasswordItNeverHad' });
        assert.strictEqual(refused.status, 401, 'no password yet: ' + JSON.stringify(refused.body));

        await post('/forgot-password', { email: address('e') });
        const token = (await query('SELECT reset_token FROM users WHERE id = $1', [id]))
            .rows[0].reset_token;
        assert.ok(token, 'the reset works for an account that never had a password');
        const set = await post('/reset-password', { token, newPassword: 'unMotDePasseChoisi8' });
        assert.strictEqual(set.status, 200, JSON.stringify(set.body));

        const signedIn = await post('/login', { email: address('e'), password: 'unMotDePasseChoisi8' });
        assert.strictEqual(signedIn.status, 200, 'the password door now opens');
        assert.strictEqual(signedIn.body.user.id, id, 'onto the same account');

        const linked = await query('SELECT google_id, password_hash FROM users WHERE id = $1', [id]);
        assert.ok(linked.rows[0].google_id, 'and Google still opens it too');
        assert.ok(linked.rows[0].password_hash);

        const me = await get('/me', signedIn.body.accessToken);
        assert.strictEqual(me.body.needsPseudo, false, 'nothing is asked for twice');
    });

    await test('asking to reset an address nobody has gives nothing away', async () => {
        const response = await post('/forgot-password', { email: 'nobody-here@example.invalid' });
        assert.strictEqual(response.status, 200,
            'the same answer either way, or this is an address checker');
    });

    for (const email of addresses) {
        await query('DELETE FROM users WHERE email = $1', [email]).catch(() => {});
    }
    const left = await query(
        "SELECT count(*)::int AS n FROM users WHERE email LIKE 'mail-test-%@example.invalid'");
    console.log(`\ncleanup: ${left.rows[0].n} test row(s) left behind`);

    io.close();
    games.close();
    api.close();
    await pool.end();
    console.log(`${passed} passed, ${failed} failed\n`);
    process.exit(failed || left.rows[0].n ? 1 : 0);
}

run().catch((error) => {
    console.error('harness crashed:', error);
    process.exit(1);
});
