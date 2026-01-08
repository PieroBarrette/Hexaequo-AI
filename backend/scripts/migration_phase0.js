/**
 * Migration Phase 0 + Tables Nouvelles Phases
 * 
 * Ce script crée:
 * 1. Modifie les defaults ELO de 1500 → 1000 pour nouveaux utilisateurs
 * 2. Ajoute table user_preferences (Phase 2)
 * 3. Ajoute table matchmaking_queue (Phase 2)
 * 4. Ajoute table invitations (Phase 2)
 * 5. Ajoute table chat_messages (Phase 3 - optionnel)
 * 
 * Usage: node backend/scripts/migration_phase0.js
 * 
 * Note: Les utilisateurs existants gardent leur ELO actuel.
 * Pour reset manuellement: UPDATE users SET elo_classic = 1000, elo_rapid = 1000, elo_blitz = 1000;
 */

const { query, pool } = require('../config/database');

const migrationSQL = `
-- ============================================
-- Phase 0: Modifier defaults ELO (1500 → 1000)
-- Note: ALTER COLUMN ... SET DEFAULT ne change pas les valeurs existantes
-- ============================================

ALTER TABLE users ALTER COLUMN elo_classic SET DEFAULT 1000;
ALTER TABLE users ALTER COLUMN elo_rapid SET DEFAULT 1000;
ALTER TABLE users ALTER COLUMN elo_blitz SET DEFAULT 1000;

-- ============================================
-- Phase 2: User Preferences Table
-- Stocke les préférences matchmaking de chaque utilisateur
-- ============================================

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    
    -- Plage ELO acceptée pour matchmaking (relatif au ELO actuel)
    elo_range_min INTEGER DEFAULT -200,  -- Ex: si ELO = 1200, accepte adversaires >= 1000
    elo_range_max INTEGER DEFAULT 200,   -- Ex: si ELO = 1200, accepte adversaires <= 1400
    
    -- Accepter parties contre guests (non authentifiés)
    allow_friendly_games BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger pour updated_at
DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER update_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Phase 2: Matchmaking Queue Table
-- File d'attente pour trouver des adversaires
-- ============================================

CREATE TABLE IF NOT EXISTS matchmaking_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Joueur
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    socket_id VARCHAR(255) NOT NULL,
    
    -- ELO au moment de l'entrée en queue (pour la cadence choisie)
    elo INTEGER NOT NULL,
    
    -- Cadence recherchée
    time_mode VARCHAR(20) NOT NULL,  -- classic, rapid, blitz
    
    -- Préférences au moment de l'entrée (copie pour éviter race conditions)
    preferences JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL  -- Défaut: created_at + 5 minutes
);

CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_time_mode ON matchmaking_queue(time_mode);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_elo ON matchmaking_queue(elo);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_expires ON matchmaking_queue(expires_at);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_user ON matchmaking_queue(user_id);

-- ============================================
-- Phase 2: Invitations Table
-- Codes d'invitation pour rejoindre une partie
-- ============================================

CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Code unique (8 caractères alphanumériques)
    code VARCHAR(20) UNIQUE NOT NULL,
    
    -- Créateur (nullable pour guests)
    creator_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    creator_socket_id VARCHAR(255),
    
    -- Settings de la room à créer
    room_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- Timestamps et expiration
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,  -- Défaut: created_at + 24 heures
    
    -- Statut
    used BOOLEAN DEFAULT false,
    used_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    used_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code);
CREATE INDEX IF NOT EXISTS idx_invitations_creator ON invitations(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_expires ON invitations(expires_at);

-- ============================================
-- Phase 3: Chat Messages Table (OPTIONNEL)
-- Note: Préférer stockage en mémoire pour messages éphémères
-- Cette table est pour backup/debug uniquement
-- ============================================

CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Room associée
    room_code VARCHAR(4) NOT NULL,
    
    -- Expéditeur
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    pseudo VARCHAR(30) NOT NULL,
    
    -- Message
    message TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text',  -- 'text' ou 'quick'
    
    -- Timestamp
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_code);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

-- ============================================
-- Cleanup Functions
-- ============================================

-- Cleanup matchmaking queue entries expirées
CREATE OR REPLACE FUNCTION cleanup_expired_queue()
RETURNS void AS $$
BEGIN
    DELETE FROM matchmaking_queue WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Cleanup invitations expirées
CREATE OR REPLACE FUNCTION cleanup_expired_invitations()
RETURNS void AS $$
BEGIN
    DELETE FROM invitations WHERE expires_at < NOW() AND used = false;
END;
$$ LANGUAGE plpgsql;

-- Cleanup vieux messages chat (plus de 2h)
CREATE OR REPLACE FUNCTION cleanup_old_chat_messages()
RETURNS void AS $$
BEGIN
    DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '2 hours';
END;
$$ LANGUAGE plpgsql;
`;

/**
 * Run migration
 */
async function runMigration() {
    console.log('Running Phase 0 migration...');
    console.log('- Changing ELO defaults from 1500 to 1000');
    console.log('- Creating user_preferences table');
    console.log('- Creating matchmaking_queue table');
    console.log('- Creating invitations table');
    console.log('- Creating chat_messages table');
    
    try {
        // Execute migrations one by one to avoid multi-statement issues
        
        // 1. Change ELO defaults
        console.log('\n1. Updating ELO defaults...');
        await query('ALTER TABLE users ALTER COLUMN elo_classic SET DEFAULT 1000');
        await query('ALTER TABLE users ALTER COLUMN elo_rapid SET DEFAULT 1000');
        await query('ALTER TABLE users ALTER COLUMN elo_blitz SET DEFAULT 1000');
        
        // 2. Create user_preferences table
        console.log('2. Creating user_preferences table...');
        await query(`
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                elo_range_min INTEGER DEFAULT -200,
                elo_range_max INTEGER DEFAULT 200,
                allow_friendly_games BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await query(`
            DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON user_preferences
        `);
        
        await query(`
            CREATE TRIGGER update_user_preferences_updated_at
                BEFORE UPDATE ON user_preferences
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column()
        `);
        
        // 3. Create matchmaking_queue table
        console.log('3. Creating matchmaking_queue table...');
        await query(`
            CREATE TABLE IF NOT EXISTS matchmaking_queue (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                socket_id VARCHAR(255) NOT NULL,
                elo INTEGER NOT NULL,
                time_mode VARCHAR(20) NOT NULL,
                preferences JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL
            )
        `);
        
        await query('CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_time_mode ON matchmaking_queue(time_mode)');
        await query('CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_elo ON matchmaking_queue(elo)');
        await query('CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_expires ON matchmaking_queue(expires_at)');
        await query('CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_user ON matchmaking_queue(user_id)');
        
        // 4. Create invitations table
        console.log('4. Creating invitations table...');
        await query(`
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
            )
        `);
        
        await query('CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code)');
        await query('CREATE INDEX IF NOT EXISTS idx_invitations_creator ON invitations(creator_user_id)');
        await query('CREATE INDEX IF NOT EXISTS idx_invitations_expires ON invitations(expires_at)');
        
        // 5. Create chat_messages table
        console.log('5. Creating chat_messages table...');
        await query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                room_code VARCHAR(4) NOT NULL,
                user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                pseudo VARCHAR(30) NOT NULL,
                message TEXT NOT NULL,
                message_type VARCHAR(20) DEFAULT 'text',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await query('CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_code)');
        await query('CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at)');
        
        // 6. Create cleanup functions
        console.log('6. Creating cleanup functions...');
        await query(`
            CREATE OR REPLACE FUNCTION cleanup_expired_queue()
            RETURNS void AS $$
            BEGIN
                DELETE FROM matchmaking_queue WHERE expires_at < NOW();
            END;
            $$ LANGUAGE plpgsql
        `);
        
        await query(`
            CREATE OR REPLACE FUNCTION cleanup_expired_invitations()
            RETURNS void AS $$
            BEGIN
                DELETE FROM invitations WHERE expires_at < NOW() AND used = false;
            END;
            $$ LANGUAGE plpgsql
        `);
        
        await query(`
            CREATE OR REPLACE FUNCTION cleanup_old_chat_messages()
            RETURNS void AS $$
            BEGIN
                DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '2 hours';
            END;
            $$ LANGUAGE plpgsql
        `);
        
        console.log('\n✅ Migration completed successfully!');
        
        // Insert default preferences for existing users
        console.log('\n7. Creating default preferences for existing users...');
        const insertDefaultPrefs = `
            INSERT INTO user_preferences (user_id)
            SELECT id FROM users
            WHERE id NOT IN (SELECT user_id FROM user_preferences)
            ON CONFLICT (user_id) DO NOTHING
        `;
        const result = await query(insertDefaultPrefs);
        console.log(`✅ Created default preferences for ${result.rowCount || 0} existing users`);
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        throw error;
    }
}

/**
 * Rollback migration (for testing)
 */
async function rollbackMigration() {
    console.log('Rolling back Phase 0 migration...');
    
    try {
        // Revert ELO defaults
        console.log('1. Reverting ELO defaults...');
        await query('ALTER TABLE users ALTER COLUMN elo_classic SET DEFAULT 1500');
        await query('ALTER TABLE users ALTER COLUMN elo_rapid SET DEFAULT 1500');
        await query('ALTER TABLE users ALTER COLUMN elo_blitz SET DEFAULT 1500');
        
        // Drop new tables
        console.log('2. Dropping new tables...');
        await query('DROP TABLE IF EXISTS chat_messages CASCADE');
        await query('DROP TABLE IF EXISTS invitations CASCADE');
        await query('DROP TABLE IF EXISTS matchmaking_queue CASCADE');
        await query('DROP TABLE IF EXISTS user_preferences CASCADE');
        
        // Drop cleanup functions
        console.log('3. Dropping cleanup functions...');
        await query('DROP FUNCTION IF EXISTS cleanup_expired_queue CASCADE');
        await query('DROP FUNCTION IF EXISTS cleanup_expired_invitations CASCADE');
        await query('DROP FUNCTION IF EXISTS cleanup_old_chat_messages CASCADE');
        
        console.log('✅ Rollback completed successfully!');
    } catch (error) {
        console.error('❌ Rollback failed:', error.message);
        throw error;
    }
}

// Run if executed directly
if (require.main === module) {
    const arg = process.argv[2];
    
    const execute = async () => {
        try {
            if (arg === 'rollback') {
                await rollbackMigration();
            } else {
                await runMigration();
            }
            process.exit(0);
        } catch (error) {
            process.exit(1);
        } finally {
            await pool.end();
        }
    };
    
    execute();
}

module.exports = { runMigration, rollbackMigration };
