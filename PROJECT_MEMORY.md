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

## 9. Current State Analysis (2025-12-11)

### What's Working
1. **Backend & Multiplayer**
   - ✅ `server/server.js` fully functional on Render (Express + Socket.IO + SQLite)
   - ✅ Room creation, joining, moves, rematches, reconnection all working
   - ✅ Full multiplayer protocol implemented

2. **Frontend Architecture**
   - ✅ Modern SPA shell in `frontend/` with dark/light themes
   - ✅ Navigation rail, flyouts, settings panel working
   - ✅ `canvasGraphics.js` rendering static board states
   - ✅ `gameController.js` handling clicks/touches for local play
   - ✅ `boardRenderer.js` connected to game store
   - ✅ `gameStore.js` managing state with observables
   - ✅ `socketClient.js` wrapping multiplayer (already migrated!)
   - ✅ Lobby panel (`lobby/panel.js`) for creating/joining rooms
   - ✅ PWA capabilities (service worker + manifest at root)

3. **Game Logic (Shared)**
   - ✅ `shared/game/` contains canonical move validation, state serialization, history management
   - ✅ Used by both legacy and modern code
   - ✅ `animationDiff.js` computing state changes for animation

4. **AI System (Migrated)**
   - ✅ `frontend/js/game/ai/aiEngine.js` - Minimax with alpha-beta pruning
   - ✅ `frontend/js/game/ai/aiWorkerStandalone.js` - Web Worker for non-blocking computation
   - ✅ `frontend/js/game/ai/aiClient.js` - High-level interface with worker fallback
   - ✅ Supports Easy/Medium/Hard (depth 2/3/4)

### What's NOT Working / Missing

1. **🔴 CRITICAL: Animations System**
   - ❌ `canvasGraphics.js` only has **stub methods** for animations (lines 95-112)
   - ❌ Methods like `queueMoveAnimation`, `queueJumpSequenceWithCaptures` only call `logEvent` - **no actual animation**
   - ❌ Legacy `hexaequo-v2/graphics.js` has full animation system with:
     - `activeAnimations` queue managing translation/fade effects
     - Smooth piece movement with easing
     - Multi-segment jump sequences
     - Capture animations (fade out)
     - Placement animations (scale/fade in)
     - Animation loop with requestAnimationFrame
   - ✅ `animationController.js` exists and builds animation queues
   - ❌ But those queues aren't executed - no rendering layer to consume them
   
   **Impact:** Moves appear instant with no visual feedback - poor UX

2. **🔴 Drag & Drop Not Implemented**
   - ❌ Modern `gameController.js` only handles clicks/taps
   - ❌ Legacy `hexaequo-v2/game.js` has full drag system (lines 169-176, 810-1020):
     - Mouse & touch drag events
     - Drag threshold detection (8px minimum)
     - Visual piece following cursor during drag
     - Drop validation with move execution
     - Cursor state management
   - ❌ No visual feedback for dragged pieces in modern renderer
   
   **Impact:** Users can't drag pieces - only click-to-select-then-click-to-move

3. **🟡 VS AI Mode Not Wired Up**
   - ✅ AI client fully implemented and migrated
   - ✅ UI has "Vs AI" button in flyout menu
   - ❌ Button shows placeholder: "Practice mode returns shortly" (line 425 of `frontend/index.html`)
   - ❌ No game mode controller to switch between local/AI/online
   - ❌ No difficulty selector in UI
   - ❌ No integration between AI client and game loop
   
   **Impact:** AI system exists but users can't access it

4. **🟡 Missing Features from Legacy**
   - ❌ Valid move highlights (legacy shows dots/highlights, modern has visual settings but not rendered)
   - ❌ Multi-jump turn ending (checkmark button to end sequence)
   - ❌ Contextual placement buttons (choose disc vs ring when both available)
   - ❌ Previous move highlighting (ring showing last move)
   - ❌ Undo/Redo functionality (buttons exist in legacy, not in modern)
   - ❌ Game end detection and rematch flow

5. **🟢 Documentation & Polish**
   - ⚠️ `docs/SOCKET_EVENTS.md` still placeholder
   - ⚠️ No deployment docs for Render server
   - ⚠️ Timer UI exists in design but not implemented in game
   - ⚠️ Spectator mode planned but not built

### Legacy Code Analysis (`hexaequo-v2/`)

**What it does well:**
- Full animation system with smooth transitions (350ms duration, configurable)
- Drag & drop with proper thresholds and visual feedback
- Complete game flow including AI integration
- IndexedDB persistence for game sessions
- Sound effects for all actions
- Full undo/redo with threefold repetition detection
- Multi-jump sequences with capture animations
- Placement UI (contextual disc/ring buttons)

**What to extract:**
1. Animation queue execution system from `graphics.js` (lines 24-320)
2. Drag event handlers from `game.js` (lines 810-1020)
3. Valid moves rendering system
4. Undo/redo integration patterns
5. Game end detection logic

## 10. Next Steps Checklist (Prioritized)

### Phase 1: Core Gameplay Polish (1-2 weeks)
- [ ] **CRITICAL: Implement animation system**
  - Port animation queue processor from `hexaequo-v2/graphics.js` to new `canvasGraphics.js`
  - Add requestAnimationFrame loop
  - Implement piece translation (move), fade-out (capture), scale-in (placement), tile fade-in
  - Connect `animationController.js` output to actual rendering
  - Test with all move types (adjacent, jump, multi-jump, ring jump)

- [ ] **CRITICAL: Implement drag & drop**
  - Add mousedown/touchstart handlers to `gameController.js`
  - Add drag state management (position, threshold, validation)
  - Update `canvasGraphics.js` to render dragged piece at cursor position
  - Validate drops and execute moves
  - Add ghost piece rendering for drag origin

- [ ] **HIGH: Wire up VS AI mode**
  - Create game mode state in `appStore.js` (local/ai/online enum)
  - Add difficulty selector to VS AI flyout panel
  - Connect AI client to game loop after player moves
  - Disable AI moves during animations
  - Add "thinking" indicator during AI computation
  - Remove "returns shortly" placeholder

### Phase 2: Complete Feature Parity (1-2 weeks)
- [ ] Implement valid move indicators (dots on tiles, piece highlights)
- [ ] Add contextual placement buttons (disc vs ring choice)
- [ ] Implement multi-jump end turn button (checkmark)
- [ ] Add previous move highlighting (ring overlay)
- [ ] Port undo/redo functionality to modern architecture
- [ ] Implement game end detection with rematch UI
- [ ] Add sound effects for all actions (already migrated soundManager exists)

### Phase 3: Multiplayer Polish (1 week)
- [ ] Test full online play flow with animations
- [ ] Implement timer UI display (exists in design, not rendered)
- [ ] Add reconnection UI feedback
- [ ] Document socket protocol in `docs/SOCKET_EVENTS.md`
- [ ] Add room settings UI (spectators, timer mode)

### Phase 4: Backend Migration (3-4 weeks)
- [ ] Decide on `server/server.js` evolution vs `backend/` rewrite
- [ ] Set up PostgreSQL on Render or alternative
- [ ] Implement user accounts & JWT auth
- [ ] Add Elo rating system
- [ ] Implement replay storage and playback
- [ ] Add spectator mode to socket protocol

### Phase 5: Production Ready
- [ ] Delete `hexaequo-v2/` folder after feature parity confirmed
- [ ] Performance testing & optimization
- [ ] Mobile responsive testing
- [ ] PWA installation testing
- [ ] SEO & metadata
- [ ] Analytics integration
