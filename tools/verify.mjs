/* ---------------------------------------------------------------------------
   Functional verification over CDP. Exercises the real interaction path and
   fails loudly, independent of how the page was authored.

     node tools/verify.mjs
--------------------------------------------------------------------------- */
import { spawn } from 'node:child_process';
import { ensureServer } from './ensure-server.mjs';
/* Imported so the assertions can be derived from the real block order instead
   of hard-coding titles that would go stale silently. */
import { BLOCKS } from '../data.js';

const nextOf = (id) => BLOCKS[BLOCKS.findIndex((b) => b.id === id) + 1]?.title.zh ?? null;

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

await ensureServer();
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
    sheetScroll: (() => { const f = document.querySelector('.focus'); return f ? Math.round(f.scrollTop) : null; })(),
    listOpen: document.body.dataset.list === 'open',
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
await cdp.key('ArrowRight', 'ArrowRight', 39);
s = await probe();
record('方向键切换上/下一个块', s.title !== before, `${before} → ${s.title}`);

/* 6. return to the wall ---------------------------------------------------- */
await cdp.click('.stage-bar [data-close]');
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

/* 9. phone: reach another block without going back up --------------------- */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await cdp.send('Page.navigate', { url: BASE });
await sleep(2200);
await cdp.evaluate(`document.querySelector('.tile[data-open="record-001"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(400);
await cdp.click('.tile[data-open="record-001"]');
await sleep(1500);
const sheetOnPhone = await probe();
record('手机上详情铺满整屏', sheetOnPhone.sheetPosition === 'fixed' && sheetOnPhone.mode === 'focus');

/* Read to the very bottom — where the old layout stranded the reader. */
await cdp.evaluate(`(() => { const s = document.querySelector('.focus'); s.scrollTop = s.scrollHeight; })()`);
await sleep(600);
const depth = await cdp.evaluate('Math.round(document.querySelector(".focus").scrollTop)');
record('确实已滚到长内容底部', depth > 500, `scrollTop=${depth}px`);

const bar = await cdp.evaluate(`(() => {
  const el = document.querySelector('[data-next]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    h: Math.round(r.height), w: Math.round(r.width),
    inThumbZone: r.top >= window.innerHeight * 0.6,
    unobstructed: Boolean(hit && (hit === el || el.contains(hit))),
  };
})()`);
record('「下一篇」落在拇指区（视口下 40%）', bar?.inThumbZone === true, JSON.stringify(bar));
record('「下一篇」没有被任何元素压住', bar?.unobstructed === true);
record('「下一篇」触控高度 ≥44px', (bar?.h ?? 0) >= 44, `${bar?.h}px`);

/* A4 — the label is checked against the data, not a hard-coded string. */
const expectedNext = nextOf('record-001');
const nextLabel = await cdp.evaluate(`document.querySelector('[data-next] .bar-title')?.textContent?.trim() ?? ''`);
record('按钮写的就是它要去的块名', nextLabel === expectedNext, `标「${nextLabel}」/ 数据下一块「${expectedNext}」`);

/* A1 — the headline claim: one tap from the bottom, no scrolling back. */
await cdp.click('[data-next]');
await sleep(1300);
const afterNext = await probe();
record('一次点击即从底部换到下一篇', afterNext.title === expectedNext, `title=${afterNext.title}`);
record('换到没看过的块从头显示', afterNext.sheetScroll === 0, `sheetScroll=${afterNext.sheetScroll}`);
record('换块时页面本身仍未被甩走', afterNext.scrollY === sheetOnPhone.scrollY, `scrollY=${afterNext.scrollY}`);

/* A5 — switching must not rebuild the list. */
await cdp.evaluate(`document.querySelector('.rail').dataset.probe = 'keepme'`);
await cdp.evaluate(`(() => { const r = document.querySelector('.rail'); r.scrollTop = 40; })()`);
await cdp.click('[data-next]');
await sleep(1200);
const railIntact = await cdp.evaluate(`(() => {
  const r = document.querySelector('.rail');
  return { tag: r?.dataset.probe ?? null, items: r?.querySelectorAll('.rail-item').length ?? 0 };
})()`);
record('换块时清单未被重建', railIntact.tag === 'keepme', JSON.stringify(railIntact));
record('换块后清单仍是完整 16 项', railIntact.items === 16, `items=${railIntact.items}`);

/* A6 — per-block reading position. Use the value the sheet actually reached:
   a short block cannot scroll as far as a long one, so asking for a fixed
   number would be asserting against a position that does not exist. */
const setScroll = await cdp.evaluate(`(() => { const s = document.querySelector('.focus'); s.scrollTop = 320; return Math.round(s.scrollTop); })()`);
await sleep(300);
await cdp.click('[data-prev]');
await sleep(1200);
await cdp.click('[data-next]');
await sleep(1200);
const resumed = await probe();
record('回到看过的块会停在原处', Math.abs((resumed.sheetScroll ?? 0) - setScroll) <= 6, `期望 ${setScroll}，实得 ${resumed.sheetScroll}`);

/* A2 — the list is reachable from mid-sheet via the drawer. */
await cdp.click('[data-open-list]');
await sleep(700);
const drawer = await cdp.evaluate(`(() => {
  const rail = document.querySelector('.rail');
  const cs = getComputedStyle(rail);
  const cur = rail.querySelector('.rail-item[aria-current="true"]');
  const box = cur?.getBoundingClientRect();
  const railBox = rail.getBoundingClientRect();
  return {
    open: document.body.dataset.list === 'open',
    visible: cs.visibility === 'visible',
    items: rail.querySelectorAll('.rail-item').length,
    rules: rail.querySelectorAll('.rail-rule').length,
    overscroll: cs.overscrollBehaviorY,
    touchAction: cs.touchAction,
    currentOnScreen: Boolean(box && box.top >= railBox.top && box.bottom <= railBox.bottom + 1),
    stageInert: document.querySelector('.stage')?.hasAttribute('inert') ?? false,
  };
})()`);
record('「全部方块」升起清单抽屉', drawer.open && drawer.visible, JSON.stringify(drawer));
record('抽屉里 16 块齐全、分组条 4 条', drawer.items === 16 && drawer.rules === 4, `${drawer.items}/${drawer.rules}`);
record('抽屉当前块已滚到可见位置', drawer.currentOnScreen === true);
record('抽屉滚动不外溢（overscroll contain）', drawer.overscroll === 'contain', drawer.overscroll);
record('抽屉只允许纵向手势', /^pan-y/.test(drawer.touchAction ?? ''), drawer.touchAction);
record('抽屉打开时舞台被 inert 隔离', drawer.stageInert === true);

/* Every drawer row must be genuinely tappable, not merely inside the drawer's
   box. The sticky sheet bar painted over the last rows until z-order was
   fixed, and a rect-containment comparison could not see that. */
const hitAll = await cdp.evaluate(`(() => {
  const rail = document.querySelector('.rail');
  const misses = [];
  for (const item of rail.querySelectorAll('.rail-item')) {
    rail.scrollTop = Math.max(0, item.offsetTop - rail.clientHeight / 2 + item.offsetHeight / 2);
    const r = item.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !item.contains(hit)) {
      misses.push(item.dataset.open + '→' + (hit?.closest('[data-open]')?.dataset.open ?? hit?.className ?? 'null'));
    }
  }
  return misses;
})()`);
record('抽屉 16 项逐条命中测试全部可点', hitAll.length === 0, hitAll.slice(0, 4).join(', '));

/* Bring the target item inside the drawer's own scroll first. Tapping an
   element that is scrolled out of its container would hit whatever is painted
   at those coordinates instead — a real reader never does this. */
const tapRailItem = async (id) => {
  await cdp.evaluate(`(() => {
    const rail = document.querySelector('.rail');
    const item = rail.querySelector('.rail-item[data-open="${id}"]');
    rail.scrollTop = Math.max(0, item.offsetTop - rail.clientHeight / 2 + item.offsetHeight / 2);
  })()`);
  await sleep(400);
  await cdp.click(`.rail-item[data-open="${id}"]`);
  await sleep(1300);
};

await tapRailItem('record-007');
const jumped = await probe();
record('从抽屉直接跳到指定块', jumped.title === 'Mini-HBUT 校园信息服务', `title=${jumped.title}`);
record('跳转后抽屉自动收起', jumped.listOpen === false);

/* A3 — the old foot-gun: tapping the current block must not close the sheet. */
await cdp.click('[data-open-list]');
await sleep(600);
const titleBeforeSelfTap = (await probe()).title;
await tapRailItem('record-007');
const selfTap = await probe();
record(
  '点当前块只收清单、不关详情页',
  selfTap.mode === 'focus' && selfTap.title === titleBeforeSelfTap && selfTap.listOpen === false,
  `mode=${selfTap.mode} listOpen=${selfTap.listOpen}`,
);

/* A12 — aria-current is honest. */
const ariaCurrent = await cdp.evaluate(`(() => ({
  falseOnes: document.querySelectorAll('.rail-item[aria-current="false"]').length,
  trueOnes: document.querySelectorAll('.rail-item[aria-current="true"]').length,
}))()`);
record('aria-current 只标当前块', ariaCurrent.falseOnes === 0 && ariaCurrent.trueOnes === 1, JSON.stringify(ariaCurrent));

/* A13 — the two strings that used to be dead. */
await cdp.evaluate('history.back()');
await sleep(1200);
const hints = await cdp.evaluate(`(() => ({
  open: document.querySelector('.hero-hint')?.textContent?.trim() ?? '',
}))()`);
record('首屏出现了"点方块放大"的提示', hints.open.includes('点击任意方块放大'), hints.open);

/* A9 — the sticky bar must not sit on top of the last gallery image. */
await cdp.evaluate(`document.querySelector('.tile[data-open="record-001"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(400);
await cdp.click('.tile[data-open="record-001"]');
await sleep(1400);
await cdp.evaluate(`(() => { const s = document.querySelector('.focus'); s.scrollTop = s.scrollHeight; })()`);
await sleep(500);
const overlap = await cdp.evaluate(`(() => {
  const items = document.querySelectorAll('.gallery-item');
  const last = items[items.length - 1];
  const bar = document.querySelector('.sheet-bar');
  if (!last || !bar) return null;
  return { gap: Math.round(bar.getBoundingClientRect().top - last.getBoundingClientRect().bottom) };
})()`);
record('吸底条不遮住最后一张图', overlap === null || overlap.gap >= -1, JSON.stringify(overlap));

/* Target sweep. The visibility predicate matters more than it looks:
   offsetParent is null for fixed elements, and offsetWidth/offsetHeight are
   non-zero for visibility:hidden ones — both produce a sweep that quietly
   stops covering the drawer. So: require checkVisibility, and if it is ever
   missing, fail loudly instead of falling back to a weaker guess. */
const sweepTargets = `((() => {
  const decorative = /tile-x|tile-plus/;
  if (typeof Element.prototype.checkVisibility !== 'function') {
    return ['NO-checkVisibility: 可见性判断不可用，本条检查无效'];
  }
  const shown = (el) => el.checkVisibility({
      opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true,
    }) && !el.closest('[inert]');
  return [...document.querySelectorAll('button, a')]
    .filter(shown)
    .map((el) => { const r = el.getBoundingClientRect(); return { what: el.className || el.tagName, w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((i) => i.h < 44 && !decorative.test(i.what))
    .map((i) => i.what + ' ' + i.w + 'x' + i.h);
})())`;
const closedSweep = await cdp.evaluate(sweepTargets);
record('手机上可见目标全部 ≥44px（关闭抽屉）', closedSweep.length === 0, closedSweep.slice(0, 5).join(', '));
await cdp.click('[data-open-list]');
await sleep(700);
const openSweep = await cdp.evaluate(sweepTargets);
record('抽屉打开后可见目标全部 ≥44px', openSweep.length === 0, openSweep.slice(0, 5).join(', '));
await cdp.evaluate(`document.body.dataset.list !== 'open' || document.querySelector('.rail-done').click()`);
await sleep(500);

/* Sanity: the sweep predicate is not silently matching nothing. */
const sweepCount = await cdp.evaluate(`(() => {
  if (typeof Element.prototype.checkVisibility !== 'function') return -1;
  return [...document.querySelectorAll('button, a')]
    .filter((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
    .length;
})()`);
record('目标扫描确实覆盖到元素（非空判）', sweepCount > 15, `扫到 ${sweepCount} 个`);

/* A8 — coarse-pointer sizing. Neither Emulation.setEmulatedMedia's `pointer`
   feature nor mobile emulation at a desktop width produces a coarse pointer in
   the headless shell, so assert the stylesheet itself rather than pretend to
   measure it. This is deterministic in any browser and still fails if the rule
   is deleted or reverted to a width query. */
const coarseRule = await cdp.evaluate(`(() => {
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (rule.type !== CSSRule.MEDIA_RULE) continue;
      if (!/pointer:\\s*coarse/.test(rule.conditionText)) continue;
      const text = rule.cssText;
      const usesTap = /var\\(--tap\\)/.test(
        [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText ?? ''); } catch { return []; } }).join(' ')
      );
      return { condition: rule.conditionText, usesTap };
    }
  }
  return null;
})()`);
record('存在按输入设备判定的粗指针规则', coarseRule !== null, JSON.stringify(coarseRule));
record('该规则同时覆盖触屏与窄屏', Boolean(coarseRule && /max-width/.test(coarseRule.condition) && /coarse/.test(coarseRule.condition)), coarseRule?.condition);
const tapToken = await cdp.evaluate(`(() => {
  const css = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText ?? ''); } catch { return []; } }).join('\\n');
  return { usesVar: css.includes('var(--tap)'), hardCoded44: (css.match(/min-height: 44px/g) || []).length };
})()`);
record('按钮尺寸统一走 --tap 变量，没有残留写死值', tapToken.usesVar === true && tapToken.hardCoded44 === 0, JSON.stringify(tapToken));

/* 10. regressions found by the independent audit — each earns a test so it
       cannot come back quietly. The suite passed 62/62 while every one of
       these was live. */
/* A short viewport on purpose: at 900px tall this sheet only scrolls ~126px,
   less than the test scroll, which would make the check meaningless. */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 600, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: `${BASE}#/b/record-001` });
await sleep(2200);

/* Desktop rail: `position: sticky` with no offset silently behaves as
   relative, so assert it actually holds still — reading the computed
   `position` string would have passed the broken version.
   Sticky has a limited range, so test inside it: a modest scroll must leave
   the rail exactly where it was. Under `inset: auto` it moved one-for-one. */
const railStick = await cdp.evaluate(`(async () => {
  const rail = document.querySelector('.rail');
  const sheet = document.querySelector('.focus');
  sheet.scrollTop = 0;
  await new Promise((r) => setTimeout(r, 150));
  const before = Math.round(rail.getBoundingClientRect().top);
  sheet.scrollTop = 150;
  await new Promise((r) => setTimeout(r, 250));
  return {
    before,
    after: Math.round(rail.getBoundingClientRect().top),
    scrolled: Math.round(sheet.scrollTop),
  };
})()`);
record(
  '桌面左栏真的吸得住（不是只写着 sticky）',
  railStick.before === railStick.after && railStick.scrolled === 150,
  `滚动 ${railStick.scrolled}px，左栏 top ${railStick.before} → ${railStick.after}`,
);

/* Stranded lightbox: Back used to null the state without removing the node,
   leaving an opaque full-screen sheet nobody could dismiss. Run from a clean
   page so history.back() is unambiguously the sheet's own entry. */
await cdp.send('Page.navigate', { url: BASE });
await sleep(1800);
await cdp.evaluate(`document.querySelector('.tile[data-open="record-001"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(400);
await cdp.click('.tile[data-open="record-001"]');
await sleep(1400);
await cdp.evaluate('document.querySelector(".gallery-item").click()');
await sleep(700);
const lbOpen = await cdp.evaluate('!!document.querySelector(".lightbox")');
await cdp.evaluate('history.back()');
await sleep(1600);
const stranded = await cdp.evaluate(`(() => {
  const l = document.querySelector('.lightbox');
  if (!l) return { present: false };
  const cs = getComputedStyle(l);
  return { present: true, covering: cs.position === 'fixed' && cs.display !== 'none' };
})()`);
const afterBack = await probe();
record('大图开着时返回不会留下盖住页面的遮罩', lbOpen && !stranded.present, `大图曾打开=${lbOpen}，残留=${stranded.present}`);
record('返回后回到方块墙', afterBack.mode === 'wall', `mode=${afterBack.mode}`);

/* Deep link then close: the sheet must not navigate out of the site. */
await cdp.send('Page.navigate', { url: `${BASE}#/b/hardware-mr` });
await sleep(2000);
const deepHistory = await cdp.evaluate('history.length');
await cdp.click('.stage-bar [data-close]');
await sleep(1400);
const afterDeepClose = await cdp.evaluate(`({ mode: document.body.dataset.mode || 'wall', host: location.host })`);
record('深链进入后点关闭留在本站', afterDeepClose.mode === 'wall' && afterDeepClose.host.includes('4321'), JSON.stringify(afterDeepClose));
record('深链关闭不会消耗历史记录', (await cdp.evaluate('history.length')) === deepHistory, `${deepHistory} → ${await cdp.evaluate('history.length')}`);

/* Lightbox overshoot: the raw index used to be stored, so wasted ArrowRight
   presses had to be paid back one for one. */
await cdp.send('Page.navigate', { url: `${BASE}#/b/record-002` });
await sleep(2000);
await cdp.evaluate('document.querySelector(".gallery-item").click()');
await sleep(600);
await cdp.key('ArrowRight', 'ArrowRight', 39);
await cdp.key('ArrowRight', 'ArrowRight', 39);
await cdp.key('ArrowRight', 'ArrowRight', 39);
const atEnd = await cdp.evaluate('document.querySelector(".lightbox-bar .mono:nth-child(2)")?.textContent?.trim()');
await cdp.key('ArrowLeft', 'ArrowLeft', 37);
const afterLeft = await cdp.evaluate('document.querySelector(".lightbox-bar .mono:nth-child(2)")?.textContent?.trim()');
record('大图按过头之后左键立刻有反应', atEnd === '02 / 02' && afterLeft === '01 / 02', `${atEnd} → ${afterLeft}`);
await cdp.evaluate('document.querySelector("[data-lb-close]").click()');
await sleep(500);

/* busy must not latch: switch repeatedly and confirm the sheet still closes. */
const busyLatch = await cdp.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 4; i += 1) {
    document.querySelector('[data-next]').click();
    await wait(250);
  }
  document.querySelector('.stage-bar [data-close]').click();
  await wait(900);
  return document.body.dataset.mode || 'wall';
})()`);
record('连续换块后仍能正常关闭（busy 未卡死）', busyLatch === 'wall', `mode=${busyLatch}`);

/* Roving focus must not walk out of its own grid. The handler reads
   event.target, so the key must be dispatched on the tile itself — firing it
   at document would silently do nothing and pass for the wrong reason. */
await cdp.send('Page.navigate', { url: BASE });
await sleep(1800);
const roving = await cdp.evaluate(`(async () => {
  const first = document.querySelectorAll('.grid')[0];
  const tiles = [...first.querySelectorAll('.tile')];
  const last = tiles[tiles.length - 1];
  last.focus();
  await new Promise((r) => setTimeout(r, 60));
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const active = document.activeElement;
  return {
    moved: active !== last,
    stayedInGrid: first.contains(active),
    active: active?.dataset?.open ?? null,
  };
})()`);
record('末块按方向键不会跳进下一段', roving.stayedInGrid === true, JSON.stringify(roving));

/* 11. errors --------------------------------------------------------------- */
record('全程无 console 报错/异常', cdp.consoleErrors.length === 0, cdp.consoleErrors.slice(0, 3).join(' | '));

const failed = checks.filter((check) => !check.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((check) => check.name).join(', '));
  process.exitCode = 1;
}
browser.kill();
