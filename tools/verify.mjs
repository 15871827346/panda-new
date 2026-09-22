/* ---------------------------------------------------------------------------
   Functional verification over CDP. Exercises the real interaction path and
   fails loudly, independent of how the page was authored.

     node tools/verify.mjs
--------------------------------------------------------------------------- */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME =
  'C:/Users/24772/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const PORT = 9345;
const BASE = 'http://127.0.0.1:4321/';
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
    this.events = [];
    this.consoleErrors = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { ok, err } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? err(new Error(JSON.stringify(message.error))) : ok(message.result);
      } else if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
        this.consoleErrors.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
      } else if (message.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(message.params.exceptionDetails.exception?.description ?? 'exception');
      } else {
        this.events.push(message);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, err) => this.pending.set(id, { ok, err }));
  }

  async waitForLoaded(timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (this.events.some((event) => event.method === 'Page.loadEventFired')) return;
      await sleep(100);
    }
    throw new Error('load event never fired');
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'page threw');
    return result.result.value;
  }

  async click(selector) {
    await this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',behavior:'instant'})`);
    await sleep(400);
    const box = await this.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!box) throw new Error(`missing element: ${selector}`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    await sleep(1100);
  }

  async key(key, code, keyCode) {
    for (const type of ['keyDown', 'keyUp']) {
      await this.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    }
    await sleep(700);
  }
}

const browser = spawn(
  CHROME,
  [`--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-sandbox', '--disable-gpu', '--window-size=1440,900', 'about:blank'],
  { stdio: 'ignore' },
);
process.on('exit', () => browser.kill());

let url = null;
for (let i = 0; i < 80 && !url; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    url = list.find((target) => target.type === 'page')?.webSocketDebuggerUrl;
  } catch {
    /* still starting */
  }
  if (!url) await sleep(250);
}
if (!url) throw new Error('no devtools target');

const cdp = await CDP.connect(url);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const loaded = cdp.waitForLoaded();
await cdp.send('Page.navigate', { url: BASE });
await loaded;
await sleep(800);

const checks = [];
const record = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const probe = () =>
  cdp.evaluate(`(() => ({
    mode: document.body.dataset.mode || 'wall',
    title: document.querySelector('.stage-title')?.textContent ?? null,
    rail: document.querySelectorAll('.rail-item').length,
    railCurrent: document.querySelector('.rail-item[aria-current="true"]')?.textContent?.trim() ?? null,
    hero: getComputedStyle(document.querySelector('.hero')).display !== 'none',
    wall: getComputedStyle(document.querySelector('.wall')).display !== 'none',
    lightbox: !!document.querySelector('.lightbox'),
    lightboxCount: document.querySelector('.lightbox-bar .mono:nth-child(2)')?.textContent ?? null,
    hash: location.hash,
    focused: document.activeElement?.className ?? null,
    fly: document.querySelectorAll('.fly').length,
    stageImgOk: (() => { const i = document.querySelector('.stage-media img'); return !!i && i.complete && i.naturalWidth > 0; })(),
  }))()`);

/* 1. initial wall ---------------------------------------------------------- */
let s = await probe();
record('首屏是方块墙', s.mode === 'wall' && s.wall && s.hero, `mode=${s.mode}`);
record('16 个方块全部渲染', (await cdp.evaluate('document.querySelectorAll(".tile").length')) === 16);

/* 2. open a block ---------------------------------------------------------- */
await cdp.click('.tile[data-open="record-004"]');
s = await probe();
record('点击后进入放大态', s.mode === 'focus' && !s.wall, `mode=${s.mode}`);
record('放大的是被点的那一块', s.title === '建筑模型制作', `title=${s.title}`);
record('其余块收进左栏且共 16 项', s.rail === 16, `rail=${s.rail}`);
record('左栏标出当前块', s.railCurrent?.includes('建筑模型制作'), `current=${s.railCurrent}`);
record('放大态隐藏大标题', s.hero === false);
record('主图已加载', s.stageImgOk === true);
record('地址栏写入深链', s.hash === '#/b/record-004', `hash=${s.hash}`);
record('动画残留已清理', s.fly === 0, `fly=${s.fly}`);

/* 3. switch from the rail -------------------------------------------------- */
/* Selected by id: the rail now leads with a group rule, so positional
   selectors would land on the wrong element. */
await cdp.click('.rail-item[data-open="about-studio"]');
s = await probe();
record('左栏可切到 01 社团介绍', s.title === '社团介绍' && s.mode === 'focus', `title=${s.title}`);

/* 4. gallery + lightbox ---------------------------------------------------- */
const hasGallery = await cdp.evaluate('document.querySelectorAll(".gallery-item").length');
record('当前块图集数量符合数据', hasGallery === 0, `gallery=${hasGallery}（社团介绍无图集）`);
record('左栏按分组出现分隔条', (await cdp.evaluate('document.querySelectorAll(".rail-rule").length')) === 4);
await cdp.click('.rail-item[data-open="record-001"]');
const galleryCount = await cdp.evaluate('document.querySelectorAll(".gallery-item").length');
record('3D 打印作品带 15 张图集', galleryCount === 15, `gallery=${galleryCount}`);
await cdp.click('.gallery-item:nth-child(3)');
s = await probe();
record('点图集打开大图', s.lightbox && s.lightboxCount === '03 / 15', `count=${s.lightboxCount}`);
await cdp.key('ArrowRight', 'ArrowRight', 39);
s = await probe();
record('大图可左右翻页', s.lightboxCount === '04 / 15', `count=${s.lightboxCount}`);
await cdp.key('Escape', 'Escape', 27);
s = await probe();
record('Esc 先关大图、仍在放大态', !s.lightbox && s.mode === 'focus');

/* 5. keyboard stepping ----------------------------------------------------- */
const before = s.title;
await cdp.key('ArrowDown', 'ArrowDown', 40);
s = await probe();
record('方向键切换上/下一个块', s.title !== before, `${before} → ${s.title}`);

/* 6. return to the wall ---------------------------------------------------- */
await cdp.click('[data-close]');
s = await probe();
record('点返回回到方块墙', s.mode === 'wall' && s.wall && s.hero, `mode=${s.mode}`);
record('返回后清除深链', s.hash === '', `hash=${s.hash}`);
record('返回后无动画残留', s.fly === 0);

/* 7. deep link on a fresh load -------------------------------------------- */
await cdp.send('Page.navigate', { url: `${BASE}#/b/hardware-mr` });
await sleep(1600);
s = await probe();
record('直接带 # 打开即进放大态', s.mode === 'focus' && s.title === 'MR 设备', `title=${s.title}`);

/* 8. language switch ------------------------------------------------------- */
await cdp.click('[data-lang="en"]');
s = await probe();
record('切换英文后内容跟随', s.title === 'MR devices', `title=${s.title}`);
record('英文下仍是放大态', s.mode === 'focus');
const enTiles = await cdp.evaluate('document.querySelectorAll(".tile").length');
record('英文方块墙同为 16 块', enTiles === 16);

/* 9. errors ---------------------------------------------------------------- */
record('全程无 console 报错/异常', cdp.consoleErrors.length === 0, cdp.consoleErrors.slice(0, 3).join(' | '));

const failed = checks.filter((check) => !check.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((check) => check.name).join(', '));
  process.exitCode = 1;
}
browser.kill();
