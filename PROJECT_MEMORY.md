# Hexaequo Platform Upgrade Memory

_Last updated: 2025-12-11 (post-v2-migration)_

## 1. Vision & Scope
- Keep `hexaequo-v2` playable on hexaequo.com while refactoring toward a modular SPA that can host multiplayer rooms, profiles, Elo ladders, and replays.
- Prioritize unblocking the frontend rewrite so legacy users see steady visual improvements before the new backend ships.
- Continue hosting the multiplayer server on Render while we plan the PostgreSQL-backed platform; protect uptime with lightweight observability even on the free tier.

## 2. Guiding Assumptions
- **Runtime stack:** Short-term production = `hexaequo-v2` (vanilla JS + Canvas) + `server/server.js` (Express + Socket.IO + SQLite). Mid-term goal remains Node 20 LTS + PostgreSQL + Redis as outlined by the `backend/` scaffolding.
- **Hosting:** Render.com currently runs the Socket.IO server; GitHub Pages serves the static client behind Cloudflare. We will keep this topology through the frontend migration, then evaluate Fly/Railway only if Render’s WebSocket limits pinch.
- **Auth & data:** No account system exists yet. Initial refactor will still rely on pseudo-based rooms; JWT auth, email verification, and Elo persistence land once PostgreSQL is provisioned.
- **Real-time transport:** Socket.IO already powers room creation, joining, moves, rematches, and reconnects. Future lobby/spectator namespaces will extend the same transport.
- **Focus order:** 1) modern frontend bridge + shared game logic, 2) richer multiplayer UX (lobby with spectator controls, timers surfaced beside player HUD), 3) full REST/API services.

## 3. Current Architecture Snapshot

### 3.1 Frontend layers
- **Legacy client (`hexaequo-v2/`)** is the only production-ready UI. `game.js` (≈2400 LOC) manages rules, AI hooks, online play, and ties directly into `GameGraphics`. `multiplayer.js` talks to the Render server, handles rematch cycles, persistence of room codes, and reconnection logic. Assets (`styles.css`, sounds, icons, manifest, service worker) already present PWA behavior.
- **Modern prototype (`frontend/`)** includes a dark-theme canvas playground (`index.html` + `js/main.js`) that mounts `boardRenderer` on a custom `canvasGraphics` adapter. It currently exposes dev buttons to mutate state but lacks routing, auth screens, or multiplayer wiring.
- **Stores:** `frontend/js/store/gameStore.js` is a minimal observable store wired to shared helpers. `appStore.js` and others are placeholders awaiting real state slices.

### 3.2 Shared game logic (`shared/game`)
- Contains the canonical move/state helpers now consumed by both UIs:
  - `constants.js` (axial math, ring offsets, default radius)
  - `gameState.js` (create/apply/serialize snapshots)
  - `moveValidator.js` (disc/ring move generation, adjacency checks, jump history constraints)
  - `history.js` (undo/redo manager with repetition detection)
  - `animationDiff.js` (turn-by-turn diff powering the new renderer queue)
- These modules are ESM-ready and already imported inside `hexaequo-v2/game.js`, proving the extraction path works.

### 3.3 Multiplayer server (`server/`)
- `server/server.js` is a working Express + Socket.IO app deployed on Render. It:
  - Stores rooms/players/game state in SQLite via better-sqlite3.
  - Exposes `create-room`, `join-room`, `make-move`, `leave-room`, `request-rematch`, `start-rematch`, and `leave-endgame` events.
  - Persists full serialized board state, enforces turn order, broadcasts opponent moves (including jump paths for highlighting), and cleans up stale rooms hourly.
  - Provides `/health` and `/room/:code` HTTP endpoints for monitoring/debugging.
- This service is the current live backend; there is no link yet between it and the scaffolding in `backend/`.

### 3.4 Future backend scaffolding (`backend/`)
- Mirrors the intended Express/Socket.IO + REST architecture but **only contains descriptive comments**. Files such as `controllers/authController.js`, `services/eloService.js`, `sockets/gameSocket.js`, and `config/env.js` are empty TODO markers. No migrations, models, or middleware exist yet.
- Before touching PostgreSQL, we must decide whether to evolve the existing Render server or replace it with the `backend/` app once it is real.

### 3.5 Documentation & tooling
- `DEPLOYMENT.md` still describes the GitHub Pages PWA migration and DNS steps; it does **not** mention the Render multiplayer server yet.
- `USAGE_NOTES.md` accurately documents how to serve the repo root, load both clients, and consume shared modules today.
- `docs/API.md`, `ELO_CALCULATION.md`, and `SOCKET_EVENTS.md` remain placeholders awaiting specs.

## 4. Gap Analysis & Constraints
- **Frontend debt:** Modern modules exist only for board rendering; gameplay flows, HUD, lobby UI, and auth views remain embedded in `hexaequo-v2`. Until the SPA shell handles rooms + sockets, we cannot retire the monolith.
- **Backend ambition vs reality:** The real-time Render server works but is SQLite-only, lacks auth, rating, or persistence beyond active rooms, and lives outside the new `backend/` tree.
- **Docs & monitoring:** Operational docs lag behind the actual deployment topology; no observability hooks beyond console logging exist yet.
- **Resource focus:** To unblock visible progress, the frontend refactor must lead, with backend/API work happening in parallel only once the UI can call new endpoints.

## 5. Next Steps (prioritized)
1. **Stabilize shared state bridge**
   - Expand `gameStore`, `animationController`, and `canvasGraphics` so they can replay real move histories from `shared/game/history.js`.
   - Extract serialization/apply helpers from the monolith into the store so both UIs consume identical data contracts.

2. **Integrate legacy multiplayer client into the new shell**
   - Wrap `hexaequo-v2/multiplayer.js` logic as an ES module under `frontend/js/utils/socketClient.js`.
   - Provide a thin adapter so the modern renderer can subscribe to Socket.IO events without rewriting the network layer yet.

3. **Rebuild UI panels in `frontend/`**
   - Create SPA wiring in `app.js` (view state, router, layout) and port critical HUD elements (inventory, turn indicator, controls) from `hexaequo-v2`, ensuring timers render beside each player pseudo/Elo whenever a timed mode (classic/rapid/blitz) is selected and remain hidden in no-timer rooms.
   - Add lobby/create-room forms that call the existing Render endpoints, exposing spectator-allowed toggles and timer presets so room creators can decide whether observers are permitted before sockets support them server-side.

4. **Document and harden the Render server**
   - Capture its API/socket contract inside `docs/SOCKET_EVENTS.md`.
   - Add environment docs for Render (env vars, database file management) and basic logging/monitoring hooks.

5. **Stand up the real backend incrementally**
   - Once the SPA drives multiplayer flows, implement the first functional slice inside `backend/` (e.g., env loader + health endpoint + room routes backed by PostgreSQL) while keeping Render’s SQLite server as a fallback.

## 6. Working Version Outlook
- A “better-structured” playable client on hexaequo.com simply requires steps 1–3 above. With focused effort, that’s roughly **3–4 weeks** of work (shared store refactor, Socket.IO adapter, SPA HUD/lobby). After that, the legacy UI can be hidden behind a beta toggle while the same Render server keeps games running.
- Full platform features (auth, Elo, replays) depend on the PostgreSQL backend and will follow once the frontend can consume new endpoints reliably.

## 7. Decision Log
| Date | Decision |
|------|----------|
| 2025-12-09 | Keep the Render-hosted Socket.IO server online while prioritizing the frontend refactor; delay PostgreSQL work until the new SPA is feature-complete enough to call fresh endpoints. |
| 2025-12-10 | Lobby create forms must expose spectator-permitted toggles and timer mode selection; timers render adjacent to pseudo/Elo headers and stay hidden when rooms opt out of timers. |
| 2025-12-11 | **Legacy hexaequo-v2 migration completed**: Client-side AI (minimax with Web Worker), PWA capabilities (service worker + manifest), and all unique features extracted to main app. Root index.html now redirects to `frontend/` instead of `hexaequo-v2/`. The v2 folder is ready for removal once testing confirms parity. |

## 8. hexaequo-v2 Migration Summary (2025-12-11)

### What was migrated
1. **Client-side AI** (`frontend/js/game/ai/`)
   - `aiEngine.js` - Minimax algorithm with alpha-beta pruning adapted to main app's game state
   - `aiWorkerStandalone.js` - Web Worker for background AI computation (prevents UI blocking)
   - `aiClient.js` - High-level interface with automatic worker/main-thread fallback
   
2. **PWA Capabilities** (root level)
   - `manifest.json` - App manifest with icons, shortcuts, and metadata
   - `service-worker.js` - Offline caching strategies (static assets, dynamic content, API fallback)
   - Updated `index.html` - Added PWA meta tags and service worker registration
   
3. **Theme System**
   - Main app already has superior dark/light theme system via CSS variables in `frontend/css/base.css`
   - Legacy v2 color schemes (Classic/Modern) mapped to CSS theme variables
   - Both themes now available through unified CSS system

### Features preserved from v2
- ✅ Offline AI gameplay with configurable difficulty (easy/medium/hard = depth 2/3/4)
- ✅ Web Worker computation (non-blocking UI during AI "thinking")
- ✅ PWA installability and offline mode
- ✅ Service worker caching strategies
- ✅ All evaluation heuristics and move ordering optimizations

### Features NOT migrated (already better in main app)
- ❌ Basic canvas rendering → Main app has superior `canvasGraphics.js` with animation system
- ❌ Simple color schemes → CSS theme system more flexible and maintainable
- ❌ Coordinate display toggle → Not essential for production, can add later if needed
- ❌ Grid toggle → Not essential for production, can add later if needed
- ❌ Basic multiplayer → Main app has full room-based system with lobby, spectators, etc.

### Next actions
- [ ] Test AI client integration in main app (create vs-AI game mode UI)
- [ ] Verify service worker caching on production deployment
- [ ] Delete `hexaequo-v2/` folder after confirming all features work in main app
- [ ] Update deployment documentation to reflect PWA setup

## 9. Next Steps Checklist
- [ ] **NEW:** Integrate AI client into main app game modes (create "Play vs AI" flow)
- [ ] **NEW:** Test PWA installation and offline gameplay
- [ ] Expand `frontend/js/store/gameStore.js` to apply serialized states + feed the animation queue.
- [ ] Create `frontend/js/utils/socketClient.js` by wrapping the existing multiplayer client for reuse in the SPA shell.
- [ ] Scaffold the SPA layout in `frontend/js/app.js` (view state + router) and port HUD controls, including timer placement beside pseudo/Elo when time modes are active.
- [ ] Update `docs/SOCKET_EVENTS.md` with the actual Render contract and capture hosting/env details.
- [ ] Choose the path for evolving `server/server.js` vs. replacing it with the `backend/` app once PostgreSQL is ready.
