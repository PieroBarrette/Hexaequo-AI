/**
 * Write the documents behind the pages that have an address of their own,
 * the sitemap and robots.txt that list them, and 404.html for the addresses
 * that are none of them.
 *
 * Usage:
 *   node scripts/makePages.js           write them into web/
 *   node scripts/makePages.js <dir>     write them into <dir> instead
 *   node scripts/makePages.js --check   write nothing; exit 1 if web/ is stale
 *
 * Every page of the site is the game. The rules, the page about the game, the
 * guide, the FAQ and the two policies are panels of the app (web/src/pages.js),
 * and each has a path in each language — /rules/ and /fr/regles/, and so on.
 * Opened at its path, the app starts with the panel drawn over the home
 * screen. The document at that path is web/index.html with three parts
 * replaced, between its page:head, page:data and page:view markers:
 *
 *   - what a search result is made of: the title, the description, the
 *     canonical address and its other language, and whether to list it;
 *   - the structured data that says what kind of page it is;
 *   - the copy shown before the app starts, which is the page itself, words
 *     and diagrams, for whatever reads the document without running it.
 *
 * The words come from web/src/content/, the very functions the app's panels
 * draw with, reading the same locale files — so what a crawler indexes and
 * what a player opens cannot say different things. Run this whenever a locale,
 * a page in content/, or web/index.html changes; the output is committed, and
 * tests/pages.test.js fails when it has fallen behind.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const WEB = path.join(ROOT, 'web');
const SITE = 'https://hexaequo.com';
const LANGUAGES = ['en', 'fr'];

const CHECK = process.argv[2] === '--check';
const OUT = CHECK
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'hexaequo-pages-'))
    : (process.argv[2] ? path.resolve(process.argv[2]) : WEB);

const locales = Object.fromEntries(LANGUAGES.map((lang) =>
    [lang, JSON.parse(fs.readFileSync(path.join(WEB, 'src/locales', `${lang}.json`), 'utf8'))]));

function walk(bundle, dotted) {
    let node = bundle;
    for (const part of dotted.split('.')) {
        if (node == null || typeof node !== 'object') return undefined;
        node = node[part];
    }
    return node;
}

/** What content/ reads the locale with — the app's t() and raw(), in Node. */
function reader(lang) {
    const raw = (dotted) => {
        const own = walk(locales[lang], dotted);
        return own !== undefined ? own : walk(locales.en, dotted);
    };
    const t = (dotted, vars) => {
        const found = raw(dotted);
        if (typeof found !== 'string') return dotted;
        return vars
            ? found.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
            : found;
    };
    return { t, raw, language: lang };
}

const escape = (value) => String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Words alone: a description is text, and some of the sources are HTML. */
const plain = (html) => String(html).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** Replace what lies between <!-- name --> and <!-- /name -->. */
function fill(template, name, contents) {
    const open = `<!-- ${name} -->`;
    const close = `<!-- /${name} -->`;
    const start = template.indexOf(open);
    const end = template.indexOf(close);
    if (start < 0 || end < start) throw new Error(`web/index.html has no ${name} markers`);
    return template.slice(0, start + open.length) + '\n' + contents + '\n' + template.slice(end);
}

const SPELLINGS = ['hexeko', 'hexaco', 'hexeco', 'hexequo', 'hexaquo', 'exako', 'exeko'];

/* ── Structured data ────────────────────────────────────────────────────── */

/*
 * What the game is, in a form a machine can read.
 *
 * Search engines use this for rich results, and the assistants that now answer
 * "what board games can I play in a browser" read the same thing. Left out of
 * the policies, which describe no product.
 */
function gameSchema(tr) {
    return {
        '@context': 'https://schema.org',
        '@type': 'VideoGame',
        name: 'Hexaequo',
        alternateName: ['Hexæquo', 'Hex aequo', ...SPELLINGS],
        url: `${SITE}/`,
        description: plain(tr.t('about.description')),
        inLanguage: LANGUAGES,
        image: `${SITE}/assets/icons/icon-512x512.png`,
        genre: ['Abstract strategy', 'Board game', 'Strategy'],
        gamePlatform: ['Web browser', 'Progressive Web App'],
        playMode: ['SinglePlayer', 'MultiPlayer'],
        numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 2 },
        applicationCategory: 'GameApplication',
        operatingSystem: 'Any',
        author: { '@type': 'Person', name: 'Piero Barrette' },
        publisher: { '@type': 'Person', name: 'Piero Barrette' },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'CAD', availability: 'https://schema.org/InStock' },
        isAccessibleForFree: true,
    };
}

function rulesSchema(tr) {
    const step = (name, ...texts) => ({
        '@type': 'HowToStep',
        name: plain(tr.t(name)),
        text: texts.map((text) => plain(tr.t(text))).join(' '),
    });
    return {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: `${tr.t('rules.title')} — Hexaequo`,
        description: plain(tr.t('rules.lede')),
        inLanguage: tr.language,
        totalTime: 'PT5M',
        step: [
            step('rules.setupTitle', 'rules.setupText'),
            step('rules.turnTitle', 'rules.turnText'),
            step('rules.tileTitle', 'rules.tileText'),
            step('rules.placeTitle', 'rules.placeText'),
            step('rules.diskTitle', 'rules.diskText'),
            step('rules.ringTitle', 'rules.ringText'),
            /* The way to win is a sentence ending in a colon and the list it
               introduces. The page shows both; the step has to carry both
               too, or it says there are conditions and stops. */
            step('rules.goalTitle', 'rules.goalIntro', 'rules.goalDisks', 'rules.goalRings', 'rules.goalCleared'),
        ],
    };
}

/* The guide is an article about the game rather than the game itself. */
function guideSchema(tr, url) {
    return {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: tr.t('guide.docTitle'),
        description: plain(tr.t('guide.description')),
        inLanguage: tr.language,
        url,
        image: `${SITE}/assets/icons/icon-512x512.png`,
        about: { '@type': 'VideoGame', name: 'Hexaequo', url: `${SITE}/` },
        author: { '@type': 'Person', name: 'Piero Barrette' },
    };
}

/*
 * The questions as FAQPage data. The answers are the page's own, links and
 * all; only the links are made absolute, since an answer quoted in a search
 * result is read away from the page it came from.
 */
function faqSchema(tr, faqItems) {
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        inLanguage: tr.language,
        mainEntity: faqItems(tr).map(([question, answer]) => ({
            '@type': 'Question',
            name: plain(question),
            acceptedAnswer: {
                '@type': 'Answer',
                text: answer.replace(/ data-panel="[^"]*"/g, '').replace(/href="\//g, `href="${SITE}/`),
            },
        })),
    };
}

function jsonLd(schema) {
    /* "</" cannot be allowed to end the script element early, and a JSON
       string can say it in a way HTML will not mistake. */
    return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2).replace(/<\//g, '<\\/')}\n</script>`;
}

/* ── One page ───────────────────────────────────────────────────────────── */

/*
 * The picture a shared link is previewed with: the card makeShareImage.js
 * draws for each language, at the size the large preview layouts are made
 * for, so it is shown whole rather than cropped from an icon.
 */
const SHARE = { width: 1200, height: 630 };

function shareCard(tr) {
    return [
        `<meta property="og:image" content="${SITE}/assets/share-${tr.language}.png">`,
        `<meta property="og:image:width" content="${SHARE.width}">`,
        `<meta property="og:image:height" content="${SHARE.height}">`,
        `<meta property="og:image:alt" content="${escape(tr.t('meta.shareAlt'))}">`,
        '<meta name="twitter:card" content="summary_large_image">',
    ];
}

function pageDocument(template, { name, lang, content, pathOf, unlisted, schema }) {
    const tr = reader(lang);
    const page = content[name];
    const other = lang === 'en' ? 'fr' : 'en';
    const here = `${SITE}${pathOf(name, lang)}`;
    const title = page.docTitle(tr);
    const description = plain(page.description(tr));

    const head = [
        `<title>${escape(title)}</title>`,
        `<meta name="description" content="${escape(description)}">`,
        `<link rel="canonical" href="${here}">`,
        ...LANGUAGES.map((l) => `<link rel="alternate" hreflang="${l}" href="${SITE}${pathOf(name, l)}">`),
        `<link rel="alternate" hreflang="x-default" href="${SITE}${pathOf(name, 'en')}">`,
        /* The policies are for the people who go looking for them, not for
           search results they would only dilute. */
        ...(unlisted ? ['<meta name="robots" content="noindex, follow">'] : []),
        '',
        `<meta property="og:type" content="${name === 'about' ? 'website' : 'article'}">`,
        '<meta property="og:site_name" content="Hexaequo">',
        `<meta property="og:title" content="${escape(title)}">`,
        `<meta property="og:url" content="${here}">`,
        `<meta property="og:description" content="${escape(description)}">`,
        `<meta property="og:locale" content="${lang === 'fr' ? 'fr_CA' : 'en_US'}">`,
        ...shareCard(tr),
    ].join('\n');

    /* The page itself, as the panel draws it, for whatever does not run the
       app. A way home, and the same page in the other language, around it. */
    const view = `  <div class="boot-copy boot-page">
    <p class="boot-crumbs"><a href="/">Hexaequo</a> · <a href="${pathOf(name, other)}" hreflang="${other}">${other === 'fr' ? 'Français' : 'English'}</a></p>
    <article class="page-text">${page.html(tr)}
    </article>
    <p class="boot-crumbs"><a href="/#/play">${escape(tr.t('home.play'))}</a> · <a href="/">Hexaequo</a></p>
  </div>`;

    let html = template.replace(/<html lang="[a-z]+"/, `<html lang="${lang}"`);
    if (lang === 'fr') {
        html = html.replace('Hexaequo needs JavaScript to play, but everything above describes the game.',
            'Hexaequo a besoin de JavaScript pour jouer, mais tout ce qui précède décrit le jeu.');
    }
    html = fill(html, 'page:head', head);
    html = fill(html, 'page:data', schema ? jsonLd(schema) : '');
    html = fill(html, 'page:view', view);
    return html;
}

/* ── An address with nothing behind it ──────────────────────────────────── */

/*
 * The page routes/siteRoutes.js sends, with a 404, for a path that is neither
 * a file nor one of the pages above.
 *
 * Not a copy of the shell. The app would start, draw the home screen over the
 * message and leave the visitor at the menu, at an address that does not
 * exist and none the wiser. This is a page of its own, without the app: what
 * happened, the way home, the way to the rules. In both languages, since a
 * path that leads nowhere says nothing about who typed it. Every address in
 * it is absolute, because it is served at whatever depth the bad path had.
 */
function notFoundDocument(pathOf, logoMarkSvg) {
    const part = (lang, heading) => {
        const { t } = reader(lang);
        return `    <section lang="${lang}">
      <${heading}>${escape(t('notFound.title'))}</${heading}>
      <p>${escape(t('notFound.text'))}</p>
      <p><a href="/">${escape(t('notFound.home'))}</a> · <a href="${pathOf('rules', lang)}">${escape(t('notFound.rules'))}</a></p>
    </section>`;
    };
    return `<!doctype html>
<html lang="en" data-theme="dark" data-board-style="modern">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0e1015">
<!-- Written by backend/scripts/makePages.js; edit it there. -->
<title>${escape(reader('en').t('notFound.title'))} · ${escape(reader('fr').t('notFound.title'))} — Hexaequo</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/assets/icons/icon-192x192.png" sizes="192x192">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<script src="/src/bootTheme.js"></script>
<link rel="stylesheet" href="/styles/tokens.css">
<link rel="stylesheet" href="/styles/app.css">
</head>
<body>
<main class="page not-found">
  <div class="boot-copy">
    <a class="not-found-mark" href="/">${logoMarkSvg()}</a>
    <h1>Hexaequo</h1>
${part('en', 'h2')}
${part('fr', 'h2')}
  </div>
</main>
</body>
</html>
`;
}

/* ── All of them ────────────────────────────────────────────────────────── */

async function load(relative) {
    return import(pathToFileURL(path.join(WEB, 'src', relative)).href);
}

async function build() {
    const { PAGES, UNLISTED, pathOf } = await load('pages.js');
    const { CONTENT } = await load('content/index.js');
    const { faqItems } = await load('content/faq.js');
    const { logoMarkSvg } = await load('ui/logo.js');
    const template = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');

    const schemaFor = (name, tr) => ({
        about: () => gameSchema(tr),
        rules: () => rulesSchema(tr),
        guide: () => guideSchema(tr, `${SITE}${pathOf('guide', tr.language)}`),
        faq: () => faqSchema(tr, faqItems),
    }[name] || (() => null))();

    const written = [];
    for (const name of Object.keys(PAGES)) {
        for (const lang of LANGUAGES) {
            const at = pathOf(name, lang);
            const html = pageDocument(template, {
                name, lang, pathOf,
                content: CONTENT,
                unlisted: UNLISTED.has(name),
                schema: schemaFor(name, reader(lang)),
            });
            const target = path.join(OUT, at, 'index.html');
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, html);
            written.push([at, html.length]);
        }
    }

    /* robots.txt and the sitemap describe what was just written, so they are
       built from the same list rather than kept in step by hand. No dates and
       no priorities: Google ignores priorities, and a date that changes on
       every run would make the output stale every day. */
    const listed = Object.keys(PAGES).filter((name) => !UNLISTED.has(name));
    const entry = (loc, alternates) => `  <url>
    <loc>${loc}</loc>${alternates.map(([l, href]) => `
    <xhtml:link rel="alternate" hreflang="${l}" href="${href}"/>`).join('')}
  </url>`;
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[
        entry(`${SITE}/`, []),
        ...listed.flatMap((name) => LANGUAGES.map((lang) => entry(
            `${SITE}${pathOf(name, lang)}`,
            [...LANGUAGES.map((l) => [l, `${SITE}${pathOf(name, l)}`]), ['x-default', `${SITE}${pathOf(name, 'en')}`]],
        ))),
    ].join('\n')}
</urlset>
`;
    fs.writeFileSync(path.join(OUT, 'sitemap.xml'), sitemap);

    const robots = `# Hexaequo — https://hexaequo.com
User-agent: *
Allow: /

# The app's own routes are fragments of one page; there is nothing behind
# these paths for a crawler to read.
Disallow: /api/
Disallow: /socket.io/

Sitemap: ${SITE}/sitemap.xml
`;
    fs.writeFileSync(path.join(OUT, 'robots.txt'), robots);

    fs.writeFileSync(path.join(OUT, '404.html'), notFoundDocument(pathOf, logoMarkSvg));

    const files = [...written.map(([at]) => path.join(at, 'index.html')), 'sitemap.xml', 'robots.txt', '404.html'];
    if (CHECK) {
        const stale = files.filter((file) => {
            const fresh = fs.readFileSync(path.join(OUT, file), 'utf8');
            let committed = null;
            try { committed = fs.readFileSync(path.join(WEB, file), 'utf8'); } catch { /* missing */ }
            return committed === null || committed.replace(/\r\n/g, '\n') !== fresh.replace(/\r\n/g, '\n');
        });
        fs.rmSync(OUT, { recursive: true, force: true });
        if (stale.length) {
            console.log('Out of date — run node scripts/makePages.js:\n  ' + stale.join('\n  '));
            process.exit(1);
        }
        console.log(`All ${files.length} generated files are up to date.`);
        return;
    }

    console.log('\nPages written:\n');
    for (const [at, size] of written) console.log(`  ${at.padEnd(24)} ${(size / 1024).toFixed(1)} KB`);
    console.log(`\n  sitemap.xml              ${1 + listed.length * LANGUAGES.length} urls`);
    console.log('  robots.txt');
    console.log('  404.html');
    console.log(`\n✅ ${written.length} pages\n`);
}

build().catch((error) => {
    console.error(error);
    process.exit(1);
});
