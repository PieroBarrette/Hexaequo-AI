/**
 * Rasterise the Hexaequo mark into the PNGs the outside world asks for.
 *
 * Usage: node scripts/makeIcons.js
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
  { file: 'icon-maskable-512.png', size: 512, pad: 0.22, background: '#0e1015' },
  { file: 'icon-light-512.png', size: 512, pad: 0.10, background: '#ffffff' },
  { file: 'apple-touch-icon.png', size: 180, pad: 0.10, background: '#0e1015' },
];

async function build() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`❌ Missing ${SOURCE}`);
    process.exit(1);
  }
  const svg = fs.readFileSync(SOURCE);
  fs.mkdirSync(ICONS, { recursive: true });

  for (const target of TARGETS) {
    const inner = Math.round(target.size * (1 - 2 * target.pad));
    const rendered = await sharp(svg, { density: 600 })
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();

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
  console.log(`\n✅ ${TARGETS.length} icons written to web/assets/icons/`);
}

build().catch((error) => {
  console.error('❌ Icon build failed:', error.message);
  process.exit(1);
});
