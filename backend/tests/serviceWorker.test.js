/**
 * The service worker, and the code that installs it, without a browser.
 *
 * Run with: node tests/serviceWorker.test.js
 *
 * Neither goes wrong where anybody looks. A worker that is never registered
 * leaves a site that works: only playing offline, the offer of an update and
 * notifications are missing, and nobody reports what never appeared. A worker
 * that keeps too much looks right as well, until a rating stops moving or a
 * shared computer shows the last person's account. So sw.js is run here as a
 * browser would run it, with a cache and a network of its own, and update.js
 * is called on a page in each state it can find itself in.
 */

require('./database').none();

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const WEB = path.join(__dirname, '..', '..', 'web');
const SITE = 'https://hexaequo.com';

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ok    ${name}`);
    } catch (error) {
        failed++;
        console.log(`  FAIL  ${name}`);
        console.log(`        ${error.message.split('\n').join('\n        ')}`);
    }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * sw.js, started as a browser starts it for `origin`: with a cache that keeps
 * whatever it is given, and a network that answers everything and remembers
 * what it was asked.
 */
function startWorker(origin) {
    const source = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8').replace('__BUILD__', 'hexaequo-test');
    const handlers = {};
    const stores = new Map();
    const network = [];
    let online = true;

    const address = (request) => new URL(typeof request === 'string' ? request : request.url, `${origin}/sw.js`).href;
    const local = (url) => url.slice(origin.length);
    const fetch = async (request) => {
        const url = address(request);
        network.push(local(url));
        if (!online) throw new TypeError('Failed to fetch');
        return { ok: true, status: 200, type: 'basic', url, clone() { return this; } };
    };
    const caches = {
        open: async (name) => {
            if (!stores.has(name)) stores.set(name, new Map());
            const store = stores.get(name);
            return {
                add: async (request) => { store.set(address(request), await fetch(request)); },
                put: async (request, response) => { store.set(address(request), response); },
            };
        },
        match: async (request) => {
            for (const store of stores.values()) {
                if (store.has(address(request))) return store.get(address(request));
            }
            return undefined;
        },
        keys: async () => [...stores.keys()],
        delete: async (name) => stores.delete(name),
    };
    const scope = {
        location: new URL('/sw.js', origin),
        addEventListener: (type, handler) => { handlers[type] = handler; },
        skipWaiting: () => {},
        clients: { claim: async () => {} },
        caches,
        fetch,
        URL,
        Response,
    };
    scope.self = scope;
    const context = vm.createContext(scope);
    vm.runInContext(source, context);

    return {
        async install() {
            let work = null;
            handlers.install({ waitUntil: (promise) => { work = promise; } });
            await work;
        },
        /** The worker's answer to a GET for `at`, or null when it leaves the request to the network. */
        async ask(at, mode = 'cors') {
            let answer = null;
            handlers.fetch({
                request: { url: origin + at, method: 'GET', mode },
                respondWith: (promise) => { answer = promise; },
            });
            return answer ? local((await answer).url) : null;
        },
        kept: () => [...stores.values()].flatMap((store) => [...store.keys()].map(local)),
        network,
        offline: () => { online = false; },
        development: () => vm.runInContext('DEVELOPMENT', context),
        shell: () => [...vm.runInContext('SHELL', context)],
    };
}

/**
 * A page for update.js to find itself on: finished loading or not yet, with a
 * worker in charge or none. Only what update.js touches is there.
 */
function page({ readyState, controlled }) {
    const listeners = new Map();
    const target = (name) => ({
        addEventListener: (type, fn) => listeners.set(`${name}:${type}`, [...(listeners.get(`${name}:${type}`) || []), fn]),
    });
    const fire = (name, type) => (listeners.get(`${name}:${type}`) || []).forEach((fn) => fn());
    const seen = { registered: [], reloads: 0 };

    const registration = { ...target('registration'), waiting: null, installing: null, update: async () => {} };
    const container = {
        ...target('container'),
        controller: controlled ? {} : null,
        register: async (url) => { seen.registered.push(url); return registration; },
    };
    const element = () => ({
        setAttribute() {}, addEventListener() {}, remove() {}, classList: { add() {}, remove() {} },
    });
    Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: container }, configurable: true, writable: true });
    globalThis.document = {
        ...target('document'), readyState, visibilityState: 'visible',
        createElement: element, body: { appendChild() {} },
    };
    globalThis.window = { ...target('window'), location: { reload: () => { seen.reloads++; } } };
    globalThis.requestAnimationFrame = () => 0;

    return {
        seen,
        load() {
            globalThis.document.readyState = 'complete';
            fire('window', 'load');
        },
        /** A worker takes charge of the page, as clients.claim() or skipWaiting() makes it. */
        takeOver() {
            container.controller = {};
            fire('container', 'controllerchange');
        },
        /** A new version is found and finishes downloading. */
        newVersion() {
            const worker = { ...target('worker'), state: 'installing' };
            registration.installing = worker;
            fire('registration', 'updatefound');
            worker.state = 'installed';
            fire('worker', 'statechange');
        },
    };
}

/* A module instance of its own for each page, so nothing one test did to
   update.js's state is still there in the next. */
let instance = 0;
const fresh = (relative) => import(`${pathToFileURL(path.join(WEB, 'src', relative)).href}?${++instance}`);

async function run() {
    console.log('\nThe service worker (sw.js)\n');

    await test('on a development machine it keeps nothing and answers nothing', async () => {
        for (const origin of ['http://localhost:3001', 'http://127.0.0.1:8001', 'http://[::1]:3001']) {
            const worker = startWorker(origin);
            assert.strictEqual(worker.development(), true, `${origin} is a development machine`);
            await worker.install();
            assert.deepStrictEqual(worker.kept(), [], `${origin}: nothing kept`);
            assert.strictEqual(await worker.ask('/src/main.js'), null, `${origin}: left to the network`);
        }
    });

    await test('anywhere else it keeps the whole app once installed', async () => {
        const worker = startWorker(SITE);
        assert.strictEqual(worker.development(), false);
        await worker.install();
        const shell = worker.shell().map((entry) => new URL(entry, `${SITE}/`).pathname);
        assert.deepStrictEqual(worker.kept().sort(), shell.sort());
    });

    await test('every file it lists is in web/', () => {
        const missing = startWorker(SITE).shell()
            .map((entry) => (entry === './' ? './index.html' : entry))
            .filter((entry) => !fs.existsSync(path.join(WEB, entry)));
        assert.deepStrictEqual(missing, []);
    });

    await test("the app's files are answered from the cache, without the network", async () => {
        const worker = startWorker(SITE);
        await worker.install();
        worker.network.length = 0;
        for (const at of ['/src/main.js', '/styles/app.css', '/src/locales/fr.json', '/manifest.webmanifest']) {
            assert.strictEqual(await worker.ask(at), at);
        }
        assert.deepStrictEqual(worker.network, []);
    });

    await test('one of its files that the list leaves out is fetched once, then kept', async () => {
        const worker = startWorker(SITE);
        await worker.install();
        worker.network.length = 0;
        assert.strictEqual(await worker.ask('/assets/share-fr.png'), '/assets/share-fr.png');
        await settle();
        assert.strictEqual(await worker.ask('/assets/share-fr.png'), '/assets/share-fr.png');
        assert.deepStrictEqual(worker.network, ['/assets/share-fr.png']);
    });

    await test('the API, the socket and the rest of the site are left to the network, and none of it is kept', async () => {
        const worker = startWorker(SITE);
        await worker.install();
        const kept = worker.kept().length;
        for (const at of [
            '/api/auth/me', '/api/version', '/api/profile/me', '/api/users/leaderboard?limit=20&page=1',
            '/socket.io/socket.io.js', '/socket.io/?EIO=4&transport=polling&t=PfK1x2',
            '/robots.txt', '/sitemap.xml',
        ]) {
            assert.strictEqual(await worker.ask(at), null, `${at} goes to the network`);
        }
        await settle();
        assert.strictEqual(worker.kept().length, kept);
    });

    await test('offline, any address opens the shell, which finds its page from the path', async () => {
        const worker = startWorker(SITE);
        await worker.install();
        worker.offline();
        assert.strictEqual(await worker.ask('/fr/regles/', 'navigate'), '/index.html');
    });

    console.log('\nInstalling it (update.js)\n');

    await test('the worker is registered when the page finished loading before the app got that far', async () => {
        const at = page({ readyState: 'complete', controlled: false });
        (await fresh('update.js')).watchForUpdates();
        await settle();
        assert.deepStrictEqual(at.seen.registered, ['/sw.js']);
    });

    await test('and on a page still loading, once it has loaded', async () => {
        const at = page({ readyState: 'interactive', controlled: false });
        (await fresh('update.js')).watchForUpdates();
        await settle();
        assert.deepStrictEqual(at.seen.registered, [], 'not before');
        at.load();
        await settle();
        assert.deepStrictEqual(at.seen.registered, ['/sw.js']);
    });

    await test("the first worker taking charge of a new visitor's page does not reload it", async () => {
        const at = page({ readyState: 'complete', controlled: false });
        (await fresh('update.js')).watchForUpdates();
        await settle();
        at.takeOver();
        assert.strictEqual(at.seen.reloads, 0);
    });

    await test('a version offered to that page afterwards does reload it when it takes over', async () => {
        const at = page({ readyState: 'complete', controlled: false });
        (await fresh('update.js')).watchForUpdates();
        await settle();
        at.takeOver();
        at.newVersion();
        at.takeOver();
        assert.strictEqual(at.seen.reloads, 1);
    });

    await test('a new version taking over from the old one reloads the page, once', async () => {
        const at = page({ readyState: 'complete', controlled: true });
        (await fresh('update.js')).watchForUpdates();
        await settle();
        at.takeOver();
        at.takeOver();
        assert.strictEqual(at.seen.reloads, 1);
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
