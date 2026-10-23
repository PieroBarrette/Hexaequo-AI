# Hexaequo — web

The reworked site: home menu, local game, illustrated rules, settings.

Written as plain ES modules with **no build step**. There is nothing to compile,
bundle or install — the folder is the deployable artefact.

## Run it locally

ES modules are blocked over `file://`, so serve the folder over HTTP:

```bash
python -m http.server 8765 --directory web
```

Then open <http://localhost:8765>.

## Layout

```
web/
  index.html              app shell: header, view outlet
  404.html                the page for an address with nothing behind it
  manifest.webmanifest    PWA manifest
  sw.js                   service worker, precaches the whole app
  styles/
    tokens.css            four palettes: {light,dark} × {classic,modern}
    app.css               layout and components
  assets/
    logo.svg              the mark, as exact hexagon geometry
    icons/                drawn from logo.svg by backend/scripts/makeIcons.js
  src/
    main.js               entry point
    router.js             hash router
    settings.js           persisted preferences
    i18n.js               localisation
    audio.js              sound effects
    locales/{en,fr}.json  all user-visible text, including the rules
    game/
      hex.js              axial geometry, cell keys
      state.js            board state, Zobrist hash, apply/undo
      moves.js            move generation, end-of-game detection
      ai.js               negamax + alpha-beta + quiescence
    ui/
      board.js            SVG board, animations, framing
      icons.js            the symbols on the game's controls, as inline SVG
      logo.js             the mark, themed
      miniBoard.js        static diagrams for the rules
    views/                home, play, rules, settings
```

## Conventions

- **Code in English, interface text in the locale files.** Nothing user-visible
  is hard-coded in a view; everything goes through `t('some.key')`.
- **Colour lives in `tokens.css` only.** The board, the logo and the rule
  diagrams all read the same `--tile-*` and `--piece-*` variables, so a new
  palette themes everything at once and the illustrations can never drift from
  the real board.
- **The engine has no DOM dependency.** `src/game/` is pure logic, which is what
  will let the server share it when online play arrives.

## Self-test

The engine invariants can be checked from the browser console:

```js
const S = await import('/src/game/state.js');
const M = await import('/src/game/moves.js');
// play random games, asserting apply/undo reversibility, hash correctness and
// material conservation — see the session notes for the full harness.
```

## Deployment

hexaequo.com is a Render **Web Service** with root directory `backend`. Express
serves this folder statically, so the API, the websocket and the site all live
behind one origin — no CORS, no second service. Every link the app hands out
(invitations, shared games, mail, notifications) is a fragment of the root,
`/#/…`, so it needs nothing from the server but `/`.

```
backend/routes/siteRoutes.js
  express.static(path.join(__dirname, '../web'))
  /fr, /fr/            → 301 to /fr/jouer/
  a page in pages.js   → its document (or the shell, if it was never written)
  anything else        → 404.html, with a 404   (except /api, /socket.io, /health)
```

Because the front end has no build step, a deploy is just a `git push`: Render
reinstalls the backend's dependencies and restarts. Nothing compiles. The
documents of the pages with an address of their own, and `404.html`, are
written by `npm run pages` in `backend/` and committed.

There is no version to bump: the server names the service worker's cache after
a hash of the files it caches, so a release that changes anything replaces it.

### Local development

`python serve.py` from the repository root serves this folder on port 8001 with
caching disabled. `dev-local.ps1` / `dev-local.sh` start the backend and that
server together.
