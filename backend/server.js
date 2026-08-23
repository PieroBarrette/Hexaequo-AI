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
const gameRoutes = require('./routes/gameRoutes');
const roomRoutes = require('./routes/roomRoutes');
const aiRoutes = require('./routes/aiRoutes');
const adminRoutes = require('./routes/adminRoutes');
const matchmakingRoutes = require('./routes/matchmakingRoutes');
const profileRoutes = require('./routes/profileRoutes');

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
    'http://127.0.0.1:5500'
];

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false // Disable for admin interface
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

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/matchmaking', matchmakingRoutes);
// Records, game history and replays.
app.use('/api/profile', profileRoutes);

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

console.log('✅ Socket.IO initialized on server');

// Debug: Log Socket.IO engine events
if (io.engine) {
    io.engine.on('connection_error', (err) => {
        console.error('[SOCKET.IO ENGINE ERROR]', err.req ? `${err.req.method} ${err.req.url}` : err.message, 'Code:', err.code);
    });
    console.log('✅ Socket.IO engine listeners attached');
}

// Debug: Log all incoming requests in production
app.use((req, res, next) => {
    console.log(`[DEBUG] ${req.method} ${req.path}`);
    next();
});

// Static file serving AFTER Socket.IO (only if frontend exists)
const frontendPath = path.join(__dirname, '../web');
const fs = require('fs');
if (fs.existsSync(frontendPath)) {
    console.log(`✅ Frontend folder found at: ${frontendPath}`);
    app.use(express.static(frontendPath));
} else {
    console.log(`⚠️  Frontend folder NOT found at: ${frontendPath} (backend-only mode)`);
}

// 404 handler for API routes only (before SPA fallback)
app.use('/api/*', (req, res, next) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`
    });
});

// SPA fallback - serve index.html for all non-API routes (LAST middleware)
app.get('*', (req, res, next) => {
    // Don't intercept API, socket.io, or health routes
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path === '/health' || req.path === '/healthz') {
        return next();
    }
    const indexPath = path.join(__dirname, '../web/index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        // Backend-only mode: no frontend to serve
        res.status(404).json({ error: 'Frontend not deployed on this server', path: req.path });
    }
});

// Error handler middleware (must be after all routes)
app.use(errorHandler);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
const startServer = () => {
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
