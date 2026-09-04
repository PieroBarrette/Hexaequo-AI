/**
 * Build the pages a search engine can actually read.
 *
 * Usage: node scripts/makePages.js
 *
 * The app is one URL behind a hash router, which means every screen after the
 * home page is invisible to a crawler: fragments are not addresses, and a site
 * with one page has almost nothing to rank. These are real files at real paths,
 * with the words already in the source rather than assembled by script.
 *
 * Every string comes from the same locale files the app uses, so the published
 * rules cannot drift from the rules people play by. Run this whenever the
 * locales change; the output is committed.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const WEB = path.join(ROOT, 'web');
const SITE = 'https://hexaequo.com';
/* Kept beside the app's own copy in views/legal.js; both must say the same. */
const CONTACT_EMAIL = 'info@hexaequo.com';

const locales = {
    en: JSON.parse(fs.readFileSync(path.join(WEB, 'src/locales/en.json'), 'utf8')),
    fr: JSON.parse(fs.readFileSync(path.join(WEB, 'src/locales/fr.json'), 'utf8')),
};

/** Look a dotted key up in a bundle, falling back to English. */
function text(lang, dotted) {
    const walk = (bundle) => dotted.split('.').reduce(
        (node, part) => (node && typeof node === 'object' ? node[part] : undefined), bundle);
    const found = walk(locales[lang]);
    return typeof found === 'string' ? found : (walk(locales.en) || dotted);
}

const escape = (value) => String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/*
 * Where each page lives, in each language.
 *
 * Separate addresses rather than one page that switches: a crawler indexes an
 * address, and two languages sharing one cannot both be found.
 */
const PAGES = {
    rules: { en: 'rules/', fr: 'fr/regles/' },
    privacy: { en: 'privacy/', fr: 'fr/confidentialite/' },
    terms: { en: 'terms/', fr: 'fr/conditions/' },
    play: { en: 'play/', fr: 'fr/jouer/' },
};

const OTHER = { en: 'fr', fr: 'en' };

/** The mark, inline, so a content page needs nothing but itself. */
const logo = fs.readFileSync(path.join(WEB, 'assets/logo.svg'), 'utf8')
    .replace(/<\?xml[^>]*\?>/, '')
    .replace('<svg', '<svg class="mark" aria-hidden="true"')
    .trim();

/**
 * One page.
 *
 * `appRoute` is where the same thing lives inside the app, so a reader who
 * arrives from a search can step straight into it.
 */
function page({ lang, slug, title, description, appRoute, body, schema, noindex }) {
    const here = `${SITE}/${PAGES[slug][lang]}`;
    const there = `${SITE}/${PAGES[slug][OTHER[lang]]}`;
    const label = { en: 'Play Hexaequo', fr: 'Jouer à Hexaequo' }[lang];
    const otherLabel = { en: 'Français', fr: 'English' }[lang];
    const home = { en: 'Home', fr: 'Accueil' }[lang];

    return `<!doctype html>
<html lang="${lang}" data-theme="dark" data-board-style="modern">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0e1015">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
${noindex ? '<meta name="robots" content="noindex, follow">\n' : ''}<link rel="canonical" href="${here}">
<link rel="alternate" hreflang="${lang}" href="${here}">
<link rel="alternate" hreflang="${OTHER[lang]}" href="${there}">
<link rel="alternate" hreflang="x-default" href="${SITE}/${PAGES[slug].en}">

<meta property="og:type" content="article">
<meta property="og:site_name" content="Hexaequo">
<meta property="og:title" content="${escape(title)}">
<meta property="og:url" content="${here}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:image" content="${SITE}/assets/icons/icon-512x512.png">
<meta name="twitter:card" content="summary">

<link rel="icon" href="/assets/icons/icon-192x192.png" sizes="192x192">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/styles/tokens.css">
<link rel="stylesheet" href="/styles/page.css">
${schema ? `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>` : ''}
</head>
<body>
<header class="doc-head">
  <a class="doc-brand" href="/">${logo}<span>HEXAEQUO</span></a>
  <nav class="doc-nav">
    <a href="/">${home}</a>
    <a href="/${PAGES.rules[lang]}">${text(lang, 'rules.title')}</a>
    <a href="/${PAGES[slug][OTHER[lang]]}" hreflang="${OTHER[lang]}">${otherLabel}</a>
  </nav>
</header>

<main class="doc">
${body}
  <p class="doc-cta"><a class="doc-button" href="/#/${appRoute}">${label}</a></p>
</main>

<footer class="doc-foot">
  <p>${escape(text(lang, 'home.credit'))}</p>
  <p>
    <a href="/${PAGES.privacy[lang]}">${escape(text(lang, 'nav.privacy'))}</a> ·
    <a href="/${PAGES.terms[lang]}">${escape(text(lang, 'nav.terms'))}</a> ·
    <a href="/${PAGES.rules[lang]}">${escape(text(lang, 'rules.title'))}</a>
  </p>
</footer>
</body>
</html>
`;
}

/* ── The rules, in full ─────────────────────────────────────────────────── */

function rulesBody(lang) {
    const p = (key) => `  <p>${text(lang, key)}</p>`;
    const h = (key) => `  <h2>${escape(text(lang, key))}</h2>`;
    const section = (titleKey, textKey, captionKey) =>
        `${h(titleKey)}\n${p(textKey)}\n  <p class="doc-caption">${text(lang, captionKey)}</p>`;

    return `  <h1>${escape(text(lang, 'rules.title'))} — Hexaequo</h1>
  <p class="doc-lede">${text(lang, 'rules.lede')}</p>

${h('rules.goalTitle')}
${p('rules.goalIntro')}
  <ul>
    <li>${text(lang, 'rules.goalDisks')}</li>
    <li>${text(lang, 'rules.goalRings')}</li>
    <li>${text(lang, 'rules.goalCleared')}</li>
  </ul>

${h('rules.materialTitle')}
${p('rules.materialText')}

${section('rules.setupTitle', 'rules.setupText', 'rules.setupCaption')}

${h('rules.turnTitle')}
${p('rules.turnText')}

${section('rules.tileTitle', 'rules.tileText', 'rules.tileCaption')}
${section('rules.placeTitle', 'rules.placeText', 'rules.placeCaption')}
${section('rules.diskTitle', 'rules.diskText', 'rules.diskCaption')}
${p('rules.diskLoop')}
${section('rules.ringTitle', 'rules.ringText', 'rules.ringCaption')}

${h('rules.finePrintTitle')}
  <ul>
    <li>${text(lang, 'rules.finePrint1')}</li>
    <li>${text(lang, 'rules.finePrint2')}</li>
    <li>${text(lang, 'rules.finePrint3')}</li>
    <li>${text(lang, 'rules.finePrint4')}</li>
  </ul>

${h('rules.drawTitle')}
${p('rules.drawText')}`;
}

/* ── The page that explains what the game is ────────────────────────────── */

const PLAY_COPY = {
    en: {
        title: 'Play Hexaequo — a free abstract strategy game for two',
        description: 'Hexaequo is a free two-player abstract strategy game with no hidden '
            + 'information and no dice. There is no fixed board: you build it as you play. '
            + 'Play locally, against the computer, or online.',
        intro: 'Hexaequo is an abstract strategy game for two players. There is no luck in it, '
            + 'nothing is hidden, and there is no board in the box — you build the board as you '
            + 'play, laying hexagonal tiles and moving disks and rings across them.',
        waysTitle: 'Four ways to play',
        ways: [
            ['Two players, one screen', 'Pass the device back and forth. Nothing to install and no account needed.'],
            ['Against the computer', 'Four strengths, from a beginner that overlooks captures to an opponent that searches seven moves ahead.'],
            ['Online with a friend', 'Open a game and send the link. Whoever holds it takes the free seat.'],
            ['Rated games online', 'Sign in and be matched with someone near your rating, with clocks and a world leaderboard.'],
        ],
        whyTitle: 'What makes it different',
        why: [
            ['The board is not given', 'Every game starts with four tiles. Where the board goes is itself a move, and a game played wide is nothing like one played tight.'],
            ['Three ways to win', 'Take six disks, take three rings, or leave your opponent with nothing on the board. Each pulls play in a different direction.'],
            ['No hidden information, no dice', 'Everything either player knows is on the table. A loss is always something you could have seen.'],
            ['Five minutes to learn', 'Two kinds of piece, one kind of tile, and a turn is a single choice.'],
        ],
        freeTitle: 'Free, and it stays free',
        freeText: 'Hexaequo runs in a browser with nothing to install. It can be added to a phone '
            + 'home screen and played offline. There are no advertisements, no purchases and no '
            + 'tracking beyond what an account you choose to create requires.',
        rulesLink: 'Read the full rules',
    },
    fr: {
        title: 'Jouer à Hexaequo — un jeu de stratégie abstrait gratuit pour deux',
        description: 'Hexaequo est un jeu de stratégie abstrait gratuit pour deux joueurs, sans '
            + 'hasard ni information cachée. Il n’y a pas de plateau fixe : on le construit en '
            + 'jouant. En local, contre l’ordinateur, ou en ligne.',
        intro: 'Hexaequo est un jeu de stratégie abstrait pour deux joueurs. Aucun hasard, rien de '
            + 'caché, et pas de plateau dans la boîte — le plateau se construit en jouant, en posant '
            + 'des tuiles hexagonales et en y déplaçant des disques et des anneaux.',
        waysTitle: 'Quatre façons de jouer',
        ways: [
            ['À deux sur un même écran', 'On se passe l’appareil. Rien à installer, aucun compte requis.'],
            ['Contre l’ordinateur', 'Quatre niveaux, du débutant qui laisse passer des captures à un adversaire qui calcule sept coups d’avance.'],
            ['En ligne avec un ami', 'Créez une partie et transmettez le lien. Celui qui l’a prend la place libre.'],
            ['Parties classées en ligne', 'Connectez-vous et affrontez quelqu’un de votre force, avec pendules et classement mondial.'],
        ],
        whyTitle: 'Ce qui le distingue',
        why: [
            ['Le plateau n’est pas donné', 'Chaque partie commence avec quatre tuiles. L’endroit où le plateau s’étend est lui-même un coup, et une partie jouée large ne ressemble en rien à une partie jouée serrée.'],
            ['Trois façons de gagner', 'Prendre six disques, prendre trois anneaux, ou ne laisser à l’adversaire aucune pièce sur le plateau. Chacune tire le jeu dans une direction différente.'],
            ['Sans hasard ni information cachée', 'Tout ce que les deux joueurs savent est sur la table. Une défaite est toujours quelque chose qu’on aurait pu voir venir.'],
            ['Cinq minutes pour apprendre', 'Deux sortes de pièces, une sorte de tuile, et un tour se résume à un seul choix.'],
        ],
        freeTitle: 'Gratuit, et ça le restera',
        freeText: 'Hexaequo fonctionne dans un navigateur, sans rien installer. On peut l’ajouter '
            + 'à l’écran d’accueil d’un téléphone et y jouer hors ligne. Aucune publicité, aucun '
            + 'achat, et aucun suivi au-delà de ce qu’exige un compte que vous choisissez de créer.',
        rulesLink: 'Lire les règles complètes',
    },
};

function playBody(lang) {
    const c = PLAY_COPY[lang];
    const list = (items) => items.map(([name, detail]) =>
        `    <li><b>${escape(name)}</b> — ${escape(detail)}</li>`).join('\n');
    return `  <h1>Hexaequo</h1>
  <p class="doc-lede">${escape(c.intro)}</p>

  <h2>${escape(c.waysTitle)}</h2>
  <ul>
${list(c.ways)}
  </ul>

  <h2>${escape(c.whyTitle)}</h2>
  <ul>
${list(c.why)}
  </ul>

  <h2>${escape(c.freeTitle)}</h2>
  <p>${escape(c.freeText)}</p>
  <p><a href="/${PAGES.rules[lang]}">${escape(c.rulesLink)}</a></p>`;
}

/* ── Legal ──────────────────────────────────────────────────────────────── */

function legalBody(lang, which) {
    /* Privacy sections are keyed p1..p7 and terms t1..t6, which is what the
       app renders; walking the numbers keeps the two in step without a list
       to maintain in a second place. */
    const letter = which === 'privacy' ? 'p' : 't';
    const out = [
        `  <h1>${escape(text(lang, 'legal.' + which + 'Title'))}</h1>`,
        `  <p class="doc-caption">${escape(text(lang, 'legal.updated'))}</p>`,
        `  <p class="doc-lede">${text(lang, 'legal.' + which + 'Intro')}</p>`,
    ];
    for (let i = 1; i <= 9; i++) {
        const bundle = locales[lang].legal || {};
        if (!bundle[`${letter}${i}Title`]) continue;
        out.push(`  <h2>${escape(bundle[`${letter}${i}Title`])}</h2>`);
        out.push(`  <p>${bundle[`${letter}${i}Body`] || ''}</p>`);
    }
    out.push(`  <h2>${escape(text(lang, 'legal.contactHeading'))}</h2>`);
    out.push(`  <p>${text(lang, 'legal.contactBody').replace('{email}', CONTACT_EMAIL)}</p>`);
    return out.join(String.fromCharCode(10));
}

/* ── Structured data ────────────────────────────────────────────────────── */

/*
 * What the game is, in a form a machine can read.
 *
 * Search engines use this for rich results, and the assistants that now answer
 * "what board games can I play in a browser" read the same thing. Left out of
 * the legal pages, which describe no product.
 */
function gameSchema(lang) {
    const c = PLAY_COPY[lang];
    return {
        '@context': 'https://schema.org',
        '@type': 'VideoGame',
        name: 'Hexaequo',
        alternateName: 'Hexaequo — abstract strategy game',
        url: SITE,
        description: c.description,
        inLanguage: ['en', 'fr'],
        image: `${SITE}/assets/icons/icon-512x512.png`,
        genre: ['Abstract strategy', 'Board game', 'Strategy'],
        gamePlatform: ['Web browser', 'Progressive Web App'],
        playMode: ['SinglePlayer', 'MultiPlayer', 'CoOp'],
        numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 2 },
        applicationCategory: 'GameApplication',
        operatingSystem: 'Any',
        author: { '@type': 'Person', name: 'Piero Barrette' },
        publisher: { '@type': 'Person', name: 'Piero Barrette' },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'CAD', availability: 'https://schema.org/InStock' },
        isAccessibleForFree: true,
    };
}

function rulesSchema(lang) {
    return {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: `${text(lang, 'rules.title')} — Hexaequo`,
        description: text(lang, 'rules.lede'),
        inLanguage: lang,
        totalTime: 'PT5M',
        step: [
            { '@type': 'HowToStep', name: text(lang, 'rules.setupTitle'), text: text(lang, 'rules.setupText') },
            { '@type': 'HowToStep', name: text(lang, 'rules.turnTitle'), text: text(lang, 'rules.turnText') },
            { '@type': 'HowToStep', name: text(lang, 'rules.tileTitle'), text: text(lang, 'rules.tileText') },
            { '@type': 'HowToStep', name: text(lang, 'rules.placeTitle'), text: text(lang, 'rules.placeText') },
            { '@type': 'HowToStep', name: text(lang, 'rules.diskTitle'), text: text(lang, 'rules.diskText') },
            { '@type': 'HowToStep', name: text(lang, 'rules.ringTitle'), text: text(lang, 'rules.ringText') },
            { '@type': 'HowToStep', name: text(lang, 'rules.goalTitle'), text: text(lang, 'rules.goalIntro') },
        ],
    };
}

/* ── Writing it out ─────────────────────────────────────────────────────── */

function write(relative, contents) {
    const target = path.join(WEB, relative, 'index.html');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    return `${relative.padEnd(24)} ${(contents.length / 1024).toFixed(1)} KB`;
}

function build() {
    const written = [];

    for (const lang of ['en', 'fr']) {
        written.push(write(PAGES.play[lang], page({
            lang,
            slug: 'play',
            title: PLAY_COPY[lang].title,
            description: PLAY_COPY[lang].description,
            appRoute: 'play',
            body: playBody(lang),
            schema: gameSchema(lang),
        })));

        written.push(write(PAGES.rules[lang], page({
            lang,
            slug: 'rules',
            title: `${text(lang, 'rules.title')} — Hexaequo`,
            description: text(lang, 'rules.lede'),
            appRoute: 'rules',
            body: rulesBody(lang),
            schema: rulesSchema(lang),
        })));

        for (const which of ['privacy', 'terms']) {
            written.push(write(PAGES[which][lang], page({
                lang,
                slug: which,
                title: `${text(lang, 'nav.' + which)} — Hexaequo`,
                description: text(lang, 'nav.' + which),
                appRoute: which,
                body: legalBody(lang, which),
                // Policy pages are for the people who look for them, not for
                // search results; they would only dilute what is worth finding.
                noindex: true,
            })));
        }
    }

    /* robots.txt and the sitemap describe what was just written, so they are
       built from the same list rather than kept in step by hand. */
    const indexed = [
        { loc: `${SITE}/`, priority: '1.0', changefreq: 'weekly' },
        ...['play', 'rules'].flatMap((slug) => ['en', 'fr'].map((lang) => ({
            loc: `${SITE}/${PAGES[slug][lang]}`,
            priority: slug === 'play' ? '0.9' : '0.8',
            changefreq: 'monthly',
        }))),
    ];
    const today = new Date().toISOString().slice(0, 10);
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${indexed.map((entry) => `  <url>
    <loc>${entry.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
    fs.writeFileSync(path.join(WEB, 'sitemap.xml'), sitemap);

    const robots = `# Hexaequo — https://hexaequo.com
User-agent: *
Allow: /

# The app's own routes are fragments of one page; there is nothing behind
# these paths for a crawler to read.
Disallow: /api/
Disallow: /socket.io/

Sitemap: ${SITE}/sitemap.xml
`;
    fs.writeFileSync(path.join(WEB, 'robots.txt'), robots);

    console.log('\nPages written:\n');
    for (const line of written) console.log('  ' + line);
    console.log('\n  sitemap.xml              ' + indexed.length + ' urls');
    console.log('  robots.txt');
    console.log(`\n✅ ${written.length} pages\n`);
}

build();
