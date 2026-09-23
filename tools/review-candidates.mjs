/* Assemble a review sheet: for each block whose image does not match its
   subject, show the image now on the site next to the generated candidates.
   Nothing here touches ./assets — the site is unchanged until a candidate is
   deliberately chosen and built in.
     node tools/review-candidates.mjs */
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('D:/Projects/panda-studio-site/node_modules/sharp');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(ROOT, 'assets');
const VIBE = resolve(ROOT, '..', 'vibe_images');
const CAND = resolve(ROOT, 'candidates');
const SHOTS = resolve(ROOT, 'shots');
mkdirSync(CAND, { recursive: true });

/* slot = the block being reconsidered; current = the webp it uses today;
   match = the filename prefix ImageGen wrote the candidates under. */
const SLOTS = [
  { key: 'game', match: 'gamification', num: '07', title: '游戏化', why: '现在是熊猫贴纸，那是 14「校园文创」的东西', current: 're-game' },
  { key: 'hardware', match: 'hardware', num: '06', title: '小硬件', why: '现在是 3D 打印花瓶，那是 10「3D 打印作品」的东西，一张电路都没有', current: 're-hardware' },
  { key: 'robotics', match: 'robotics', num: '09', title: '机器人制造', why: '和 05「机械臂」是同一张照片（md5 相同）', current: 're-arm' },
  { key: 'campus', match: 'campus', num: '08', title: '校园应用', why: '现在是一间空教室，看不出"应用"', current: 're-campus' },
  { key: 'mr', match: 'mr', num: '04', title: 'MR 设备', why: '桌上有红塑料袋和纸箱，主题对但照片太乱', current: 'hw-mr' },
];

const CELL = 400;
const IMG_H = 300;
const TEXT_H = 96;
const ROW_H = IMG_H + TEXT_H;
const COLS = 3;

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const composites = [];
let rows = 0;
const notes = [];

for (const [r, slot] of SLOTS.entries()) {
  rows += 1;
  const files = readdirSync(VIBE)
    .filter((f) => f.startsWith(`${slot.match}-`) && f.endsWith('.png'))
    /* Newest first: the earlier batch was rejected for looking like a render,
       and a review sheet that keeps showing the rejected round is worse than no
       sheet at all. */
    .sort((a, b) => statSync(resolve(VIBE, b)).mtimeMs - statSync(resolve(VIBE, a)).mtimeMs)
    .slice(0, COLS - 1)
    .reverse();
  const cells = [{ label: `现在 · ${slot.current}.webp`, path: resolve(ASSETS, `${slot.current}.webp`), bad: true }];
  for (const f of files) {
    const variant = f.slice(slot.match.length + 1).split('_')[0].replace('.png', '');
    const clean = `${slot.key}-${variant}.png`;
    const dest = resolve(CAND, clean);
    if (!existsSync(dest)) copyFileSync(resolve(VIBE, f), dest);
    cells.push({ label: `候选 · ${clean}`, path: dest, bad: false });
  }
  notes.push(`${slot.num} ${slot.title}：${slot.why}｜候选 ${files.length} 张`);

  for (const [c, cell] of cells.slice(0, COLS).entries()) {
    const x = c * (CELL + 12);
    const y = r * ROW_H;
    const img = await sharp(cell.path).resize(CELL, IMG_H, { fit: 'cover', position: 'centre' }).png().toBuffer();
    composites.push({ input: img, left: x, top: y });
    composites.push({
      input: Buffer.from(`<svg width="${CELL}" height="${TEXT_H}">
        <rect width="100%" height="100%" fill="#ffffff"/>
        <rect x="0" y="0" width="${CELL}" height="4" fill="${cell.bad ? '#c0392b' : '#1e1e1e'}"/>
        <text x="10" y="30" font-family="Arial" font-size="17" font-weight="bold" fill="#111">${esc(`${slot.num} ${slot.title}`)}</text>
        <text x="10" y="54" font-family="Arial" font-size="14" fill="#555">${esc(cell.label)}</text>
        <text x="10" y="78" font-family="Arial" font-size="13" fill="#888">${esc(cell.bad ? slot.why : '生成图，未替换到站点')}</text>
      </svg>`),
      left: x, top: y + IMG_H,
    });
  }
}

const W = COLS * (CELL + 12);
const H = rows * ROW_H + 8;
const png = await sharp({ create: { width: W, height: H, channels: 3, background: '#e9e9e9' } })
  .composite(composites).png().toBuffer();
const out = resolve(SHOTS, 'sheet-candidates.png');
writeFileSync(out, png);
console.log(notes.join('\n'));
console.log(`\n对比图 → ${out}  (${W}×${H})`);
console.log(`候选原图目录 → ${CAND}`);
