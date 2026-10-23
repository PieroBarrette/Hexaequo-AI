# Hexaequo Socket.IO Events

The real-time protocol between the web app (`web/`) and the game server (`backend/socket/`). Every event name starts with `hx:`. The old relay events (`join-matchmaking-queue`, `create-room`, `make-move` and the rest) were removed in commit 3685361 and no longer exist.

1. [Overview](#1-overview)
2. [Quick reference](#2-quick-reference)
3. [Connection and identity](#3-connection-and-identity)
4. [Online games](#4-online-games)
5. [Matchmaking queue](#5-matchmaking-queue)
6. [Lobby, presence and challenges](#6-lobby-presence-and-challenges)
7. [Notifications and visibility](#7-notifications-and-visibility)
8. [Error codes](#8-error-codes)
9. [Known issues](#9-known-issues)
10. [Keeping this file current](#10-keeping-this-file-current)

---

## 1. Overview

### Where the server is

- **Production:** one origin, `https://hexaequo.com` (a Render web service), serves the site, the REST API and the socket. Socket.IO uses its default path, `/socket.io/`. The site's Content-Security-Policy only allows connections to its own origin.
- **Development:** the backend listens on `http://localhost:3001` and serves `web/` as well, so `http://localhost:3001` is a single origin too. When the app is served on its own (`serve.py` on port 8001, or `python -m http.server 8765`), `serverOrigin()` in `web/src/net.js` points the socket at port 3001 on the same host. Adding `?api=http://host:port` to the page address overrides the origin.
- **Server options** (`backend/socket/io.js`): Socket.IO 4.8, transports `polling` and `websocket` with upgrades, `pingInterval` 25 s, `pingTimeout` 120 s, `serveClient: true`. Allowed CORS origins: `FRONTEND_URL`, `hexaequo.com` and `www.hexaequo.com` (http and https), `hexaequo-server.onrender.com`, and `localhost` / `127.0.0.1` on ports 8001, 8080, 3000 and 3001 (not 8765, which `net.js` treats as a development port). There is no connection middleware: no handshake authentication and no socket-wide rate limiter.
- **Modules.** `backend/server.js` attaches four modules to the same `io`, in this order: `onlineGame.js` (identity, rooms, games, spectators, presence), `matchmaking.js` (quick-match queue), `lobby.js` (lobby, lobby chat, challenges) and `notify.js` (page visibility). Rooms, the queue, the lobby and challenges live in memory and are lost on a restart; finished games, ratings and lobby chat lines are written to PostgreSQL.

### How the client connects

`web/src/net.js` owns the one socket a page uses:

1. It loads the client library from the server itself, `<origin>/socket.io/socket.io.js`, so the client and server versions cannot drift and the app still has no build step.
2. It connects with:
   ```js
   io(serverOrigin(), {
     transports: ['websocket', 'polling'],
     reconnection: true,
     reconnectionDelay: 500,
     reconnectionDelayMax: 4000,
   });
   ```
   `connect()` returns the live socket and waits up to 8 s for the first connection.
3. Every connection starts anonymous. Nothing is sent in the handshake (the server never reads `socket.handshake.auth`); instead the client sends `hx:identify` with the session token before its first request on each connection ([section 3](#3-connection-and-identity)).
4. When the page becomes visible, the window gets focus or the network comes back, the client checks the socket: a dead one is reconnected at once, and a live one must answer `hx:ping` within 3 s or it is dropped and reconnected.
5. After a reconnection, each part of the app redoes what belonged to the old socket: identity (on the next request), its seat (`hx:join`) or spectating (`hx:watch`), the lobby (`hx:lobby:enter`), a queue slot (`hx:queue`), the presence list (`hx:presence:watch`), visibility (`hx:visible`) and pending challenges (`hx:mygame`, `hx:challenge:pending`).

### Requests and acknowledgements

- **Client to server** events carry one payload object and an acknowledgement callback. Every handler answers `{ ok: true, ... }` on success or `{ ok: false, error: 'CODE' }` on refusal ([section 8](#8-error-codes)). Without a callback a handler still does its work and answers nothing. `hx:create` and `hx:queue` also accept the callback as the only argument.
- The client sends them with `request(event, payload = {}, timeoutMs = 8000)`. It first waits for the connection to be identified (except for `hx:identify` itself), rejects with `Error('<event> timed out')` after the timeout, and turns an empty acknowledgement into `{ ok: false, error: 'EMPTY_RESPONSE' }`. Views show the locale string `online.errors.<CODE>`; the game and online pages show the `OFFLINE` message for a code that has none.
- **Server to client** events are plain emits with no acknowledgement. The client subscribes with `listen(event, handler)`, which returns an unsubscribe function; game views ignore payloads whose `code` is not the room they show.
- Room codes are case-insensitive: handlers apply `String(code).toUpperCase().trim()`.

### Who receives server events

| Audience | Addressed as | Events |
|---|---|---|
| Whole game room | `io.to(code)`: the players' sockets and every spectator | `hx:moved`, `hx:ended`, `hx:recorded`, `hx:rated`, `hx:undo:done`, `hx:watchers`, `hx:rematch:ready`, `hx:seats` (after `hx:identify`) |
| Game room except the sender | `socket.to(code)`: the other player and every spectator | `hx:opponent`, `hx:seats` (after `hx:join`), `hx:draw:offer`, `hx:draw:declined`, `hx:undo:offer`, `hx:undo:declined`, `hx:rematch:offer`, `hx:rematch:declined` |
| The two seats only | each seated socket | `hx:chat` |
| One socket | its id | `hx:queue:update`, `hx:matched` (the socket holding the queue slot); `hx:presence` (each socket following that account) |
| One account | the socket that most recently identified as that account | `hx:challenge:incoming`, `hx:challenge:sent`, `hx:challenge:agreed`, `hx:challenge:ready`, `hx:challenge:declined`, `hx:challenge:expired`, `hx:mention` |
| The lobby | the Socket.IO room `hx:lobby`: every socket that sent `hx:lobby:enter`, guests included | `hx:lobby:update`, `hx:lobby:chat` |

`hx:lobby` is the name of that Socket.IO room, not an event.

---

## 2. Quick reference

C → S is client to server (always with an acknowledgement), S → C is server to client. For C → S events the third column says whether the socket must be identified with `hx:identify` ("required" events refuse a guest); for S → C events it says who receives them.

| Event | Direction | Account / sent to | Purpose |
|---|---|---|---|
| **Connection and identity** | | | |
| `hx:ping` | C → S | not needed | Prove the connection still works |
| `hx:identify` | C → S | (this is how a socket gets one) | Attach an account to the connection, or drop it |
| **Online games** | | | |
| `hx:create` | C → S | not needed | Open a room and sit down as Black |
| `hx:join` | C → S | not needed (reserved rooms: their two accounts) | Take a free seat, or take your own seat back |
| `hx:watch` | C → S | not needed | Watch a game without a seat |
| `hx:unwatch` | C → S | not needed | Stop watching |
| `hx:sync` | C → S | not needed | Re-read a room |
| `hx:mygame` | C → S | not needed (a guest gets `code: null`) | Which unfinished game has your account on a seat |
| `hx:move` | C → S | not needed | Play a move (an intent) |
| `hx:moved` | S → C | whole room | A move was accepted |
| `hx:resign` | C → S | not needed | Resign |
| `hx:draw` | C → S | not needed | Offer a draw, or accept the one offered |
| `hx:draw:offer` | S → C | room except the offerer | A draw is offered |
| `hx:draw:decline` | C → S | not needed | Refuse or withdraw a draw offer |
| `hx:draw:declined` | S → C | room except the sender | A draw offer was refused or withdrawn |
| `hx:undo` | C → S | not needed | Ask to take back your last move, or agree to it |
| `hx:undo:offer` | S → C | room except the asker | A take-back is asked for |
| `hx:undo:decline` | C → S | not needed | Refuse a take-back |
| `hx:undo:declined` | S → C | room except the refuser | A take-back was refused |
| `hx:undo:done` | S → C | whole room | A take-back was applied |
| `hx:chat` | C → S | not needed | Say something to your opponent |
| `hx:chat` | S → C | the two seats | A line of game chat |
| `hx:leave` | C → S | not needed | Step away from a game |
| `hx:cancel` | C → S | not needed | Delete a room nobody has joined |
| `hx:rematch` | C → S | not needed | Offer a rematch, or accept the one offered |
| `hx:rematch:offer` | S → C | room except the offerer | A rematch is offered |
| `hx:rematch:decline` | C → S | not needed | Refuse a rematch |
| `hx:rematch:declined` | S → C | room except the refuser | A rematch was refused |
| `hx:rematch:ready` | S → C | whole room | The rematch room exists |
| `hx:opponent` | S → C | room except that player | A player arrived, came back or left |
| `hx:seats` | S → C | room | Who sits where, and whether the game is rated |
| `hx:watchers` | S → C | whole room | The number of spectators changed |
| `hx:ended` | S → C | whole room | The game is over |
| `hx:recorded` | S → C | whole room | The game was written to the database |
| `hx:rated` | S → C | whole room | Rating changes from a rated game |
| **Matchmaking queue** | | | |
| `hx:queue` | C → S | required | Join the quick-match queue |
| `hx:queue:leave` | C → S | not needed | Leave the queue |
| `hx:queue:status` | C → S | not needed | Read your queue slot (used by tests only) |
| `hx:queue:update` | S → C | the socket holding the slot | Queue status, every second |
| `hx:matched` | S → C | each paired socket | An opponent was found |
| **Lobby, presence and challenges** | | | |
| `hx:lobby:enter` | C → S | not needed (a guest only listens) | Enter the lobby: roster, live games, chat |
| `hx:lobby:leave` | C → S | not needed | Leave the lobby |
| `hx:lobby:update` | S → C | the lobby | The roster or the live games changed |
| `hx:lobby:chat` | C → S | required | Say something in the lobby |
| `hx:lobby:chat` | S → C | the lobby | A line of lobby chat |
| `hx:mention` | S → C | each account named | You were named in the lobby chat |
| `hx:live` | C → S | not needed | List the games anyone may watch |
| `hx:presence:watch` | C → S | not needed | Follow some accounts' presence |
| `hx:presence` | S → C | sockets following that account | An account's presence changed |
| `hx:challenge` | C → S | required | Challenge an account |
| `hx:challenge:sent` | S → C | the challenger | Your challenge is out |
| `hx:challenge:incoming` | S → C | the account challenged | You are challenged |
| `hx:challenge:accept` | C → S | required | Accept a challenge |
| `hx:challenge:agreed` | S → C | both accounts | Accepted, but the game has to wait |
| `hx:challenge:ready` | S → C | both accounts | The challenge's room is open |
| `hx:challenge:pending` | C → S | not needed (a guest gets nulls) | What is outstanding for your account |
| `hx:challenge:decline` | C → S | required | Decline, withdraw or cancel |
| `hx:challenge:declined` | S → C | both accounts | A challenge or agreement was called off |
| `hx:challenge:expired` | S → C | both accounts | A challenge or agreement lapsed |
| **Notifications and visibility** | | | |
| `hx:visible` | C → S | not needed (no effect without one) | Say whether this page is on screen |

---

## 3. Connection and identity

### `hx:ping`

*C → S, acknowledged. Account not needed.*

Payload: anything (the client sends `{}`). Ack: `{ ok: true }`.

Proves the round trip when a page comes back into view; it touches nothing.

### `hx:identify`

*C → S, acknowledged. This is how a socket gets an account.*

Payload: `{ token: string | null }`, the session's JWT access token (the one the REST API issues), or `null` to drop the account.

Ack:
- `{ ok: true, user: { pseudo, elo } }`: the socket now acts for that account.
- `{ ok: true, user: null }`: no token was sent; the socket is now anonymous.
- `{ ok: false, error: 'BAD_TOKEN' }`: the signature does not verify (forged or expired token) or the account no longer exists. The socket becomes anonymous.
- `{ ok: false, error: 'LOOKUP_FAILED' }`: the token is valid but the profile could not be read from the database. The socket keeps whatever identity it had.

Rules:
- The token is verified locally. A socket already identified as the same account is answered without a database read; otherwise the account's pseudonym, rating and games played are read once and kept on the socket.
- The account's presence entry is pointed at this socket; for a new identity its status is announced (`hx:presence`, `hx:lobby:update`).
- Seats this socket holds in unfinished rooms take the account, as long as that seat has not played a move yet; each such room gets `hx:seats`. This is how signing in before your first move makes a game rated. A seat that has moved keeps whoever played from it.
- Dropping the identity (no token, `BAD_TOKEN`, or a disconnection) also removes the account's presence entry if this socket held it.
- The web client sends it once per connection, before the first request (`settleIdentity` in `net.js`), and again whenever the session changes (sign-in, sign-out, token refresh). A refusal other than `BAD_TOKEN` is asked again before the next request.

### Accounts, presence and several tabs

- Permissions are per socket: a socket may do what its own `hx:identify` allows.
- Presence is per account: one entry, pointing at the socket that identified most recently. Events sent to "one account" go to that socket only. When that socket disconnects or drops its identity the account counts as `offline`, even if an older tab is still connected, until one of its sockets identifies again.
- Statuses: `offline` (no presence entry), `playing` (holding an occupied seat in a game that has started and not ended; a room you opened that nobody has joined does not count), and `free`.

### On disconnect

When a socket disconnects, each module cleans up after it:

1. `onlineGame.js`
   - removes it from every room it was watching (`hx:watchers` to those rooms);
   - forgets its identity; if it held the account's presence entry, the account goes `offline` (`hx:presence`, `hx:lobby:update`);
   - for every room where it held a seat: frees the seat (the account and rejoin key stay on it, so the player can come back with `hx:join`), withdraws a rematch offer in a finished game (either way round), starts the abandonment countdown if the game is under way, and sends `hx:opponent { joined: false, graceMs, msLeft }` to the room. When a countdown starts and the player is signed in, they also get a `comeBack` push notification, unless another of their connections is on screen. A draw offer is left standing (`hx:leave` withdraws it).
2. `matchmaking.js` is meant to release the queue slot this socket holds, and
3. `lobby.js` is meant to remove the account's lobby entry and expire its challenges and agreements that were shown on screen (those carried by a push notification keep their own lifetime). Neither currently runs: see [Known issues](#9-known-issues).
4. `notify.js` keeps nothing: the visibility flag goes with the socket.

The server only learns that a connection has gone when it closes, or when the heartbeat gives up: up to `pingInterval + pingTimeout` (25 s + 120 s) for a phone that went to sleep. Until then the seat still looks occupied; a player who comes back on a new connection takes it over with `hx:join`, by account or rejoin key.

---

## 4. Online games

`backend/socket/onlineGame.js`. Clients send intents; the server owns the position, the clock and the result, and every broadcast carries what the server computed.

### Shapes

**Seats and colours.** Seat `0` is Black, who moves first; seat `1` is White. `colour` in an acknowledgement is the receiver's seat; `hx:sync` answers `-1` to a socket that holds no seat, and `hx:watch` answers `null`.

**Room codes** are six characters from `ACDEFGHJKLMNPQRTUVWXY34679` (no O/0, I/1, S/5, B/8, Z/2). The web client shares a room as `/#/play?online=1&code=CODE` and watches one as `/#/play?watch=1&code=CODE`.

**Rejoin key.** A string of 1 to 64 characters sent as `key` with `hx:create` and `hx:join` (the client also sends it with `hx:watch`, where it is ignored). The web client makes one per tab with `crypto.randomUUID()` and keeps it in `sessionStorage['hexaequo.seatKey']`. A seat remembers the latest key it was taken with, and a new connection presenting that key gets the seat back. It is what a guest has instead of an account.

**Player view.** `{ pseudo, elo, userId }`, or `null` for an empty seat or a guest. Never an email address.

**Time controls.**

| `timeControl` | Clock | Reconnection grace |
|---|---|---|
| `none` | no clock | 120 s |
| `bullet` | 2 min + 1 s per move | 15 s |
| `blitz` | 5 min + 3 s | 30 s |
| `rapid` | 10 min + 5 s | 60 s |
| `classic` | 20 min + 10 s | 120 s |

`hx:create` turns a missing or unknown value into `none`. The web client defaults to `rapid`, and offers `none` only for a private room.

**Position snapshot** (`state`):

```js
{ v: 1,
  tiles: [cell, colour, cell, colour, ...],   // in placement order
  pieces: [cell, code, ...],
  turn: 0,                                    // seat to move
  capturedDisks: [0, 0],                      // enemy disks each seat holds
  capturedRings: [0, 0] }
```

A `cell` is `((q + 32) << 6) | (r + 32)` in axial coordinates, so the centre `(0, 0)` is `2080`, written `I8` in notation. A piece `code` is `owner * 2 + type`, with type `0` for a disk and `1` for a ring. `serializeState` and `deserializeState` in `web/src/game/state.js` are the reference; the server runs the same engine files (`backend/game/engine.js` imports them).

**Move intents.** A client says what it wants to do, never what it captured or what the board becomes:

```js
{ type: 'tile',  cell: 2016 }             // lay a tile
{ type: 'piece', cell: 2080, piece: 0 }   // place a disk (0) or a ring (1)
{ type: 'disk',  path: [2017, 2081] }     // move a disk: every cell it visits, start included
{ type: 'ring',  from: 2080, to: 2207 }   // move a ring
```

The server generates every legal move for the position and applies the one matching the intent; anything else is `ILLEGAL_MOVE`.

**Notation**, one string per move: `T I8` (tile), `D I8` / `R I8` (disk or ring placed), `H9–I9 ×1` (disk path, with captures), `R I8⇒K7 ×1` (ring move). A move that ends the game on the board gets `#` (a win) or `=` (a draw).

**Clock view** (`clock`), or `null` for an untimed room:

```js
{ control: 'blitz', initialMs: 300000, incrementMs: 3000,
  remaining: [302997, 300000],   // per seat, measured when the message was sent
  running: true,
  turn: 1 }
```

Clients count `remaining[turn]` down locally while `running` is true, and take the server's figures again from every message that carries a clock.

**Result.** `{ winner: 0 | 1 | null, reason }`. Wins on the board: `disks` (all six enemy disks captured), `rings` (all three enemy rings captured), `cleared` (the opponent has no piece left on the board). Draws on the board: `noMoves` (the side to move has no legal move), `idle` (100 plies in a row without a capture or a placement), `repetition` (the same position a third time, counted by the server). Other endings: `resigned`, `agreed` (draw by agreement), `timeout`, `abandoned`.

**Room view.** What `hx:create`, `hx:join`, `hx:sync` and `hx:watch` return besides `ok`:

| Field | Type | Meaning |
|---|---|---|
| `code` | string | Room code |
| `colour` | `0`, `1`, `-1` or `null` | The receiver's seat (see above) |
| `watching` | `true` | Only in the `hx:watch` answer |
| `rated` | boolean | Whether the game would count for the ratings as it stands |
| `players` | `[view or null, view or null]` | Accounts on the seats |
| `names` | `[string or null, ...]` | Display names: the pseudonym, a guest's `name`, or `null` |
| `seats` | `[boolean, boolean]` | Whether a connection sits in each seat right now |
| `settled` | `[boolean, boolean]` | Whether each seat has played a move (its account is then fixed) |
| `state` | snapshot | The position |
| `moves` | intent[] | Every move so far, in the server's canonical form |
| `notations` | string[] | Notation per move |
| `times` | `(number or null)[]` | Thinking time per move in ms, measured by the server; `null` where unknown |
| `idle` | number | Plies since the last capture or placement |
| `result` | result or `null` | |
| `timeControl` | string | |
| `clock` | clock view or `null` | |
| `graceMs` | number | Reconnection grace for this cadence |
| `awaitingReturn` | `{ seat, msLeft }` or `null` | An abandonment countdown in progress |
| `watchers` | number | Spectators |
| `chat` | message[] | The last 60 lines of game chat (left out by `hx:watch`) |
| `game` | number | Which game of the series this is (1, 2, ...) |
| `series` | `{ wins: [n, n], draws }` | Score of the series, by seat of this room |
| `rematchCode` | string or `null` | The room that replaced this one, once a rematch is agreed |
| `rematchOfferedBy` | `0`, `1` or `null` | Seat with a rematch offer on the table |

### Rules

**Rated games.** A game counts for the ratings only when it has a clock (`timeControl` other than `none`) and both seats hold signed-in accounts, different from each other (`isRatedRoom` in `backend/services/ratedGameService.js`). Anything else is a friendly: a guest on either side, an untimed game, the same account on both seats. `rated` is worked out from the seats each time it is sent, in room views, `hx:seats` and `hx:ended`. A seat takes the account of whoever sits in it until that seat plays its first move (`settled`); after that it keeps it, so nobody can sign in once they see they are winning. Finished games are written to the database rated or not (`hx:recorded`); rated ones also move both ratings (`hx:rated`).

**Seats.** `hx:create` puts its sender on Black. `hx:join` then finds a seat in this order:
1. the seat this socket already holds;
2. a seat carrying the sender's account, or whose rejoin key equals the `key` sent: that seat moves to this socket, whichever socket held it before (that one is no longer a player);
3. otherwise the sender is a newcomer. In a reserved room (made by quick match, by an accepted challenge, or as the rematch of two accounts) only the two named accounts get in, each to its own seat; anyone else gets `ROOM_FULL`. In any other room the newcomer takes the first empty seat, Black first, and the seat takes the newcomer's account (or none) and name. That empty seat may belong to a player who is away in the middle of a game: see [Known issues](#9-known-issues).

**Starting.** The game starts when both seats are occupied for the first time: the clock starts, thinking times are measured from then, and both players' presence turns `playing`. Nothing else waits for the second player: Black may play a move before White has arrived (the clock is not running yet). `hx:draw` is refused until the game has started (`NOT_STARTED`); `hx:resign` and `hx:undo` are not.

**Clocks.** The server owns the time. Each accepted move charges the mover the time since their turn began and then adds the increment; a timer ends the game for whoever is on move when their time runs out (`timeout`). A move that arrives after the mover's time is gone is still recorded, but the result is a loss on time. Clocks keep running while a player is disconnected or away. Accepting a take-back gives no time back: the remaining times stay as they are, and the side to move starts counting from the moment it was accepted.

**Leaving and abandonment.** A seated player who disconnects, or sends `hx:leave`, frees the seat but keeps the claim on it. In a game under way this starts a countdown of the cadence's grace time (table above); the opponent and spectators get `hx:opponent { joined: false, graceMs, msLeft }`, and room views carry `awaitingReturn`. Coming back with `hx:join` in time calls it off (`hx:opponent { joined: true }`). If it runs out with the seat still empty, the other seat wins (`abandoned`). A room runs one countdown at a time: if the second player leaves too, their countdown replaces the first one, and when it runs out the seat that left first is awarded the game. Nothing is counted down in a room that never filled, or once the game is over.

**Spectators.** Any socket that knows a code may watch with `hx:watch`, unless its account is on one of the seats (`ALREADY_PLAYING`, even while away from it). A spectator receives everything sent to the room (see [Who receives server events](#who-receives-server-events)) except `hx:chat`, cannot act (`NOT_A_PLAYER` on every game action) and is counted in `watchers`. Games between two signed-in players with both seats occupied are listed publicly (`hx:live`, the lobby), so their codes are public.

**Limits.** A socket may have at most 5 unfinished rooms that it created or joined and has not left (`TOO_MANY_ROOMS` on `hx:create`; finished rooms do not count). Moves: one per 150 ms per socket. Game chat: one line per 400 ms per socket, 300 characters, 60 lines kept. Rooms live in memory: a room untouched for 2 hours is deleted (checked every 10 minutes), a room called off with `hx:cancel` at once, a matchmade room nobody has sat down in after 60 s, and every room on a restart. Any request about a deleted room gets `NO_SUCH_ROOM`.

### `hx:create`

*C → S, acknowledged. Account not needed.*

Payload: `{ timeControl?: string, key?: string, name?: string }`. The web client sends `{ timeControl, key }`.

Ack: `{ ok: true, colour: 0, ...room view }`. Errors: `TOO_MANY_ROOMS`, `ENGINE_UNAVAILABLE`.

- Opens a room and seats the sender on Black. The seat carries the socket's account if it has one; a guest's display name is `name` (first 24 characters) or none.
- `rated` is `false` and the clock stands still until someone joins.

```js
{ ok: true, colour: 0, code: 'AM9DJQ', rated: false,
  players: [{ pseudo: 'Ana', elo: 1240, userId: 'uuid-ana' }, null], names: ['Ana', null],
  seats: [true, false], settled: [false, false],
  state: { v: 1, tiles: [...], pieces: [...], turn: 0, capturedDisks: [0, 0], capturedRings: [0, 0] },
  moves: [], notations: [], times: [], idle: 0, result: null,
  timeControl: 'blitz', graceMs: 30000, awaitingReturn: null,
  clock: { control: 'blitz', initialMs: 300000, incrementMs: 3000,
           remaining: [300000, 300000], running: false, turn: 0 },
  watchers: 0, chat: [], game: 1, series: { wins: [0, 0], draws: 0 },
  rematchCode: null, rematchOfferedBy: null }
```

### `hx:join`

*C → S, acknowledged. Account not needed, except for a reserved room.*

Payload: `{ code, key?, name? }`. The web client sends `{ code, key }`.

Ack: `{ ok: true, colour, ...room view }`. Errors: `NO_SUCH_ROOM`, `ROOM_FULL`.

- Finds a seat as described under [Seats](#rules). It is also the way back: after a reconnection, after `hx:leave`, or from another tab or device of the same account.
- Coming back to your own seat while signed in, before that seat has moved, puts your account on it.
- `key`, when sent, becomes the seat's rejoin key.
- Calls off a countdown on that seat, and starts the game if both seats are now occupied for the first time.
- The rest of the room gets `hx:opponent { joined: true }` and `hx:seats`.
- Also works on a finished room, which answers with its final view.

### `hx:watch`

*C → S, acknowledged. Account not needed.*

Payload: `{ code }`.

Ack: `{ ok: true, watching: true, colour: null, ...room view without chat }`. Errors: `NO_SUCH_ROOM`, `ALREADY_PLAYING`.

- The socket receives the room's broadcasts from now on without taking a seat; the room gets `hx:watchers`.
- Refused when this socket holds a seat in the room, or its account is on either seat (also while away from it). The web client then opens the game as a player instead.

### `hx:unwatch`

*C → S, acknowledged. Account not needed.*

Payload: `{ code }`. Ack: `{ ok: true }`, always.

Removes the socket from the spectators and from the room's broadcasts (unless it also holds a seat), and sends `hx:watchers`. The web client sends it when a spectator closes the board.

### `hx:sync`

*C → S, acknowledged. Account not needed.*

Payload: `{ code }`. Ack: `{ ok: true, colour, ...room view }`, where `colour` is the seat this socket holds or `-1`. Error: `NO_SUCH_ROOM`.

Changes nothing except keeping the room alive. The web client re-reads the room after a refused move and after `hx:undo:done`. The answer includes `chat`, whoever asks: see [Known issues](#9-known-issues).

### `hx:mygame`

*C → S, acknowledged. Account not needed; a guest always gets `code: null`.*

Payload: `{}`. Ack: `{ ok: true, code: string | null, waiting: boolean }`; a guest always gets `{ ok: true, code: null, waiting: false }`.

- `code` is the first unfinished room, in creation order, with the account on a seat, including while the account is away from it and a countdown runs. `waiting: true` means nobody else has ever sat down there (an invitation not yet followed).
- A room made by quick match or by a challenge does not count until the account has sat down in it. A rematch room does, since the players are carried into it.
- The web client uses it for the "rejoin your game" chip, and to bring back an unfollowed invitation on the online page.

### `hx:move`

*C → S, acknowledged. Account not needed.*

Payload: `{ code, intent }`. Only `intent` is read; a `state` or capture list in the payload is ignored.

Ack: `{ ok: true, ...the hx:moved payload }`. Errors: `NO_SUCH_ROOM`, `GAME_OVER`, `NOT_A_PLAYER`, `TOO_FAST`, `NOT_YOUR_TURN`, `ILLEGAL_MOVE`, `ENGINE_ERROR` (and the engine's guards `CORRUPT_STATE` and `UNKNOWN_PLAYER`, which should not occur).

- Only the socket holding a seat, on that seat's turn.
- One accepted move per 150 ms per socket; `TOO_FAST` is checked before legality.
- The mover's seat becomes settled, and the mover's own draw offer is withdrawn (`hx:draw:declined { withdrawn: true }` to the others).
- The clock is charged and the increment added; endings are detected (the engine's, then threefold repetition, whose move gets `=`).
- `hx:moved` goes to the whole room, the mover included; the web client applies a move from that broadcast, not from the acknowledgement. When the move ends the game, `hx:ended` follows.
- If the player now to move is signed in and not looking at the site, they get a `turn` push notification (at most one per room and player every 15 s).

### `hx:moved`

*S → C, to the whole room.*

```js
{ code: 'AM9DJQ',
  state: { v: 1, ... },                 // position after the move
  move: { type: 'tile', cell: 2145 },   // the server's canonical intent
  notation: 'T J9',
  captures: [],                         // [{ cell, code }] of the pieces removed
  by: 0,                                // seat that moved
  ply: 1,                               // number of moves in the game now
  ms: 5230,                             // thinking time measured by the server, or null
  idle: 0,                              // plies since the last capture or placement
  clock: { ... },                       // or null
  result: null }                        // a result when this move ended the game
```

### `hx:resign`

*C → S, acknowledged. Account not needed.*

Payload: `{ code }`. Ack: `{ ok: true }`. Errors: `NO_SUCH_ROOM`, `NOT_A_PLAYER`, `GAME_OVER`.

The other seat wins (`resigned`) and `hx:ended` goes to the room. Accepted before the opponent has arrived too.

### `hx:draw`

*C → S, acknowledged. Account not needed.*

Payload: `{ code }`. One event both offers and accepts:
- `{ ok: true, offered: true }`: an offer is now on the table, and the others get `hx:draw:offer`;
- `{ ok: true, offered: true, resent: true }`: your offer was already there;
- `{ ok: true, agreed: true }`: the other player's offer was on the table, so this accepts it; the game ends level (`agreed`) and `hx:ended` goes to the room.

Errors: `NO_SUCH_ROOM`, `NOT_A_PLAYER`, `GAME_OVER`, `NOT_STARTED`.

One offer at a time. An offer lapses when the player who made it moves (announced as withdrawn) or sends `hx:leave` (silently); a disconnection leaves it standing.

### `hx:draw:offer`

*S → C, to the room except the offerer.* `{ code, seat }`, where `seat` is the player offering.

### `hx:draw:decline`

*C → S, acknowledged. Account not needed.*

Payload: `{ code }`. Ack: `{ ok: true }`, also when the room or the offer is gone. Error: `NOT_A_PLAYER`.

Either player may take the offer off the table: the other one refuses it, the one who made it withdraws it. The others get `hx:draw:declined`.

### `hx:draw:declined`

*S → C, to the room except the sender.* `{ code, seat, withdrawn }`: `seat` took the offer off the table, and `withdrawn` is `true` when that was the player who made it (also sent when that player moves on).

### `hx:undo`

*C → S, acknowledged. Account not needed.*

Payload: `{ code }`. One event both asks and agrees:
- **Asking**, when nothing is on the table for the current move: only the player who made the last move may ask. Ack `{ ok: true, asked: true, ply }`, and the others get `hx:undo:offer`. Asking again gets the same answer.
- **Agreeing**, when the other player has asked about the current move: the last move is taken back by replaying the game one move shorter. Ack `{ ok: true, code, state, ply, undoUsed, idle, clock }`, and `hx:undo:done` with the same fields goes to the whole room.

Errors: `NO_SUCH_ROOM`, `NOT_A_PLAYER`, `GAME_OVER`, `NOTHING_TO_UNDO` (no move yet), `NOT_YOUR_MOVE` (asking about the opponent's move), `UNDO_REFUSED` (this move was already refused), `UNDO_TOO_LATE` (either clock has less than 10 s), `ENGINE_UNAVAILABLE`.

- No limit per game: each take-back needs the other player's agreement, and `undoUsed` counts those granted.
- A request about a move that is no longer the last one lapses at the next `hx:undo`.
- The repetition and idle counts are rebuilt from the shortened game; clocks are not wound back ([Clocks](#rules)).

### `hx:undo:offer`

*S → C, to the room except the asker.* `{ code, seat, ply }`: `seat` asked, `ply` is the number of moves played when asking (the move in question is the last of them).

### `hx:undo:decline`

*C → S, acknowledged. Account not needed.*

Payload: `{ code }`. Ack: `{ ok: true }`. Errors: `NO_SUCH_ROOM`, `NOT_A_PLAYER`.

Refuses the other player's request, and that move can never be asked about again; the others get `hx:undo:declined`. From the player who asked it does nothing: a request cannot be withdrawn.

### `hx:undo:declined`

*S → C, to the room except the refuser.* `{ code, seat, ply }`, where `seat` refused.

### `hx:undo:done`

*S → C, to the whole room.* `{ code, state, ply, undoUsed, idle, clock }`, where `ply` is the number of moves left. The web client re-reads the room with `hx:sync` to rebuild its move list.

### `hx:chat` (client to server)

*C → S, acknowledged. Account not needed.*

Payload: `{ code, text }`. Ack: `{ ok: true }`. Errors: `NO_SUCH_ROOM`, `NOT_A_PLAYER`, `EMPTY`, `TOO_FAST`.

- Only from the socket holding a seat: not from spectators, nor from a player who has stepped away. Allowed after the game has ended.
- Whitespace is collapsed and trimmed; text longer than 300 characters is cut, not refused; one line per 400 ms per socket.
- The room keeps the last 60 lines (`chat` in the room view) and carries them into a rematch.

### `hx:chat` (server to client)

*S → C, to the two seated sockets only (the sender included), never to spectators.*

```js
{ code: 'AM9DJQ', message: { seat: 0, name: 'Ana', text: 'bien joué', at: 1792782222883, game: 1 } }
```

`at` is a timestamp in milliseconds; `game` is the game of the series the line was said in.

### `hx:leave`

*C → S, acknowledged. Account not needed.*

Payload: `{ code }`. Ack: `{ ok: true }`, always.

- Steps away from a game without closing the page. The web client sends it when a player closes the board (a spectator sends `hx:unwatch`).
- If this socket holds a seat: the seat is freed (the claim stays), the leaver's draw offer is dropped, a rematch offer in a finished game is dropped, the countdown starts if the game is under way, the others get `hx:opponent { joined: false, graceMs, msLeft }`, and the socket stops receiving the room's broadcasts.
- `hx:join` brings the player back.

### `hx:cancel`

*C → S, acknowledged. Account not needed.*

Payload: `{ code }`. Ack: `{ ok: true }`, also for an unknown code. Errors: `NOT_A_PLAYER`, `ALREADY_STARTED`.

- Deletes a room that has never had both seats occupied, so the shared link stops working (`NO_SUCH_ROOM`).
- Allowed to the socket holding a seat, or to an account named on a seat, so the player who opened the room can still call it off after walking away (a guest who walked away cannot).
- Nobody is sent anything.

### `hx:rematch`

*C → S, acknowledged. Account not needed.*

Payload: `{ code }`. One event both offers and accepts:
- the first press: `{ ok: true, ready: false, offered: true }`, and the others get `hx:rematch:offer`; pressing again gets the same answer;
- the other player's press: `{ ok: true, code: next, ready: true }`, and `hx:rematch:ready` goes to the whole old room. Once agreed, every later `hx:rematch` on the old room answers with the same room, and presses that arrive together share one room.

Errors: `NO_SUCH_ROOM`, `NOT_A_PLAYER`, `GAME_IN_PROGRESS`, `ENGINE_UNAVAILABLE`.

The new room:
- has the same cadence, the colours swapped and `game` one higher;
- carries the series score and the last 60 chat lines, turned to the new seats (each line keeps the number of the game it was said in);
- is reserved for the two accounts when both players are signed in, and an ordinary room otherwise;
- has both players seated already: the sockets seated in the old room are seated in the new one and receive its broadcasts, and accounts, names and rejoin keys are carried, so a player who has gone takes the seat back with `hx:join`;
- starts its game, and its clock, when `hx:join` finds both seats occupied; the web client joins as soon as it hears of the new room.

The old room's view shows `rematchCode` once agreed and `rematchOfferedBy` while an offer stands. An offer is withdrawn when either player leaves or disconnects from the finished game; the other player learns it from `hx:opponent { joined: false }`.

### `hx:rematch:offer`

*S → C, to the room except the offerer.* `{ code, seat }`.

### `hx:rematch:decline`

*C → S, acknowledged. Account not needed.*

Payload: `{ code }`. Ack: `{ ok: true }`. Errors: `NO_SUCH_ROOM`, `NOT_A_PLAYER`.

Refuses the other player's offer and sends `hx:rematch:declined`; does nothing when there is no such offer.

### `hx:rematch:declined`

*S → C, to the room except the refuser.* `{ code, seat }`, where `seat` refused.

### `hx:rematch:ready`

*S → C, to the whole old room, spectators included.* `{ code, next }`: `code` is the finished room, `next` the new one. The web client opens `next` and joins it.

### `hx:opponent`

*S → C, to the room except the player concerned.* Sent on `hx:join`, on `hx:leave`, and when a seated socket disconnects.

```js
{ code: 'AM9DJQ', seat: 1, name: 'Ben', joined: true,  clock: { ... } }                    // arrived or came back
{ code: 'AM9DJQ', seat: 0, name: 'Ana', joined: false, clock: { ... },
  graceMs: 30000, msLeft: 30000 }                                                          // left
```

`graceMs` and `msLeft` are `null` when no countdown runs (the game had not started, or is over). The clock comes with it because the arrival that fills the room is what starts it.

### `hx:seats`

*S → C, to the room.* `{ code, players: [view or null, view or null], rated, settled: [boolean, boolean] }`.

Sent to the rest of the room on every `hx:join`, and to the whole room when a seated socket's `hx:identify` puts an account on a seat. It tells the player already seated who sits opposite and whether the game now counts.

### `hx:watchers`

*S → C, to the whole room.* `{ code, n }`, the number of spectators, after `hx:watch`, `hx:unwatch` or a spectator's disconnection.

### `hx:ended`

*S → C, to the whole room, once per game.*

```js
{ code: 'AM9DJQ', result: { winner: 1, reason: 'resigned' }, clock: { ... },
  rated: true, series: { wins: [0, 1], draws: 0 } }
```

The series only counts games in which both seats were occupied at some point. Both players' presence turns `free`, and a challenge agreement waiting on either of them may now open its room.

### `hx:recorded`

*S → C, to the whole room.* `{ code }`: the finished game has been written to the `games` table, rated or not. The web client then refreshes the player's streak. Not sent when the server has no database, or the write failed.

### `hx:rated`

*S → C, to the whole room, for rated games only, after `hx:recorded`.*

```js
{ code: 'AM9DJQ', gameId: '...',
  ratings: [ { userId, pseudo, before: 1500, after: 1480, change: -20 },    // Black
             { userId, pseudo, before: 1500, after: 1520, change: 20 } ] } // White
```

Ratings are worked out from the values on record (read under a lock), not from the copies taken when the players sat down, and never fall below 100. The server also updates the rating held on both accounts' sockets, in their presence entries and on their seats in unfinished rooms, so the rematch and the lobby show the new number.

---

## 5. Matchmaking queue

`backend/socket/matchmaking.js`. Quick match pairs two signed-in players of similar rating at one cadence. Queueing needs an account because the pairing works on a rating; guests use invitation links.

### Pairing rules

- One slot per account, held by the socket that sent `hx:queue`.
- Each player's tolerance (the "band") is ±100 rating points on arrival and widens by 50 every 5 s, up to ±1200.
- Two players are paired only at the same cadence, as different accounts, and when the gap between their ratings is inside both bands.
- The queue is scanned on every `hx:queue` and every second: whoever has waited longest is paired with the closest compatible rating, and pairing repeats until nothing else fits.
- Colours are decided by coin toss. The room is created at the queued cadence and reserved for the two accounts; it is deleted after 60 s if neither of them has sat down. With a clock the game is rated, since both players are accounts.
- A slot older than 10 minutes is dropped without a message ([Known issues](#9-known-issues)).
- The cadence is not checked: the web client never queues for `none`, which would give an untimed, unrated game.

### `hx:queue`

*C → S, acknowledged. Account required.*

Payload: `{ timeControl }`, `'rapid'` when missing.

Ack: `{ ok: true, inQueue: true, timeControl, elo, band, waitingMs, queued }`. Error: `SIGN_IN_REQUIRED`.

- `elo` is the rating the socket identified with, `band` the current tolerance in points either side, `waitingMs` the time since queueing, and `queued` the number of accounts waiting at this cadence.
- Sending it again, from any tab of the account, replaces the slot and starts the wait again. The web client sends it again after a reconnection.

### `hx:queue:leave`

*C → S, acknowledged. Account not needed.*

Payload: `{}`. Ack: `{ ok: true, inQueue: false }`, always.

Removes the account's slot. The web client sends it when the search is cancelled, and when the online page is left during a search.

### `hx:queue:status`

*C → S, acknowledged. Account not needed.*

Payload: `{}`. Ack: `{ ok: true, inQueue: true, timeControl, elo, band, waitingMs, queued }`, or `{ ok: true, inQueue: false }`. Not used by the web client; the tests use it.

### `hx:queue:update`

*S → C, to the socket holding the slot, every second while queued.*

```js
{ inQueue: true, timeControl: 'rapid', elo: 1310, band: 150, waitingMs: 5012, queued: 2 }
```

When a pairing's room cannot be created, both players are already out of the queue and get `{ inQueue: false, error: 'ENGINE_UNAVAILABLE' }`.

### `hx:matched`

*S → C, to each paired player's slot socket.*

```js
{ code: 'CMJANA', colour: 0, timeControl: 'classic', opponent: { pseudo: 'Ana', elo: 1240 } }
```

Both slots are gone by then. The client opens the game and sends `hx:join`, which seats the account on its reserved seat.

---

## 6. Lobby, presence and challenges

`backend/socket/lobby.js` keeps the lobby (roster, live games, one shared chat) and challenges by name. The presence data comes from `onlineGame.js`.

### `hx:lobby:enter`

*C → S, acknowledged. Account not needed; a guest only listens.*

Payload: `{}`. Ack:

```js
{ ok: true,
  players: [ { userId: 'uuid-cy', pseudo: 'Cy', elo: 1310, since: 1792782222895, playing: false },
             { userId: 'uuid-ana', pseudo: 'Ana', elo: 1240, since: null, playing: false } ],
  games: [ /* as in hx:live */ ],
  chat: [ { userId, pseudo, text, at } ],
  you: 'uuid-cy' }            // null for a socket the server does not know as an account
```

- Every socket that enters receives the lobby broadcasts (`hx:lobby:update`, `hx:lobby:chat`) from now on, guests included. A guest gets `you: null` and is not listed.
- A signed-in socket also puts the account in the lobby (`since`), which is needed to chat.
- `players` is everybody signed in on the site, not only those in the lobby, strongest first: `since` is when they entered the lobby (`null` if they have not), `playing` whether they are at a board. Anyone listed can be challenged from the list.
- `chat` is the last 80 messages of the past 24 hours, oldest first.
- When `you` comes back `null` although the page believes it is signed in, the web client identifies again and enters once more.

### `hx:lobby:leave`

*C → S, acknowledged. Account not needed.*

Payload: `{}`. Ack: `{ ok: true }`.

Stops the lobby broadcasts and removes the account from the lobby if this socket put it there. The account stays on the roster, and challengeable, while it is signed in anywhere on the site.

### `hx:lobby:update`

*S → C, to the lobby.* `{ players, games }`, shaped as in `hx:lobby:enter`.

At most one per second. Sent after somebody enters or leaves the lobby, signs in or out, disconnects, or sits down to, steps away from or finishes a game. A move does not trigger it, so `plies` can lag behind.

### `hx:lobby:chat` (client to server)

*C → S, acknowledged. Account required.*

Payload: `{ text }`. Ack: `{ ok: true }`. Errors: `SIGN_IN_REQUIRED`, `NOT_IN_LOBBY` (the account has not entered the lobby), `EMPTY`, `TOO_FAST` (one line per 700 ms per socket).

- Whitespace is collapsed and trimmed; text is cut at 300 characters.
- Kept in memory (80 lines, 24 hours) and written to the `lobby_messages` table without waiting for the write; the table is trimmed to its last 500 rows now and then, and lines older than a day are no longer read.
- Accounts named with `@` are told (`hx:mention`, and a push notification).

### `hx:lobby:chat` (server to client)

*S → C, to the lobby, the sender included.* `{ message: { userId, pseudo, text, at } }`.

### `hx:mention`

*S → C, to each account named in a lobby message, wherever on the site its socket is.* `{ message }`, the same object as `hx:lobby:chat`.

- A name is `@` followed by the pseudonym of a signed-in account, ignoring case; pseudonyms may contain spaces, and the longest match wins (`@Jean Luc` before `@Jean`). Naming yourself calls nobody.
- Named accounts that are not looking at the site, connected or not, also get a `mention` push notification (at most one per author and person every 2 minutes, and ten per person per hour).
- The web client shows it as a card, except on the online page, where the chat is already in view.

### `hx:live`

*C → S, acknowledged. Account not needed.*

Payload: `{}`. Ack:

```js
{ ok: true,
  games: [ { code: 'AM9DJQ',
             black: { pseudo: 'Ana', elo: 1240, userId: 'uuid-ana' },
             white: { pseudo: 'Ben', elo: 1195, userId: 'uuid-ben' },
             timeControl: 'blitz', plies: 0, watchers: 1 } ] }
```

- Unfinished games with both seats occupied by signed-in players, longest game first. Games with a guest are never listed, and a game drops off the list while one of its players is away.
- Asking does not enter the lobby. The web client asks when a watched game ends, to offer the next one.

### `hx:presence:watch`

*C → S, acknowledged. Account not needed.*

Payload: `{ userIds: string[] }`. Ack: `{ ok: true, statuses: { [userId]: 'free' | 'playing' | 'offline' } }`.

Replaces this socket's list (the first 200 ids are kept). `web/src/presence.js` sends the union of what every screen needs, and sends it again after a reconnection.

### `hx:presence`

*S → C, to every socket following the account.* `{ statuses: { [userId]: status } }`, one account per message, when its status may have changed: signing in or out, a disconnection, sitting down to, stepping away from or finishing a game.

### Challenges

A challenge invites one account to a game at a chosen cadence. An account takes part in at most one challenge or agreement at a time, whether asking or being asked; an agreement is an accepted challenge whose game cannot start yet.

1. A sends `hx:challenge` for B. B's socket gets `hx:challenge:incoming` (when B is connected) and A gets `hx:challenge:sent`. If B is not looking at the site, B also gets a `challenge` push notification.
2. The challenge expires (`hx:challenge:expired` to both) after 60 s when B was looking at the site, and after 10 minutes otherwise.
3. B accepts with `hx:challenge:accept`:
   - both free: the room opens at once, and both get `hx:challenge:ready`;
   - either of them at a board: an agreement, kept up to 20 minutes and opened as soon as both are free. Both get `hx:challenge:agreed`, then `hx:challenge:ready`;
   - A has left the site but can be notified: an agreement kept 10 minutes; A gets an `accepted` push notification, and the room opens about 1.5 s after A is back, once both are free.
4. Either of them may decline, withdraw, or cancel an agreement with `hx:challenge:decline`; both get `hx:challenge:declined`.

The room is reserved for the two accounts, with colours by coin toss; a player not looking at the site gets a `ready` push notification. With a clock the game is rated. Challenges and agreements live in memory; their ids are strings from a counter (`'1'`, `'2'`, ...) that starts again with the server.

### `hx:challenge`

*C → S, acknowledged. Account required.*

Payload: `{ userId, timeControl }`; `timeControl` is `'rapid'` when missing and is not checked. The web client does not offer challenges at `none`.

Ack:
- `{ ok: true, id, busy, away }`: sent. `busy`: B is at a board, so accepting will schedule the game rather than start it. `away`: B is not on the site and is being asked through a push notification.
- `{ ok: true, id, resent: true }`: you had already asked B; nothing new is sent.

Errors: `SIGN_IN_REQUIRED`, `NOT_YOURSELF`, `NOT_HERE` (B is not on the site and cannot be notified), `ALREADY_ASKING` (you have another challenge or agreement out), `ALREADY_ASKED` (B is already asking or being asked, or you are being asked).

- "On the site" means having a presence entry. An account that is not can still be asked if it has a device subscribed to push notifications, with challenge notifications on.
- Push notifications for challenges are limited to one per pair every 5 minutes and six per hour for the person asked; past that the challenge still stands, silently.

### `hx:challenge:sent`

*S → C, to the challenger's account.* `{ id, to: { pseudo, elo }, timeControl, away }`.

### `hx:challenge:incoming`

*S → C, to the challenged account, when it is connected.* `{ id, from: { userId, pseudo, elo }, timeControl, busy }`.

### `hx:challenge:accept`

*C → S, acknowledged. Account required.*

Payload: `{ id }`. Ack:
- `{ ok: true, code, colour }`: the room is open, and both get `hx:challenge:ready`;
- `{ ok: true, deferred: true, id }`: one of you is at a board, and both get `hx:challenge:agreed`;
- `{ ok: true, deferred: true, away: true, id }`: the challenger has left the site; they are notified, and you get `hx:challenge:agreed` with `away: true`.

Errors: `SIGN_IN_REQUIRED`, `NO_SUCH_CHALLENGE` (expired, withdrawn or already answered), `NOT_YOURS` (addressed to somebody else), `NOT_HERE` (the challenger has left and cannot be notified; the challenge is dropped), `ENGINE_UNAVAILABLE` (the room could not be made; both get `hx:challenge:expired`).

### `hx:challenge:agreed`

*S → C, to both accounts, or only to the one who accepted when the challenger has left.*

```js
{ id: '2', timeControl: 'blitz', opponent: { pseudo: 'Ana', elo: 1240 },
  youAccepted: false,   // true for the player who accepted
  watchCode: '97WMPJ',  // the other player's game when you are not in one yourself, else null
  away: true }          // only when waiting for a challenger who has left
```

### `hx:challenge:ready`

*S → C, to both accounts.* `{ code, colour, timeControl, opponent: { pseudo, elo } }`. The client opens the game and sends `hx:join`.

### `hx:challenge:pending`

*C → S, acknowledged. Account not needed; a guest gets nulls.*

Payload: `{}`. Ack: `{ ok: true, incoming, outgoing, agreed }`, each `null` or:
- `incoming`: `{ id, from: { userId, pseudo, elo }, timeControl, busy }`
- `outgoing`: `{ id, to: { pseudo, elo }, timeControl, away }`
- `agreed`: `{ id, timeControl, opponent: { pseudo, elo }, youAccepted: true, away, watchCode }`

A guest gets `{ ok: true, incoming: null, agreed: null }`. The web client asks at start-up, on every change of page and after a reconnection, so a challenge survives a reload.

### `hx:challenge:decline`

*C → S, acknowledged. Account required.*

Payload: `{ id }`. Ack: `{ ok: true }`, also for an unknown id. Error: `NOT_YOURS` (not one of the two accounts, or not signed in).

Works on a challenge (the person asked declines it, the challenger withdraws it) and on an agreement (either of them cancels it). Both get `hx:challenge:declined`.

### `hx:challenge:declined`

*S → C, to both accounts.* `{ id, withdrawn, by }`: `withdrawn` is `true` when the challenger called it off, and `by` is the account that did.

### `hx:challenge:expired`

*S → C, to both accounts.* `{ id }`: a challenge or agreement ran out of time, or its room could not be created. Expiry when one of the two disconnects is intended but does not currently happen ([Known issues](#9-known-issues)).

---

## 7. Notifications and visibility

### `hx:visible`

*C → S, acknowledged. Account not needed, but it has no effect without one.*

Payload: `{ visible: boolean }`. Ack: `{ ok: true }`.

- Records, per socket, whether the page is on screen. An account is "looking" while any of its identified sockets last said `visible: true`; a socket that never said counts as not looking.
- When a signed-in socket says `true`, the account's count of unseen notifications (the number on the app icon) goes back to zero, and the visit is noted for reminders (at most every 30 minutes).
- `web/src/push.js` sends it when signed in, after every reconnection, on every `visibilitychange`, and `visible: false` on `pagehide`.

### Push notifications started by socket events

No notification is sent while the account is looking. All of them need push configured on the server (VAPID keys) and a subscribed device with that kind switched on (`backend/services/pushService.js`).

| Kind | When | To | Limit |
|---|---|---|---|
| `turn` | a move is accepted in a game that has started | the player now to move | 1 per room and player every 15 s |
| `comeBack` | a seated player's connection drops during a game (the countdown starts) | that player | 1 per room and player per minute |
| `challenge` | `hx:challenge` | the account challenged | 1 per pair every 5 min, 6 per hour per account |
| `accepted` | `hx:challenge:accept` while the challenger is off the site | the challenger | none |
| `ready` | a challenge's room opens | each of the two players | none |
| `mention` | `@name` in `hx:lobby:chat` | each account named | 1 per author and account every 2 min, 10 per hour per account |

They open `/#/play?online=1&code=CODE` (turn, comeBack, ready), `/#/online?challenge=ID` (challenge) or `/#/online` (accepted, mention). Reminders and streak notices are scheduled by the server and are not tied to socket events.

---

## 8. Error codes

| Code | Returned by | Meaning |
|---|---|---|
| `NO_SUCH_ROOM` | `hx:join`, `hx:watch`, `hx:sync`, `hx:move`, `hx:resign`, `hx:draw`, `hx:undo`, `hx:undo:decline`, `hx:rematch`, `hx:rematch:decline`, `hx:chat` | No room with that code: never existed, called off, swept or lost in a restart |
| `ROOM_FULL` | `hx:join` | Both seats occupied, or a reserved room for other accounts |
| `ALREADY_PLAYING` | `hx:watch` | This socket, or its account, has a seat in that room |
| `TOO_MANY_ROOMS` | `hx:create` | Five unfinished rooms on this connection already |
| `ENGINE_UNAVAILABLE` | `hx:create`, `hx:rematch`, `hx:undo`, `hx:challenge:accept`, and in `hx:queue:update` | The rules engine could not load, or a room or replay could not be made |
| `NOT_A_PLAYER` | `hx:move`, `hx:resign`, `hx:draw`, `hx:draw:decline`, `hx:undo`, `hx:undo:decline`, `hx:rematch`, `hx:rematch:decline`, `hx:chat`, `hx:cancel` | The socket holds no seat in that room (for `hx:cancel`: nor is its account on one) |
| `GAME_OVER` | `hx:move`, `hx:resign`, `hx:draw`, `hx:undo` | The game already has a result |
| `NOT_STARTED` | `hx:draw` | Both seats have never been occupied |
| `ALREADY_STARTED` | `hx:cancel` | The room has had both players, or is finished |
| `GAME_IN_PROGRESS` | `hx:rematch` | The game has not ended |
| `TOO_FAST` | `hx:move` (150 ms), `hx:chat` (400 ms), `hx:lobby:chat` (700 ms) | Per-socket throttle |
| `NOT_YOUR_TURN` | `hx:move` | The other seat is to move |
| `ILLEGAL_MOVE` | `hx:move` | No legal move matches the intent |
| `ENGINE_ERROR` | `hx:move` | The engine threw while applying the move |
| `CORRUPT_STATE`, `UNKNOWN_PLAYER` | `hx:move` | Engine guards that should not occur |
| `EMPTY` | `hx:chat`, `hx:lobby:chat` | Nothing left after trimming |
| `NOTHING_TO_UNDO` | `hx:undo` | No move has been played |
| `NOT_YOUR_MOVE` | `hx:undo` | Only the player who made the last move may ask |
| `UNDO_REFUSED` | `hx:undo` | That move has already been refused |
| `UNDO_TOO_LATE` | `hx:undo` | A clock has less than 10 s left |
| `BAD_TOKEN` | `hx:identify` | Invalid or expired token, or the account no longer exists |
| `LOOKUP_FAILED` | `hx:identify` | Valid token, but the profile could not be read |
| `SIGN_IN_REQUIRED` | `hx:queue`, `hx:lobby:chat`, `hx:challenge`, `hx:challenge:accept` | The socket is not identified |
| `NOT_IN_LOBBY` | `hx:lobby:chat` | The account has not entered the lobby |
| `NOT_YOURSELF` | `hx:challenge` | Challenging your own account |
| `NOT_HERE` | `hx:challenge`, `hx:challenge:accept` | The other account is off the site and cannot be notified |
| `ALREADY_ASKING` | `hx:challenge` | You already have a challenge or agreement out |
| `ALREADY_ASKED` | `hx:challenge` | The other account is already asking or being asked, or you are being asked |
| `NO_SUCH_CHALLENGE` | `hx:challenge:accept` | Expired, withdrawn or already answered |
| `NOT_YOURS` | `hx:challenge:accept`, `hx:challenge:decline` | Not addressed to you, or you are not one of the two accounts |

Two codes come from the client, not the server: `OFFLINE` (a request failed or timed out; also what `identify()` in `net.js` answers when it cannot reach the server) and `EMPTY_RESPONSE` (an acknowledgement that carried nothing). The game and online pages show a code that has no `online.errors.*` string, such as `TOO_MANY_ROOMS`, with the `OFFLINE` message.

---

## 9. Known issues

Behaviour of the code as of 2026-10-23 that differs from what the code comments and the web client expect. Remove an entry once it is fixed.

1. **Disconnect cleanup in `matchmaking.js` and `lobby.js` never runs.** `onlineGame.js` is attached first, and its `disconnect` handler clears `socket.data.user` (`forgetIdentity`) before the other two handlers read it. So when a signed-in socket disconnects, its quick-match slot stays (until it is paired or 10 minutes old; an opponent paired with it waits in a room nobody will join), its lobby entry stays, and challenges shown on screen are not expired (they run their 60 s). The roster and presence are still updated. `lobby.test.js` ("disconnecting takes you off it too") and `matchmaking.test.js` ("disconnecting takes you out of it too") assert the intended behaviour; they need a database (`npm run test:db`).
2. **An empty seat goes to whoever asks for it.** In a room without a reservation (any private-link room, including a game between two accounts), `hx:join` gives an empty seat to a newcomer even in the middle of a game, while its player is away or reconnecting. The newcomer's account replaces the absent player's on the seat (a game between accounts stays rated), the countdown is called off, and the player coming back gets `ROOM_FULL`, unless the newcomer sent no `key`, in which case the old key still opens the seat. Such games are listed by `hx:live`, so their codes are public.
3. **`hx:sync` returns the players' chat to anyone.** `hx:watch` leaves `chat` out and `hx:chat` goes to the two seats only, but `hx:sync` returns the full room view to any socket with the code; the web client calls it for spectators after `hx:undo:done`.
4. **Spectators follow a rematch.** `hx:rematch:ready` goes to the whole room, and its listener in `web/src/views/play.js` calls `goToRematch` without checking `net.watching` (unlike `adoptRoom`, which does). A spectator is sent into the new room as a would-be player; its `hx:join` either fails with `ROOM_FULL` or takes a seat left empty by a disconnected player.
5. **Cadences are not checked for quick match and challenges.** `hx:queue` and `hx:challenge` accept any `timeControl`, including `none` (an untimed, unrated game) and unknown strings (their own queue pool, and a room created as `none`). The web client never sends these.
6. **A stale queue slot disappears silently.** A slot older than 10 minutes is removed without an `hx:queue:update { inQueue: false }`, so the web client goes on showing a search that no longer exists.

---

## 10. Keeping this file current

The protocol is defined by:
- `backend/socket/io.js`: server options and allowed origins;
- `backend/socket/onlineGame.js`: identity, presence data, rooms, games, spectators, clocks, take-backs, rematches, game chat;
- `backend/socket/matchmaking.js`: the quick-match queue;
- `backend/socket/lobby.js`: the lobby, lobby chat, mentions and challenges;
- `backend/socket/notify.js`: page visibility, and whether a notification goes out;
- `backend/server.js`: which modules are attached, and in which order;
- `backend/services/ratedGameService.js` (what is rated and recorded) and `backend/services/pushService.js` (notification kinds);
- on the client: `web/src/net.js` (connection, `request`, `listen`, identity, rejoin key), `web/src/views/play.js`, `web/src/views/online.js`, `web/src/views/lobby.js`, `web/src/ui/challenge.js`, `web/src/presence.js`, `web/src/push.js` and `web/src/auth.js`.

Real payloads and acknowledgements are exercised over real sockets in `backend/tests/onlineGame.test.js` and `push.test.js` (`npm test`, no database), and in `lobby.test.js`, `matchmaking.test.js` and `ratedOnline.test.js` (`npm run test:db`, which needs `TEST_DATABASE_URL`).

When an event is added, renamed or removed, update the quick reference and its section, then check that every name is still covered:

```sh
grep -ohE "'hx:[a-z:]+'" backend/socket/*.js | sort -u
grep -rohE "'hx:[a-z:]+'" web/src | sort -u
```

Two strings in those lists are not socket events: `hx:lobby` is the Socket.IO room the lobby broadcasts to, and `hx:open` (in `web/src/main.js` and `web/sw.js`) is the type of a message from the service worker to the page. `hx:queue:status` is used only by the tests.
