-- Migration Phase 2: Add missing columns and tables for invitation/matchmaking system
-- Run this script on the production database to add missing columns/tables

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
    room_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE
);

-- ============================================
-- Invitations Table Updates (for existing table)
-- ============================================

-- Add creator_pseudo column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invitations' AND column_name = 'creator_pseudo'
    ) THEN
        ALTER TABLE invitations ADD COLUMN creator_pseudo VARCHAR(30);
        RAISE NOTICE 'Added creator_pseudo column to invitations table';
    ELSE
        RAISE NOTICE 'creator_pseudo column already exists';
    END IF;
END $$;

-- Add room_settings column if it doesn't exist (for time_mode storage)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invitations' AND column_name = 'room_settings'
    ) THEN
        ALTER TABLE invitations ADD COLUMN room_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
        RAISE NOTICE 'Added room_settings column to invitations table';
    ELSE
        RAISE NOTICE 'room_settings column already exists';
    END IF;
END $$;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code);
CREATE INDEX IF NOT EXISTS idx_invitations_creator ON invitations(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_expires ON invitations(expires_at);

-- Verify the table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'invitations' 
ORDER BY ordinal_position;
