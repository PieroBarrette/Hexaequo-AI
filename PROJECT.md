# Hexaequo AI - Project Documentation

## Table of Contents
- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Game Mechanics](#game-mechanics)
- [Frontend Architecture](#frontend-architecture)
- [Backend Architecture](#backend-architecture)
- [Multiplayer Server](#multiplayer-server)
- [AI Implementation](#ai-implementation)
- [State Management](#state-management)
- [Game Rendering](#game-rendering)
- [Features](#features)
- [Deployment](#deployment)
- [Development Setup](#development-setup)
- [API Documentation](#api-documentation)
- [Future Roadmap](#future-roadmap)

---

## Project Overview

**Hexaequo** is a modern web-based implementation of a strategic hexagonal board game. The project includes:
- A full-featured single-page application (SPA) frontend
- Real-time multiplayer capabilities via WebSocket
- AI opponent with configurable difficulty levels
- Multiple game modes (Local, Online, vs AI)
- Replay system with move history
- User authentication and profile management (planned)
- ELO rating system (planned)

The game involves strategic tile placement, piece movement, and captures on a hexagonal grid. Players compete to capture opponent pieces or achieve victory conditions through tactical play.

---

## Architecture

The project follows a **three-tier architecture**:

### 1. **Frontend (SPA)**
- Location: `/frontend`
- Modern JavaScript ES modules
- Canvas-based rendering engine
- Real-time game state management
- WebSocket client for multiplayer

### 2. **Multiplayer Server**
- Location: `/server`
- Node.js + Express + Socket.IO
- SQLite database for game persistence
- Handles real-time multiplayer sessions
- Currently deployed on Render (free tier)

### 3. **Backend API (Planned)**
- Location: `/backend`
- Future Express + PostgreSQL stack
- User authentication & authorization
- Game history & replay storage
- ELO rating calculations
- Notification services

### 4. **Shared Code**
- Location: `/shared`
- Game logic (state, validation, constants)
- Shared between frontend and backend
- Pure functions with no DOM/Node dependencies

---

## Technology Stack

### Frontend
- **Languages**: JavaScript (ES6+), HTML5, CSS3
- **Rendering**: HTML5 Canvas with custom graphics engine
- **State Management**: Custom observable stores
- **Communication**: Socket.IO client (CDN)
- **Module System**: ES Modules (type: "module")
- **Typography**: Space Grotesk (Google Fonts)

### Multiplayer Server
- **Runtime**: Node.js 20.x
- **Framework**: Express 4.x
- **WebSocket**: Socket.IO 4.7.2
- **Database**: better-sqlite3 9.x
- **CORS**: cors 2.8.5
- **Utilities**: uuid 9.x

### Backend (Planned)
- **Framework**: Express
- **Database**: PostgreSQL (planned)
- **Cache**: Redis (planned)
- **Authentication**: JWT + email verification
- **Email**: SMTP service integration

### Development
- **Version Control**: Git
- **Deployment**: Render (server), Static hosting (frontend)
- **Package Management**: npm

---

## Project Structure

```
hexaequo-ai/
├── frontend/                 # SPA Frontend
│   ├── index.html           # Main HTML shell
│   ├── package.json         # Frontend metadata
│   ├── assets/              # Static assets
│   │   ├── docs/            # Documentation assets
│   │   ├── flags/           # Country flags for profiles
│   │   ├── icons/           # UI icons
│   │   └── sounds/          # Audio feedback
│   ├── css/                 # Stylesheets
│   │   ├── base.css         # Core UI styles
│   │   ├── game.css         # Game board styles
│   │   ├── lobby.css        # Lobby UI styles
│   │   ├── profile.css      # Profile page styles
│   │   └── auth.css         # Authentication forms
│   └── js/                  # JavaScript modules
│       ├── app.js           # Application entry point
│       ├── main.js          # Development/demo entry
│       ├── api/             # HTTP API clients
│       ├── auth/            # Authentication modules
│       ├── game/            # Game logic & rendering
│       ├── lobby/           # Lobby/matchmaking UI
│       ├── profile/         # User profile UI
│       ├── replay/          # Replay viewer
│       ├── store/           # State management
│       └── utils/           # Utilities
│
├── server/                  # Multiplayer Server
│   ├── server.js            # Main WebSocket server
│   ├── package.json         # Dependencies
│   ├── README.md            # Server documentation
│   └── hexaequo.db          # SQLite database (runtime)
│
├── backend/                 # Future REST API Backend
│   ├── server.js            # Express server entry (placeholder)
│   ├── config/              # Configuration
│   │   ├── env.js           # Environment variables
│   │   └── rateLimit.js     # Rate limiting config
│   ├── controllers/         # Request handlers
│   │   ├── authController.js
│   │   ├── gameController.js
│   │   ├── userController.js
│   │   ├── roomController.js
│   │   └── replayController.js
│   ├── middleware/          # Express middleware
│   │   ├── authMiddleware.js
│   │   ├── errorHandler.js
│   │   └── validationMiddleware.js
│   ├── models/              # Database models
│   │   ├── userModel.js
│   │   ├── gameModel.js
│   │   ├── roomModel.js
│   │   ├── moveModel.js
│   │   ├── aiRatingModel.js
│   │   └── spectatorModel.js
│   ├── routes/              # API routes
│   │   ├── authRoutes.js
│   │   ├── gameRoutes.js
│   │   ├── userRoutes.js
│   │   ├── roomRoutes.js
│   │   └── aiRoutes.js
│   ├── services/            # Business logic
│   │   ├── authService.js
│   │   ├── gameService.js
│   │   ├── aiService.js     # AI integration
│   │   ├── eloService.js    # ELO calculations
│   │   ├── emailService.js
│   │   ├── replayService.js
│   │   ├── notificationService.js
│   │   └── settingsService.js
│   ├── sockets/             # Socket.IO namespaces
│   │   ├── gameSocket.js
│   │   ├── lobbySocket.js
│   │   ├── chatSocket.js
│   │   └── spectatorSocket.js
│   ├── tests/               # Test suites
│   │   ├── unit/            # Unit tests
│   │   └── integration/     # Integration tests
│   └── utils/               # Utilities
│       ├── crypto.js        # Password hashing
│       ├── logger.js        # Logging
│       └── validationSchemas.js
│
├── shared/                  # Shared game logic
│   ├── package.json         # Shared module metadata
│   └── game/                # Core game mechanics
│       ├── gameState.js     # State initialization & serialization
│       ├── constants.js     # Game constants
│       ├── history.js       # Move history
│       ├── moveValidator.js # Move validation logic
│       └── animationDiff.js # Animation calculations
│
└── docs/                    # Documentation
    ├── API.md               # REST API contracts
    ├── SOCKET_EVENTS.md     # WebSocket event catalog
    └── ELO_CALCULATION.md   # ELO rating methodology (placeholder)
```

---

## Game Mechanics

### Board Structure
- **Grid Type**: Hexagonal (axial coordinate system)
- **Starting Tiles**: 4 tiles (2 black, 2 white)
- **Starting Pieces**: 2 discs (1 per player)
- **Board Radius**: Configurable (default: 8)

### Pieces
1. **Disc**: Basic piece that can:
   - Move to adjacent empty tiles
   - Jump over other pieces (friend or foe)
   - Chain multiple jumps in one turn

2. **Ring**: Advanced piece that can:
   - Move to specific positions (ring directions)
   - Capture opponent pieces by landing on them
   - Strategic control piece

### Inventory System
Each player starts with:
- **7 tiles**: For board expansion
- **5 discs**: For piece placement
- **3 rings**: For advanced play

### Victory Conditions
A player wins by:
- Capturing **6 opponent discs**, OR
- Capturing **3 opponent rings**, OR
- Eliminating all opponent pieces

### Turn Mechanics
1. **Tile Placement**: Place a tile adjacent to 2+ existing tiles
2. **Piece Placement**: Place disc/ring on owned empty tile
3. **Piece Movement**: Move piece according to type rules
4. **Multi-Jump Chains**: Discs can chain jumps until no valid jumps remain

### Move Validation
- Players can only move their own pieces
- Tile placement requires 2+ adjacent tiles
- Ring placement requires capturing at least 1 disc 
- Disc jumps cannot revisit positions in the same chain 
- Circular jump paths without captures are invalid

---

## Frontend Architecture

### Entry Points
- **app.js**: Main production application
- **main.js**: Development/demo mode

### Core Systems

#### 1. **Canvas Graphics Engine** (`game/canvasGraphics.js`)
- Hardware-accelerated rendering
- Dynamic hex size calculation with zoom support
- Automatic layout updates on resize
- CSS custom property integration for theming
- Animation system with configurable durations
- Drag-and-drop support with visual feedback

**Features**:
- Static board rendering
- Tile placement animations
- Piece movement animations
- Jump sequence animations with captures
- Multi-capture visual effects
- Move hints and highlights
- Dragged piece rendering

#### 2. **Game Controller** (`game/gameController.js`)
- Mouse and touch input handling
- Piece selection and movement
- Move validation integration
- Multi-jump turn management
- Drag-and-drop gesture detection
- Animation state awareness

**State Management**:
- Selection tracking
- Valid moves calculation
- Jump path recording
- Turn snapshots for undo
- Pending placement queue

#### 3. **Board Renderer** (`game/boardRenderer.js`)
- Bridges game state changes to graphics API
- Animation queue builder
- Differential rendering (previous vs. current state)
- Sound effect integration
- Supports multiple graphics backends

#### 4. **Animation Controller** (`game/animationController.js`)
- Diff-based animation queue generation
- Handles multi-jump sequences
- Capture animations
- Tile/piece appearance effects
- Configurable animation speeds

#### 5. **AI Game Controller** (`game/aiGameController.js`)
- Manages AI opponent behavior
- Web Worker integration for non-blocking computation
- Difficulty level configuration (Easy/Medium/Hard)
- Automatic move triggering on AI turn
- Thinking indicator management

### Game Modes

#### Local Mode (Pass-and-Play)
- Two players on one device
- Configurable player names
- Timer options: None, Classic (15|0), Rapid (10|5), Blitz (5|3)
- Name swap and reset utilities

#### Online Mode (Multiplayer)
- Create/join rooms with 4-letter codes
- WebSocket real-time synchronization
- Reconnection support
- Opponent connection status
- Room filters (timer type, spectators)
- Lobby with public room list

#### AI Mode (vs Computer)
- Three difficulty levels:
  - **Easy**: Depth 2 (faster, weaker)
  - **Medium**: Depth 3 (balanced)
  - **Hard**: Depth 4 (stronger, slower)
- Web Worker for async computation
- Minimax with Alpha-Beta pruning
- Position evaluation heuristics

### UI Components

#### Navigation Rail
- Collapsible sidebar
- Play, Learn, Settings sections
- Flyout panels for mode selection
- Persistent state

#### HUD (Heads-Up Display)
- **Turn Indicator**: Shows active player
- **Inventory Panel**: Displays available pieces
- **Timer Panel**: Countdown timers per player
- **Multi-Jump Overlay**: Confirms/cancels jump chains
- **Action Center**: Surrender, draw offer, rematch buttons
- **Game Over Banner**: Victory/defeat notifications

#### Lobby System
- **Room List**: Filterable active games
- **Create Room Form**: Custom game settings
- **Join Room Form**: Enter room code
- **Spectator List**: View ongoing games
- **Room Filters**: Time mode, spectators allowed

#### Profile (Planned)
- User stats (games played, win rate)
- ELO ratings per time control
- Match history with replay access
- Settings management

### Visual Features
- **Themes**: Light/Dark mode with CSS custom properties
- **Animations**: Smooth piece movements and captures
- **Sounds**: UI feedback and gameplay effects
- **Valid Move Hints**: Highlight legal moves
- **Previous Move Highlight**: Show last move position
- **Drag Preview**: Visual feedback during drag

---

## Backend Architecture

### Planned Structure

#### Authentication System
- **Signup**: Email/pseudo registration with verification
- **Login**: JWT-based authentication
- **Password Recovery**: Email-based reset flow
- **Session Management**: Refresh token rotation
- **Email Verification**: SMTP integration

#### User Management
- Profile CRUD operations
- Settings persistence
- Friend lists (future)
- Block lists (future)

#### Game Management
- Active game tracking
- Game history storage
- Replay generation and retrieval
- Spectator session management

#### Rating System
- ELO calculation per time control pool
- K-factor adjustments for new players
- Separate pools for different game modes
- Rating history tracking

#### Services

**AI Service** (`services/aiService.js`):
- Bridge to AI engine
- Move request handling
- MCTS implementation (planned)
- Self-play tournaments for rating estimation

**ELO Service** (`services/eloService.js`):
- Rating calculations
- Pool management
- K-factor logic
- History tracking

**Email Service** (`services/emailService.js`):
- Verification emails
- Password reset emails
- Notification emails

**Replay Service** (`services/replayService.js`):
- Save/load game replays
- Move notation
- Analysis data

**Notification Service** (`services/notificationService.js`):
- In-app notifications
- Email notifications
- Push notifications (future)

### Middleware

**Auth Middleware** (`middleware/authMiddleware.js`):
- JWT validation
- Session verification
- Permission checks

**Validation Middleware** (`middleware/validationMiddleware.js`):
- Request schema validation
- Sanitization
- Error formatting

**Error Handler** (`middleware/errorHandler.js`):
- Centralized error handling
- Consistent error responses
- Logging integration

### Database Models

**User Model**:
- Credentials (email, hashed password)
- Profile (pseudo, icon, country)
- Settings (theme, sounds, animations)
- Created/updated timestamps

**Game Model**:
- Players (black/white with ELO)
- Time control settings
- Game state snapshots
- Result (winner, reason)
- Replay data reference

**Room Model**:
- Room code
- Host settings (spectators, time mode)
- Player slots
- Status (waiting/playing/finished)
- Created timestamp

**Move Model**:
- Game reference
- Move number
- Player color
- Move notation
- State snapshot
- Timestamp

**AI Rating Model**:
- AI version/config
- Rating per difficulty
- Games played
- Last updated

**Spectator Model**:
- User reference
- Game reference
- Join timestamp

---

## Multiplayer Server

### Current Implementation

**Technology**: Node.js + Express + Socket.IO + SQLite

**Location**: `/server/server.js`

**Deployment**: Render (free tier)
- Auto-sleeps after 15 min inactivity
- ~30s cold start on reconnection

### Database Schema

#### `rooms` Table
```sql
CREATE TABLE rooms (
    room_code TEXT PRIMARY KEY,
    black_player_id TEXT,
    white_player_id TEXT,
    game_state TEXT,  -- JSON
    active_player TEXT DEFAULT 'black',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'waiting'  -- waiting | playing
);
```

#### `players` Table
```sql
CREATE TABLE players (
    player_id TEXT PRIMARY KEY,
    socket_id TEXT,
    room_code TEXT,
    color TEXT,  -- black | white
    connected BOOLEAN DEFAULT 1,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_code) REFERENCES rooms(room_code)
);
```

### WebSocket Events

#### Client → Server

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `create-room` | `{ playerId, settings?, profile? }` | `{ success, roomCode, color, gameState, waiting }` | Create new room |
| `join-room` | `{ roomCode, playerId, profile? }` | `{ success, roomCode, color, gameState, reconnected?, opponentConnected? }` | Join existing room |
| `make-move` | `{ roomCode, playerId, gameState, previousState, jumpPath? }` | `{ success }` or error | Submit move |
| `leave-room` | `{ roomCode, playerId }` | `{ success }` | Leave room intentionally |
| `request-rematch` | `{ roomCode, playerId }` | `{ success }` | Request rematch |
| `start-rematch` | `{ roomCode, playerId }` | `{ success, gameState }` | Start rematch |
| `leave-endgame` | `{ roomCode, playerId }` | `{ success }` | Close endgame screen |
| `room-status` | `{ roomCode }` | `{ success, status, players, gameState }` | Debug/admin info |

#### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `opponent-joined` | `{ gameState }` | Opponent entered room |
| `opponent-moved` | `{ gameState, previousState, jumpPath? }` | Opponent made move |
| `opponent-disconnected` | _(none)_ | Opponent lost connection |
| `opponent-reconnected` | _(none)_ | Opponent restored connection |
| `opponent-left` | _(none)_ | Opponent left room |
| `opponent-ready-rematch` | `{ color }` | Opponent wants rematch |
| `opponent-left-endgame` | _(none)_ | Opponent closed endgame |
| `game-reset` | `{ gameState }` | Both players ready for rematch |

### Features

**Room Management**:
- 4-letter alphanumeric room codes (no confusing chars)
- Automatic cleanup after 24 hours inactivity
- Reconnection support with player ID persistence
- Status tracking (waiting/playing)

**Player Tracking**:
- Unique player IDs (localStorage)
- Connection state monitoring
- Socket ID updates on reconnect
- Last seen timestamps

**Game State Sync**:
- Full state synchronization
- Previous state for animations
- Jump path recording
- Turn validation

**CORS Configuration**:
- Supports multiple origins (localhost, production)
- Configured for Socket.IO handshake
- Allows GET/POST methods

**Performance**:
- Prepared SQL statements
- Periodic cleanup jobs
- Efficient state serialization
- Ping/pong keep-alive (25s/60s timeout)

### REST Endpoints

| Method | Path | Response | Description |
|--------|------|----------|-------------|
| GET | `/health` | `{ status: 'ok', timestamp }` | Health check |
| GET | `/room/:code` | Room info or 404 | Debug endpoint |

---

## AI Implementation

### Architecture

**Location**: `/frontend/js/game/ai/`

**Components**:
1. **aiClient.js**: Client interface with Web Worker support
2. **aiEngine.js**: Minimax algorithm with Alpha-Beta pruning
3. **aiWorker.js**: Web Worker wrapper
4. **aiWorkerStandalone.js**: Standalone worker script

### Algorithm: Minimax with Alpha-Beta Pruning

**Search Depths**:
- **Easy**: 2 ply (~100ms)
- **Medium**: 3 ply (~500ms)
- **Hard**: 4 ply (~2-5s)

**Evaluation Function**:
```
Score = BlackScore - WhiteScore

BlackScore = 
  + (discs on board × 10)
  + (rings on board × 30)
  + (captured discs × 15)
  + (captured rings × 50)
  + (empty owned tiles × 2)

WhiteScore = (same calculation for white)
```

**Terminal States**:
- 6+ captured discs
- 3+ captured rings
- All pieces captured
- No valid moves (stalemate)

**Terminal Bonuses**:
- Win: ±10,000 points
- Stalemate: 0 points

### Web Worker Integration

**Benefits**:
- Non-blocking UI during AI computation
- Parallel processing
- Timeout protection (30s)
- Graceful fallback to main thread

**Message Protocol**:
```javascript
// Request
{ type: 'computeMove', gameState, difficulty }

// Response
{ type: 'moveComputed', updatedState, computeTime }

// Error
{ type: 'error', error: 'message' }
```

### AI Service (Backend - Planned)

**Purpose**: Server-side AI for:
- Stronger analysis
- MCTS implementation
- Self-play tournaments
- AI rating estimation

---

## State Management

### Game Store (`store/gameStore.js`)

**Purpose**: Canonical game state with observable pattern

**State Structure**:
```javascript
{
  tiles: { "q,r": "black"|"white" },
  pieces: { "q,r": { type: "disc"|"ring", color } },
  inventory: { black: N, white: N },
  discInventory: { black: N, white: N },
  ringInventory: { black: N, white: N },
  captured: {
    black: { disc: N, ring: N },
    white: { disc: N, ring: N }
  },
  activePlayer: "black"|"white",
  lastMove: { from, to, type }|null,
  metadata: {
    multiJumping: boolean,
    jumpHistory: [{ q, r }],
    moveHistory: [...],
    selection: { q, r }|null,
    validMoves: [...],
    lastJumpPath: [...],
    dragState: {...}
  }
}
```

**API**:
- `getGameState()`: Current state
- `getPreviousGameState()`: Previous state
- `updateGameState(fn)`: Apply update function
- `setGameState(state)`: Replace entire state
- `resetGameState()`: Return to initial state
- `applySerializedState(snapshot)`: Hydrate from server
- `serializeCurrentState()`: Export for network
- `subscribeToGameState(listener)`: Observe changes

**Features**:
- Immutable updates
- Previous state tracking
- Derived metadata calculation
- Serialization/deserialization
- Subscriber notifications
- Skip-notify option for batch updates

### App Store (`store/appStore.js`)

**Purpose**: UI state, preferences, session data

**State Structure**:
```javascript
{
  view: "game"|"play-online"|"vs-ai"|"local"|"learn"|"profile",
  connectionStatus: "disconnected"|"connected",
  roomCode: string|null,
  playerColor: "black"|"white"|null,
  lastError: string|null,
  theme: "dark"|"light",
  uiSoundsEnabled: boolean,
  gameplaySoundsEnabled: boolean,
  animationsEnabled: boolean,
  showValidMoves: boolean,
  showPreviousMove: boolean,
  navExpanded: boolean,
  activeFlyout: string,
  gameMode: "local"|"ai"|"online",
  aiDifficulty: 2|3|4,
  aiThinking: boolean,
  lobby: {
    pseudo: string,
    timeMode: "none"|"classic"|"rapid"|"blitz",
    allowSpectators: boolean
  },
  matchSettings: {
    timerMode: string,
    allowSpectators: boolean
  },
  players: {
    black: { pseudo, elo },
    white: { pseudo, elo }
  },
  learnView: "tutorial"|"rules"
}
```

**Persistence**: localStorage (`hexaequo.app.preferences`)

**API**:
- `getAppState()`: Current state
- `setAppState(patch)`: Update fields
- `resetAppState()`: Clear to defaults
- `subscribeToAppState(listener)`: Observe changes
- `updateLobbyPreferences(patch)`: Update lobby settings
- `updateMatchSettings(patch)`: Update match config
- `updatePlayerProfile(color, patch)`: Update player info

---

## Game Rendering

### Coordinate Systems

**Axial Coordinates** (Game Logic):
- `q` (column), `r` (row)
- Offset coordinate system for hex grid
- Example: `"0,0"`, `"1,-1"`

**Pixel Coordinates** (Rendering):
- Canvas x, y positions
- Calculated from axial + hex size + offset
- Device pixel ratio scaling

**Conversion** (`game/hexMath.js`):
```javascript
axialToPixel(q, r, hexSize) → { x, y }
pixelToAxial(x, y, hexSize) → { q, r }
```

### Canvas Rendering Pipeline

1. **Clear Canvas**: Full-screen clear
2. **Apply Transform**: Translate to center
3. **Draw Tiles**: Hexagon backgrounds
4. **Draw Pieces**: Discs and rings
5. **Draw Highlights**: Selection, valid moves, last move
6. **Draw Hints**: Global move hints
7. **Draw Dragged Piece**: If dragging

### Animation System

**Queue Structure**:
```javascript
{
  events: [
    { type: 'tile-placement', q, r, color },
    { type: 'piece-placement', q, r, piece },
    { type: 'move', fromQ, fromR, toQ, toR, piece },
    { type: 'jump', path: [{q,r}], piece, captures: [{q,r}] },
    { type: 'capture', q, r, piece }
  ],
  soundEffects: ['place', 'move', 'capture']
}
```

**Timing**:
- Default duration: 250ms per animation

- Sequential playback
- Callback on completion

**Graphics API Methods**:
- `renderStatic(state)`: Instant render
- `queueTilePlacementAnimation(q, r, color)`
- `queuePiecePlacementAnimation(q, r, piece)`
- `queueMoveAnimation(fromQ, fromR, toQ, toR, piece)`
- `queueJumpSequenceWithCaptures(path, piece, captures)`
- `queueCaptureAnimation(q, r, piece)`

### Theming

**CSS Custom Properties**:
```css
--board-tile-dark
--board-tile-light
--board-disc-dark
--board-disc-light
--board-ring-dark
--board-ring-light
--board-outline
--board-highlight
--board-move-dot
--board-move-jump
--board-hint-piece
--board-hint-tile
--board-hint-placement
--board-capture
```

**Palette Resolution**:
1. Read CSS custom properties
2. Fall back to defaults
3. Pass to graphics engine

### Responsive Design

**Layout Calculation**:
- Canvas auto-resizes to container
- Hex size scales to fit visible tiles
- Min/max hex size limits (28px - 72px)
- Padding for edge pieces (56px default)

**Device Support**:
- Desktop (mouse)
- Touch devices (tap, swipe)
- High-DPI displays (devicePixelRatio)

---

## Features

### Implemented

#### Core Gameplay
- ✅ Hexagonal board with axial coordinates
- ✅ Tile placement with adjacency rules
- ✅ Piece movement (discs, rings)
- ✅ Multi-jump chains with captures
- ✅ Victory condition detection
- ✅ Turn management
- ✅ Move validation
- ✅ Undo/redo (partial)

#### Game Modes
- ✅ Local pass-and-play
- ✅ Online multiplayer (WebSocket)
- ✅ AI opponent (3 difficulty levels)

#### Multiplayer
- ✅ Room creation with 4-letter codes
- ✅ Room joining and reconnection
- ✅ Real-time state synchronization
- ✅ Opponent connection status
- ✅ Rematch system
- ✅ Room filters and lobby list

#### UI/UX
- ✅ Canvas-based rendering
- ✅ Smooth animations (tile, piece, capture)
- ✅ Drag-and-drop piece movement
- ✅ Valid move highlights
- ✅ Previous move indicator
- ✅ Dark/Light themes
- ✅ Sound effects (UI + gameplay)
- ✅ HUD with timers and inventory
- ✅ Multi-jump confirmation overlay
- ✅ Game over banner
- ✅ Navigation rail with flyouts
- ✅ Settings panel

#### Technical
- ✅ State management (observable stores)
- ✅ localStorage persistence
- ✅ Web Worker for AI
- ✅ Socket.IO integration
- ✅ Animation queue system
- ✅ Responsive canvas sizing
- ✅ Touch and mouse support

### Planned

#### Authentication
- 🔲 User registration with email verification
- 🔲 Login with JWT
- 🔲 Password recovery
- 🔲 Session management
- 🔲 OAuth (Google, Discord)

#### User Profiles
- 🔲 Profile pages (pseudo, avatar, flag)
- 🔲 Match history with replays
- 🔲 ELO ratings per time control
- 🔲 Statistics (win rate, games played)
- 🔲 Friend lists
- 🔲 Block lists

#### Game Features
- 🔲 Spectator mode
- 🔲 Live game list
- 🔲 Chat in games
- 🔲 Draw offers
- 🔲 Surrender
- 🔲 Time controls (increment, delay)
- 🔲 Move notation
- 🔲 Opening book
- 🔲 Endgame tablebases

#### Replay System
- 🔲 Save/load game replays
- 🔲 Replay viewer with controls
- 🔲 Move-by-move navigation
- 🔲 Analysis mode
- 🔲 Evaluation bar (AI analysis)
- 🔲 Notation panel

#### Backend
- 🔲 PostgreSQL migration
- 🔲 Redis caching
- 🔲 REST API for CRUD operations
- 🔲 Rate limiting
- 🔲 Admin dashboard
- 🔲 Moderation tools

#### AI Improvements
- 🔲 MCTS (Monte Carlo Tree Search)
- 🔲 Neural network evaluation
- 🔲 Opening book integration
- 🔲 Endgame database
- 🔲 Analysis engine
- 🔲 Difficulty calibration via self-play

#### Social Features
- 🔲 Tournaments
- 🔲 Leaderboards
- 🔲 Achievements
- 🔲 Daily challenges
- 🔲 Puzzle mode

#### Polish
- 🔲 Tutorial missions
- 🔲 Interactive rules guide
- 🔲 Better error messages
- 🔲 Loading states
- 🔲 Accessibility (ARIA, keyboard nav)
- 🔲 Internationalization (i18n)

---

## Deployment

### Multiplayer Server (Current)

**Platform**: Render (Free Tier)

**Configuration**:
```yaml
Build Command: cd server && npm install
Start Command: cd server && npm start
Environment:
  - FRONTEND_URL=https://hexaequo.com
  - DATABASE_PATH=/tmp/hexaequo.db
```

**Limitations**:
- Auto-sleeps after 15 min inactivity
- ~30s cold start time
- Ephemeral filesystem (SQLite resets)

**URL**: `https://hexaequo-server.onrender.com` (example)

### Frontend (Static Hosting)

**Options**:
- Netlify
- Vercel
- GitHub Pages
- Cloudflare Pages

**Build**:
- No build step (vanilla JS)
- Serve `/frontend` directory
- Configure SPA fallback to `index.html`

**Environment**:
- Update `FRONTEND_URL` in Socket.IO client
- Update `serverUrl` in `socketClient.js`

### Future Backend

**Platform**: Heroku, Railway, DigitalOcean, AWS

**Requirements**:
- PostgreSQL database
- Redis instance
- SMTP service (SendGrid, Mailgun)
- Node.js 20+

---

## Development Setup

### Prerequisites
- Node.js 20.x
- npm or yarn
- Git

### Clone Repository
```bash
git clone <repository-url>
cd hexaequo-ai
```

### Frontend Development
```bash
cd frontend
# No dependencies to install (vanilla JS)

# Serve with any static server
npx http-server -p 8080
# or
python -m http.server 8080
```

Open `http://localhost:8080` in browser.

### Multiplayer Server Development
```bash
cd server
npm install
npm start
# Server runs on http://localhost:3000
```

**Environment Variables**:
```bash
PORT=3000
FRONTEND_URL=http://localhost:8080
DATABASE_PATH=./hexaequo.db
```

### Backend Development (Future)
```bash
cd backend
npm install
npm run dev
```

### Testing

**Unit Tests** (Planned):
```bash
cd backend
npm test
```

**Integration Tests** (Planned):
```bash
cd backend
npm run test:integration
```

### Debugging

**Frontend**:
- Browser DevTools
- `window.hexaequoModern` debug object
- Console logging in verbose mode

**Server**:
- `console.log` statements
- Check SQLite database: `sqlite3 hexaequo.db`

---

## API Documentation

### REST API (Planned)

**Base URL**: `https://api.hexaequo.com`

#### Authentication

**POST** `/api/auth/signup`
```json
// Request
{
  "email": "user@example.com",
  "pseudo": "HexMaster",
  "password": "securePassword123"
}

// Response
{
  "data": {
    "userId": "uuid",
    "email": "user@example.com",
    "pseudo": "HexMaster"
  },
  "meta": {
    "message": "Verification email sent"
  }
}
```

**POST** `/api/auth/login`
```json
// Request
{
  "email": "user@example.com",
  "password": "securePassword123"
}

// Response
{
  "data": {
    "accessToken": "jwt-token",
    "refreshToken": "refresh-token",
    "user": {
      "id": "uuid",
      "pseudo": "HexMaster",
      "elo": { "classic": 1500 }
    }
  }
}
```

#### Rooms

**GET** `/api/rooms?status=waiting&timeMode=rapid`
```json
// Response
{
  "data": [
    {
      "roomCode": "A1B2",
      "host": { "pseudo": "Player1", "elo": 1600 },
      "timeMode": "rapid",
      "allowSpectators": true,
      "created": "2025-12-11T10:00:00Z"
    }
  ],
  "meta": {
    "total": 5,
    "page": 1
  }
}
```

**POST** `/api/rooms`
```json
// Request
{
  "timeMode": "rapid",
  "allowSpectators": true
}

// Response
{
  "data": {
    "roomCode": "C3D4",
    "url": "wss://api.hexaequo.com/game/C3D4"
  }
}
```

#### Profile

**GET** `/api/profile/me`
```json
// Response
{
  "data": {
    "id": "uuid",
    "pseudo": "HexMaster",
    "email": "user@example.com",
    "elo": {
      "classic": 1600,
      "rapid": 1550,
      "blitz": 1500
    },
    "stats": {
      "gamesPlayed": 120,
      "wins": 65,
      "losses": 50,
      "draws": 5
    },
    "settings": {
      "theme": "dark",
      "sounds": true
    }
  }
}
```

**PATCH** `/api/profile/me`
```json
// Request
{
  "pseudo": "NewName",
  "settings": { "theme": "light" }
}
```

### Socket.IO Events

See [docs/SOCKET_EVENTS.md](docs/SOCKET_EVENTS.md) for complete event catalog.

---

## Future Roadmap

### Phase 1: Backend MVP (Q1 2026)
- [ ] PostgreSQL + Redis setup
- [ ] User authentication (signup, login, JWT)
- [ ] REST API for profiles and settings
- [ ] Email verification
- [ ] Password recovery
- [ ] Migrate room creation to backend
- [ ] Persistent game history

### Phase 2: Rating System (Q2 2026)
- [ ] ELO calculation service
- [ ] Per-time-control rating pools
- [ ] Leaderboards
- [ ] Rating history charts
- [ ] Profile pages with stats

### Phase 3: Social Features (Q2-Q3 2026)
- [ ] Friend system
- [ ] In-game chat
- [ ] Spectator mode
- [ ] Lobby chat
- [ ] Notifications

### Phase 4: Advanced AI (Q3 2026)
- [ ] MCTS implementation
- [ ] Neural network evaluation
- [ ] Opening book
- [ ] Endgame tablebases
- [ ] Analysis engine
- [ ] Stronger AI levels (5-7)

### Phase 5: Competitive Features (Q4 2026)
- [ ] Tournament system
- [ ] Tournament brackets
- [ ] Scheduled events
- [ ] Prizes/achievements
- [ ] Puzzle mode
- [ ] Daily challenges

### Phase 6: Replay & Analysis (Q4 2026)
- [ ] Replay viewer
- [ ] Move notation
- [ ] Computer analysis
- [ ] Evaluation bar
- [ ] Best move suggestions
- [ ] Opening detection

### Phase 7: Mobile App (2027)
- [ ] React Native app
- [ ] iOS release
- [ ] Android release
- [ ] Push notifications
- [ ] Offline AI play

### Phase 8: Polish & Scale (2027)
- [ ] Performance optimization
- [ ] Load balancing
- [ ] CDN for assets
- [ ] Internationalization
- [ ] Accessibility improvements
- [ ] Advanced moderation tools

---

## Contributing

_(Guidelines to be added)_

---

## License

_(License to be specified)_

---

## Credits

**Game Design**: Original Hexaequo rules
**Development**: _Project team_
**Framework**: Vanilla JavaScript, Socket.IO, Express
**Fonts**: Space Grotesk (Google Fonts)

---

## Contact

_(Contact information to be added)_

---

**Last Updated**: December 11, 2025
**Version**: Development/Pre-release
**Status**: Active Development
