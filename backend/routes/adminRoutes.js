/**
 * Admin Routes - Database Administration Interface
 * 
 * Provides a web-based interface similar to phpMyAdmin for PostgreSQL.
 * Protected by DEBUG_PASSWORD environment variable.
 */

const express = require('express');
const router = express.Router();
const { query } = require('../config/database');

const DEBUG_PASSWORD = process.env.DEBUG_PASSWORD || 'hexadmin2026';

// Middleware to check admin password
const checkAdminAuth = (req, res, next) => {
    const password = req.query.pwd || req.body?.pwd;
    if (!password || password !== DEBUG_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized - invalid or missing password' });
    }
    next();
};

// ==== JSON API Endpoints ====

// Get database statistics
router.get('/stats', checkAdminAuth, async (req, res) => {
    try {
        const stats = {};
        
        // Count tables
        const tables = ['users', 'rooms', 'games', 'moves', 'refresh_tokens', 'elo_history', 'spectators'];
        for (const table of tables) {
            try {
                const result = await query(`SELECT COUNT(*) as count FROM ${table}`);
                stats[table] = parseInt(result.rows[0].count);
            } catch (e) {
                stats[table] = 'table not found';
            }
        }
        
        // Active rooms
        try {
            const activeRooms = await query(`SELECT COUNT(*) as count FROM rooms WHERE status IN ('waiting', 'playing')`);
            stats.activeRooms = parseInt(activeRooms.rows[0].count);
        } catch (e) {
            stats.activeRooms = 0;
        }
        
        res.json({ success: true, stats, timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Execute SELECT query
router.post('/query', checkAdminAuth, async (req, res) => {
    try {
        const { sql } = req.body;
        
        if (!sql) {
            return res.status(400).json({ error: 'Missing SQL query' });
        }
        
        // Only allow SELECT queries for safety
        if (!sql.trim().toUpperCase().startsWith('SELECT')) {
            return res.status(403).json({ error: 'Only SELECT queries are allowed via this endpoint' });
        }
        
        const result = await query(sql);
        res.json({ success: true, count: result.rows.length, results: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Execute modification query (DELETE, UPDATE, INSERT)
router.post('/execute', checkAdminAuth, async (req, res) => {
    try {
        const { sql } = req.body;
        
        if (!sql) {
            return res.status(400).json({ error: 'Missing SQL command' });
        }
        
        const sqlUpper = sql.trim().toUpperCase();
        const allowedCommands = ['DELETE', 'UPDATE', 'INSERT'];
        const isAllowed = allowedCommands.some(cmd => sqlUpper.startsWith(cmd));
        
        if (!isAllowed) {
            return res.status(403).json({ 
                error: 'Only DELETE, UPDATE, INSERT commands are allowed',
                allowedCommands 
            });
        }
        
        const result = await query(sql);
        
        console.log(`[ADMIN] SQL executed: ${sql.substring(0, 100)}... | Rows: ${result.rowCount}`);
        
        res.json({ 
            success: true, 
            rowCount: result.rowCount,
            message: `Executed successfully. ${result.rowCount} row(s) affected.`
        });
    } catch (err) {
        console.error('[ADMIN] Execute error:', err);
        res.status(500).json({ error: err.message });
    }
});

// List all tables
router.get('/tables', checkAdminAuth, async (req, res) => {
    try {
        const result = await query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        res.json({ success: true, tables: result.rows.map(r => r.table_name) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get table schema
router.get('/schema/:table', checkAdminAuth, async (req, res) => {
    try {
        const { table } = req.params;
        const result = await query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
        `, [table]);
        res.json({ success: true, table, columns: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==== Web Admin Interface ====

router.get('/', (req, res) => {
    const password = req.query.pwd;
    
    // Login page if no password
    if (!password || password !== DEBUG_PASSWORD) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Hexaequo DB Admin - Login</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    * { box-sizing: border-box; }
                    body { 
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                        min-height: 100vh;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        margin: 0;
                        color: #fff;
                    }
                    .login-box {
                        background: rgba(255,255,255,0.1);
                        backdrop-filter: blur(10px);
                        padding: 40px;
                        border-radius: 16px;
                        text-align: center;
                        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                        border: 1px solid rgba(255,255,255,0.1);
                    }
                    h1 { margin: 0 0 10px 0; font-size: 28px; }
                    .subtitle { color: #888; margin-bottom: 30px; }
                    input {
                        padding: 12px 20px;
                        width: 280px;
                        background: rgba(255,255,255,0.1);
                        border: 1px solid rgba(255,255,255,0.2);
                        border-radius: 8px;
                        color: #fff;
                        font-size: 16px;
                        margin-bottom: 15px;
                    }
                    input::placeholder { color: rgba(255,255,255,0.5); }
                    input:focus { outline: none; border-color: #4CAF50; }
                    button {
                        padding: 12px 40px;
                        background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        font-size: 16px;
                        cursor: pointer;
                        transition: transform 0.2s, box-shadow 0.2s;
                    }
                    button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(76,175,80,0.4); }
                </style>
            </head>
            <body>
                <div class="login-box">
                    <h1>🎲 Hexaequo DB Admin</h1>
                    <p class="subtitle">PostgreSQL Database Administration</p>
                    <form onsubmit="window.location.href='?pwd='+document.getElementById('pwd').value; return false;">
                        <input type="password" id="pwd" placeholder="Admin Password" autofocus required>
                        <br>
                        <button type="submit">🔓 Login</button>
                    </form>
                </div>
            </body>
            </html>
        `);
    }

    // Main admin interface
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Hexaequo DB Admin</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
            <style>
                * { box-sizing: border-box; }
                body { 
                    font-family: 'Inter', sans-serif;
                    background: #0f0f1a;
                    color: #e0e0e0;
                    margin: 0;
                    padding: 20px;
                    min-height: 100vh;
                }
                
                .header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding-bottom: 20px;
                    border-bottom: 2px solid #2d2d44;
                    margin-bottom: 20px;
                }
                h1 { margin: 0; font-size: 24px; }
                .status { display: flex; align-items: center; gap: 10px; }
                .status-dot { width: 10px; height: 10px; border-radius: 50%; background: #4CAF50; }
                
                .nav {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px;
                    margin-bottom: 20px;
                }
                
                button {
                    padding: 10px 20px;
                    background: #2d2d44;
                    color: #fff;
                    border: 1px solid #3d3d5c;
                    border-radius: 8px;
                    cursor: pointer;
                    font-family: inherit;
                    font-size: 14px;
                    transition: all 0.2s;
                }
                button:hover { background: #3d3d5c; transform: translateY(-1px); }
                button.primary { background: #4CAF50; border-color: #4CAF50; }
                button.primary:hover { background: #45a049; }
                button.danger { background: #f44336; border-color: #f44336; }
                button.danger:hover { background: #da190b; }
                
                .section {
                    background: #1a1a2e;
                    border: 1px solid #2d2d44;
                    border-radius: 12px;
                    padding: 20px;
                    margin-bottom: 20px;
                }
                .section h3 { margin: 0 0 15px 0; color: #4CAF50; }
                
                textarea {
                    width: 100%;
                    height: 120px;
                    background: #0f0f1a;
                    color: #e0e0e0;
                    border: 1px solid #2d2d44;
                    border-radius: 8px;
                    padding: 15px;
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 13px;
                    resize: vertical;
                }
                textarea:focus { outline: none; border-color: #4CAF50; }
                
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 15px;
                    font-size: 13px;
                }
                th, td {
                    padding: 12px 15px;
                    text-align: left;
                    border-bottom: 1px solid #2d2d44;
                }
                th { background: #1a1a2e; color: #4CAF50; font-weight: 600; position: sticky; top: 0; }
                tr:hover { background: rgba(76, 175, 80, 0.1); }
                
                #results {
                    max-height: 500px;
                    overflow-y: auto;
                    margin-top: 20px;
                }
                
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                    gap: 15px;
                }
                .stat-card {
                    background: #0f0f1a;
                    border: 1px solid #2d2d44;
                    border-radius: 8px;
                    padding: 20px;
                    text-align: center;
                }
                .stat-value { font-size: 32px; font-weight: 600; color: #4CAF50; }
                .stat-label { color: #888; font-size: 12px; text-transform: uppercase; margin-top: 5px; }
                
                .example {
                    background: #0f0f1a;
                    padding: 10px 15px;
                    border-left: 3px solid #4CAF50;
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 12px;
                    margin: 10px 0;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .example:hover { background: #1a1a2e; }
                
                .success { color: #4CAF50; }
                .error { color: #f44336; }
                .warning { color: #ff9800; }
                
                pre { 
                    background: #0f0f1a;
                    padding: 15px;
                    border-radius: 8px;
                    overflow-x: auto;
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 12px;
                }
                
                .toast {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    padding: 15px 25px;
                    background: #4CAF50;
                    color: white;
                    border-radius: 8px;
                    display: none;
                    animation: slideIn 0.3s ease;
                }
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <h1>🎲 Hexaequo Database Admin</h1>
                    <small style="color: #888;">PostgreSQL • Production</small>
                </div>
                <div class="status">
                    <div class="status-dot" id="statusDot"></div>
                    <span id="statusText">Connecting...</span>
                    <button onclick="location.reload()">🔄 Refresh</button>
                    <button onclick="window.location.href='/api/admin'">🚪 Logout</button>
                </div>
            </div>
            
            <div class="nav">
                <strong style="padding: 10px;">Quick Views:</strong>
                <button onclick="loadTable('users')">👥 Users</button>
                <button onclick="loadTable('rooms')">🎮 Rooms</button>
                <button onclick="loadTable('games')">🏆 Games</button>
                <button onclick="loadTable('moves')">♟️ Moves</button>
                <button onclick="loadTable('elo_history')">📈 ELO History</button>
                <button onclick="loadTable('refresh_tokens')">🔑 Tokens</button>
                <button onclick="loadStats()" class="primary">📊 Statistics</button>
            </div>
            
            <div class="section">
                <h3>📖 Read Database (SELECT Queries)</h3>
                <textarea id="sqlQuery" placeholder="SELECT * FROM users LIMIT 20">SELECT id, email, pseudo, elo, games_played, wins, created_at FROM users ORDER BY elo DESC LIMIT 20</textarea>
                <div style="margin-top: 10px;">
                    <button onclick="executeQuery()" class="primary">▶️ Execute Query</button>
                    <button onclick="document.getElementById('sqlQuery').value=''">🗑️ Clear</button>
                </div>
            </div>
            
            <div class="section" style="border-color: #f44336;">
                <h3>⚠️ Modify Database (DELETE, UPDATE, INSERT)</h3>
                <p class="warning">⚠️ Warning: These commands will permanently modify your production database!</p>
                
                <div style="margin-bottom: 15px;">
                    <button onclick="showExamples('delete')">DELETE Examples</button>
                    <button onclick="showExamples('update')">UPDATE Examples</button>
                    <button onclick="showExamples('insert')">INSERT Examples</button>
                </div>
                
                <div id="examples">
                    <div class="example" onclick="setModifyQuery(this.dataset.sql)" data-sql="DELETE FROM users WHERE id = 'uuid-here'">-- Delete a user by ID<br>DELETE FROM users WHERE id = 'uuid-here'</div>
                    <div class="example" onclick="setModifyQuery(this.dataset.sql)" data-sql="DELETE FROM rooms WHERE updated_at < NOW() - INTERVAL '7 days'">-- Delete old rooms<br>DELETE FROM rooms WHERE updated_at < NOW() - INTERVAL '7 days'</div>
                    <div class="example" onclick="setModifyQuery(this.dataset.sql)" data-sql="DELETE FROM refresh_tokens WHERE expires_at < NOW()">-- Delete expired tokens<br>DELETE FROM refresh_tokens WHERE expires_at < NOW()</div>
                </div>
                
                <textarea id="modifyQuery" placeholder="DELETE FROM users WHERE pseudo = 'testuser'"></textarea>
                <div style="margin-top: 10px;">
                    <button onclick="executeModify()" class="danger">⚠️ Execute Modification</button>
                    <button onclick="document.getElementById('modifyQuery').value=''">🗑️ Clear</button>
                </div>
            </div>
            
            <h3>Results</h3>
            <div id="results"></div>
            
            <div class="toast" id="toast"></div>
            
            <script>
                const pwd = '${password}';
                const baseUrl = '/api/admin';
                
                const examples = {
                    delete: [
                        { label: 'Delete a user by ID', sql: "DELETE FROM users WHERE id = 'uuid-here'" },
                        { label: 'Delete old rooms', sql: "DELETE FROM rooms WHERE updated_at < NOW() - INTERVAL '7 days'" },
                        { label: 'Delete expired tokens', sql: "DELETE FROM refresh_tokens WHERE expires_at < NOW()" },
                        { label: 'Delete all spectators', sql: "DELETE FROM spectators" }
                    ],
                    update: [
                        { label: 'Reset user ELO', sql: "UPDATE users SET elo = 1000 WHERE pseudo = 'player1'" },
                        { label: 'Reset user statistics', sql: "UPDATE users SET games_played = 0, wins = 0, losses = 0, draws = 0 WHERE id = 'uuid-here'" },
                        { label: 'Change pseudo', sql: "UPDATE users SET pseudo = 'NewPseudo' WHERE pseudo = 'OldPseudo'" },
                        { label: 'Update room status', sql: "UPDATE rooms SET status = 'finished' WHERE code = 'ABCD'" }
                    ],
                    insert: [
                        { label: 'Create test room', sql: "INSERT INTO rooms (code, host_pseudo, time_mode, status) VALUES ('TEST', 'TestHost', 'classic', 'waiting')" }
                    ]
                };
                
                function showExamples(type) {
                    const container = document.getElementById('examples');
                    container.innerHTML = examples[type].map(ex => 
                        \`<div class="example" onclick="setModifyQuery(this.dataset.sql)" data-sql="\${ex.sql}">-- \${ex.label}<br>\${ex.sql}</div>\`
                    ).join('');
                }
                
                function setModifyQuery(sql) {
                    document.getElementById('modifyQuery').value = sql;
                }
                
                function showToast(message, isError = false) {
                    const toast = document.getElementById('toast');
                    toast.textContent = message;
                    toast.style.background = isError ? '#f44336' : '#4CAF50';
                    toast.style.display = 'block';
                    setTimeout(() => toast.style.display = 'none', 3000);
                }
                
                async function fetchApi(endpoint, options = {}) {
                    const url = endpoint.includes('?') ? \`\${endpoint}&pwd=\${pwd}\` : \`\${endpoint}?pwd=\${pwd}\`;
                    const response = await fetch(url, {
                        ...options,
                        headers: { 'Content-Type': 'application/json', ...options.headers }
                    });
                    return response.json();
                }
                
                function renderTable(data) {
                    if (!data.results || data.results.length === 0) {
                        return '<p>No results found</p>';
                    }
                    
                    const keys = Object.keys(data.results[0]);
                    let html = '<table><thead><tr>';
                    keys.forEach(key => html += \`<th>\${key}</th>\`);
                    html += '</tr></thead><tbody>';
                    
                    data.results.forEach(row => {
                        html += '<tr>';
                        keys.forEach(key => {
                            let value = row[key];
                            if (value === null) value = '<em style="color:#666">NULL</em>';
                            else if (typeof value === 'object') value = '<pre>' + JSON.stringify(value, null, 2) + '</pre>';
                            else if (typeof value === 'string' && value.length > 50) value = value.substring(0, 50) + '...';
                            html += \`<td>\${value}</td>\`;
                        });
                        html += '</tr>';
                    });
                    
                    html += '</tbody></table>';
                    html += \`<p style="margin-top: 15px;"><strong>Total:</strong> \${data.count} row(s)</p>\`;
                    return html;
                }
                
                async function loadTable(table) {
                    try {
                        const queries = {
                            users: 'SELECT id, email, pseudo, elo, games_played, wins, losses, created_at FROM users ORDER BY created_at DESC LIMIT 50',
                            rooms: 'SELECT code, host_pseudo, white_pseudo, time_mode, status, created_at, updated_at FROM rooms ORDER BY created_at DESC LIMIT 50',
                            games: 'SELECT id, room_code, black_pseudo, white_pseudo, winner, result_reason, time_mode, started_at, finished_at FROM games ORDER BY started_at DESC LIMIT 50',
                            moves: 'SELECT id, game_id, move_number, player, move_type, to_q, to_r, created_at FROM moves ORDER BY created_at DESC LIMIT 100',
                            elo_history: 'SELECT id, user_id, elo_before, elo_after, elo_change, created_at FROM elo_history ORDER BY created_at DESC LIMIT 50',
                            refresh_tokens: 'SELECT id, user_id, expires_at, created_at FROM refresh_tokens ORDER BY created_at DESC LIMIT 50'
                        };
                        
                        const data = await fetchApi(baseUrl + '/query', {
                            method: 'POST',
                            body: JSON.stringify({ sql: queries[table] })
                        });
                        
                        document.getElementById('results').innerHTML = \`<h4 class="success">✅ \${table.toUpperCase()}</h4>\` + renderTable(data);
                    } catch (err) {
                        document.getElementById('results').innerHTML = \`<p class="error">❌ Error: \${err.message}</p>\`;
                    }
                }
                
                async function loadStats() {
                    try {
                        const data = await fetchApi(baseUrl + '/stats');
                        
                        let html = '<h4 class="success">✅ Database Statistics</h4><div class="stats-grid">';
                        for (const [key, value] of Object.entries(data.stats)) {
                            html += \`<div class="stat-card"><div class="stat-value">\${value}</div><div class="stat-label">\${key.replace(/_/g, ' ')}</div></div>\`;
                        }
                        html += '</div>';
                        html += \`<p style="margin-top: 20px; color: #888;">Last updated: \${data.timestamp}</p>\`;
                        
                        document.getElementById('results').innerHTML = html;
                    } catch (err) {
                        document.getElementById('results').innerHTML = \`<p class="error">❌ Error: \${err.message}</p>\`;
                    }
                }
                
                async function executeQuery() {
                    const sql = document.getElementById('sqlQuery').value.trim();
                    if (!sql) return alert('Please enter a SQL query');
                    
                    try {
                        const data = await fetchApi(baseUrl + '/query', {
                            method: 'POST',
                            body: JSON.stringify({ sql })
                        });
                        
                        if (data.error) {
                            document.getElementById('results').innerHTML = \`<p class="error">❌ \${data.error}</p>\`;
                        } else {
                            document.getElementById('results').innerHTML = '<h4 class="success">✅ Query Results</h4>' + renderTable(data);
                        }
                    } catch (err) {
                        document.getElementById('results').innerHTML = \`<p class="error">❌ Error: \${err.message}</p>\`;
                    }
                }
                
                async function executeModify() {
                    const sql = document.getElementById('modifyQuery').value.trim();
                    if (!sql) return alert('Please enter a SQL command');
                    
                    if (!confirm('⚠️ WARNING\\n\\nThis will permanently modify the production database.\\n\\nCommand: ' + sql.substring(0, 100) + '\\n\\nAre you absolutely sure?')) {
                        return;
                    }
                    
                    try {
                        const data = await fetchApi(baseUrl + '/execute', {
                            method: 'POST',
                            body: JSON.stringify({ sql })
                        });
                        
                        if (data.success) {
                            document.getElementById('results').innerHTML = \`<h4 class="success">✅ \${data.message}</h4><pre>\${JSON.stringify(data, null, 2)}</pre>\`;
                            showToast(data.message);
                        } else {
                            document.getElementById('results').innerHTML = \`<h4 class="error">❌ Error</h4><p class="error">\${data.error}</p>\`;
                            showToast(data.error, true);
                        }
                    } catch (err) {
                        document.getElementById('results').innerHTML = \`<h4 class="error">❌ Error</h4><p class="error">\${err.message}</p>\`;
                        showToast(err.message, true);
                    }
                }
                
                // Check connection on load
                async function checkConnection() {
                    try {
                        const data = await fetchApi(baseUrl + '/stats');
                        document.getElementById('statusDot').style.background = '#4CAF50';
                        document.getElementById('statusText').textContent = 'Connected';
                        loadStats();
                    } catch (err) {
                        document.getElementById('statusDot').style.background = '#f44336';
                        document.getElementById('statusText').textContent = 'Disconnected';
                    }
                }
                
                checkConnection();
            </script>
        </body>
        </html>
    `);
});

module.exports = router;
