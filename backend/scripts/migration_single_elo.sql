-- Migration: Merge 3 ELO columns (elo_classic, elo_rapid, elo_blitz) into single 'elo' column
-- Date: 2026-02-23
-- Reason: Simplify to single global ELO rating. Time control multipliers still affect point variance.

-- Step 1: Add single elo column (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'elo'
    ) THEN
        ALTER TABLE users ADD COLUMN elo INTEGER DEFAULT 1000;
    END IF;
END $$;

-- Step 2: Copy elo_classic → elo for existing users
UPDATE users SET elo = elo_classic WHERE elo = 1000 OR elo IS NULL;

-- Step 3: Drop old columns (if they exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'elo_classic') THEN
        ALTER TABLE users DROP COLUMN elo_classic;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'elo_rapid') THEN
        ALTER TABLE users DROP COLUMN elo_rapid;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'elo_blitz') THEN
        ALTER TABLE users DROP COLUMN elo_blitz;
    END IF;
END $$;

-- Step 4: Drop old per-mode indexes (if they exist)
DROP INDEX IF EXISTS idx_users_elo_classic;
DROP INDEX IF EXISTS idx_users_elo_rapid;
DROP INDEX IF EXISTS idx_users_elo_blitz;

-- Step 5: Create single ELO index
CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);

-- Step 6: Drop time_mode column from elo_history (no longer needed with single ELO pool)
ALTER TABLE elo_history DROP COLUMN IF EXISTS time_mode;

-- Step 7: Drop old per-mode elo_history index
DROP INDEX IF EXISTS idx_elo_history_user_mode;
