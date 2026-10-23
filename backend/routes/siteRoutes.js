/**
 * The site: the app, the pages with an address of their own, and a plain
 * answer for every other address.
 *
 * Every page of the site is the game, and every page is a file. The home is
 * web/index.html; each page in web/src/pages.js (/rules/, /fr/regles/…) is a
 * copy of it written at that path by scripts/makePages.js. So express.static
 * answers for all of them, and what gets past it is an address with nothing
 * behind it.
 *
 * That used to be answered with the shell and a 200, the way a single-page
 * app answers a route of its own that it has not seen yet. But this app's
 * routes are fragments of the root (/#/play, /#/online?challenge=…), never
 * paths, so the shell at a made-up path was the home page again, at an
 * address that does not exist: a duplicate for a search engine to index, and
 * for a person following a broken link, a page that looked like the right
 * one. It is a 404 now, with a page that says so in both languages.
 *
 * What the site hands out, and where each lands:
 *   - invitations, shared games, mail and notifications: /#/…, the root;
 *   - the first invitations, from the app before this one: /?invite=…, the
 *     root again;
 *   - the manifest's start_url and shortcuts: /index.html#/…, a file;
 *   - a page's path without its slash: redirected to it by express.static;
 *   - /fr, typed by hand: redirected below.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

/*
 * Paths that only a scanner would ask for get a flat 404, not even the page.
 *
 * A request for /wp-login.php or /.env is a bot looking for a server this is
 * not, and an HTML page in answer wastes the bytes and tells it someone is
 * home. These extensions belong to stacks this app does not run.
 */
const SCANNER_PATH = /\.(php|asp|aspx|jsp|cgi|env|sql|bak|old|git|htaccess|ini)$|^\/(wp-|wordpress|phpmyadmin|\.git|\.env)/i;

/* Not the site's to answer: the API and the socket have 404s of their own,
   and the health checks belong to the server. */
const elsewhere = (at) => /^\/(api|socket\.io)(\/|$)/.test(at) || at === '/health' || at === '/healthz';

/**
 * @param {string} root the folder the site is served from — web/
 */
function siteRoutes(root) {
    const router = express.Router();
    const present = fs.existsSync(root);

    /* The French pages live under /fr/, but /fr/ itself is no page: it served
       the home a second time, in English, under a second address. The French
       page about the game is what somebody typing it is after. */
    router.get(['/fr', '/fr/'], (req, res) => res.redirect(301, '/fr/jouer/'));

    if (present) router.use(express.static(root));

    router.get('*', (req, res, next) => {
        if (SCANNER_PATH.test(req.path)) return res.status(404).type('txt').send('Not found');
        next();
    });

    /* Read once, as the page script and the build script read it. It is an
       ES module, so it is imported rather than required. */
    const pages = present
        ? import(pathToFileURL(path.join(root, 'src', 'pages.js')).href).catch(() => null)
        : Promise.resolve(null);

    router.get('*', async (req, res, next) => {
        if (elsewhere(req.path)) return next();
        if (!present) {
            // Backend-only mode: no frontend to serve
            return res.status(404).json({ error: 'Frontend not deployed on this server', path: req.path });
        }
        /* A page whose document was never written still opens: the shell
           reads the page from the path (main.js). The documents are
           committed, so this is a stale build, not the usual way in. */
        const known = await pages;
        if (known && known.pageAt(req.path)) return res.sendFile(path.join(root, 'index.html'));

        res.status(404);
        res.set('Cache-Control', 'no-cache');
        res.sendFile(path.join(root, '404.html'), (error) => {
            if (error && !res.headersSent) res.type('txt').send('Not found');
        });
    });

    return router;
}

module.exports = { siteRoutes };
