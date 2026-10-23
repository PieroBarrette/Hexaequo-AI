# Hexaequo — project snapshot

This file is a snapshot of the project as it is now. It covers structure, architecture, key files, conventions and known pitfalls, and it is not a work log. Update it in the same change whenever any of these move. Rules for agent responses are in `.github/instructions/main-rule-for-vs-code.instructions.md`.

## The project

Hexaequo is a free abstract strategy game for two players. It is played in the browser at https://hexaequo.com, in English and French, and can be installed as a PWA. Players build the board as they play. Each player has 9 hexagonal tiles, 6 disks and 3 rings. On a turn a player does one thing:

- lays a tile;
- places a piece from the reserve;
- moves a piece. A disk steps, or it jumps and captures the enemy pieces it crosses, and jumps can chain. A ring leaps to a tile exactly two away and captures an enemy piece there.

A player wins by capturing six disks or three rings, or by leaving the opponent with no piece on the board. The game is a draw when the player to move has no legal move, when a position occurs three times, or after fifty moves each with no capture and nothing placed. The draw is called **ExAequo** in both languages.

There are several ways to play:

- on one device, two people or one person against the AI (four levels);
- online through an invitation link, open to guests;
- quick match and lobby challenges, which need an account.

A game is rated (Elo) only when two different signed-in players play on a clock. Untimed games are friendlies.

The previous front end and its shared game module were deleted in commit 7f3483e (August 2026), when `web/` replaced them. Any reference to them, for example in the plans under `docs/archive/` or old docs, is out of date.

## Repository layout

```
web/                  front end: plain ES modules, no build step (see web/README.md)
backend/              Express + Socket.IO + PostgreSQL; also serves web/
docs/                 API.md (REST), SOCKET_EVENTS.md (socket protocol)
docs/archive/         TO_DO.md, FUTURE_IMPLEMENTATION.md: plans from January 2026, in French, for the previous front end; history, not current
serve.py              dev static server for web/ on :8001, caching disabled
dev-local.ps1 / .sh   start the backend (:3001) and serve.py together
.claude/launch.json   preview configurations
index.html            forwards to web/index.html if something serves the repo root (never in production)
node-portable/        local portable Node (gitignored), used by dev-local.ps1 and launch.json
```

## Front end (`web/`)

The front end is vanilla JavaScript ES modules with an SVG board. It uses no framework, no bundler and no npm. The Socket.IO client is loaded from the server (`/socket.io/socket.io.js`), so its version always matches the server's.

```
web/
  index.html             app shell; makePages.js copies it to every page path
  404.html, sitemap.xml, robots.txt, rules/, fr/regles/, …   generated, committed
  sw.js, manifest.webmanifest, llms.txt (hand-written)
  styles/tokens.css      every colour, as variables: {light,dark} × {classic,modern}
  styles/app.css         layout and components
  assets/                logo.svg (source of every icon), icons/, share-{en,fr}.png (link previews)
  src/
    main.js              boot: settings, i18n, routes, header, session, challenges card, service worker
    router.js            hash router
    pages.js             pages with an address of their own (no imports, so Node can read it)
    auth.js, net.js, i18n.js, settings.js, settingsSync.js, push.js, update.js, bootTheme.js, …
    locales/{en,fr}.json every user-visible word
    content/             HTML of the pages (rules, about, guide, faq, legal); runs in the browser and in Node
    game/                the engine (see below)
    ui/                  board.js (SVG), overlay.js, panels.js, challenge.js, miniBoard.js, logo.js, icons.js, qr.js, …
    views/               home, play, online, lobby, profile, settings, account, leaderboard, mailAction
```

**Routing.** `src/router.js` resolves `#/name?query` against the routes that `src/main.js` defines. A view is `mount(container, params)` and can return a teardown function. Each mount gets a fresh container. A view can refuse to be left through `setLeaveGuard`. Unknown names fall back to home.

| Hash | View |
|---|---|
| `#/home` (default) | `views/home.js`: the menu |
| `#/play` | `views/play.js`: local game, two players or against the AI. This is the largest module. |
| `#/play?online=1&code=…`, `?watch=1&code=…`, `?game=<id>` | Same view: online game, spectating, review of a finished game |
| `#/online` | `views/online.js` with `views/lobby.js`: quick match, invitations, lobby |
| `#/profile`, `#/profile?id=…` | `views/profile.js` |
| `#/settings` | `views/settings.js` (also a panel) |
| `#/verify?token=…`, `#/reset?token=…` | `views/mailAction.js`: where the links in our e-mails land |
| `#/rules`, `#/privacy`, `#/terms` | Old links: open the home screen with that panel |

**Panels.** `ui/overlay.js` draws one panel over the current screen, and the game keeps running underneath. `ui/panels.js` names the panels:

- `settings`, `account` and `leaderboard`;
- the pages listed in `pages.js`.

`openPanel(name)` toggles, so calling it on the panel already open closes it. A route change closes the panel; a language refresh does not.

**Pages with an address.** `pages.js` gives six panels a path in each language:

| Page | English | French |
|---|---|---|
| rules | `/rules/` | `/fr/regles/` |
| about | `/play/` | `/fr/jouer/` |
| guide | `/guide/` | `/fr/guide/` |
| faq | `/faq/` | `/fr/faq/` |
| privacy (noindex) | `/privacy/` | `/fr/confidentialite/` |
| terms (noindex) | `/terms/` | `/fr/conditions/` |

When a page is opened in the app, its path replaces the one in the address bar; nothing is pushed to history. Arriving at a page's path opens the app with that panel over the home screen. `backend/scripts/makePages.js` writes a copy of `index.html` at each path, carrying the page's title, canonical and hreflang links, JSON-LD and the page text from `content/`. It also writes `sitemap.xml`, `robots.txt` and `404.html`. Note that `/play/` is the about page, while `#/play` is the game.

**Service worker and updates.**
- `sw.js` precaches its `SHELL` list and serves cache-first.
- The server replaces `__BUILD__` with a hash of `web/src`, `web/styles`, `index.html`, the manifest and `sw.js`. Any change therefore makes a new cache, and there is no version to bump.
- `update.js` looks for a new worker at start-up, on return to the foreground and every 30 minutes, and offers it to the player (`SKIP_WAITING`). `/api/version` only shows the server's build in the settings.
- On localhost the worker caches nothing; it is registered only for notifications. `main.js` also clears any old caches there.

**Session and network.**
- `auth.js` keeps the JWT access and refresh tokens in localStorage (`hexaequo.token`, `hexaequo.refresh`). Its `api(path)` calls `/api…` with the bearer token and refreshes the token once on a 401.
- `net.js` opens the socket. In production it uses the same origin. Pages served on :8001 or :8765 use the backend on :3001, which `?api=http://host:port` overrides.
- `net.js` identifies the socket with `hx:identify`, and `request(event, payload)` resolves to the server's acknowledgement.
- Guests keep a per-tab seat key in sessionStorage to get their seat back after a reconnection.

## Game engine (`web/src/game/`)

The engine is pure logic with no DOM. The server uses it as is.

- `hex.js`: axial coordinates packed into one integer, `(q+32)*64 + (r+32)`, used as an index into flat typed arrays.
- `state.js`: `applyMove`/`undoMove` change the position in place and keep a Zobrist hash up to date. It also provides `cloneState` and `serializeState`/`deserializeState`. `BLACK = 0`, `WHITE = 1`.
- `moves.js`: move generation, `checkWinner`, intents (`moveIntent`, `findLegalMove`), notation, and the idle counter (`IDLE_LIMIT` = 100 plies).
- `ai.js`: negamax with alpha-beta pruning, iterative deepening, quiescence and a transposition table. The four `LEVELS` (0–3) take 200 ms to 3.5 s and run on the main thread. `judge()` feeds the evaluation bar.
- `accuracy.js` and `analysisWorker.js`: the accuracy review after a game, run in a module worker.

## Backend (`backend/`)

The backend runs on Node (CommonJS, `engines` ≥ 20) with Express 4, Socket.IO 4, PostgreSQL (`pg`), JWT, bcryptjs, nodemailer or Resend, and web-push.

```
server.js            helmet/CORS/rate limits, /api routes, sockets, /sw.js with the build stamp,
                     /api/version, /health and /healthz, then the site (last)
config/              env.js (most settings and their defaults), database.js, rateLimit.js
routes/ → controllers/ → services/ → models/      REST layers; middleware/ holds auth, validation, errors
routes/siteRoutes.js the site: /fr → 301 /fr/jouer/, static files, page paths, a real 404 (web/404.html)
socket/              io.js, onlineGame.js, matchmaking.js, lobby.js, notify.js
game/engine.js       loads web/src/game/{hex,state,moves}.js by dynamic import; applies client intents
models/schema.js     the PostgreSQL schema (createSchema, plus a `migrations` block for later columns)
scripts/             makePages.js, makeIcons.js, devNoDatabase.js, initDb/resetDb/dumpDb/cleanupDb, old migrations
tests/               home-made suites (see Testing)
```

**Online games: the server decides every move.** Clients send intents (`hx:move`), never positions. `game/engine.js` regenerates the legal moves and applies the one that matches, so the rules exist in one place.

- `socket/onlineGame.js` keeps rooms in memory, each with a 6-letter code. A room holds:
  - seats and clocks: none, bullet 2+1, blitz 5+3, rapid 10+5, classic 20+10;
  - a reconnection grace period that depends on the clock;
  - draw, take-back and rematch offers;
  - chat, spectators and presence.
- `socket/matchmaking.js` runs quick match (`hx:queue*`): the accepted rating gap widens the longer a player waits. Accounts only.
- `socket/lobby.js` runs the lobby (`hx:lobby*`, `hx:challenge*`): who is present, the chat (stored in `lobby_messages`) and challenges by name. Accounts only.
- `socket/notify.js` tracks `hx:visible`, so push notifications only reach people who are not looking at the site.
- Handlers acknowledge with `{ ok: true, … }` or `{ ok: false, error: 'CODE' }`.

`services/ratedGameService.js` saves a finished game (`games` and `moves`; each move is stored in `moves.intent`). It also decides whether a game is rated (`isRatedRoom`) and applies the Elo change through `services/eloService.js`. Ratings start at 1000, the K factor is 40, 20 or 10, and each clock has a multiplier.

**REST endpoints used by `web/`:**
- `/api/auth`: signup, login, logout, refresh, verify-email, forgot/reset/change-password, me, pseudo;
- `/api/users`: me, me/settings, leaderboard;
- `/api/profile`: records, streak, games;
- `/api/push`;
- `/api/version`.

REST errors go through the helpers in `middleware/errorHandler.js` and come back as `{ error, message }`.

**Accounts.** Sign-in is by e-mail and password only; Google sign-in was removed on 2026-10-20. Players choose their nickname (`pseudo`) after signing up. Mail is sent by `services/emailService.js` through the Resend API or SMTP, with the bilingual templates written in the file. Its links lead to `#/verify` and `#/reset`.

**Notifications.**
- `services/pushService.js` sends Web Push signed with the VAPID keys and is off unless both keys are set. Its texts come from the `push` section of the locales. When push is on, the `push_subscriptions` table creates itself at boot.
- `services/reminderService.js` sends absence and streak reminders in the player's evening. It runs only in production or with `PUSH_REMINDERS=1`.
- On the client: `src/push.js`, plus the push handlers in `sw.js`.

**Security.**
- helmet's CSP sets `script-src 'self'`: no inline scripts, no inline event handlers, nothing from other origins. Inline styles are allowed.
- Rate limits apply to `/api/` and to failed sign-ins.
- The SQL admin console (`routes/adminRoutes.js`) exists only with `ENABLE_ADMIN=1`.
- In production the server refuses to start if `JWT_SECRET` is missing or the default. With the admin console on, it also refuses a missing or default `DEBUG_PASSWORD`.

## Testing

Run these in `backend/`.

- **`npm test`** runs engine, judge, onlineGame, push, streak, accountFlows and pages. It needs no database. Each suite first calls `require('./database').none()`, which sets `DATABASE_URL=memory`; `config/database.js` then builds no pool, and every query throws `NO_DATABASE`.
- **`npm run test:db`** runs ratedGame, ratedOnline, profile, emailAccount, lobby and matchmaking. These suites write rows, so they run only when `TEST_DATABASE_URL` names a throwaway database. Without it they print SKIPPED and exit 0.
- **Other suites:** `npm run test:elo` needs no database. `node tests/settings.test.js` needs a throwaway database and has no npm script. `test:jest` and `test:integration` are leftover scripts; there are no Jest suites.
- **How a suite works:** each file is a plain Node script with a small `test()` helper built on `assert`. It prints `N passed, M failed` and exits 1 on failure. To run one: `node tests/<name>.test.js`.

## Development

- `python serve.py` serves `web/` on http://localhost:8001 with caching disabled.
- To run the backend on :3001: `cd backend && npm install && npm run dev` (nodemon), or `npm start`.
  - It reads `backend/.env`, which starts from `.env.example`.
  - The template leaves out the VAPID and Resend keys.
  - Defaults are in `config/env.js`; `ENABLE_ADMIN`, `DEBUG_PASSWORD`, `DEBUG_HTTP` and `PUSH_REMINDERS` are read where they are used.
- `node backend/scripts/devNoDatabase.js` runs the server with `DATABASE_URL=memory`. Only guests can play and nothing is written, which makes it the safe way to try online flows in two tabs.
- `dev-local.ps1` (which uses `node-portable/`) and `dev-local.sh` start the backend and `serve.py` together.
- `.claude/launch.json` has three configurations:
  - `hexaequo-frontend`: serve.py on :8001;
  - `hexaequo-web`: plain `http.server` on :8765, which may serve stale modules;
  - `hexaequo-backend-nodb`: devNoDatabase.js on :3001.
- The schema is applied by `npm run db:init` (`createSchema`, safe to run more than once). `npm run db:dump` saves a snapshot to `.snapshots/`. `npm run db:reset` drops every table.
- `npm run pages` regenerates the page documents. `npm run icons` rebuilds the PNGs from `web/assets/logo.svg`, and `npm run share-image` the 1200×630 link-preview cards (`web/assets/share-{en,fr}.png`) from the logo, the board diagram, `tokens.css` and the locales. Both need the `sharp` dev dependency and are committed.

## Deployment and git

- The site runs as a Render Web Service with root directory `backend`. One origin serves the API, the socket and `web/`: https://hexaequo.com, also reachable as hexaequo-server.onrender.com.
- **A push to `main` deploys automatically.** Never push, or merge into `main`, as a side effect of another task, and commit only when asked.
- Nothing is compiled: Render installs the backend's dependencies and restarts. A deploy does not apply schema changes.
- Commit subjects are one plain English sentence saying what is now true for players, with no prefix and no final period, for example "Every page is the game, at an address of its own". The body explains why, what changed, and what was verified and what was not.

## Conventions

- Code, comments and commit messages are in English. Comments are prose that explains intent and history; keep that style.
- Every user-visible word lives in `web/src/locales/en.json` and `fr.json`, and both files keep the same keys.
  - In code: `t('section.key', { name })`, with an optional `…One` sibling key for n = 1.
  - In markup: `data-i18n`, `data-i18n-html` and `data-i18n-attr="attr:key"`.
  - `t()` falls back to English, then shows the key itself.
- Colours exist only as variables in `styles/tokens.css`. The board, the logo and the rule diagrams read `--tile-*` and `--piece-*`.
- `src/game/` stays free of DOM code. `pages.js`, `content/` and every module they import must also load under Node, because makePages.js and siteRoutes.js import them.
- New front-end modules go into `SHELL` in `sw.js`, so the app works offline from the first visit.
- Backend: CommonJS, layered as routes → controllers → services → models. Socket errors are stable codes that the client translates.

## Known pitfalls

1. **Regenerate the pages.** After changing a locale, `web/index.html`, `web/src/content/` or `pages.js`, run `npm run pages` in `backend/` and commit the output; `tests/pages.test.js` fails when it is stale. To check without writing, run `node scripts/makePages.js --check` or `npm run pages -- --check`. Plain `npm run pages --check` drops the flag and rewrites the files.
2. **`web/index.html` is also served one folder down,** at `/rules/`, `/fr/regles/` and so on. Reference files with paths from the root (`/src/…`, `/styles/…`), and keep its `page:head`, `page:data` and `page:view` markers.
3. **The CSP blocks inline code.** Inline scripts, `on…=` attributes and anything from another origin are refused. That is why `src/bootTheme.js` is a separate file.
4. **Never point tests or a dev server at the live database;** `backend/.env` may name it. Use `devNoDatabase.js` or `TEST_DATABASE_URL`. Remember that `db:reset` drops every table.
5. **User data.** `backend/.env` and `.snapshots/` hold secrets and user data. Never open, print or commit them.
6. **CORS.** Production is a single origin, so the app itself needs no CORS setup. The origin lists in `server.js` (REST) and `socket/io.js` (socket) exist only for development servers; keep the two in step.
7. **Engine positions are changed in place.** Call `cloneState()` before keeping one. Repetitions and the idle counter belong to the game's history, not to the position: the room or the view tracks them and passes them in.
8. **In-memory state.** Rooms, the queue, presence and challenges live in memory, so every deploy or restart ends the games in progress.
9. **Schema changes** go in both the `CREATE TABLE` statement and the `migrations` block of `models/schema.js`, and must then be applied with `npm run db:init`.
10. **Leftovers from the previous front end** that `web/` does not use:
    - `/api/rooms`, `/api/matchmaking`, `/api/games` and `/api/ai` (a placeholder);
    - the services behind them: `roomService`, `invitationService`, `matchmakingService`, and `gameService` with its `withFallback` in-memory stores;
    - `chatController` and `replayController`, which are not mounted.

    Build online features on the socket modules instead.
11. **Accounts from the Google sign-in days.** `users.google_id` is kept but never read. These accounts may have no password until a reset link sets one.
12. **Escape user text.** Views write HTML with `innerHTML`, so escape anything a user typed, such as chat messages and guest names.
13. **No `package.json` in `web/`.** Node loads `web/` modules as ES modules by detecting their syntax. Do not add a `package.json` there.

## Reference

- `web/README.md`: front-end layout and conventions.
- `docs/API.md` (REST) and `docs/SOCKET_EVENTS.md` (socket protocol). Where they disagree with the code, `backend/routes/` and `backend/socket/` are authoritative.
