/**
 * Draw the picture a link to Hexaequo is previewed with.
 *
 * Usage: node scripts/makeShareImage.js
 *
 * A link pasted into a chat, a post or a mail is shown with the page's
 * og:image. That used to be the 512-pixel app icon, which the large preview
 * cards crop or sit in a grey frame. This draws the 1200 × 630 card they are
 * made for, once per language: the mark, the name, what the game is, and the
 * opening position with the cells the next tile may go to — the board that
 * does not exist yet, which is the game in one picture.
 *
 * Drawn with the site's own functions (ui/logo.js, ui/miniBoard.js), in the
 * dark modern palette of styles/tokens.css and with the locales' words, so
 * the card cannot drift from the game any more than the icons can.
 * makePages.js points every page at the card of its language.
 *
 * sharp draws SVG text with the fonts installed on the machine; the cards
 * were made on Windows, in Segoe UI. Like makeIcons.js, this runs when the
 * mark, the palette or the words change, never at runtime, and the results
 * are committed.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', '..');
const WEB = path.join(ROOT, 'web');
const WIDTH = 1200;
const HEIGHT = 630;
const LANGUAGES = ['en', 'fr'];

const load = (relative) => import(pathToFileURL(path.join(WEB, 'src', relative)).href);

/* ── The palette ────────────────────────────────────────────────────────── */

/*
 * The names the dark modern palette gives, read from tokens.css: the shared
 * ones in :root, then the palette's own over them. librsvg, which draws the
 * SVG, knows neither custom properties nor color-mix(), so both are worked
 * out here into plain colours.
 */
function paletteNames() {
    const css = fs.readFileSync(path.join(WEB, 'styles', 'tokens.css'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const names = {};
    for (const selector of [':root', ':root[data-theme="dark"][data-board-style="modern"]']) {
        const start = css.indexOf(`${selector} {`);
        if (start < 0) throw new Error(`tokens.css has no ${selector} block`);
        const block = css.slice(start, css.indexOf('}', start));
        for (const [, name, value] of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) names[name] = value.trim();
    }
    return names;
}

function channels(colour) {
    if (colour === 'transparent') return [0, 0, 0, 0];
    let m = /^#([0-9a-f]{3})$/i.exec(colour);
    if (m) return [...m[1]].map((c) => parseInt(c + c, 16)).concat(1);
    m = /^#([0-9a-f]{6})$/i.exec(colour);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
    throw new Error(`cannot mix ${colour}`);
}

/* color-mix(in srgb, a p%, b), with premultiplied alpha as CSS does it. */
function mix(a, share, b) {
    const [ra, ga, ba, aa] = channels(a);
    const [rb, gb, bb, ab] = channels(b);
    const alpha = aa * share + ab * (1 - share);
    if (!alpha) return 'transparent';
    const blend = (x, y) => Math.round((x * aa * share + y * ab * (1 - share)) / alpha);
    return `rgba(${blend(ra, rb)},${blend(ga, gb)},${blend(ba, bb)},${Number(alpha.toFixed(3))})`;
}

function resolver(names) {
    const resolve = (value) => value
        .replace(/var\(--([\w-]+)\)/g, (whole, name) => {
            if (!(name in names)) throw new Error(`tokens.css has no --${name}`);
            return resolve(names[name]);
        })
        .replace(/color-mix\(in srgb,\s*(\S+)\s+([\d.]+)%,\s*(\S+?)\)/g,
            (whole, a, percent, b) => mix(a, Number(percent) / 100, b));
    return resolve;
}

/* ── The card ───────────────────────────────────────────────────────────── */

const escape = (value) => String(value).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function words(lang) {
    const read = (l) => JSON.parse(fs.readFileSync(path.join(WEB, 'src', 'locales', `${l}.json`), 'utf8'));
    const own = read(lang);
    const english = read('en');
    return (section, key) => (own[section] && own[section][key]) || english[section][key];
}

/* An SVG drawn by the site, set into the card at a given box. */
function place(svg, x, y, width, height, align = 'xMidYMid') {
    return svg
        .replace(/ preserveAspectRatio="[^"]*"/, '')
        .replace('<svg ', `<svg x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="${align} meet" `);
}

function card(lang, draw, font) {
    const t = words(lang);
    const { logoMarkSvg, miniBoardSvg, BLACK, WHITE, DISK } = draw;
    /* The opening position, as the rules draw it, with the four cells a
       first tile may take. */
    const opening = miniBoardSvg({
        tiles: [[0, 0, BLACK], [1, 0, BLACK], [-1, 1, WHITE], [0, 1, WHITE]],
        pieces: [[1, 0, BLACK, DISK], [-1, 1, WHITE, DISK]],
        spots: [[-1, 0], [1, -1], [1, 1], [-1, 2]],
    });
    const text = (x, y, size, colour, content, extra = '') =>
        `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" fill="${colour}"${extra}>${escape(content)}</text>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<defs>
  <radialGradient id="ground" cx="74%" cy="48%" r="70%">
    <stop offset="0" stop-color="var(--board-lift)"/>
    <stop offset=".55" stop-color="var(--board-bg)"/>
    <stop offset="1" stop-color="var(--board-sink)"/>
  </radialGradient>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#ground)"/>
${place(opening, 640, 40, 520, 550)}
${place(logoMarkSvg(), 92, 118, 104, 84, 'xMinYMid')}
${text(86, 312, 68, 'var(--accent)', t('meta', 'title').toUpperCase(), ' font-weight="300" letter-spacing="18"')}
${text(92, 386, 31, 'var(--text)', t('meta', 'tagline'))}
${text(92, 434, 25, 'var(--muted)', t('meta', 'shareHook'))}
${text(92, 540, 22, 'var(--muted)', 'hexaequo.com', ' letter-spacing="2"')}
</svg>`;
}

async function build() {
    const { logoMarkSvg } = await load('ui/logo.js');
    const { miniBoardSvg } = await load('ui/miniBoard.js');
    const { BLACK, WHITE, DISK } = await load('game/state.js');
    const names = paletteNames();
    const resolve = resolver(names);
    const font = resolve('var(--font-sans)').replace(/"/g, "'");

    for (const lang of LANGUAGES) {
        const svg = resolve(card(lang, { logoMarkSvg, miniBoardSvg, BLACK, WHITE, DISK }, font));
        const file = path.join(WEB, 'assets', `share-${lang}.png`);
        await sharp(Buffer.from(svg))
            .flatten({ background: resolve('var(--bg)') })
            .png({ compressionLevel: 9 })
            .toFile(file);
        const { size } = fs.statSync(file);
        console.log(`  ${path.relative(ROOT, file).padEnd(28)} ${WIDTH}×${HEIGHT}  ${(size / 1024).toFixed(1)} KB`);
    }
    console.log(`\n✅ ${LANGUAGES.length} share cards written to web/assets/`);
}

build().catch((error) => {
    console.error('❌ Share card failed:', error.message);
    process.exit(1);
});
