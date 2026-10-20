/**
 * Days in a row: counted from when games ended, in the player's own days.
 *
 * Run with: node tests/streak.test.js
 *
 * No database. The counting is pure and is tested against a clock of the
 * test's choosing; where the games come from is checked by standing in for the
 * database and reading what was asked of it. The query itself runs against a
 * real one in profile.test.js.
 */

require('./database').none();

const assert = require('assert');
const database = require('../config/database');
const streaks = require('../services/streakService');

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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** An instant, in UTC: month as people write it, 1-12. */
const at = (month, day, hour = 12, minute = 0) => Date.UTC(2026, month - 1, day, hour, minute);
const NOW = at(10, 19, 20);                       // Monday 19 October 2026, 20:00 UTC

async function run() {
    console.log('\nStreaks\n');

    await test('nothing played is no streak', () => {
        assert.deepStrictEqual(streaks.streakOf([], 'UTC', NOW),
            { current: 0, best: 0, playedToday: false, today: 0 });
        assert.deepStrictEqual(streaks.streakOf(undefined, 'UTC', NOW),
            { current: 0, best: 0, playedToday: false, today: 0 });
    });

    await test('a game today starts one', () => {
        assert.deepStrictEqual(streaks.streakOf([NOW - HOUR], 'UTC', NOW),
            { current: 1, best: 1, playedToday: true, today: 1 });
    });

    await test('yesterday\'s streak still stands until midnight', () => {
        const streak = streaks.streakOf([at(10, 17), at(10, 18)], 'UTC', NOW);
        assert.strictEqual(streak.current, 2, 'not lost before today is over');
        assert.strictEqual(streak.playedToday, false);
        assert.strictEqual(streaks.streakOf([at(10, 17), at(10, 18)], 'UTC', at(10, 20, 0, 1)).current, 0,
            'and gone the moment a day passes without a game');
    });

    await test('a day counts once, however many games are played in it', () => {
        const streak = streaks.streakOf([at(10, 18), at(10, 19, 9), at(10, 19, 13), at(10, 19, 19)], 'UTC', NOW);
        assert.strictEqual(streak.current, 2);
        assert.strictEqual(streak.today, 3, 'three games today, one day');
    });

    await test('a day missed ends it, and the best is remembered', () => {
        const games = [10, 11, 12, 13, 14, 17, 18, 19].map((day) => at(10, day));
        const streak = streaks.streakOf(games, 'UTC', NOW);
        assert.strictEqual(streak.current, 3, 'the 17th to today');
        assert.strictEqual(streak.best, 5, 'the 10th to the 14th');
        assert.strictEqual(streaks.streakOf(games.slice(0, 5), 'UTC', NOW).current, 0,
            'nothing since the 14th: no streak, a best of five');
    });

    await test('the order of the games does not matter', () => {
        const games = [at(10, 19), at(10, 17), at(10, 18), at(10, 18, 8)];
        assert.deepStrictEqual(streaks.streakOf(games, 'UTC', NOW),
            streaks.streakOf([...games].reverse(), 'UTC', NOW));
    });

    await test('a day is the player\'s own, not the server\'s', () => {
        /* Two games an hour apart, either side of midnight in UTC: two days
           there, but one Sunday evening in Montréal and one Monday morning in
           Tokyo. Asked late on Monday, Montréal time. */
        const games = [at(10, 18, 23, 30), at(10, 19, 0, 30)];
        const asked = at(10, 19, 23);                     // 19:00 Monday in Montréal, Tuesday in Tokyo
        const montreal = streaks.streakOf(games, 'America/Montreal', asked);
        assert.deepStrictEqual([montreal.current, montreal.playedToday], [1, false],
            'in Montréal: one day, Sunday, and Monday not played yet');
        const utc = streaks.streakOf(games, 'UTC', asked);
        assert.deepStrictEqual([utc.current, utc.playedToday], [2, true], 'in UTC: Sunday and Monday');
        const tokyo = streaks.streakOf(games, 'Asia/Tokyo', asked);
        assert.deepStrictEqual([tokyo.current, tokyo.playedToday], [1, false],
            'in Tokyo: Monday morning, and it is Tuesday now');
    });

    await test('midnight moves with the clocks, and the days still follow on', () => {
        /* Paris leaves summer time at 03:00 on Sunday 25 October 2026. */
        const paris = (instant) => streaks.dayNumber(instant, 'Europe/Paris');
        assert.strictEqual(paris(at(10, 24, 21, 59)) + 1, paris(at(10, 24, 22, 0)),
            'midnight is 22:00 UTC in summer time');
        assert.strictEqual(paris(at(10, 25, 22, 59)) + 1, paris(at(10, 25, 23, 0)),
            'and 23:00 UTC once the clocks have gone back');
        /* Half past midnight three nights running, the last after the change.
           Read with the offset of the day asked on rather than each game's
           own, the two summer-time nights would slide back a day each and
           leave a gap before the third. */
        const nights = [at(10, 23, 22, 30), at(10, 24, 22, 30), at(10, 25, 23, 30)];
        const streak = streaks.streakOf(nights, 'Europe/Paris', at(10, 26, 19));
        assert.deepStrictEqual([streak.current, streak.playedToday], [3, true]);
    });

    await test('a zone nobody knows is read as UTC', () => {
        const games = [at(10, 18, 23, 30), at(10, 19, 0, 30)];
        assert.deepStrictEqual(streaks.streakOf(games, 'Mars/Olympus_Mons', NOW), streaks.streakOf(games, 'UTC', NOW));
        assert.strictEqual(streaks.zoneOf('Mars/Olympus_Mons'), 'UTC');
        assert.strictEqual(streaks.zoneOf(undefined), 'UTC');
        assert.strictEqual(streaks.zoneOf(['Europe/Paris']), 'UTC', 'only ever a string');
        assert.strictEqual(streaks.zoneOf('x'.repeat(5000)), 'UTC');
        assert.strictEqual(streaks.zoneOf(' Europe/Paris '), 'Europe/Paris');
        assert.strictEqual(streaks.zoneOf('europe/paris'), 'Europe/Paris', 'spelled the way the runtime spells it');
    });

    await test('an instant may come as a date, a number or a string; nothing else counts', () => {
        const streak = streaks.streakOf(
            [new Date(at(10, 17)), at(10, 18), new Date(at(10, 19, 8)).toISOString(), null, 'never', NaN],
            'UTC', NOW);
        assert.deepStrictEqual(streak, { current: 3, best: 3, playedToday: true, today: 1 });
    });

    await test('the games are asked of the database for that player alone', async () => {
        const realQuery = database.query;
        const realHas = database.hasDatabase;
        const asked = [];
        database.hasDatabase = () => true;
        database.query = (sql, params) => {
            asked.push({ sql, params });
            /* float8 comes back as a number; numeric would come back as text. */
            return Promise.resolve({ rows: [{ at: at(10, 18) }, { at: String(at(10, 19, 8)) }, { at: null }] });
        };
        try {
            const times = await streaks.playedTimes('acct-amelie');
            assert.deepStrictEqual(times, [at(10, 18), at(10, 19, 8)], 'as instants; a missing one dropped');
            assert.deepStrictEqual(asked[0].params, ['acct-amelie']);
            assert.match(asked[0].sql, /IS DISTINCT FROM/, 'a game against yourself is left out');
            assert.match(asked[0].sql, /EXISTS \(SELECT 1 FROM moves/, 'and so is a room left before a move');
            assert.deepStrictEqual(await streaks.forUser('acct-amelie', 'UTC', NOW),
                { current: 2, best: 2, playedToday: true, today: 1 });
            assert.deepStrictEqual(await streaks.playedTimes(null), [], 'nobody asked for, nothing read');
            assert.strictEqual(asked.length, 2);
        } finally {
            database.query = realQuery;
            database.hasDatabase = realHas;
        }
    });

    await test('with no database, the games are whatever the test says', async () => {
        streaks.testing.usePlayed('acct-bertrand', [new Date(NOW - DAY), NOW - 2 * DAY]);
        assert.deepStrictEqual(await streaks.playedTimes('acct-bertrand'), [NOW - DAY, NOW - 2 * DAY]);
        assert.strictEqual((await streaks.forUser('acct-bertrand', 'UTC', NOW)).current, 2);
        assert.deepStrictEqual(await streaks.playedTimes('acct-nobody'), []);
        streaks.testing.forget();
        assert.deepStrictEqual(await streaks.playedTimes('acct-bertrand'), []);
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run().catch((error) => {
    console.error('harness crashed:', error);
    process.exit(1);
});
