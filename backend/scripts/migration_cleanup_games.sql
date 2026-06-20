-- migration_cleanup_games.sql
-- Deletes ALL existing games and moves data.
-- Run manually in PostgreSQL before deploying per-move recording.
-- This is needed because existing games lack individual move records
-- in the moves table and cannot support the new replay system.

BEGIN;

-- Delete all moves first (FK constraint to games)
DELETE FROM moves;

-- Delete all games
DELETE FROM games;

COMMIT;

-- Verify cleanup
SELECT 'games' AS table_name, COUNT(*) AS remaining FROM games
UNION ALL
SELECT 'moves' AS table_name, COUNT(*) AS remaining FROM moves;
