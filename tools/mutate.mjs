/* Does the test suite actually notice when the app is broken?

   verify.mjs printing "102/102 passed" only proves the app passes today. Most
   of what it is supposed to guarantee is invisible to a passing run: delete a
   line and see whether anything turns red. This script does exactly that,
   mechanically.

     node tools/mutate.mjs            every mutation
     node tools/mutate.mjs 3 7 12     only those numbers

   Each mutation is applied to a throwaway copy of the project (assets and all)
   with its own static server, so the working tree is never touched and no run
   can be confused for another. A mutation the suite does not report is a hole
   in the suite, not a bug in the app — the output names the hole.

   History: the first sweep of this caught five regressions the then-62-assertion
   suite passed straight over, and after the current suite was written it was
   re-run to prove the new assertions discriminate.
--------------------------------------------------------------------------- */
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* `find` must be unique in the file — a mutation that silently lands twice is
   a mutation nobody understands. */
const MUTATIONS = [
  {
    name: '删掉 ‹ › 按钮的点击分支（曾渲染但从未接线）',
    file: 'app.js',
    find: `  const stepper = event.target.closest('[data-step]');
  if (stepper) return step(Number(stepper.dataset.step));`,
    to: '',
  },
  {
    name: '吸底条 sticky 改成 fixed',
    file: 'styles.css',
    find: `.sheet-bar {
  position: sticky;`,
    to: `.sheet-bar {
  position: fixed;`,
  },
  {
    name: '关闭按钮直接收页面、不消耗历史记录',
    file: 'app.js',
    find: `  if (ownsHistoryEntry) history.back();
  else closeBlock();`,
    to: `  closeBlock();`,
  },
  {
    name: '把 ‹ › 两枚按钮的步进方向取反',
    file: 'app.js',
    find: `  if (stepper) return step(Number(stepper.dataset.step));`,
    to: `  if (stepper) return step(-Number(stepper.dataset.step));`,
  },
  {
    name: '删掉 ‹ › 两枚按钮里的 ‹（方向写反的另一种写法）',
    file: 'app.js',
    find: `                  \${next ? '' : 'disabled'}>›</button>
          <button class="stage-btn" type="button" data-close aria-label="\${ui.close}">✕</button>`,
    to: `                  \${next ? '' : 'disabled'}>‹</button>
          <button class="stage-btn" type="button" data-close aria-label="\${ui.close}">✕</button>`,
  },
  {
    name: '整个放大动画 fly() 直接返回，什么都不飞',
    file: 'app.js',
    find: `function fly(from, to, src) {
  if (reduced()`,
    to: `function fly(from, to, src) {
  if (true`,
  },
  {
    name: '在末尾追加一条更小的粗指针 --tap（后置规则压过前面）',
    file: 'styles.css',
    find: `button,
a {
  touch-action: manipulation;`,
    to: `@media (pointer: coarse) { :root { --tap: 26px } }

button,
a {
  touch-action: manipulation;`,
  },
  {
    name: '换块时不再更新吸底条（写着上一块的目标）',
    file: 'app.js',
    find: `    updateSheetBar(block);`,
    to: `    /* dropped */`,
  },
  {
    name: '详情页只占视口 55% 高',
    file: 'styles.css',
    find: `  display: block;
  position: fixed;
  inset: 0;`,
    to: `  display: block;
  position: fixed;
  top: 0; left: 0; right: 0; height: 55%;`,
  },
  {
    name: '↑↓ 又被详情页吃掉（键盘用户无法滚动）',
    file: 'app.js',
    find: `    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    }`,
    to: `    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      step(-1);
    }`,
  },
  {
    name: '清单里点当前块又把整个详情页关掉（原来的误触陷阱）',
    file: 'app.js',
    find: `    if (id === state.activeId) closeList();`,
    to: `    if (id === state.activeId) requestClose();`,
  },
  {
    name: '不再记住每块的阅读位置',
    file: 'app.js',
    find: `    sheet.scrollTop = Math.min(resume.get(id) ?? 0, limit);`,
    to: `    sheet.scrollTop = 0;`,
  },
  {
    name: '抽屉去掉 overscroll-behavior: contain',
    file: 'styles.css',
    find: `  overscroll-behavior: contain;
  touch-action: pan-y;`,
    to: `  touch-action: pan-y;`,
  },
  {
    name: '抽屉的 z-index 退回 5（最后一排被吸底条盖住）',
    file: 'styles.css',
    find: `  z-index: 8;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));`,
    to: `  z-index: 5;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));`,
  },
  {
    name: '抽屉打开时不再 inert 舞台（Tab 跑进背后的内容）',
    file: 'app.js',
    find: `  root.querySelector('.stage')?.setAttribute('inert', '');`,
    to: `  /* dropped */`,
  },
  {
    name: '收起详情页时不清理大图遮罩（留下盖住页面的空层）',
    file: 'app.js',
    find: `  root.querySelector('.lightbox')?.remove();
  delete document.body.dataset.lightbox;`,
    to: `  delete document.body.dataset.lightbox;`,
  },
  {
    name: '打开方块改用 replaceState（系统返回键会离开网站）',
    file: 'app.js',
    find: `    if (push) history.pushState({ pandaBlock: id }, '', \`#/b/\${id}\`);`,
    to: `    if (push) history.replaceState({ pandaBlock: id }, '', \`#/b/\${id}\`);`,
  },
  {
    name: '桌面左栏 top: 0 改成 inset: auto（写着 sticky 却不吸）',
    file: 'styles.css',
    find: `    top: 0;
    right: auto;
    bottom: auto;
    left: auto;`,
    to: `    inset: auto;`,
  },
  {
    name: '换块时重建整张清单',
    file: 'app.js',
    find: `    renderStageOnly(block);`,
    to: `    renderFocus();`,
  },
  {
    name: 'step() 的越界保护改成循环（到头会绕回开头）',
    file: 'app.js',
    find: `  const next = index + delta;
  if (next < 0 || next >= BLOCKS.length) return;`,
    to: `  let next = index + delta;
  if (next < 0 || next >= BLOCKS.length) next = (next + BLOCKS.length) % BLOCKS.length;`,
  },
  {
    name: '打开详情页时不把当前块滚到可见（清单停在顶部）',
    file: 'app.js',
    find: `  if (!current) return;`,
    to: `  if (!current) return;
  return;`,
  },
  {
    name: '「全部方块」不再上报 aria-expanded',
    file: 'app.js',
    find: `  root.querySelector('[data-open-list]')?.setAttribute('aria-expanded', 'true');`,
    to: `  /* dropped */`,
  },
  {
    name: '最后一块的主格改回循环到第一块',
    file: 'app.js',
    find: `  const next = BLOCKS[index + 1];

  const prevCell = prev`,
    to: `  const next = BLOCKS[index + 1] || BLOCKS[0];

  const prevCell = prev`,
  },
  {
    name: '桌面端也显示吸底条（和左栏重复）',
    file: 'styles.css',
    find: `  .rail-head,
  .list-backdrop,
  .sheet-bar {
    display: none;
  }`,
    to: `  .rail-head,
  .list-backdrop {
    display: none;
  }`,
  },
  {
    name: '换块时把整个页面甩到顶部',
    file: 'app.js',
    find: `    const stage = root.querySelector('.stage');
    stage?.focus({ preventScroll: true });`,
    to: `    window.scrollTo(0, 0);
    const stage = root.querySelector('.stage');
    stage?.focus({ preventScroll: true });`,
  },
  /* --- found by the second round: things the first sweep never thought to
         break, including the client's own "no colour" requirement, which the
         suite had no way to see at all --- */
  {
    name: '把窗口灰换成粉色 #f386a1（客户明确不要彩色）',
    file: 'styles.css',
    find: `  --panel: #dedede;`,
    to: `  --panel: #f386a1;`,
  },
  {
    name: '首屏抖动灰阶不画了（空白画布）',
    file: 'app.js',
    find: `function paintCloud() {
  const canvas = root.querySelector('.hero-cloud');`,
    to: `function paintCloud() {
  if (true) return;
  const canvas = root.querySelector('.hero-cloud');`,
  },
  {
    name: '两段方块调换顺序（作品段跑到索引段前面）',
    file: 'app.js',
    find: `    ['index', BLOCKS.filter((b) => b.group === 'index'), '3'],
    ['record', BLOCKS.filter((b) => b.group === 'record'), '4'],`,
    to: `    ['record', BLOCKS.filter((b) => b.group === 'record'), '4'],
    ['index', BLOCKS.filter((b) => b.group === 'index'), '3'],`,
  },
  {
    name: '一个方块的分组归属写错（社团介绍被归进作品段）',
    file: 'data.js',
    find: `    id: 'about-studio',
    group: 'index',`,
    to: `    id: 'about-studio',
    group: 'record',`,
  },
  {
    name: '不再清理指向不存在方块的死链',
    file: 'app.js',
    find: `  if (id) history.replaceState(null, '', location.pathname + location.search);`,
    to: `  /* dropped */`,
  },
  {
    name: '能力标签少一项（把「快速原型」删掉）',
    file: 'data.js',
    find: `    capabilities: ['AI 协同', '3D 打印', '快速原型', '产品思维'],`,
    to: `    capabilities: ['AI 协同', '3D 打印', '产品思维'],`,
  },
  {
    name: '正文里的中文引号被换成直角引号（改掉原作者的用字）',
    file: 'data.js',
    find: `      zh: '我们关注的不是“做一个游戏”，`,
    to: `      zh: '我们关注的不是「做一个游戏」，`,
  },
  {
    name: '手机上把标题栏的 ‹ › ✕ 又显示出来（七条出口而不是三条）',
    file: 'styles.css',
    find: `  .stage-nav {
    display: none;
  }`,
    to: `  /* dropped */`,
  },
];

const argIds = process.argv.slice(2).map(Number).filter(Number.isFinite);
const chosen = argIds.length ? MUTATIONS.filter((_, i) => argIds.includes(i + 1)) : MUTATIONS;

const workspace = await mkdtemp(join(tmpdir(), 'panda-mut-'));

async function makeCopy(dir) {
  await mkdir(dir, { recursive: true });
  for (const entry of ['app.js', 'data.js', 'index.html', 'styles.css', 'assets', 'tools']) {
    await cp(join(ROOT, entry), join(dir, entry), { recursive: true });
  }
  /* The repo is stored with CRLF line endings; the anchors above are written
     with LF. Re-write the mutable files as LF so a mutation can never silently
     miss its target — which is exactly how the first version of this script
     reported "5 of 11 caught" for changes it had never actually applied. */
  for (const entry of ['app.js', 'data.js', 'index.html', 'styles.css']) {
    const p = join(dir, entry);
    const text = await readFile(p, 'utf8');
    if (text.includes('\r\n')) await writeFile(p, text.replace(/\r\n/g, '\n'), 'utf8');
  }
}

const run = (args, cwd, port) =>
  new Promise((done) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, PANDA_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    const killer = setTimeout(() => child.kill(), 10 * 60 * 1000);
    child.on('exit', (c) => { clearTimeout(killer); done({ code: c, out: String(out) }); });
  });

async function runOne(mutation, number, dir, port) {
  const path = join(dir, mutation.file);
  const original = await readFile(path, 'utf8');
  const hits = original.split(mutation.find).length - 1;
  if (hits !== 1) {
    return { number, name: mutation.name, verdict: `STALE(锚点匹配 ${hits} 次)`, found: [] };
  }
  await writeFile(path, original.replace(mutation.find, mutation.to), 'utf8');
  let copy = null;
  try {
    const verify = await run(['tools/verify.mjs'], dir, port);
    /* Behaviour mutations belong to verify.mjs. Copy mutations do not: a
       paraphrased summary or a dropped capability still renders and still
       clicks correctly, so those go to diff-source.mjs, which compares the copy
       against the club's own source text. */
    if (mutation.file === 'data.js') copy = await run(['tools/diff-source.mjs'], dir, port);
    const text = verify.out;
    /* Read the report lines, not just the exit code: "verify crashed halfway"
       and "verify finished and named what broke" are different answers — and
       the first parser required every FAIL line to carry a detail string, so
       assertions without one printed `FAIL  名称` and were miscounted as MISSED. */
    const failedNames = text
      .split('\n')
      .filter((line) => line.startsWith('FAIL  '))
      .map((line) => line.slice(6).split('  — ')[0].trim());
    const ranToCompletion = /\d+\/\d+ passed\s+\(expected/.test(text);
    /* A stale diff-source (it could not read the source project) must not be
       reported as a catch — that would flatter the report. */
    const copyStale = Boolean(copy) && /结构|无法读取/.test(copy.out);
    const copyCaught = Boolean(copy) && !copyStale && /未解释的漂移/.test(copy.out);
    const found = [...failedNames, ...(copyCaught ? ['diff-source：文案与源项目不一致'] : [])];
    const verdict = found.length
      ? `CAUGHT (${found.length} 条)`
      : !ranToCompletion
        ? 'CAUGHT-但靠中断（套件没机会报告）'
        : copyStale
          ? '无法判定（diff-source 读不到源项目）'
          : 'MISSED  ← 套件看不见这个改动';
    /* Keep the per-mutation report: a verdict you cannot re-read is a verdict
       you cannot trust. */
    await writeFile(
      join(workspace, `out-${number}.txt`),
      `verify exit=${verify.code}\n${text}\n\n=== diff-source (exit ${copy?.code ?? 'n/a'}) ===\n${copy?.out ?? '未运行'}`,
      'utf8',
    );
    return { number, name: mutation.name, verdict, found };
  } finally {
    await writeFile(path, original, 'utf8');
  }
}

const WORKERS = Number(process.env.MUT_WORKERS ?? 3);
console.log(`${chosen.length} 条变异，${WORKERS} 份副本并行`);
const copies = await Promise.all(
  Array.from({ length: WORKERS }, async (_, i) => {
    const dir = join(workspace, `copy-${i}`);
    await makeCopy(dir);
    return dir;
  }),
);

const queue = chosen.map((m) => ({ m, number: MUTATIONS.indexOf(m) + 1 }));
const results = [];
await Promise.all(copies.map(async (dir, worker) => {
  for (;;) {
    const job = queue.shift();
    if (!job) return;
    const r = await runOne(job.m, job.number, dir, 4400 + job.number * 4 + worker);
    results.push(r);
    console.log(`#${String(job.number).padStart(2)}  ${r.verdict}  ${job.m.name}`);
    r.found.slice(0, 4).forEach((n) => console.log(`      · ${n}`));
  }
}));

results.sort((a, b) => a.number - b.number);
console.log('\n\n汇总');
console.log('─'.repeat(72));
for (const r of results) {
  console.log(`#${String(r.number).padEnd(3)} ${r.verdict.padEnd(18)} ${r.name}`);
}
const missed = results.filter((r) => r.verdict.startsWith('MISSED') || r.verdict.startsWith('STALE') || r.verdict.startsWith('无法判定'));
console.log(`\n${results.length - missed.length}/${results.length} 条变异被套件抓到`);
if (missed.length) {
  console.log('漏掉的：');
  missed.forEach((r) => console.log(`  #${r.number} ${r.name}`));
  /* The per-mutation reports stay on disk: a verdict you cannot re-read is a
     verdict you cannot trust. */
  console.log(`\n每条变异的完整报告留在 ${workspace}\\out-<编号>.txt`);
  process.exitCode = 1;
}
