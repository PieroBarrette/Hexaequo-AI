# Hexaequo REST API Documentation

## Overview

Base URL: `https://api.hexaequo.com` (production) or `http://localhost:3001` (development)

All responses follow a consistent format:
```json
{
    "data": { ... },
    "meta": {
        "message": "Optional message",
        "total": 100,
        "page": 1,
        "totalPages": 5
    }
}
```

Error responses:
```json
{
    "error": "ERROR_CODE",
    "message": "Human-readable error message"
}
```

## Authentication

All protected endpoints require a Bearer token in the Authorization header:
```
Authorization: Bearer <access_token>
```

---

## Endpoints

### Authentication

#### POST `/api/auth/signup`
Create a new user account.

**Request Body:**
```json
{
    "email": "user@example.com",
    "pseudo": "HexMaster",
    "password": "securePassword123"
}
```

**Response (201):**
```json
{
    "data": {
        "userId": "uuid",
        "email": "user@example.com",
        "pseudo": "HexMaster"
    },
    "meta": {
        "message": "Account created successfully. Please check your email to verify your account."
    }
}
```

---

#### POST `/api/auth/login`
Login with email and password.

**Request Body:**
```json
{
    "email": "user@example.com",
    "password": "securePassword123"
}
```

**Response (200):**
```json
{
    "data": {
        "accessToken": "jwt-access-token",
        "refreshToken": "jwt-refresh-token",
        "user": {
            "id": "uuid",
            "pseudo": "HexMaster",
            "email": "user@example.com",
            "elo": {
                "classic": 1500,
                "rapid": 1500,
                "blitz": 1500
            }
        }
    }
}
```

---

#### POST `/api/auth/logout`
Invalidate refresh token.

**Request Body:**
```json
{
    "refreshToken": "jwt-refresh-token"
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

---

#### POST `/api/auth/refresh`
Refresh access token.

**Request Body:**
```json
{
    "refreshToken": "jwt-refresh-token"
}
```

**Response (200):**
```json
{
    "data": {
        "accessToken": "new-jwt-access-token",
        "refreshToken": "new-jwt-refresh-token"
    }
}
```

---

#### POST `/api/auth/verify-email`
Verify email address with token from email.

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

---

#### POST `/api/auth/forgot-password`
Request password reset email.

**Request Body:**
```json
{
    "email": "user@example.com"
}
```

**Response (200):**
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
Reset password with token from email.

**Request Body:**
```json
{
    "token": "reset-token",
    "newPassword": "newSecurePassword123"
}
```

**Response (200):**
```json
{
    "data": null,
    "meta": {
        "message": "Password reset successfully"
    }
}
```

---

#### POST `/api/auth/change-password` 🔒
Change password (authenticated).

**Request Body:**
```json
{
    "currentPassword": "oldPassword",
    "newPassword": "newSecurePassword123"
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

---

### Users

#### GET `/api/users/me` 🔒
Get current user profile.

**Response (200):**
```json
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
            "sounds": true,
            "animations": true
        },
        "createdAt": "2025-01-01T00:00:00Z"
    }
}
```

---

#### PATCH `/api/users/me` 🔒
Update current user profile.

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
        "pseudo": "NewName",
        "settings": { ... }
    },
    "meta": {
        "message": "Profile updated successfully"
    }
}
```

---

#### GET `/api/users/:id`
Get public user profile.

**Response (200):**
```json
{
    "data": {
        "id": "uuid",
        "pseudo": "HexMaster",
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
        "createdAt": "2025-01-01T00:00:00Z"
    }
}
```

---

#### GET `/api/users/:id/matches`
Get user's match history.

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 20)

**Response (200):**
```json
{
    "data": [
        {
            "id": "game_uuid",
            "opponent": {
                "id": "uuid",
                "pseudo": "Opponent"
            },
            "result": "win",
            "eloChange": 15,
            "timeMode": "rapid",
            "playedAt": "2025-01-15T10:30:00Z"
        }
    ],
    "meta": {
        "total": 120,
        "page": 1,
        "totalPages": 6
    }
}
```

---

### Rooms

#### GET `/api/rooms`
Get available rooms.

**Query Parameters:**
- `status` (default: "waiting") - "waiting" | "playing"
- `timeMode` - "none" | "classic" | "rapid" | "blitz"
- `allowSpectators` - true | false
- `page` (default: 1)
- `limit` (default: 20)

**Response (200):**
```json
{
    "data": [
        {
            "code": "A1B2",
            "host": {
                "id": "uuid",
                "pseudo": "Player1",
                "elo": 1600
            },
            "timeMode": "rapid",
            "allowSpectators": true,
            "status": "waiting",
            "createdAt": "2025-01-15T10:00:00Z"
        }
    ],
    "meta": {
        "total": 5,
        "page": 1,
        "totalPages": 1
    }
}
```

---

#### POST `/api/rooms`
Create a new room.

**Request Body:**
```json
{
    "timeMode": "rapid",
    "allowSpectators": true
}
```

**Response (201):**
```json
{
    "data": {
        "roomCode": "C3D4",
        "url": "/game/C3D4"
    }
}
```

---

#### GET `/api/rooms/:code`
Get room details.

**Response (200):**
```json
{
    "data": {
        "code": "A1B2",
        "host": { ... },
        "guest": { ... },
        "timeMode": "rapid",
        "allowSpectators": true,
        "status": "playing"
    }
}
```

---

#### POST `/api/rooms/:code/join`
Join a room.

**Response (200):**
```json
{
    "data": {
        "roomCode": "A1B2",
        "color": "white",
        "timeMode": "rapid"
    }
}
```

---

### Games

#### GET `/api/games`
Get games list.

**Query Parameters:**
- `status` - "playing" | "finished"
- `timeMode` - "none" | "classic" | "rapid" | "blitz"
- `page` (default: 1)
- `limit` (default: 20)

**Response (200):**
```json
{
    "data": [
        {
            "id": "game_uuid",
            "players": {
                "black": { "id": "uuid", "pseudo": "Player1", "elo": 1600 },
                "white": { "id": "uuid", "pseudo": "Player2", "elo": 1550 }
            },
            "status": "playing",
            "timeMode": "rapid",
            "createdAt": "2025-01-15T10:30:00Z"
        }
    ],
    "meta": {
        "total": 10,
        "page": 1,
        "totalPages": 1
    }
}
```

---

#### GET `/api/games/:id/replay`
Get game replay data.

**Response (200):**
```json
{
    "data": {
        "gameId": "game_uuid",
        "players": { ... },
        "moves": [
            {
                "moveNumber": 1,
                "player": "black",
                "notation": "tile d4",
                "state": { ... },
                "timestamp": "2025-01-15T10:31:00Z"
            }
        ],
        "result": {
            "winner": "black",
            "reason": "capture"
        },
        "timeMode": "rapid",
        "createdAt": "2025-01-15T10:30:00Z"
    }
}
```

---

#### GET `/api/games/leaderboard`
Get rating leaderboard.

**Query Parameters:**
- `timeMode` (default: "classic")
- `page` (default: 1)
- `limit` (default: 50)

**Response (200):**
```json
{
    "data": [
        {
            "rank": 1,
            "id": "uuid",
            "pseudo": "TopPlayer",
            "elo": 2400,
            "gamesPlayed": 500,
            "winRate": 0.72
        }
    ],
    "meta": {
        "total": 1000,
        "page": 1,
        "totalPages": 20
    }
}
```

---

### AI

#### POST `/api/ai/move`
Get AI move (server-side).

**Request Body:**
```json
{
    "gameState": { ... },
    "difficulty": 3
}
```

**Response (200):**
```json
{
    "data": {
        "move": { ... },
        "computeTime": 1234
    }
}
```

---

#### GET `/api/ai/rating`
Get estimated AI rating.

**Query Parameters:**
- `difficulty` (1-4)

**Response (200):**
```json
{
    "data": {
        "difficulty": 3,
        "estimatedRating": 1600
    }
}
```

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `INVALID_TOKEN` | 401 | Invalid or missing authentication token |
| `TOKEN_EXPIRED` | 401 | Authentication token has expired |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Access denied |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource already exists |
| `TOO_MANY_REQUESTS` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Internal server error |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| General API | 100 requests / 15 minutes |
| Auth endpoints | 10 requests / 15 minutes |
| Password reset | 3 requests / hour |

---

## WebSocket Events

For real-time game communication, see [SOCKET_EVENTS.md](./SOCKET_EVENTS.md).
