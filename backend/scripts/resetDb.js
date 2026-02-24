/**
 * Database Reset Script
 * 
 * WARNING: This will delete all data!
 * Usage: node scripts/resetDb.js
 */

const { pool, testConnection } = require('../config/database');
const { schema } = require('../models/schema');

async function resetDatabase() {
    console.log('⚠️  WARNING: This will delete ALL data in the database!\n');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('🔧 Resetting database...\n');
    
    // Test connection first
    const connected = await testConnection();
    if (!connected) {
        console.error('❌ Could not connect to database. Please check your DATABASE_URL.');
        process.exit(1);
    }
    
    const client = await pool.connect();
    
    try {
        // Start transaction
        await client.query('BEGIN');
        
        // Drop all tables in correct order (respecting foreign keys)
        console.log('🗑️  Dropping existing tables...');
        
        const dropStatements = [
            'DROP TABLE IF EXISTS chat_messages CASCADE',
            'DROP TABLE IF EXISTS invitations CASCADE',
            'DROP TABLE IF EXISTS matchmaking_queue CASCADE',
            'DROP TABLE IF EXISTS user_preferences CASCADE',
            'DROP TABLE IF EXISTS spectators CASCADE',
            'DROP TABLE IF EXISTS saved_replays CASCADE',
            'DROP TABLE IF EXISTS elo_history CASCADE',
            'DROP TABLE IF EXISTS moves CASCADE',
            'DROP TABLE IF EXISTS games CASCADE',
            'DROP TABLE IF EXISTS rooms CASCADE',
            'DROP TABLE IF EXISTS refresh_tokens CASCADE',
            'DROP TABLE IF EXISTS users CASCADE'
        ];
        
        for (const statement of dropStatements) {
            await client.query(statement);
        }
        
        // Drop functions
        console.log('🗑️  Dropping functions...');
        await client.query('DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE');
        await client.query('DROP FUNCTION IF EXISTS cleanup_old_rooms() CASCADE');
        await client.query('DROP FUNCTION IF EXISTS cleanup_expired_tokens() CASCADE');
        await client.query('DROP FUNCTION IF EXISTS cleanup_expired_queue() CASCADE');
        await client.query('DROP FUNCTION IF EXISTS cleanup_expired_invitations() CASCADE');
        await client.query('DROP FUNCTION IF EXISTS cleanup_old_chat_messages() CASCADE');
        
        console.log('✅ Tables dropped\n');
        
        // Recreate schema
        console.log('📋 Creating schema...');
        await client.query(schema);
        
        await client.query('COMMIT');
        console.log('✅ Schema created\n');
        
        // Verify
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);
        
        console.log('📊 Tables:');
        result.rows.forEach(row => {
            console.log(`   - ${row.table_name}`);
        });
        
        console.log('\n✨ Database reset complete!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error resetting database:', error.message);
        process.exit(1);
    } finally {
        client.release();
    }
    
    await pool.end();
}

// Run if called directly
if (require.main === module) {
    resetDatabase()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = { resetDatabase };
