# Hexaequo Platform Upgrade Memory

_Last updated: 2025-12-09_

## 1. Vision & Scope
- Transform Hexaequo into a full-fledged multiplayer platform with account system, Elo ladders, room browser, spectators, and replay analysis.
- Maintain compatibility with existing web client while preparing for responsive redesign and future native apps.
- Prioritize security, reliability, and observability even on a bootstrapped budget.

## 2. Guiding Assumptions
- **Backend runtime:** Node.js 20 LTS (Express + Socket.IO) – aligns with existing `server/server.js` and Render hosting.
- **Database:** PostgreSQL managed service (Supabase, Neon, or Railway free tier) for relational integrity, JSON support, and analytics.
- **Authentication:** JWT-based (short-lived access + rotating refresh) with optional email verification gated features. Users can log in via pseudo or email.
- **Real-time transport:** Socket.IO for moves, timers, chat, and spectator streams. REST for auth/profile/history CRUD.
- **Hosting (initial):** Render free tier for API + Socket.IO, GitHub Pages for static client; ready to migrate to Fly.io or Railway if WebSocket limits hit. Domain (`hexaequo.com`) sits behind Cloudflare for SSL and caching.
- **Budget/Timeline:** 6-week rollout for core experience, anticipating growth to low-thousands of concurrent users next year.

## 3. High-Level Architecture
```
clients (web, mobile-ready)
   │
   ├── REST API (Express)
   │     ├── auth, users, profiles
   │     ├── rooms, games, history
   │     └── ai orchestration endpoints (optional)
   │
   └── Socket.IO namespace(s)
          ├── /lobby  – room list, filters, spectators
          ├── /game   – moves, timers, resign/draw, emojis
          └── /spectate – delayed broadcast, viewer counts

services
   ├── AuthService (JWT, email confirm, password reset)
   ├── EloService  (per time-control pools, friendly flag)
   ├── GameService (state machine, storage)
   ├── ReplayService (move list + evaluation cache)
   ├── NotificationService (email + in-app)
   └── AIService (bridge to existing `hexaequo-v2/ai.js` logic)

data
   ├── PostgreSQL (core transactional)
   └── Redis (future: session cache, rate limits, queue)
```

## 4. Backend Plan
### 4.1 Directory Layout
```
backend/
  server.js                 # Express bootstrap, Socket.IO init
  config/
    env.js                  # loads env vars, typed config
    rateLimit.js            # reusable express-rate-limit configs
  routes/
    authRoutes.js           # signup/login/refresh/confirm/reset
    userRoutes.js           # profile, settings, icons
    roomRoutes.js           # create/list/update room metadata
    gameRoutes.js           # game history, replay fetch
    aiRoutes.js             # optional AI endpoints (vs bots)
  controllers/
    authController.js       # orchestrates AuthService + validation
    ...                     # same pattern for user/room/game
  middleware/
    authMiddleware.js       # verify JWT, attach user
    validationMiddleware.js # schema validation via Zod/Joi
    errorHandler.js         # centralized error formatting
  models/
    userModel.js            # queries via SQL builder (Kysely/Knex)
    ...
  services/
    authService.js          # password hashing (argon2), tokens
    emailService.js         # SendGrid/Mailgun adapters
    eloService.js           # rating calc per pool
    gameService.js          # persistence, timer grace logic
    replayService.js        # PG + object storage for moves
    settingsService.js      # theme/sound toggles
  sockets/
    lobbySocket.js          # room list broadcast, filters
    gameSocket.js           # move handling, timer sync, resign/draw
    spectatorSocket.js      # delayed board state, viewer count
    chatSocket.js           # emoji throttling (1 per turn)
  utils/
    logger.js               # pino/winston with Render logs
    crypto.js               # random ids, token helpers
    validationSchemas.js    # shared Zod schemas (email, pseudo)
  tests/
    integration/
    unit/
```
_All files to be scaffolded with descriptive comments (see directory section below)._ 

### 4.2 Key Services
- **AuthService**: signup flow, email confirmation tokens (exp 24h), login, remember-me (refresh token cookie), password reset.
- **EloService**: implements classical Elo, separate pools per time control (Classic, Rapid, Blitz). Friendly mode bypass flag.
- **GameService**: creates game records, enforces move order, handles resign/draw/timeouts, stores move documents.
- **ReplayService**: stores `moves[]`, `notation`, `evalScore` per ply; exposes playback snapshots for UI.
- **AIService**: wraps current `ai.js`, enables server-side evaluation for future features (analysis bar, rating self-play harness).

### 4.3 Realtime Design
- **Namespaces** isolate lobby traffic from intense game streams.
- **Timers**: server authoritative; emits `timer-sync` every 1s to both players, spectators receive delayed (e.g., 1.5s) updates.
- **Spectators**: join read-only rooms, emit `spectator-count` to players, never receive chat channel subscription.
- **Disconnect Grace**: server sets `pendingDisconnect` timer (90/60/30s) depending on time control; auto-resignation on expiry.

### 4.4 Database Outline (PostgreSQL)
| Table | Purpose |
|-------|---------|
| `users` | id, email (nullable for guest), pseudo (unique), password_hash, status, creation timestamps |
| `email_verifications` | token, user_id, expires_at |
| `sessions` | user_id, refresh_token, device info, remember-me flag |
| `profiles` | elo_classic/rapid/blitz, default_theme, sound, icon, ai_preference |
| `settings` | JSONB per feature toggles (valid moves, highlights, animations) |
| `rooms` | room_code, host_id, config (time, increment, friendly, rating range), status |
| `room_players` | room_code, user_id (or guest_id), color, rating_snapshot |
| `games` | game_id, room_code, winner_reason (abandonment/time/ex aequo), friendly_flag |
| `game_moves` | move_id, game_id, ply, notation, move_blob (JSON), eval_score |
| `spectators` | room_code, user_id, joined_at |
| `ai_ratings` | ai_level, estimated_elo, samples |
| `password_resets` | token, user_id, expires_at |

Use Prisma or Kysely for type-safe queries; migrations via `drizzle-kit` or `knex`.

## 5. Frontend Plan
### 5.1 Modularization Strategy
- Keep current `hexaequo-v2` assets but refactor into `frontend/` workspace for maintainability.
- Split `game.js` into smaller modules: board rendering, move logic, timers, chat, overlays.
- Introduce a lightweight state manager (Zustand-like store or simple pub/sub) without adopting a full framework yet.

### 5.2 Directory Layout
```
frontend/
  index.html
  css/
    base.css           # typography, colors, layout
    auth.css           # login/signup forms
    lobby.css          # room grid, filters, spectate mode
    game.css           # board, HUD, timers, chat toggle
    profile.css        # settings + history view
  js/
    app.js             # SPA-style router, bootstraps modules
    api/
      httpClient.js    # fetch wrapper w/ JWT, retry
      authApi.js
      roomApi.js
      gameApi.js
      profileApi.js
    auth/
      login.js         # handles pseudo/email + password
      signup.js        # validations, email optional toggles
      confirmEmail.js
      forgotPassword.js
    lobby/
      roomList.js      # filtering, sorting, pagination
      roomFilters.js   # rating/time sliders, friendly flag
      createRoom.js    # config selection, friendly checkbox
      spectatorList.js # viewer counts
    game/
      gameController.js    # orchestrates board + sockets
      boardRenderer.js     # canvas/SVG interactions
      moveValidator.js     # Hexaequo rules
      timerController.js   # integrates server ticks
      chatPanel.js         # emoji selector (rate-limited)
      surrenderControls.js # resignation + confirmation UI
      drawOffer.js         # Ex Aequo flow controls
      notificationBanner.js# inline confirmations (no popups)
      spectatorOverlay.js  # watchers indicator
    replay/
      replayViewer.js      # playback with undo/redo
      notationPanel.js     # algebraic notation list
      evaluationBar.js     # server-provided eval timeline
    profile/
      profilePage.js       # settings UI + icon picker
      historyList.js       # table of past games
      historyFilters.js
      eloChart.js          # Chart.js/D3 component
    store/
      appStore.js          # global state (user, settings)
      settingsStore.js     # theme/sound toggles
    utils/
      validators.js        # email/pseudo/password checks
      socketClient.js      # wraps Socket.IO client
      storage.js           # localStorage for remember me + guest prefs
      formatter.js         # time + notation helpers
  assets/
    icons/
    sounds/
    flags/
```

### 5.3 UX Principles
- **Main menu**: login/signup/guest entry with accessible forms.
- **Lobby**: searchable list of rooms, quick filters, active spectator counts.
- **Game HUD**: pseudo + Elo + remaining time near inventory; friendly indicator; resign + Ex Aequo buttons with inline confirmations.
- **Chat**: emoji strip with tooltips, collapse toggle, enforced one-per-turn limit via server ack.
- **Replay**: timeline scrubber, move list with adapted notation, evaluation bar fed by AI evaluation service.

### 5.4 Legacy Migration Strategy
- Phase game.js decomposition by extracting pure logic first (constants, validators, serialization) into `frontend/js/game/*` while keeping rendering glue in the legacy file.
- Introduce a thin state store module to own inventories, captured counts, and undo history; migrate `serializeGameState`/`applyGameState` next.
- Once logic lives in reusable modules, rebuild input handlers and UI bindings on top of the new SPA shell, then retire the monolithic script.
- **Progress log:** `constants.js`, `moveValidator.js`, `gameState.js`, and `store/gameStore.js` now contain ESM-ready helpers so future UI work can import shared logic without re-reading the legacy file.

## 6. Deployment & Operations
| Layer | Option | Notes |
|-------|--------|-------|
| API + Socket.IO | Render (existing) | Free tier: sleeps after inactivity, limited WebSocket throughput; fine for MVP. Alternative: Fly.io (free 3 shared CPUs) or Railway (starter tier) for more control. |
| Static frontend | GitHub Pages (current) | Continue for now; later move to Cloudflare Pages or Netlify for better CI. |
| Domain & SSL | Cloudflare proxy in front of GitHub Pages + Render; configure DNS `api.hexaequo.com` -> Render service, `hexaequo.com` -> Pages. |
| Database | Supabase (free 500 MB) or Neon (nearly infinite branching). Render PostgreSQL free tier also possible but limited storage. |
| Email | Resend, Mailersend, or SendGrid free quota (100 emails/day) for confirmations + password reset. |
| Monitoring | Logtail/BetterStack (free) or Render native logs; Sentry for JS + Node error tracking. |

## 7. Feature Workstreams & Sequencing (6-Week Target)
1. **Week 1 – Foundations**: Provision Postgres, implement migrations, bootstrap Express app structure, env management, linting/tests.
2. **Week 2 – Auth & Profiles**: Signup/login/refresh, remember-me, optional email verification, password reset, basic profile settings storage.
3. **Week 3 – Lobby & Rooms**: Room CRUD, filters, Socket.IO lobby namespace, friendly mode flag, spectator registration, timer presets.
4. **Week 4 – Game Loop**: Move pipeline, timers with grace logic, resign + Ex Aequo flow, emoji chat restrictions, spectator delay broadcast.
5. **Week 5 – Replays & Elo**: Game persistence, notation generator, evaluation hook, Elo updates per time pool, friendly bypass.
6. **Week 6 – Polish & Ops**: Game history UI, evaluation bar, deployment scripts, monitoring hooks, monetization scaffolding (skins/emojis), final QA.

## 8. Research & Open Tasks
- **AI Elo Calibration**: schedule bot-vs-bot tournaments (100+ games per difficulty pair) executed offline; update `ai_ratings` table with mean results.
- **Notation Specification**: finalize Hexaequo algebraic format (coordinates, captures, multi-jumps) to ensure consistent logging.
- **Evaluation Service**: determine whether to run AI evaluations server-side (cost) or approximate using lightweight heuristic for early releases.
- **Mobile Readiness**: audit responsive layout and identify components needing touch-gesture refactors.
- **Premium Cosmetics**: define asset pipeline for purchasable skins/emojis without pay-to-win impact.

## 9. Decision Log
| Date | Decision |
|------|----------|
| 2025-12-09 | Adopt Node/Express + Socket.IO monorepo with PostgreSQL, JWT auth, modular frontend; require email for account-level features but allow pseudo+password login once confirmed; spectators observe with delayed stream and no chat access. |

## 10. Next Steps Checklist
- [ ] Provision PostgreSQL instance (Supabase/Neon) and capture credentials.
- [ ] Finalize environment variable schema (API keys, JWT secrets, rate limits).
- [ ] Implement scaffolding files as described (placeholders first, then incremental coding).
- [ ] Define wireframes for login, lobby, game HUD, replay views.
- [ ] Draft detailed API + Socket event contracts in `/docs` (future task).
