# Hexaequo AI - Copilot Instructions

## Project Overview
Hexaequo is a web-based strategic hexagonal board game with multiplayer support via WebSocket, AI opponents, and a planned REST API backend. The architecture separates concerns into three tiers: Frontend (SPA), Multiplayer Server (WebSocket), and a future Backend API.

## Architecture Fundamentals

### Three-Tier Structure
1. **Frontend** (`/frontend`) - Canvas-based SPA with ES modules. Entry point: `js/app.js`
2. **Multiplayer Server** (`/server`) - Node.js/Express + Socket.IO + SQLite. Real-time gameplay via WebSocket
3. **Backend** (`/backend`) - Planned REST API for auth, ratings, game history. Uses Express + PostgreSQL (planned)
4. **Shared** (`/shared`) - Pure game logic imported by frontend & backend. No DOM/Node dependencies. Exports via ES modules (`game/index.js`)

### Game State Model
- **Hex Grid**: Cube coordinates (q, r) as strings "q,r" (see `shared/game/constants.js` for `BOARD_RADIUS = 8`)
- **State Structure** (from `shared/game/gameState.js`):
  - `tiles`: Board positions mapped to colors ("black"/"white")
  - `pieces`: Pieces (discs/rings) with location & color
  - `inventory`: Unplaced tiles & discs per player
  - `captured`: Pieces captured (victory: 6 discs or 3 rings)
  - `metadata`: Multi-jump tracking, move history
- **Victory Conditions**: `DISC_CAPTURE_WIN = 6`, `RING_CAPTURE_WIN = 3`

### Data Flow
1. **Frontend → Server**: Player makes move (e.g., `play-move` socket event)
2. **Server**: Validates via `moveValidator.validateMove()` (from shared), updates state, broadcasts `game-update`
3. **Frontend**: Receives state, re-renders canvas via `BoardRenderer.render()`
4. **WebSocket Events**: See [docs/SOCKET_EVENTS.md](docs/SOCKET_EVENTS.md) for full list (create-room, join-room, play-move, etc.)

## Key Development Patterns

### Shared Game Logic
- **Never duplicate game rules** - import from `/shared/game/`:
  - `constants.js` - Board radius, piece types, victory conditions
  - `gameState.js` - State structure and initialization
  - `moveValidator.js` - Move validation (placement, movement, jumps)
  - Hexagonal grid math: `getNeighbors(q, r)`, `isWithinBoard(q, r)`
- Example: When validating a move, always use `validateMove(gameState, move)` not custom logic

### Frontend State Management
- **Two independent stores** (no dependencies between them):
  - `appStore.js` - UI state, preferences, connection status (localStorage persisted)
  - `gameStore.js` - Game state synchronized with server
- **Subscription pattern**: `subscribeToAppState(callback)` & `subscribeToGameState(callback)`
- **Mutations**: Use `updateAppState({...})`, `updateGameState({...})` to trigger subscriptions

### Server Architecture (WebSocket)
- **Room-based gameplay**: Each game = one room with 2-4 players
- **Real-time synchronization**: `socket.emit('game-update', {gameState, ...})` broadcasts to all room participants
- **Event validation**: Server must validate ALL moves via shared `moveValidator` before applying state changes
- **Database fallback**: Games service uses database (PostgreSQL planned) with memory store fallback (see `backend/services/gameService.js`)

### Canvas Rendering
- **CanvasGraphics**: Low-level drawing (hexagons, pieces, UI elements)
- **BoardRenderer**: High-level board state → visual representation
- **Animation System**: Diffs previous/current state to animate piece movement (from `shared/game/animationDiff.js`)

## Project-Specific Conventions

### File Organization
- **Controllers** end with `Controller` (e.g., `gameController.js`)
- **Services** encapsulate business logic (`gameService.js`, `eloService.js`)
- **Models** = database schema definitions
- **Routes** = Express route handlers
- **Socket handlers** = real-time event logic

### Error Handling
- **Backend**: `middleware/errorHandler.js` standardizes error responses
- **Socket errors**: Return errors via callback: `callback({ success: false, error: "msg" })`
- **Frontend**: Catch socket errors and update `appStore.lastError`

### Imports & Module System
- **Shared code**: Import as `import { fn } from '@hexaequo/shared/game/constants'` (Node.js via npm) or direct relative paths (frontend)
- **Frontend only**: `type: "module"` in package.json (ES modules throughout)
- **Backend**: Mix of `require()` (CommonJS) and `import` (see backend/server.js for pattern)

## Critical Integration Points

### Socket.IO Events (Frontend ↔ Multiplayer Server)
Key events to understand:
- **`create-room`**: Player initiates game, receives `roomCode` & starting `gameState`
- **`play-move`**: Client sends move, server validates & broadcasts `game-update`
- **`game-update`**: Server notifies all players of state changes
- See [docs/SOCKET_EVENTS.md](docs/SOCKET_EVENTS.md) for complete protocol

### Frontend → Shared Game Logic
- `GameController` validates moves locally before sending to server
- `moveValidator.validateMove(gameState, move)` returns `{ valid: boolean, reason?: string }`
- Always sync game state from server as source of truth

### Backend (Future) → Shared Logic
- All business logic (move validation, ELO calculations) uses shared modules
- `gameService.js` orchestrates game operations
- `eloService.js` handles rating updates post-game

## Debugging & Development Tips

### Testing Moves
- Validate locally in frontend via `moveValidator.validateMove()`
- Validate on server before state mutation
- Replay system uses `moveHistory` from `gameState` - always append moves before mutation

### Database Operations
- Backend scripts in `/backend/scripts/`: `initDb.js`, `resetDb.js`, `cleanupDb.js`
- Run: `npm run db:init` to initialize schema
- Server uses SQLite at `/server/hexaequo.db` for multiplayer game persistence

### Common Pitfalls
1. **Modifying shared logic without both client & server updates** - shared code must stay in `/shared/game/`
2. **Direct state mutations** - use store methods (`updateGameState()`) to trigger re-renders
3. **Assuming server state** - frontend must validate server responses before trusting them
4. **Forgetting move history** - always append to `moveHistory` when move is applied

## Dependencies & External Services
- **Frontend**: Socket.IO client (CDN), Google Fonts (Space Grotesk)
- **Server**: Socket.IO 4.7.2, better-sqlite3 9.x, Express 4.x
- **Backend**: Express, PostgreSQL (planned), Redis (planned), JWT for auth, Nodemailer for emails
- **Multiplayer deployment**: Render (free tier) - WebSocket + SQLite file storage

## File References for Common Tasks
- **Add game move type**: Update `shared/game/constants.js` (PIECE_TYPES), `moveValidator.js` (validation logic)
- **Modify game state structure**: Update `shared/game/gameState.js` (INITIAL_GAME_STATE)
- **Add socket event**: Update [docs/SOCKET_EVENTS.md](docs/SOCKET_EVENTS.md), implement in `server/server.js` and frontend `socketClient.js`
- **Update UI**: Modify `appStore.js` (state) + CSS in `frontend/css/` + HTML in `frontend/index.html`
- **Backend API endpoint**: Add route in `backend/routes/`, controller in `backend/controllers/`, service logic in `backend/services/`
