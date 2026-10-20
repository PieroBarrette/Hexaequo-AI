/**
 * Reminders: a word to somebody who has not been back for a while, and to
 * somebody whose days in a row end at midnight.
 *
 * Only to people who switched notifications on and left reminders on. Coming
 * back is said at most once per step of absence — three days, a week, two
 * weeks, a month — and then not again: four unanswered reminders is a person
 * who has moved on, and a fifth would be nagging. Coming back to the site
 * starts the count again. A streak of two days or more with nothing played yet
 * today is said once, that evening, while there is still time to keep it.
 *
 * Always in the evening of their own time zone, which their device told us
 * when it subscribed. A reminder at three in the morning is not a reminder, it
 * is an alarm.
 *
 * The rules are a list, so each kind of reminder is one more entry rather than
 * another scheduler. Both answer to the same switch, "Reminders" (Piero's
 * choice, 2026-10-19).
 *
 * Production only, or when PUSH_REMINDERS=1: a development server pointed at
 * the live database must not start writing to the people who play on it.
 */

const Subscriptions = require('../models/pushSubscriptionModel');
const push = require('./pushService');
const streaks = require('./streakService');

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 15 * 60 * 1000;
const FIRST_TICK_MS = 60 * 1000;
const STEPS_DAYS = [3, 7, 14, 30];
/* Local hours, from the first to before the second. Wide enough that a tick
   missed to a restart still lands inside it. */
const EVENING = [17, 21];
/* Later for a streak: it is about tonight, so it waits for the evening to have
   had its chance — whoever plays after dinner has played by then — and still
   leaves time for a game before midnight. */
const STREAK_EVENING = [19, 22];
/* One day is not yet a streak. Two is the first one worth keeping. */
const STREAK_MIN_DAYS = 2;

const time = (value) => (value ? new Date(value).getTime() || 0 : 0);

/** The hour of the day in this zone, 0-23, or null for a zone nobody knows. */
function localHour(timeZone, at = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: timeZone || 'UTC', hour: 'numeric', hourCycle: 'h23',
        }).formatToParts(at);
        const hour = parts.find((part) => part.type === 'hour');
        return hour ? Number(hour.value) % 24 : null;
    } catch {
        return null;
    }
}

/**
 * Whether this account is owed the "come back" reminder now, and for which step.
 *
 * Pure, so the whole rule can be tested against a clock of the test's choosing.
 * The last sign of life is the later of a visit and a finished game.
 */
function comeBackDue(candidate, now = Date.now()) {
    const settings = candidate.settings || {};
    if (settings.notifyReminders === false) return null;
    const hour = localHour(candidate.time_zone, new Date(now));
    if (hour === null || hour < EVENING[0] || hour >= EVENING[1]) return null;
    const last = Math.max(time(candidate.visited_at), time(candidate.played_at));
    if (!last) return null;
    const idleDays = Math.floor((now - last) / DAY_MS);
    const step = [...STEPS_DAYS].reverse().find((days) => idleDays >= days);
    if (!step) return null;
    /* Once per step: a reminder sent after this step was reached has already
       said what this one would. */
    if (time(candidate.reminded_at) >= last + step * DAY_MS) return null;
    return { days: step };
}

/**
 * Whether tonight is a night this account could be told its streak is ending.
 *
 * Everything the streak rule asks before any game is read: the switch, the
 * hour where they are, and once a day — anything already sent to them today
 * has had its say.
 */
function streakEvening(candidate, now = Date.now()) {
    const settings = candidate.settings || {};
    if (settings.notifyReminders === false) return false;
    const hour = localHour(candidate.time_zone, new Date(now));
    if (hour === null || hour < STREAK_EVENING[0] || hour >= STREAK_EVENING[1]) return false;
    return !(candidate.reminded_at && streaks.dayNumber(candidate.reminded_at, candidate.time_zone)
        === streaks.dayNumber(now, candidate.time_zone));
}

/** Seconds until midnight in this zone: past it, "ends at midnight" is no longer news. */
function secondsToMidnight(timeZone, now = Date.now()) {
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: timeZone || 'UTC', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
        }).formatToParts(new Date(now));
        const part = (type) => Number((parts.find((p) => p.type === type) || {}).value) || 0;
        return Math.max(60, DAY_MS / 1000 - (part('hour') * 3600 + part('minute') * 60 + part('second')));
    } catch {
        return null;
    }
}

/**
 * Whether this account's streak ends at midnight tonight, and how long it is.
 *
 * Pure, like comeBackDue: `candidate.played` holds the moment each game that
 * counts ended. Owed in the evening of their own zone, at most once a day, to
 * somebody with two days or more behind them and nothing played yet today.
 * The days are counted in the same zone the evening is.
 */
function streakDue(candidate, now = Date.now()) {
    if (!streakEvening(candidate, now)) return null;
    const streak = streaks.streakOf(candidate.played, candidate.time_zone, now);
    if (streak.playedToday || streak.current < STREAK_MIN_DAYS) return null;
    return { days: streak.current, ttl: secondsToMidnight(candidate.time_zone, now) };
}

/* Each rule looks at one account and answers with what to send, or nothing.
   The first that answers wins: one reminder per account per tick. */
const RULES = [
    (candidate, now) => {
        const due = comeBackDue(candidate, now);
        return due ? { kind: 'reminder', vars: { n: due.days }, url: '/#/online', tag: 'reminder' } : null;
    },
    async (candidate, now) => {
        /* The games are read only for somebody it is the right evening for;
           the rest of the day the rule costs nothing. A count that cannot be
           made is no reminder, not a stopped scheduler. */
        if (!streakEvening(candidate, now)) return null;
        const played = await streaks.playedTimes(candidate.user_id).catch(() => null);
        const due = played && streakDue({ ...candidate, played }, now);
        return due
            ? { kind: 'streak', vars: { n: due.days }, url: '/#/online', tag: 'streak', ttl: due.ttl }
            : null;
    },
];

let running = false;

/** Look at everybody once, send what is owed. Resolves to how many were sent. */
async function tick(now = Date.now()) {
    if (running || !push.enabled()) return 0;
    running = true;
    let sent = 0;
    try {
        const candidates = await Subscriptions.reminderCandidates();
        for (const candidate of candidates) {
            for (const rule of RULES) {
                const due = await rule(candidate, now);
                if (!due) continue;
                /* Marked before sending: a reminder that fails to arrive must
                   not be retried every quarter of an hour all evening. */
                await Subscriptions.markReminded(candidate.user_id, now);
                const reached = await push.notify(candidate.user_id, due.kind, due.vars,
                    { url: due.url, tag: due.tag, topic: due.tag, ttl: due.ttl });
                if (reached) sent++;
                break;
            }
        }
    } catch (error) {
        console.error('[reminders] could not run:', error.message);
    } finally {
        running = false;
    }
    return sent;
}

let timer = null;

/**
 * Start looking every quarter of an hour. Idempotent; returns whether it
 * started. Needs only the keys: each look checks that sending is possible at
 * that moment, so a database that came up late is simply found working.
 */
function start({ force = false } = {}) {
    const allowed = force || process.env.NODE_ENV === 'production' || process.env.PUSH_REMINDERS === '1';
    if (timer || !allowed || !push.publicKey()) return false;
    const first = setTimeout(() => tick(), FIRST_TICK_MS);
    if (first.unref) first.unref();
    timer = setInterval(() => tick(), TICK_MS);
    if (timer.unref) timer.unref();
    console.log('⏰ Reminders scheduled every 15 minutes');
    return true;
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = {
    start, stop, tick, comeBackDue, streakDue, streakEvening, secondsToMidnight, localHour,
    RULES, STEPS_DAYS, EVENING, STREAK_EVENING, STREAK_MIN_DAYS,
};
