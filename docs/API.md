# Hexaequo REST API Documentation

## Overview

The API lives under `/api` on the site's own origin. One server answers the
site, the REST API and the Socket.IO connection:

- Production: `https://hexaequo.com/api` (a Render web service, also reachable
  as `https://hexaequo-server.onrender.com/api`)
- Development: `http://localhost:3001/api` (the backend's default `PORT`). When
  the app itself is served by `serve.py` on port 8001 or `http.server` on 8765,
  `web/src/net.js` sends its API calls to port 3001 of the same host;
  `?api=http://host:port` in the page's address overrides that.

Outside `/api` the same server answers the health checks (`/health`,
`/healthz`), the socket (`/socket.io/`) and the site. A path under `/api/` that
no route below matches answers a JSON `404` (see [Errors](#errors)).

Requests and responses are JSON; request bodies are limited to 10 kB. There is
no single response envelope. The older handlers answer
`{ "data": …, "meta": { … } }`; the newer ones (most of `/api/auth`,
`/api/profile`, `/api/push`, `/api/users/leaderboard`, `/api/version`) answer
a plain object; errors come in a few shapes. Each endpoint below shows what it
actually sends. Rows passed through from the database keep their snake_case
column names (`games_played`, `time_mode`, …); everything else is camelCase.
Timestamps are ISO 8601 strings.

Cross-origin requests are accepted from `https://hexaequo.com` and
`https://www.hexaequo.com` (and their `http://` forms),
`https://hexaequo-server.onrender.com`, `https://pierobarrette.github.io`,
`FRONTEND_URL`, and `localhost` / `127.0.0.1` on ports 3000, 3001, 5500, 8001,
8080 and 8765.

## Authentication

An address and a password are the only way in. Signing up, signing in and
following a password-reset link all answer with the same session object (see
[`POST /api/auth/signup`](#post-apiauthsignup)), which carries two tokens:

- `accessToken`: a JWT signed with `JWT_SECRET`, carrying `userId`, `email` and
  `pseudo`. Valid 7 days by default (`JWT_EXPIRES_IN`).
- `refreshToken`: an opaque random string kept in the database, valid 30 days
  by default (`JWT_REFRESH_EXPIRES_IN`). `POST /api/auth/refresh` trades it for
  a new pair; each one works once.

Protected endpoints take the access token as a Bearer token:
```
Authorization: Bearer <access_token>
```

There are no cookies. Each endpoint below states its authentication:

- **required**: without a valid token the request is refused with `401`
  `{ "error": "Unauthorized", "message": "Authentication required" }`
  (`"Invalid token"` or `"Token expired"` for a bad or expired one).
- **optional**: a valid token identifies the caller; a missing, invalid or
  expired one is ignored and the request is answered as for a visitor.
- **none**.

The access token is checked by its signature alone and cannot be revoked: it
stays valid until it expires. Refresh tokens are deleted by
`POST /api/auth/logout` (the one sent, which the web app does when the player
signs out), by `POST /api/auth/reset-password` (all of the account's) and with
the account.

The web app answers a `401` on a signed-in request by spending the refresh
token once and retrying, then by signing out. That is why a refusal that is not
about the session, such as a wrong current password, is a `403`.

The same access token identifies a Socket.IO connection (`hx:identify`).

## Ratings

Each account has a single rating, `elo`: an integer that starts at 1000 and
never goes below 100. There is no rating per time control.

A finished online game is rated when both seats are held by two different
signed-in accounts and the game is played on a clock. Games with a guest, games
against yourself and games without a clock are recorded as unrated and move
nobody's rating. The time control only scales the change: the K-factor (40 for
an account's first 30 rated games, then 20, and 10 from a rating of 2400) is
multiplied by 0.75 in bullet, 0.9 in blitz, 1.0 in rapid and 1.2 in classic.

Time controls (`timeControl`, `timeMode`, `time_mode`): `none` (no clock),
`bullet` (2 min + 1 s per move), `blitz` (5 min + 3 s), `rapid` (10 min + 5 s),
`classic` (20 min + 10 s).

The counters on the account (`gamesPlayed`, `wins`, `losses`, `draws`; in the
leaderboard `games_played` and the rest) move only for rated games.
`/api/profile` counts from the recorded games instead, unrated ones included.

---

## Endpoints

| Endpoint | Auth | Called by the web app |
|----------|------|-----------------------|
| `POST /api/auth/signup` | none | yes |
| `POST /api/auth/register` (alias of `signup`) | none | no |
| `POST /api/auth/login` | none | yes |
| `POST /api/auth/logout` | none | yes (signing out) |
| `POST /api/auth/refresh` | none | yes |
| `POST /api/auth/verify-email` | none | yes |
| `POST /api/auth/forgot-password` | none | yes |
| `POST /api/auth/reset-password` | none | yes |
| `POST /api/auth/change-password` | required | yes |
| `GET /api/auth/me` | required | yes |
| `PUT /api/auth/pseudo` | required | yes |
| `GET /api/auth/pseudo-available` | optional | yes |
| `GET /api/users/me` | required | no |
| `PATCH /api/users/me` | required | no |
| `DELETE /api/users/me` | required | yes |
| `GET /api/users/me/settings` | required | yes |
| `PATCH /api/users/me/settings` | required | yes |
| `GET /api/users/me/preferences` | required | no |
| `PUT /api/users/me/preferences` | required | no |
| `GET /api/users/leaderboard` | none | yes |
| `GET /api/users/:id` | none | no |
| `GET /api/users/:id/matches` | optional | no |
| `GET /api/profile/me` | required | yes |
| `GET /api/profile/me/streak` | required | yes |
| `GET /api/profile/me/games` | required | yes |
| `GET /api/profile/games/:id` | optional | yes |
| `GET /api/profile/:id` | optional | yes |
| `GET /api/profile/:id/games` | optional | yes |
| `GET /api/push/key` | none | yes |
| `POST /api/push/subscribe` | required | yes |
| `POST /api/push/unsubscribe` | none | yes |
| `POST /api/push/renew` | none | yes (service worker) |
| `POST /api/push/test` | required | yes |
| `GET /api/version` | none | yes |
| `GET /health`, `GET /healthz` | none | no (host checks) |
| `/api/admin/*` | admin password | no; only mounted with `ENABLE_ADMIN=1` |

Rooms, quick match, the lobby and challenges are not REST: they go over the
socket (see [WebSocket Events](#websocket-events)). The REST routes an earlier
front end used for them, `/api/rooms`, `/api/matchmaking`, `/api/games` and the
`/api/ai` placeholder, were removed on 2026-10-23 and answer the JSON `404` of
any unknown path.

---

### Authentication

Refusals here are `{ "error": "CODE", "message": "…" }`; the codes are listed
under [Errors](#errors).

#### POST `/api/auth/signup`
Create an account and sign in. `POST /api/auth/register` is an alias, not used
by the current web app.

**Auth:** none. **Rate limit:** the sign-in limiter (see [Rate Limits](#rate-limits)).

**Request Body:**
```json
{
    "email": "celine@example.com",
    "pseudo": "Céline Roy",
    "password": "correct horse"
}
```
`username` is accepted in place of `email` and of `pseudo`. The address is
trimmed and lower-cased. The nickname is 3 to 20 letters (accents included) or
digits, with single spaces, hyphens or underscores between them, and must not
be taken in any case. The password needs 8 to 128 characters.

**Response (201):** a session. `login` and `reset-password` answer the same shape.
```json
{
    "accessToken": "jwt-access-token",
    "refreshToken": "opaque-refresh-token",
    "user": {
        "id": "uuid",
        "pseudo": "Céline Roy",
        "pseudoChosen": true,
        "email": "celine@example.com",
        "elo": 1000,
        "gamesPlayed": 0,
        "wins": 0,
        "losses": 0,
        "draws": 0,
        "createdAt": "2026-10-20T14:03:11.000Z",
        "hasPassword": true
    },
    "needsPseudo": false
}
```
A confirmation mail is sent in the background, with a link to
`/#/verify?token=…` valid 24 hours. The account works before the address is
confirmed.

**Errors:** `400 VALIDATION_ERROR` (wrong type, too long), `400 BAD_EMAIL`,
`400 BAD_PSEUDO`, `400 WEAK_PASSWORD`, `409 EMAIL_TAKEN`, `409 PSEUDO_TAKEN`,
`409 NO_PASSWORD` (the address belongs to an older account that has no password
yet; `forgot-password` sends the link that sets one).

---

#### POST `/api/auth/login`
Sign in with an address and a password.

**Auth:** none. **Rate limit:** the sign-in limiter.

**Request Body:**
```json
{
    "email": "celine@example.com",
    "password": "correct horse"
}
```
`username` is accepted in place of `email`. The address is matched trimmed and
in any case.

**Response (200):** a session, as for `signup`.

**Errors:** `400 VALIDATION_ERROR` (no password), `401 INVALID_CREDENTIALS`
(unknown address or wrong password: the same answer for both),
`401 NO_PASSWORD` (an older account with no password yet).

---

#### POST `/api/auth/logout`
Delete one refresh token. The web app sends its own when the player signs out
(`signOut` in `web/src/auth.js`), without waiting for the answer, and forgets
both tokens in the browser. The access token stays valid until it expires.

**Auth:** none.

**Request Body:**
```json
{
    "refreshToken": "opaque-refresh-token"
}
```

**Response (200):**
```json
{
    "data": null,
    "meta": {
        "message": "Logged out successfully"
    }
}
```
The same answer whether or not the token existed.

---

#### POST `/api/auth/refresh`
Trade a refresh token for a new pair. The old refresh token is deleted.

**Auth:** none.

**Request Body:**
```json
{
    "refreshToken": "opaque-refresh-token"
}
```

**Response (200):**
```json
{
    "data": {
        "accessToken": "new-jwt-access-token",
        "refreshToken": "new-opaque-refresh-token"
    }
}
```

**Errors:** `401 UNAUTHORIZED`, with the message `Invalid refresh token`
(unknown, already used or expired) or `User not found`.

---

#### POST `/api/auth/verify-email`
Confirm an address with the token from the confirmation link
(`/#/verify?token=…`).

**Auth:** none.

**Request Body:**
```json
{
    "token": "verification-token"
}
```

**Response (200):**
```json
{
    "data": null,
    "meta": {
        "message": "Email verified successfully"
    }
}
```

**Errors:** `400 INVALID_TOKEN` (unknown, used, or older than 24 hours).

---

#### POST `/api/auth/forgot-password`
Mail a password-reset link (`/#/reset?token=…`, valid one hour). This is also
how an older account with no password gets its first one.

**Auth:** none. **Rate limit:** 8 per hour per IP.

**Request Body:**
```json
{
    "email": "user@example.com"
}
```

**Response (200)**, whether or not the address has an account, and even if the
mail could not be sent:
```json
{
    "data": null,
    "meta": {
        "message": "If an account exists with this email, a password reset link will be sent."
    }
}
```

---

#### POST `/api/auth/reset-password`
Set a new password with the token from the reset link, and sign in. Every
other session of the account ends (its refresh tokens are deleted), and the
address counts as confirmed.

**Auth:** none.

**Request Body:**
```json
{
    "token": "reset-token",
    "newPassword": "a new start"
}
```

**Response (200):** a session, as for `signup`. `needsPseudo` is true for an
older account whose nickname was never chosen.

**Errors:** `400 VALIDATION_ERROR` (a field missing, or a password over 128
characters), `400 WEAK_PASSWORD`, `400 INVALID_TOKEN` (unknown, used or
expired).

---

#### POST `/api/auth/change-password`
Change the password. Other sessions stay signed in.

**Auth:** required.

**Request Body:**
```json
{
    "currentPassword": "correct horse",
    "newPassword": "battery staple"
}
```

**Response (200):**
```json
{
    "data": null,
    "meta": {
        "message": "Password changed successfully"
    }
}
```

**Errors:** `400 VALIDATION_ERROR`, `400 WEAK_PASSWORD`, `400 NO_PASSWORD` (the
account has none yet: use the reset link), `403 WRONG_PASSWORD`,
`404 NOT_FOUND`.

---

#### GET `/api/auth/me`
The signed-in account. Also notes it as seen.

**Auth:** required.

**Response (200):**
```json
{
    "user": { … },
    "needsPseudo": false
}
```
`user` has the same fields as in a session. `needsPseudo` is true for an older
account whose nickname was generated rather than chosen; the app then asks for
one with `PUT /api/auth/pseudo`.

**Errors:** `404 NOT_FOUND` (`Account not found`: the account behind a token
that is still valid has been deleted).

---

#### PUT `/api/auth/pseudo`
Choose or change the nickname, under the same rules as at sign-up.

**Auth:** required.

**Request Body:**
```json
{
    "pseudo": "Olivier"
}
```

**Response (200):** the account, as for `GET /api/auth/me`.
```json
{
    "user": { … },
    "needsPseudo": false
}
```

**Errors:** `400 BAD_PSEUDO`, `409 PSEUDO_TAKEN`.

---

#### GET `/api/auth/pseudo-available`
Whether a nickname is free, for a form that checks while it is typed.

**Auth:** optional. Signed in, the caller's own nickname counts as free.

**Query Parameters:**
- `pseudo`

**Response (200):**
```json
{
    "pseudo": "Marguerite",
    "available": true
}
```
A nickname outside the rules is also answered `200`, without `pseudo`:
```json
{
    "available": false,
    "reason": "Nickname must be 3 to 20 letters or digits, with single spaces, hyphens or underscores between them"
}
```

---

### Users

#### GET `/api/users/me`
Not used by the current web app, which reads `/api/auth/me` and
`/api/profile/me`.

**Auth:** required.

**Response (200):**
```json
{
    "data": {
        "id": "uuid",
        "pseudo": "Céline Roy",
        "email": "celine@example.com",
        "elo": 1034,
        "stats": {
            "gamesPlayed": 9,
            "wins": 5,
            "losses": 3,
            "draws": 1
        },
        "settings": { … },
        "createdAt": "2026-09-02T18:20:00.000Z"
    }
}
```
`stats` are the account's counters: rated games only.

**Errors:** `404 NOT_FOUND`.

---

#### PATCH `/api/users/me`
Update `pseudo`, `avatar_url` or `country_code`. Not used by the current web
app, which renames with `PUT /api/auth/pseudo`. The `pseudo` is held to the
same rules by the same code as there and at sign-up (trimmed, 3 to 20 letters
or digits with single separators, not taken in any case), and the nickname then
counts as chosen.

**Auth:** required.

**Request Body:**
```json
{
    "pseudo": "NewName"
}
```

**Response (200):**
```json
{
    "data": {
        "id": "uuid",
        "pseudo": "NewName"
    },
    "meta": {
        "message": "Profile updated successfully"
    }
}
```

**Errors:** `400 VALIDATION_ERROR` (a `pseudo` that is not a string, or over 60
characters), `400 BAD_PSEUDO`, `409 PSEUDO_TAKEN`, `404 NOT_FOUND` (also when
the body has none of the three fields).

---

#### DELETE `/api/users/me`
Close the account. Its games stay, since other players' ratings rest on them,
with its nickname replaced by `Compte supprimé`; its sessions, settings,
preferences and notification subscriptions are deleted with it.

**Auth:** required.

**Request Body:**
```json
{
    "password": "correct horse"
}
```
Required when the account has a password; an older account with none sends
nothing.

**Response (200):**
```json
{
    "data": null,
    "meta": {
        "message": "Account deleted successfully"
    }
}
```

**Errors:** `403 WRONG_PASSWORD`, `404 NOT_FOUND`.

---

#### GET `/api/users/me/settings`
The settings saved with the account, which the app keeps in step across
devices (`web/src/settingsSync.js`). The server itself reads `language` and the
four notification switches (`notifyChallenges`, `notifyGames`,
`notifyMentions`, `notifyReminders`) before sending a notification.

**Auth:** required.

**Response (200):**
```json
{
    "data": {
        "theme": "auto",
        "boardStyle": "modern",
        "volume": 0.5,
        "language": "fr",
        "notifyReminders": false
    }
}
```
The object is returned as stored, older keys included (`sounds`, `animations`,
`showPreviousMove`); the app keeps only the keys it knows. A new account row
starts with the column default from `models/schema.js`:
`{ "theme": "dark", "sounds": true, "animations": true, "showValidMoves": false, "showPreviousMove": true }`.

**Errors:** `404 NOT_FOUND`.

---

#### PATCH `/api/users/me/settings`
Merge keys into the saved settings: the keys sent replace those stored, the
others are kept. Keys and values are not checked.

**Auth:** required.

**Request Body:**
```json
{
    "theme": "light",
    "notifyMentions": false
}
```

**Response (200):** the whole object after the merge.
```json
{
    "data": {
        "theme": "light",
        "boardStyle": "modern",
        "notifyMentions": false
    },
    "meta": {
        "message": "Settings updated successfully"
    }
}
```

**Errors:** `404 NOT_FOUND`.

---

#### GET `/api/users/me/preferences`
Matchmaking preferences: the rating range to accept, relative to one's own,
and whether to accept friendly games. Not used by the current web app, and not
read by the current quick match, which widens its own rating band while a
player waits.

**Auth:** required.

**Response (200):** the defaults, until something is saved.
```json
{
    "data": {
        "elo_range_min": -200,
        "elo_range_max": 200,
        "allow_friendly_games": true
    }
}
```

---

#### PUT `/api/users/me/preferences`
Save the matchmaking preferences. Not used by the current web app. A field left
out goes back to its default.

**Auth:** required.

**Request Body:**
```json
{
    "elo_range_min": -300,
    "elo_range_max": 150,
    "allow_friendly_games": false
}
```
`elo_range_min`: a number from -500 to 0. `elo_range_max`: from 0 to 500.
`allow_friendly_games`: a boolean.

**Response (200):**
```json
{
    "data": {
        "elo_range_min": -300,
        "elo_range_max": 150,
        "allow_friendly_games": false
    },
    "meta": {
        "message": "Preferences updated successfully"
    }
}
```

**Errors:** `400 VALIDATION_ERROR`.

---

#### GET `/api/users/leaderboard`
The ranking: accounts with at least one rated game, by rating, ties going to
the older account. Accounts whose address ends in `.invalid` (test accounts)
are left out. The first page also lists, under `waiting`, up to 500 members who
have not played a rated game yet, oldest first, with no rank or rating.

**Auth:** none.

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 50, from 1 to 100)

**Response (200):**
```json
{
    "players": [
        {
            "rank": 1,
            "id": "uuid",
            "pseudo": "TopPlayer",
            "elo": 1342,
            "games_played": 58,
            "wins": 37,
            "losses": 19,
            "draws": 2,
            "win_rate": "63.8"
        }
    ],
    "waiting": [
        { "id": "uuid", "pseudo": "Newcomer" }
    ],
    "total": 41,
    "page": 1,
    "totalPages": 1
}
```
`win_rate` is a percentage with one decimal, sent as a string (a PostgreSQL
`numeric`). `total` counts ranked players only. `waiting` is `[]` after the
first page.

---

#### GET `/api/users/:id`
A player's public summary. Not used by the current web app, which reads
`/api/profile/:id`.

**Auth:** none.

**Response (200):**
```json
{
    "data": {
        "id": "uuid",
        "pseudo": "HexMaster",
        "elo": 1034,
        "stats": {
            "gamesPlayed": 9,
            "wins": 5,
            "losses": 3,
            "draws": 1,
            "winRate": 56
        },
        "createdAt": "2026-09-02T18:20:00.000Z"
    }
}
```
`stats` count rated games only; `winRate` is a whole percentage.

**Errors:** `404 NOT_FOUND`; an id that is not a UUID is a `500` (see
[Errors](#errors)).

---

#### GET `/api/users/:id/matches`
A player's finished games, most recent first. Not used by the current web app,
which reads `/api/profile/:id/games`. It draws the same line as `/api/profile`:
the player, signed in, gets every game; anyone else, signed in or not, gets the
rated ones only, and `meta.total` counts those.

**Auth:** optional.

**Query Parameters:**
- `page` (default: 1)
- `limit`: 10, 25 or 50 (default: 25; any other value is read as 25)
- `result`: comma-separated, among `win`, `loss`, `draw`
- `timeMode`: one time control
- `opponentName`: part of the opponent's nickname, in any case
- `dateFrom`, `dateTo`: bounds on when the game ended

**Response (200):**
```json
{
    "data": [
        {
            "id": "game_uuid",
            "time_mode": "rapid",
            "winner": "black",
            "result_reason": "disks",
            "finished_at": "2026-10-19T21:04:11.000Z",
            "player_color": "black",
            "opponent_pseudo": "Opponent",
            "opponent_elo": 1040,
            "elo_change": 22,
            "result": "win"
        }
    ],
    "meta": {
        "total": 9,
        "page": 1,
        "totalPages": 1
    }
}
```
`opponent_elo` and `elo_change` are null for an unrated game.

---

### Profile

A player's record, game history and replays: what the profile page, the card
at the end of a game and the review board read.

Records and rated games are public. Unrated games (friendlies) belong to the
two who played them: someone else's record and history leave them out, and a
replay of one is refused to anyone who did not play it. Your own record and
history include everything.

Account and game ids are UUIDs; anything else is answered `404`
`{ "error": "No such record" }`. Other refusals here are `404`
`{ "error": "No such account" }` and `{ "error": "No such game" }`.

#### GET `/api/profile/me`
Your own record.

**Auth:** required.

**Query Parameters:**
- `tz`: the IANA time zone the streak is counted in (default and fallback: UTC)

**Response (200):**
```json
{
    "pseudo": "Céline Roy",
    "elo": 1034,
    "peakElo": 1051,
    "memberSince": "2026-09-02T18:20:00.000Z",
    "all": { "played": 14, "wins": 8, "losses": 5, "draws": 1 },
    "rated": { "played": 9, "wins": 5, "losses": 3, "draws": 1 },
    "countsEverything": true,
    "byCadence": {
        "none": { "played": 5, "wins": 3, "losses": 2, "draws": 0 },
        "rapid": { "played": 9, "wins": 5, "losses": 3, "draws": 1 }
    },
    "curve": [
        { "elo": 1012, "at": "2026-10-18T20:15:00.000Z" },
        { "elo": 1034, "at": "2026-10-19T21:04:11.000Z" }
    ],
    "streak": { "current": 3, "best": 5, "playedToday": true, "today": 2 }
}
```
- `all` counts every game played, `rated` those that moved the rating;
  `byCadence` splits `all` by time control.
- `countsEverything` says whether `all` includes unrated games: true for your
  own record only.
- `curve`: the last 60 rating changes, oldest first. `peakElo`: the highest
  rating reached, never below the current one.
- `streak`: as [`/api/profile/me/streak`](#get-apiprofilemestreak), or null if
  it could not be counted.

**Errors:** `404 No such account`.

---

#### GET `/api/profile/me/streak`
Days in a row with a game, as the card at the end of a game shows it.

**Auth:** required.

**Query Parameters:**
- `tz`: the IANA time zone the days are counted in (default and fallback: UTC)

**Response (200):**
```json
{
    "current": 3,
    "best": 5,
    "playedToday": true,
    "today": 2
}
```
A day counts when an online game with at least one move, against someone else
(an account or a guest), rated or not, finished in it. `current` counts back
from today when a game was played today, and from yesterday when not, so a
streak is not lost before the day is over. `best` is the longest run there has
been; `today` is how many games have counted today.

---

#### GET `/api/profile/me/games`
Every game you have played, rated or not, most recent first.

**Auth:** required.

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 20, at most 50)

**Response (200):**
```json
{
    "games": [
        {
            "id": "game_uuid",
            "playedAt": "2026-10-19T21:04:11.000Z",
            "colour": 0,
            "outcome": "win",
            "reason": "disks",
            "timeControl": "rapid",
            "plies": 87,
            "rated": true,
            "ratingBefore": 1012,
            "ratingAfter": 1034,
            "ratingChange": 22,
            "opponent": {
                "userId": "uuid",
                "pseudo": "Opponent",
                "elo": 1040
            }
        }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 14
}
```
- Each game is seen from the player's side: `colour` 0 is Black, 1 is White;
  `outcome` is `win`, `loss` or `draw`.
- `reason`, for games recorded by the current server: `disks`, `rings`,
  `cleared`, `noMoves`, `idle`, `repetition`, `agreed`, `resigned`, `timeout`
  or `abandoned`.
- `ratingBefore`, `ratingAfter`, `ratingChange` and `opponent.elo` are null for
  an unrated game; `opponent.userId` is null for a guest.

---

#### GET `/api/profile/games/:id`
One game in full, for the review board. A rated game is open to anyone; an
unrated one only to its two players.

**Auth:** optional.

**Response (200):** the fields of a history entry (above), seen from the
caller's side, or from White's for someone who did not play, plus:
```json
{
    "roomCode": "K7M3QX",
    "black": { "userId": "uuid", "pseudo": "Céline Roy", "elo": 1012 },
    "white": { "userId": "uuid", "pseudo": "Opponent", "elo": 1040 },
    "winner": "black",
    "replayable": true,
    "moves": [
        { "type": "tile", "cell": 1234 },
        { "type": "disk", "path": [1234, 1298] }
    ],
    "notations": ["…", "…"],
    "times": [3120, 5400],
    "finalState": { … }
}
```
- `moves`: each ply as the server applied it (`tile`, `piece`, `disk` or
  `ring`). Replayed through the shared engine (`web/src/game/`), they lead to
  `finalState`.
- `notations`: the same plies in notation. `times`: the milliseconds each ply
  took, null where it was not recorded.
- `replayable` is false for games recorded before the moves were kept in full;
  `moves`, `notations` and `times` are then empty.
- `winner`: `black`, `white` or `draw`.

**Errors:** `404 No such game` (also for an unrated game the caller did not
play), `404 No such record`.

---

#### GET `/api/profile/:id`
Anyone's record, by account id: what a name in the lobby or on the leaderboard
links to.

**Auth:** optional.

**Query Parameters:**
- `tz`: used only when the id is the caller's own, for the streak

**Response (200):** the fields of `/api/profile/me`, counted over rated games
only unless the id is the caller's own (`countsEverything` false, no `none`
entry in `byCadence`), plus:
```json
{
    "versus": { "played": 2, "wins": 1, "losses": 1, "draws": 0 },
    "isYou": false,
    "notifiable": true
}
```
- `versus`: the signed-in caller's record against this player, counting every
  game between the two, rated or not; null when signed out, when they have
  never met, or for yourself.
- `isYou`: whether the id is the caller's own; `streak` is then included too.
- `notifiable`: whether a challenge would reach this player as a notification
  when they are not on the site. Only ever true for a signed-in caller looking
  at someone else.

**Errors:** `404 No such account`, `404 No such record`.

---

#### GET `/api/profile/:id/games`
A player's games, most recent first, as `/api/profile/me/games`. Someone else's
history lists rated games only, and `total` counts only those.

**Auth:** optional.

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 20, at most 50)

**Errors:** `404 No such record`.

---

### Push notifications

Web Push to the installed app. Off unless the host sets `VAPID_PUBLIC_KEY` and
`VAPID_PRIVATE_KEY` (and optionally `VAPID_SUBJECT`, default
`https://hexaequo.com`). Off, `/key` answers `enabled: false`, `/subscribe` and
`/test` answer `503 UNAVAILABLE`, `/unsubscribe` still answers `{ "ok": true }`
and `/renew` answers `400` `{ "ok": false }`. The pair is generated once and
never changed: a new pair silently cuts off every device already subscribed.
The table `push_subscriptions` is created at start-up when the keys are set
(tried again every minute while the database does not answer; `enabled` stays
false until then). An account keeps at most 10 devices; the least recently seen
go first.

Apart from `/key`, answers here are `{ "ok": … }` objects; a refusal is
`{ "ok": false, "error": "CODE" }`.

What is sent, and the account setting that can turn each off (saved with
`PATCH /api/users/me/settings`): `challenge`, `accepted`, `ready`
(`notifyChallenges`); `turn`, `comeBack` (`notifyGames`); `mention`
(`notifyMentions`); `reminder`, `streak` (`notifyReminders`); `test` (always).
The first six are not sent while one of the account's pages reports itself on
screen through the socket event `hx:visible`.

Reminders run only in production, or with `PUSH_REMINDERS=1`. They are checked
every 15 minutes, at most one per account each time, in the evening of the
time zone of the account's most recently seen device: `reminder` between 17:00
and 21:00, after 3, 7, 14 and 30 days without a visit or a game, once per step;
`streak` between 19:00 and 22:00, once a day, to an account with a streak of
two days or more and no game yet that day.

The message itself is JSON for the service worker to draw:
`{ kind, title, body, url, tag, badge, lang, at }`, in the account's language
(its `language` setting, else the language a device gave when it subscribed,
else English).

#### GET `/api/push/key`
The public key a browser subscribes with. Sent with `Cache-Control: no-store`.

**Auth:** none.

**Response (200):**
```json
{ "enabled": true, "publicKey": "B…" }
```
`publicKey` is null when the server has no keys.

---

#### POST `/api/push/subscribe`
Register this browser for the signed-in account. A browser already registered
to another account moves to this one. The endpoint must be an `https` address
at a browser vendor's push service: `fcm.googleapis.com`,
`android.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com` or
`*.notify.windows.com`.

**Auth:** required.

**Request Body:**
```json
{
    "subscription": { "endpoint": "https://fcm.googleapis.com/fcm/send/…", "keys": { "p256dh": "…", "auth": "…" } },
    "timeZone": "America/Toronto",
    "language": "fr"
}
```
`timeZone` is an IANA zone, kept for the reminders (an unknown one is dropped);
`language` is `fr` or `en` (anything else is dropped).

**Response (200):** `{ "ok": true }` — or `400 BAD_SUBSCRIPTION`,
`503 UNAVAILABLE`.

---

#### POST `/api/push/unsubscribe`
Forget a browser. No session needed: the endpoint is the browser's own secret.

**Auth:** none.

**Request Body:** `{ "endpoint": "https://…" }`

**Response (200):** `{ "ok": true }`, whether or not the endpoint was known.

---

#### POST `/api/push/renew`
Sent by the service worker when the push service replaces a browser's address;
the old endpoint vouches for the new subscription.

**Auth:** none.

**Request Body:** `{ "oldEndpoint": "https://…", "subscription": { … } }`

**Response (200):** `{ "ok": true }` — or `400` `{ "ok": false }` (the old
endpoint is unknown, or notifications are off), `400 BAD_SUBSCRIPTION`.

---

#### POST `/api/push/test`
A test notification to one of the account's devices, four seconds later.
Five per ten minutes per account.

**Auth:** required.

**Request Body:** `{ "endpoint": "https://…" }`

**Response (200):** `{ "ok": true, "delayMs": 4000 }` — or `404 NOT_REGISTERED`
(not one of this account's devices), `429 TOO_MANY`, `503 UNAVAILABLE`.

---

### Version and health

#### GET `/api/version`
The build being served: the first 12 hex digits of a hash of the web app's
files, or `dev` when there is no `web/` folder. The service worker's cache is
named after it. Sent with `Cache-Control: no-store`.

**Auth:** none.

**Response (200):**
```json
{ "build": "3f9c2a7d1b4e" }
```

---

#### GET `/health`
For the host's health check; outside `/api`, so not rate-limited. Does not
touch the database.

**Response (200):**
```json
{
    "status": "ok",
    "timestamp": "2026-10-23T18:00:00.000Z",
    "uptime": 5123.4
}
```
`uptime` is in seconds.

---

#### GET `/healthz`
The same check for hosts that expect this path.

**Response (200):** the body `OK`.

---

### Admin console

A database console for maintenance, not part of the app's API. It is mounted
only when the host sets `ENABLE_ADMIN=1` (or `true`), and is off in
production; otherwise `/api/admin` is an unknown path like any other (JSON
`404`). With it on, a production server refuses to start unless
`DEBUG_PASSWORD` is set to something other than its built-in default.

Each JSON route needs that password in an `X-Admin-Password` header (a `pwd`
query or body field also works), or answers `401`: `GET /api/admin/stats`,
`GET /api/admin/tables`, `GET /api/admin/schema/:table`, `POST /api/admin/query`
(`{ "sql": "SELECT …" }`, SELECT only) and `POST /api/admin/execute`
(`{ "sql": "…" }`, INSERT, UPDATE or DELETE only). `GET /api/admin/` is an HTML
page built on inline scripts, which the site's Content-Security-Policy
(`script-src 'self'`) blocks.

---

## Errors

There is no single error format. What each source sends:

| Source | Status | Body |
|--------|--------|------|
| A route's refusal, through the error handler | 4xx | `{ "error": "CODE", "message": "English text" }` |
| No token, or a bad one, on a route that requires one | 401 | `{ "error": "Unauthorized", "message": "Authentication required" }` (or `"Invalid token"`, `"Token expired"`) |
| A path under `/api/` that no route matches | 404 | `{ "error": "Not Found", "message": "Route GET /api/nothing-here not found" }`: the method and the path asked for, without the query string |
| A rate limit | 429 | `{ "error": "Too Many Requests", "message": "…", "retryAfter": 900 }` |
| `/api/profile` | 404 | `{ "error": "No such account" }`, `"No such game"` or `"No such record"` |
| `/api/push` | 400, 404, 429, 503 | `{ "ok": false, "error": "CODE" }` |
| Anything unexpected | 500 | `{ "error": "INTERNAL_ERROR", "message": "…" }`; a database error carries PostgreSQL's code instead, e.g. `"22P02"` for an id that is not a UUID on `/api/users/:id` |

The app puts the `error` code into words in the reader's language
(`web/src/ui/authErrors.js`); `message` is for logs and for anyone calling the
API by hand. A body that is not valid JSON answers `400`, and one over 10 kB
`413`, both with `"error": "INTERNAL_ERROR"`. In development
(`NODE_ENV=development`) an unexpected error also carries `stack`.

Codes sent as `{ "error": "CODE", "message": "…" }`:

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | A body field of the wrong type, too long, out of range or missing; `message` lists them, separated by `; ` |
| `BAD_EMAIL` | 400 | Sign-up: not an address |
| `BAD_PSEUDO` | 400 | Sign-up, `PUT /api/auth/pseudo`, `PATCH /api/users/me`: a nickname outside the rules |
| `WEAK_PASSWORD` | 400 | Sign-up, reset, change: fewer than 8 characters |
| `INVALID_TOKEN` | 400 | `verify-email`, `reset-password`: an unknown, used or expired link |
| `NO_PASSWORD` | 401, 409, 400 | Sign-in (401), sign-up (409), change-password (400): an older account that has no password yet |
| `INVALID_CREDENTIALS` | 401 | Sign-in: unknown address or wrong password |
| `UNAUTHORIZED` | 401 | `refresh`: an unknown, used or expired refresh token |
| `WRONG_PASSWORD` | 403 | `change-password`, `DELETE /api/users/me` |
| `NOT_FOUND` | 404 | No such user or account |
| `EMAIL_TAKEN` | 409 | Sign-up |
| `PSEUDO_TAKEN` | 409 | Sign-up, `PUT /api/auth/pseudo`, `PATCH /api/users/me` |
| `INTERNAL_ERROR` | 500 | Anything else |

Codes sent by `/api/push` as `{ "ok": false, "error": "CODE" }`:

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `BAD_SUBSCRIPTION` | 400 | Not a browser subscription at a known push service |
| `NOT_REGISTERED` | 404 | `test`: the endpoint is not one of this account's devices |
| `TOO_MANY` | 429 | `test`: more than five in ten minutes |
| `UNAVAILABLE` | 503 | Notifications are off on this server |

---

## Rate Limits

Counted per client IP address. Responses carry `RateLimit-Policy`,
`RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` headers. A
refusal is a `429` with a `Retry-After` header (the seconds left) and the body
shown under [Errors](#errors), whose `retryAfter` is the length of the window
in seconds. These limits are off when `NODE_ENV=test`.

| Endpoint | Limit |
|----------|-------|
| Everything under `/api/` | 100 requests / 15 minutes (`RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_WINDOW_MS`) |
| `POST /api/auth/signup`, `/register` and `/login`, together | 20 failed requests / 15 minutes; successful ones are not counted |
| `POST /api/auth/forgot-password` | 8 requests / hour |

The stricter limits apply on top of the general one. The health checks, the
site and the socket are not limited.

`POST /api/push/test` also has a limit of its own, counted per account: five
per ten minutes, refused with `429` `{ "ok": false, "error": "TOO_MANY" }`.

---

## WebSocket Events

Online games, quick match, the lobby, challenges and the on-screen reports for
notifications go over Socket.IO on the same origin (path `/socket.io/`), with
`hx:*` events; a connection identifies itself by sending the access token with
`hx:identify`. The handlers are in `backend/socket/` (`onlineGame.js`,
`matchmaking.js`, `lobby.js`, `notify.js`). See also
[SOCKET_EVENTS.md](./SOCKET_EVENTS.md).
