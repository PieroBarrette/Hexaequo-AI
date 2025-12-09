# Socket Event Catalog

Source of truth: `server/server.js` (Render-hosted multiplayer service). All events live on the default namespace today. Future lobby/spectator namespaces will extend this table.

## Client → Server Events

| Event | Payload | Ack Payload | Notes |
| --- | --- | --- | --- |
| `create-room` | `{ playerId: string }` | `{ success, roomCode, color, gameState, waiting }` | Creates a 4-letter room, assigns black to creator, seeds default board state. |
| `join-room` | `{ roomCode: string, playerId: string }` | `{ success, roomCode, color, gameState, waiting?, reconnected?, opponentConnected? }` | Uppercase room code before sending. If `reconnected` true, caller rejoined the same room/color. |
| `make-move` | `{ roomCode, playerId, gameState, previousState, jumpPath? }` | `{ success }` or `{ success:false,error }` | Server validates it is the player’s turn, persists `gameState`, and relays to opponent. `previousState` helps legacy clients animate transitions. |
| `leave-room` | `{ roomCode, playerId }` | `{ success }` | Removes the player; deletes the room if empty, notifies opponent via `opponent-left`. |
| `request-rematch` | `{ roomCode, playerId }` | `{ success }` | Marks the caller ready; opponent receives `opponent-ready-rematch`. |
| `start-rematch` | `{ roomCode, playerId }` | `{ success, gameState }` | Resets to the starting position and emits `game-reset` to both players. |
| `leave-endgame` | `{ roomCode, playerId }` | `{ success }` | Notifies opponent via `opponent-left-endgame`. |
| `room-status` | `{ roomCode }` | `{ success, status, players:[{color,connected}], gameState }` | Debug endpoint for dashboards/admin panels. |

## Server → Client Events

| Event | Payload | Description |
| --- | --- | --- |
| `opponent-joined` | `{ gameState }` | White joined an existing room; host should hydrate board and enable moves. |
| `opponent-moved` | `{ gameState, previousState, jumpPath }` | Apply snapshot, animate jumpPath when present. |
| `opponent-disconnected` | _none_ | Peer dropped; UI can show countdown/grace period. |
| `opponent-reconnected` | _none_ | Peer rejoined using stored playerId. |
| `opponent-left` | _none_ | Peer intentionally left room. |
| `opponent-ready-rematch` | `{ color }` | Display readiness badge; both players must emit `request-rematch`. |
| `opponent-left-endgame` | _none_ | Peer closed the endgame dialog. |
| `game-reset` | `{ gameState }` | Both players should reset local store + move history. |

## Data Contracts

- **`gameState` / `previousState`**: mirror `shared/game/gameState.js#serializeState`. Keys: `tiles`, `pieces`, `inventory`, `captured`, `activePlayer`, optional `lastJumpPath`.
- **`jumpPath`**: array of axial positions (`"q,r"` or `{ q, r }`). Server relays whichever format the client sent.
- **`playerId`**: arbitrary opaque string; browser client persists it in `localStorage` (`hexaequoPlayerId`).
- **Room codes**: uppercase alphanumeric `[A-Z2-9]` length 4.

## Connection Notes

- Socket.IO client options: transports `['websocket','polling']`, timeout 10s, reconnection attempts 5, delay 1s.
- Render free tier sleeps after inactivity; first connect may take ~5s.
- All payloads fit within a few kilobytes, so default 1MB message size is sufficient.

## Upcoming Extensions

- Separate namespaces for `/lobby` (room list/filter stream) and `/spectate` (delayed board broadcast) will inherit the same auth strategy once the PostgreSQL backend lands.
- Timer/grace-period events (`timer-sync`, `pending-disconnect`) will emit every second once server-authoritative clocks replace the current client-side timers.
