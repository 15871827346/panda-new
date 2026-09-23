/* ---------------------------------------------------------------------------
   Typography audit. Measures the page against reading-habit rules instead of
   eyeballing it: line length in characters, leading, type-scale steps,
   WCAG contrast, and whether any text is actually being clipped.

     node tools/audit-type.mjs
--------------------------------------------------------------------------- */
import { spawn } from 'node:child_process';
import { ensureServer } from './ensure-server.mjs';

const CHROME =
  'C:/Users/24772/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const PORT = 9348;
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
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'page threw');
    return r.result.value;
  }
}

await ensureServer();
const browser = spawn(
  CHROME,
  [`--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-sandbox', '--window-size=1440,1000', 'about:blank'],
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

const PROBE = `(() => {
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => (s.match(/\\d+(\\.\\d+)?/g) || [0, 0, 0]).slice(0, 3).map(Number);
  const contrast = (fg, bg) => {
    const a = lum(parse(fg));
    const b = lum(parse(bg));
    return ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
  };
  const bgOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const c = getComputedStyle(node).backgroundColor;
      if (c && !c.startsWith('rgba(0, 0, 0, 0') && c !== 'transparent') return c;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };

  const rows = [];
  const seen = new Set();

  const measure = (el, role) => {
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const leading = cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight) / size;
    const track = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing);

    /* Line boxes from a Range give the true number of wrapped lines and the
       width the text actually occupies. */
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    const widest = rects.length ? Math.max(...rects.map((r) => r.width)) : 0;

    /* One Han glyph is ~1em wide; Latin averages ~0.5em. */
    const text = el.textContent.trim();
    const cjk = (text.match(/[\\u3400-\\u9FFF\\u3000-\\u303F\\uFF00-\\uFFEF]/g) || []).length;
    const perChar = cjk / Math.max(1, text.length) >= 0.5 ? 1 : 0.52;
    const charsPerLine = Math.round(widest / (size * perChar + track));

    const clipped = el.scrollHeight - el.clientHeight > 1 ||
      rects.some((r) => r.width > el.clientWidth + 1);

    const key = role;
    if (seen.has(key)) return;
    seen.add(key);

    rows.push({
      role,
      size: +size.toFixed(1),
      leading: leading ? +leading.toFixed(2) : null,
      track: +track.toFixed(2),
      weight: cs.fontWeight,
      align: cs.textAlign,
      charsPerLine,
      lines: rects.length,
      clipped,
      contrast: contrast(cs.color, bgOf(el)),
      sample: text.slice(0, 14),
    });
  };

  const ROLES = [
    ['区块大标题', '.section-head h2'],
    ['区块引导语', '.section-head .hint'],
    ['方块标题', '.tile-title'],
    ['方块摘要', '.tile-summary'],
    ['方块底栏', '.tile-foot'],
    ['窗口标题栏', '.tile-bar'],
    ['能力标签', '.caps li'],
    ['首屏说明', '.hero-notes p'],
  ];
  for (const [role, sel] of ROLES) {
    const el = document.querySelector(sel);
    if (el) measure(el, role);
  }

  const sizes = [...document.querySelectorAll('body *')]
    .filter((el) => el.textContent.trim() && el.children.length === 0)
    .map((el) => parseFloat(getComputedStyle(el).fontSize));
  const distinct = [...new Set(sizes.map((s) => Math.round(s * 10) / 10))].sort((a, b) => a - b);

  const tiny = [...document.querySelectorAll('body *')]
    .filter((el) => el.textContent.trim() && el.children.length === 0)
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12)
    .map((el) => el.className || el.tagName);

  return { rows, distinct, tinyCount: tiny.length, tinyRoles: [...new Set(tiny)].slice(0, 8) };
})()`;

const FOCUS_PROBE = `(() => {
  const out = [];
  const grab = (role, sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    const widest = rects.length ? Math.max(...rects.map((r) => r.width)) : 0;
    const text = el.textContent.trim();
    const cjk = (text.match(/[\\u3400-\\u9FFF]/g) || []).length;
    const perChar = cjk / Math.max(1, text.length) >= 0.5 ? 1 : 0.52;
    out.push({
      role,
      size: +size.toFixed(1),
      leading: cs.lineHeight === 'normal' ? null : +(parseFloat(cs.lineHeight) / size).toFixed(2),
      charsPerLine: Math.round(widest / (size * perChar + (cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing)))),
      lines: rects.length,
      clipped: el.scrollWidth > el.clientWidth + 1,
      sample: text.slice(0, 14),
    });
  };
  grab('放大标题', '.stage-title');
  grab('正文段落', '.prose p');
  grab('内容条目', '.items li');
  grab('左栏条目', '.rail-title');
  grab('标签', '.chips li');
  grab('图集计数', '.gallery-head');
  return out;
})()`;

async function visit(url) {
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await cdp.send('Page.navigate', { url });
  await sleep(2600);
}

await visit(BASE);
const wall = await cdp.eval(PROBE);

console.log('\n=== 方块墙 ===');
console.table(wall.rows);
console.log('全页字号档位 (px):', wall.distinct.join(', '));
console.log(`小于 12px 的文字节点: ${wall.tinyCount} 处 →`, wall.tinyRoles.join(', '));

await visit(`${BASE}#/b/record-001`);
const focus = await cdp.eval(FOCUS_PROBE);
console.log('\n=== 放大态（3D 打印作品） ===');
console.table(focus);

browser.kill();
