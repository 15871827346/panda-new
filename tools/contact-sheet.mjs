/* Build labelled contact sheets of the images the site actually uses, so the
   selection can be judged by looking rather than by reading filenames.
     node tools/contact-sheet.mjs
   Writes shots/sheet-main.png and shots/sheet-gallery.png. Read-only on assets. */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCKS } from '../data.js';

const require = createRequire(import.meta.url);
const sharp = require('D:/Projects/panda-studio-site/node_modules/sharp');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(ROOT, 'assets');
const OUT = resolve(ROOT, 'shots');

const CELL_W = 380;
const IMG_H = 254;
const LABEL_H = 62;
const CELL_H = IMG_H + LABEL_H;

const label = (text, sub) => Buffer.from(`<svg width="${CELL_W}" height="${LABEL_H}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="10" y="24" font-family="Arial" font-size="17" font-weight="bold" fill="#111">${text}</text>
  <text x="10" y="47" font-family="Arial" font-size="15" fill="#666">${sub}</text>
</svg>`);

async function sheet(items, cols, file) {
  const rows = Math.ceil(items.length / cols);
  const W = cols * CELL_W;
  const H = rows * CELL_H;
  const composites = [];
  for (const [i, it] of items.entries()) {
    const x = (i % cols) * CELL_W;
    const y = Math.floor(i / cols) * CELL_H;
    const img = await sharp(resolve(ASSETS, `${it.slug}.webp`))
      .resize(CELL_W - 2, IMG_H - 2, { fit: 'cover', position: 'centre' })
      .png().toBuffer();
    composites.push({ input: img, left: x + 1, top: y + 1 });
    composites.push({ input: await label(it.title, it.note), left: x, top: y + IMG_H });
    composites.push({
      input: Buffer.from(`<svg width="${CELL_W}" height="${CELL_H}"><rect x="0.5" y="0.5" width="${CELL_W - 1}" height="${CELL_H - 1}" fill="none" stroke="#bbb"/></svg>`),
      left: x, top: y,
    });
  }
  const png = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
    .composite(composites).png({ quality: 92 }).toBuffer();
  await writeFile(resolve(OUT, file), png);
  console.log(`${file}  ${items.length} 张  ${W}×${H}`);
}

await mkdir(OUT, { recursive: true });

await sheet(
  BLOCKS.map((b) => ({
    slug: b.img,
    title: `${b.num} ${b.title.zh}`,
    note: `${b.id} · ${b.img}`,
  })),
  4,
  'sheet-main.png',
);

const gallery = [];
for (const b of BLOCKS) {
  for (const slug of b.gallery ?? []) {
    gallery.push({ slug, title: `${b.num} ${b.title.zh}`, note: slug });
  }
}
await sheet(gallery, 5, 'sheet-gallery.png');
