/**
 * The server with nothing behind it.
 *
 * For trying the online flow by hand -- two tabs, a room, a rematch -- without
 * a database in the process: every query fails by name, so a game played
 * through this server cannot leave a row anywhere, and the .env's DATABASE_URL
 * is never read because this one is set first and dotenv does not overwrite.
 * Guests only, since an account cannot be looked up; that is the point.
 *
 *   node backend/scripts/devNoDatabase.js
 */
process.env.DATABASE_URL = 'memory';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '3001';
require('../server');
