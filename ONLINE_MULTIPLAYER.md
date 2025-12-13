# Hexaequo Online Multiplayer - Production Deployment Guide

This guide walks you through deploying Hexaequo online multiplayer to production.

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   Player 1      │         │   Player 2      │
│   Browser       │         │   Browser       │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │         HTTPS             │
         ▼                           ▼
┌─────────────────────────────────────────────┐
│         https://hexaequo.com                │
│         (GitHub Pages - Frontend)           │
└────────────────────┬────────────────────────┘
                     │
                     │ WebSocket (Socket.IO)
                     ▼
┌─────────────────────────────────────────────┐
│   https://hexaequo-server.onrender.com      │
│   (Render - Node.js + SQLite Backend)       │
└─────────────────────────────────────────────┘
```

## What You Have

- ✅ **Domain**: `hexaequo.com` → GitHub Pages (frontend)
- ✅ **Frontend**: GitHub Pages (free, automatic deployment)
- ✅ **Backend**: Render.com (free tier, Node.js + SQLite)

---

## Step 1: Deploy the Backend on Render.com

### 1.1 Create a Render Account
1. Go to https://render.com
2. Sign up with your GitHub account (recommended for easy repo connection)

### 1.2 Create a New Web Service
1. From your Render dashboard, click **New +** → **Web Service**
2. Select **Build and deploy from a Git repository** → **Next**
3. Connect your GitHub repository: `Hexaequo-AI`
4. Click **Connect** next to the repository

### 1.3 Configure the Service

Fill in the following settings:

| Setting | Value |
|---------|-------|
| **Name** | `hexaequo-server` |
| **Region** | `Frankfurt (EU Central)` or closest to your users |
| **Branch** | `main` (or your branch name) |
| **Root Directory** | `server` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` |

### 1.4 Add Environment Variables

Scroll down to **Environment Variables** and add:

| Key | Value |
|-----|-------|
| `FRONTEND_URL` | `https://hexaequo.com` |
| `NODE_ENV` | `production` |

> ⚠️ **Note**: On the free tier, the SQLite database is stored in ephemeral storage. Data persists between requests but is cleared when the server restarts (typically after ~15 min of inactivity). This is acceptable since games are short-lived.

### 1.5 Deploy

1. Click **Create Web Service**
2. Wait for the build to complete (2-3 minutes)
3. Your server URL will be: `https://hexaequo-server.onrender.com`

### 1.6 Verify the Server is Running

Visit: `https://hexaequo-server.onrender.com/health`

You should see:
```json
{"status":"ok","rooms":0,"players":0}
```

---

## Step 2: Update Frontend Configuration (If Needed)

The frontend is already configured to use `https://hexaequo-server.onrender.com` in production.

Verify in `hexaequo-v2/multiplayer.js` (line 11-13):
```javascript
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://localhost:${BACKEND_PORT}`
    : 'https://hexaequo-server.onrender.com';
```

This automatically uses:
- `http://localhost:3000` when developing locally
- `https://hexaequo-server.onrender.com` when accessed from `hexaequo.com`

---

## Step 3: Deploy Frontend to GitHub Pages

### 3.1 Commit and Push All Changes

```bash
git add .
git commit -m "Production deployment"
git push origin main
```

### 3.2 Verify GitHub Pages

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Pages**
3. Ensure it's set to deploy from your branch (e.g., `main`)
4. Your site should be live at `https://hexaequo.com`

---

## Step 4: Test Production Deployment

### 4.1 Test the Connection
1. Go to `https://hexaequo.com`
2. Click **Play Online**
3. Wait for "Connected to server" (may take 30-50 seconds on first visit due to cold start)

### 4.2 Test a Full Game
1. Open two browser windows (or use two devices)
2. **Window 1**: Create an account or play as guest → Create Room
3. **Window 2**: Create an account or play as guest → Join the room from the list
4. Play a few moves to verify:
   - ✅ Moves sync between players
   - ✅ Timer works (if enabled)
   - ✅ Resign/Draw features work
   - ✅ ELO updates after game (for logged-in users with timer)

---

## Free Tier Considerations

### Render Free Tier Limitations

| Aspect | Behavior |
|--------|----------|
| **Cold Start** | Server sleeps after 15 min of inactivity. First connection takes 30-50 seconds. |
| **Compute Hours** | 750 hours/month free (plenty for a hobby project) |
| **Database** | SQLite stored in memory - data survives requests but clears on restart |
| **Bandwidth** | 100 GB/month |

### How the App Handles These Limitations

1. **Cold Start**: The UI shows "Connecting to server..." while waiting
2. **Database Reset**: 
   - Game rooms are short-lived anyway (24-hour auto-cleanup)
   - User accounts persist because users re-authenticate on each session
   - ELO ratings are stored per-user and persist across active sessions

---

## Upgrading for Better Performance

If you need faster response times (no cold starts):

### Option 1: Render Starter ($7/month)
- Same setup, just change instance type
- No sleep, instant response
- More memory

### Option 2: Railway.app
- Similar to Render
- $5 free credit/month
- No cold starts on paid tier

### Option 3: Fly.io
- Good global latency
- Generous free tier
- Slightly more complex setup

### For Persistent Database (if needed later)
- **Turso**: SQLite-compatible edge database (free tier available)
- **PlanetScale**: MySQL (free tier available)
- **Supabase**: PostgreSQL (free tier available)

---

## Troubleshooting

### "Connecting to server..." takes forever
- **First visit after inactivity**: Normal, wait 30-50 seconds for cold start
- **Check Render dashboard**: Make sure the service is deployed and not failed
- **Check browser console**: Look for CORS errors or connection failures

### "Failed to connect to server"
- Server might be deploying/restarting
- Check https://hexaequo-server.onrender.com/health
- Verify CORS settings in server.js include your domain

### Moves not syncing
- Check network connection
- Look at browser console for errors
- Check Render logs in the dashboard

### Login/Register not working
- Check browser console for errors
- Verify the server is responding to `/api/auth/*` endpoints
- Test: `curl https://hexaequo-server.onrender.com/health`

---

## Local Development

### Run Backend Locally
```bash
cd server
npm install
npm start
# Server runs on http://localhost:3000
```

### Run Frontend Locally
```bash
cd hexaequo-v2
npx serve .
# Or: python -m http.server 8080
# Frontend runs on http://localhost:8080
```

### Test Locally
1. Open http://localhost:8080 in two browser windows
2. Play Online → Create Room (window 1)
3. Play Online → Join Room (window 2)
4. Play!

---

## Deployment Checklist

- [ ] Create Render account (sign up with GitHub)
- [ ] Create Web Service with Root Directory: `server`
- [ ] Set environment variables: `FRONTEND_URL=https://hexaequo.com`, `NODE_ENV=production`
- [ ] Wait for deployment to complete (~2-3 minutes)
- [ ] Test `/health` endpoint returns OK
- [ ] Commit and push all frontend changes to GitHub
- [ ] Wait for GitHub Pages to deploy (~1-2 minutes)
- [ ] Test full multiplayer game on https://hexaequo.com
- [ ] 🎉 **You're live!**
