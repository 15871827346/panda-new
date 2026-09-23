/* Report the fonts the browser ACTUALLY rasterised with, per element.
   Declared font-family tells you what was asked for; this tells you what was
   used.   node tools/fonts.mjs
*/
import { ensureServer } from './ensure-server.mjs';
import { startChrome } from './browser.mjs';
import { resolve } from 'node:path';

/* An explicit argument still wins; otherwise follow ensureServer's port. */
const ARG = process.argv[2] ?? null;
let URL = 'http://127.0.0.1:4321/';
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
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    return r.result.value;
  }
}

const server = await ensureServer(process.env.PANDA_PORT ? 0 : 4321);
URL = ARG ?? server.base;
const chrome = await startChrome();
process.on('exit', () => chrome.cleanup());

const cdp = await CDP.connect(chrome.websocket);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('DOM.enable');
await cdp.send('CSS.enable');
await cdp.send('Page.navigate', { url: URL });
await sleep(3500);

const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: false });

const SELECTORS = [
  ['h1 标语（拉丁）', '.hero h1'],
  ['页脚字标（拉丁）', '.footer-mark'],
  ['方块标题（中文）', '.tile-title'],
  ['方块摘要（中文）', '.tile-summary'],
  ['窗口标题栏（中文）', '.tile-bar'],
  ['区块黑条（中文）', '.section-bar'],
  ['左栏条目（中文）', '.rail-title'],
];

console.log('page:', URL);

for (const [label, selector] of SELECTORS) {
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) {
    console.log(`  ${label.padEnd(20)} — 元素不存在`);
    continue;
  }
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  const text = await cdp.eval(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim().slice(0,18) ?? ''`);
  const style = await cdp.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const cs = getComputedStyle(el); return cs.fontSize + ' / lh ' + (parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)).toFixed(2) + ' / ls ' + cs.letterSpacing; })()`);
  console.log(`  ${label.padEnd(20)} ${fonts.map((f) => `${f.familyName}(${f.glyphCount})`).join(' + ')}`);
  console.log(`  ${''.padEnd(20)} 度量 ${style}   文本「${text}」`);
}

const declared = await cdp.eval('getComputedStyle(document.body).fontFamily');
console.log('\n声明的字族栈:', declared);
console.log('Arial 可用:', await cdp.eval("document.fonts.check('16px Arial')"));
console.log('SimHei 可用:', await cdp.eval("document.fonts.check('16px SimHei')"));
