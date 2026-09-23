/* ---------------------------------------------------------------------------
   UX probe. Measures the things a user actually feels: does opening a block
   throw you somewhere, does coming back put you where you were, does the
   browser Back button work, and are the touch targets big enough for a thumb.

     node tools/audit-ux.mjs
--------------------------------------------------------------------------- */
import { spawn } from 'node:child_process';
import { ensureServer } from './ensure-server.mjs';

const CHROME =
  'C:/Users/24772/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const PORT = 9349;
const BASE = 'http://127.0.0.1:4321/';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

class CDP {
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
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
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { ok, err } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? err(new Error(JSON.stringify(message.error))) : ok(message.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, err) => this.pending.set(id, { ok, err }));
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'page threw');
    return r.result.value;
  }

  async tap(selector) {
    const box = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error(`missing ${selector}`);
    for (const type of ['touchStart', 'touchEnd']) {
      await this.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchStart' ? [{ x: box.x, y: box.y }] : [],
      });
    }
  }

  async click(selector) {
    const box = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error(`missing ${selector}`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
  }
}

await ensureServer();
const browser = spawn(
  CHROME,
  [`--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-sandbox', '--disable-gpu', '--window-size=1440,900', 'about:blank'],
  { stdio: 'ignore' },
);
process.on('exit', () => browser.kill());

let target = null;
for (let i = 0; i < 80 && !target; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch {
    /* starting */
  }
  if (!target) await sleep(250);
}

const cdp = await CDP.connect(target);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

async function load(url, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await cdp.send('Page.navigate', { url });
  await sleep(2400);
}

const scrollY = () => cdp.eval('Math.round(window.scrollY)');
const mode = () => cdp.eval('document.body.dataset.mode || "wall"');

/* ---------------------------------------------------------------- 1. drift */
console.log('\n=== 1. 打开/返回会不会把人甩走（桌面） ===');
await load(BASE, 1440, 900);

/* Stand where a real reader would: partway down the wall. */
await cdp.eval(`document.querySelector('.tile[data-open="record-003"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(900);
const beforeScroll = await scrollY();
const tileTopBefore = await cdp.eval('Math.round(document.querySelector(".tile[data-open=\\"record-003\\"]").getBoundingClientRect().top)');

await cdp.click('.tile[data-open="record-003"]');
await sleep(1500);
const openedScroll = await scrollY();
const stageTopAfter = await cdp.eval('Math.round(document.querySelector(".stage").getBoundingClientRect().top)');

await cdp.click('[data-close]');
await sleep(1800);
const backScroll = await scrollY();
const tileTopAfter = await cdp.eval('Math.round(document.querySelector(".tile[data-open=\\"record-003\\"]").getBoundingClientRect().top)');

console.log(`  点击前 scrollY = ${beforeScroll}（方块在视口 top ${tileTopBefore}px）`);
console.log(`  打开后 scrollY = ${openedScroll}（放大区 top ${stageTopAfter}px）`);
console.log(`  返回后 scrollY = ${backScroll}（方块回到 top ${tileTopAfter}px）`);
console.log(`  → 打开时被甩动 ${Math.abs(openedScroll - beforeScroll)}px；返回后位置差 ${Math.abs(backScroll - beforeScroll)}px`);

/* ------------------------------------------------- 2. fly vs smooth scroll */
console.log('\n=== 2. 飞行动画和页面滚动有没有打架 ===');
await cdp.eval(`document.querySelector('.tile[data-open="record-006"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(900);
await cdp.eval(`(() => {
  window.__flyProbe = [];
  const stage = () => document.querySelector('[data-stage-media]')?.getBoundingClientRect();
  const tick = () => {
    const ghost = document.querySelector('.fly');
    if (ghost) {
      const g = ghost.getBoundingClientRect();
      const s = stage();
      window.__flyProbe.push({
        scrollY: Math.round(window.scrollY),
        ghost: { x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.width) },
        stage: s ? { x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.width) } : null,
      });
    }
    if (window.__flyProbe.length < 60) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`);
await cdp.click('.tile[data-open="record-006"]');
await sleep(1600);
const fly = await cdp.eval('window.__flyProbe');
if (fly?.length) {
  const first = fly[0];
  const last = fly[fly.length - 1];
  const drift = last.stage ? Math.abs(last.ghost.y - last.stage.y) + Math.abs(last.ghost.x - last.stage.x) : null;
  console.log(`  采样 ${fly.length} 帧；动画期间 scrollY 从 ${first.scrollY} 变到 ${last.scrollY}`);
  console.log(`  动画结束时：幽灵块 y=${last.ghost.y} x=${last.ghost.x}，真实位置 y=${last.stage?.y} x=${last.stage?.x}`);
  console.log(`  → 落点误差 ${drift}px（越接近 0 越顺）`);
} else {
  console.log('  没采到动画帧');
}

/* --------------------------------------------------------- 3. browser back */
console.log('\n=== 3. 浏览器/系统返回键 ===');
await load(BASE, 1440, 900);
/* history.length is not a valid probe: an earlier Back leaves a forward entry
   that pushState discards before adding its own, so the total never moves.
   Check the entry's state and then actually press Back. */
await cdp.eval(`document.querySelector('.tile[data-open="about-studio"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(500);
await cdp.click('.tile[data-open="about-studio"]');
await sleep(1300);
const entryState = await cdp.eval('history.state?.pandaBlock ?? null');
console.log(`  打开后当前历史记录条目 state.pandaBlock = ${JSON.stringify(entryState)}`);
await cdp.eval('history.back()');
await sleep(1300);
const afterBack = await cdp.eval('document.body.dataset.mode || "wall"');
console.log(`  按返回后模式 = ${afterBack}`);
console.log(`  → ${afterBack === 'wall' ? '返回键先收起方块（正确）' : '返回键直接离开网站（问题）'}`);

/* ------------------------------------------------------ 4. touch targets */
console.log('\n=== 4. 触控目标尺寸（拇指最小 44px） ===');
for (const [label, url, w, h, openSel] of [
  ['方块墙', BASE, 390, 844, null],
  ['放大态', BASE, 390, 844, '.tile[data-open="record-001"]'],
]) {
  await load(url, w, h);
  if (openSel) {
    await cdp.eval(`document.querySelector(${JSON.stringify(openSel)})?.scrollIntoView({block:'center',behavior:'instant'})`);
    await sleep(500);
    await cdp.click(openSel);
    await sleep(1400);
  }
  const small = await cdp.eval(`(() => {
    const items = [...document.querySelectorAll('button, a')].filter((el) => el.offsetParent !== null);
    return items.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        what: el.className || el.tagName,
        label: (el.getAttribute('aria-label') || el.textContent).trim().slice(0, 14),
        w: Math.round(r.width), h: Math.round(r.height),
      };
    }).filter((i) => i.h < 44 || i.w < 44);
  })()`);
  console.log(`  ${label}：${small.length} 个目标小于 44px`);
  for (const item of small.slice(0, 10)) {
    console.log(`     ${String(item.h).padStart(3)}px 高 × ${String(item.w).padStart(4)}px 宽  ${item.what}  「${item.label}」`);
  }
}

/* ------------------------------------- 5. 清单抽屉：收起与展开两种状态 */
console.log('\n=== 5. 清单抽屉（收起时不占空间，展开时竖排两列） ===');
await load(BASE, 390, 844);
await cdp.eval(`document.querySelector('.tile[data-open="record-001"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(600);
await cdp.click('.tile[data-open="record-001"]');
await sleep(1600);
console.log('  打开后模式：', await mode());

const drawerShape = await cdp.eval(`(() => {
  const rail = document.querySelector('.rail');
  const cs = getComputedStyle(rail);
  const box = rail.getBoundingClientRect();
  const closed = {
    visibility: cs.visibility,
    offScreen: Math.round(box.top) >= window.innerHeight - 1,
    occupiesReadingSpace: box.top < window.innerHeight && cs.visibility !== 'hidden',
  };
  document.querySelector('[data-open-list]').click();
  return closed;
})()`);
console.log(`  收起时：visibility=${drawerShape.visibility}，移出屏幕外=${drawerShape.offScreen ? '是' : '否'}，占用阅读空间=${drawerShape.occupiesReadingSpace ? '是（问题）' : '否'}`);
await sleep(700);

const openShape = await cdp.eval(`(() => {
  const rail = document.querySelector('.rail');
  const cs = getComputedStyle(rail);
  const box = rail.getBoundingClientRect();
  const rows = new Set([...rail.querySelectorAll('.rail-item')].map((el) => Math.round(el.getBoundingClientRect().top)));
  return {
    height: Math.round(box.height),
    pctOfViewport: Math.round((box.height / window.innerHeight) * 100) ,
    columns: getComputedStyle(rail).gridTemplateColumns.split(' ').length,
    rows: rows.size,
    total: rail.querySelectorAll('.rail-item').length,
    verticalScroll: Math.max(0, rail.scrollHeight - rail.clientHeight),
    rules: rail.querySelectorAll('.rail-rule').length,
  };
})()`);
console.log(`  展开时：高 ${openShape.height}px（视口的 ${openShape.pctOfViewport}%），${openShape.columns} 列 × ${openShape.rows} 行可见，共 ${openShape.total} 项 / ${openShape.rules} 个分组标题`);
console.log(`  → 抽屉内部还需纵向滚动 ${openShape.verticalScroll}px；横向拖动需求 0px`);

/* --------------------------------- 6. 读完一块之后，换块要费多少事（核心指标） */
console.log('\n=== 6. 读完一块后换到别的块要付多少操作（核心指标） ===');

/* Design-agnostic and hit-tested: from wherever the reader has scrolled, how
   far must they scroll before some control that moves to another block can
   actually be pressed? elementFromPoint rather than rectangle comparison,
   because an element can be inside the viewport and still be covered. */
const REACH_PROBE = `(() => {
  const sheet = document.querySelector('.focus');
  const vh = window.innerHeight;
  const original = sheet.scrollTop;

  const hittable = () => [...document.querySelectorAll('[data-next], [data-prev], [data-open-list], [data-step]')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (getComputedStyle(el).visibility === 'hidden' || !r.width || !r.height) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit && (hit === el || el.contains(hit)));
    }).length;

  const atBottom = hittable();
  let scrollBack = 0;
  let probes = 0;
  if (atBottom === 0) {
    const max = sheet.scrollHeight - sheet.clientHeight;
    for (let y = original; y >= 0; y -= Math.max(40, max / 40)) {
      probes += 1;
      sheet.scrollTop = Math.max(0, y);
      if (hittable() > 0) { scrollBack = original - sheet.scrollTop; break; }
    }
    if (scrollBack === 0 && atBottom === 0) scrollBack = original;
  }
  sheet.scrollTop = original;

  const bar = document.querySelector('.sheet-bar');
  const barBox = bar ? bar.getBoundingClientRect() : null;
  const rail = document.querySelector('.rail');

  return {
    scrollTop: Math.round(original),
    maxScroll: Math.round(sheet.scrollHeight - sheet.clientHeight),
    hittableAtBottom: atBottom,
    scrollBackToReachASwitch: Math.round(scrollBack),
    probes,
    barHeight: barBox ? Math.round(barBox.height) : null,
    barSharePct: barBox ? Math.round((barBox.height / vh) * 1000) / 10 : null,
    railDragNeeded: rail ? Math.max(0, rail.scrollWidth - rail.clientWidth) : null,
    vh,
  };
})()`;

/* Self-contained: the previous section leaves the drawer open, and an open
   drawer correctly covers the sheet bar, which would make this read 0. */
await load(BASE, 390, 844);
await cdp.eval(`document.querySelector('.tile[data-open="record-001"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(600);
await cdp.click('.tile[data-open="record-001"]');
await sleep(1600);
await cdp.eval(`(() => { const s = document.querySelector('.focus'); s.scrollTop = s.scrollHeight; })()`);
await sleep(700);
const reach = await cdp.eval(REACH_PROBE);
console.log(`  面板可滚 ${reach.maxScroll}px，已读到底（scrollTop=${reach.scrollTop}）`);
console.log(`  → 此刻可直接按到的换块控件：${reach.hittableAtBottom} 个`);
console.log(`  → 要往上滚 ${reach.scrollBackToReachASwitch}px 才够到换块控件（试探 ${reach.probes} 次）`);
console.log(`  → 吸底条高 ${reach.barHeight}px，占视口 ${reach.barSharePct}%，剩余阅读高 ${reach.vh - reach.barHeight}px`);
console.log(`  → 清单横向拖动需求：${reach.railDragNeeded}px（0 = 已改为竖排抽屉）`);

/* --------------------------------- 7. 换块的代价：位置记忆与清单稳定性 */
console.log('\n=== 7. 换块代价（阅读位置 / 清单是否被重建） ===');
const switchCost = await cdp.eval(`(async () => {
  const sheet = document.querySelector('.focus');
  const rail = document.querySelector('.rail');
  rail.dataset.probe = 'keepme';
  const out = {};
  sheet.scrollTop = 400;
  out.leftAt = Math.round(sheet.scrollTop);
  document.querySelector('[data-prev]').click();
  await new Promise((r) => setTimeout(r, 900));
  out.afterPrev = Math.round(sheet.scrollTop);
  document.querySelector('[data-next]').click();
  await new Promise((r) => setTimeout(r, 900));
  out.resumedTo = Math.round(sheet.scrollTop);
  out.railRebuilt = document.querySelector('.rail').dataset.probe !== 'keepme';
  return out;
})()`);
console.log(`  离开时 ${switchCost.leftAt}px → 去上一块 → 回来停在 ${switchCost.resumedTo}px`);
console.log(`  → 位置找回误差 ${Math.abs(switchCost.resumedTo - switchCost.leftAt)}px`);
console.log(`  → 清单是否被重建：${switchCost.railRebuilt ? '是（每次换块都会闪一下）' : '否'}`);

/* --------------------------------- 8. 尺寸矩阵 */
console.log('\n=== 8. 各视口下的触控目标矩阵 ===');
const SIZES = [['手机 390×844', 390, 844, true], ['平板 834×1112', 834, 1112, true], ['桌面 1440×900', 1440, 900, false]];
for (const [label, w, h, mobile] of SIZES) {
  await load(`${BASE}#/b/record-001`, w, h);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await sleep(900);
  const row = await cdp.eval(`(() => {
    const decorative = /tile-x|tile-plus/;
    /* checkVisibility is the only predicate that is right for both fixed
       elements (offsetParent is null) and hidden ones (offsetWidth is not). */
    const shown = (el) => (typeof Element.prototype.checkVisibility === 'function'
      ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
      : false) && !el.closest('[inert]');
    const all = [...document.querySelectorAll('button, a')].filter(shown);
    const small = all.filter((el) => { const r = el.getBoundingClientRect(); return r.height < 44 && !decorative.test(el.className); });
    return {
      coarse: matchMedia('(pointer: coarse)').matches,
      targets: all.length,
      under44: small.length,
      layout: getComputedStyle(document.querySelector('.rail')).position,
      bar: document.querySelector('.sheet-bar') ? getComputedStyle(document.querySelector('.sheet-bar')).display : 'none',
    };
  })()`);
  console.log(`  ${label.padEnd(16)} 左栏=${row.layout.padEnd(7)} 吸底条=${row.bar.padEnd(6)} 目标 ${row.targets} 个，小于44px ${row.under44} 个`);
}

browser.kill();
