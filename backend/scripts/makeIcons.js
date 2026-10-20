/**
 * Rasterise the Hexaequo mark into the PNGs the outside world asks for.
 *
 * Usage: node scripts/makeIcons.js [file ...]
 *
 * With file names, only those are rebuilt — adding one icon should not
 * re-encode, and so churn, every other.
 *
 * The mark is defined once, as hexagon geometry, in web/assets/logo.svg. Every
 * PNG here is generated from it, so the brand can never drift between the app,
 * the installable icons and the Google consent screen.
 *
 * `sharp` is a dev dependency: this runs when the logo changes, never at
 * runtime, and the results are committed.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'web', 'assets', 'logo.svg');
const ICONS = path.join(ROOT, 'web', 'assets', 'icons');

/*
 * The mark is wider than it is tall, so a square icon needs padding rather than
 * a stretch. `contain` keeps the proportions and fills the rest.
 *
 * Maskable icons get far more padding: launchers crop them to a circle or a
 * squircle, and anything within 10% of the edge can be shaved off.
 */
const TARGETS = [
  { file: 'google-branding-120.png', size: 120, pad: 0.07, background: '#ffffff' },
  { file: 'icon-192x192.png', size: 192, pad: 0.10, background: '#0e1015' },
  { file: 'icon-512x512.png', size: 512, pad: 0.10, background: '#0e1015' },
  { file: 'icon-maskable-192.png', size: 192, pad: 0.22, background: '#0e1015' },
  { file: 'icon-maskable-512.png', size: 512, pad: 0.22, background: '#0e1015' },
  { file: 'icon-light-512.png', size: 512, pad: 0.10, background: '#ffffff' },
  { file: 'apple-touch-icon.png', size: 180, pad: 0.10, background: '#0e1015' },
  /* The small mark Android shows in the status bar beside a notification. The
     system draws it in one colour from the alpha alone, so the mark's dark
     parts become the shape and its light parts the holes in it: two solid
     tiles, two outlined, a disk and a ring — still the opening position. */
  { file: 'badge-96.png', size: 96, pad: 0.04, background: '#00000000', mono: true },
];

/** Keep only the dark of the mark, as white: opacity follows how dark it was. */
async function monochrome(image) {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const light = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    data[i + 3] = Math.round(data[i + 3] * (1 - light));
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function build() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`❌ Missing ${SOURCE}`);
    process.exit(1);
  }
  const svg = fs.readFileSync(SOURCE);
  fs.mkdirSync(ICONS, { recursive: true });

  const only = process.argv.slice(2);
  const chosen = only.length ? TARGETS.filter((target) => only.includes(target.file)) : TARGETS;
  for (const target of chosen) {
    const inner = Math.round(target.size * (1 - 2 * target.pad));
    let rendered = await sharp(svg, { density: 600 })
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();
    if (target.mono) rendered = await monochrome(rendered);

    await sharp({
      create: {
        width: target.size, height: target.size, channels: 4,
        background: target.background,
      },
    })
      .composite([{ input: rendered, gravity: 'centre' }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(ICONS, target.file));

    const { size } = fs.statSync(path.join(ICONS, target.file));
    console.log(`  ${target.file.padEnd(26)} ${target.size}×${target.size}  ${(size / 1024).toFixed(1)} KB`);
  }
  console.log(`\n✅ ${chosen.length} icons written to web/assets/icons/`);
}

build().catch((error) => {
  console.error('❌ Icon build failed:', error.message);
  process.exit(1);
});
