/**
 * Snapshot every table in the public schema to a JSON file.
 *
 * Usage: node scripts/dumpDb.js [outputFile]
 *
 * A safety net to run before resetDb.js. It needs no client tools — just the
 * pg driver the server already uses — so it works from any machine that can
 * reach the database. Small datasets only: everything is held in memory.
 */

const fs = require('fs');
const path = require('path');
const { pool, testConnection } = require('../config/database');

async function dump() {
    // Snapshots hold emails, password hashes and refresh tokens, so they go in
    // a directory git ignores rather than anywhere they might be committed.
    const defaultDir = path.join(__dirname, '..', '..', '.snapshots');
    if (!process.argv[2] && !fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });
    const target = process.argv[2]
        || path.join(defaultDir, `db-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

    if (!await testConnection()) {
        console.error('❌ Cannot reach the database. Check DATABASE_URL in backend/.env');
        process.exit(1);
    }

    const { rows: tables } = await pool.query(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
    `);

    if (!tables.length) {
        console.log('The public schema holds no tables — nothing to snapshot.');
        process.exit(0);
    }

    const snapshot = { takenAt: new Date().toISOString(), tables: {} };
    for (const { tablename } of tables) {
        // Identifiers cannot be parameterised; these come from pg_tables, not
        // from user input, and are quoted to stay safe with odd names.
        const { rows } = await pool.query(`SELECT * FROM "${tablename.replace(/"/g, '""')}"`);
        snapshot.tables[tablename] = rows;
        console.log(`  ${tablename.padEnd(24)} ${rows.length} row(s)`);
    }

    fs.writeFileSync(target, JSON.stringify(snapshot, null, 2), 'utf8');
    const size = (fs.statSync(target).size / 1024).toFixed(1);
    console.log(`\n✅ Snapshot written to ${target} (${size} KB)`);
    await pool.end();
}

dump().catch((error) => {
    console.error('❌ Snapshot failed:', error.message);
    process.exit(1);
});
