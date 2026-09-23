/* ---------------------------------------------------------------------------
   Functional verification over CDP. Exercises the real interaction path and
   fails loudly, independent of how the page was authored.

     node tools/verify.mjs

   How this suite is kept honest
   ----------------------------
   Mutation testing (tools/mutate.mjs) broke the app on purpose and asked what
   the suite noticed. It did not notice enough, so the rules below are part of
   the file, not aspirations in a comment:

   1. Every click is hit-tested. `click()` refuses to press anything that is
      not the top-most element at its own centre point. A click that lands on
      an overlay is a bug, and element.click() would have hidden it.
   2. Nothing is asserted against a hard-coded expectation that the data can
      answer. Labels, gallery counts and step targets are derived from
      data.js, so reordering blocks fails the suite instead of passing it.
   3. An assertion must be able to fail vacuously-free. `x === 0` and
      `missing === null` pass when the thing was never rendered, so
      non-empty preconditions are asserted next to them.
   4. The denominator is not `checks.length`. Counting your own checks and
      reporting "N/N passed" means deleting a check prints "all passed".
      EXPECTED_CHECKS is fixed below and the run fails if the number moves.
--------------------------------------------------------------------------- */
import { ensureServer } from './ensure-server.mjs';
import { startChrome } from './browser.mjs';

/* Imported so every expectation is derived from the real block order instead
   of hard-coded strings that would go stale silently. */
import { BLOCKS, SITE } from '../data.js';

const UI = SITE.zh.ui;
const ids = BLOCKS.map((b) => b.id);
const titleOf = (id) => BLOCKS[ids.indexOf(id)]?.title.zh ?? null;
const nextIdOf = (id) => BLOCKS[ids.indexOf(id) + 1]?.id ?? null;
const prevIdOf = (id) => BLOCKS[ids.indexOf(id) - 1]?.id ?? null;
const nextTitleOf = (id) => (nextIdOf(id) ? titleOf(nextIdOf(id)) : null);
const prevTitleOf = (id) => (prevIdOf(id) ? titleOf(prevIdOf(id)) : null);
const pad = (n) => String(n).padStart(2, '0');
/* galleryMarkup emits nothing below two shots, so the expected count has to
   model that or the assertion is comparing against a number nobody chose. */
const shotsOf = (id) => {
  const b = BLOCKS[ids.indexOf(id)];
  if (!b) return 0;
  const n = 1 + (b.gallery?.length ?? 0);
  return n >= 2 ? n : 0;
};

/* PANDA_URL points the whole suite at a deployed site instead of a local one —
   used to prove the version that actually went public is the version that was
   tested. Otherwise PANDA_PORT gives a mutation copy its own private server,
   and with neither flag we reuse 4321 only if something there really serves
   this app. */
const LIVE = process.env.PANDA_URL ?? null;
let BASE = LIVE ?? 'http://127.0.0.1:4321/';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* ------------------------------------------------------------------ harness */

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
    this.consoleErrors = [];
    /* Load events are counted, never left in an array that only grows: the old
       `events.some(...)` predicate let the second and third navigation in a run
       resolve against the first page's load event. */
    this.loadEvents = 0;
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
      } else if (message.method === 'Page.loadEventFired') {
        this.loadEvents += 1;
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, err) => this.pending.set(id, { ok, err }));
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `${result.exceptionDetails.exception?.description ?? 'page threw'}\n   in: ${expression.slice(0, 220)}`,
      );
    }
    return result.result.value;
  }

  /* `path` is everything after the origin ('', '#/b/record-001', …) so a server
     that comes back on a different port is followed automatically.
     Wait for a page-side load event that belongs to *this* navigation.
     A URL differing only in the fragment is a same-document navigation and
     fires no load event at all, so hop through about:blank first.
     Retried, because an error page (chrome-error://) also counts as loaded —
     a static server that died mid-run would otherwise be reported as
     "document.querySelector('.wall') is null" twenty assertions later. */
  async goto(path = '', { timeout = 20000, tries = 4 } = {}) {
    let last = null;
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const url = BASE + path;
      const current = String(await this.evaluate('location.href').catch(() => ''));
      if (current.split('#')[0] === url.split('#')[0]) {
        await this.send('Page.navigate', { url: 'about:blank' });
        await sleep(150);
      }
      const seen = this.loadEvents;
      await this.send('Page.navigate', { url });
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (this.loadEvents > seen) break;
        await sleep(50);
      }
      last = String(await this.evaluate('location.href'));
      if (last.startsWith('chrome-error')) {
        await this.revive();
        continue;
      }
      if (this.loadEvents <= seen) throw new Error(`load never fired for ${url}`);
      const ready = await this.until('document.querySelectorAll(".tile").length === ' + BLOCKS.length, { timeout: 6000 });
      if (ready) return;
      last = '渲染不完整：tiles=' + (await this.evaluate('document.querySelectorAll(".tile").length'));
      await this.revive();
    }
    throw new Error(`页面始终无法加载（${BASE}${path}）：${last} — 静态服务器可能没在跑，先 node tools/serve.mjs`);
  }

  /* Poll an expression. Returns the last value read rather than throwing, so a
     timeout surfaces as an honest FAIL instead of killing the run. */
  async until(expression, { timeout = 3000, every = 50 } = {}) {
    const deadline = Date.now() + timeout;
    let value = null;
    for (;;) {
      value = await this.evaluate(expression);
      if (value) return value;
      if (Date.now() > deadline) return value;
      await sleep(every);
    }
  }

  /**
   * Press a real mouse button at a point that provably belongs to `selector`.
   * `fx`/`fy` pick where inside the box (used to hit the empty area of the
   * lightbox stage); `anywhereIn` relaxes the hit test to "some descendant is
   * the top-most thing at this point", which is what a reader actually does.
   */
  async click(selector, { fx = 0.5, fy = 0.5, settle = true } = {}) {
    /* Only scroll when the target is genuinely out of view. Unconditionally
       calling scrollIntoView moved the sheet itself — the sticky bottom bar is
       always on screen, and centring it silently scrolled the reader 400px
       down, which then looked like a broken "remember my place" feature. */
    const needsScroll = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return true;
      const r = el.getBoundingClientRect();
      return r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth || r.width === 0;
    })()`);
    if (needsScroll) {
      await this.evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center', behavior: 'instant' })`,
      );
    }
    const spot = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { err: 'missing' };
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { err: 'zero-size' };
      const x = r.left + r.width * ${fx}, y = r.top + r.height * ${fy};
      const hit = document.elementFromPoint(x, y);
      if (!hit) return { err: 'no hit at ' + Math.round(x) + ',' + Math.round(y) };
      const ok = hit === el || el.contains(hit);
      if (!ok) {
        const who = hit.closest('[data-open],[data-close],[data-next],[data-prev]')
          || hit.closest('button,a');
        return {
          err: 'covered by ' + (who === el ? 'itself'
            : (who?.dataset?.open ?? who?.className ?? hit.tagName) + ' at ' + Math.round(x) + ',' + Math.round(y)),
        };
      }
      return { x, y };
    })()`);
    if (spot.err) throw new Error(`click ${selector}: ${spot.err}`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
    }
    if (settle) await this.settleAfterClick();
  }

  /* A click that starts the FLIP has to be given the animation's own time.
     Sleeping a fixed 1100ms was both slow and, on a busy machine, too short. */
  async settleAfterClick() {
    await sleep(120);
    await this.until('!document.querySelector(".fly")', { timeout: 2500 });
    await sleep(60);
  }

  async key(key, code, keyCode) {
    for (const type of ['keyDown', 'keyUp']) {
      await this.send('Input.dispatchKeyEvent', {
        type,
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });
    }
    await sleep(500);
  }
}

/* A private server plus a private browser: pinning a port number meant this
   script could silently attach to a *different* agent's Chromium, or drive the
   app against a half-dead leftover server, and report that as a result. */
/* PANDA_PORT is how tools/mutate.mjs gives each copy its own server; without
   it, a leftover server for the *original* project on 4321 would be reused and
   every mutation would appear to change nothing. */
if (!LIVE) {
  const server = await ensureServer(process.env.PANDA_PORT ? 0 : 4321);
  BASE = server.base;
}
const chrome = await startChrome();
process.on('exit', () => chrome.cleanup());

const cdp = await CDP.connect(chrome.websocket);
/* If the server goes away mid-run, every later navigation silently lands on an
   error page; `goto` calls this to bring it back before retrying. */
cdp.revive = async () => {
  if (LIVE) { await sleep(600); return; }
  const back = await ensureServer().catch(() => null);
  if (back) BASE = back.base;
  await sleep(200);
};
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

/* ------------------------------------------------------------------ scoring */

const checks = [];
const duplicates = [];
const names = new Set();
const record = (name, pass, detail = '') => {
  if (names.has(name)) duplicates.push(name);
  names.add(name);
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const cdpProbe = () =>
  cdp.evaluate(`(() => ({
    mode: document.body.dataset.mode || 'wall',
    title: document.querySelector('.stage-title')?.textContent ?? null,
    rail: document.querySelectorAll('.rail-item').length,
    railCurrent: document.querySelector('.rail-item[aria-current="true"]')?.dataset?.open ?? null,
    scrollY: Math.round(window.scrollY),
    sheetScroll: (() => { const f = document.querySelector('.focus'); return f ? Math.round(f.scrollTop) : null; })(),
    listOpen: document.body.dataset.list === 'open',
    sheetPosition: (() => { const f = document.querySelector('.focus'); return f ? getComputedStyle(f).position : null; })(),
    sheetCovers: (() => {
      const f = document.querySelector('.focus');
      if (!f) return null;
      const r = f.getBoundingClientRect();
      /* clientWidth/Height, not innerWidth/Height: a fixed inset:0 box is the
         initial containing block, which excludes the 15px scrollbar. */
      return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), vh: document.documentElement.clientHeight, vw: document.documentElement.clientWidth };
    })(),
    wall: getComputedStyle(document.querySelector('.wall')).display !== 'none',
    lightbox: !!document.querySelector('.lightbox'),
    lightboxCount: document.querySelector('[data-lb-count]')?.textContent?.trim() ?? null,
    focusInert: document.querySelector('.focus')?.hasAttribute('inert') ?? false,
    hash: location.hash,
    fly: document.querySelectorAll('.fly').length,
    stageImgOk: (() => { const i = document.querySelector('.stage-media img'); return !!i && i.complete && i.naturalWidth > 0; })(),
  }))()`);

/* The active block, read from the URL rather than from a global the page would
   rather not expose: the hash is the app's own source of truth. */
const activeId = () =>
  cdp.evaluate(`(/^#\\/b\\/(.+)$/.exec(location.hash)?.[1]) ?? document.querySelector('.rail-item[aria-current="true"]')?.dataset?.open ?? null`);

const barState = () =>
  cdp.evaluate(`(() => {
    const next = document.querySelector('[data-next]');
    const prev = document.querySelector('[data-prev]');
    const end = document.querySelector('[data-end]');
    const title = document.querySelector('.bar-title');
    return {
      nextId: next?.dataset?.open ?? null,
      nextText: title?.textContent?.trim() ?? null,
      nextOpen: next?.getAttribute('data-open') ?? null,
      prevId: prev?.dataset?.open ?? null,
      end: end?.dataset?.end ?? null,
      endText: title?.textContent?.trim() ?? null,
      clipped: title ? title.scrollWidth > title.clientWidth + 1 : null,
      need: title ? Math.ceil(title.scrollWidth) : null,
      have: title?.clientWidth ?? null,
    };
  })()`);

/* Arm a page-side sampler that records every frame of the FLIP ghost. Deleting
   fly() leaves nothing for this to see, which is the whole point. */
const armFlyWatch = (sourceSelector) =>
  cdp.evaluate(`(() => {
    window.__fly = [];
    const src = document.querySelector(${JSON.stringify(sourceSelector)});
    const s = src ? src.getBoundingClientRect() : null;
    window.__from = s ? { x: Math.round(s.left), y: Math.round(s.top), w: Math.round(s.width), h: Math.round(s.height) } : null;
    const t0 = performance.now();
    const step = () => {
      const g = document.querySelector('.fly');
      if (g) {
        const r = g.getBoundingClientRect();
        window.__fly.push({ t: Math.round(performance.now() - t0), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
      }
      if (performance.now() - t0 < 1200) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return true;
  })()`);

const readFlyWatch = () =>
  cdp.evaluate(`({ samples: window.__fly ?? [], from: window.__from ?? null,
     to: (() => { const m = document.querySelector('[data-stage-media]'); if (!m) return null; const r = m.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })() })`);

await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.goto();
await sleep(500);

/* --------------------------------------------------- 1. the wall, as shipped */

let s = await cdpProbe();
record('首屏是方块墙', s.mode === 'wall' && s.wall, `mode=${s.mode}`);
record('16 个方块全部渲染', (await cdp.evaluate('document.querySelectorAll(".tile").length')) === BLOCKS.length);
record(
  '主图全部真的加载出来了',
  (await cdp.evaluate(`[...document.querySelectorAll('.tile img')].every(i => i.complete && i.naturalWidth > 0)`)) === true,
  `缺图 ${(await cdp.evaluate(`[...document.querySelectorAll('.tile img')].filter(i => !i.complete || !i.naturalWidth).length`))} 张`,
);
record(
  '顶栏已无中英文切换',
  (await cdp.evaluate('document.querySelectorAll("[data-lang], .lang").length')) === 0,
);
record(
  '顶栏确实渲染了（上一条不是空判）',
  (await cdp.evaluate('document.querySelectorAll(".header-tools a").length')) === 2,
);
record('文档语言为 zh-CN', (await cdp.evaluate('document.documentElement.lang')) === 'zh-CN');
record(
  '首屏无残留英文文案',
  (await cdp.evaluate(`(() => {
    const text = document.querySelector('.site-header').innerText + ' ' + document.querySelector('.hero').innerText;
    return /\\b(the|and|of|Studio introduction)\\b/i.test(text) ? text.slice(0, 60) : '';
  })()`)) === '',
);
record(
  '首屏写着「点击任意方块放大」',
  (await cdp.evaluate(`document.querySelector('.hero-hint')?.textContent?.trim() ?? ''`)).includes(UI.hintOpen),
);

/* --- 单色 ---
   "不要粉色、界面都变成白色" was said twice, and until now nothing in this
   suite could see colour at all: reintroduce #f386a1 and every assertion would
   still print PASS. The scan reads the whole cascade, not just the tokens, so a
   colour reintroduced deep in a rule is found too. */
const colours = await cdp.evaluate(`(() => {
  const css = [...document.styleSheets]
    .flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText ?? ''); } catch { return []; } })
    .join('\\n');
  const allowed = new Set(['transparent', 'inherit', 'initial', 'unset', 'none', 'currentcolor']);
  const seen = [];
  const chromatic = [];
  const spread = (r, g, b, raw) => {
    seen.push(raw);
    if (Math.max(r, g, b) - Math.min(r, g, b) > 2) chromatic.push(raw);
  };
  for (const m of css.matchAll(/#([0-9a-fA-F]{3,8})\\b/g)) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('');
    if (h.length < 6) continue;
    spread(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), '#' + m[1]);
  }
  for (const m of css.matchAll(/rgba?\\(([^)]+)\\)/g)) {
    const n = m[1].split(/[^\\d.]+/).filter((x) => x !== '').map(Number);
    if (n.length < 3) continue;
    if (n.length >= 4 && n[3] === 0) continue;      /* fully transparent */
    spread(n[0], n[1], n[2], m[0]);
  }
  for (const m of css.matchAll(/:\\s*(red|blue|green|pink|magenta|purple|orange|yellow|cyan|teal|gold|coral|salmon)\\b/g)) {
    seen.push(m[1]);
    chromatic.push(m[1]);
  }
  void allowed;
  return { total: seen.length, chromatic: [...new Set(chromatic)] };
})()`);
record('颜色扫描确实读到了字面量（非空判）', colours.total >= 4, `CSS 里写到 ${colours.total} 个颜色字面量`);
record('全站样式表没有彩色，只有灰阶（客户要求：白色干净）', colours.chromatic.length === 0, colours.chromatic.slice(0, 5).join(', '));
/* The stylesheet scan alone is weak: almost every rule says `var(--paper)`, so
   it only ever sees the handful of literals in :root. This one reads the colour
   actually painted — which is also what would catch a hue reintroduced through
   a token, a gradient, or an inline style. */
const painted = () => cdp.evaluate(`(() => {
  const props = ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor', 'borderRightColor', 'borderBottomColor', 'outlineColor'];
  const bad = [];
  let seen = 0;
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '.' + String(el.className).split(' ')[0]);
  for (const el of document.querySelectorAll('body *')) {
    if (!el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    for (const prop of props) {
      const v = cs[prop];
      if (!v || v === 'none') continue;
      const n = (v.match(/[\\d.]+/g) || []).map(Number);
      if (n.length < 3 || (n.length >= 4 && n[3] === 0)) continue;
      seen += 1;
      if (Math.max(n[0], n[1], n[2]) - Math.min(n[0], n[1], n[2]) > 2) bad.push(name(el) + ' ' + prop + '=' + v);
    }
  }
  return { seen, bad: [...new Set(bad)] };
})()`);
const wallColours = await painted();
record('墙面上每个实际渲染色都是灰阶', wallColours.bad.length === 0, wallColours.bad.slice(0, 4).join(', '));
record('这条检查确实取到了颜色（非空判）', wallColours.seen > 60, `读到 ${wallColours.seen} 个渲染色`);
const surfaces = await cdp.evaluate(`(() => {
  /* "What colour does the reader actually see behind this element" — an
     element with a transparent background has to be resolved against its
     ancestors, otherwise the hero (painted by the canvas behind it) reads as
     rgb(0,0,0) and fails for a reason that has nothing to do with white. */
  const rgb = (s) => {
    const n = (String(s).match(/[\\d.]+/g) || []).map(Number);
    return n.length >= 3 ? { r: n[0], g: n[1], b: n[2], a: n.length >= 4 ? n[3] : 1 } : null;
  };
  const behind = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const c = rgb(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) {
        const tag = node.tagName.toLowerCase() + (node.id ? '#' + node.id : '.' + String(node.className).split(' ')[0]);
        return { tag, ...c };
      }
    }
    return null;
  };
  /* Paper, not panel: the Win95 card grey (--panel #dedede) and the black bars
     (--ink) are part of the approved monochrome design. The claim this checks is
     the one the client made twice — that the field the page sits on is white.
     An element with a transparent background is resolved against its ancestors,
     so the hero (painted by the canvas behind it) is not scored on rgba(0,0,0,0). */
  return ['body', '.hero', '.site-header', '.site-footer', '.tile-media', '.brand'].map((sel) => {
    const el = document.querySelector(sel);
    const found = el ? behind(el) : null;
    return { sel, ok: Boolean(found) && found.r >= 250 && found.g >= 250 && found.b >= 250, got: found ? found.tag + ' ' + found.r + ',' + found.g + ',' + found.b : 'none' };
  });
})()`);
record(
  '页面纸底是白的（往上追到真正着色的那层）',
  surfaces.every((s) => s.ok),
  JSON.stringify(surfaces),
);
/* The ordered dither is drawn at runtime; if the canvas came back blank the
   hero would look broken and no DOM assertion would notice. */
const cloud = await cdp.evaluate(`(() => {
  const c = document.querySelector('.hero-cloud');
  if (!c || !c.width || !c.height) return { missing: true };
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const levels = new Set();
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) { levels.add(d[i]); sum += d[i]; n += 1; }
  return { levels: levels.size, mean: Math.round(sum / n), w: c.width, h: c.height };
})()`);
record(
  '首屏那片抖动灰阶真的画出来了（不是空白画布）',
  !cloud.missing && cloud.levels >= 3 && cloud.mean > 40 && cloud.mean < 250,
  JSON.stringify(cloud),
);
/* Which band a block belongs to is data, and it used to be unasserted: swap the
   two sections and the page still renders 16 tiles. */
const bands = await cdp.evaluate(`(() => {
  const secs = [...document.querySelectorAll('.wall .section')];
  return {
    ids: secs.map((s) => s.id).join(','),
    counts: secs.map((s) => s.querySelectorAll('.tile').length).join(','),
    members: secs.map((s) => [...s.querySelectorAll('.tile')].map((t) => t.dataset.open)),
  };
})()`);
record(
  '索引段在前、作品段在后，数量与数据一致',
  bands.ids === 'intro,records' && bands.counts === `${BLOCKS.filter((b) => b.group === 'index').length},${BLOCKS.filter((b) => b.group === 'record').length}`,
  bands.counts,
);
const misplaced = BLOCKS
    .map((b) => `${b.id}`)
    .filter((id, i) => {
      const want = BLOCKS[i].group === 'index' ? 0 : 1;
      return !bands.members[want]?.includes(id);
    });
record('每个方块都待在数据指定的那一段', misplaced.length === 0, misplaced.slice(0, 4).join(', '));
/* The check above compares the page with the same field that built it, so it
   cannot see a wrong `group` in data.js — mutation #29 proved that by moving
   社团介绍 into the works band and passing. This one is not circular: a block's
   band is derived from its own section, and the two fields must agree. */
const disagreeing = BLOCKS
  .filter((b) => b.group !== (b.section === 'record' ? 'record' : 'index'))
  .map((b) => `${b.id}（section=${b.section} 却 group=${b.group}）`);
record('group 与 section 两栏不互相矛盾', disagreeing.length === 0, disagreeing.join('; '));

/* --------------------------------------------- 2. opening a block from the wall */

/* This is where the old page-swap model threw the reader 2700px to the top. */
const OPEN_ID = 'record-004';
await cdp.evaluate(`document.querySelector('.tile[data-open="${OPEN_ID}"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(300);
const openedFrom = await cdp.evaluate('Math.round(window.scrollY)');
await armFlyWatch(`.tile[data-open="${OPEN_ID}"] .tile-media`);
await cdp.click(`.tile[data-open="${OPEN_ID}"]`);
s = await cdpProbe();
record('点击后进入放大态', s.mode === 'focus', `mode=${s.mode}`);
record('放大的是被点的那一块', s.title === titleOf(OPEN_ID), `title=${s.title}`);
record('其余块收进左栏且共 16 项', s.rail === BLOCKS.length, `rail=${s.rail}`);
record('左栏标出当前块', s.railCurrent === OPEN_ID, `current=${s.railCurrent}`);
record('详情是覆盖层，不是换页', s.sheetPosition === 'fixed', `position=${s.sheetPosition}`);
record(
  '详情页铺满整个视口（不是一半）',
  s.sheetCovers && s.sheetCovers.top <= 0 && s.sheetCovers.h >= s.sheetCovers.vh - 1 && s.sheetCovers.w >= s.sheetCovers.vw - 1,
  JSON.stringify(s.sheetCovers),
);
record('打开时页面没有被甩走', s.scrollY === openedFrom, `scrollY ${openedFrom} → ${s.scrollY}`);
record('主图已加载', s.stageImgOk === true);
record('地址栏写入深链', s.hash === `#/b/${OPEN_ID}`, `hash=${s.hash}`);
record('打开方块会写入一条可返回的历史', (await cdp.evaluate('history.state?.pandaBlock ?? null')) === OPEN_ID);

/* 2b. the FLIP actually happens ------------------------------------------------ */
const flyOpen = await readFlyWatch();
const fw = flyOpen.samples.map((x) => x.w);
const span = (flyOpen.to?.w ?? 0) - (flyOpen.from?.w ?? 0);
record(
  '放大时图片真的在飞（采样到多帧）',
  flyOpen.samples.length >= 3,
  `${flyOpen.samples.length} 帧`,
);
/* The sampler runs on rAF, so its first frame is already one frame into the
   transition — compare against the size the ghost travelled through, not
   against an exact pixel match. */
record(
  '飞行起点在墙上那张小图处，而不是凭空出现在舞台上',
  flyOpen.samples.length > 0 && flyOpen.from && span > 0
    && Math.abs(flyOpen.samples[0].w - flyOpen.from.w) < span * 0.15,
  `小图 ${flyOpen.from?.w}px，首帧 ${flyOpen.samples[0]?.w}px，舞台 ${flyOpen.to?.w}px`,
);
record(
  '飞行终点落在舞台大图上',
  flyOpen.samples.length > 0 && flyOpen.to && span > 0
    && Math.abs(flyOpen.samples.at(-1).w - flyOpen.to.w) < span * 0.15,
  `末帧 ${flyOpen.samples.at(-1)?.w}px，舞台 ${flyOpen.to?.w}px`,
);
record(
  '飞行过程中尺寸在连续变化（不是瞬间跳位）',
  fw.length >= 2 && Math.max(...fw) - Math.min(...fw) > 24,
  fw.length ? `${Math.min(...fw)} → ${Math.max(...fw)}px` : '无样本',
);
record('动画残留已清理', s.fly === 0, `fly=${s.fly}`);

/* ---------------------------------- 3. desktop layout: list left, stage right */

const columns = await cdp.evaluate(`(() => {
  const rail = document.querySelector('.rail').getBoundingClientRect();
  const stage = document.querySelector('.stage').getBoundingClientRect();
  return { railLeft: Math.round(rail.left), railRight: Math.round(rail.right), stageLeft: Math.round(stage.left) };
})()`);
record(
  '桌面左栏仍在舞台左边（DOM 换了顺序、视觉没换）',
  columns.railRight <= columns.stageLeft + 1,
  JSON.stringify(columns),
);
record(
  '吸底条在桌面端不占位置',
  (await cdp.evaluate(`getComputedStyle(document.querySelector('.sheet-bar')).display`)) === 'none',
);
record(
  '桌面标题栏保留 ‹ ›  三枚',
  (await cdp.evaluate(`(() => {
    const nav = document.querySelector('.stage-nav');
    return getComputedStyle(nav).display !== 'none' && nav.querySelectorAll('.stage-btn').length;
  })()`)) === 3,
);

/* ------------------------------------------------------ 4. the step buttons */

/* These are rendered on desktop and were, at one point, rendered but never
   wired — 34 assertions passed because only the keyboard path was tested.
   Clicking them with a real mouse is the only way that catches it. */
const stepTargets = [];
for (const [selector, direction] of [['[data-step="1"]', 'next'], ['[data-step="-1"]', 'prev']]) {
  const before = await activeId();
  const want = direction === 'next' ? nextIdOf(before) : prevIdOf(before);
  await cdp.click(selector);
  const now = await activeId();
  stepTargets.push(`${selector}: ${titleOf(before)} → ${titleOf(now)}（期望 ${titleOf(want)}）`);
  record(
    `点 ${selector} 走到数据上的${direction === 'next' ? '下一' : '上一'}块`,
    now === want,
    stepTargets.at(-1),
  );
}
record(
  '‹ › 两枚按钮的 glyph 没有写反',
  (await cdp.evaluate(`[...document.querySelectorAll('[data-step]')].map(b => b.dataset.step + ':' + b.textContent.trim()).join(' ')`)) === '-1:‹ 1:›',
);
record(
  '› 的 aria-label 就是下一块的名字',
  (await cdp.evaluate(`document.querySelector('[data-step="1"]')?.getAttribute('aria-label') ?? ''`)) ===
    UI.nextTo(nextTitleOf(await activeId())),
  `实得 ${(await cdp.evaluate(`document.querySelector('[data-step="1"]')?.getAttribute('aria-label') ?? '(无)'`))}`,
);
record(
  '‹ 的 aria-label 就是上一块的名字',
  (await cdp.evaluate(`document.querySelector('[data-step="-1"]')?.getAttribute('aria-label') ?? ''`)) ===
    UI.prevTo(prevTitleOf(await activeId())),
);
/* End of range must be visibly unreachable, not a button that does nothing. */
await cdp.click('.rail-item[data-open="about-studio"]');
record(
  '首块的 ‹ 是禁用状态',
  (await cdp.evaluate('document.querySelector(\'[data-step="-1"]\')?.disabled ?? null')) === true,
);
await cdp.click('.rail-item[data-open="record-007"]');
record(
  '末块的 › 是禁用状态',
  (await cdp.evaluate('document.querySelector(\'[data-step="1"]\')?.disabled ?? null')) === true,
);
await cdp.click('.rail-item[data-open="record-004"]');

/* ------------------------------------------------------- 5. keyboard stepping */

/* ArrowUp/ArrowDown belong to the browser: they scroll the sheet. A handler
   that preventDefaults them leaves keyboard users unable to read the page.
   The stage is re-queried per key because ← → replace it — dispatching at a
   node that has just left the document never reaches the handler, and the
   result reads as "the app let the key through" when really nothing ran. */
const arrowFlags = await cdp.evaluate(`(() => {
  const out = {};
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft']) {
    const stage = document.querySelector('.stage');
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    stage.dispatchEvent(ev);
    out[key] = ev.defaultPrevented;
  }
  return out;
})()`);
record(
  '详情页里 ↑↓ 交还给原生滚动（左右才用来换块）',
  arrowFlags.ArrowDown === false && arrowFlags.ArrowUp === false && arrowFlags.ArrowRight === true && arrowFlags.ArrowLeft === true,
  JSON.stringify(arrowFlags),
);
/* switchBlock holds a busy flag for the length of its own tail; the ← → above
   each started one, so let them all finish before driving real keys. */
await sleep(300);

const beforeKey = await activeId();
await cdp.key('ArrowRight', 'ArrowRight', 39);
const afterKey = await activeId();
record(
  '→ 键走到数据上的下一块',
  afterKey === nextIdOf(beforeKey),
  `${titleOf(beforeKey)} → ${titleOf(afterKey)}`,
);
await cdp.key('ArrowLeft', 'ArrowLeft', 37);
record(
  '← 键走回数据上的上一块',
  (await activeId()) === beforeKey,
  `回到 ${titleOf(await activeId())}`,
);

/* Both ends must stop, not wrap. Silent looping through sixteen blocks hides
   the fact that the reader has reached the bottom of the archive, and it is
   exactly the kind of thing a "harmless" range-check rewrite reintroduces. */
await cdp.click(`.rail-item[data-open="${ids[ids.length - 1]}"]`);
await sleep(300);
await cdp.key('ArrowRight', 'ArrowRight', 39);
await cdp.key('ArrowRight', 'ArrowRight', 39);
record(
  '在最后一块继续按 → 不会绕回第一块',
  (await activeId()) === ids[ids.length - 1],
  `停在 ${titleOf(await activeId())}`,
);
await cdp.click(`.rail-item[data-open="${ids[0]}"]`);
await sleep(300);
await cdp.key('ArrowLeft', 'ArrowLeft', 37);
await cdp.key('ArrowLeft', 'ArrowLeft', 37);
record(
  '在第一块继续按 ← 不会跳到最后一块',
  (await activeId()) === ids[0],
  `停在 ${titleOf(await activeId())}`,
);

/* ------------------------------------------------------ 6. gallery + lightbox */

const GALLERY_ID = 'record-001';
const gTotal = pad(shotsOf(GALLERY_ID));
await cdp.click('.rail-item[data-open="hardware-printer"]');
record(
  '无图集的块不会渲染出图集标题',
  (await cdp.evaluate('document.querySelectorAll(".gallery-item").length')) === shotsOf('hardware-printer')
    && (await cdp.evaluate('document.querySelectorAll(".gallery").length')) === 0
    && (await cdp.evaluate(`document.querySelector('.stage-title')?.textContent`)) === titleOf('hardware-printer'),
  `期望 ${shotsOf('hardware-printer')} 张`,
);
await cdp.click(`.rail-item[data-open="${GALLERY_ID}"]`);
record(
  '图集数量与数据一致',
  (await cdp.evaluate('document.querySelectorAll(".gallery-item").length')) === shotsOf(GALLERY_ID),
  `实得 ${(await cdp.evaluate('document.querySelectorAll(".gallery-item").length'))} / 数据 ${shotsOf(GALLERY_ID)}`,
);
await cdp.click('.gallery-item:nth-of-type(3)');
s = await cdpProbe();
record('点图集打开大图', s.lightbox && s.lightboxCount === `03 / ${gTotal}`, `count=${s.lightboxCount}`);
record('大图打开时详情页被 inert 隔离', s.focusInert === true);
await cdp.key('ArrowRight', 'ArrowRight', 39);
record(
  '大图可左右翻页',
  (await cdp.evaluate('document.querySelector("[data-lb-count]")?.textContent?.trim()')) === `04 / ${gTotal}`,
);
await cdp.key('Escape', 'Escape', 27);
s = await cdpProbe();
record('Esc 先关大图、仍在放大态', !s.lightbox && s.mode === 'focus', `mode=${s.mode} lightbox=${s.lightbox}`);
record('大图关掉后 inert 也一起撤掉（否则整个详情页无法聚焦）', s.focusInert === false);

/* Reopen and dismiss by clicking the empty stage area — the .lightbox element
   itself never receives a click, so that branch used to be dead code. */
await cdp.click('.gallery-item:nth-of-type(1)');
const emptySpot = await cdp.evaluate(`(() => {
  const stage = document.querySelector('.lightbox-stage');
  const r = stage.getBoundingClientRect();
  for (const fy of [0.06, 0.94, 0.5, 0.2, 0.8]) {
    for (const fx of [0.04, 0.96, 0.12, 0.88]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      if (document.elementFromPoint(x, y) === stage) return { fx, fy };
    }
  }
  return null;
})()`);
record('大图区域存在可点的空白处', emptySpot !== null, JSON.stringify(emptySpot));
if (emptySpot) {
  await cdp.click('.lightbox-stage', emptySpot);
  record('点击大图空白处关闭大图', (await cdpProbe()).lightbox === false);
} else {
  record('点击大图空白处关闭大图', false, '找不到空白点');
}
/* No Escape here on purpose: with the lightbox already gone, Esc belongs to the
   detail sheet and would close the whole thing. */

/* Lightbox overshoot: the raw index used to be stored, so wasted ArrowRight
   presses had to be paid back one for one. */
await cdp.click('.stage-bar [data-close]');
await cdp.goto('#/b/record-002');
const twoShots = `${pad(2)} / ${pad(shotsOf('record-002'))}`;
const oneShot = `${pad(1)} / ${pad(shotsOf('record-002'))}`;
await cdp.click('.gallery-item:nth-of-type(1)');
for (let i = 0; i < 4; i += 1) await cdp.key('ArrowRight', 'ArrowRight', 39);
const atEnd = await cdp.evaluate('document.querySelector("[data-lb-count]")?.textContent?.trim()');
await cdp.key('ArrowLeft', 'ArrowLeft', 37);
const afterLeft = await cdp.evaluate('document.querySelector("[data-lb-count]")?.textContent?.trim()');
record('大图按过头之后左键立刻有反应', atEnd === twoShots && afterLeft === oneShot, `${atEnd} → ${afterLeft}`);
await cdp.key('Escape', 'Escape', 27);

/* -------------------------------------------------- 7. closing and history */

/* requestClose() must consume the entry the sheet pushed. Calling closeBlock()
   straight from the ✕ looks identical on screen and strands a phantom entry:
   the reader's next Back press then goes somewhere they never visited.
   Marked with a decoy entry carrying #/mark-b: a real back-navigation lands
   there and keeps its URL (applyHash closes with keepHistory), while the
   shortcut path stays put and rewrites the URL to bare. Both end on the wall,
   so only the history proves which one ran. */
await cdp.goto();
await cdp.evaluate(`history.pushState({ mark: 'B' }, '', '#/mark-b')`);
await cdp.evaluate(`document.querySelector('.tile[data-open="record-002"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(250);
await cdp.click('.tile[data-open="record-002"]');
record('打开方块确实压入了一条历史', (await cdp.evaluate('history.state?.pandaBlock ?? null')) === 'record-002');
await cdp.click('.stage-bar [data-close]');
const landed = await cdp.evaluate(`({ mark: history.state?.mark ?? null, hash: location.hash })`);
record(
  '点 ✕ 关闭会消耗掉自己压入的那条历史',
  landed.mark === 'B' && landed.hash === '#/mark-b',
  `落在 state.mark=${landed.mark} hash=${landed.hash}（停在原条目 = 没有真的后退）`,
);
s = await cdpProbe();
record('点返回回到方块墙', s.mode === 'wall' && s.wall, `mode=${s.mode}`);
record('关闭后地址栏不再挂着方块深链', !s.hash.startsWith('#/b/'), `hash=${s.hash}`);

/* Stranded lightbox: Back used to null the state without removing the node,
   leaving an opaque full-screen sheet nobody could dismiss. */
await cdp.evaluate(`document.querySelector('.tile[data-open="record-001"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(250);
await cdp.click('.tile[data-open="record-001"]');
await cdp.click('.gallery-item:nth-of-type(1)');
const lbOpen = (await cdpProbe()).lightbox;
await cdp.evaluate('history.back()');
await sleep(1200);
const stranded = await cdp.evaluate(`(() => {
  const l = document.querySelector('.lightbox');
  if (!l) return { present: false };
  const cs = getComputedStyle(l);
  return { present: true, covering: cs.position === 'fixed' && cs.display !== 'none' };
})()`);
record('大图开着时返回不会留下盖住页面的遮罩', lbOpen && !stranded.present, `大图曾打开=${lbOpen}，残留=${stranded.present}`);
record('返回后回到方块墙', (await cdpProbe()).mode === 'wall');

/* Deep link then close: the sheet must not navigate out of the site. */
await cdp.goto('#/b/hardware-mr');
const deepHistory = await cdp.evaluate('history.length');
await cdp.click('.stage-bar [data-close]');
const afterDeepClose = await cdp.evaluate(`({ mode: document.body.dataset.mode || 'wall', host: location.host })`);
record('深链进入后点关闭留在本站', afterDeepClose.mode === 'wall' && afterDeepClose.host === new URL(BASE).host, JSON.stringify(afterDeepClose));
record(
  '深链关闭不会消耗历史记录',
  (await cdp.evaluate('history.length')) === deepHistory,
  `${deepHistory} → ${await cdp.evaluate('history.length')}`,
);

/* The phone's back gesture is a history traversal: it must close the sheet and
   stay on the site, not walk out of it. */
await cdp.goto();
await cdp.evaluate(`history.pushState({ mark: 'B' }, '', '#/mark-b')`);
await cdp.evaluate(`document.querySelector('.tile[data-open="record-003"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(250);
await cdp.click('.tile[data-open="record-003"]');
await cdp.evaluate('history.back()');
await sleep(900);
const backOut = await cdp.evaluate(`({ mode: document.body.dataset.mode || 'wall', hash: location.hash, host: location.host })`);
record(
  '系统返回键收起详情而不是退出网站',
  backOut.mode === 'wall' && backOut.host === new URL(BASE).host && !backOut.hash.startsWith('#/b/'),
  JSON.stringify(backOut),
);

/* A block link for a block that no longer exists must degrade into the wall —
   and must not leave the dead address sitting in the bar to be shared on. */
await cdp.goto('#/b/does-not-exist');
const dead = await cdp.evaluate(`({ mode: document.body.dataset.mode || 'wall', hash: location.hash, tiles: document.querySelectorAll('.tile').length })`);
record(
  '不存在的深链退回方块墙，并把死链从地址栏清掉',
  dead.mode === 'wall' && dead.hash === '' && dead.tiles === BLOCKS.length,
  JSON.stringify(dead),
);

/* busy must not latch: switch repeatedly and confirm the sheet still closes. */
await cdp.goto('#/b/record-004');
const busyLatch = await cdp.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 4; i += 1) {
    document.querySelector('[data-step="1"]').click();
    await wait(250);
  }
  document.querySelector('.stage-bar [data-close]').click();
  await wait(1200);
  return document.body.dataset.mode || 'wall';
})()`);
record('连续换块后仍能正常关闭（busy 未卡死）', busyLatch === 'wall', `mode=${busyLatch}`);

/* Roving focus must not walk out of its own grid. */
await cdp.goto();
const roving = await cdp.evaluate(`(async () => {
  const first = document.querySelectorAll('.grid')[0];
  const tiles = [...first.querySelectorAll('.tile')];
  const last = tiles[tiles.length - 1];
  last.focus();
  await new Promise((r) => setTimeout(r, 60));
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const active = document.activeElement;
  return { stayedInGrid: first.contains(active), active: active?.dataset?.open ?? null };
})()`);
record('末块按 ↓ 不会跳进下一段', roving.stayedInGrid === true, JSON.stringify(roving));

/* -------------------------------------------------------- 8. phone: 390×844 */

await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await cdp.goto();
await cdp.evaluate(`document.querySelector('.tile[data-open="record-001"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(250);
await cdp.click('.tile[data-open="record-001"]');
const phoneSheet = await cdpProbe();
record(
  '手机上详情铺满整屏',
  phoneSheet.sheetPosition === 'fixed'
    && phoneSheet.sheetCovers?.top <= 0
    && phoneSheet.sheetCovers?.h >= phoneSheet.sheetCovers?.vh - 1
    && phoneSheet.mode === 'focus',
  JSON.stringify(phoneSheet.sheetCovers),
);

/* On a phone the header keeps one way back and the count; every move between
   blocks lives at the thumb line. Both sets of controls at once is seven exits
   where three were agreed, and the extra ones are the poorly-placed ones.
   Count what a thumb can press, not what exists: the ✕ shares [data-close] with
   返回方块墙, so a raw querySelectorAll count is 2 even when the group is hidden. */
const header = await cdp.evaluate(`(() => {
  const visible = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  return {
    nav: getComputedStyle(document.querySelector('.stage-nav')).display,
    closes: [...document.querySelectorAll('.stage-bar [data-close]')].filter(visible).length,
    bar: Boolean(document.querySelector('[data-next]')) && Boolean(document.querySelector('[data-open-list]')),
  };
})()`);
record(
  '手机上标题栏收掉 ‹ › ，换块只走吸底条',
  header.nav === 'none' && header.closes === 1 && header.bar === true,
  JSON.stringify(header),
);

/* Read to the very bottom — where the old layout stranded the reader. */
await cdp.evaluate(`(() => { const f = document.querySelector('.focus'); f.scrollTop = f.scrollHeight; })()`);
await sleep(400);
const depth = await cdp.evaluate('Math.round(document.querySelector(".focus").scrollTop)');
record('确实已滚到长内容底部', depth > 500, `scrollTop=${depth}px`);

const bar = await cdp.evaluate(`(() => {
  const el = document.querySelector('[data-next]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const inner = document.querySelector('.sheet-bar-inner').getBoundingClientRect();
  const cs = getComputedStyle(document.querySelector('.sheet-bar'));
  return {
    h: Math.round(r.height), w: Math.round(r.width),
    barPos: cs.position,
    barH: Math.round(inner.height),
    barBottom: Math.round(inner.bottom),
    barTop: Math.round(inner.top),
    vh: window.innerHeight,
    inThumbZone: r.top >= window.innerHeight * 0.6,
    unobstructed: Boolean(hit && (hit === el || el.contains(hit))),
  };
})()`);
record('「下一篇」落在拇指区（视口下 40%）', bar?.inThumbZone === true, JSON.stringify(bar));
record('「下一篇」没有被任何元素压住', bar?.unobstructed === true);
record('「下一篇」触控高度 ≥44px', (bar?.h ?? 0) >= 44, `${bar?.h}px`);
/* Sticky, not fixed: .focus is the scroll container, and a transform on any
   ancestor would re-anchor a fixed bar mid-animation. */
record('吸底条是 sticky 定位', bar?.barPos === 'sticky', `position=${bar?.barPos}`);
record(
  '吸底条确实钉在视口底边',
  Math.abs(bar.barBottom - bar.vh) <= 1 && bar.barTop > bar.vh - bar.barH - 2,
  `bottom=${bar?.barBottom} / vh=${bar?.vh}`,
);

/* A4 — the label is checked against the data, not a hard-coded string. */
record(
  '按钮写的就是它要去的块名',
  (await cdp.evaluate(`document.querySelector('[data-next] .bar-title')?.textContent?.trim() ?? ''`)) === nextTitleOf('record-001'),
  `标「${await cdp.evaluate(`document.querySelector('[data-next] .bar-title')?.textContent?.trim()`)}」/ 数据下一块「${nextTitleOf('record-001')}」`,
);

/* A1 — the headline claim: one tap from the bottom, no scrolling back. */
await cdp.click('[data-next]');
const afterNext = await cdpProbe();
record('一次点击即从底部换到下一篇', afterNext.title === nextTitleOf('record-001'), `title=${afterNext.title}`);
record('换到没看过的块从头显示', afterNext.sheetScroll === 0, `sheetScroll=${afterNext.sheetScroll}`);
record('换块时页面本身仍未被甩走', afterNext.scrollY === phoneSheet.scrollY, `scrollY=${afterNext.scrollY}`);
/* A5 — switching must not rebuild the list: a fresh `.rail` node would drop
   the reader's place in it and re-run every entrance transition. */
await cdp.evaluate(`document.querySelector('.rail').dataset.probe = 'keepme'`);
await cdp.evaluate(`document.querySelector('.rail').scrollTop = 40`);
await cdp.click('[data-next]');
const railIntact = await cdp.evaluate(`(() => {
  const r = document.querySelector('.rail');
  return { tag: r?.dataset?.probe ?? null, top: Math.round(r?.scrollTop ?? -1), items: r?.querySelectorAll('.rail-item').length ?? 0 };
})()`);
record('换块时清单没有被重建', railIntact.tag === 'keepme', JSON.stringify(railIntact));
record('换块后清单仍是完整 16 项', railIntact.items === BLOCKS.length, `items=${railIntact.items}`);

/* A6 — per-block reading position. Done on the longest block on purpose: a
   short one cannot scroll to the offset being remembered, and the comparison
   would pass against a position that never existed. */
await cdp.goto('#/b/record-001');
const setScroll = await cdp.evaluate(`(() => { const f = document.querySelector('.focus'); f.scrollTop = 320; return Math.round(f.scrollTop); })()`);
await sleep(250);
await cdp.click('[data-prev]');
await sleep(300);
const movedAway = await cdp.evaluate(`(() => { const f = document.querySelector('.focus'); return { id: /^#\\/b\\/(.+)$/.exec(location.hash)?.[1], top: Math.round(f.scrollTop) }; })()`);
await cdp.click('[data-next]');
await sleep(400);
const resumed = await cdpProbe();
record(
  '回到看过的块会停在原处',
  setScroll >= 200 && movedAway.id === prevIdOf('record-001') && Math.abs((resumed.sheetScroll ?? 0) - setScroll) <= 6,
  `期望 ${setScroll}，实得 ${resumed.sheetScroll}（中途在 ${movedAway.id} 的 ${movedAway.top}px）`,
);

/* A9 — the sticky bar must not sit on top of the last gallery image. */
await cdp.goto('#/b/record-001');
await cdp.evaluate(`(() => { const f = document.querySelector('.focus'); f.scrollTop = f.scrollHeight; })()`);
await sleep(350);
const overlap = await cdp.evaluate(`(() => {
  const items = document.querySelectorAll('.gallery-item');
  const last = items[items.length - 1];
  const bar = document.querySelector('.sheet-bar');
  if (!last || !bar) return { missing: true, items: items.length, bar: !!bar };
  return { gap: Math.round(bar.getBoundingClientRect().top - last.getBoundingClientRect().bottom) };
})()`);
record(
  '吸底条不遮住最后一张图',
  overlap?.missing !== true && overlap.gap >= 0,
  JSON.stringify(overlap),
);

/* A2 — the list is reachable from mid-sheet via the drawer. */
await cdp.click('[data-open-list]');
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
    expanded: document.querySelector('[data-open-list]')?.getAttribute('aria-expanded'),
    hint: document.querySelector('.rail-hint')?.textContent?.trim() ?? '',
  };
})()`);
record('「全部方块」升起清单抽屉', drawer.open && drawer.visible, JSON.stringify({ open: drawer.open, visible: drawer.visible }));
record(
  '抽屉里 16 块齐全、分组条 4 条',
  drawer.items === BLOCKS.length && drawer.rules === new Set(BLOCKS.map((b) => b.section)).size,
  `${drawer.items}/${drawer.rules}`,
);
record('抽屉当前块已滚到可见位置', drawer.currentOnScreen === true);
record('抽屉滚动不外溢（overscroll contain）', drawer.overscroll === 'contain', drawer.overscroll);
record('抽屉只允许纵向手势', /^pan-y/.test(drawer.touchAction ?? ''), drawer.touchAction);
record('抽屉打开时舞台被 inert 隔离', drawer.stageInert === true);
record('「全部方块」如实上报 aria-expanded', drawer.expanded === 'true', String(drawer.expanded));
record('抽屉副标题用了 hintFocus 那句', drawer.hint.includes(UI.hintFocus.slice(0, 8)), drawer.hint);

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

/* The drawer, its backdrop and the sticky bar only exist on screen here, so
   this is the one moment where every surface of the phone UI can be read. */
const drawerColours = await painted();
record(
  '抽屉、遮罩与吸底条的渲染色也全是灰阶',
  drawerColours.bad.length === 0,
  drawerColours.bad.slice(0, 4).join(', '),
);

const tapRailItem = async (id) => {
  await cdp.evaluate(`(() => {
    const rail = document.querySelector('.rail');
    const item = rail.querySelector('.rail-item[data-open="${id}"]');
    rail.scrollTop = Math.max(0, item.offsetTop - rail.clientHeight / 2 + item.offsetHeight / 2);
  })()`);
  await sleep(250);
  await cdp.click(`.rail-item[data-open="${id}"]`);
};

await tapRailItem('record-007');
const jumped = await cdpProbe();
record('从抽屉直接跳到指定块', jumped.title === titleOf('record-007'), `title=${jumped.title}`);
record('跳转后抽屉自动收起', jumped.listOpen === false);
record('跳转后舞台不再 inert', (await cdp.evaluate('document.querySelector(".stage")?.hasAttribute("inert") ?? false')) === false);

/* A3 — the old foot-gun: tapping the current block must not close the sheet. */
await cdp.click('[data-open-list]');
await sleep(300);
const titleBeforeSelfTap = (await cdpProbe()).title;
await tapRailItem('record-007');
const selfTap = await cdpProbe();
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
await sleep(300);
const openSweep = await cdp.evaluate(sweepTargets);
record('抽屉打开后可见目标全部 ≥44px', openSweep.length === 0, openSweep.slice(0, 5).join(', '));
const sweepCount = await cdp.evaluate(`(() => {
  if (typeof Element.prototype.checkVisibility !== 'function') return -1;
  return [...document.querySelectorAll('button, a')]
    .filter((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }))
    .length;
})()`);
record('目标扫描确实覆盖到元素（非空判）', sweepCount > 15, `扫到 ${sweepCount} 个`);
await cdp.evaluate(`document.body.dataset.list !== 'open' || document.querySelector('.rail-done').click()`);
await sleep(400);

/* A8 — coarse-pointer sizing. Emulation.setEmulatedMedia({pointer:'coarse'}) is
   ignored by the headless shell and mobile emulation cannot make a 1024px
   viewport coarse, so the stylesheet is read instead of the matchMedia result.
   Every declaration is collected, because a later @media (pointer: coarse)
   block would silently override the intended one — the first match was exactly
   the check that missed it. */
const tapDecls = await cdp.evaluate(`(() => {
  const out = [];
  const walk = (rules, media) => {
    for (const rule of rules) {
      if (rule.type === CSSRule.MEDIA_RULE) { walk(rule.cssRules, rule.conditionText); continue; }
      if (rule.type !== CSSRule.STYLE_RULE) continue;
      const v = rule.style?.getPropertyValue('--tap');
      if (v) out.push({ media: media ?? '', sel: rule.selectorText, val: v.trim() });
    }
  };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules, null); } catch { /* cross-origin */ } }
  return out;
})()`);
const px = (v) => Number(String(v).match(/([\d.]+)px/)?.[1] ?? NaN);
const rootDecls = tapDecls.filter((d) => /:root/.test(d.sel));
const coarseDecls = rootDecls.filter((d) => /pointer:\s*coarse/.test(d.media));
const lastCoarse = coarseDecls.at(-1);
record('存在按输入设备判定的粗指针 --tap 规则', coarseDecls.length >= 1, JSON.stringify(rootDecls));
record(
  '该规则同时覆盖触屏与窄屏',
  coarseDecls.every((d) => /coarse/.test(d.media) && /max-width/.test(d.media)),
  lastCoarse?.media,
);
record(
  '粗指针下最后生效的 --tap ≥44px（没有后置规则把它压回去）',
  Number.isFinite(px(lastCoarse?.val)) && px(lastCoarse.val) >= 44,
  `${coarseDecls.map((d) => d.media + '=' + d.val).join(' | ')}`,
);
record(
  '390px 下 --tap 实测就是 44px',
  px(await cdp.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--tap')`)) === 44,
  String(await cdp.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--tap')`)),
);
const tapToken = await cdp.evaluate(`(() => {
  const css = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText ?? ''); } catch { return []; } }).join('\\n');
  return { usesVar: css.includes('var(--tap)'), hardCoded44: (css.match(/min-height: 44px/g) || []).length };
})()`);
record('按钮尺寸统一走 --tap 变量，没有残留写死值', tapToken.usesVar === true && tapToken.hardCoded44 === 0, JSON.stringify(tapToken));

/* ------------------------- 9. the whole walk: bar freshness at every step */

/* updateSheetBar() used to be droppable: the bar kept the previous block's
   name and target, the label test still passed, and nothing else looked. So
   every one of the fifteen transitions is checked against the data. */
await cdp.goto(`#/b/${ids[0]}`);
const staleBar = [];
const wrongPrev = [];
const wrongOrder = [];
const clippedTitles = [];
for (let i = 0; i < ids.length; i += 1) {
  const id = ids[i];
  const b = await barState();
  const cur = await activeId();
  if (cur !== id) wrongOrder.push(`第 ${i + 1} 步 hash=${cur} 期望 ${id}`);
  const wantNext = nextIdOf(id);
  if (wantNext) {
    if (b.nextOpen !== wantNext) staleBar.push(`${titleOf(id)} 的下一篇指向 ${b.nextOpen}，应为 ${wantNext}`);
    if (b.nextText !== nextTitleOf(id)) staleBar.push(`${titleOf(id)} 的按钮写着「${b.nextText}」，应为「${nextTitleOf(id)}」`);
    if (b.clipped) clippedTitles.push(`「${b.nextText}」需 ${b.need}px 只有 ${b.have}px`);
  } else if (b.end !== 'wall') {
    staleBar.push(`最后一块的主格应为「${UI.backToWallShort}」，实得 ${JSON.stringify(b.endText)}`);
  }
  const wantPrev = prevIdOf(id);
  if (wantPrev && b.prevId !== wantPrev) wrongPrev.push(`${titleOf(id)} 的上一块指向 ${b.prevId}，应为 ${wantPrev}`);
  if (!wantPrev && b.prevId !== null) wrongPrev.push(`第一块出现了可点的上一块 ${b.prevId}`);
  if (wantNext) {
    await cdp.click('[data-next]');
    await sleep(200);
  }
}
record('16 块逐块走一遍，顺序与数据完全一致', wrongOrder.length === 0, wrongOrder.slice(0, 3).join('; '));
record('每次换块后「下一篇」的名字和去向都是新的', staleBar.length === 0, staleBar.slice(0, 3).join('; '));
record('每次换块后「上一块」都指向数据上的上一块', wrongPrev.length === 0, wrongPrev.slice(0, 3).join('; '));
record('390px 下每一块“下一篇”标题都完整', clippedTitles.length === 0, clippedTitles.slice(0, 3).join('; '));

/* The detail image used to be a fixed 4/3 with object-fit: cover, which threw
   away 66% of a tall app screenshot and 50% of a poster. The frame now follows
   the artwork, so two blocks with different source ratios must show different
   box ratios — a regression back to cover re-unifies them and fails here. */
const ratios = {};
for (const id of ['about-studio', 'record-007']) {
  await cdp.evaluate(`document.querySelector('.rail').scrollTo(0, 0)`);
  await cdp.goto(`#/b/${id}`);
  ratios[id] = await cdp.evaluate(`(() => {
    const img = document.querySelector('[data-stage-media] img');
    if (!img || !img.naturalWidth) return null;
    const r = img.getBoundingClientRect();
    return { box: +(r.width / r.height).toFixed(3), natural: +(img.naturalWidth / img.naturalHeight).toFixed(3), fit: getComputedStyle(img).objectFit };
  })()`);
}
record(
  '详情主图用 contain，不裁切作品',
  Object.values(ratios).every((x) => x && x.fit === 'contain'),
  JSON.stringify(ratios),
);
record(
  '详情图框跟着作品比例走（不再一律 4:3）',
  Math.abs((ratios['about-studio']?.box ?? 0) - (ratios['record-007']?.box ?? 0)) > 0.2,
  `社团介绍 ${ratios['about-studio']?.box} vs Mini-HBUT ${ratios['record-007']?.box}（源比例 1 / 0.46）`,
);
record(
  '走到最后一块不会循环回第一块',
  (await cdp.evaluate('!!document.querySelector(\'[data-step="1"][disabled]\')')) === true
    && (await cdp.evaluate('document.querySelector(\'[data-end="wall"] .bar-title\')?.textContent?.trim()')) === UI.backToWallShort,
);

/* ------------------------------------------- 10. desktop rail stickiness */

/* A short viewport on purpose: at 900px tall this sheet only scrolls ~126px,
   less than the test scroll, which would make the check meaningless. */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 600, deviceScaleFactor: 1, mobile: false });
await cdp.goto('#/b/record-001');
const railStick = await cdp.evaluate(`(async () => {
  const rail = document.querySelector('.rail');
  const sheet = document.querySelector('.focus');
  sheet.scrollTop = 0;
  await new Promise((r) => setTimeout(r, 150));
  const before = Math.round(rail.getBoundingClientRect().top);
  sheet.scrollTop = 150;
  await new Promise((r) => setTimeout(r, 250));
  return { before, after: Math.round(rail.getBoundingClientRect().top), scrolled: Math.round(sheet.scrollTop) };
})()`);
record(
  '桌面左栏真的吸得住（不是只写着 sticky）',
  railStick.before === railStick.after && railStick.scrolled === 150,
  `滚动 ${railStick.scrolled}px，左栏 top ${railStick.before} → ${railStick.after}`,
);
/* `position: sticky` alone passes for a rail that never sticks, so the
   computed string is checked too — cheap, and it pinpoints the regression. */
record(
  '桌面左栏 computed position 是 sticky',
  (await cdp.evaluate(`getComputedStyle(document.querySelector('.rail')).position`)) === 'sticky',
);
/* The left column must be scrollable in its own right or the last blocks of a
   16-item list are unreachable on a short screen. */
record(
  '桌面左栏自身可滚，16 块都够得着',
  (await cdp.evaluate(`(() => {
    const r = document.querySelector('.rail');
    const last = r.querySelectorAll('.rail-item')[15];
    r.scrollTop = r.scrollHeight;
    const rb = r.getBoundingClientRect(), lb = last.getBoundingClientRect();
    return { canScroll: r.scrollHeight > r.clientHeight, reachable: lb.top >= rb.top - 1 && lb.bottom <= rb.bottom + 1 };
  })()`)).canScroll === true,
);

/* ------------------------------------------------- 11. reduced motion, and
   the safe-area wiring that makes the phone numbers real */

/* Emulating the media feature does work in this shell (unlike pointer:coarse,
   which is silently ignored), so this is the real behaviour rather than a
   reading of the stylesheet — and the precondition is asserted first, because
   an ignored emulation used to turn a whole section into a pass-by-absence. */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await cdp.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
});
const rmSupported = await cdp.evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
record('环境确实能模拟「减少动效」（前提检查）', rmSupported === true, String(rmSupported));

await cdp.goto();
await cdp.evaluate(`document.querySelector('.tile[data-open="record-001"]').scrollIntoView({block:'center',behavior:'instant'})`);
await sleep(250);
await armFlyWatch('.tile[data-open="record-001"] .tile-media');
await cdp.click('.tile[data-open="record-001"]');
const rmOpen = await cdpProbe();
const rmSamples = (await readFlyWatch()).samples;
record(
  '减少动效下：方块照样打开，但图片不飞',
  rmOpen.mode === 'focus' && rmSamples.length === 0,
  `mode=${rmOpen.mode} 飞行帧=${rmSamples.length}`,
);
await cdp.click('[data-next]');
record(
  '减少动效没有把一次点击换块一起关掉',
  (await cdpProbe()).title === nextTitleOf('record-001'),
  `title=${(await cdpProbe()).title}`,
);
await cdp.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});

const safeArea = await cdp.evaluate(`(async () => {
  const html = await fetch('index.html').then((r) => r.text());
  const css = await fetch('styles.css').then((r) => r.text());
  const bar = /\\.sheet-bar\\s*\\{[^}]*padding-bottom:\\s*var\\(--safe-b\\)/.test(css);
  return {
    cover: /viewport-fit=cover/.test(html),
    tokens: ['--safe-b', '--safe-t', '--safe-l', '--safe-r'].every((k) => css.includes(k + ': env(safe-area-inset')),
    barUses: bar,
    zoomBlocked: /maximum-scale|user-scalable\\s*=\\s*no/.test(html),
  };
})()`);
record(
  '安全区接上了：viewport-fit=cover + 四个 env 令牌 + 吸底条留底边',
  safeArea.cover && safeArea.tokens && safeArea.barUses,
  JSON.stringify(safeArea),
);
record(
  '没有禁用双指缩放（viewport 里没有 maximum-scale / user-scalable=no）',
  safeArea.zoomBlocked === false,
);

/* --------------------------------------------------------- 12. console */

record('全程无 console 报错/异常', cdp.consoleErrors.length === 0, cdp.consoleErrors.slice(0, 3).join(' | '));

/* --------------------------------------------------------- scoring */

/* The denominator is fixed, not `checks.length`: counting your own checks and
   reporting "N/N passed" means a deleted check still reads as a clean run.
   When you deliberately add or remove an assertion, change this number. */
const EXPECTED_CHECKS = 124;

const failed = checks.filter((check) => !check.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed  (expected ${EXPECTED_CHECKS})`);
if (duplicates.length) {
  console.log('FAIL: 断言重名，说明有人改写了旧断言却没有新增:', [...new Set(duplicates)].join(', '));
}
if (checks.length !== EXPECTED_CHECKS) {
  console.log(`FAIL: 断言数量对不上（跑完 ${checks.length} 条，应有 ${EXPECTED_CHECKS} 条）。少掉的那条不会报错，只会让"全过"更好达成。`);
  process.exitCode = 1;
}
if (failed.length || duplicates.length) {
  console.log('FAILED:', failed.map((check) => check.name).join(', '));
  process.exitCode = 1;
}
await chrome.cleanup();
