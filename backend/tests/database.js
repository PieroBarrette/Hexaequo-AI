/**
 * Which database a test is allowed to touch.
 *
 * Required before anything else, so that it settles DATABASE_URL before
 * config/env reads it — dotenv does not overwrite a variable that is already
 * set, so whatever is decided here is what the process gets.
 *
 * There are two kinds of suite here. Most need no database at all and only
 * ever reached one because the code under test records a finished game; those
 * call `none()` and every query in the process then fails immediately rather
 * than travelling to whatever DATABASE_URL happens to name. The rest genuinely
 * write rows, and they get a database only when TEST_DATABASE_URL says which —
 * never the application's own. Pointing them somewhere by default is how test
 * accounts and test games ended up in the live database, and the live database
 * is one people are playing in.
 *
 *   TEST_DATABASE_URL=postgresql://localhost:5432/hexaequo_test npm run test:db
 */

/** No database in this process. Every query fails, fast and by name. */
function none() {
    process.env.DATABASE_URL = 'memory';
}

/**
 * A throwaway database, or nothing.
 *
 * Returns false when TEST_DATABASE_URL is not set, and leaves the process
 * without a database so that a suite carrying on regardless still cannot reach
 * the live one. Callers are expected to say they are skipping and stop.
 */
function throwaway() {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
        none();
        return false;
    }
    process.env.DATABASE_URL = url;
    return true;
}

/**
 * Stop, loudly, unless a throwaway database was named.
 *
 * Exits 0: not having a test database is not a failing test, it is the suite
 * having nothing to run against. The message has to be plain enough that a
 * skipped suite is never mistaken for a passing one.
 */
function requireThrowaway(suite) {
    if (throwaway()) return true;
    console.log(`\n  SKIPPED  ${suite}`);
    console.log('  These tests write rows, so they need a database of their own.');
    console.log('  Set TEST_DATABASE_URL to one you do not mind them filling:');
    console.log('    TEST_DATABASE_URL=postgresql://localhost:5432/hexaequo_test'
        + ` node tests/${suite}\n`);
    process.exit(0);
}

module.exports = { none, throwaway, requireThrowaway };
