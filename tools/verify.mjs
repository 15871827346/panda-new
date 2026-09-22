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
    scrollY: Math.round(window.scrollY),
    sheetPosition: (() => { const f = document.querySelector('.focus'); return f ? getComputedStyle(f).position : null; })(),
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
record('首屏是方块墙', s.mode === 'wall' && s.wall, `mode=${s.mode}`);
record('16 个方块全部渲染', (await cdp.evaluate('document.querySelectorAll(".tile").length')) === 16);

/* 2. open a block from partway down the wall -------------------------------- */
/* This is where the old page-swap model threw the reader 2700px to the top. */
await cdp.evaluate(`document.querySelector('.tile[data-open="record-004"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(500);
const openedFrom = await cdp.evaluate('Math.round(window.scrollY)');
await cdp.click('.tile[data-open="record-004"]');
s = await probe();
record('点击后进入放大态', s.mode === 'focus', `mode=${s.mode}`);
record('放大的是被点的那一块', s.title === '建筑模型制作', `title=${s.title}`);
record('其余块收进左栏且共 16 项', s.rail === 16, `rail=${s.rail}`);
record('左栏标出当前块', s.railCurrent?.includes('建筑模型制作'), `current=${s.railCurrent}`);
record('详情是覆盖层，不是换页', s.sheetPosition === 'fixed', `position=${s.sheetPosition}`);
record('打开时页面没有被甩走', s.scrollY === openedFrom, `scrollY ${openedFrom} → ${s.scrollY}`);
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
record('点返回回到方块墙', s.mode === 'wall' && s.wall, `mode=${s.mode}`);
record('返回后清除深链', s.hash === '', `hash=${s.hash}`);
record('返回后无动画残留', s.fly === 0);

/* 6b. browser Back closes the sheet, not the site -------------------------- */
await cdp.evaluate(`document.querySelector('.tile[data-open="record-002"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(500);
await cdp.click('.tile[data-open="record-002"]');
await sleep(1300);
/* Assert the sheet really opened first — otherwise the Back check below would
   pass vacuously with the wall already showing. */
const openedAgain = await probe();
record('再次点开方块', openedAgain.mode === 'focus' && openedAgain.title === '校园数字场景重建', `title=${openedAgain.title}`);
/* history.length is a poor probe here: the earlier Back left a forward entry,
   which pushState discards before adding its own, so the total never moves.
   Assert the entry itself carries our state instead. */
const entryState = await cdp.evaluate('history.state?.pandaBlock ?? null');
record('打开方块会写入一条可返回的历史', entryState === 'record-002', `state=${entryState}`);
await cdp.evaluate('history.back()');
await sleep(1300);
s = await probe();
record('系统返回键收起详情而不是退出网站', s.mode === 'wall', `mode=${s.mode}`);

/* 7. deep link on a fresh load -------------------------------------------- */
await cdp.send('Page.navigate', { url: `${BASE}#/b/hardware-mr` });
await sleep(1600);
s = await probe();
record('直接带 # 打开即进放大态', s.mode === 'focus' && s.title === 'MR 设备', `title=${s.title}`);

/* 8. Chinese only ---------------------------------------------------------- */
const langButtons = await cdp.evaluate('document.querySelectorAll("[data-lang]").length');
record('顶栏已无中英文切换', langButtons === 0, `切换按钮 ${langButtons} 个`);
const langWidget = await cdp.evaluate('document.querySelectorAll(".lang").length');
record('切换控件整体移除', langWidget === 0);
record('文档语言为 zh-CN', (await cdp.evaluate('document.documentElement.lang')) === 'zh-CN');
const latinLeak = await cdp.evaluate(`(() => {
  const text = document.querySelector('.site-header').innerText + document.querySelector('.hero').innerText;
  return /\\b(the|and|of|Studio introduction)\\b/i.test(text) ? text.slice(0, 60) : '';
})()`);
record('首屏无残留英文文案', latinLeak === '', latinLeak);

/* 9. thumb targets on a phone ---------------------------------------------- */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await cdp.send('Page.navigate', { url: BASE });
await sleep(2200);
await cdp.evaluate(`document.querySelector('.tile[data-open="record-001"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(400);
await cdp.click('.tile[data-open="record-001"]');
await sleep(1500);
const sheetOnPhone = await probe();
record('手机上详情铺满整屏', sheetOnPhone.sheetPosition === 'fixed' && sheetOnPhone.mode === 'focus');
const smallTargets = await cdp.evaluate(`(() => {
  const decorative = /tile-x|tile-plus/;
  return [...document.querySelectorAll('button, a')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => { const r = el.getBoundingClientRect(); return { what: el.className || el.tagName, w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((i) => i.h < 44 && !decorative.test(i.what))
    .map((i) => i.what + ' ' + i.w + 'x' + i.h);
})()`);
record('手机端所有可点目标高度 ≥44px', smallTargets.length === 0, smallTargets.slice(0, 5).join(', '));
const railPeek = await cdp.evaluate(`(() => {
  const rail = document.querySelector('.rail');
  const cur = document.querySelector('.rail-item[aria-current="true"]');
  if (!rail || !cur) return null;
  const r = rail.getBoundingClientRect();
  const c = cur.getBoundingClientRect();
  return { visible: c.left >= r.left - 1 && c.right <= r.right + 1, snap: getComputedStyle(rail).scrollSnapType };
})()`);
record('手机上当前块在左栏里可见（自动滚到中间）', railPeek?.visible === true, JSON.stringify(railPeek));

/* 10. errors --------------------------------------------------------------- */
record('全程无 console 报错/异常', cdp.consoleErrors.length === 0, cdp.consoleErrors.slice(0, 3).join(' | '));

const failed = checks.filter((check) => !check.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((check) => check.name).join(', '));
  process.exitCode = 1;
}
browser.kill();
