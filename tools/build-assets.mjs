/*
 * Build script: read source images from the existing project (READ ONLY) and
 * write optimised WebP derivatives into ./assets. Nothing outside this folder
 * is touched.
 *
 *   node tools/build-assets.mjs
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// sharp is not installed in this folder; borrow the copy already present in the
// existing project's dependencies (read-only).
const require = createRequire(import.meta.url);
const sharp = require('D:/Projects/panda-studio-site/node_modules/sharp');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'D:/Projects/panda-studio-site-original/images';
const BRAND = 'D:/Projects/panda-studio-site-original/public/brand';
const OUT = resolve(ROOT, 'assets');

const LARGE = { width: 1600, quality: 82 };
const THUMB = { width: 760, quality: 76 };

/* slug -> source filename. Every slug becomes <slug>.webp (large) and
   <slug>.thumb.webp (grid thumb). */
const SOURCES = {
  // --- index blocks -------------------------------------------------------
  'intro-about': 'club-introduction-logo.png',
  'hw-printer': '3d-printer.jpg',
  'hw-laser': 'Laser engraving machine.jpeg',
  'hw-laser-2': 'laser-engraver-detail.jpeg',
  'hw-mr': 'Meta Quest.jpeg',
  'hw-arm': 'robot-arm-workshop.jpg',
  'hw-arm-2': 'robot-arm-detail.jpg',
  're-hardware': '3D printing results.jpeg',
  're-game': 'sticker.jpg',
  're-campus': 'Studio Environment 2.jpeg',
  're-arm': 'robot-arm-detail.jpg',
  // --- record blocks ------------------------------------------------------
  'r001': 'alumni-3d-print-vase.jpg',
  'r001-1': 'alumni-3d-print-process.jpg',
  'r001-2': 'alumni-3d-print-collection.jpg',
  'r001-3': 'alumni-3d-print-figure.jpg',
  'r001-4': 'alumni-3d-print-pair-hd.jpg',
  'r001-5': 'alumni-3d-print-figures-hd.jpg',
  'r001-6': 'alumni-3d-print-display-hd.jpg',
  'r001-7': 'alumni-3d-model-candle.png',
  'r001-8': 'alumni-3d-print-candle.png',
  'r001-9': 'alumni-3d-print-01.jpg',
  'r001-10': 'alumni-3d-print-02.jpg',
  'r001-11': 'alumni-3d-print-03.jpg',
  'r001-12': 'alumni-3dprint-vases.png',
  'r001-13': 'alumni-3dprint-lamp-render.png',
  'r001-14': 'alumni-3dprint-lamp-glow.png',
  'r002': 'alumni-3dgs-luma.png',
  'r002-1': 'alumni-3dgs-ue5.png',
  'r003': 'ai-canvas-board.jpg',
  'r003-1': 'alumni-hackathon-award.jpg',
  'r004': 'model-making-01.jpg',
  'r004-1': 'model-making-02.jpg',
  'r004-2': 'model-making-03.jpg',
  'r005': 'alumni-creative-tote-hd.jpg',
  'r005-1': 'alumni-creative-keychains-hd.jpg',
  'r005-2': 'alumni-creative-keychains-white-hd.jpg',
  'r005-3': 'alumni-creative-keychains-quotes-hd.jpg',
  'r005-4': 'alumni-creative-keychains-close-hd.jpg',
  'r006': 'alumni-award-wuhan-creative-design.png',
  'r006-1': 'alumni-award-honor-certificate.png',
  'r006-2': 'alumni-award-bus-stop-excellence.png',
  'r006-3': 'alumni-award-bus-stop-third.png',
  'r006-4': 'alumni-award-ncda-first.png',
  'r006-5': 'alumni-award-future-designer-second.png',
  'r007': 'mini-hbut.jpg',
  'r007-1': 'mini-hbut-home.jpg',
  // --- brand --------------------------------------------------------------
  'brand-icon': '__brand__/icon.png',
};

await mkdir(OUT, { recursive: true });

const report = [];
const failures = [];

async function emit(srcPath, slug, spec, suffix) {
  const target = resolve(OUT, `${slug}${suffix}.webp`);
  const info = await sharp(srcPath, { animated: false })
    .rotate() // honour EXIF so phone photos land upright
    .resize({ width: spec.width, height: spec.height, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: spec.quality, effort: 6 })
    .toFile(target);
  return { slug, suffix, bytes: info.size, w: info.width, h: info.height };
}

for (const [slug, file] of Object.entries(SOURCES)) {
  const srcPath = file.startsWith('__brand__/')
    ? resolve(BRAND, file.replace('__brand__/', ''))
    : resolve(SRC, file);

  try {
    await stat(srcPath);
  } catch {
    failures.push({ slug, file: srcPath, error: 'source missing' });
    continue;
  }

  // The brand mark is a small logo: one size is enough.
  const isBrand = slug.startsWith('brand-');

  try {
    const large = await emit(srcPath, slug, isBrand ? { width: 420, quality: 88, height: 420 } : LARGE, '');
    const items = [large];
    if (!isBrand) items.push(await emit(srcPath, slug, THUMB, '.thumb'));
    report.push(...items);
  } catch (error) {
    failures.push({ slug, file: srcPath, error: error.message.split('\n')[0] });
  }
}

const totalBytes = report.reduce((sum, item) => sum + item.bytes, 0);
await writeFile(
  resolve(ROOT, 'tools/assets-report.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), report, failures }, null, 2),
);

console.log(`assets written: ${report.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB total`);
if (failures.length) {
  console.log(`FAILURES (${failures.length}):`);
  for (const failure of failures) console.log('  -', failure.slug, failure.file, failure.error);
  process.exitCode = 1;
}
