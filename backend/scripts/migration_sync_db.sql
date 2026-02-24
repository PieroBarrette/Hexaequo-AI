-- ============================================
-- Migration: Sync DB with current project architecture
-- Date: 2026-02-23
-- 
-- This script brings an existing PostgreSQL database fully in sync
-- with the current codebase. Safe to run multiple times (idempotent).
-- Apply each section one at a time in your PostgreSQL client.
-- ============================================

-- ============================================
-- SECTION 1: Core tables & ELO defaults
-- Ensures base tables exist and ELO defaults are 1000
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Fix ELO: single column (was elo_classic/rapid/blitz in early versions)
-- migration_single_elo.sql handles the transition
-- If already migrated, just ensure default is 1000
ALTER TABLE users ALTER COLUMN elo SET DEFAULT 1000;

-- ============================================
-- SECTION 2: Rooms — ensure code is VARCHAR(8)
-- (was VARCHAR(4) in early versions)
-- ============================================

ALTER TABLE rooms ALTER COLUMN code TYPE VARCHAR(8);

-- ============================================
-- SECTION 3: Games — ensure room_code is VARCHAR(8)
-- ============================================

ALTER TABLE games ALTER COLUMN room_code TYPE VARCHAR(8);

-- ============================================
-- SECTION 4: Rooms — rename guest_* to white_* if needed
-- (safe: errors silently if columns already renamed)
-- ============================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rooms' AND column_name = 'guest_id'
    ) THEN
        ALTER TABLE rooms RENAME COLUMN guest_id TO white_id;
        ALTER TABLE rooms RENAME COLUMN guest_socket_id TO white_socket_id;
        ALTER TABLE rooms RENAME COLUMN guest_pseudo TO white_pseudo;
    END IF;
END $$;

-- ============================================
-- SECTION 5: Spectators — fix room_code size
-- (was VARCHAR(4), must be VARCHAR(8) to match rooms.code)
-- ============================================

ALTER TABLE spectators ALTER COLUMN room_code TYPE VARCHAR(8);

-- ============================================
-- SECTION 6: Saved Replays (Phase 4 — create if missing)
-- ============================================

CREATE TABLE IF NOT EXISTS saved_replays (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE,
    saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_replays_user ON saved_replays(user_id);

-- ============================================
-- SECTION 7: ELO History (create if missing)
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
-- SECTION 8: User Preferences (Phase 2)
-- ============================================

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    elo_range_min INTEGER DEFAULT -200,
    elo_range_max INTEGER DEFAULT 200,
    allow_friendly_games BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SECTION 9: Matchmaking Queue (Phase 2)
-- With pseudo column that services require
-- ============================================

CREATE TABLE IF NOT EXISTS matchmaking_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    socket_id VARCHAR(255) NOT NULL,
    pseudo VARCHAR(50) NOT NULL DEFAULT '',
    elo INTEGER NOT NULL,
    time_mode VARCHAR(20) NOT NULL,
    preferences JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

-- Add pseudo column if table existed without it
ALTER TABLE matchmaking_queue ADD COLUMN IF NOT EXISTS pseudo VARCHAR(50) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_time_mode ON matchmaking_queue(time_mode);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_elo ON matchmaking_queue(elo);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_expires ON matchmaking_queue(expires_at);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_user ON matchmaking_queue(user_id);

-- ============================================
-- SECTION 10: Invitations (Phase 2)
-- With creator_pseudo and creator_elo that services require
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

-- Add missing columns if table existed without them
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS creator_pseudo VARCHAR(30);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS creator_elo INTEGER;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS room_settings JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code);
CREATE INDEX IF NOT EXISTS idx_invitations_creator ON invitations(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_expires ON invitations(expires_at);

-- ============================================
-- SECTION 11: Chat Messages (Phase 3 — in-memory primary, DB backup)
-- ============================================

CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(8) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    pseudo VARCHAR(30) NOT NULL,
    message TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fix room_code size if table existed with VARCHAR(4)
ALTER TABLE chat_messages ALTER COLUMN room_code TYPE VARCHAR(8);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_code);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

-- ============================================
-- SECTION 12: Helper Functions
-- ============================================

-- updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER update_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SECTION 13: Cleanup Functions
-- (DROP + recreate to fix return type mismatches)
-- ============================================

DROP FUNCTION IF EXISTS cleanup_old_rooms();
CREATE FUNCTION cleanup_old_rooms()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE deleted_count INTEGER;
BEGIN
    DELETE FROM rooms WHERE updated_at < NOW() - INTERVAL '24 hours';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

DROP FUNCTION IF EXISTS cleanup_expired_tokens();
CREATE FUNCTION cleanup_expired_tokens()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE deleted_count INTEGER;
BEGIN
    DELETE FROM refresh_tokens WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

DROP FUNCTION IF EXISTS cleanup_expired_queue();
CREATE FUNCTION cleanup_expired_queue()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE deleted_count INTEGER;
BEGIN
    DELETE FROM matchmaking_queue WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

DROP FUNCTION IF EXISTS cleanup_expired_invitations();
CREATE FUNCTION cleanup_expired_invitations()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE deleted_count INTEGER;
BEGIN
    DELETE FROM invitations WHERE expires_at < NOW() OR used = TRUE;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

DROP FUNCTION IF EXISTS cleanup_old_chat_messages();
CREATE FUNCTION cleanup_old_chat_messages()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE deleted_count INTEGER;
BEGIN
    DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '2 hours';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- ============================================
-- SECTION 14: Data cleanup (stale/orphaned rows)
-- ============================================

-- Remove matchmaking entries with NULL user (old guest entries)
DELETE FROM matchmaking_queue WHERE user_id IS NULL;

-- Remove invitations with NULL creator (old guest entries)
DELETE FROM invitations WHERE creator_user_id IS NULL;

-- Remove stale waiting rooms with NULL host
DELETE FROM rooms WHERE host_id IS NULL AND status = 'waiting';

-- Remove orphaned moves
DELETE FROM moves WHERE game_id NOT IN (SELECT id FROM games);

-- ============================================
-- SECTION 15: Verification
-- Run these queries to confirm everything is in sync
-- ============================================

SELECT 'TABLES' AS check_type, table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

SELECT 'matchmaking_queue columns' AS check_type, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'matchmaking_queue'
ORDER BY ordinal_position;

SELECT 'invitations columns' AS check_type, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'invitations'
ORDER BY ordinal_position;

SELECT 'spectators columns' AS check_type, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'spectators'
ORDER BY ordinal_position;

SELECT 'chat_messages columns' AS check_type, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'chat_messages'
ORDER BY ordinal_position;
