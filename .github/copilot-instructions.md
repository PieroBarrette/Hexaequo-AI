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
- Frontend connects to backend on **port 3001** (see `hexaequo-v2/multiplayer.js`: `const BACKEND_PORT = 3001`)
- Backend uses **PostgreSQL with memory fallback** (`backend/services/gameService.js` - `withFallback()` pattern)
- AI runs in **Web Worker** (`hexaequo-v2/ai-worker.js`) to avoid blocking UI during minimax search

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

Key events (see [docs/SOCKET_EVENTS.md](docs/SOCKET_EVENTS.md)):
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
- **Position hashing** for draw detection (3-fold repetition) via `getPositionHash(state)`
- Test levels 1-4 via lobby UI (`blackAiLevel`/`whiteAiLevel` selects)

## Project-Specific Conventions

### File Naming & Organization
- **Controllers**: `*Controller.js` (e.g., `authController.js` handles /api/auth routes)
- **Services**: Business logic layer (e.g., `eloService.js` - ELO calculations, `gameService.js` - game CRUD)
- **Models**: PostgreSQL schema in `backend/models/` + memory fallbacks in `memoryGameStore.js`
- **Routes**: `backend/routes/*.js` define Express endpoints, map to controllers
- **Socket handlers**: All WebSocket logic in `backend/socket/socketHandler.js`

### ELO Rating System (`backend/services/eloService.js`)
**K-factors vary by experience**:
- New players (<30 games): `K_NEW_PLAYER = 40` (high volatility)
- Established: `K_ESTABLISHED = 20`
- High-rated (>2400): `K_HIGH_RATED = 10` (stable)

**Default rating**: `DEFAULT_ELO = 1000` (Phase 0)
**Time mode multipliers** (affect ELO change magnitude):
- `none`: 0 (friendly/unrated - no ELO change)
- `bullet`: 0.75 (less variation for fast games)
- `blitz`: 0.9
- `rapid`: 1.0 (standard)
- `classic`: 1.2 (more points for longer games)

**Guest games**: Any game with a guest player has multiplier 0 (no ELO change)

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
**Auth flow** (see [docs/API.md](docs/API.md)):
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

## Key File References

- **Game rules**: `shared/game/moveValidator.js` (431 lines - ALL validation logic)
- **Socket events**: `docs/SOCKET_EVENTS.md` (complete protocol spec)
- **ELO system**: `backend/services/eloService.js` (K-factor logic, rating calculations, time mode multipliers)
- **ELO tests**: `backend/tests/eloService.test.js` (validates multipliers and calculations)
- **Frontend entry**: `hexaequo-v2/index.html` (lobby, game UI, modals)
- **Multiplayer client**: `hexaequo-v2/multiplayer.js` (Socket.IO client wrapper)
- **Backend socket server**: `backend/socket/socketHandler.js` (room management, move handling, matchmaking events)
- **AI engine**: `hexaequo-v2/ai.js` (minimax, evaluation, move generation)
- **Database schema**: `backend/models/schema.js` (PostgreSQL tables incl. Phase 2)
- **DB migration (Phase 0)**: `backend/scripts/migration_phase0.js` (ELO defaults + new tables)
- **Matchmaking service**: `backend/services/matchmakingService.js` (queue logic, FIFO matching)
- **Invitation service**: `backend/services/invitationService.js` (invitation flow management)
- **Matchmaking UI**: `hexaequo-v2/components/matchmaking.js` (Play/Invite buttons, queue state)

## Phase 2: Matchmaking System (IMPLEMENTED)

### Matchmaking Flow
1. **Play Button**: User clicks Play → joins matchmaking queue with time mode preference
2. **Queue Matching**: Event-driven FIFO - when player joins, server searches for oldest compatible match
3. **Match Criteria**: Same time_mode + ELO within both players' acceptable ranges
4. **Match Found**: Server creates room, emits `match-found` to both players → auto-redirects to game

### Invitation Flow
1. **Invite Button**: User clicks Invite → server generates 8-char alphanumeric code (24h expiry)
2. **Share**: User shares link (`?invite=CODE`) or QR code
3. **Accept**: Recipient opens link → `checkInviteCode()` validates → `acceptInvitation()` creates room
4. **Join**: Both players redirected to game

### Phase 2 Components (Implemented)
**Frontend** (`hexaequo-v2/components/`):
- `matchmaking.js` - Play/Invite button handlers, queue UI, waiting state
- `qrCodeModal.js` - QR code generation modal (pure JS canvas, no external lib)

**Backend Models** (`backend/models/`):
- `userPreferencesModel.js` - User matchmaking preferences (time_mode, elo_range)
- `matchmakingQueueModel.js` - Queue CRUD with FIFO `findMatch()`, 5min expiry
- `invitationModel.js` - Invitation code generation/validation, 24h expiry

**Backend Services** (`backend/services/`):
- `matchmakingService.js` - Queue logic with memory fallback, `joinQueue()` triggers immediate match search
- `invitationService.js` - Invitation flow management

**Socket Events** (in `socketHandler.js`):
- `join-matchmaking-queue`, `leave-matchmaking-queue`, `matchmaking-status`
- `create-invitation`, `get-invitation-info`, `accept-invitation`, `cancel-invitation`
- `match-found` (emitted to both players when matched)

**Routes**: `backend/routes/matchmakingRoutes.js` → `/api/matchmaking/*`

### Database Tables (Phase 2)
```sql
user_preferences (user_id, preferred_time_mode, elo_range_min, elo_range_max)
matchmaking_queue (id, user_id, elo_rating, time_mode, elo_range_min, elo_range_max, joined_at, expires_at)
invitations (id, code, creator_id, time_mode, expires_at, used, used_by, used_at)
```

## Future Features Architecture (Phase 3-4)

### Pending Frontend Components (`hexaequo-v2/components/`)
- `userMenu.js` - Menu hamburger utilisateur (Phase 1)
- `chat.js` - Chat in-game (Phase 3)
- `profile.js` - Page profil utilisateur (Phase 4)
- `gameHistory.js` - Liste historique parties (Phase 4)
- `replayViewer.js` - Lecteur de replay (Phase 4)

### Pending Backend Components
**Models**:
- `chatMessageModel.js` - Messages chat (Phase 3)

**Services**:
- `chatService.js` - Gestion chat (Phase 3)

**Controllers**:
- `chatController.js` - REST endpoints chat (Phase 3)

## Next Steps for New Features
- **UI changes**: Edit `hexaequo-v2/index.html` + `styles.css`. Lobby controlled by `lobby.js`, in-game by `game.js`
- **New API endpoint**: Add route → `backend/routes/`, controller → `backend/controllers/`, service → `backend/services/`
- **New socket event**: Update `backend/socket/socketHandler.js` + `hexaequo-v2/multiplayer.js` + document in `docs/SOCKET_EVENTS.md`
- **Game rule change**: Modify `shared/game/moveValidator.js` or `constants.js` - affects both client and server immediately
