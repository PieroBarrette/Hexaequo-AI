/**
 * Notifications that reach somebody while Hexaequo is not on their screen.
 *
 * Web Push, the standard every browser that installs web apps speaks: the
 * browser hands us an address at its vendor's push service, we encrypt a short
 * message to the keys that came with it, sign the request with our VAPID key,
 * and the push service wakes the device and our service worker draws the
 * notification. Banner, sound and the badge on the icon are the device's to
 * decide, from its own notification settings; all a web app chooses is what
 * the message says and where tapping it leads.
 *
 * Off — every call a quiet no-op — unless both VAPID keys are set, so a
 * deployment without them carries on exactly as before and the settings screen
 * says notifications are unavailable rather than offering a switch that does
 * nothing.
 */

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const database = require('../config/database');
const Subscriptions = require('../models/pushSubscriptionModel');
const env = require('../config/env');

/*
 * Every kind of notification there is, and the switch in the settings that
 * answers for it. The switches are ordinary settings, kept with the account,
 * so they read the same on every device.
 *
 * `ttl` is how long a push service should keep the message for a device that
 * is switched off: past it the news is stale — a challenge that has expired, a
 * countdown already run out — and better lost than delivered late.
 */
const KINDS = {
    challenge: { pref: 'notifyChallenges', ttl: 10 * 60, urgency: 'high' },
    accepted: { pref: 'notifyChallenges', ttl: 10 * 60, urgency: 'high' },
    ready: { pref: 'notifyChallenges', ttl: 5 * 60, urgency: 'high' },
    turn: { pref: 'notifyGames', ttl: 10 * 60, urgency: 'high' },
    comeBack: { pref: 'notifyGames', ttl: 2 * 60, urgency: 'high' },
    mention: { pref: 'notifyMentions', ttl: 6 * 60 * 60, urgency: 'normal' },
    reminder: { pref: 'notifyReminders', ttl: 3 * 60 * 60, urgency: 'low' },
    test: { pref: null, ttl: 2 * 60, urgency: 'high' },
};

let keys = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
    ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }
    : null;
let tableReady = false;

/** Whether a notification sent now would go anywhere. */
function enabled() {
    if (!keys) return false;
    return database.hasDatabase() ? tableReady : true;   // memory needs no table
}

const publicKey = () => (keys ? keys.publicKey : null);

const RETRY_TABLE_MS = 60 * 1000;

/**
 * Get ready to send, once, at start-up: make sure the table is there.
 *
 * Resolves to whether notifications are on. Never throws: a server that cannot
 * prepare its notifications still serves its games. A database that was not
 * answering at boot is asked again every minute, rather than leaving
 * notifications off until the next deploy.
 */
async function init() {
    if (!keys) {
        console.log('🔕 Push notifications off (set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to turn them on)');
        return false;
    }
    try {
        await Subscriptions.ensureTable();
        tableReady = true;
        console.log(`🔔 Push notifications ready${database.hasDatabase() ? '' : ' (in memory)'}`);
    } catch (error) {
        console.error('[push] could not prepare the subscriptions table, trying again in a minute:', error.message);
        const retry = setTimeout(init, RETRY_TABLE_MS);
        if (retry.unref) retry.unref();
    }
    return enabled();
}

/* ── Who may be written to ─────────────────────────────────────────────── */

/*
 * The push services browsers actually use, by host.
 *
 * A subscription is an address this server will later make a request to, and
 * it comes from the client — so without a list, anybody could register
 * "https://something-internal/" and have the server knock on it for them. Only
 * the vendors' own services are accepted: Google's (Chrome, Android, Samsung
 * Internet, Opera, Brave), Mozilla's, Apple's, and Microsoft's (Edge on
 * Windows).
 */
const PUSH_HOSTS = [
    /^fcm\.googleapis\.com$/,
    /^android\.googleapis\.com$/,
    /(^|\.)push\.services\.mozilla\.com$/,
    /(^|\.)push\.apple\.com$/,
    /(^|\.)notify\.windows\.com$/,
];

function isPushServiceUrl(value) {
    let url;
    try { url = new URL(value); } catch { return false; }
    return url.protocol === 'https:' && PUSH_HOSTS.some((host) => host.test(url.hostname));
}

/* Replaced by the tests, which run a push service of their own on 127.0.0.1. */
let acceptEndpoint = isPushServiceUrl;

/**
 * The parts of a browser's subscription we keep, or null if it is not one.
 *
 * The keys are base64url as browsers write them: p256dh is a 65-byte point
 * (87 characters), auth a 16-byte secret (22).
 */
function cleanSubscription(raw) {
    const endpoint = raw && typeof raw.endpoint === 'string' ? raw.endpoint.trim() : '';
    const given = (raw && raw.keys) || {};
    const p256dh = typeof given.p256dh === 'string' ? given.p256dh : '';
    const auth = typeof given.auth === 'string' ? given.auth : '';
    if (!endpoint || endpoint.length > 1000 || !acceptEndpoint(endpoint)) return null;
    if (!/^[A-Za-z0-9_-]{40,200}={0,2}$/.test(p256dh)) return null;
    if (!/^[A-Za-z0-9_-]{16,100}={0,2}$/.test(auth)) return null;
    return { endpoint, p256dh, auth };
}

/** An IANA zone the runtime recognises, or nothing. */
function cleanTimeZone(value) {
    const zone = typeof value === 'string' ? value.trim().slice(0, 64) : '';
    if (!zone) return null;
    try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
        return zone;
    } catch {
        return null;
    }
}

const languageOf = (value) => (value === 'fr' || value === 'en' ? value : 'en');

/** Keep this browser's address for this account. */
async function subscribe(userId, rawSubscription, { userAgent, timeZone, language } = {}) {
    if (!enabled()) return { ok: false, error: 'UNAVAILABLE' };
    const subscription = cleanSubscription(rawSubscription);
    if (!subscription) return { ok: false, error: 'BAD_SUBSCRIPTION' };
    await Subscriptions.save({
        userId,
        ...subscription,
        userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
        timeZone: cleanTimeZone(timeZone),
        language: language === 'fr' || language === 'en' ? language : null,
    });
    return { ok: true };
}

/** Forget a browser. Anyone holding the endpoint may: it is the browser's own secret. */
async function unsubscribe(endpoint) {
    if (!enabled() || typeof endpoint !== 'string' || !endpoint) return { ok: true };
    await Subscriptions.removeByEndpoint(endpoint);
    return { ok: true };
}

/** The push service gave this browser a new address; move the row to it. */
async function renew(oldEndpoint, rawSubscription) {
    if (!enabled() || typeof oldEndpoint !== 'string' || !oldEndpoint) return { ok: false };
    const subscription = cleanSubscription(rawSubscription);
    if (!subscription) return { ok: false, error: 'BAD_SUBSCRIPTION' };
    return { ok: await Subscriptions.renew(oldEndpoint, subscription) };
}

/* ── What a notification says ──────────────────────────────────────────── */

/*
 * The words come from the app's own locale files, under "push", so a phrase is
 * translated once and lives beside every other string in the game. The server
 * already reads the rules from web/; the words are no different.
 */
const LOCALES = path.join(__dirname, '..', '..', 'web', 'src', 'locales');
const bundles = Object.create(null);

function bundle(language) {
    if (!bundles[language]) {
        try {
            bundles[language] = JSON.parse(fs.readFileSync(path.join(LOCALES, `${language}.json`), 'utf8'));
        } catch {
            bundles[language] = {};
        }
    }
    return bundles[language];
}

function lookup(tree, key) {
    let node = tree;
    for (const part of key.split('.')) {
        if (node == null || typeof node !== 'object') return undefined;
        node = node[part];
    }
    return typeof node === 'string' ? node : undefined;
}

/** The same rules as t() in the app: {name} placeholders, a "One" form for n = 1. */
function say(language, key, vars) {
    const one = vars && Math.abs(Number(vars.n)) === 1 ? key + 'One' : null;
    const from = (tree) => (one ? lookup(tree, one) : undefined) ?? lookup(tree, key);
    let text = from(bundle(languageOf(language)));
    if (text === undefined) text = from(bundle('en'));
    if (text === undefined) return key;
    if (vars) {
        text = text.replace(/\{(\w+)\}/g, (whole, name) =>
            (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
    }
    return text;
}

/** A cadence as the app names it: "Rapide · 10 min + 5 s". */
function cadenceName(language, timeControl) {
    const id = String(timeControl || 'none');
    return say(language, `online.cadence${id.charAt(0).toUpperCase()}${id.slice(1)}`);
}

/*
 * What goes in the message itself. Small on purpose: push services cap a
 * payload at about 4 KB, and everything past the words and the destination
 * can be read once the app is open.
 */
function message(kind, language, vars, options) {
    const filled = typeof vars === 'function' ? vars(language) : (vars || {});
    return {
        kind,
        title: say(language, `push.${kind}.title`, filled),
        // A kind may have more than one way of saying it ("bodyClock").
        body: say(language, `push.${kind}.${options.bodyKey || 'body'}`, filled),
        url: options.url || '/#/home',
        tag: options.tag || kind,
        badge: options.badge || 0,
        lang: language,
        at: Date.now(),
    };
}

/* A push service keeps one undelivered message per topic: a newer "your move"
   replaces the one a switched-off phone has not collected yet. URL-safe base64
   characters only, at most 32 of them. */
const topicOf = (value) => {
    const topic = String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return topic || undefined;
};

/* ── Sending ───────────────────────────────────────────────────────────── */

async function deliver(row, payload, spec, options) {
    try {
        await webpush.sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            JSON.stringify(payload),
            {
                vapidDetails: keys,
                TTL: Math.max(0, Math.round(options.ttl || spec.ttl)),
                urgency: spec.urgency,
                topic: topicOf(options.topic),
                timeout: 10000,
            }
        );
        return true;
    } catch (error) {
        const status = error && error.statusCode;
        /* Gone or never was: the browser unsubscribed, the app was removed,
           the person reset their permissions. The address will never work
           again, so it is forgotten rather than tried on every message. */
        if (status === 404 || status === 410) {
            await Subscriptions.removeById(row.id).catch(() => {});
        } else {
            console.error(`[push] ${payload.kind} not delivered:`, status || error.message);
        }
        return false;
    }
}

/**
 * Send one kind of notification to every device of one account.
 *
 * `vars` fills the words; it may be a function of the language, for anything
 * that has to be named in it (a cadence). `options` carries where tapping it
 * leads (`url`), what it replaces on the device (`tag`), the number for the
 * icon (`badge`), another wording of the body (`bodyKey`), how long it stays
 * worth delivering (`ttl`, seconds), and optionally a single `endpoint`.
 *
 * Resolves to how many devices took it. Never rejects: a notification that
 * could not go is not a reason for anything else to fail.
 */
async function notify(userId, kind, vars = {}, options = {}) {
    const spec = KINDS[kind];
    if (!spec || !userId || !enabled()) return 0;
    let rows;
    try {
        rows = await Subscriptions.forUser(userId);
    } catch (error) {
        console.error('[push] could not read the subscriptions:', error.message);
        return 0;
    }
    if (options.endpoint) rows = rows.filter((row) => row.endpoint === options.endpoint);
    if (!rows.length) return 0;
    const settings = rows[0].settings || {};
    if (spec.pref && settings[spec.pref] === false) return 0;
    const language = languageOf(settings.language || rows[0].language);
    const payload = message(kind, language, vars, options);
    const results = await Promise.all(rows.map((row) => deliver(row, payload, spec, options)));
    return results.filter(Boolean).length;
}

/** Whether this browser is one of this account's devices. */
async function hasDevice(userId, endpoint) {
    if (!userId || !endpoint || !enabled()) return false;
    try {
        return (await Subscriptions.forUser(userId)).some((row) => row.endpoint === endpoint);
    } catch {
        return false;
    }
}

/** Whether this account has a device that would take this kind of notification. */
async function reachable(userId, kind = 'challenge') {
    if (!userId || !enabled()) return false;
    try {
        const rows = await Subscriptions.forUser(userId);
        if (!rows.length) return false;
        const pref = KINDS[kind] && KINDS[kind].pref;
        return !(pref && (rows[0].settings || {})[pref] === false);
    } catch {
        return false;
    }
}

/*
 * The account was on the site: noted at most every half hour, which is all a
 * reminder measured in days needs, and keeps a write off every page view.
 */
const VISIT_EVERY_MS = 30 * 60 * 1000;
const lastVisit = new Map();

function visited(userId) {
    if (!userId || !enabled()) return;
    const now = Date.now();
    if (now - (lastVisit.get(userId) || 0) < VISIT_EVERY_MS) return;
    lastVisit.set(userId, now);
    Subscriptions.touchVisit(userId).catch(() => {});
}

/*
 * How often one thing may be said.
 *
 * A notification is an interruption on somebody's phone, so every trigger that
 * another person can pull — a challenge, a mention — goes through here: so many
 * per window per key, and the rest are dropped rather than queued.
 */
const recent = new Map();

function allow(key, max, windowMs) {
    const now = Date.now();
    const kept = (recent.get(key) || []).filter((at) => now - at < windowMs);
    if (kept.length >= max) {
        recent.set(key, kept);
        return false;
    }
    kept.push(now);
    recent.set(key, kept);
    if (recent.size > 5000) {
        for (const [name, times] of recent) {
            if (!times.length || now - times[times.length - 1] > 60 * 60 * 1000) recent.delete(name);
        }
    }
    return true;
}

/** For the suites: keys of their own, and a push service on 127.0.0.1. */
const testing = {
    configure(vapid) {
        keys = vapid ? { subject: 'https://hexaequo.com', ...vapid } : null;
        tableReady = Boolean(vapid);
    },
    acceptEndpoints(check) { acceptEndpoint = check || isPushServiceUrl; },
    forgetLimits() { recent.clear(); lastVisit.clear(); },
};

module.exports = {
    KINDS, enabled, init, publicKey,
    subscribe, unsubscribe, renew,
    notify, reachable, hasDevice, visited, allow,
    say, cadenceName, message, isPushServiceUrl, cleanSubscription, cleanTimeZone,
    testing,
};
