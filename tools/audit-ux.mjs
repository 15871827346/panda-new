/* ---------------------------------------------------------------------------
   UX probe. Measures the things a user actually feels: does opening a block
   throw you somewhere, does coming back put you where you were, does the
   browser Back button work, and are the touch targets big enough for a thumb.

     node tools/audit-ux.mjs
--------------------------------------------------------------------------- */
import { spawn } from 'node:child_process';

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

/* --------------------------------------------- 5. mobile rail discoverability */
console.log('\n=== 5. 手机端左栏（切换下一个块的地方） ===');
await load(BASE, 390, 844);
await cdp.eval(`document.querySelector('.tile[data-open="record-001"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(600);
await cdp.click('.tile[data-open="record-001"]');
await sleep(1600);
console.log('  打开后模式：', await mode());
const rail = await cdp.eval(`(() => {
  const el = document.querySelector('.rail');
  const r = el.getBoundingClientRect();
  return {
    top: Math.round(r.top), height: Math.round(r.height),
    visibleItems: Math.round(r.width / (el.firstElementChild?.getBoundingClientRect().width || 1)),
    total: el.querySelectorAll('.rail-item').length,
    scrollableW: el.scrollWidth, clientW: el.clientWidth,
    direction: getComputedStyle(el).flexDirection,
  };
})()`);
console.log(`  横排方向 ${rail.direction}，占 ${rail.height}px 高，一屏只看得见约 ${rail.visibleItems} 项 / 共 ${rail.total} 项`);
console.log(`  需要横向拖动 ${rail.scrollableW - rail.clientW}px 才能看完`);

const viewportBudget = await cdp.eval(`(() => {
  const stage = document.querySelector('.stage').getBoundingClientRect();
  return { stageTop: Math.round(stage.top), vh: window.innerHeight };
})()`);
console.log(`  主内容从视口 ${viewportBudget.stageTop}px 处开始（视口高 ${viewportBudget.vh}px）`);

/* --------------------------------- 6. 读完一块之后，换块要费多少事（核心指标） */
console.log('\n=== 6. 读完一块后换到别的块要付多少操作（核心指标） ===');

const REACH_PROBE = `(() => {
  const sheet = document.querySelector('.focus');
  const rail = document.querySelector('.rail');
  const vh = window.innerHeight;
  const inView = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (getComputedStyle(el).visibility === 'hidden' || !r.width || !r.height) return false;
    return r.bottom > 0 && r.top < vh;
  };
  const inThumbZone = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (getComputedStyle(el).visibility === 'hidden' || !r.width || !r.height) return false;
    return r.top >= vh * 0.6 && r.bottom <= vh + 1;
  };

  /* Everything that can move you to a different block. */
  const switchers = [
    ...document.querySelectorAll('.rail-item'),
    ...document.querySelectorAll('[data-step], [data-next], [data-prev], [data-open-list]'),
  ];

  const railBox = rail ? rail.getBoundingClientRect() : null;
  const railOffsetTop = rail
    ? Math.round(rail.getBoundingClientRect().top - sheet.getBoundingClientRect().top + sheet.scrollTop)
    : null;

  return {
    scrollTop: Math.round(sheet.scrollTop),
    maxScroll: Math.round(sheet.scrollHeight - sheet.clientHeight),
    railOffsetTop,
    /* How far up the reader must scroll before the "jump to any block" list
       is on screen again. 0 means it never leaves. */
    scrollBackToRail: rail ? Math.max(0, sheet.scrollTop - Math.max(0, railOffsetTop + railBox.height - vh)) : null,
    switchersVisible: switchers.filter(inView).length,
    switchersInThumbZone: switchers.filter(inThumbZone).length,
    railDragNeeded: rail ? Math.max(0, rail.scrollWidth - rail.clientWidth) : null,
  };
})()`;

await cdp.eval(`(() => { const s = document.querySelector('.focus'); s.scrollTop = s.scrollHeight; })()`);
await sleep(700);
const reach = await cdp.eval(REACH_PROBE);
console.log(`  面板总高 ${reach.maxScroll}px，已读到底（scrollTop=${reach.scrollTop}）`);
console.log(`  → 要够到"跳到任意块"的清单，需往上滚 ${reach.scrollBackToRail}px`);
console.log(`  → 此刻视口内可见的换块控件：${reach.switchersVisible} 个，其中在拇指区（下 40%）：${reach.switchersInThumbZone} 个`);
console.log(`  → 清单本身还要横向拖动 ${reach.railDragNeeded}px 才能看到全部 16 项`);

browser.kill();
