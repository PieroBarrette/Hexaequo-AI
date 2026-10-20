/**
 * Days in a row: how many days running, up to today, a player has played.
 *
 * A day is the player's own, midnight to midnight in the time zone their
 * browser names, so a game at 23:50 in Montréal belongs to that evening
 * whatever the date already is in UTC. Today counts as soon as a game has been
 * played in it, and not having played yet breaks nothing: until midnight,
 * yesterday's streak is still standing and still theirs to carry on — which
 * is exactly what the evening reminder is about.
 *
 * What counts (Piero's choice, 2026-10-19) is a finished online game, rated or
 * friendly, against an account or a guest. A game against yourself — two tabs
 * on one account — is not a day played, and neither is a room given up before
 * a single move was made.
 *
 * Nothing new is kept: the games table already says when each game ended, and
 * the browser says which zone it is in each time it asks. Shown to the player
 * alone, on their own profile and on the card at the end of a game.
 */

const database = require('../config/database');

const DAY_MS = 24 * 60 * 60 * 1000;

/* ── Days where the player is ──────────────────────────────────────────── */

/** The zone as the runtime names it, or UTC for one it does not know. */
function zoneOf(timeZone) {
    const zone = typeof timeZone === 'string' ? timeZone.trim().slice(0, 64) : '';
    if (!zone) return 'UTC';
    try {
        return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

/* One formatter per zone, kept: building one costs far more than using it,
   and all of a player's games are read in the same zone. Keyed by the
   runtime's own name for the zone, so there are only ever as many as there
   are zones. */
const formatters = new Map();

function formatterFor(zone) {
    let formatter = formatters.get(zone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric',
        });
        formatters.set(zone, formatter);
    }
    return formatter;
}

function dayWith(formatter, at) {
    if (at === null || at === undefined) return null;
    const ms = at instanceof Date ? at.getTime() : (typeof at === 'number' ? at : new Date(at).getTime());
    if (!Number.isFinite(ms)) return null;
    const parts = formatter.formatToParts(new Date(ms));
    const part = (type) => Number(parts.find((p) => p.type === type).value);
    return Math.round(Date.UTC(part('year'), part('month') - 1, part('day')) / DAY_MS);
}

/**
 * The day an instant falls on in a zone, as a count of days since 1970, so
 * that two days running are two numbers running. Null for no instant.
 */
function dayNumber(at, timeZone) {
    return dayWith(formatterFor(zoneOf(timeZone)), at);
}

/**
 * A streak, from the moments a player's games ended.
 *
 * Pure, so the counting can be tested against a clock of the test's choosing.
 * `current` counts back from today when a game has been played today, and from
 * yesterday when not; `best` is the longest run there has ever been; `today`
 * is how many games have counted today, so the end of a game can tell the one
 * that carried the streak on from the ones after it.
 */
function streakOf(times, timeZone, now = Date.now()) {
    const formatter = formatterFor(zoneOf(timeZone));
    const days = new Set();
    const todayNumber = dayWith(formatter, now);
    let today = 0;
    for (const at of times || []) {
        const day = dayWith(formatter, at);
        if (day === null) continue;
        days.add(day);
        if (day === todayNumber) today++;
    }
    const playedToday = today > 0;
    let current = 0;
    for (let day = playedToday ? todayNumber : todayNumber - 1; days.has(day); day--) current++;
    let best = 0;
    let run = 0;
    let previous = null;
    for (const day of [...days].sort((a, b) => a - b)) {
        run = previous !== null && day === previous + 1 ? run + 1 : 1;
        if (run > best) best = run;
        previous = day;
    }
    return { current, best, playedToday, today };
}

/* ── The games that count ──────────────────────────────────────────────── */

/*
 * As epoch milliseconds worked out by the database, not as the timestamps
 * themselves. The column carries no zone, and the driver reads such a value in
 * whatever zone this process runs in: UTC on the server, but not on a laptop
 * pointed at the same database, where every game would slide across midnight
 * by the width of the time difference. Cast in the session's own zone, which
 * is the one that wrote it, the value becomes the instant it was.
 */
const PLAYED = `
    SELECT (EXTRACT(EPOCH FROM g.finished_at::timestamptz) * 1000)::float8 AS at
      FROM games g
     WHERE (g.black_player_id = $1 OR g.white_player_id = $1)
       AND g.black_player_id IS DISTINCT FROM g.white_player_id
       AND g.finished_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM moves m WHERE m.game_id = g.id)`;

/* With no database in the process (the suites, the hand-testing server) the
   games that count are whatever the test says they are. */
const memory = new Map();          // userId → [epoch ms]

/** When each of this player's games that count ended, in no particular order. */
async function playedTimes(userId) {
    if (!userId) return [];
    if (!database.hasDatabase()) return [...(memory.get(userId) || [])];
    const { rows } = await database.query(PLAYED, [userId]);
    return rows.map((row) => (row.at === null ? NaN : Number(row.at))).filter(Number.isFinite);
}

/** This player's streak as it stands now, in the zone their browser named. */
async function forUser(userId, timeZone, now = Date.now()) {
    return streakOf(await playedTimes(userId), timeZone, now);
}

/** For the suites and the hand-testing server: games played, without a games table. */
const testing = {
    usePlayed(userId, times) {
        memory.set(userId, (times || []).map((at) => new Date(at).getTime()));
    },
    forget() { memory.clear(); },
};

module.exports = { dayNumber, zoneOf, streakOf, playedTimes, forUser, PLAYED, testing };
