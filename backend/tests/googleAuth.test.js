/**
 * Google sign-in and nicknames, exercised against the real database.
 *
 * Run with: node tests/googleAuth.test.js
 *
 * Token verification itself belongs to Google's library and cannot be
 * meaningfully faked here; what these tests cover is everything we do with the
 * verified claims — which account it resolves to, what a nickname is allowed to
 * be, and what leaks to the client.
 *
 * Every row created is removed afterwards, so the suite is safe to re-run.
 */

const assert = require('assert');
const { pool, query } = require('../config/database');
const googleAuth = require('../services/googleAuthService');

let passed = 0;
let failed = 0;
const created = new Set();

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

const claims = (suffix, name) => ({
    googleId: `test-google-${suffix}`,
    email: `hexaequo-test-${suffix}@example.invalid`,
    name: name || `Test ${suffix}`,
    picture: 'https://example.invalid/avatar.png',
});

async function remember(user) {
    created.add(user.id);
    return user;
}

async function run() {
    console.log('\nGoogle sign-in\n');

    await test('a new Google identity creates an account with a provisional nickname', async () => {
        const { user, created: isNew } = await googleAuth.findOrCreateUser(claims('alpha', 'Piero Barrette'));
        await remember(user);
        assert.strictEqual(isNew, true);
        assert.strictEqual(user.google_id, 'test-google-alpha');
        assert.strictEqual(user.email_verified, true, 'Google vouched for the address');
        assert.strictEqual(user.pseudo_chosen, false, 'the player has not chosen yet');
        assert.strictEqual(user.pseudo, 'Piero Barrette');
        assert.strictEqual(user.password_hash, null, 'no password for a Google-only account');
        assert.strictEqual(user.elo, 1000, 'everyone starts level');
    });

    await test('signing in again returns the same account, not a second one', async () => {
        const first = await googleAuth.findOrCreateUser(claims('beta'));
        await remember(first.user);
        const second = await googleAuth.findOrCreateUser(claims('beta'));
        assert.strictEqual(second.created, false);
        assert.strictEqual(second.user.id, first.user.id);
        const { rows } = await query('SELECT count(*)::int AS n FROM users WHERE google_id = $1', ['test-google-beta']);
        assert.strictEqual(rows[0].n, 1, 'exactly one row');
    });

    await test('a nickname already taken gets a suffix rather than colliding', async () => {
        const first = await googleAuth.findOrCreateUser(claims('gamma', 'Samename'));
        await remember(first.user);
        const second = await googleAuth.findOrCreateUser(claims('delta', 'Samename'));
        await remember(second.user);
        assert.strictEqual(first.user.pseudo, 'Samename');
        assert.notStrictEqual(second.user.pseudo, 'Samename');
        assert.match(second.user.pseudo, /^Sameno?e?-\d{4}$|^Samename-\d{4}$/, `unexpected: ${second.user.pseudo}`);
    });

    await test('an existing password account with the same address is linked, not duplicated', async () => {
        const bcrypt = require('bcryptjs');
        const hash = await bcrypt.hash('irrelevant', 4);
        const { rows } = await query(
            `INSERT INTO users (email, pseudo, password_hash) VALUES ($1, $2, $3) RETURNING *`,
            ['hexaequo-test-epsilon@example.invalid', 'LegacyAccount', hash]
        );
        await remember(rows[0]);
        assert.strictEqual(rows[0].google_id, null);

        const linked = await googleAuth.findOrCreateUser({
            googleId: 'test-google-epsilon',
            email: 'hexaequo-test-epsilon@example.invalid',
            name: 'Someone Else',
            picture: null,
        });
        assert.strictEqual(linked.user.id, rows[0].id, 'same account');
        assert.strictEqual(linked.user.google_id, 'test-google-epsilon');
        assert.strictEqual(linked.user.pseudo, 'LegacyAccount', 'their existing nickname is kept');
        const count = await query('SELECT count(*)::int AS n FROM users WHERE lower(email) = $1',
            ['hexaequo-test-epsilon@example.invalid']);
        assert.strictEqual(count.rows[0].n, 1, 'no second account for the same person');
    });

    await test('choosing a nickname marks it as chosen', async () => {
        const { user } = await googleAuth.findOrCreateUser(claims('zeta'));
        await remember(user);
        const updated = await googleAuth.setPseudo(user.id, '  Le  Joueur ');
        assert.strictEqual(updated.pseudo, 'Le Joueur', 'trimmed and collapsed');
        assert.strictEqual(updated.pseudo_chosen, true);
    });

    await test('a nickname in use is refused', async () => {
        const a = await googleAuth.findOrCreateUser(claims('eta', 'Occupant'));
        await remember(a.user);
        const b = await googleAuth.findOrCreateUser(claims('theta'));
        await remember(b.user);
        await assert.rejects(
            () => googleAuth.setPseudo(b.user.id, 'occupant'),   // case-insensitive
            (error) => error.statusCode === 409,
            'expected a conflict'
        );
    });

    await test('malformed nicknames are refused', async () => {
        for (const bad of ['ab', 'x'.repeat(21), 'bad--name', ' -leading', '<script>', '']) {
            assert.throws(() => googleAuth.normalisePseudo(bad),
                (error) => error.statusCode === 400, `accepted ${JSON.stringify(bad)}`);
        }
        for (const good of ['Piero', 'Jean Dupont', 'ok_name-1', 'Élodie', '玩家一二三']) {
            assert.ok(googleAuth.normalisePseudo(good), `refused ${JSON.stringify(good)}`);
        }
    });

    await test('the public view never carries the password hash', async () => {
        const bcrypt = require('bcryptjs');
        const hash = await bcrypt.hash('secret', 4);
        const { rows } = await query(
            `INSERT INTO users (email, pseudo, password_hash) VALUES ($1, $2, $3) RETURNING *`,
            ['hexaequo-test-iota@example.invalid', 'HashHolder', hash]
        );
        await remember(rows[0]);
        const view = googleAuth.publicUser(rows[0]);
        const serialised = JSON.stringify(view);
        assert.ok(!('password_hash' in view), 'no password_hash key');
        assert.ok(!serialised.includes(hash), 'the hash does not leak by any other name');
        assert.ok(!serialised.includes('verification_token'), 'no verification token either');
        assert.strictEqual(view.pseudo, 'HashHolder');
    });

    // Clean up every row this suite created.
    for (const id of created) {
        await query('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
    }
    const leftovers = await query(
        "SELECT count(*)::int AS n FROM users WHERE email LIKE 'hexaequo-test-%@example.invalid'");
    console.log(`\ncleanup: ${leftovers.rows[0].n} test row(s) left behind`);

    await pool.end();
    console.log(`${passed} passed, ${failed} failed\n`);
    process.exit(failed || leftovers.rows[0].n ? 1 : 0);
}

run().catch((error) => {
    console.error('harness crashed:', error);
    process.exit(1);
});
