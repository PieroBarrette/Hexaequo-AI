# Hexaequo AI - Copilot Instructions

## Project Overview
Hexaequo is a strategic hexagonal board game with a pure-JavaScript PWA frontend (`hexaequo-v2/`), REST API backend for user management and game history, and shared game logic for both client and server.

## Architecture: Two-Tier + Shared Logic

### Core Components
1. **Frontend PWA** (`/hexaequo-v2/`) - Vanilla JS, Canvas rendering, Web Workers for AI. Entry: `index.html`
2. **Backend API** (`/backend/`) - Express REST API + Socket.IO. Auth (JWT), ELO ratings, game history. Port 3001
3. **Shared Logic** (`/shared/game/`) - Pure ES modules imported by both frontend and backend. NO platform dependencies

### Critical Architecture Details
- **NO `/frontend` or `/server` directories exist** - old references in docs are outdated
- Frontend connects to backend on **port 3001** (see `hexaequo-v2/multiplayer.js` and `hexaequo-v2/lobby.js`: `const BACKEND_PORT = 3001`)
- Backend uses **PostgreSQL with memory fallback** (`backend/services/gameService.js` - `withFallback()` pattern)
- AI runs in **Web Worker** (`hexaequo-v2/ai-worker.js`) to avoid blocking UI during minimax search

### Client-Side Hash Router (`hexaequo-v2/router.js`)
Custom lightweight hash-based router. Exposed as `window.Router`.

**Route Table**:
| Hash | View | Auth Guard | Handler |
|---|---|---|---|
| `#/` | Main Menu | No | `showMainMenu()` |
| `#/local` | Local Setup | No | `showLocalConfig()` |
| `#/online` | Online Lobby | Yes → `#/auth` | `showOnlineOptions()` |
| `#/auth` | Sign In / Register | No | `showAuthSection()` |
| `#/settings` | Settings | No | `showSettings()` |
| `#/profile` | Profile | Yes → `#/auth` | `GameProfile.openProfileDirect()` |
| `#/replay/:id` | Replay Viewer | No | `GameReplay.openReplayDirect(id)` |
| `#/game` | In-Game | Not navigable | Set by `startOnlineGame()` / `startConfiguredLocalGame()` |

**API**: `Router.navigate(hash, {replace?})`, `Router.back()`, `Router.start()`, `Router.getCurrent()`, `Router.is(pattern)`, `Router.on(pattern, handler)`, `Router.resolve()`

**Key Patterns**:
- Route handlers call `*Direct()` variants (e.g., `openProfileDirect()`) to avoid re-navigation loops
- Button clicks use `Router.navigate('#/route')` instead of calling show functions directly
- Auth guards redirect to `#/auth` with `replace: true`; after login, navigate to `#/online`
- `#/game` is set via `replace: true` when a game starts — not directly navigable
- Reconnect banner: On page load, `checkReconnectBanner()` checks `localStorage.hexaequoRoom` (24h TTL) and shows a banner to rejoin an in-progress online game via `Multiplayer.rejoinRoom()`
- All `returnToLobby()` / `goToMainMenu()` calls use `Router.navigate('#/')` with manual fallback

## Game State & Hex Grid System

### Hex Coordinates (Cube System)
- Coordinates: `(q, r)` stored as strings `"q,r"` in objects (e.g., `"0,0": "black"`)
- Board radius: `BOARD_RADIUS = 8` (from `shared/game/constants.js`)
- Validation: `isWithinBoard(q, r, radius)` checks `|q| <= r && |r| <= r && |q+r| <= r`
- Grid math: `getNeighbors(q, r)` returns 6 adjacent hexes using `HEX_DIRECTIONS`

### Game State Structure (`shared/game/gameState.js`)
```javascript
{
  tiles: { "0,0": "black", "1,0": "black", ... },  // Board positions
  pieces: { "1,0": {type: "disc", color: "black"}, ... },  // Pieces on board
  inventory: { black: 7, white: 7 },  // Unplaced tiles
  discInventory: { black: 5, white: 5 },  // Unplaced discs
  ringInventory: { black: 3, white: 3 },  // Unplaced rings
  captured: { black: {disc: 0, ring: 0}, white: {...} },  // Captured pieces
  activePlayer: "black",  // Current turn
  metadata: { moveHistory: [...], multiJumping: false, ... }  // Game metadata
}
```
- Victory: Capture 6 discs (`DISC_CAPTURE_WIN`) OR 3 rings (`RING_CAPTURE_WIN`)

## Data Flow & Validation Pattern

### Move Validation (CRITICAL)
**Two-phase validation** - client-side preview + server-side enforcement:
1. Frontend (`hexaequo-v2/modules/gameController.js`): Validates before emitting socket event
2. Backend (`backend/socket/socketHandler.js`): Re-validates via `shared/game/moveValidator.js` before applying

**Never duplicate validation logic** - always import from `shared/game/moveValidator.js`:
- `canPlaceTile(tiles, q, r, player, inventory)` - Check tile placement rules
- `canPlaceDisc(tiles, pieces, q, r, player, discInventory)` - Check disc placement
- `getValidMovesForPiece(gameState, q, r)` - Get all legal moves for a piece
- ALL validation functions return `{valid: boolean, reason?: string}`

### Socket.IO Communication
**Production URL**: `https://hexaequo-server.onrender.com` (Render deployment)
**Dev URL**: `http://localhost:3001` (auto-detected by hostname check)

Key events (see [docs/SOCKET_EVENTS.md](../docs/SOCKET_EVENTS.md)):
- **`create-room`** → Server creates game, returns `roomCode` + initial `gameState`
- **`join-room`** → Join with `roomCode`, receive opponent data
- **`play-move`** → Emit move, server validates → broadcasts `game-update`
- **`opponent-moved`** → Receive opponent's validated move
- **Pattern**: All events use callbacks: `socket.emit('event', data, (response) => {...})`

## Development Workflows

### Local Development
```bash
./dev-local.sh  # Starts backend (3001) + frontend (8080) with live reload
```
- Backend: `cd backend && npm run dev` (nodemon watches for changes)
- Frontend: `cd hexaequo-v2 && npx http-server -p 8080 -c-1 --cors`
- Backend .env created from `.env.example` on first run

### Database Management
```bash
cd backend
npm run db:init     # Initialize PostgreSQL schema
npm run db:reset    # Drop + recreate all tables
npm run db:cleanup  # Remove old/stale data
```
**Fallback pattern**: All services try PostgreSQL first, then in-memory store if DB unavailable

### Testing AI
AI uses **minimax with alpha-beta pruning** + **transposition table**:
- Depth controlled by `AI_SEARCH_DEPTH` (default 3) in `hexaequo-v2/ai.js`
- **Level 0** (Beginner): `depth=0` — greedy evaluation, no lookahead (picks best immediate move)
- **Levels 1-4**: Increasing minimax depth for stronger play
- **Position hashing** for draw detection (3-fold repetition) via `getPositionHash(state)`
- Test levels 0-4 via lobby UI (`blackAiLevel`/`whiteAiLevel` selects)

## Project-Specific Conventions

### Localization (CRITICAL)
**ALL user-facing text MUST be localized** - never hardcode text strings in HTML or JS:
- Add keys to both `hexaequo-v2/locales/en.json` and `hexaequo-v2/locales/fr.json`
- HTML: Use `data-i18n="section.key"` attribute (e.g., `<span data-i18n="lobby.play">Play</span>`)
- JS: Use `i18nT('section.key')` or `window.i18nT('section.key')` function
- Update text on language change if set dynamically (see `game.js` showLoader pattern)

### File Naming & Organization
- **Controllers**: `*Controller.js` (e.g., `authController.js` handles /api/auth routes)
- **Services**: Business logic layer (e.g., `eloService.js` - ELO calculations, `gameService.js` - game CRUD)
- **Models**: PostgreSQL schema in `backend/models/` + memory fallbacks in `memoryGameStore.js`
- **Routes**: `backend/routes/*.js` define Express endpoints, map to controllers
- **Socket handlers**: All WebSocket logic in `backend/socket/socketHandler.js`

### ELO Rating System (`backend/services/eloService.js`)
**Active**: `eloService.js` is imported and used by `gameService.endGame()` for all ELO calculations.

**Single global ELO**: One `elo` column in `users` table (INTEGER, default 1000). No per-time-mode ratings.

**K-factors vary by experience**:
- New players (<30 games): `K_NEW_PLAYER = 40` (high volatility)
- Established: `K_ESTABLISHED = 20`
- High-rated (>2400): `K_HIGH_RATED = 10` (stable)

**Default rating**: `DEFAULT_ELO = 1000`
**Time mode multipliers** (affect ELO change magnitude, but all write to the same `elo` column):
- `none`: 0 (friendly/unrated - no ELO change)
- `bullet`: 0.75 (less variation for fast games)
- `blitz`: 0.9
- `rapid`: 1.0 (standard)
- `classic`: 1.2 (more points for longer games)

**ELO triggers**: Game end (capture win, timeout), resignation, and draw all trigger ELO via `gameService.endGame()`.
**Friendly exclusion**: Time mode `'none'` has multiplier 0, so ELO change = 0.
**Frontend ELO shape**: Always a flat number. Backend returns `elo` as a number in all endpoints (login, register, /users/me). Frontend keeps backward-compat normalization.

**ELO event flow** (socket communication):
- Server emits personalized `elo-updated` to each player's socket individually with `{ change, oldElo, newElo }`
- `emitEloUpdatedToPlayers()` helper in `socketHandler.js` handles per-socket emission using room's host/white socket IDs
- Frontend `onEloUpdated()` displays the change in the game-over popup; stores pending data if popup not yet created
- Client-side dedup: only the winner (or black for draws) emits `game-ended`; resign/draw/timeout paths pass `skipReport=true` to `endGame()` since those are already handled server-side by their specific socket handlers
- Server-side idempotency: `findGameByRoomCode()` returns `null` for already-completed games (filters `winner IS NULL`), so duplicate `game-ended` emissions are harmless

**DB migration**: `backend/scripts/migration_single_elo.sql` merges old `elo_classic/rapid/blitz` columns into single `elo` column

### Authentication Requirements
**Online play requires sign-in** - no guest/anonymous play:
- Main menu shows "Sign in to play online" button if not authenticated
- Lobby is only accessible to logged-in users
- Local play (vs AI or pass-and-play) always available without sign-in
- Invite links redirect to sign-in if not authenticated, then back to invite
- No guest feature exists — all online players must have an account

### Keep Me Signed In / Token Refresh
**"Keep me signed in" checkbox** on both Sign In and Register forms (unchecked by default):
- **Checked**: tokens stored in `localStorage` (persist across browser sessions)
- **Unchecked**: tokens stored in `sessionStorage` (cleared when browser closes)
- Preference flag (`hexaequo_persistent`) always in `localStorage` so `checkExistingSession()` knows where to look

**Token refresh** is fully wired up:
- `refreshAccessToken()` calls `POST /api/auth/refresh` with stored refresh token
- `authenticatedFetch()` wraps `fetch()` with auto-`Authorization` header + silent 401 retry via refresh
- All authenticated API calls in lobby.js use `authenticatedFetch()` instead of raw `fetch()`
- `window.GameLobby.authenticatedFetch` exposed for other modules

**Storage keys**: `hexaequo_session` (access token), `hexaequo_refresh` (refresh token), `hexaequo_persistent` (preference flag)
**multiplayer.js + userMenu.js**: Both check `localStorage` then `sessionStorage` for token reads/clears

**Registration auto-login**: `authService.createUser()` now calls `generateTokens()` and returns tokens, so new users are immediately signed in.

### Module System Nuances
- **Frontend**: Pure ES modules (`type: "module"` in script tags or `import` statements)
- **Backend**: CommonJS (`require()`) for most files, except Socket.IO uses `const { Server } = require('socket.io')`
- **Shared**: ES modules with `.js` extensions (`import { X } from './constants.js'`)
  - Backend imports via relative paths: `const { validateMove } = require('../shared/game/moveValidator.js')`

### Error Handling Pattern
**Backend standardized errors** (`backend/middleware/errorHandler.js`):
```javascript
throw notFound('Game');  // 404 with "Game not found"
throw unauthorized('Invalid token');  // 401
// Middleware catches and formats as: {error: "NOT_FOUND", message: "Game not found"}
```

**Socket.IO errors** use callbacks:
```javascript
socket.emit('join-room', {roomCode}, (response) => {
  if (!response.success) {
    console.error(response.error);  // Handle error
  }
});
```

## Integration Points

### Frontend → Backend REST API
**Auth flow** (see [docs/API.md](../docs/API.md)):
1. `POST /api/auth/signup` → Returns `{accessToken, refreshToken, user}`
2. Store tokens in localStorage: `localStorage.setItem('accessToken', token)`
3. Add to requests: `Authorization: Bearer ${accessToken}`
4. Refresh via `POST /api/auth/refresh` when 401 received

**Game history** (`GET /api/games?playerId=X`):
- Returns paginated list with ELO changes, time modes, opponents
- Replay data: `GET /api/games/:id/replay` → Full move history for visualization

### Shared Logic Import Examples
**Backend** (CommonJS):
```javascript
const { BOARD_RADIUS, DISC_CAPTURE_WIN } = require('../../shared/game/constants.js');
const { createInitialState } = require('../../shared/game/gameState.js');
```

**Frontend** (ES Module):
```javascript
import { BOARD_RADIUS } from './modules/index.js';  // Re-exports from shared
import { validateMove } from './modules/moveValidator.js';
```

## Common Pitfalls

1. **Wrong directory references**: Old docs mention `/frontend` or `/server` - actual frontend is `/hexaequo-v2`, backend handles both REST and WebSocket
2. **Direct state mutation**: Game state is immutable - always clone before modifying (use `cloneState()` from `hexaequo-v2/modules/gameState.js`)
3. **Missing move history**: Server MUST append to `metadata.moveHistory` before broadcasting updates (used for replays + draw detection)
4. **Socket.IO CORS**: Must whitelist origins in `backend/socket/socketHandler.js` (currently includes localhost, Render, GitHub Pages)
5. **AI blocking UI**: Always use Web Worker (`ai-worker.js`) for AI calculations, never run minimax on main thread
6. **Root redirect preserves query params**: `index.html` uses JS redirect (not meta-refresh) to preserve `?invite=CODE` and other parameters when redirecting to `hexaequo-v2/index.html`
7. **ELO is always a flat number**: Backend returns `elo` as an integer in all endpoints. Frontend keeps backward-compat normalization (`typeof elo === 'object' ? elo.classic : elo`) but this path should never trigger with current backend.
8. **`/users/me` response shape**: Returns `{ data: { pseudo, elo, ... } }` — access via `data.data`, not `data.user`
9. **ELO game-end dedup**: `endGame()` in `game.js` uses `skipReport` param — resign/draw/timeout pass `true` since those paths already trigger `gameService.endGame()` server-side. For normal wins, only the winner emits `game-ended` (or black for draws)
10. **ELO display race condition**: `elo-updated` socket event may arrive before the game-over popup is created. `onEloUpdated()` stores pending data in `pendingEloUpdate`; `endGame()` applies it after creating the `eloUpdateDisplay` div
11. **connectedSockets roomCode tracking**: Every code path that joins a socket to a room (create-room, join-room, accept-invitation, matchmaking match, reconnection) MUST also update `connectedSockets.get(socket.id).roomCode`. Missing this causes chat and other room-scoped features to silently fail (`not_in_room` error)
12. **Game record required for ELO**: `gameService.createGame()` MUST be called when a game starts in ALL paths (join-room, accept-invitation, matchmaking match). Without a DB game record, `findGameByRoomCode()` returns null and ELO calculation is silently skipped. All three paths now create game records.
13. **Invite code persistence**: Invite code is stored in `sessionStorage('hexaequo_pending_invite')` and invite info in `sessionStorage('hexaequo_pending_invite_info')`. Both are cleared only after `acceptInvitation()` succeeds — never on `get-invitation-info` success. This ensures the invite survives page refreshes during the sign-in flow.
14. **Chat close-on-click-outside**: Chat widget uses an overlay div (`.chat-overlay`, z-index 1499) matching the hamburger menu pattern. Escape key also closes. Quick messages grid is scrollable (`overflow-y: auto`) for small screens.
15. **Toolbar player info IDs**: `blackPlayerInfo`/`whitePlayerInfo` IDs are on `.toolbar-player` divs inside `#undoRedoToolbar`, not standalone elements. JS uses `getElementById('blackPlayerInfo').querySelector('.player-name')` — never change these IDs or inner class names.
16. **Canvas offset breakpoints**: `#gameCanvas` `margin-top` and `#inventoryCanvas` `top` must stay in sync across all breakpoints: base=70px, ≤480px=64px, ≤375px=58px, landscape phones=50px, landscape tablets=65px. Mismatches cause canvas/toolbar overlap.
17. **Quit-as-resign**: `goToMainMenu()` checks `isOnlineMode && !isGameOver()` — if true, calls `Multiplayer.resign()` (reusing existing resign socket flow) then `endGame()` with `skipReport=true`, and early-returns. The game-over popup shows ELO result; user leaves via popup's "Leave" button (`handleLeaveRoomClick`). The confirmation dialog shows resign-specific warning text (`confirmLeave.resignTitle/resignSubtitle`). Local/AI games and post-game quit are unaffected.
18. **Invite socket auth**: When a user arrives via invite link unauthenticated, `handleEarlyInviteCheck()` connects an unauthenticated socket. After login/register, `reconnectSocketForInvite()` MUST be called to disconnect the old socket and reconnect with the auth token. Without this, `accept-invitation` fails because the socket has no auth identity.

## Mobile Game UI Layout

### Toolbar Structure (`#undoRedoToolbar`)
Player info, undo/redo, and timers are all inside a fixed toolbar at the top of the game view (no floating overlays):

**Row 1** (`.toolbar-main-row`): `[Black name+ELO] [Undo] [Turn indicator] [Redo] [White name+ELO]`
**Row 2** (`.toolbar-timer-row`, visible only in timed games): `[Black timer] [spacer] [White timer]`

HTML structure:
```html
<div id="undoRedoToolbar">
  <div class="toolbar-row toolbar-main-row">
    <div id="blackPlayerInfo" class="toolbar-player toolbar-player-left">
      <span class="player-name">...</span>
      <span class="player-rating">...</span>
    </div>
    <button id="undoBtn">↩</button>
    <div id="playerIndicator">...</div>
    <button id="redoBtn">↪</button>
    <div id="whitePlayerInfo" class="toolbar-player toolbar-player-right">
      <span class="player-name">...</span>
      <span class="player-rating">...</span>
    </div>
  </div>
  <div class="toolbar-row toolbar-timer-row">
    <span id="blackTimer" class="player-timer">5:00</span>
    <div class="toolbar-timer-spacer"></div>
    <span id="whiteTimer" class="player-timer">5:00</span>
  </div>
</div>
```

### Safe-Area Insets (iPhone Gesture Bar)
- `viewport-fit=cover` is set in `<meta name="viewport">` (required for `env()` to work)
- Hamburger menu button: `bottom: calc(12px + env(safe-area-inset-bottom))` (landscape phones only)
- Chat widget: `padding-bottom: env(safe-area-inset-bottom)` in base + mobile breakpoints
- See `styles.css` landscape phone media query for all safe-area adjustments

### Responsive Breakpoints (Game View)
| Breakpoint | Canvas offset | Toolbar padding | Notes |
|---|---|---|---|
| Base (>480px) | 70px | 6px 10px 4px | Default 2-row toolbar |
| ≤480px portrait | 64px | 4px 6px 2px | Smaller fonts, 34px buttons |
| ≤375px portrait | 58px | 2px 4px 2px | Minimal padding |
| Landscape phones (≤896px, h≤500px) | 50px | 2px 4px 1px | Single dense row, 26px buttons |
| Landscape tablets (min-w 897px, h≤500px) | 65px | — | Relaxed landscape |

## Key File References

- **Hash router**: `hexaequo-v2/router.js` (client-side hash routing, `window.Router`)
- **Game rules**: `shared/game/moveValidator.js` (431 lines - ALL validation logic)
- **Socket events**: `docs/SOCKET_EVENTS.md` (complete protocol spec)
- **Single ELO migration**: `backend/scripts/migration_single_elo.sql` (merges elo_classic/rapid/blitz → elo)
- **ELO system**: `backend/services/eloService.js` (K-factor logic, rating calculations, time mode multipliers)
- **ELO tests**: `backend/tests/eloService.test.js` (validates multipliers and calculations)
- **Frontend entry**: `hexaequo-v2/index.html` (lobby, game UI, modals)
- **Multiplayer client**: `hexaequo-v2/multiplayer.js` (Socket.IO client wrapper)
- **Backend socket server**: `backend/socket/socketHandler.js` (room management, move handling, matchmaking events)
- **AI engine**: `hexaequo-v2/ai.js` (minimax, evaluation, move generation)
- **Database schema**: `backend/models/schema.js` (PostgreSQL tables incl. Phase 2+3, canonical source of truth)
- **DB sync migration**: `backend/scripts/migration_sync_db.sql` (idempotent script to bring any existing DB in sync)
- **DB reset**: `backend/scripts/resetDb.js` (drops all tables incl. Phase 2+3, recreates from schema.js)
- **Matchmaking service**: `backend/services/matchmakingService.js` (queue logic, FIFO matching)
- **Invitation service**: `backend/services/invitationService.js` (invitation flow management)
- **Matchmaking UI**: `hexaequo-v2/components/matchmaking.js` (Play/Invite buttons, queue state)
- **Chat widget**: `hexaequo-v2/components/chat.js` (in-game chat, toggle button, text + quick tabs)
- **Chat styles**: `hexaequo-v2/styles/chat.css` (chat widget layout, bubbles, responsive)
- **Chat service**: `backend/services/chatService.js` (rate limiting, message validation, quick keys)
- **Chat model**: `backend/models/chatMessageModel.js` (in-memory message store per room)
- **Profile component**: `hexaequo-v2/components/profile.js` (user info, preferences, tab navigation)
- **Game history**: `hexaequo-v2/components/gameHistory.js` (paginated match list with result badges)
- **Replay viewer**: `hexaequo-v2/components/replayViewer.js` (thin navigation controller, delegates rendering to GameGraphics)
- **Profile styles**: `hexaequo-v2/styles/profile.css` (profile, game history filters, numbered pagination, replay viewer styling)
- **Move diff utility**: `backend/services/moveDiff.js` (server-side state diffing for per-move metadata)
- **DB cleanup migration**: `backend/scripts/migration_cleanup_games.sql` (deletes all games+moves for clean deploy)

## Phase 2: Matchmaking System (IMPLEMENTED)

### Matchmaking Flow
1. **Play Button**: User clicks Play → joins matchmaking queue with time mode preference
2. **Queue Matching**: Event-driven FIFO - when player joins, server searches for oldest compatible match
3. **Match Criteria**: Same time_mode + ELO within both players' acceptable ranges
4. **Match Found**: Server creates room, emits `match-found` to both players → auto-redirects to game

### Invitation Flow
1. **Invite Button**: Only available to logged-in users
2. **Create Invite**: User clicks Invite → opens QR modal → server creates room + generates 8-char code
3. **Share**: Creator shares link (`?invite=CODE`), QR code, or uses Web Share API
4. **Back Button**: Confirmation dialog warns that cancelling expires the invitation link
5. **Early Detection**: Recipient opens link → invite code detected on page load → landing modal shown immediately
6. **Landing Modal**: Shows host info (pseudo + ELO) + time control with "Sign In" or "Join Game" (if logged in)
7. **Auth Flow**: If recipient signs in from landing modal → returns to landing modal after auth (pendingInviteAfterAuth)
8. **Accept**: Clicking join → `acceptInvitation()` joins existing room
9. **Game Starts**: Creator's QR modal auto-closes, both players transition to game

### Phase 2 Components (Implemented)
**Frontend** (`hexaequo-v2/components/`):
- `matchmaking.js` - Play/Invite button handlers, queue UI
- `qrCodeModal.js` - QR code modal with back button + confirmation dialog

**Frontend Modals** (in `index.html`):
- `qrCodeModal` - Invite creator modal with QR, copy link, share
- `inviteCancelConfirm` - Confirmation dialog when cancelling invitation
- `inviteLandingModal` - Recipient modal showing host info (pseudo + ELO) + join options

**Backend Models** (`backend/models/`):
- `userPreferencesModel.js` - User matchmaking preferences (time_mode, elo_range)
- `matchmakingQueueModel.js` - Queue CRUD with FIFO `findMatch()`, 5min expiry
- `invitationModel.js` - Invitation code generation/validation, 24h expiry

**Backend Services** (`backend/services/`):
- `matchmakingService.js` - Queue logic with memory fallback, `joinQueue()` triggers immediate match search
- `invitationService.js` - Invitation flow management, `cancelInvitation()` deletes room

**Socket Events** (in `socketHandler.js`):
- `join-matchmaking-queue`, `leave-matchmaking-queue`, `matchmaking-status`
- `create-invitation`, `get-invitation-info`, `accept-invitation`, `cancel-invitation`
- `match-found` (emitted to both players when matched)
- `opponent-joined` (emitted to host when invitee accepts)

**Routes**: `backend/routes/matchmakingRoutes.js` → `/api/matchmaking/*`

### Database Tables (Phase 2)
```sql
user_preferences (user_id, preferred_time_mode, elo_range_min, elo_range_max)
matchmaking_queue (id, user_id, socket_id, pseudo, elo, time_mode, preferences, created_at, expires_at)
invitations (id, code, creator_user_id, creator_pseudo, creator_elo, room_settings, created_at, expires_at, used)
```

### Data Flow: Matchmaking/Invitation Opponent Info
- **Queue stores pseudo**: `matchmakingQueueModel.addToQueue()` stores the player's pseudo directly in DB
- **Invitation stores creator info**: `invitationModel.createInvitation()` stores `creator_pseudo` and `creator_elo`
- **Frontend passes ELO**: Both matchmaking and invitation emit user's ELO from `GameLobby.getUser()`
- **opponentInfo returned**: Socket handlers return `{name, elo}` for proper opponent display

## Future Features Architecture (Phase 4)

### Pending Frontend Components (`hexaequo-v2/components/`)
- `userMenu.js` - Menu hamburger utilisateur (Phase 1)

### Pending Backend Components
**Controllers**:
- `chatController.js` - REST endpoints chat (optional, for reconnection history)

## Phase 3: In-Game Chat (IMPLEMENTED)

### Chat Architecture
- **Ephemeral**: Messages stored in-memory only (`chatMessageModel.js` Map), no DB persistence
- **Two tabs**: Text (free-form, 200 char limit) + Quick (8 preset localized messages)
- **Rate limiting**: 10 messages/minute per user, sliding window (`chatService.isRateLimited()`)
- **Socket event**: `chat-message` bidirectional (sender excluded via `socket.to()`)
- **Lifecycle**: Widget created on `setOnlineMode(true)`, destroyed on `returnToLobby()` / `goToMainMenu()`
- **Post-game**: Chat stays active after game ends until player leaves
- **Notification**: Unread badge on toggle button when panel closed (visual only, no sound)
- **XSS protection**: HTML entities escaped in `chatService.sendMessage()`

### Chat Components
**Frontend** (`hexaequo-v2/`):
- `components/chat.js` — IIFE widget, creates DOM dynamically, exposes `window.GameChat.initChat()` / `destroyChat()`
- `styles/chat.css` — Fixed bottom-right, z-index 1500, dark theme, responsive (full-width on mobile)
- `multiplayer.js` — `sendChatMessage(message, type, onError)` method + `onChatMessage` callback setter
- `game.js` — chat lifecycle hooks in `setOnlineMode()`, `returnToLobby()`, `goToMainMenu()`

**Backend** (`backend/`):
- `models/chatMessageModel.js` — In-memory Map, `addMessage()`, `getMessages()`, `clearRoomMessages()`, 100 msg cap
- `services/chatService.js` — `sendMessage()` with validation/rate-limit, `isRateLimited()`, `getQuickMessages()`
- `socket/socketHandler.js` — `chat-message` handler with room membership check, chatService integration, callback

### Chat Quick Message Keys
`hello`, `goodLuck`, `thanks`, `oops`, `goodMove`, `sorry`, `goodGame`, `gottaGo`
Localized in `locales/en.json` and `locales/fr.json` under `"chat"` section.

### Chat Localization Keys
`chat.title`, `chat.textTab`, `chat.quickTab`, `chat.placeholder`, `chat.send`, `chat.rateLimited` + all quick message keys

## Phase 4: Profile, Game History & Replay Viewer (IMPLEMENTED)

### Profile View (`hexaequo-v2/components/profile.js`)
- **Full-page overlay** (`#profileView`, z-index 100) replaces old modal
- User info card: avatar (initial), pseudo, ELO, member-since date
- **Online preferences**: ELO range (min/max inputs), friendly games toggle
- Preferences API: `GET/PUT /api/users/me/preferences` (backend `userController.js`)
- Two tabs: **Games History** (active default) and **Stats** (placeholder)
- Opened via `window.GameProfile.openProfile()` from user menu hamburger

### Game History (`hexaequo-v2/components/gameHistory.js`)
- Filtered + paginated list from `GET /api/users/:id/matches?page=N&limit=25&result=win,loss&timeMode=rapid&opponentName=foo&dateFrom=ISO&dateTo=ISO`
- Each row: time mode icon, opponent pseudo+ELO, result badge (win/loss/ex aequo), ELO change, date
- Click → opens `GameReplay.openReplay(gameId)`
- Rendered inside profile tab content container

**Filters** (`.gh-filter-bar`):
- **Result checkboxes**: Win / Loss / Ex Aequo (colored labels: green, red, orange)
- **Time mode dropdown**: All / bullet / blitz / rapid / classic / none
- **Opponent search**: Text input with 300ms debounce
- **Date presets**: All Time / 7 days / 30 days / 3 months (pill buttons, accent-colored active state)
- All filters reset page to 1 on change

**Numbered Pagination** (`.gh-pagination-bar`):
- Prev/Next buttons (disabled at boundaries)
- Page number buttons with ellipsis for large page counts (max 5 visible via `getVisiblePages()`)
- "Showing X-Y of Z" info text
- **Page size selector**: Dropdown with 10 / 25 / 50 options (default 25)

**Terminology**: "Ex Aequo" is used in ALL languages instead of "Draw" or "Nul"

### Replay Viewer (`hexaequo-v2/components/replayViewer.js`)
- **Reuses main GameGraphics renderer** — no standalone canvas, full visual quality (animations, highlights, themes)
- Thin navigation controller: prev/next buttons + progress slider + keyboard shortcuts (arrows, escape)
- `#replayControls` fixed bar at bottom of screen (translucent backdrop-blur)
- **`replayMode` flag** in game.js: blocks canvas interactions (`handleCanvasInteraction` returns early), `canMakeMove()` returns false
- **`enterReplayMode(data)`**: Hides lobby, hides undo/redo/hamburger, populates toolbar player info, clears game state
- **`loadReplayState(state, prev, timeData, index, total)`**: Deserializes state into game.js closure vars, queues animations via `queueAnimationsForStateChange()`, sets `lastMove` via `highlightLastMove()`, updates timer via `displayStatic()`
- **`exitReplayMode()`**: Restores UI, resets game, shows lobby
- **Silent replay**: No sounds during replay navigation
- **Timer**: Static display per move using `GameTimer.displayStatic(blackMs, whiteMs)` — shows remaining time without countdown
- **URL param**: `?replay=GAME_ID` — lobby.js detects on DOMContentLoaded and saves to `sessionStorage('hexaequo_pending_replay')`, game.js picks it up on `window.onload` and calls `GameReplay.openReplay()`
- **Profile overlay**: Replay hides profile view, restores it on close (`profileWasOpen` tracking)
- Fetches `GET /api/games/:id/replay` (public, no auth required) — uses `authenticatedFetch` with regular `fetch` fallback
- Uses `gameHistory.exAequo` locale key (not `draw`) for result display

### Replay Data Pipeline
- **Per-move recording** (PRIMARY): Socket handler records each move to `moves` table during gameplay via `gameService.recordMove()`
- **Move diff utility** (`backend/services/moveDiff.js`): Server-side `diffStates(before, after)` extracts `{moveType, from, to, captures}` by comparing pre/post game states
- **Room tracking**: `roomGameIds` Map + `roomMoveCounters` Map in `socketHandler.js` track roomCode→gameId and move numbers
- **Replay API** (`gameService.getGameReplay()`): **Moves table is primary source** — maps `state_snapshot` from each move into `{gameState, moveType, timeRemainingBlack, timeRemainingWhite}` format. Falls back to `final_state.moveHistory` for legacy games
- **Legacy fallback**: Games recorded before per-move implementation still work via `final_state` JSONB column
- **Partial replays**: Games ending by resign/timeout have replay data up to the last recorded move

### Serialized State Format (in stateHistory)
```javascript
{
  tiles: { "0,0": "black", ... },
  pieces: { "1,0": {type: "disc", color: "black"}, ... },
  inventory: { black: {tiles: N, discs: N, rings: N}, white: {...} },
  captured: { black_discs: N, black_rings: N, white_discs: N, white_rings: N },
  activePlayer: "black"|"white"
}
```

### Phase 4 Components
**Frontend** (`hexaequo-v2/`):
- `components/profile.js` — IIFE, `window.GameProfile.openProfile()` / `closeProfile()`
- `components/gameHistory.js` — IIFE, `window.GameHistory.loadGames(userId, page, container)` — filters, numbered pagination, page size selector
- `components/replayViewer.js` — IIFE, `window.GameReplay.openReplay(gameId)` / `closeReplay()`
- `styles/profile.css` — All Phase 4 styles (profile view, game history filters, numbered pagination, replay viewer styling)

**Backend** (`backend/`):
- `controllers/userController.js` — `getPreferences()`, `updatePreferences()`, `getMatchHistory()` with filter query params
- `services/moveDiff.js` — `diffStates(before, after)` for per-move metadata extraction
- `models/gameModel.js` — `getUserMatchHistory()` with dynamic WHERE clause for filters (parameterized)
- `models/memoryGameStore.js` — Same filter support for memory fallback
- `routes/userRoutes.js` — `GET/PUT /me/preferences` with auth + validation
- `middleware/validationMiddleware.js` — `updatePreferences` schema added
- `scripts/migration_cleanup_games.sql` — Deletes all existing games + moves for clean per-move deployment

### Game History Query Parameters
| Parameter | Type | Values | Default |
|---|---|---|---|
| `page` | number | 1+ | 1 |
| `limit` | number | 10, 25, 50 | 25 |
| `result` | string | Comma-separated: `win`, `loss`, `draw` | all |
| `timeMode` | string | `bullet`, `blitz`, `rapid`, `classic`, `none` | all |
| `opponentName` | string | Partial match (ILIKE) | — |
| `dateFrom` | string | ISO date | — |
| `dateTo` | string | ISO date | — |

### Phase 4 Localization Keys
`profile.*` (title, back, memberSince, preferencesTitle, eloRangeLabel, friendlyGames, save*, tab*, statsComingSoon)
`gameHistory.*` (loading, noGames, error, vs, win, loss, exAequo, filterResult, allModes, searchOpponent, allTime, last7days, last30days, last3months, showing, perPage)
`replay.*` (loading, noData, move, wins)

## Next Steps for New Features
- **UI changes**: Edit `hexaequo-v2/index.html` + `styles.css`. Lobby controlled by `lobby.js`, in-game by `game.js`
- **New API endpoint**: Add route → `backend/routes/`, controller → `backend/controllers/`, service → `backend/services/`
- **New socket event**: Update `backend/socket/socketHandler.js` + `hexaequo-v2/multiplayer.js` + document in `docs/SOCKET_EVENTS.md`
- **Game rule change**: Modify `shared/game/moveValidator.js` or `constants.js` - affects both client and server immediately
