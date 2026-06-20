-- Migration Phase 2: Add missing columns and tables for invitation/matchmaking system
-- Run this script on the production database to add missing columns/tables
-- Compatible with PostgreSQL 9.6+ (uses ADD COLUMN IF NOT EXISTS)

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

-- Add pseudo column to matchmaking_queue if it doesn't exist (PostgreSQL 9.6+)
ALTER TABLE matchmaking_queue ADD COLUMN IF NOT EXISTS pseudo VARCHAR(50) NOT NULL;

-- Change Room Code length to 8 chars
ALTER TABLE rooms ALTER COLUMN code TYPE VARCHAR(8);
ALTER TABLE games ALTER COLUMN room_code TYPE VARCHAR(8);

-- ============================================
-- Invitations Table (Phase 2)
-- ============================================
CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    creator_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    creator_pseudo VARCHAR(30),
    creator_elo INTEGER,
    room_settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE
);

-- ============================================
-- Invitations Table Updates (for existing table)
-- ============================================

-- Add missing columns using IF NOT EXISTS (PostgreSQL 9.6+)
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS creator_pseudo VARCHAR(30);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS creator_elo INTEGER;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS room_settings JSONB DEFAULT '{}'::jsonb;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code);
CREATE INDEX IF NOT EXISTS idx_invitations_creator ON invitations(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_expires ON invitations(expires_at);

-- ============================================
-- Cleanup Functions
-- ============================================

-- Drop existing functions first (return type may differ)
DROP FUNCTION IF EXISTS cleanup_expired_invitations();
DROP FUNCTION IF EXISTS cleanup_expired_queue();

-- Function to clean up expired invitations
CREATE FUNCTION cleanup_expired_invitations() 
RETURNS INTEGER 
LANGUAGE plpgsql
AS $func$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM invitations WHERE expires_at < NOW() OR used = TRUE;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$func$;

-- Function to clean up expired matchmaking queue entries
CREATE FUNCTION cleanup_expired_queue() 
RETURNS INTEGER 
LANGUAGE plpgsql
AS $func$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM matchmaking_queue WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$func$;

-- ============================================
-- Verify Results
-- ============================================
SELECT 'invitations' as table_name, column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'invitations' 
ORDER BY ordinal_position;

SELECT 'matchmaking_queue' as table_name, column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'matchmaking_queue' 
ORDER BY ordinal_position;
