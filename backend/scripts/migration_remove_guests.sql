-- Migration: Remove Guest Feature & Rename Columns
-- Date: 2025
-- Description: 
--   1. Rename guest_* columns to white_* (they store the second player, not unauthenticated users)
--   2. Clean up orphaned data from old guest sessions

-- ============================================
-- STEP 1: Rename guest_* columns to white_*
-- ============================================
-- The guest_* columns were confusingly named - they actually store the "white" player
-- (second player to join). Renaming for clarity.

ALTER TABLE rooms RENAME COLUMN guest_id TO white_id;
ALTER TABLE rooms RENAME COLUMN guest_socket_id TO white_socket_id;
ALTER TABLE rooms RENAME COLUMN guest_pseudo TO white_pseudo;

-- ============================================
-- STEP 2: Clean up matchmaking_queue
-- ============================================
-- Remove any entries where user_id is NULL (old guest entries)
DELETE FROM matchmaking_queue WHERE user_id IS NULL;

-- ============================================
-- STEP 3: Clean up invitations
-- ============================================
-- Remove any invitations where creator_user_id is NULL (old guest-created invitations)
DELETE FROM invitations WHERE creator_user_id IS NULL;

-- ============================================
-- STEP 4: Clean up rooms
-- ============================================
-- Remove any rooms where host_id is NULL (old guest-created rooms)
-- that are in 'waiting' status (stale rooms)
DELETE FROM rooms 
WHERE host_id IS NULL 
  AND status = 'waiting';

-- For finished/playing rooms with NULL host_id, we keep them for history
-- but you can uncomment the following to remove them entirely:
-- DELETE FROM rooms WHERE host_id IS NULL;

-- ============================================
-- STEP 5: Clean up games table (if needed)
-- ============================================
-- Remove game records with NULL player references
DELETE FROM games 
WHERE black_player_id IS NULL 
   OR white_player_id IS NULL;

-- ============================================
-- STEP 6: Clean up moves table (orphaned moves)
-- ============================================
-- Remove moves that reference non-existent games
DELETE FROM moves 
WHERE game_id NOT IN (SELECT id FROM games);

-- ============================================
-- OPTIONAL: Enforce authentication at DB level
-- ============================================
-- Uncomment to make host_id NOT NULL (prevents rooms without logged-in host)
-- ALTER TABLE rooms ALTER COLUMN host_id SET NOT NULL;
-- ALTER TABLE invitations ALTER COLUMN creator_user_id SET NOT NULL;

-- ============================================
-- Verification queries (run to confirm cleanup)
-- ============================================
-- SELECT COUNT(*) AS orphan_queue_entries FROM matchmaking_queue WHERE user_id IS NULL;
-- SELECT COUNT(*) AS orphan_invitations FROM invitations WHERE creator_user_id IS NULL;
-- SELECT COUNT(*) AS orphan_rooms FROM rooms WHERE host_id IS NULL;
-- SELECT COUNT(*) AS orphan_games FROM games WHERE black_player_id IS NULL OR white_player_id IS NULL;
