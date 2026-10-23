/**
 * Accounts by address and password, from the form to a session.
 *
 * Run with: node tests/accountFlows.test.js
 *
 * No database. emailAccount.test.js runs the same doors against a real one,
 * when there is one to run against -- which, on a machine without a throwaway
 * database, is never, so what follows is what actually gets checked before a
 * deploy: every way in, through the real routes, the real services and the
 * real password hashing, with the SQL they send answered from a small table
 * kept below. Any statement this file does not know fails by name, so a query
 * nobody expected cannot slip through as a pass.
 *
 * The site signed people in with Google until 2026-10-20. Some rows from then
 * have no password -- most of them left behind by attempts that never reached
 * a session -- and the doors below are how their owners get in now: the same
 * reset link anybody who forgot a password gets.
 */

// Before anything else: this suite writes nothing, so it gets nothing to
// write to. See tests/database.js.
require('./database').none();

/* Set before anything reads the configuration: the rate limiter would count
   these attempts as a stranger's, the error handler would log the refusals
   the tests provoke on purpose, and a dozen bcrypt hashes at production cost
   would take most of a minute. */
process.env.NODE_ENV = 'test';
process.env.BCRYPT_ROUNDS = '4';

/*
 * The users and refresh_tokens tables, as far as an account's doors reach.
 *
 * Installed before anything that queries is required, since the services take
 * their own copy of `query` as they load. Rows go out as copies, as they come
 * from Postgres, so a caller holding one does not see later writes.
 */
const database = require('../config/database');
const users = new Map();
let refreshTokens = [];
let lastId = 0;

const copies = (rows) => rows.map((row) => ({ ...row }));
const where = (keep) => copies([...users.values()].filter(keep));
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function change(id, fields) {
    if (!users.has(id)) return [];
    users.set(id, { ...users.get(id), ...fields });
    return copies([users.get(id)]);
}

/** A row with the defaults the schema gives one. */
function account(fields) {
    lastId++;
    const row = {
        id: `00000000-0000-4000-8000-${String(lastId).padStart(12, '0')}`,
        email: null, pseudo: null, password_hash: null, google_id: null,
        pseudo_chosen: false, email_verified: false,
        reset_token: null, reset_expires: null, verification_token: null,
        elo: 1000, games_played: 0, wins: 0, losses: 0, draws: 0,
        created_at: new Date(), last_seen: new Date(),
        ...fields,
    };
    users.set(row.id, row);
    return copies([row]);
}

const LATER = () => new Date(Date.now() + 60 * 60 * 1000);

const STATEMENTS = [
    // userModel.findByEmail and findById, by the columns they select.
    [/^SELECT id, email, pseudo, password_hash, .* FROM users WHERE email = \$1$/,
        ([email]) => where((row) => row.email === email)],
    [/^SELECT id, email, pseudo, email_verified, .* FROM users WHERE id = \$1$/,
        ([id]) => where((row) => row.id === id)],
    [/^SELECT \* FROM users WHERE id = \$1$/,
        ([id]) => where((row) => row.id === id)],
    [/^SELECT 1 FROM users WHERE LOWER\(pseudo\) = LOWER\(\$1\)$/,
        ([pseudo]) => where((row) => same(row.pseudo, pseudo)).slice(0, 1)],
    [/^SELECT 1 FROM users WHERE lower\(pseudo\) = lower\(\$1\) AND id <> \$2 LIMIT 1$/,
        ([pseudo, id]) => where((row) => same(row.pseudo, pseudo) && row.id !== id).slice(0, 1)],
    [/^SELECT 1 FROM users WHERE lower\(pseudo\) = lower\(\$1\) AND \(\$2::uuid IS NULL OR id <> \$2::uuid\) LIMIT 1$/,
        ([pseudo, id]) => where((row) => same(row.pseudo, pseudo) && row.id !== id).slice(0, 1)],
    [/^INSERT INTO users \(email, pseudo, password_hash, pseudo_chosen\) VALUES \(\$1, \$2, \$3, TRUE\)/,
        ([email, pseudo, hash]) => account({ email, pseudo, password_hash: hash, pseudo_chosen: true })],
    [/^UPDATE users SET verification_token = \$1, verification_expires = NOW\(\) \+ \$2::interval WHERE id = \$3$/,
        ([token, , id]) => { change(id, { verification_token: token }); return []; }],
    [/^UPDATE users SET last_seen = (NOW\(\)|CURRENT_TIMESTAMP) WHERE id = \$1$/,
        ([id]) => { change(id, { last_seen: new Date() }); return []; }],
    [/^UPDATE users SET reset_token = \$1, reset_expires = NOW\(\) \+ \$2::interval WHERE email = \$3 RETURNING id$/,
        ([token, , email]) => {
            const row = where((r) => r.email === email)[0];
            if (!row) return [];
            change(row.id, { reset_token: token, reset_expires: LATER() });
            return [{ id: row.id }];
        }],
    [/^UPDATE users SET password_hash = \$1, reset_token = NULL, reset_expires = NULL, email_verified = TRUE WHERE reset_token = \$2 AND reset_expires > NOW\(\) RETURNING id$/,
        ([hash, token]) => {
            const row = where((r) => r.reset_token && r.reset_token === token && r.reset_expires > new Date())[0];
            if (!row) return [];
            change(row.id, { password_hash: hash, reset_token: null, reset_expires: null, email_verified: true });
            return [{ id: row.id }];
        }],
    [/^UPDATE users SET password_hash = \$1 WHERE id = \$2$/,
        ([hash, id]) => { change(id, { password_hash: hash }); return []; }],
    [/^UPDATE users SET pseudo = \$2, pseudo_chosen = TRUE WHERE id = \$1 RETURNING \*$/,
        ([id, pseudo]) => change(id, { pseudo, pseudo_chosen: true })],
    [/^INSERT INTO refresh_tokens \(user_id, token, expires_at\)/,
        ([userId, token, expiresAt]) => {
            refreshTokens.push({ user_id: userId, token, expires_at: expiresAt });
            return [{ token }];
        }],
    [/^DELETE FROM refresh_tokens WHERE user_id = \$1$/,
        ([userId]) => { refreshTokens = refreshTokens.filter((t) => t.user_id !== userId); return []; }],
    [/^DELETE FROM refresh_tokens WHERE token = \$1$/,
        ([token]) => { refreshTokens = refreshTokens.filter((t) => t.token !== token); return []; }],
    // refreshTokenModel.findValid: a token still kept, and not yet expired.
    [/^SELECT rt\.\*, u\.id as user_id, u\.email, u\.pseudo FROM refresh_tokens rt JOIN users u ON u\.id = rt\.user_id WHERE rt\.token = \$1 AND rt\.expires_at > NOW\(\)$/,
        ([token]) => refreshTokens
            .filter((t) => t.token === token && t.expires_at > new Date() && users.has(t.user_id))
            .map((t) => ({ ...t, email: users.get(t.user_id).email, pseudo: users.get(t.user_id).pseudo }))],
];

const realQuery = database.query;
database.query = async (sql, params = []) => {
    const statement = sql.replace(/\s+/g, ' ').trim();
    const known = STATEMENTS.find(([shape]) => shape.test(statement));
    if (!known) return realQuery(sql, params);
    const rows = known[1](params);
    return { rows, rowCount: rows.length };
};

/* The mail that would have gone out, kept instead: the reset link carries
   the token a test needs, and nothing here may reach a real mailbox. */
const mail = [];
const emailService = require('../services/emailService');
emailService.sendVerificationEmail = async (to, token) => { mail.push({ kind: 'verify', to, token }); };
emailService.sendPasswordResetEmail = async (to, token) => { mail.push({ kind: 'reset', to, token }); };

const assert = require('assert');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const express = require('express');

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

/*
 * The app's own session module, web/src/auth.js, in this process.
 *
 * It reaches into the browser for two drawers to keep the tokens in, the
 * address it was loaded from -- the API is on the same origin -- and fetch.
 * The drawers are kept here and the address is this suite's server. fetch is
 * the real one, counted, so a request the app sends without waiting for it
 * can still be waited for.
 */
async function theApp(origin) {
    const drawer = () => {
        const items = new Map();
        return {
            getItem: (key) => (items.has(key) ? items.get(key) : null),
            setItem: (key, value) => { items.set(key, String(value)); },
            removeItem: (key) => { items.delete(key); },
        };
    };
    const browser = { localStorage: drawer(), sessionStorage: drawer(), location: new URL(`${origin}/`) };
    for (const [name, value] of Object.entries(browser)) {
        Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    }
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (...args) => {
        const answer = realFetch(...args);
        sent.push(answer.catch(() => null));
        return answer;
    };
    const auth = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'src', 'auth.js')).href);
    return {
        auth,
        stored: (key) => browser.localStorage.getItem(key) ?? browser.sessionStorage.getItem(key),
        settled: () => Promise.all(sent),
    };
}

async function run() {
    /* The API under test, without the rest of the server. */
    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../routes/authRoutes'));
    app.use(require('../middleware/errorHandler').errorHandler);

    const api = http.createServer(app);
    await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${api.address().port}/api/auth`;

    const send = async (method, path, { body, token } = {}) => {
        const response = await fetch(base + path, {
            method,
            headers: {
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        let json = null;
        try { json = await response.json(); } catch { /* empty or not JSON */ }
        return { status: response.status, body: json || {} };
    };
    const signUp = (fields) => send('POST', '/signup', { body: fields });
    const signIn = (email, password) => send('POST', '/login', { body: { email, password } });
    const lastMail = (kind, to) => mail.filter((m) => m.kind === kind && m.to === to).pop();

    console.log('\nAccounts by address and password\n');

    await test('signing up opens a session, and says what the account really has', async () => {
        const { status, body } = await signUp({
            email: '  Celine@Example.com ', pseudo: 'Céline Roy', password: 'correct horse',
        });
        assert.strictEqual(status, 201, JSON.stringify(body));
        assert.ok(body.accessToken && body.refreshToken, 'a session, at once');
        assert.strictEqual(body.user.email, 'celine@example.com', 'the address as it is stored');
        assert.strictEqual(body.user.pseudo, 'Céline Roy', 'accents and a space, as a rename allows');
        assert.strictEqual(body.user.hasPassword, true,
            'it has a password -- the sign-up answer used to say it had none');
        assert.strictEqual(body.needsPseudo, false, 'the nickname was chosen in the form');
        assert.ok(lastMail('verify', 'celine@example.com'), 'and a confirmation is sent');
    });

    await test('signing up is refused, each time with a reason the app can put into words', async () => {
        const cases = [
            [{ email: 'celine@example.com', pseudo: 'Another', password: 'long enough' }, 409, 'EMAIL_TAKEN'],
            [{ email: 'new@example.com', pseudo: 'céline roy', password: 'long enough' }, 409, 'PSEUDO_TAKEN'],
            [{ email: 'not an address', pseudo: 'Fresh', password: 'long enough' }, 400, 'BAD_EMAIL'],
            [{ email: 'fresh@example.com', pseudo: 'x', password: 'long enough' }, 400, 'BAD_PSEUDO'],
            [{ email: 'fresh@example.com', pseudo: 'Fresh', password: 'short' }, 400, 'WEAK_PASSWORD'],
        ];
        for (const [fields, status, code] of cases) {
            const answer = await signUp(fields);
            assert.strictEqual(answer.status, status, `${code}: ${JSON.stringify(answer.body)}`);
            assert.strictEqual(answer.body.error, code);
        }
    });

    await test('signing in opens a session; a wrong password or address says only that', async () => {
        const right = await signIn(' CELINE@example.com', 'correct horse');
        assert.strictEqual(right.status, 200, JSON.stringify(right.body));
        assert.ok(right.body.accessToken);
        assert.strictEqual(right.body.user.hasPassword, true, 'so the profile offers to change it');
        assert.strictEqual(right.body.needsPseudo, false);

        for (const [email, password] of [['celine@example.com', 'wrong horse'], ['nobody@example.com', 'whatever!']]) {
            const refused = await signIn(email, password);
            assert.strictEqual(refused.status, 401);
            assert.strictEqual(refused.body.error, 'INVALID_CREDENTIALS', 'the same answer for both');
        }
    });

    await test('an older account with no password is told so, at either door', async () => {
        account({
            email: 'olivier@example.com', pseudo: 'Olivier-4821', google_id: 'google-olivier',
            email_verified: true, pseudo_chosen: false,
        });
        const login = await signIn('olivier@example.com', 'anything at all');
        assert.strictEqual(login.status, 401);
        assert.strictEqual(login.body.error, 'NO_PASSWORD', 'not "wrong password": there is none');

        const again = await signUp({ email: 'olivier@example.com', pseudo: 'Olivier', password: 'long enough' });
        assert.strictEqual(again.status, 409);
        assert.strictEqual(again.body.error, 'NO_PASSWORD', 'and sign-up sends them to the same link');
    });

    await test('the reset link sets a first password and signs its owner in', async () => {
        const id = [...users.values()].find((r) => r.email === 'olivier@example.com').id;
        refreshTokens.push({ user_id: id, token: 'an-old-session', expires_at: LATER() });

        const asked = await send('POST', '/forgot-password', { body: { email: ' Olivier@Example.com' } });
        assert.strictEqual(asked.status, 200);
        const link = lastMail('reset', 'olivier@example.com');
        assert.ok(link, 'the link went to the address');

        const reset = await send('POST', '/reset-password', { body: { token: link.token, newPassword: 'a new start' } });
        assert.strictEqual(reset.status, 200, JSON.stringify(reset.body));
        assert.ok(reset.body.accessToken, 'signed in by the link itself');
        assert.strictEqual(reset.body.user.hasPassword, true);
        assert.strictEqual(reset.body.needsPseudo, true, 'and asked for the nickname it never chose');
        assert.strictEqual(users.get(id).email_verified, true, 'the link proved the address');
        assert.ok(!refreshTokens.some((t) => t.token === 'an-old-session'), 'every older session ends');

        const reused = await send('POST', '/reset-password', { body: { token: link.token, newPassword: 'another one' } });
        assert.strictEqual(reused.status, 400);
        assert.strictEqual(reused.body.error, 'INVALID_TOKEN', 'a link works once');

        const login = await signIn('olivier@example.com', 'a new start');
        assert.strictEqual(login.status, 200, 'the new password opens the account');

        const named = await send('PUT', '/pseudo', { token: login.body.accessToken, body: { pseudo: 'Olivier' } });
        assert.strictEqual(named.status, 200, JSON.stringify(named.body));
        const me = await send('GET', '/me', { token: login.body.accessToken });
        assert.strictEqual(me.body.needsPseudo, false, 'and once named, nothing more is asked');
        assert.strictEqual(me.body.user.pseudo, 'Olivier');
    });

    await test('asking for a link for an unknown address answers the same, and sends nothing', async () => {
        const before = mail.length;
        const asked = await send('POST', '/forgot-password', { body: { email: 'stranger@example.com' } });
        assert.strictEqual(asked.status, 200);
        assert.strictEqual(mail.length, before, 'no mail');
    });

    await test('a mistyped current password is refused without signing anybody out', async () => {
        const { body } = await signIn('celine@example.com', 'correct horse');
        const token = body.accessToken;
        const wrong = await send('POST', '/change-password', {
            token, body: { currentPassword: 'not it', newPassword: 'something new' },
        });
        assert.strictEqual(wrong.status, 403, 'a 403: the app reads a 401 as the session being over');
        assert.strictEqual(wrong.body.error, 'WRONG_PASSWORD');

        const short = await send('POST', '/change-password', {
            token, body: { currentPassword: 'correct horse', newPassword: 'short' },
        });
        assert.strictEqual(short.body.error, 'WEAK_PASSWORD');

        const right = await send('POST', '/change-password', {
            token, body: { currentPassword: 'correct horse', newPassword: 'battery staple' },
        });
        assert.strictEqual(right.status, 200, JSON.stringify(right.body));
        assert.strictEqual((await signIn('celine@example.com', 'battery staple')).status, 200);
    });

    await test('the nickname check answers while it is typed, signed out too', async () => {
        const taken = await send('GET', '/pseudo-available?pseudo=' + encodeURIComponent('CÉLINE ROY'));
        assert.strictEqual(taken.body.available, false);
        const free = await send('GET', '/pseudo-available?pseudo=Marguerite');
        assert.strictEqual(free.body.available, true);
        const malformed = await send('GET', '/pseudo-available?pseudo=' + encodeURIComponent('--'));
        assert.strictEqual(malformed.body.available, false);
        assert.ok(malformed.body.reason, 'with the reason');
    });

    await test('signing out of the app ends the session on the server, not only in the browser', async () => {
        const app = await theApp(`http://127.0.0.1:${api.address().port}`);
        await app.auth.signUpWithEmail({ email: 'margot@example.com', pseudo: 'Margot', password: 'long enough' });
        const token = app.stored('hexaequo.refresh');
        assert.ok(token, 'signed in through the app, with a refresh token in the browser');
        assert.ok(refreshTokens.some((t) => t.token === token), 'that the server keeps');

        app.auth.signOut();
        await app.settled();
        assert.strictEqual(app.stored('hexaequo.refresh'), null, 'forgotten in the browser');
        assert.ok(!refreshTokens.some((t) => t.token === token),
            'and deleted on the server -- it used to stay good for its thirty days');
        const copied = await send('POST', '/refresh', { body: { refreshToken: token } });
        assert.strictEqual(copied.status, 401, 'so a copy of it opens nothing');
    });

    await test('nothing of Google is left to call', async () => {
        assert.strictEqual((await send('POST', '/google', { body: { credential: 'x' } })).status, 404);
        assert.strictEqual((await send('GET', '/config')).status, 404);
    });

    api.close();
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
