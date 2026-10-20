/**
 * Signing in with Google, from a verified identity to a session.
 *
 * Run with: node tests/googleSignIn.test.js
 *
 * No database. googleAuth.test.js settles, against a real one, which account a
 * Google identity resolves to. What the endpoint does next had no test, and
 * what it did was fail: it asked authService for generateTokens, which the
 * service never exported, so every Google sign-in answered 500 — after the
 * account had been created or linked, leaving a row behind each time with
 * nobody signed in to it.
 *
 * Google's check of the ID token is stood in for, because a genuine token
 * cannot be minted here. Everything after it runs as it does in production,
 * through the real routes: the account lookup, the row it writes, the session
 * it issues. The statements that takes are answered from two small tables
 * kept below; any other query fails by name, as in the other suites.
 */

// Before anything else: this suite writes nothing, so it gets nothing to
// write to. See tests/database.js.
require('./database').none();

/* Set before anything reads the configuration: the rate limiter would count
   these sign-ins as a stranger's, and the error handler would log the refusal
   the last test provokes on purpose. */
process.env.NODE_ENV = 'test';

/*
 * The users and refresh_tokens tables, as far as signing in reaches into them.
 *
 * Installed before anything that queries is required, since the services take
 * their own copy of `query` as they load. Rows go out as copies, as they come
 * from Postgres, so a caller holding one does not see later writes.
 */
const database = require('../config/database');
const users = new Map();
const refreshTokens = [];
let lastId = 0;

const copies = (rows) => rows.map((row) => ({ ...row }));
const where = (keep) => copies([...users.values()].filter(keep));

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
        elo: 1000, games_played: 0, wins: 0, losses: 0, draws: 0,
        avatar_url: null, created_at: new Date(), last_seen: new Date(),
        ...fields,
    };
    users.set(row.id, row);
    return copies([row]);
}

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

const STATEMENTS = [
    [/^SELECT \* FROM users WHERE google_id = \$1$/,
        ([googleId]) => where((row) => row.google_id === googleId)],
    [/^SELECT \* FROM users WHERE lower\(email\) = lower\(\$1\)$/,
        ([email]) => where((row) => same(row.email, email))],
    [/^SELECT \* FROM users WHERE id = \$1$/,
        ([id]) => where((row) => row.id === id)],
    [/^SELECT 1 FROM users WHERE lower\(pseudo\) = lower\(\$1\) LIMIT 1$/,
        ([pseudo]) => where((row) => same(row.pseudo, pseudo)).slice(0, 1)],
    [/^SELECT 1 FROM users WHERE lower\(pseudo\) = lower\(\$1\) AND id <> \$2 LIMIT 1$/,
        ([pseudo, id]) => where((row) => same(row.pseudo, pseudo) && row.id !== id).slice(0, 1)],
    [/^INSERT INTO users \(email, pseudo, google_id, email_verified, pseudo_chosen, avatar_url\)/,
        ([email, pseudo, googleId, picture]) => account({
            email, pseudo, google_id: googleId, email_verified: true, pseudo_chosen: false, avatar_url: picture,
        })],
    [/^UPDATE users SET last_seen = CURRENT_TIMESTAMP, avatar_url = COALESCE\(\$2, avatar_url\) WHERE id = \$1$/,
        ([id, picture]) => {
            change(id, { last_seen: new Date(), ...(picture ? { avatar_url: picture } : {}) });
            return [];
        }],
    [/^UPDATE users SET google_id = \$2, email_verified = TRUE/,
        ([id, googleId, picture]) => change(id, {
            google_id: googleId, email_verified: true, last_seen: new Date(),
            ...(picture ? { avatar_url: picture } : {}),
        })],
    [/^UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = \$1$/,
        ([id]) => {
            change(id, { last_seen: new Date() });
            return [];
        }],
    [/^UPDATE users SET pseudo = \$2, pseudo_chosen = TRUE WHERE id = \$1 RETURNING \*$/,
        ([id, pseudo]) => change(id, { pseudo, pseudo_chosen: true })],
    [/^INSERT INTO refresh_tokens \(user_id, token, expires_at\)/,
        ([userId, token, expiresAt]) => {
            refreshTokens.push({ user_id: userId, token, expires_at: expiresAt });
            return [{ token }];
        }],
];

const realQuery = database.query;
database.query = async (sql, params = []) => {
    const statement = sql.replace(/\s+/g, ' ').trim();
    const known = STATEMENTS.find(([shape]) => shape.test(statement));
    if (!known) return realQuery(sql, params);
    const rows = known[1](params);
    return { rows, rowCount: rows.length };
};

const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const googleAuth = require('../services/googleAuthService');
const { unauthorized } = require('../middleware/errorHandler');

/* Google, as far as the endpoint can tell: a credential it vouches for, and
   who for. Any other is refused the way the real check refuses one. */
const vouched = new Map();
googleAuth.verifyIdToken = async (credential) => {
    if (!vouched.has(credential)) throw unauthorized('Google rejected this sign-in');
    return { ...vouched.get(credential) };
};

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

async function run() {
    /* The API under test, without the rest of the server, as in
       emailAccount.test.js. */
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
        try { json = await response.json(); } catch { /* empty body */ }
        return { status: response.status, body: json || {} };
    };
    const signIn = (credential) => send('POST', '/google', { body: { credential } });

    console.log('\nSigning in with Google\n');

    await test('a first sign-in creates the account and opens a session for it', async () => {
        vouched.set('credential-new', {
            googleId: 'google-new', email: 'nouveau@example.invalid',
            name: 'Nouveau Joueur', picture: 'https://example.invalid/new.png',
        });
        const { status, body } = await signIn('credential-new');
        assert.strictEqual(status, 200, `answered ${status}: ${body.message}`);

        const row = [...users.values()].find((r) => r.google_id === 'google-new');
        assert.ok(row, 'the account was written');
        assert.strictEqual(body.created, true);
        assert.strictEqual(body.user.id, row.id);
        assert.strictEqual(body.user.pseudo, 'Nouveau Joueur', 'seeded from the Google name');
        assert.strictEqual(body.needsPseudo, true, 'and the player is asked for their own');

        // The same session a password sign-in issues: see emailAccount.test.js.
        const claims = jwt.verify(body.accessToken, JWT_SECRET);
        assert.strictEqual(claims.userId, row.id, 'the token is for that account');
        assert.strictEqual(claims.pseudo, 'Nouveau Joueur');
        assert.ok(refreshTokens.some((t) => t.user_id === row.id && t.token === body.refreshToken),
            'the refresh token is the one stored for that account');
    });

    let stranded = null;
    let session = null;

    await test('an account a failed sign-in left behind signs in, and is asked for a nickname', async () => {
        /* What every Google sign-in left until now: findOrCreateUser wrote the
           row, then the endpoint failed before a session was issued. */
        const claims = { googleId: 'google-stranded', email: 'echoue@example.invalid', name: 'Rescapé', picture: null };
        ({ user: stranded } = await googleAuth.findOrCreateUser(claims));
        assert.strictEqual(stranded.pseudo_chosen, false);
        const accounts = users.size;

        vouched.set('credential-stranded', claims);
        const { status, body } = await signIn('credential-stranded');
        assert.strictEqual(status, 200, `answered ${status}: ${body.message}`);
        assert.strictEqual(body.user.id, stranded.id, 'the account already there');
        assert.strictEqual(users.size, accounts, 'not a second one');
        assert.strictEqual(body.created, false);
        assert.strictEqual(body.needsPseudo, true);
        session = body.accessToken;

        // A reload asks again, with the token it was given.
        const me = await send('GET', '/me', { token: session });
        assert.strictEqual(me.status, 200, `/me answered ${me.status}: ${me.body.message}`);
        assert.strictEqual(me.body.user.id, stranded.id);
        assert.strictEqual(me.body.needsPseudo, true, 'still asked after a reload');
    });

    await test('choosing a nickname ends the asking', async () => {
        assert.ok(session, 'needs the session from the test before');
        const chosen = await send('PUT', '/pseudo', { body: { pseudo: 'Enfin Moi' }, token: session });
        assert.strictEqual(chosen.status, 200, `/pseudo answered ${chosen.status}: ${chosen.body.message}`);
        assert.strictEqual(chosen.body.user.pseudo, 'Enfin Moi');
        assert.strictEqual(chosen.body.needsPseudo, false);

        const me = await send('GET', '/me', { token: session });
        assert.strictEqual(me.body.needsPseudo, false);
        assert.strictEqual(users.get(stranded.id).pseudo_chosen, true);
    });

    await test('an address registered with a password is linked, and keeps its nickname', async () => {
        const [legacy] = account({
            email: 'ancien@example.invalid', pseudo: 'Ancien',
            password_hash: '$2a$04$not-a-real-hash', pseudo_chosen: true,
        });
        vouched.set('credential-linked', {
            googleId: 'google-linked', email: 'ancien@example.invalid', name: 'Someone Else', picture: null,
        });
        const { status, body } = await signIn('credential-linked');
        assert.strictEqual(status, 200, `answered ${status}: ${body.message}`);
        assert.strictEqual(body.user.id, legacy.id, 'the same account, now with Google');
        assert.strictEqual(users.get(legacy.id).google_id, 'google-linked');
        assert.strictEqual(body.user.pseudo, 'Ancien');
        assert.strictEqual(body.needsPseudo, false, 'a nickname chosen at sign-up is not asked again');
        assert.ok(jwt.verify(body.accessToken, JWT_SECRET).userId === legacy.id);
    });

    await test('a credential Google refuses opens nothing and writes nothing', async () => {
        const accounts = users.size;
        const tokens = refreshTokens.length;
        const { status, body } = await signIn('forged');
        assert.strictEqual(status, 401);
        assert.strictEqual(body.accessToken, undefined);
        assert.strictEqual(users.size, accounts);
        assert.strictEqual(refreshTokens.length, tokens);
    });

    await new Promise((resolve) => api.close(resolve));
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run().catch((error) => {
    console.error('harness crashed:', error);
    process.exit(1);
});
