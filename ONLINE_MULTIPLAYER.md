# Online Multiplayer Deployment Guide

This guide explains how to deploy the Hexaequo online multiplayer server on Render (free tier).

## Architecture Overview

```
┌─────────────────┐         ┌─────────────────┐
│   Player 1      │         │   Player 2      │
│   Browser       │         │   Browser       │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │    WebSocket (Socket.IO)  │
         │                           │
         └───────────┬───────────────┘
                     │
         ┌───────────▼───────────┐
         │   Render Server       │
         │   (Node.js + SQLite)  │
         └───────────────────────┘
```

## Prerequisites

- GitHub account
- Render account (free tier available at https://render.com)
- Your repository pushed to GitHub

## Deployment Steps

### 1. Push Code to GitHub

Ensure all the new files are committed:
- `server/` folder with `server.js`, `package.json`, `README.md`, `.gitignore`
- `hexaequo-v2/multiplayer.js`
- Updated `hexaequo-v2/index.html`, `hexaequo-v2/game.js`, `hexaequo-v2/styles.css`

### 2. Create Render Web Service

1. Go to https://dashboard.render.com
2. Click **New +** → **Web Service**
3. Connect your GitHub repository
4. Configure the service:

   | Setting | Value |
   |---------|-------|
   | **Name** | `hexaequo-server` |
   | **Region** | Choose closest to your users |
   | **Branch** | `main` (or your branch) |
   | **Root Directory** | `server` |
   | **Runtime** | Node |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Instance Type** | Free |

5. Add Environment Variables:

   | Key | Value |
   |-----|-------|
   | `FRONTEND_URL` | `https://hexaequo.com` |
   | `DATABASE_PATH` | `/tmp/hexaequo.db` |
   | `NODE_ENV` | `production` |

6. Click **Create Web Service**

### 3. Update Frontend Server URL

After deployment, Render will give you a URL like `https://hexaequo-server.onrender.com`.

Update `hexaequo-v2/multiplayer.js` line 11:
```javascript
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://hexaequo-server.onrender.com'; // ← Update this!
```

### 4. Deploy Frontend

Push the updated `multiplayer.js` to GitHub. GitHub Pages will automatically deploy.

## Free Tier Limitations

### Render Free Tier
- Server **spins down after 15 minutes of inactivity**
- First connection after spin-down takes **~30-50 seconds** (cold start)
- 750 hours/month of free compute
- SQLite database is stored in `/tmp` (ephemeral - lost on restart)

### Mitigation Strategies

1. **Cold Start UX**: The connection status shows "Connecting..." while the server wakes up
2. **Database Persistence**: Games older than 24 hours are automatically cleaned up anyway
3. **Reconnection**: Players can rejoin their game if disconnected within 24 hours

## Local Development

### Running the Server Locally

```bash
cd server
npm install
npm start
```

Server runs on http://localhost:3000

### Running the Frontend Locally

Use any static file server:
```bash
cd hexaequo-v2
npx serve .
# or
python -m http.server 8080
```

Frontend runs on http://localhost:8080

## Testing the Multiplayer

1. Open two browser windows/tabs
2. In first window: Click **Play Online** → **Create Room**
3. Copy the 4-character room code
4. In second window: Click **Play Online** → Enter code → **Join Room**
5. Play!

## Troubleshooting

### "Failed to connect to server"
- Check if the Render service is running
- First connection after inactivity takes 30-50 seconds
- Check browser console for detailed errors

### "Room not found"
- Room codes are case-insensitive
- Rooms expire after 24 hours
- Make sure the room was created recently

### Moves not syncing
- Check network connectivity
- Look for errors in browser console
- Server logs available in Render dashboard

## Upgrading to Paid Hosting

For better performance (no cold starts), consider:

### Render Starter ($7/month)
- No spin-down
- More memory
- Same deployment process

### Railway ($5 credit/month free)
- Similar to Render
- Good for small projects

### Fly.io
- Generous free tier
- Better global latency
- Slightly more complex setup

For persistent database with paid hosting, consider:
- **Turso** (SQLite edge database)
- **PlanetScale** (MySQL)
- **Supabase** (PostgreSQL)
