-- ============================================
-- MIGRATION PHASE 0 - Hexaequo
-- Date: 8 janvier 2026
-- Description: ELO defaults 1500→1000 + nouvelles tables
-- ============================================

-- 1. MODIFIER DEFAULTS ELO (1500 → 1000)
-- ============================================
ALTER TABLE users ALTER COLUMN elo_classic SET DEFAULT 1000;
ALTER TABLE users ALTER COLUMN elo_rapid SET DEFAULT 1000;
ALTER TABLE users ALTER COLUMN elo_blitz SET DEFAULT 1000;

-- 2. TABLE USER_PREFERENCES (Phase 2)
-- ============================================
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    elo_range_min INTEGER DEFAULT -200,
    elo_range_max INTEGER DEFAULT 200,
    allow_friendly_games BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON user_preferences;

CREATE TRIGGER update_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 3. TABLE MATCHMAKING_QUEUE (Phase 2)
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

-- 4. TABLE INVITATIONS (Phase 2)
-- ============================================
CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    creator_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    creator_socket_id VARCHAR(255),
    room_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT false,
    used_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    used_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code);
CREATE INDEX IF NOT EXISTS idx_invitations_creator ON invitations(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_expires ON invitations(expires_at);

-- 5. TABLE CHAT_MESSAGES (Phase 3)
-- ============================================
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(4) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    pseudo VARCHAR(30) NOT NULL,
    message TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_code);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

-- 6. FONCTIONS CLEANUP
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_expired_queue()
RETURNS void AS $$
BEGIN
    DELETE FROM matchmaking_queue WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_expired_invitations()
RETURNS void AS $$
BEGIN
    DELETE FROM invitations WHERE expires_at < NOW() AND used = false;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_old_chat_messages()
RETURNS void AS $$
BEGIN
    DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '2 hours';
END;
$$ LANGUAGE plpgsql;

-- 7. CRÉER PRÉFÉRENCES PAR DÉFAUT POUR UTILISATEURS EXISTANTS
-- ============================================
INSERT INTO user_preferences (user_id)
SELECT id FROM users
WHERE id NOT IN (SELECT user_id FROM user_preferences)
ON CONFLICT (user_id) DO NOTHING;

-- ============================================
-- MIGRATION TERMINÉE ✅
-- ============================================
-- Vérifications:
SELECT COUNT(*) as total_users FROM users;
SELECT COUNT(*) as users_with_preferences FROM user_preferences;
SELECT table_name FROM information_schema.tables WHERE table_name IN ('user_preferences', 'matchmaking_queue', 'invitations', 'chat_messages');
