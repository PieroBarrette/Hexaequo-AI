/**
 * Database Configuration
 * 
 * PostgreSQL connection pool and configuration.
 */

const { Pool } = require('pg');
const { DATABASE_URL, NODE_ENV } = require('./env');

// Parse connection string or use individual params
const poolConfig = DATABASE_URL.startsWith('postgresql://') 
    ? { connectionString: DATABASE_URL }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'hexaequo',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || ''
    };

/*
 * SSL follows the host, not the environment.
 *
 * Keying it on NODE_ENV meant a developer connecting to the managed database
 * from their machine was refused, because Render requires SSL on external
 * connections and NODE_ENV was 'development'. A local Postgres, on the other
 * hand, usually has no certificate at all. So: encrypt whenever the host is
 * remote. `rejectUnauthorized` stays false because managed providers terminate
 * TLS with their own chain.
 */
const isLocalDatabase = /@(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/.test(DATABASE_URL);
if (NODE_ENV === 'production' || !isLocalDatabase) {
    poolConfig.ssl = { rejectUnauthorized: false };
}

// Connection pool settings
poolConfig.max = 20;                    // Maximum connections
poolConfig.idleTimeoutMillis = 30000;   // Close idle connections after 30s
poolConfig.connectionTimeoutMillis = 2000; // Timeout after 2s if can't connect

/*
 * No database at all, on purpose.
 *
 * The socket and engine suites need no database and say so at the top of their
 * files — but the module they exercise records a finished game, and with a
 * DATABASE_URL in .env pointing at the live server that is where the rows went.
 * A test that quietly writes to production is worse than no test.
 *
 * DATABASE_URL=memory means there is none: no pool is built, nothing is dialled,
 * and every query fails immediately with a name the callers can recognise.
 * Failing is the honest answer — the callers that can do without a database
 * already ask, and the ones that cannot were never meant to run this way.
 */
const NO_DATABASE = DATABASE_URL === 'memory';

/** Whether anything is there to write to. */
function hasDatabase() { return !NO_DATABASE; }

class NoDatabase extends Error {
    constructor() {
        super('no database in this process (DATABASE_URL=memory)');
        this.name = 'NoDatabase';
        this.code = 'NO_DATABASE';
    }
}

const pool = NO_DATABASE ? null : new Pool(poolConfig);

// Log pool errors
if (pool) {
    pool.on('error', (err) => {
        console.error('Unexpected database pool error:', err);
    });
}

/**
 * Execute a query
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function query(text, params) {
    if (NO_DATABASE) throw new NoDatabase();
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        
        if (NODE_ENV === 'development') {
            console.log('Query executed:', { text: text.substring(0, 100), duration, rows: result.rowCount });
        }
        
        return result;
    } catch (error) {
        console.error('Database query error:', { text: text.substring(0, 100), error: error.message });
        throw error;
    }
}

/**
 * Get a client from the pool for transactions
 * @returns {Promise<Client>}
 */
async function getClient() {
    if (NO_DATABASE) throw new NoDatabase();
    const client = await pool.connect();
    const originalQuery = client.query.bind(client);
    const originalRelease = client.release.bind(client);

    // Track query timeout
    const timeout = setTimeout(() => {
        console.error('Client has been checked out for more than 5 seconds!');
    }, 5000);

    client.release = () => {
        clearTimeout(timeout);
        client.query = originalQuery;
        client.release = originalRelease;
        return originalRelease();
    };

    return client;
}

/**
 * Execute a transaction
 * @param {Function} callback - Function receiving client
 * @returns {Promise<any>}
 */
async function transaction(callback) {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Test database connection
 */
async function testConnection() {
    try {
        const result = await query('SELECT NOW()');
        console.log('Database connected:', result.rows[0].now);
        return true;
    } catch (error) {
        console.error('Database connection failed:', error.message);
        return false;
    }
}

/**
 * Close all connections
 */
async function close() {
    if (!pool) return;
    await pool.end();
    console.log('Database pool closed');
}

module.exports = {
    query,
    getClient,
    transaction,
    testConnection,
    close,
    hasDatabase,
    pool
};
