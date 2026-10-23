/**
 * The pages with an address of their own, as a search engine finds them.
 *
 * Run with: node tests/pages.test.js
 *
 * Every page of the site is the game; the rules, the guide, the FAQ and the
 * rest are panels with a path each (web/src/pages.js), and the documents at
 * those paths are written by scripts/makePages.js from the same functions
 * the panels draw with. What can go wrong is quiet: a locale changes and the
 * documents keep the old words, a path stops matching its page, a copy of
 * the shell loads its scripts from a relative path that breaks one folder
 * down. None of that shows in the app — it shows in a search result. So it
 * is checked here, with no database and no browser.
 */

require('./database').none();

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
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

const load = (relative) => import(pathToFileURL(path.join(WEB, 'src', relative)).href);
const read = (at) => fs.readFileSync(path.join(WEB, at, 'index.html'), 'utf8');
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(WEB, 'src/locales', `${lang}.json`), 'utf8'));

async function run() {
    const { PAGES, UNLISTED, pathOf, pageAt } = await load('pages.js');
    const names = Object.keys(PAGES);

    console.log('\nPages with an address\n');

    await test('the documents in web/ are what makePages.js writes today', () => {
        try {
            execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'makePages.js'), '--check'],
                { stdio: 'pipe' });
        } catch (error) {
            throw new Error(String(error.stdout || error.message).trim());
        }
    });

    await test('every page has a path in each language, and each path names its page', () => {
        for (const name of names) {
            for (const lang of ['en', 'fr']) {
                const at = pathOf(name, lang);
                assert.ok(at.startsWith('/') && at.endsWith('/'), `${name}/${lang}: ${at}`);
                assert.deepStrictEqual(pageAt(at), { name, language: lang });
                assert.deepStrictEqual(pageAt(at.slice(0, -1)), { name, language: lang }, 'without the slash too');
                assert.deepStrictEqual(pageAt(at + 'index.html'), { name, language: lang });
            }
        }
        assert.strictEqual(pageAt('/'), null);
        assert.strictEqual(pageAt('/fr/'), null);
        assert.strictEqual(pageAt('/nowhere/'), null);
    });

    await test('each document says which page it is, in its own language', () => {
        for (const name of names) {
            for (const lang of ['en', 'fr']) {
                const html = read(pathOf(name, lang));
                const here = `${SITE}${pathOf(name, lang)}`;
                const where = `${name}/${lang}`;
                assert.ok(html.startsWith('<!doctype html>\n<html lang="' + lang + '"'), `${where}: lang`);
                assert.ok(html.includes(`<link rel="canonical" href="${here}">`), `${where}: canonical`);
                for (const l of ['en', 'fr']) {
                    assert.ok(html.includes(`hreflang="${l}" href="${SITE}${pathOf(name, l)}"`), `${where}: hreflang ${l}`);
                }
                assert.strictEqual(html.includes('content="noindex'), UNLISTED.has(name),
                    `${where}: listed or not, as pages.js says`);
                assert.strictEqual((html.match(/<title>/g) || []).length, 1, `${where}: one title`);
                assert.ok(/<article class="page-text">\s*(<div class="legal">\s*)?<h1>/.test(html),
                    `${where}: the page itself is in the document, heading first`);
                for (const block of html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []) {
                    JSON.parse(block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
                }
            }
        }
    });

    const documents = ['index.html', ...names.map((name) => path.join(pathOf(name, 'fr'), 'index.html'))];

    await test('the shell loads everything from the root, so it works at /fr/regles/ too', () => {
        for (const file of documents) {
            const html = fs.readFileSync(path.join(WEB, file), 'utf8');
            const relative = [...html.matchAll(/(?:src|href)="([^"]*)"/g)].map((m) => m[1])
                .filter((value) => !/^(\/|https?:|#|mailto:|data:)/.test(value));
            assert.deepStrictEqual(relative, [], `${file}: relative paths`);
        }
    });

    await test('every page can be zoomed', () => {
        for (const file of [...documents, ...names.map((name) => path.join(pathOf(name, 'en'), 'index.html'))]) {
            const html = fs.readFileSync(path.join(WEB, file), 'utf8');
            const viewport = html.match(/<meta name="viewport" content="([^"]*)">/);
            assert.ok(viewport, `${file}: a viewport`);
            assert.ok(!/user-scalable|maximum-scale/.test(viewport[1]), `${file}: ${viewport[1]}`);
        }
    });

    await test('every link between pages leads to a page that exists', () => {
        for (const name of names) {
            for (const lang of ['en', 'fr']) {
                const html = read(pathOf(name, lang));
                const view = html.slice(html.indexOf('<!-- page:view -->'), html.indexOf('<!-- /page:view -->'));
                for (const [, href] of view.matchAll(/href="(\/[^"#]*)"/g)) {
                    assert.ok(href === '/' || pageAt(href), `${name}/${lang} links to ${href}`);
                }
            }
        }
    });

    await test('the FAQ data says what the page says', () => {
        for (const lang of ['en', 'fr']) {
            const html = read(pathOf('faq', lang));
            const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
            const data = JSON.parse(block);
            const items = locale(lang).faq.items;
            assert.strictEqual(data['@type'], 'FAQPage');
            assert.strictEqual(data.mainEntity.length, items.length, `${lang}: every question`);
            data.mainEntity.forEach((entry, i) => {
                assert.strictEqual(entry.name, items[i][0].replace(/<[^>]+>/g, ''));
                assert.ok(html.includes(`<h3>${items[i][0]}</h3>`), `${lang}: question ${i + 1} is on the page`);
            });
        }
    });

    await test('the rules data says how to win, and no step stops at a colon', () => {
        const plain = (html) => html.replace(/<[^>]+>/g, '');
        for (const lang of ['en', 'fr']) {
            const html = read(pathOf('rules', lang));
            const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
            const words = locale(lang).rules;
            assert.strictEqual(data['@type'], 'HowTo');
            for (const step of data.step) {
                assert.ok(!/:\s*$/.test(step.text), `${lang}: "${step.name}" ends where its list should begin`);
            }
            const winning = data.step.find((step) => step.name === plain(words.goalTitle));
            assert.ok(winning, `${lang}: a step says how to win`);
            for (const key of ['goalDisks', 'goalRings', 'goalCleared']) {
                assert.ok(winning.text.includes(plain(words[key])), `${lang}: winning names ${key}`);
            }
        }
    });

    await test('the sitemap lists the home and every listed page, in both languages', () => {
        const sitemap = fs.readFileSync(path.join(WEB, 'sitemap.xml'), 'utf8');
        const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
        const expected = [`${SITE}/`, ...names.filter((n) => !UNLISTED.has(n))
            .flatMap((name) => ['en', 'fr'].map((lang) => `${SITE}${pathOf(name, lang)}`))];
        assert.deepStrictEqual(locs.sort(), expected.sort());
    });

    await test('nothing on the pages still offers Google sign-in, or rates a game without a clock', () => {
        for (const lang of ['en', 'fr']) {
            const faq = JSON.stringify(locale(lang).faq);
            assert.ok(!/compte Google|Google account/.test(faq), `${lang}: Google`);
            assert.ok(/clock|pendule/.test(locale(lang).faq.items[6][1]), `${lang}: rated games need a clock`);
        }
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
