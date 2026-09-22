/* ---------------------------------------------------------------------------
   CDP capture harness.

   The in-app browser cannot screenshot while hidden and `--virtual-time-budget`
   fires before real network I/O settles, so drive a headless Chromium over the
   DevTools protocol instead: real clicks, real waits, full-page PNGs.

     node tools/cdp-shoot.mjs
--------------------------------------------------------------------------- */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'shots');
const CHROME =
  'C:/Users/24772/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const PORT = 9333;
const BASE = 'http://127.0.0.1:4321/';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

class CDP {
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, err) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', err, { once: true });
    });
    return new CDP(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { ok, err } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? err(new Error(JSON.stringify(message.error))) : ok(message.result);
      } else {
        for (const listener of this.listeners) listener(message);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, err) => this.pending.set(id, { ok, err }));
  }

  waitFor(method, timeout = 25000) {
    return new Promise((ok, err) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        err(new Error(`timeout waiting for ${method}`));
      }, timeout);
      const listener = (message) => {
        if (message.method !== method) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        ok(message.params);
      };
      this.listeners.add(listener);
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'page threw');
    }
    return result.result.value;
  }
}

async function devtoolsUrl() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* the browser is still starting */
    }
    await sleep(250);
  }
  throw new Error('DevTools endpoint never came up');
}

/* Wait until every image that is in the document has finished decoding.
   Lazy images far down the page never start on their own, so promote them and
   cap the wait. */
async function imagesReady(cdp) {
  return cdp.evaluate(`(async () => {
    const imgs = [...document.images];
    imgs.forEach((img) => { img.loading = 'eager'; });
    await Promise.race([
      Promise.all(imgs.map((img) => (img.complete ? null : new Promise((done) => {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      })))),
      new Promise((done) => setTimeout(done, 12000)),
    ]);
    return {
      total: imgs.length,
      broken: imgs.filter((img) => img.complete && img.naturalWidth === 0)
        .map((img) => img.currentSrc || img.getAttribute('src')),
    };
  })()`);
}

async function clickSelector(cdp, selector) {
  /* The page sets scroll-behavior: smooth, so an animated scroll would leave
     the element moving between measurement and click. Scroll instantly, then
     measure once the layout has settled. */
  await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el?.scrollIntoView({ block: 'center', behavior: 'instant' });
  })()`);
  await sleep(500);

  const box = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!box) throw new Error(`no element for ${selector}`);

  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', {
      type,
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    });
  }
  await sleep(1400);
}

const SCENARIOS = [
  {
    name: 'wall-desktop',
    width: 1440,
    height: 900,
    fullPage: true,
    url: BASE,
  },
  {
    name: 'wall-desktop-viewport',
    width: 1440,
    height: 900,
    url: BASE,
  },
  {
    name: 'focus-after-click-desktop',
    width: 1440,
    height: 1000,
    url: BASE,
    click: '.tile[data-open="record-001"]',
  },
  {
    name: 'focus-index-block-desktop',
    width: 1440,
    height: 1000,
    url: BASE,
    click: '.tile[data-open="hardware-robot-arm"]',
  },
  {
    /* Just past the 4-column breakpoint. */
    name: 'wall-laptop',
    width: 1180,
    height: 900,
    url: BASE,
  },
  {
    name: 'focus-mobile',
    width: 390,
    height: 844,
    url: BASE,
    click: '.tile[data-open="record-003"]',
  },
  {
    name: 'wall-mobile',
    width: 390,
    height: 844,
    fullPage: true,
    url: BASE,
  },
  {
    name: 'focus-tablet',
    width: 820,
    height: 1100,
    url: BASE,
    click: '.tile[data-open="record-006"]',
  },
  {
    /* Close-ups for detail checking: tile chrome, the lightbox, mobile hero. */
    name: 'closeup-tiles',
    width: 1440,
    height: 820,
    url: BASE,
    scroll: '#intro .grid',
  },
  {
    name: 'closeup-lightbox',
    width: 1440,
    height: 900,
    url: `${BASE}#/b/record-001`,
    click: '.gallery-item:nth-child(6)',
  },
  {
    name: 'closeup-rail',
    width: 1440,
    height: 760,
    url: `${BASE}#/b/hardware-laser`,
  },
  {
    name: 'closeup-hero-mobile',
    width: 390,
    height: 700,
    url: BASE,
  },
];

const browser = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

process.on('exit', () => browser.kill());

await mkdir(OUT, { recursive: true });
const cdp = await CDP.connect(await devtoolsUrl());
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

const results = [];

for (const scenario of SCENARIOS) {
  const label = scenario.name;
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: scenario.width,
      height: scenario.height,
      deviceScaleFactor: 1,
      mobile: scenario.width < 500,
    });

    /* A hash-only change does not reload the document, so no load event would
       fire. Start from a blank page to force a genuine fresh load, and let its
       own load event pass before we arm the wait. */
    await cdp.send('Page.navigate', { url: 'about:blank' });
    await sleep(600);

    const loaded = cdp.waitFor('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: scenario.url });
    await loaded;
    await sleep(500);

    if (scenario.scroll) {
      await cdp.evaluate(`document.querySelector(${JSON.stringify(scenario.scroll)})?.scrollIntoView({block:'start',behavior:'instant'})`);
      await sleep(500);
    }

    if (scenario.click) await clickSelector(cdp, scenario.click);

    const readiness = await imagesReady(cdp);

    /* Confirm the interaction actually changed state before we photograph it. */
    const probe = await cdp.evaluate(`(() => {
      const rail = document.querySelector('.rail');
      const stage = document.querySelector('.stage');
      return {
        mode: document.body.dataset.mode || 'wall',
        railItems: document.querySelectorAll('.rail-item').length,
        railRules: document.querySelectorAll('.rail-rule').length,
        railBox: rail ? { w: Math.round(rail.getBoundingClientRect().width), h: Math.round(rail.getBoundingClientRect().height) } : null,
        stageTitle: stage ? stage.querySelector('.stage-title')?.textContent : null,
        stageTop: stage ? Math.round(stage.getBoundingClientRect().top) : null,
        heroVisible: getComputedStyle(document.querySelector('.hero')).display !== 'none',
        galleryItems: document.querySelectorAll('.gallery-item').length,
        flyLeftovers: document.querySelectorAll('.fly').length,
      };
    })()`);

    const clip = scenario.fullPage
      ? await cdp.evaluate(`(() => {
          const el = document.scrollingElement;
          return { width: Math.ceil(el.scrollWidth), height: Math.min(4600, Math.ceil(el.scrollHeight)) };
        })()`)
      : null;

    if (clip) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: scenario.width,
        height: clip.height,
        deviceScaleFactor: 1,
        mobile: scenario.width < 500,
      });
      await sleep(400);
    }

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = resolve(OUT, `cdp-${label}.png`);
    await writeFile(file, Buffer.from(shot.data, 'base64'));

    results.push({ label, file: `cdp-${label}.png`, ...probe, ...readiness });
    console.log(
      `ok   ${label.padEnd(28)} mode=${probe.mode} rail=${probe.railItems} ` +
        `hero=${probe.heroVisible ? 'shown' : 'hidden'} brokenImgs=${readiness.broken.length}`,
    );
    if (readiness.broken.length) console.log('     broken:', readiness.broken.join(', '));
  } catch (error) {
    console.log(`FAIL ${label}: ${error.message.split('\n')[0]}`);
    results.push({ label, error: error.message });
  }
}

await writeFile(resolve(OUT, 'cdp-report.json'), JSON.stringify(results, null, 2));
browser.kill();
console.log('\nreport:', resolve(OUT, 'cdp-report.json'));
