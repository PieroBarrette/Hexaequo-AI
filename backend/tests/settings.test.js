/**
 * Preferences that belong to the account rather than to the browser.
 *
 * Run with: node tests/settings.test.js
 *
 * The column they live in is older than the app that now uses it and carries
 * keys from a design that no longer exists. What matters here is that a write
 * merges rather than replaces, that it survives, and that one account cannot
 * read or write another's.
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { pool, query } = require('../config/database');
const { JWT_SECRET } = require('../config/env');

let passed = 0;
let failed = 0;
const made = new Set();

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

async function makeUser(tag) {
    const email = `settings-test-${tag}@example.invalid`;
    await query('DELETE FROM users WHERE email = $1', [email]);
    const { rows } = await query(
        `INSERT INTO users (email, pseudo, google_id, elo, email_verified, pseudo_chosen)
         VALUES ($1,$2,$3,1000,TRUE,TRUE) RETURNING *`,
        [email, `SettingsTest${tag}`, `settings-test-${tag}`]
    );
    made.add(rows[0].id);
    return {
        user: rows[0],
        token: jwt.sign({ userId: rows[0].id, email, pseudo: rows[0].pseudo },
            JWT_SECRET, { expiresIn: '1h' }),
    };
}

async function run() {
    const app = express();
    app.use(express.json());
    app.use('/api/users', require('../routes/userRoutes'));
    app.use(require('../middleware/errorHandler').errorHandler);

    const api = http.createServer(app);
    await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${api.address().port}/api/users`;

    const call = async (method, path, token, body) => {
        const response = await fetch(base + path, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        let json = null;
        try { json = await response.json(); } catch { /* empty body */ }
        return { status: response.status, body: json || {} };
    };

    console.log('\nSettings that follow the account\n');

    await test('what one device saves, another reads back', async () => {
        const me = await makeUser('a');
        const wrote = await call('PATCH', '/me/settings', me.token, {
            theme: 'light', boardStyle: 'classic', volume: 0.25, aiLevel: 3,
        });
        assert.strictEqual(wrote.status, 200, 'the write was accepted');

        const read = await call('GET', '/me/settings', me.token);
        assert.strictEqual(read.status, 200);
        assert.strictEqual(read.body.data.theme, 'light');
        assert.strictEqual(read.body.data.boardStyle, 'classic');
        assert.strictEqual(read.body.data.volume, 0.25);
        assert.strictEqual(read.body.data.aiLevel, 3);
    });

    await test('a second write changes one key and leaves the rest', async () => {
        /* The column merges rather than replaces, which is what lets a single
           toggle be sent on its own instead of the whole object every time. */
        const me = await makeUser('b');
        await call('PATCH', '/me/settings', me.token, { theme: 'dark', volume: 0.9 });
        await call('PATCH', '/me/settings', me.token, { theme: 'light' });

        const read = await call('GET', '/me/settings', me.token);
        assert.strictEqual(read.body.data.theme, 'light', 'the new value');
        assert.strictEqual(read.body.data.volume, 0.9, 'and the old one still there');
    });

    await test('one account cannot read or write another', async () => {
        const mine = await makeUser('c');
        const theirs = await makeUser('d');
        await call('PATCH', '/me/settings', mine.token, { boardStyle: 'classic' });
        await call('PATCH', '/me/settings', theirs.token, { boardStyle: 'modern' });

        const read = await call('GET', '/me/settings', mine.token);
        assert.strictEqual(read.body.data.boardStyle, 'classic', 'mine, not theirs');

        const anonymous = await call('GET', '/me/settings', null);
        assert.strictEqual(anonymous.status, 401, 'and not readable without a name');
    });

    await test('an account that has saved nothing yet answers with defaults', async () => {
        /* Which is what tells the first device to sign in that it should seed
           the account from what is on this machine. */
        const me = await makeUser('e');
        const read = await call('GET', '/me/settings', me.token);
        assert.strictEqual(read.status, 200);
        assert.strictEqual(read.body.data.boardStyle, undefined,
            'no key this app owns is there yet');
    });

    api.close();
    const left = await query(
        "SELECT count(*)::int AS n FROM users WHERE email LIKE 'settings-test-%@example.invalid'");
    console.log(`\ncleanup: ${left.rows[0].n} test row(s) left behind, as they should be`);
    await pool.end();
    console.log(`${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run().catch((error) => {
    console.error('harness crashed:', error);
    process.exit(1);
});
