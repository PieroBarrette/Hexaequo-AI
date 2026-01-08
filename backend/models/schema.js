/**
 * Database Schema - PostgreSQL Tables
 * 
 * Run this script to create all database tables.
 * Usage: node backend/models/schema.js
 */

const { query } = require('../config/database');

const schema = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Users Table
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    pseudo VARCHAR(30) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    verification_token VARCHAR(255),
    verification_expires TIMESTAMP,
    reset_token VARCHAR(255),
    reset_expires TIMESTAMP,
    
    -- ELO Ratings per time control (default 1000 as of Phase 0)
    elo_classic INTEGER DEFAULT 1000,
    elo_rapid INTEGER DEFAULT 1000,
    elo_blitz INTEGER DEFAULT 1000,
    
    -- Statistics
    games_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    
    -- Settings (stored as JSON)
    settings JSONB DEFAULT '{"theme": "dark", "sounds": true, "animations": true, "showValidMoves": false, "showPreviousMove": true}'::jsonb,
    
    -- Profile
    avatar_url VARCHAR(500),
    country_code VARCHAR(2),
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_pseudo ON users(pseudo);
CREATE INDEX IF NOT EXISTS idx_users_elo_classic ON users(elo_classic DESC);
CREATE INDEX IF NOT EXISTS idx_users_elo_rapid ON users(elo_rapid DESC);
CREATE INDEX IF NOT EXISTS idx_users_elo_blitz ON users(elo_blitz DESC);

-- ============================================
-- Rooms Table (Lobby/Matchmaking)
-- ============================================
CREATE TABLE IF NOT EXISTS rooms (
    code VARCHAR(4) PRIMARY KEY,
    
    -- Host player
    host_id UUID REFERENCES users(id) ON DELETE SET NULL,
    host_socket_id VARCHAR(255),
    host_pseudo VARCHAR(30),
    
    -- Guest player
    guest_id UUID REFERENCES users(id) ON DELETE SET NULL,
    guest_socket_id VARCHAR(255),
    guest_pseudo VARCHAR(30),
    
    -- Room settings
    time_mode VARCHAR(20) DEFAULT 'none', -- none, classic, rapid, blitz
    allow_spectators BOOLEAN DEFAULT TRUE,
    
    -- Status: waiting, playing, finished
    status VARCHAR(20) DEFAULT 'waiting',
    
    -- Current game state (JSON)
    game_state JSONB,
    active_player VARCHAR(10) DEFAULT 'black',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_time_mode ON rooms(time_mode);
CREATE INDEX IF NOT EXISTS idx_rooms_created ON rooms(created_at DESC);

-- ============================================
-- Games Table (Completed Games)
-- ============================================
CREATE TABLE IF NOT EXISTS games (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(4),
    
    -- Players
    black_player_id UUID REFERENCES users(id) ON DELETE SET NULL,
    black_pseudo VARCHAR(30),
    black_elo_before INTEGER,
    black_elo_after INTEGER,
    
    white_player_id UUID REFERENCES users(id) ON DELETE SET NULL,
    white_pseudo VARCHAR(30),
    white_elo_before INTEGER,
    white_elo_after INTEGER,
    
    -- Game settings
    time_mode VARCHAR(20),
    
    -- Result
    winner VARCHAR(10), -- black, white, draw, null (in progress)
    result_reason VARCHAR(50), -- capture, timeout, resignation, draw_agreement, disconnect
    
    -- Final state (JSON)
    final_state JSONB,
    
    -- Timestamps
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_games_black_player ON games(black_player_id);
CREATE INDEX IF NOT EXISTS idx_games_white_player ON games(white_player_id);
CREATE INDEX IF NOT EXISTS idx_games_finished ON games(finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_time_mode ON games(time_mode);

-- ============================================
-- Moves Table (Move History for Replays)
-- ============================================
CREATE TABLE IF NOT EXISTS moves (
    id SERIAL PRIMARY KEY,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE,
    move_number INTEGER NOT NULL,
    player VARCHAR(10) NOT NULL, -- black or white
    
    -- Move data
    move_type VARCHAR(20) NOT NULL, -- tile, disc, ring, move, jump
    from_q INTEGER,
    from_r INTEGER,
    to_q INTEGER NOT NULL,
    to_r INTEGER NOT NULL,
    
    -- Captures (for jumps)
    captures JSONB, -- [{q, r, type}]
    
    -- State after move (for replay)
    state_snapshot JSONB,
    
    -- Timing
    time_remaining_black INTEGER, -- milliseconds
    time_remaining_white INTEGER,
    move_time INTEGER, -- time taken for this move
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_moves_game ON moves(game_id);
CREATE INDEX IF NOT EXISTS idx_moves_game_number ON moves(game_id, move_number);

-- ============================================
-- Saved Replays Table
-- ============================================
CREATE TABLE IF NOT EXISTS saved_replays (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE,
    saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_replays_user ON saved_replays(user_id);

-- ============================================
-- Refresh Tokens Table
-- ============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- ============================================
-- ELO History Table
-- ============================================
CREATE TABLE IF NOT EXISTS elo_history (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE,
    time_mode VARCHAR(20) NOT NULL,
    elo_before INTEGER NOT NULL,
    elo_after INTEGER NOT NULL,
    elo_change INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_elo_history_user ON elo_history(user_id);
CREATE INDEX IF NOT EXISTS idx_elo_history_user_mode ON elo_history(user_id, time_mode);

-- ============================================
-- Spectators Table
-- ============================================
CREATE TABLE IF NOT EXISTS spectators (
    id SERIAL PRIMARY KEY,
    room_code VARCHAR(4) REFERENCES rooms(code) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    socket_id VARCHAR(255) NOT NULL,
    pseudo VARCHAR(30),
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_spectators_room ON spectators(room_code);

-- ============================================
-- Helper Functions
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_rooms_updated_at ON rooms;
CREATE TRIGGER update_rooms_updated_at
    BEFORE UPDATE ON rooms
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Cleanup Functions
-- ============================================

-- Function to clean up old rooms
CREATE OR REPLACE FUNCTION cleanup_old_rooms()
RETURNS void AS $$
BEGIN
    DELETE FROM rooms WHERE updated_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired tokens
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM refresh_tokens WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
`;

/**
 * Run schema creation
 */
async function createSchema() {
    console.log('Creating database schema...');
    
    try {
        // Execute entire schema at once (PostgreSQL handles multiple statements)
        await query(schema);
        
        console.log('Database schema created successfully!');
    } catch (error) {
        console.error('Error creating schema:', error.message);
        throw error;
    }
}

/**
 * Drop all tables (use with caution!)
 */
async function dropSchema() {
    console.log('Dropping database schema...');
    
    const dropStatements = `
        DROP TABLE IF EXISTS spectators CASCADE;
        DROP TABLE IF EXISTS elo_history CASCADE;
        DROP TABLE IF EXISTS refresh_tokens CASCADE;
        DROP TABLE IF EXISTS saved_replays CASCADE;
        DROP TABLE IF EXISTS moves CASCADE;
        DROP TABLE IF EXISTS games CASCADE;
        DROP TABLE IF EXISTS rooms CASCADE;
        DROP TABLE IF EXISTS users CASCADE;
        DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
        DROP FUNCTION IF EXISTS cleanup_old_rooms CASCADE;
        DROP FUNCTION IF EXISTS cleanup_expired_tokens CASCADE;
    `;
    
    try {
        await query(dropStatements);
        console.log('Database schema dropped successfully!');
    } catch (error) {
        console.error('Error dropping schema:', error.message);
        throw error;
    }
}

// Run if executed directly
if (require.main === module) {
    const arg = process.argv[2];
    
    if (arg === 'drop') {
        dropSchema()
            .then(() => process.exit(0))
            .catch(() => process.exit(1));
    } else {
        createSchema()
            .then(() => process.exit(0))
            .catch(() => process.exit(1));
    }
}

module.exports = { createSchema, dropSchema };
