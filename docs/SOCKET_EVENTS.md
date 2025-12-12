# Hexaequo WebSocket Events Documentation

## Overview

The Hexaequo multiplayer server uses Socket.IO for real-time communication.

**Server URL:** 
- Production: `wss://hexaequo-server.onrender.com`
- Development: `ws://localhost:3000`

## Connection

```javascript
const socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});
```

---

## Client → Server Events

### `create-room`
Create a new game room.

**Payload:**
```javascript
{
    playerId: "player_1234567890_abc123def",  // Unique player identifier
    settings: {                                // Optional
        timeMode: "rapid",                     // "none" | "classic" | "rapid" | "blitz"
        allowSpectators: true
    },
    profile: {                                 // Optional
        pseudo: "PlayerName",
        elo: 1500
    }
}
```

**Callback Response:**
```javascript
// Success
{
    success: true,
    roomCode: "A1B2",
    color: "black",
    gameState: { ... },
    waiting: true
}

// Error
{
    success: false,
    error: "Error message"
}
```

---

### `join-room`
Join an existing game room.

**Payload:**
```javascript
{
    roomCode: "A1B2",
    playerId: "player_1234567890_abc123def",
    profile: {                                 // Optional
        pseudo: "PlayerName",
        elo: 1500
    }
}
```

**Callback Response:**
```javascript
// Success (new join)
{
    success: true,
    roomCode: "A1B2",
    color: "white",
    gameState: { ... },
    waiting: false
}

// Success (reconnection)
{
    success: true,
    roomCode: "A1B2",
    color: "black",
    gameState: { ... },
    reconnected: true,
    opponentConnected: true
}

// Error
{
    success: false,
    error: "Room not found" | "Room is full"
}
```

---

### `make-move`
Submit a game move.

**Payload:**
```javascript
{
    roomCode: "A1B2",
    playerId: "player_1234567890_abc123def",
    gameState: { ... },      // New game state after move
    previousState: { ... },   // State before move (for animations)
    jumpPath: [               // Optional: for multi-jump sequences
        { q: 0, r: 0 },
        { q: 2, r: 0 },
        { q: 4, r: 0 }
    ]
}
```

**Callback Response:**
```javascript
// Success
{ success: true }

// Error
{
    success: false,
    error: "Not your turn" | "Invalid move" | "Room not found"
}
```

---

### `leave-room`
Leave the current room.

**Payload:**
```javascript
{
    roomCode: "A1B2",
    playerId: "player_1234567890_abc123def"
}
```

**Callback Response:**
```javascript
{ success: true }
```

---

### `request-rematch`
Request a rematch after game ends.

**Payload:**
```javascript
{
    roomCode: "A1B2",
    playerId: "player_1234567890_abc123def"
}
```

**Callback Response:**
```javascript
{ success: true }
```

---

### `start-rematch`
Start the rematch (when both players ready).

**Payload:**
```javascript
{
    roomCode: "A1B2",
    playerId: "player_1234567890_abc123def"
}
```

**Callback Response:**
```javascript
{
    success: true,
    gameState: { ... }  // Fresh initial state
}
```

---

### `leave-endgame`
Close the endgame screen.

**Payload:**
```javascript
{
    roomCode: "A1B2",
    playerId: "player_1234567890_abc123def"
}
```

**Callback Response:**
```javascript
{ success: true }
```

---

### `room-status`
Get current room status (debug/admin).

**Payload:**
```javascript
{
    roomCode: "A1B2"
}
```

**Callback Response:**
```javascript
{
    success: true,
    status: "playing",
    players: {
        black: { connected: true, playerId: "..." },
        white: { connected: true, playerId: "..." }
    },
    gameState: { ... }
}
```

---

## Server → Client Events

### `opponent-joined`
Opponent has joined the room.

**Payload:**
```javascript
{
    gameState: { ... },
    opponent: {              // Optional
        pseudo: "OpponentName",
        elo: 1600
    }
}
```

---

### `opponent-moved`
Opponent has made a move.

**Payload:**
```javascript
{
    gameState: { ... },      // New game state
    previousState: { ... },   // State before move
    jumpPath: [...]           // If multi-jump
}
```

---

### `opponent-disconnected`
Opponent lost connection.

**Payload:** _(none)_

---

### `opponent-reconnected`
Opponent restored connection.

**Payload:** _(none)_

---

### `opponent-left`
Opponent intentionally left the room.

**Payload:** _(none)_

---

### `opponent-ready-rematch`
Opponent wants to play again.

**Payload:**
```javascript
{
    color: "white"  // Opponent's color
}
```

---

### `opponent-left-endgame`
Opponent closed the endgame screen.

**Payload:** _(none)_

---

### `game-reset`
Both players ready for rematch, game restarting.

**Payload:**
```javascript
{
    gameState: { ... }  // Fresh initial state with swapped colors
}
```

---

## Game State Structure

```javascript
{
    tiles: {
        "0,0": "black",
        "1,0": "black",
        "-1,1": "white",
        "0,1": "white"
    },
    pieces: {
        "1,0": { type: "disc", color: "black" },
        "-1,1": { type: "disc", color: "white" }
    },
    inventory: {
        black: { tiles: 7, discs: 5, rings: 3 },
        white: { tiles: 7, discs: 5, rings: 3 }
    },
    captured: {
        black_discs: 0,
        black_rings: 0,
        white_discs: 0,
        white_rings: 0
    },
    activePlayer: "black"
}
```

---

## Connection Status Events

### `connect`
Successfully connected to server.

### `disconnect`
Disconnected from server.

### `connect_error`
Connection attempt failed.

**Error Object:**
```javascript
{
    message: "Error description"
}
```

---

## Error Handling

Always provide callbacks to handle errors:

```javascript
socket.emit('create-room', payload, (response) => {
    if (response.success) {
        // Handle success
    } else {
        console.error('Error:', response.error);
        // Show error to user
    }
});
```

---

## Reconnection Strategy

1. Socket.IO handles automatic reconnection
2. On reconnect, client should rejoin with same playerId
3. Server preserves player state for 24 hours
4. Use `join-room` with existing playerId to restore session

```javascript
socket.on('connect', () => {
    if (currentRoomCode && currentPlayerId) {
        socket.emit('join-room', {
            roomCode: currentRoomCode,
            playerId: currentPlayerId
        }, (response) => {
            if (response.reconnected) {
                // Successfully rejoined
            }
        });
    }
});
```

---

## Best Practices

1. **Always use callbacks** - Never fire-and-forget
2. **Store playerId in localStorage** - For reconnection
3. **Handle all server events** - Especially disconnection
4. **Validate gameState locally** - Before sending moves
5. **Show connection status** - Keep users informed
6. **Implement retry logic** - For failed operations
