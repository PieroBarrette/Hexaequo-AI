/**
 * Notifications: the key a browser subscribes with, and where it says so.
 *
 * Subscribing needs an account, because a notification is news addressed to a
 * person and the server has to know whose. Unsubscribing does not: the endpoint
 * is the browser's own unguessable address, so holding it is proof enough, and
 * a browser being signed out is exactly when it needs to say "stop".
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const push = require('../services/pushService');

/* Seconds between asking for a test and seeing it: time enough to put the app
   away, which is how a real notification is met. */
const TEST_DELAY_MS = 4000;

/* Public by design: the key is how a browser knows that the messages it is
   sent come from us. `enabled` false means the server has no keys, and the
   settings screen says so instead of offering a switch that does nothing. */
router.get('/key', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ enabled: push.enabled(), publicKey: push.publicKey() });
});

router.post('/subscribe', authenticate, async (req, res, next) => {
    try {
        const body = req.body || {};
        const result = await push.subscribe(req.user.id, body.subscription, {
            userAgent: req.headers['user-agent'],
            timeZone: body.timeZone,
            language: body.language,
        });
        if (result.ok) return res.json(result);
        res.status(result.error === 'UNAVAILABLE' ? 503 : 400).json(result);
    } catch (error) { next(error); }
});

router.post('/unsubscribe', async (req, res, next) => {
    try {
        res.json(await push.unsubscribe(req.body && req.body.endpoint));
    } catch (error) { next(error); }
});

/* The service worker's errand when a push service replaces a browser's address.
   It has no session to send — workers cannot read the page's storage — so the
   old address is what vouches for the new one. */
router.post('/renew', async (req, res, next) => {
    try {
        const body = req.body || {};
        const result = await push.renew(body.oldEndpoint, body.subscription);
        res.status(result.ok ? 200 : 400).json(result);
    } catch (error) { next(error); }
});

/** A notification to this device alone, a few seconds from now. */
router.post('/test', authenticate, async (req, res, next) => {
    try {
        if (!push.enabled()) return res.status(503).json({ ok: false, error: 'UNAVAILABLE' });
        const endpoint = req.body && req.body.endpoint;
        if (!(await push.hasDevice(req.user.id, endpoint))) {
            return res.status(404).json({ ok: false, error: 'NOT_REGISTERED' });
        }
        if (!push.allow(`test:${req.user.id}`, 5, 10 * 60 * 1000)) {
            return res.status(429).json({ ok: false, error: 'TOO_MANY' });
        }
        const timer = setTimeout(() => {
            push.notify(req.user.id, 'test', {}, { endpoint, url: '/#/settings', tag: 'test' });
        }, TEST_DELAY_MS);
        if (timer.unref) timer.unref();
        res.json({ ok: true, delayMs: TEST_DELAY_MS });
    } catch (error) { next(error); }
});

module.exports = router;
