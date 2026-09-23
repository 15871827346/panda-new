/* Screenshot a deployed URL at desktop and phone widths, so "what the teacher
   will see" is a picture rather than a promise.
     node tools/shoot-live.mjs <url> [out-prefix]
   Writes shots/<prefix>-desktop.png and shots/<prefix>-phone.png. */
import { startChrome } from './browser.mjs';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2];
const prefix = process.argv[3] ?? 'live';
if (!url) {
  console.log('用法：node tools/shoot-live.mjs <网址> [文件名前缀]');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = await startChrome();
const ws = new WebSocket(chrome.websocket);
await new Promise((ok) => ws.addEventListener('open', ok));
let id = 0;
const pend = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
});
const send = (method, params = {}) =>
  new Promise((ok) => { id += 1; ws.send(JSON.stringify({ id, method, params })); pend.set(id, ok); });
const ev = (expression) =>
  send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => r.result?.value);

await send('Page.enable');
await send('Runtime.enable');

async function shot(name, width, height, mobile, prep) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url });
  await sleep(5000);
  if (prep) { await ev(prep); await sleep(1600); }
  const report = await ev(`(() => {
    const imgs = [...document.querySelectorAll('img')];
    return {
      tiles: document.querySelectorAll('.tile').length,
      mode: document.body.dataset.mode || 'wall',
      images: imgs.length,
      broken: imgs.filter((i) => i.complete && !i.naturalWidth).length,
      title: (document.querySelector('h1')?.innerText || '').replace(/\\s+/g, ' ').trim(),
      langSwitch: document.querySelectorAll('[data-lang], .lang').length,
    };
  })()`);
  const png = (await send('Page.captureScreenshot', { format: 'png' })).data;
  const out = resolve(ROOT, 'shots', `${prefix}-${name}.png`);
  writeFileSync(out, Buffer.from(png, 'base64'));
  console.log(`${name.padEnd(8)} ${width}×${height}  ${JSON.stringify(report)}`);
}

await shot('desktop', 1440, 900, false);
await shot('phone', 390, 844, true, `document.querySelector('.tile').click()`);
await chrome.cleanup();
process.exit(0);
