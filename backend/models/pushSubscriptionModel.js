/**
 * Where each device that asked for notifications can be reached.
 *
 * One row per browser per device. The endpoint is the address a push service
 * (Google's, Mozilla's, Apple's, Microsoft's) handed that browser; the two keys
 * are what every message is encrypted to, so that nobody between this server
 * and the device can read it. Someone with a phone and a laptop has two rows.
 *
 * The table is the app's own bookkeeping and the app keeps it tidy: a row the
 * push service says is gone is removed, and nothing else in the database is
 * touched from here except to read it.
 *
 * With no database in the process (DATABASE_URL=memory: the test suites and
 * the hand-testing server) the same calls are answered from memory, so a
 * notification can be tried end to end without a row being written anywhere.
 */

const database = require('../config/database');

/* Through the module object rather than a copy taken at load time, so a test
   that stands in for the database is the database these functions use. */
const query = (text, params) => database.query(text, params);
const inMemory = () => !database.hasDatabase();

/* More than this per account is not a household of devices, it is a browser
   that kept re-subscribing; the oldest go first. */
const MAX_PER_USER = 10;

const TABLE = `
    CREATE TABLE IF NOT EXISTS push_subscriptions (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh VARCHAR(200) NOT NULL,
        auth VARCHAR(100) NOT NULL,
        user_agent VARCHAR(300),
        time_zone VARCHAR(64),             -- for anything sent at an hour of the day
        language VARCHAR(8),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,   -- the account was last on the site
        reminded_at TIMESTAMP                             -- the last reminder this account was sent
    );
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
`;

/* ── Memory, for a process with no database ───────────────────────────── */

const memory = {
    rows: new Map(),          // endpoint → row
    settings: new Map(),      // userId → the account's settings, as users.settings would hold them
    nextId: 1,
};

/** Stand in for users.settings when there is no users table (tests, hand-testing). */
function useSettings(userId, settings) {
    memory.settings.set(userId, settings || {});
}

function memoryRowsOf(userId) {
    return [...memory.rows.values()].filter((row) => row.user_id === userId);
}

/* ── The calls ────────────────────────────────────────────────────────── */

/** Create the table if this database has never had it. Safe to run every start. */
async function ensureTable() {
    if (inMemory()) return;
    await query(TABLE);
}

/**
 * Remember a device for an account, or move it to the account now using it.
 *
 * The endpoint identifies the browser, not the person: when somebody else signs
 * in on the same browser and asks for notifications, the row becomes theirs
 * rather than going on telling the first account's news to the second person.
 */
async function save({ userId, endpoint, p256dh, auth, userAgent, timeZone, language }) {
    if (inMemory()) {
        const now = new Date();
        const was = memory.rows.get(endpoint);
        memory.rows.set(endpoint, {
            id: was ? was.id : memory.nextId++,
            user_id: userId, endpoint, p256dh, auth,
            user_agent: userAgent || null, time_zone: timeZone || null, language: language || null,
            created_at: was ? was.created_at : now,
            visited_at: now,
            reminded_at: was && was.user_id === userId ? was.reminded_at : null,
        });
        const mine = memoryRowsOf(userId).sort((a, b) => b.visited_at - a.visited_at || b.id - a.id);
        for (const extra of mine.slice(MAX_PER_USER)) memory.rows.delete(extra.endpoint);
        return;
    }
    await query(
        `INSERT INTO push_subscriptions
             (user_id, endpoint, p256dh, auth, user_agent, time_zone, language)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (endpoint) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth,
             user_agent = EXCLUDED.user_agent,
             time_zone = EXCLUDED.time_zone,
             language = EXCLUDED.language,
             visited_at = CURRENT_TIMESTAMP`,
        [userId, endpoint, p256dh, auth, userAgent || null, timeZone || null, language || null]
    );
    await query(
        `DELETE FROM push_subscriptions
          WHERE user_id = $1
            AND id NOT IN (SELECT id FROM push_subscriptions WHERE user_id = $1
                            ORDER BY visited_at DESC, id DESC LIMIT $2)`,
        [userId, MAX_PER_USER]
    );
}

/**
 * A push service handed this browser a new address: carry the row across.
 *
 * Knowing the old endpoint is the proof — it is a long, unguessable URL that
 * only the browser and this server have ever seen.
 */
async function renew(oldEndpoint, { endpoint, p256dh, auth }) {
    if (inMemory()) {
        const row = memory.rows.get(oldEndpoint);
        if (!row) return false;
        memory.rows.delete(oldEndpoint);
        memory.rows.set(endpoint, { ...row, endpoint, p256dh, auth });
        return true;
    }
    const { rowCount } = await query(
        `UPDATE push_subscriptions SET endpoint = $2, p256dh = $3, auth = $4
          WHERE endpoint = $1`,
        [oldEndpoint, endpoint, p256dh, auth]
    );
    return rowCount > 0;
}

async function removeByEndpoint(endpoint) {
    if (inMemory()) { memory.rows.delete(endpoint); return; }
    await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

async function removeById(id) {
    if (inMemory()) {
        for (const [endpoint, row] of memory.rows) if (row.id === id) memory.rows.delete(endpoint);
        return;
    }
    await query('DELETE FROM push_subscriptions WHERE id = $1', [id]);
}

/** Every device of one account, with the account's settings beside them. */
async function forUser(userId) {
    if (inMemory()) {
        const settings = memory.settings.get(userId) || {};
        return memoryRowsOf(userId).map((row) => ({ ...row, settings }));
    }
    const { rows } = await query(
        `SELECT s.id, s.endpoint, s.p256dh, s.auth, s.language, u.settings
           FROM push_subscriptions s
           JOIN users u ON u.id = s.user_id
          WHERE s.user_id = $1`,
        [userId]
    );
    return rows;
}

/** The account was on the site just now. */
async function touchVisit(userId) {
    if (inMemory()) {
        for (const row of memoryRowsOf(userId)) row.visited_at = new Date();
        return;
    }
    await query('UPDATE push_subscriptions SET visited_at = CURRENT_TIMESTAMP WHERE user_id = $1', [userId]);
}

/**
 * Everybody who could be sent a reminder, with what deciding needs.
 *
 * One row per account. The time zone is the one their most recently used
 * device reported; the last game is read from the games table, which is the
 * only place it is kept.
 */
async function reminderCandidates() {
    if (inMemory()) {
        const byUser = new Map();
        for (const row of memory.rows.values()) {
            const seen = byUser.get(row.user_id);
            if (!seen) {
                byUser.set(row.user_id, {
                    user_id: row.user_id,
                    settings: memory.settings.get(row.user_id) || {},
                    visited_at: row.visited_at,
                    reminded_at: row.reminded_at,
                    time_zone: row.time_zone,
                    played_at: null,
                });
                continue;
            }
            if (row.visited_at > seen.visited_at) {
                seen.visited_at = row.visited_at;
                seen.time_zone = row.time_zone;
            }
            if (row.reminded_at && (!seen.reminded_at || row.reminded_at > seen.reminded_at)) {
                seen.reminded_at = row.reminded_at;
            }
        }
        return [...byUser.values()];
    }
    const { rows } = await query(
        `SELECT s.user_id, u.settings,
                MAX(s.visited_at) AS visited_at,
                MAX(s.reminded_at) AS reminded_at,
                (ARRAY_AGG(s.time_zone ORDER BY s.visited_at DESC NULLS LAST))[1] AS time_zone,
                (SELECT MAX(g.finished_at) FROM games g
                  WHERE g.black_player_id = s.user_id OR g.white_player_id = s.user_id) AS played_at
           FROM push_subscriptions s
           JOIN users u ON u.id = s.user_id
          GROUP BY s.user_id, u.id`
    );
    return rows;
}

/* In memory the clock is the caller's, so a test can run the scheduler at an
   hour of its choosing; the database keeps its own. */
async function markReminded(userId, at = Date.now()) {
    if (inMemory()) {
        for (const row of memoryRowsOf(userId)) row.reminded_at = new Date(at);
        return;
    }
    await query('UPDATE push_subscriptions SET reminded_at = CURRENT_TIMESTAMP WHERE user_id = $1', [userId]);
}

module.exports = {
    TABLE, MAX_PER_USER,
    ensureTable, save, renew, removeByEndpoint, removeById, forUser, touchVisit,
    reminderCandidates, markReminded,
    useSettings, memory,
};
