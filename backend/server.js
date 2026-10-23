/**
 * Hexaequo Backend Server
 * 
 * Main entry point for the REST API backend.
 * Handles authentication, user management, game history, and ratings.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { createServer } = require('http');
const path = require('path');

// Import configuration
const { PORT, FRONTEND_URL, NODE_ENV } = require('./config/env');
const { apiLimiter } = require('./config/rateLimit');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const profileRoutes = require('./routes/profileRoutes');
const pushRoutes = require('./routes/pushRoutes');
const { siteRoutes } = require('./routes/siteRoutes');

// Initialize Express
const app = express();

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
    FRONTEND_URL,
    'https://hexaequo.com',
    'https://www.hexaequo.com',
    'http://hexaequo.com',
    'http://www.hexaequo.com',
    'https://hexaequo-server.onrender.com',
    'https://pierobarrette.github.io',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    // The dev static servers: serve.py on 8001, http.server on 8765. net.js
    // already points them at this port; they were missing from the other end.
    'http://localhost:8001',
    'http://127.0.0.1:8001',
    'http://localhost:8765',
    'http://127.0.0.1:8765'
];

/*
 * Security headers, Content-Security-Policy included.
 *
 * It used to be off — "for the admin interface", whose inline styles it would
 * have flagged. That traded the whole site's main defence against cross-site
 * scripting for one page's convenience, and the site carries user-written text:
 * pseudonyms, lobby chat. The admin page is gated behind an env flag now and
 * off in production, so it no longer gets a vote.
 *
 * script-src carries no 'unsafe-inline': every script is a file this server
 * serves, and nothing runs from an attribute or a <script> smuggled into a
 * name. style-src has to allow inline, since the views set style="" through
 * innerHTML in many places; a style is a far smaller thing to hand an attacker
 * than a script. Nothing is loaded from anywhere else: since Google sign-in
 * went, the app talks only to itself — in production one origin serves both
 * the page and the socket.
 */
const CSP = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    frameSrc: ["'self'"],
    frameAncestors: ["'self'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    objectSrc: ["'none'"],
    upgradeInsecureRequests: [],
};

// Security middleware
app.use(helmet({
    contentSecurityPolicy: { useDefaults: true, directives: CSP },
    // As it has always been; nothing here asks for cross-origin isolation.
    crossOriginEmbedderPolicy: false,
}));
app.use(cors({
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Trust proxy (required for express-rate-limit behind Render/reverse proxy)
app.set('trust proxy', 1);

// Rate limiting
app.use('/api/', apiLimiter);

// Health check (both /health and /healthz for Render.com compatibility)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.get('/healthz', (req, res) => {
    res.status(200).send('OK');
});

/*
 * API Routes
 *
 * Rooms, quick match, the lobby and challenges are not here: online play is
 * the socket's (socket/*.js, the hx:* events). The REST routes the previous
 * front end used for them -- /api/rooms, /api/matchmaking, /api/games and an
 * /api/ai placeholder -- were removed on 2026-10-23, with the services behind
 * them. Nothing called them any more, and they had come apart: one database
 * error switched their services for good to an empty in-memory store, and the
 * room links they handed out led to a 404.
 */
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
/*
 * The admin console runs SQL and is off unless someone deliberately turns it
 * on. It is a database shell reachable over the public internet — the single
 * biggest way for the data to come to harm — so it does not sit there waiting.
 * Set ENABLE_ADMIN=1 on the host to bring it up for as long as it is needed,
 * and clear it after. Off, the routes below simply do not exist, and a scanner
 * knocking on /api/admin gets the same 404 as any other made-up path.
 */
const adminEnabled = process.env.ENABLE_ADMIN === '1' || process.env.ENABLE_ADMIN === 'true';
if (adminEnabled) {
    app.use('/api/admin', adminRoutes);
    console.log('⚠️  Admin console ENABLED at /api/admin — turn ENABLE_ADMIN off when done');
} else {
    console.log('🔒 Admin console disabled (set ENABLE_ADMIN=1 to enable)');
}
// Records, game history and replays.
app.use('/api/profile', profileRoutes);
// Notifications: the key browsers subscribe with, and their subscriptions.
app.use('/api/push', pushRoutes);

// Create HTTP server with Express app FIRST
const httpServer = createServer(app);

// Initialize Socket.IO - MUST be done before adding more middlewares
const { createSocketServer } = require('./socket/io');
const io = createSocketServer(httpServer);

// Authoritative online games (hx:* events): clients send move intents and the
// server owns the position.
const { attachOnlineGames } = require('./socket/onlineGame');
attachOnlineGames(io);

// Quick match: pairing by rating band (hx:queue*). Attached after the game
// handlers so a socket is already identified by the time it queues.
const { attachMatchmaking } = require('./socket/matchmaking');
attachMatchmaking(io);

// The lobby: presence, chat and challenges by name (hx:lobby*, hx:challenge*).
const { attachLobby } = require('./socket/lobby');
attachLobby(io);

// Whether each connection's page is on screen, which decides whether news
// goes to it or to the person's phone.
const { attachNotifications } = require('./socket/notify');
attachNotifications(io);

console.log('✅ Socket.IO initialized on server');

// Debug: Log Socket.IO engine events
if (io.engine) {
    io.engine.on('connection_error', (err) => {
        console.error('[SOCKET.IO ENGINE ERROR]', err.req ? `${err.req.method} ${err.req.url}` : err.message, 'Code:', err.code);
    });
    console.log('✅ Socket.IO engine listeners attached');
}

/*
 * Request logging, off unless asked for.
 *
 * This once logged every request unconditionally, which on a public server
 * means logging every vulnerability scanner's march through a wordlist of PHP
 * filenames — pages of /wp-login.php and /c99.php that say nothing about this
 * app, which serves no PHP. The noise buried anything worth reading. Set
 * DEBUG_HTTP=1 to bring it back while chasing something.
 */
if (process.env.DEBUG_HTTP === '1') {
    app.use((req, res, next) => {
        console.log(`[HTTP] ${req.method} ${req.path}`);
        next();
    });
}

// Static file serving AFTER Socket.IO (only if frontend exists)
const frontendPath = path.join(__dirname, '../web');
const fs = require('fs');

/*
 * The build stamp, computed from what is actually being served.
 *
 * The service worker caches under this name and discards every other cache on
 * activation, so it decides whether an installed app sees a new release. It
 * used to be a constant edited by hand, which is a step that can be forgotten
 * — and was, leaving installed copies on old code with no way to tell. Hashing
 * the files removes the step: change anything and the stamp changes, change
 * nothing and it does not.
 */
function buildStamp() {
    const hash = require('crypto').createHash('sha1');
    const walk = (dir) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!/[.](js|css|json|html|webmanifest)$/.test(entry.name)) continue;
            hash.update(entry.name);
            try { hash.update(fs.readFileSync(full)); } catch { /* unreadable: skip */ }
        }
    };
    walk(path.join(frontendPath, 'src'));
    walk(path.join(frontendPath, 'styles'));
    for (const file of ['index.html', 'manifest.webmanifest', 'sw.js']) {
        const full = path.join(frontendPath, file);
        try { hash.update(fs.readFileSync(full)); } catch { /* not there yet */ }
    }
    return hash.digest('hex').slice(0, 12);
}

const BUILD = fs.existsSync(frontendPath) ? buildStamp() : 'dev';

/* The worker is generated rather than served flat, so its cache name always
   matches the files it is about to cache. Never cached itself: a stale copy of
   this file is a copy that can never learn there is a new one. */
app.get('/sw.js', (req, res, next) => {
    const source = path.join(frontendPath, 'sw.js');
    fs.readFile(source, 'utf8', (error, text) => {
        if (error) return next();
        res.set('Content-Type', 'application/javascript; charset=utf-8');
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Service-Worker-Allowed', '/');
        res.send(text.replace('__BUILD__', `hexaequo-${BUILD}`));
    });
});

/* So the app can show which version it is running, and check for a newer one. */
app.get('/api/version', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ build: BUILD });
});

/* 404 handler for API routes only (before the site). The address is read from
   originalUrl, without its query: inside a handler mounted on '/api/*',
   req.path is what is left after the mount, always "/", so every 404 used to
   say "Route GET / not found" whatever had been asked for. */
app.use('/api/*', (req, res, next) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl.split('?')[0]} not found`
    });
});

if (fs.existsSync(frontendPath)) {
    console.log(`✅ Frontend folder found at: ${frontendPath}`);
} else {
    console.log(`⚠️  Frontend folder NOT found at: ${frontendPath} (backend-only mode)`);
}

/* The app, its files, the pages with an address of their own, and a real 404
   for an address that is none of these (LAST, before the error handler). */
app.use(siteRoutes(frontendPath));

// Error handler middleware (must be after all routes)
app.use(errorHandler);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

/*
 * A default secret in a public repository is not a secret.
 *
 * The config carries fallback values so the app runs on a fresh clone with no
 * setup — fine for a laptop, a loaded gun in production, where the fallback is
 * a string the whole world can read on GitHub and use to sign a token for any
 * account. So production refuses to start on one. Better a failed deploy, with
 * the last good build still serving, than a live site anyone can walk into. The
 * admin password is only asked for when the admin console is actually on.
 */
const KNOWN_DEFAULTS = {
    JWT_SECRET: 'your-secret-key-change-in-production',
    DEBUG_PASSWORD: 'hexadmin2026',
};
function assertSecrets() {
    if (NODE_ENV !== 'production') return;
    const bad = [];
    const jwt = process.env.JWT_SECRET;
    if (!jwt || jwt === KNOWN_DEFAULTS.JWT_SECRET) bad.push('JWT_SECRET');
    if (adminEnabled) {
        const pw = process.env.DEBUG_PASSWORD;
        if (!pw || pw === KNOWN_DEFAULTS.DEBUG_PASSWORD) bad.push('DEBUG_PASSWORD');
    }
    if (bad.length) {
        console.error(`❌ Refusing to start: ${bad.join(', ')} must be set to a real secret `
            + `in production (the built-in default is public). Set it on the host and redeploy.`);
        process.exit(1);
    }
}

// Start server
const startServer = () => {
    assertSecrets();

    // Test database connection (optional - will work without DB in dev)
    (async () => {
        try {
            const { testConnection } = require('./config/database');
            const dbConnected = await testConnection();
            if (dbConnected) {
                console.log('✅ Database connected');
            } else {
                console.log('⚠️  Database not connected (running in memory mode)');
            }
            /* Notifications, once the database has answered: their table is
               made here if this database has never had one, and the
               reminders start looking at the clock. */
            await require('./services/pushService').init();
            require('./services/reminderService').start();
        } catch (dbError) {
            console.log('⚠️  Database not configured (running in memory mode)');
        }
    })();

    // Start HTTP server (synchronous - keeps event loop alive)
    // Listen on 0.0.0.0 to accept connections from all network interfaces
    httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🎮 Hexaequo Backend Server running on port ${PORT}`);
        console.log(`   Environment: ${NODE_ENV}`);
        console.log(`   Frontend URL: ${FRONTEND_URL}`);
        console.log(`   Listening on: 0.0.0.0:${PORT}`);
        console.log(`   Socket.IO initialized: YES`);
        console.log(`   Socket.IO path: /socket.io/`);
        console.log(`   Socket.IO transports: polling, websocket`);
        if (NODE_ENV === 'production') {
            console.log(`   Public URL: https://hexaequo-server.onrender.com`);
            console.log(`   Socket.IO URL: https://hexaequo-server.onrender.com/socket.io/`);
        } else {
            console.log(`   Socket.IO URL: http://localhost:${PORT}/socket.io/`);
        }
        console.log(`   Server is ready and listening...\n`);
    });

    httpServer.on('error', (error) => {
        console.error('Server error:', error);
        if (error.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} is already in use`);
        }
        process.exit(1);
    });
};

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    io.close();
    httpServer.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('\nSIGINT received. Shutting down...');
    io.close();
    httpServer.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

startServer();

module.exports = { app, httpServer, io };
