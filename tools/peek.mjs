/* Screenshot any URL with the local headless Chromium, for design reference.
     node tools/peek.mjs <url> [name] [width] [height]
   Writes shots/peek-<name>-viewport.png and shots/peek-<name>-full.png */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , TARGET_URL, NAME = 'page', WIDTH = '1440', HEIGHT = '900'] = process.argv;
if (!TARGET_URL) {
  console.error('usage: node tools/peek.mjs <url> [name] [width] [height]');
  process.exit(1);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'shots');
const CHROME =
  'C:/Users/24772/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const PORT = 9350;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

class CDP {
  static async connect(url) {
    const ws = new WebSocket(url);
    await Promise.race([
      new Promise((ok, err) => {
        ws.addEventListener('open', ok, { once: true });
        ws.addEventListener('error', err, { once: true });
      }),
      sleep(15000).then(() => Promise.reject(new Error('ws timeout'))),
    ]);
    return new CDP(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.loaded = false;
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { ok, err } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? err(new Error(JSON.stringify(message.error))) : ok(message.result);
      } else if (message.method === 'Page.loadEventFired') {
        this.loaded = true;
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, err) => this.pending.set(id, { ok, err }));
  }
}

const browser = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
process.on('exit', () => browser.kill());

let target = null;
for (let i = 0; i < 80 && !target; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((item) => item.type === 'page')?.webSocketDebuggerUrl;
  } catch {
    /* starting */
  }
  if (!target) await sleep(250);
}

await mkdir(OUT, { recursive: true });
const cdp = await CDP.connect(target);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: Number(WIDTH),
  height: Number(HEIGHT),
  deviceScaleFactor: 1,
  mobile: false,
});

await cdp.send('Page.navigate', { url: TARGET_URL });
for (let i = 0; i < 60 && !cdp.loaded; i += 1) await sleep(250);
/* Give fonts, images and any entrance animations time to settle. */
await sleep(4000);

const meta = await cdp.send('Runtime.evaluate', {
  expression: `JSON.stringify({
    title: document.title,
    height: document.scrollingElement.scrollHeight,
    bg: getComputedStyle(document.body).backgroundColor,
    color: getComputedStyle(document.body).color,
    font: getComputedStyle(document.body).fontFamily.slice(0, 60),
  })`,
  returnByValue: true,
});
console.log('page:', meta.result.value);

const viewport = await cdp.send('Page.captureScreenshot', { format: 'png' });
await writeFile(resolve(OUT, `peek-${NAME}-viewport.png`), Buffer.from(viewport.data, 'base64'));
console.log('wrote', `peek-${NAME}-viewport.png`);

const full = await cdp.send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
});
await writeFile(resolve(OUT, `peek-${NAME}-full.png`), Buffer.from(full.data, 'base64'));
console.log('wrote', `peek-${NAME}-full.png`);

browser.kill();
