/* Render two branches of this repo side by side so "which one am I submitting"
   is answered by looking, not by trusting a memory of branch names.
     node tools/compare-branches.mjs main typesafe-full
   Writes shots/branch-compare.png. Uses git worktree; nothing is checked out in
   the working copy, so your current files are never touched. */
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startChrome } from './browser.mjs';

const require = createRequire(import.meta.url);
const sharp = require('D:/Projects/panda-studio-site/node_modules/sharp');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const branches = process.argv.slice(2);
if (branches.length < 2) {
  console.log('用法：node tools/compare-branches.mjs <分支A> <分支B>');
  process.exit(1);
}

const TMP = resolve(ROOT, '..', '.branch-preview');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = [];

for (const [i, branch] of branches.entries()) {
  const dir = resolve(TMP, branch.replace(/[^a-z0-9-]/gi, '_'));
  execFileSync('git', ['worktree', 'add', '--detach', dir, branch], { cwd: ROOT, stdio: 'inherit' });

  const port = 4701 + i;
  const server = spawn(process.execPath, [resolve(dir, 'tools/serve.mjs'), String(port)], { stdio: 'ignore' });
  server.unref();
  await sleep(1200);

  const chrome = await startChrome({ width: 1440, height: 900 });
  const ws = new WebSocket(chrome.websocket);
  await new Promise((ok) => ws.addEventListener('open', ok));
  let id = 0;
  const pend = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((ok) => { id += 1; ws.send(JSON.stringify({ id, method, params })); pend.set(id, ok); });
  const ev = (x) => send('Runtime.evaluate', { expression: x, returnByValue: true }).then((r) => r.result?.value);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await sleep(3500);

  /* Facts about what this branch actually is, printed under the picture. */
  const facts = await ev(`(() => ({
    lang: document.querySelectorAll('[data-lang], .lang').length,
    tiles: document.querySelectorAll('.tile').length,
    title: document.querySelector('h1')?.innerText?.replace(/\\s+/g, ' ').trim().slice(0, 26),
    hero: getComputedStyle(document.body).backgroundColor,
  }))()`);
  const buf = (await send('Page.captureScreenshot', { format: 'png' })).data;
  const out = resolve(TMP, `${branch}.png`);
  writeFileSync(out, Buffer.from(buf, 'base64'));
  shots.push({ branch, out, facts });
  console.log(`${branch}: ${JSON.stringify(facts)}`);

  await chrome.cleanup();
  server.kill();
}

/* Stack them with labels. */
const W = 900;
const scaled = [];
for (const s of shots) scaled.push(await sharp(s.out).resize(W, Math.round(W * 0.625), { fit: 'cover' }).png().toBuffer());
const GAP = 46;
const H = scaled.length * (Math.round(W * 0.625) + GAP);
const composites = [];
for (const [i, img] of scaled.entries()) {
  composites.push({ input: img, left: 0, top: i * (Math.round(W * 0.625) + GAP) + GAP });
  composites.push({
    input: Buffer.from(`<svg width="${W}" height="${GAP}"><rect width="100%" height="100%" fill="#1e1e1e"/>
      <text x="14" y="30" font-family="Arial" font-size="20" fill="#fff">${shots[i].branch}　·　${shots[i].facts.tiles} 个方块　·　中英切换 ${shots[i].facts.lang} 个　·　标题「${(shots[i].facts.title || '').replace(/&/g, '&amp;')}」</text></svg>`),
    left: 0, top: i * (Math.round(W * 0.625) + GAP),
  });
}
const png = await sharp({ create: { width: W, height: H, channels: 3, background: '#fff' } }).composite(composites).png().toBuffer();
const out = resolve(ROOT, 'shots/branch-compare.png');
writeFileSync(out, png);
console.log(`\n对比图 → ${out}`);
for (const s of shots) {
  if (existsSync(resolve(TMP, s.branch))) execFileSync('git', ['worktree', 'remove', '--force', resolve(TMP, s.branch)], { cwd: ROOT, stdio: 'ignore' });
}
