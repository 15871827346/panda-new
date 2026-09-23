/* Contact sheet of the source images this build does NOT use, so "we have no
   real photo for that block" can be checked rather than assumed.
     node tools/sheet-unused.mjs */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCKS } from '../data.js';

const require = createRequire(import.meta.url);
const sharp = require('D:/Projects/panda-studio-site/node_modules/sharp');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'D:/Projects/panda-studio-site-original/images';

/* Which source files the build already consumes. */
const build = readFileSync(resolve(ROOT, 'tools/build-assets.mjs'), 'utf8');
const used = new Set([...build.matchAll(/'([^']+\.(?:jpe?g|png))'/g)].map((m) => m[1]));
const all = readdirSync(SRC).filter((f) => ['.jpg', '.jpeg', '.png'].includes(extname(f).toLowerCase()));
const unused = all.filter((f) => !used.has(f));

const CELL_W = 380;
const IMG_H = 254;
const LABEL_H = 46;
const cols = 4;
const rows = Math.ceil(unused.length / cols);

const composites = [];
for (const [i, file] of unused.entries()) {
  const x = (i % cols) * CELL_W;
  const y = Math.floor(i / cols) * (IMG_H + LABEL_H);
  composites.push({
    input: await sharp(resolve(SRC, file), { animated: false }).rotate()
      .resize(CELL_W - 2, IMG_H - 2, { fit: 'cover', position: 'centre' }).png().toBuffer(),
    left: x + 1, top: y + 1,
  });
  composites.push({
    input: Buffer.from(`<svg width="${CELL_W}" height="${LABEL_H}"><rect width="100%" height="100%" fill="#fff"/>
      <text x="8" y="19" font-family="Arial" font-size="14" font-weight="bold" fill="#111">${file.replace(/[&<>]/g, '')}</text>
      <text x="8" y="37" font-family="Arial" font-size="12" fill="#777">未被本版使用</text></svg>`),
    left: x, top: y + IMG_H,
  });
}

const png = await sharp({ create: { width: cols * CELL_W, height: rows * (IMG_H + LABEL_H), channels: 3, background: '#fff' } })
  .composite(composites).png().toBuffer();
const out = resolve(ROOT, 'shots/sheet-unused.png');
writeFileSync(out, png);
console.log(`${unused.length} 张未使用的源图 → ${out}`);
