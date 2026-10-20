/**
 * Reminders: a word to somebody who has not been back for a while.
 *
 * Only to people who switched notifications on and left reminders on, at most
 * once per step of absence — three days, a week, two weeks, a month — and then
 * not again: four unanswered reminders is a person who has moved on, and a
 * fifth would be nagging. Coming back to the site starts the count again.
 *
 * Always in the early evening of their own time zone, which their device told
 * us when it subscribed. A reminder at three in the morning is not a reminder,
 * it is an alarm.
 *
 * The rules are a list so that the next one — a streak about to be lost at
 * midnight — is one more entry beside this one rather than a second scheduler.
 *
 * Production only, or when PUSH_REMINDERS=1: a development server pointed at
 * the live database must not start writing to the people who play on it.
 */

const Subscriptions = require('../models/pushSubscriptionModel');
const push = require('./pushService');

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 15 * 60 * 1000;
const FIRST_TICK_MS = 60 * 1000;
const STEPS_DAYS = [3, 7, 14, 30];
/* Local hours, from the first to before the second. Wide enough that a tick
   missed to a restart still lands inside it. */
const EVENING = [17, 21];

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

/* Each rule looks at one account and answers with what to send, or nothing.
   The first that answers wins: one reminder per account per tick. */
const RULES = [
    (candidate, now) => {
        const due = comeBackDue(candidate, now);
        return due ? { kind: 'reminder', vars: { n: due.days }, url: '/#/online', tag: 'reminder' } : null;
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
                const due = rule(candidate, now);
                if (!due) continue;
                /* Marked before sending: a reminder that fails to arrive must
                   not be retried every quarter of an hour all evening. */
                await Subscriptions.markReminded(candidate.user_id, now);
                const reached = await push.notify(candidate.user_id, due.kind, due.vars,
                    { url: due.url, tag: due.tag, topic: due.tag });
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

module.exports = { start, stop, tick, comeBackDue, localHour, RULES, STEPS_DAYS, EVENING };
