/**
 * Database Initialization Script
 * 
 * Run this script to initialize the database schema.
 * Usage: node scripts/initDb.js
 */

const fs = require('fs');
const path = require('path');
const { pool, testConnection } = require('../config/database');

async function initializeDatabase() {
    console.log('🔧 Initializing database...\n');
    
    // Test connection first
    const connected = await testConnection();
    if (!connected) {
        console.error('❌ Could not connect to database. Please check your DATABASE_URL.');
        process.exit(1);
    }
    
    console.log('✅ Database connection successful\n');
    
    // Read schema file
    const schemaPath = path.join(__dirname, '../models/schema.js');
    const schemaModule = require(schemaPath);
    const schema = schemaModule.schema;
    
    console.log('📋 Executing schema...\n');
    
    try {
        await pool.query(schema);
        console.log('✅ Schema executed successfully!\n');
        
        // Verify tables were created
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);
        
        console.log('📊 Created tables:');
        result.rows.forEach(row => {
            console.log(`   - ${row.table_name}`);
        });
        
        // Check indexes
        const indexResult = await pool.query(`
            SELECT indexname, tablename
            FROM pg_indexes
            WHERE schemaname = 'public'
            ORDER BY tablename, indexname
        `);
        
        console.log(`\n📑 Created ${indexResult.rows.length} indexes`);
        
        console.log('\n✨ Database initialization complete!');
        
    } catch (error) {
        console.error('❌ Error executing schema:', error.message);
        
        // If tables already exist, that's usually fine
        if (error.message.includes('already exists')) {
            console.log('\n⚠️  Some objects already exist. This is usually fine.');
            console.log('   Run with DROP TABLE statements first if you need a fresh start.');
        }
        
        process.exit(1);
    }
    
    await pool.end();
}

// Run if called directly
if (require.main === module) {
    initializeDatabase()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = { initializeDatabase };
