# Hexaequo Server

WebSocket server for Hexaequo online multiplayer functionality.

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

The server will run on `http://localhost:3000`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `FRONTEND_URL` | `http://localhost:8080` | Allowed CORS origin |
| `DATABASE_PATH` | `./hexaequo.db` | SQLite database file path |

## API Endpoints

### REST

- `GET /health` - Health check
- `GET /room/:code` - Get room info (for debugging)

### WebSocket Events

#### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `create-room` | `{ playerId }` | Create a new room |
| `join-room` | `{ roomCode, playerId }` | Join existing room |
| `make-move` | `{ roomCode, playerId, gameState, previousState }` | Send a move |
| `leave-room` | `{ roomCode, playerId }` | Leave room intentionally |
| `room-status` | `{ roomCode }` | Get room status |

#### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `opponent-joined` | `{ gameState }` | Opponent joined the room |
| `opponent-moved` | `{ gameState, previousState }` | Opponent made a move |
| `opponent-disconnected` | - | Opponent disconnected |
| `opponent-reconnected` | - | Opponent reconnected |
| `opponent-left` | - | Opponent left the game |

## Deployment on Render (Free Tier)

1. Create a new Web Service on [Render](https://render.com)
2. Connect your GitHub repository
3. Configure:
   - **Build Command**: `cd server && npm install`
   - **Start Command**: `cd server && npm start`
   - **Environment Variables**:
     - `FRONTEND_URL` = `https://hexaequo.com`
     - `DATABASE_PATH` = `/tmp/hexaequo.db`

Note: On Render's free tier, the service spins down after 15 minutes of inactivity. First connection after spin-down takes ~30 seconds.

## Database

Uses SQLite with two tables:

- `rooms` - Game rooms with state
- `players` - Player sessions

Data is automatically cleaned up after 24 hours of inactivity.
