/**
 * The API as server.js mounts it.
 *
 * Run with: node tests/api.test.js
 *
 * No database. The other suites mount the one router they are about; this one
 * starts the server itself, so it is the suite that notices what only the
 * server decides -- a route still mounted that should not be, one that has
 * gone, the answer for an address under /api/ that is nothing, a file the
 * server requires that is no longer there. None of that showed anywhere
 * before a deploy did.
 *
 * The SQL the routes below send is answered from two small tables kept here.
 * Any statement this file does not know fails by name, so a query nobody
 * expected cannot pass for a result.
 */

// Before anything else: this suite writes nothing, so it gets nothing to
// write to. See tests/database.js.
require('./database').none();

/* Set before the configuration is read: the rate limiter and the error
   handler behave as under test, and the server listens on any free port. */
process.env.NODE_ENV = 'test';
process.env.PORT = '0';

const assert = require('assert');
const jwt = require('jsonwebtoken');

const flat = (sql) => String(sql).replace(/\s+/g, ' ').trim();

/*
 * The users and games tables, as far as these routes reach.
 *
 * Installed before the server is required, since the services take their own
 * copy of `query` as they load.
 */
const database = require('../config/database');
const users = new Map();
const games = [];
let lastId = 0;

const copies = (rows) => rows.map((row) => ({ ...row }));
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const nextId = () => `00000000-0000-4000-8000-${String(++lastId).padStart(12, '0')}`;

function account(pseudo) {
    const row = {
        id: nextId(), email: `${pseudo.toLowerCase().replace(/\W/g, '')}@example.com`, pseudo,
        pseudo_chosen: true, elo: 1000, avatar_url: null, country_code: null, created_at: new Date(),
    };
    users.set(row.id, row);
    return row;
}

/** A finished game. Rated, the four elo columns are filled; a friendly leaves them null. */
function game(black, white, { rated, finishedAt }) {
    const row = {
        id: nextId(), black_player_id: black.id, black_pseudo: black.pseudo,
        white_player_id: white.id, white_pseudo: white.pseudo,
        black_elo_before: rated ? 1000 : null, black_elo_after: rated ? 1016 : null,
        white_elo_before: rated ? 1000 : null, white_elo_after: rated ? 984 : null,
        time_mode: rated ? 'rapid' : 'none', winner: 'black', result_reason: 'disks',
        finished_at: finishedAt,
    };
    games.push(row);
    return row;
}

/*
 * Which games of a player's a history asks for.
 *
 * Two questions are known: every game the player finished, and those with the
 * line /api/profile draws -- the rated ones -- read from profileService itself
 * so this cannot agree with a copy. Anything else fails by name.
 */
const PLAYED = '(g.black_player_id = $1 OR g.white_player_id = $1) AND g.winner IS NOT NULL';
const squash = (sql) => String(sql).replace(/\s+/g, '');
function historyFilter(where) {
    if (squash(where) === squash(PLAYED)) return () => true;
    const { RATED_FOR } = require('../services/profileService');
    if (squash(where) === squash(`${PLAYED} AND (${RATED_FOR('$1')})`)) {
        return (row, id) => {
            const black = row.black_player_id === id;
            const before = black ? row.black_elo_before : row.white_elo_before;
            const after = black ? row.black_elo_after : row.white_elo_after;
            return before !== null && after !== null;
        };
    }
    return null;
}

function history(where, id) {
    const keep = historyFilter(where);
    if (!keep) return null;
    return games
        .filter((row) => (row.black_player_id === id || row.white_player_id === id) && row.winner !== null)
        .filter((row) => keep(row, id))
        .sort((a, b) => b.finished_at - a.finished_at);
}

/** A game as the history lists it, from the side of the player asked about. */
function asListed(row, id) {
    const black = row.black_player_id === id;
    return {
        id: row.id, time_mode: row.time_mode, winner: row.winner,
        result_reason: row.result_reason, finished_at: row.finished_at,
        player_color: black ? 'black' : 'white',
        opponent_pseudo: black ? row.white_pseudo : row.black_pseudo,
    };
}

const STATEMENTS = [
    // gameModel.getUserMatchHistory: the count, then the page.
    [/^SELECT COUNT\(\*\) FROM games g WHERE (.+)$/,
        ([id], where) => {
            const rows = history(where, id);
            return rows && [{ count: String(rows.length) }];
        }],
    [/^SELECT g\.id, g\.time_mode, .+ FROM games g WHERE (.+) ORDER BY g\.finished_at DESC LIMIT \$\d+ OFFSET \$\d+$/,
        (params, where) => {
            const [id] = params;
            const [limit, offset] = params.slice(-2);
            const rows = history(where, id);
            return rows && rows.slice(offset, offset + limit).map((row) => asListed(row, id));
        }],
    // accountService.setPseudo: the clash, then the rename.
    [/^SELECT 1 FROM users WHERE lower\(pseudo\) = lower\(\$1\) AND id <> \$2 LIMIT 1$/,
        ([pseudo, id]) => copies([...users.values()].filter((row) => same(row.pseudo, pseudo) && row.id !== id)).slice(0, 1)],
    [/^UPDATE users SET pseudo = \$2, pseudo_chosen = TRUE WHERE id = \$1 RETURNING \*$/,
        ([id, pseudo]) => {
            if (!users.has(id)) return [];
            users.set(id, { ...users.get(id), pseudo, pseudo_chosen: true });
            return copies([users.get(id)]);
        }],
];

const realQuery = database.query;
database.query = async (sql, params = []) => {
    const statement = flat(sql);
    for (const [shape, answer] of STATEMENTS) {
        const match = statement.match(shape);
        if (!match) continue;
        const rows = answer(params, match[1]);
        if (rows) return { rows, rowCount: rows.length };
    }
    return realQuery(sql, params);
};

const { JWT_SECRET } = require('../config/env');
const tokenFor = (user) => jwt.sign({ userId: user.id, email: user.email, pseudo: user.pseudo },
    JWT_SECRET, { expiresIn: '1h' });

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
        console.log(`        ${error.message.split('\n').join('\n        ')}`);
    }
}

/*
 * The server, started as Render starts it, on a free port.
 *
 * Its start-up lines -- the banner, the database it does not have, the
 * notifications it cannot send -- are not this suite's to print.
 */
async function startServer() {
    const quiet = { log: console.log, error: console.error };
    console.log = () => {};
    console.error = () => {};
    try {
        const { httpServer, io } = require('../server');
        await new Promise((resolve, reject) => {
            if (httpServer.listening) return resolve();
            httpServer.once('listening', resolve);
            httpServer.once('error', reject);
        });
        // What it does once listening, with nothing to wait on, is done by the next turn.
        await new Promise((resolve) => setImmediate(resolve));
        return { httpServer, io, origin: `http://127.0.0.1:${httpServer.address().port}` };
    } finally {
        console.log = quiet.log;
        console.error = quiet.error;
    }
}

async function run() {
    const server = await startServer();

    const send = async (method, path, { body, token } = {}) => {
        const response = await fetch(server.origin + path, {
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

    console.log('\nThe API as the server mounts it\n');

    await test('the server starts, and the API it mounts answers', async () => {
        const { status, body } = await send('GET', '/api/version');
        assert.strictEqual(status, 200);
        assert.ok(body.build, 'with the build it is serving');
    });

    await test('the routes the previous front end called are gone, with the same 404 as any made-up path', async () => {
        const someGame = '11111111-1111-4111-8111-111111111111';
        const gone = [
            ['GET', '/api/rooms'], ['GET', '/api/rooms/ABCD2345'], ['POST', '/api/rooms'],
            ['POST', '/api/rooms/ABCD2345/join'], ['POST', '/api/rooms/ABCD2345/leave'],
            ['GET', '/api/games'], ['GET', '/api/games/leaderboard'], ['GET', '/api/games/not-a-uuid'],
            ['GET', `/api/games/${someGame}`], ['GET', `/api/games/${someGame}/replay`],
            ['GET', '/api/matchmaking/preferences'], ['PUT', '/api/matchmaking/preferences'],
            ['POST', '/api/matchmaking/invitations'], ['GET', '/api/matchmaking/invitations/ABCD2345'],
            ['POST', '/api/matchmaking/invitations/ABCD2345/accept'],
            ['DELETE', '/api/matchmaking/invitations/ABCD2345'],
            ['POST', '/api/ai/move'], ['GET', '/api/ai/rating'],
        ];
        for (const [method, path] of gone) {
            const answer = await send(method, path, { body: method === 'POST' || method === 'PUT' ? {} : undefined });
            assert.strictEqual(answer.status, 404, `${method} ${path}: ${JSON.stringify(answer.body)}`);
            assert.deepStrictEqual(answer.body,
                { error: 'Not Found', message: `Route ${method} ${path} not found` }, `${method} ${path}`);
        }
    });

    await test('an address under /api/ that is nothing says which address it was', async () => {
        const plain = await send('GET', '/api/nothing-here?with=a-query');
        assert.strictEqual(plain.status, 404);
        assert.strictEqual(plain.body.message, 'Route GET /api/nothing-here not found',
            'the path asked for, not "/" -- and not the query');
        const deeper = await send('DELETE', '/api/push/nothing/here');
        assert.strictEqual(deeper.body.message, 'Route DELETE /api/push/nothing/here not found',
            'under a router that is mounted, too');
    });

    const celine = account('Céline Roy');
    const olivier = account('Olivier');
    const marc = account('Marc');
    const rated = game(celine, olivier, { rated: true, finishedAt: new Date('2026-10-01T20:00:00Z') });
    const friendly = game(celine, olivier, { rated: false, finishedAt: new Date('2026-10-02T20:00:00Z') });
    const another = game(olivier, celine, { rated: false, finishedAt: new Date('2026-10-03T20:00:00Z') });
    const listed = (answer) => (answer.body.data || []).map((row) => row.id);

    await test("someone else's matches are the rated ones, as on /api/profile", async () => {
        const visitor = await send('GET', `/api/users/${celine.id}/matches`);
        assert.strictEqual(visitor.status, 200, JSON.stringify(visitor.body));
        assert.deepStrictEqual(listed(visitor), [rated.id], 'signed out: the rated game, and only that');
        assert.strictEqual(visitor.body.meta.total, 1, 'counted the same way, so the total gives nothing away');

        const stranger = await send('GET', `/api/users/${celine.id}/matches`, { token: tokenFor(marc) });
        assert.deepStrictEqual(listed(stranger), [rated.id], 'signed in as somebody else: the same');

        const opponent = await send('GET', `/api/users/${celine.id}/matches`, { token: tokenFor(olivier) });
        assert.deepStrictEqual(listed(opponent), [rated.id],
            "the other player of a friendly finds it in their own history, not in hers");
    });

    await test('your own matches are all of them, friendlies included', async () => {
        const own = await send('GET', `/api/users/${celine.id}/matches`, { token: tokenFor(celine) });
        assert.strictEqual(own.status, 200, JSON.stringify(own.body));
        assert.deepStrictEqual(listed(own), [another.id, friendly.id, rated.id], 'most recent first');
        assert.strictEqual(own.body.meta.total, 3);
    });

    await test('PATCH /api/users/me renames by the rule PUT /api/auth/pseudo uses', async () => {
        const token = tokenFor(marc);
        const renamed = await send('PATCH', '/api/users/me', { token, body: { pseudo: '  Marc-André  Côté ' } });
        assert.strictEqual(renamed.status, 200, JSON.stringify(renamed.body));
        assert.strictEqual(renamed.body.data.pseudo, 'Marc-André Côté',
            'accents and a space, trimmed, as a rename allows -- the older rule here refused both');
        assert.strictEqual(users.get(marc.id).pseudo_chosen, true, 'and the nickname counts as chosen');

        const cases = [
            ['x', 400, 'BAD_PSEUDO'],
            ['Twenty-five characters!!', 400, 'BAD_PSEUDO'],
            ['abcdefghijklmnopqrstuvwxy', 400, 'BAD_PSEUDO'],
            ['OLIVIER', 409, 'PSEUDO_TAKEN'],
            ['céline ROY', 409, 'PSEUDO_TAKEN'],
        ];
        for (const [pseudo, status, code] of cases) {
            const answer = await send('PATCH', '/api/users/me', { token, body: { pseudo } });
            assert.strictEqual(answer.status, status, `${pseudo}: ${JSON.stringify(answer.body)}`);
            assert.strictEqual(answer.body.error, code, pseudo);
        }
        assert.strictEqual(users.get(marc.id).pseudo, 'Marc-André Côté', 'and a refusal changes nothing');

        const sameRule = await send('PUT', '/api/auth/pseudo', { token, body: { pseudo: 'abcdefghijklmnopqrstuvwxy' } });
        assert.strictEqual(sameRule.body.error, 'BAD_PSEUDO', 'which is what the other door says to the same name');
    });

    server.io.close();
    server.httpServer.close();
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
