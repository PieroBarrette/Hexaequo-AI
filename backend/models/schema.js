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
    password_hash VARCHAR(255),                 -- null for accounts that only sign in with Google
    google_id VARCHAR(64) UNIQUE,               -- Google's stable subject identifier
    pseudo_chosen BOOLEAN DEFAULT FALSE,        -- false until the player picks their own
    email_verified BOOLEAN DEFAULT FALSE,
    verification_token VARCHAR(255),
    verification_expires TIMESTAMP,
    reset_token VARCHAR(255),
    reset_expires TIMESTAMP,
    
    -- ELO Rating (single global rating, default 1000)
    elo INTEGER DEFAULT 1000,
    
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
CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);
-- Every sign-in looks the account up by Google subject; only rows that have one
-- are indexed, since most may not.
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;

-- ============================================
-- Rooms Table (Lobby/Matchmaking)
-- ============================================
CREATE TABLE IF NOT EXISTS rooms (
    code VARCHAR(8) PRIMARY KEY,
    
    -- Host player (black)
    host_id UUID REFERENCES users(id) ON DELETE SET NULL,
    host_socket_id VARCHAR(255),
    host_pseudo VARCHAR(30),
    
    -- White player (second player to join)
    white_id UUID REFERENCES users(id) ON DELETE SET NULL,
    white_socket_id VARCHAR(255),
    white_pseudo VARCHAR(30),
    
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
    room_code VARCHAR(8),
    
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

    -- The move itself, exactly as the server applied it, and how it reads.
    -- Everything above is a projection: a multi-jump keeps only its landing
    -- square, so a game cannot be replayed from those columns alone.
    intent JSONB,
    notation VARCHAR(40),
    
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
    elo_before INTEGER NOT NULL,
    elo_after INTEGER NOT NULL,
    elo_change INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_elo_history_user ON elo_history(user_id);

-- ============================================
-- Spectators Table
-- ============================================
CREATE TABLE IF NOT EXISTS spectators (
    id SERIAL PRIMARY KEY,
    room_code VARCHAR(8) REFERENCES rooms(code) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    socket_id VARCHAR(255) NOT NULL,
    pseudo VARCHAR(30),
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_spectators_room ON spectators(room_code);

-- ============================================
-- User Preferences Table (Phase 2 - Matchmaking)
-- ============================================
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    elo_range_min INTEGER DEFAULT -200,
    elo_range_max INTEGER DEFAULT 200,
    allow_friendly_games BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- The whole schema runs as one ordered script, so this function has to exist
-- before the first trigger that calls it. It used to be declared further down,
-- which only worked while an older copy of it survived in the database; a true
-- from-scratch build failed here.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER update_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Matchmaking Queue Table (Phase 2)
-- ============================================
CREATE TABLE IF NOT EXISTS matchmaking_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    socket_id VARCHAR(255) NOT NULL,
    pseudo VARCHAR(50) NOT NULL,
    elo INTEGER NOT NULL,
    time_mode VARCHAR(20) NOT NULL,
    preferences JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_time_mode ON matchmaking_queue(time_mode);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_elo ON matchmaking_queue(elo);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_expires ON matchmaking_queue(expires_at);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_user ON matchmaking_queue(user_id);

-- ============================================
-- Invitations Table (Phase 2)
-- ============================================
CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    creator_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    creator_pseudo VARCHAR(30),
    creator_elo INTEGER,
    room_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code);
CREATE INDEX IF NOT EXISTS idx_invitations_creator ON invitations(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_expires ON invitations(expires_at);

-- ============================================
-- Helper Functions
-- ============================================

-- update_updated_at_column() is declared earlier, before its first use.

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
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM rooms WHERE updated_at < NOW() - INTERVAL '24 hours';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired tokens
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM refresh_tokens WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
`;

/**
 * Run schema creation
 */
/*
 * Columns added after the first release.
 *
 * CREATE TABLE IF NOT EXISTS does nothing to a table that is already there, so
 * new columns need saying twice: once above for a fresh database, once here for
 * every database that already exists. Both are safe to run repeatedly.
 */
const migrations = `
    ALTER TABLE moves ADD COLUMN IF NOT EXISTS intent JSONB;
    ALTER TABLE moves ADD COLUMN IF NOT EXISTS notation VARCHAR(40);
`;

async function createSchema() {
    console.log('Creating database schema...');
    
    try {
        // Execute entire schema at once (PostgreSQL handles multiple statements)
        await query(schema);
        // Then bring an older database up to the same shape.
        await query(migrations);

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
        DROP TABLE IF EXISTS invitations CASCADE;
        DROP TABLE IF EXISTS matchmaking_queue CASCADE;
        DROP TABLE IF EXISTS user_preferences CASCADE;
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
        DROP FUNCTION IF EXISTS cleanup_expired_queue CASCADE;
        DROP FUNCTION IF EXISTS cleanup_expired_invitations CASCADE;
        DROP FUNCTION IF EXISTS cleanup_old_chat_messages CASCADE;
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
