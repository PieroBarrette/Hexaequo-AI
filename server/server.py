"""
Hexaequo Online Multiplayer Server (Python Version)

A WebSocket server for real-time multiplayer gameplay using Socket.IO protocol.
Uses SQLite for persistent game state storage.
"""

import asyncio
import json
import sqlite3
import random
import string
import time
from pathlib import Path

try:
    import socketio
    from aiohttp import web
except ImportError:
    print("Required packages not installed. Installing...")
    import subprocess
    import sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "python-socketio", "aiohttp"])
    import socketio
    from aiohttp import web

# Configuration
PORT = 3000
DB_PATH = Path(__file__).parent / "hexaequo.db"

# Initialize Socket.IO server with CORS
sio = socketio.AsyncServer(
    async_mode='aiohttp',
    cors_allowed_origins=['http://localhost:8080', 'http://127.0.0.1:8080', 'https://hexaequo.com']
)
app = web.Application()
sio.attach(app)

# Database setup
def init_db():
    """Initialize the SQLite database with required tables."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS rooms (
            room_code TEXT PRIMARY KEY,
            black_player_id TEXT,
            white_player_id TEXT,
            game_state TEXT,
            active_player TEXT DEFAULT 'black',
            created_at REAL,
            updated_at REAL,
            status TEXT DEFAULT 'waiting'
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS players (
            player_id TEXT PRIMARY KEY,
            socket_id TEXT,
            room_code TEXT,
            color TEXT,
            connected INTEGER DEFAULT 1,
            last_seen REAL
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db():
    """Get a database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def generate_room_code():
    """Generate a random 4-character alphanumeric room code."""
    chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  # Excluding confusing chars (0,O,1,I)
    return ''.join(random.choice(chars) for _ in range(4))

def get_unique_room_code():
    """Generate a unique room code that doesn't exist in the database."""
    conn = get_db()
    cursor = conn.cursor()
    
    for _ in range(100):
        code = generate_room_code()
        cursor.execute('SELECT room_code FROM rooms WHERE room_code = ?', (code,))
        if not cursor.fetchone():
            conn.close()
            return code
    
    conn.close()
    raise Exception("Failed to generate unique room code")

def get_initial_game_state():
    """Return the initial game state for a new game."""
    return {
        'tiles': {
            '0,0': 'black', '1,0': 'black', '0,1': 'black',
            '-1,0': 'white', '0,-1': 'white', '-1,1': 'white'
        },
        'pieces': {
            '1,0': {'type': 'disc', 'color': 'black'},
            '0,1': {'type': 'disc', 'color': 'black'},
            '-1,0': {'type': 'disc', 'color': 'white'},
            '0,-1': {'type': 'disc', 'color': 'white'}
        },
        'inventory': {
            'black': {'tiles': 7, 'discs': 5, 'rings': 3},
            'white': {'tiles': 7, 'discs': 5, 'rings': 3}
        },
        'captured': {
            'black_discs': 0, 'black_rings': 0,
            'white_discs': 0, 'white_rings': 0
        },
        'activePlayer': 'black'
    }

# Cleanup old rooms periodically
async def cleanup_old_data():
    """Remove rooms and players older than 24 hours."""
    while True:
        await asyncio.sleep(3600)  # Every hour
        try:
            conn = get_db()
            cursor = conn.cursor()
            cutoff = time.time() - 86400  # 24 hours ago
            cursor.execute('DELETE FROM rooms WHERE updated_at < ?', (cutoff,))
            cursor.execute('DELETE FROM players WHERE last_seen < ?', (cutoff,))
            conn.commit()
            conn.close()
            print("Cleaned up old rooms and players")
        except Exception as e:
            print(f"Cleanup error: {e}")

# Socket.IO event handlers
@sio.event
async def connect(sid, environ):
    print(f"Client connected: {sid}")

@sio.event
async def disconnect(sid):
    print(f"Client disconnected: {sid}")
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Find the player
        cursor.execute('SELECT * FROM players WHERE socket_id = ?', (sid,))
        player = cursor.fetchone()
        
        if player:
            # Mark as disconnected
            cursor.execute('UPDATE players SET connected = 0, last_seen = ? WHERE socket_id = ?',
                          (time.time(), sid))
            conn.commit()
            
            # Notify opponent
            await sio.emit('opponent-disconnected', room=player['room_code'], skip_sid=sid)
            print(f"Player {player['player_id']} disconnected from room {player['room_code']}")
        
        conn.close()
    except Exception as e:
        print(f"Disconnect error: {e}")

@sio.event
async def create_room(sid, data):
    """Create a new game room."""
    try:
        player_id = data.get('playerId')
        room_code = get_unique_room_code()
        initial_state = get_initial_game_state()
        now = time.time()
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Create room
        cursor.execute('''
            INSERT INTO rooms (room_code, black_player_id, game_state, status, created_at, updated_at)
            VALUES (?, ?, ?, 'waiting', ?, ?)
        ''', (room_code, player_id, json.dumps(initial_state), now, now))
        
        # Create player
        cursor.execute('''
            INSERT OR REPLACE INTO players (player_id, socket_id, room_code, color, connected, last_seen)
            VALUES (?, ?, ?, 'black', 1, ?)
        ''', (player_id, sid, room_code, now))
        
        conn.commit()
        conn.close()
        
        # Join socket room
        sio.enter_room(sid, room_code)
        
        print(f"Room {room_code} created by player {player_id}")
        
        # Send response back to client
        await sio.emit('create-room-response', {
            'success': True,
            'roomCode': room_code,
            'color': 'black',
            'gameState': initial_state,
            'waiting': True
        }, to=sid)
    except Exception as e:
        print(f"Create room error: {e}")
        await sio.emit('create-room-response', {'success': False, 'error': str(e)}, to=sid)

@sio.event
async def join_room(sid, data):
    """Join an existing game room."""
    try:
        room_code = data.get('roomCode', '').upper()
        player_id = data.get('playerId')
        now = time.time()
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Get room
        cursor.execute('SELECT * FROM rooms WHERE room_code = ?', (room_code,))
        room = cursor.fetchone()
        
        if not room:
            conn.close()
            await sio.emit('join-room-response', {'success': False, 'error': 'Room not found'}, to=sid)
            return
        
        # Check if player is reconnecting
        cursor.execute('SELECT * FROM players WHERE player_id = ? AND room_code = ?', 
                      (player_id, room_code))
        existing_player = cursor.fetchone()
        
        if existing_player:
            # Reconnecting to same room
            cursor.execute('UPDATE players SET socket_id = ?, connected = 1, last_seen = ? WHERE player_id = ?',
                          (sid, now, player_id))
            conn.commit()
            
            sio.enter_room(sid, room_code)
            
            # Notify opponent of reconnection
            await sio.emit('opponent-reconnected', room=room_code, skip_sid=sid)
            
            game_state = json.loads(room['game_state'])
            
            print(f"Player {player_id} reconnected to room {room_code}")
            conn.close()
            
            await sio.emit('join-room-response', {
                'success': True,
                'roomCode': room_code,
                'color': existing_player['color'],
                'gameState': game_state,
                'reconnected': True,
                'opponentConnected': room['status'] == 'playing'
            }, to=sid)
            return
        
        # Check if room is full
        if room['status'] == 'playing':
            conn.close()
            await sio.emit('join-room-response', {'success': False, 'error': 'Room is full'}, to=sid)
            return
        
        # Join as white player
        cursor.execute('UPDATE rooms SET white_player_id = ?, status = ?, updated_at = ? WHERE room_code = ?',
                      (player_id, 'playing', now, room_code))
        
        cursor.execute('''
            INSERT OR REPLACE INTO players (player_id, socket_id, room_code, color, connected, last_seen)
            VALUES (?, ?, ?, 'white', 1, ?)
        ''', (player_id, sid, room_code, now))
        
        conn.commit()
        
        sio.enter_room(sid, room_code)
        
        game_state = json.loads(room['game_state'])
        
        # Notify black player that opponent joined
        await sio.emit('opponent-joined', {'gameState': game_state}, room=room_code, skip_sid=sid)
        
        print(f"Player {player_id} joined room {room_code} as white")
        conn.close()
        
        await sio.emit('join-room-response', {
            'success': True,
            'roomCode': room_code,
            'color': 'white',
            'gameState': game_state,
            'waiting': False
        }, to=sid)
    except Exception as e:
        print(f"Join room error: {e}")
        await sio.emit('join-room-response', {'success': False, 'error': str(e)}, to=sid)

@sio.event
async def make_move(sid, data):
    """Handle a player making a move."""
    try:
        room_code = data.get('roomCode')
        player_id = data.get('playerId')
        game_state = data.get('gameState')
        previous_state = data.get('previousState')
        now = time.time()
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Get room
        cursor.execute('SELECT * FROM rooms WHERE room_code = ?', (room_code,))
        room = cursor.fetchone()
        
        if not room:
            conn.close()
            await sio.emit('make-move-response', {'success': False, 'error': 'Room not found'}, to=sid)
            return
        
        # Get player
        cursor.execute('SELECT * FROM players WHERE player_id = ? AND room_code = ?',
                      (player_id, room_code))
        player = cursor.fetchone()
        
        if not player:
            conn.close()
            await sio.emit('make-move-response', {'success': False, 'error': 'Invalid player'}, to=sid)
            return
        
        # Verify it's the player's turn
        current_state = json.loads(room['game_state'])
        if current_state['activePlayer'] != player['color']:
            conn.close()
            await sio.emit('make-move-response', {'success': False, 'error': 'Not your turn'}, to=sid)
            return
        
        # Update game state in database
        cursor.execute('UPDATE rooms SET game_state = ?, active_player = ?, updated_at = ? WHERE room_code = ?',
                      (json.dumps(game_state), game_state['activePlayer'], now, room_code))
        conn.commit()
        conn.close()
        
        # Broadcast move to opponent
        await sio.emit('opponent-moved', 
                      {'gameState': game_state, 'previousState': previous_state},
                      room=room_code, skip_sid=sid)
        
        print(f"Move in room {room_code} by {player['color']}")
        
        await sio.emit('make-move-response', {'success': True}, to=sid)
    except Exception as e:
        print(f"Move error: {e}")
        await sio.emit('make-move-response', {'success': False, 'error': str(e)}, to=sid)

@sio.event
async def leave_room(sid, data):
    """Handle a player leaving the room."""
    try:
        room_code = data.get('roomCode')
        player_id = data.get('playerId')
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Remove player
        cursor.execute('DELETE FROM players WHERE player_id = ?', (player_id,))
        
        # Check remaining players
        cursor.execute('SELECT COUNT(*) as count FROM players WHERE room_code = ?', (room_code,))
        result = cursor.fetchone()
        
        if result['count'] == 0:
            # No players left, delete room
            cursor.execute('DELETE FROM rooms WHERE room_code = ?', (room_code,))
            print(f"Room {room_code} deleted - no players remaining")
        else:
            # Notify remaining player
            await sio.emit('opponent-left', room=room_code, skip_sid=sid)
        
        conn.commit()
        conn.close()
        
        sio.leave_room(sid, room_code)
        print(f"Player {player_id} left room {room_code}")
        
        await sio.emit('leave-room-response', {'success': True}, to=sid)
    except Exception as e:
        print(f"Leave room error: {e}")
        await sio.emit('leave-room-response', {'success': False, 'error': str(e)}, to=sid)

@sio.event
async def room_status(sid, data):
    """Get the status of a room."""
    try:
        room_code = data.get('roomCode')
        
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM rooms WHERE room_code = ?', (room_code,))
        room = cursor.fetchone()
        
        if not room:
            conn.close()
            return {'success': False, 'error': 'Room not found'}
        
        cursor.execute('SELECT color, connected FROM players WHERE room_code = ?', (room_code,))
        players = cursor.fetchall()
        
        conn.close()
        
        return {
            'success': True,
            'status': room['status'],
            'players': [{'color': p['color'], 'connected': bool(p['connected'])} for p in players],
            'gameState': json.loads(room['game_state'])
        }
    except Exception as e:
        print(f"Room status error: {e}")
        return {'success': False, 'error': str(e)}

# HTTP routes
async def health_check(request):
    """Health check endpoint."""
    return web.json_response({'status': 'ok', 'timestamp': time.time()})

async def room_info(request):
    """Get room info (for debugging)."""
    room_code = request.match_info.get('code', '').upper()
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM rooms WHERE room_code = ?', (room_code,))
    room = cursor.fetchone()
    
    if not room:
        conn.close()
        return web.json_response({'error': 'Room not found'}, status=404)
    
    cursor.execute('SELECT color, connected FROM players WHERE room_code = ?', (room_code,))
    players = cursor.fetchall()
    
    conn.close()
    
    return web.json_response({
        'roomCode': room['room_code'],
        'status': room['status'],
        'activePlayer': room['active_player'],
        'players': [{'color': p['color'], 'connected': bool(p['connected'])} for p in players]
    })

# Add routes
app.router.add_get('/health', health_check)
app.router.add_get('/room/{code}', room_info)

# Main entry point
async def main():
    """Start the server."""
    init_db()
    
    # Start cleanup task
    asyncio.create_task(cleanup_old_data())
    
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', PORT)
    await site.start()
    
    print(f"=" * 50)
    print(f"Hexaequo Server running on http://localhost:{PORT}")
    print(f"Accepting connections from localhost:8080")
    print(f"=" * 50)
    
    # Keep running
    while True:
        await asyncio.sleep(3600)

if __name__ == '__main__':
    asyncio.run(main())
