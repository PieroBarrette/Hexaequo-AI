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

// Initialize Express
const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
    origin: [FRONTEND_URL, 'http://localhost:8080', 'http://127.0.0.1:8080'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Rate limiting
app.use('/api/', apiLimiter);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/ai', aiRoutes);

// 404 handler
app.use((req, res, next) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`
    });
});

// Global error handler
app.use(errorHandler);

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO
const { initializeSocket } = require('./socket/socketHandler');
const io = initializeSocket(httpServer);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
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
    httpServer.listen(PORT, () => {
        console.log(`\n🎮 Hexaequo Backend Server running on port ${PORT}`);
        console.log(`   Environment: ${NODE_ENV}`);
        console.log(`   Frontend URL: ${FRONTEND_URL}`);
        console.log(`   WebSocket: enabled`);
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
