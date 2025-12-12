/**
 * Database Cleanup Script
 * 
 * Run periodically to clean up expired tokens and old data.
 * Usage: node scripts/cleanupDb.js
 */

const { pool, testConnection } = require('../config/database');

async function cleanupDatabase() {
    console.log('🧹 Running database cleanup...\n');
    
    // Test connection first
    const connected = await testConnection();
    if (!connected) {
        console.error('❌ Could not connect to database.');
        process.exit(1);
    }
    
    let totalCleaned = 0;
    
    try {
        // Clean expired refresh tokens
        const refreshResult = await pool.query(
            `DELETE FROM refresh_tokens WHERE expires_at < NOW()`
        );
        console.log(`   Expired refresh tokens: ${refreshResult.rowCount}`);
        totalCleaned += refreshResult.rowCount;
        
        // Clean old rooms (older than 24 hours)
        const roomResult = await pool.query(
            `DELETE FROM rooms WHERE updated_at < NOW() - INTERVAL '24 hours'`
        );
        console.log(`   Old rooms: ${roomResult.rowCount}`);
        totalCleaned += roomResult.rowCount;
        
        // Clean unverified users older than 7 days
        const unverifiedResult = await pool.query(
            `DELETE FROM users 
             WHERE email_verified = FALSE 
             AND created_at < NOW() - INTERVAL '7 days'
             AND games_played = 0`
        );
        console.log(`   Unverified users: ${unverifiedResult.rowCount}`);
        totalCleaned += unverifiedResult.rowCount;
        
        console.log(`\n✅ Cleaned ${totalCleaned} records`);
        
    } catch (error) {
        console.error('❌ Cleanup error:', error.message);
        process.exit(1);
    }
    
    await pool.end();
}

// Run if called directly
if (require.main === module) {
    cleanupDatabase()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = { cleanupDatabase };
