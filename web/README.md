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
  manifest.webmanifest    PWA manifest
  sw.js                   service worker, precaches the whole app
  styles/
    tokens.css            four palettes: {light,dark} × {classic,modern}
    app.css               layout and components
  assets/
    logo.svg              the mark, as exact hexagon geometry
    icons/ sounds/        reused from hexaequo-v2
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
serves this folder statically and falls back to `web/index.html` for any
non-API route, so the API, the websocket and the site all live behind one
origin — no CORS, no second service, and invite links keep working.

```
backend/server.js
  express.static(path.join(__dirname, '../web'))
  app.get('*') → ../web/index.html   (except /api, /socket.io, /health)
```

Because the front end has no build step, a deploy is just a `git push`: Render
reinstalls the backend's dependencies and restarts. Nothing compiles.

Bump `CACHE_VERSION` in `sw.js` on every release, otherwise returning visitors
keep the old cached bundle.

### Local development

`python serve.py` from the repository root serves this folder on port 8001 with
caching disabled. `dev-local.ps1` / `dev-local.sh` start the backend and that
server together.
