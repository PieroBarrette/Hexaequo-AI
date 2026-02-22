# Hexaequo WebSocket Events Documentation

## Overview

The Hexaequo multiplayer server uses Socket.IO for real-time communication. Authentication is via JWT token passed in `socket.handshake.auth.token`.

**Server URL:** 
- Production: `wss://hexaequo-server.onrender.com`
- Development: `ws://localhost:3001`

## Connection

```javascript
const socket = io(SERVER_URL, {
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    auth: {
        token: localStorage.getItem('hexaequo_session')
    }
});
```

**Authentication middleware**: All connections are accepted, but `socket.userId` and `socket.pseudo` are only set if a valid JWT is provided. Events that require authentication check `socket.userId`.

---

## Matchmaking Events

### `join-matchmaking-queue` (Client → Server)
Join the matchmaking queue. Requires authentication.

**Payload:**
```javascript
{
    timeMode: "classic",       // "none" | "classic" | "rapid" | "blitz" | "bullet"
    elo: 1000,                 // Player's current ELO
    pseudo: "PlayerName",      // Display name
    preferences: {             // Optional
        eloRangeMin: 800,
        eloRangeMax: 1200
    }
}
```

**Callback Response:**
```javascript
// Immediate match found
{
    success: true,
    matched: true,
    roomCode: "A1B2C3D4",
    color: "white",
    gameState: { ... },
    opponentInfo: { name: "Opponent", elo: 1200 },
    timeMode: "classic"
}

// Queued (no match yet)
{
    success: true,
    matched: false,
    message: "Added to queue"
}

// Error
{
    success: false,
    error: "Must be logged in"
}
```

### `leave-matchmaking-queue` (Client → Server)
Leave the matchmaking queue.

**Callback Response:**
```javascript
{ success: true }
```

### `matchmaking-status` (Client → Server)
Get current queue status.

**Callback Response:**
```javascript
{
    success: true,
    inQueue: true,
    position: 3,
    waitTime: 45
}
```

### `match-found` (Server → Client)
Emitted to both matched players when a match is found via queue.

**Payload:**
```javascript
{
    roomCode: "A1B2C3D4",
    color: "black",            // or "white"
    gameState: { ... },
    opponentInfo: {
        name: "OpponentName",
        elo: 1200
    },
    timeMode: "classic"
}
```

---

## Invitation Events

### `create-invitation` (Client → Server)
Create a game room + invitation code. Requires authentication.

**Payload:**
```javascript
{
    timeMode: "classic",
    pseudo: "PlayerName",
    elo: 1000
}
```

**Callback Response:**
```javascript
{
    success: true,
    code: "A1B2C3D4",         // 8-char invite code
    url: "https://hexaequo.com?invite=A1B2C3D4",
    roomCode: "X9Y8Z7W6"
}
```

### `get-invitation-info` (Client → Server)
Get invitation details before accepting. No auth required.

**Payload:**
```javascript
{
    code: "A1B2C3D4"
}
```

**Callback Response:**
```javascript
{
    success: true,
    creatorPseudo: "HostName",
    creatorElo: 1200,
    timeMode: "classic"
}
```

### `accept-invitation` (Client → Server)
Accept an invitation and join the game. Requires authentication.

**Payload:**
```javascript
{
    code: "A1B2C3D4",
    pseudo: "JoinerName",
    elo: 1000
}
```

**Callback Response:**
```javascript
{
    success: true,
    roomCode: "X9Y8Z7W6",
    color: "white",
    gameState: { ... },
    opponentInfo: {
        name: "HostName",
        elo: 1200
    },
    timeMode: "classic"
}
```

### `cancel-invitation` (Client → Server)
Cancel a pending invitation. Deletes the room.

**Payload:**
```javascript
{
    code: "A1B2C3D4"
}
```

**Callback Response:**
```javascript
{ success: true }
```

### `opponent-joined` (Server → Client)
Emitted to the host when an invitee accepts.

**Payload:**
```javascript
{
    opponentInfo: {
        pseudo: "JoinerName",
        elo: 1000
    },
    gameState: { ... },
    timerState: { ... }
}
```

---

## Room Events

### `create-room` (Client → Server)
Create a new game room. Requires authentication.

**Payload:**
```javascript
{
    playerId: "uuid-user-id",
    userInfo: {
        pseudo: "PlayerName",
        elo: 1000
    },
    settings: {
        timeMode: "classic"
    }
}
```

**Callback Response:**
```javascript
{
    success: true,
    roomCode: "A1B2C3D4",
    color: "black",
    gameState: { ... },
    waiting: true
}
```

### `join-room` (Client → Server)
Join an existing room or reconnect. Requires authentication.

**Payload:**
```javascript
{
    roomCode: "A1B2C3D4",
    playerId: "uuid-user-id",
    userInfo: {
        pseudo: "PlayerName",
        elo: 1000
    }
}
```

**Callback Response:**
```javascript
// New join
{
    success: true,
    roomCode: "A1B2C3D4",
    color: "white",
    gameState: { ... },
    waiting: false,
    opponentInfo: { name: "HostName", elo: 1200 },
    timerState: { ... }
}

// Reconnection
{
    success: true,
    roomCode: "A1B2C3D4",
    color: "black",
    gameState: { ... },
    reconnected: true,
    opponentConnected: true
}
```

### `leave-room` (Client → Server)
Leave the current room.

**Payload:**
```javascript
{
    roomCode: "A1B2C3D4",
    playerId: "uuid-user-id"
}
```

### `room-status` (Client → Server)
Get current room status.

**Payload:**
```javascript
{ roomCode: "A1B2C3D4" }
```

---

## Gameplay Events

### `make-move` (Client → Server)
Submit a game move.

**Payload:**
```javascript
{
    roomCode: "A1B2C3D4",
    playerId: "uuid-user-id",
    gameState: { ... },
    previousState: { ... },
    jumpPath: [{ q: 0, r: 0 }, { q: 2, r: 0 }],  // Optional
    timerState: { ... }                               // Optional
}
```

**Callback Response:**
```javascript
{ success: true }
```

### `opponent-moved` (Server → Client)
Opponent has made a move.

**Payload:**
```javascript
{
    gameState: { ... },
    previousState: { ... },
    jumpPath: [...],
    timerState: { ... }
}
```

### `game-ended` (Client → Server)
Report game result for ELO calculation.

**Payload:**
```javascript
{
    roomCode: "A1B2C3D4",
    winnerId: "uuid-winner-id",
    loserId: "uuid-loser-id",
    isDraw: false,
    timeMode: "classic"
}
```

### `resign` (Client → Server)
Player resigns.

**Payload:**
```javascript
{
    roomCode: "A1B2C3D4",
    playerId: "uuid-user-id",
    playerColor: "black"
}
```

### `opponent-resigned` (Server → Client)
```javascript
{
    winnerColor: "white",
    resignedColor: "black"
}
```

### `propose-draw` / `accept-draw` / `decline-draw` (Client → Server)
Draw negotiation events.

### `draw-proposed` / `draw-accepted` / `draw-declined` (Server → Client)
Draw negotiation responses to opponent.

### `request-rematch` / `start-rematch` (Client → Server)
Rematch flow events.

### `opponent-ready-rematch` / `game-reset` (Server → Client)
Rematch response events.

---

## Connection Status Events

### `opponent-disconnected` (Server → Client)
Opponent lost connection. No payload.

### `opponent-reconnected` (Server → Client)
Opponent restored connection. No payload.

### `opponent-left` (Server → Client)
Opponent intentionally left. No payload.

### `opponent-left-endgame` / `leave-endgame`
Post-game cleanup events.

---

## Chat Events

### `chat-message` (Client → Server / Server → Client)
In-game chat message (max 200 chars).

**Payload:**
```javascript
{
    roomCode: "A1B2C3D4",
    message: "Good game!",
    sender: "PlayerName"
}
```

---

## Game State Structure

```javascript
{
    tiles: { "0,0": "black", "1,0": "black", ... },
    pieces: { "1,0": { type: "disc", color: "black" }, ... },
    inventory: { black: 7, white: 7 },
    discInventory: { black: 5, white: 5 },
    ringInventory: { black: 3, white: 3 },
    captured: { black: { disc: 0, ring: 0 }, white: { disc: 0, ring: 0 } },
    activePlayer: "black",
    metadata: {
        moveHistory: [...],
        multiJumping: false
    }
}
```

---

## Authentication

All connections are allowed (for page load), but the following events require `socket.userId` (valid JWT):
- `create-room`, `join-room`
- `join-matchmaking-queue`
- `create-invitation`, `accept-invitation`

Events without auth return `{ success: false, error: "Must be logged in" }`.
