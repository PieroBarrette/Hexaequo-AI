# API Contract Snapshot

While the PostgreSQL/Redis backend is still on the roadmap, the Render-hosted multiplayer service already exposes a handful of HTTP + Socket.IO contracts. This document captures the live endpoints today so frontend work can proceed without digging through `server/server.js`.

## REST Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Returns `{ status: 'ok', timestamp }`. Used by Render’s health probes and simple uptime dashboards. |
| `GET` | `/room/:code` | Case-insensitive room lookup. Response: `{ roomCode, status, activePlayer, players: [{ color, connected }] }`. 404 when the room does not exist. |

These routes live in `server/server.js` and should be preserved when porting logic into the future Express + PostgreSQL stack.

## Socket.IO Events

Socket contracts are documented in more depth inside `docs/SOCKET_EVENTS.md`. Highlights relevant to the new lobby flows:

- `create-room` accepts optional `settings` (`allowSpectators`, `timeMode`) and `profile` (`pseudo`, `elo`). The current server ignores them, but the SPA displays the creator’s intent immediately.
- `join-room` echoes the caller’s `profile` so HUD panels can show pseudo/Elo beside the timer slots.
- `opponent-ready-rematch`, `opponent-left-endgame`, and `game-reset` mirror the legacy UI so new HUD components can stay feature-complete while we rebuild.

## Planned REST Surface

Once PostgreSQL is ready, the first slice should include:

1. `POST /api/rooms` to create rated rooms with persisted timers + spectator policies.
2. `GET /api/rooms?status=waiting` for the lobby list (replacing today’s mock data in `roomApi.js`).
3. `POST /api/rooms/:code/join` for validation + eventual auth hooks.
4. `GET /api/profile/me` / `PATCH /api/profile/me` so pseudo/Elo values stop living in `localStorage`.

Each endpoint should return JSON API responses with `{ data, meta }` wrappers and error objects shaped as `{ error: { code, message } }` to keep client handling consistent.
