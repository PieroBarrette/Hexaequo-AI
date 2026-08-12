/**
 * The Socket.IO server itself: transport configuration only, no game logic.
 *
 * Split out of the former socketHandler.js so that the legacy relay protocol
 * could be deleted without taking the socket server with it. Game behaviour
 * lives in onlineGame.js.
 */

const { Server } = require('socket.io');
const { FRONTEND_URL } = require('../config/env');

/** Origins allowed to open a socket. The app is normally same-origin. */
function allowedOrigins() {
    return [
        FRONTEND_URL,
        'https://hexaequo.com',
        'https://www.hexaequo.com',
        'http://hexaequo.com',
        'http://www.hexaequo.com',
        'https://hexaequo-server.onrender.com',
        // Local development: the app can also be served by serve.py.
        'http://localhost:8001',
        'http://localhost:8080',
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:8001',
        'http://127.0.0.1:8080',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
    ].filter(Boolean);
}

function createSocketServer(httpServer) {
    const origins = allowedOrigins();

    const io = new Server(httpServer, {
        path: '/socket.io/',
        cors: {
            origin: origins,
            methods: ['GET', 'POST'],
            credentials: true,
            allowedHeaders: ['Content-Type', 'Authorization'],
        },
        // Polling as a fallback where websockets are blocked.
        transports: ['polling', 'websocket'],
        allowUpgrades: true,
        // Render can be slow to wake; be patient before declaring a client gone.
        pingTimeout: 120000,
        pingInterval: 25000,
        // Serve the client library at /socket.io/socket.io.js. The web app has
        // no build step and loads it from there, which also guarantees the
        // client and server versions can never drift apart.
        serveClient: true,
    });

    console.log(`✅ Socket.IO ready on ${io.path()} — ${origins.length} allowed origins`);
    return io;
}

module.exports = { createSocketServer, allowedOrigins };
