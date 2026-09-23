/* Copy fidelity check: this site's data.js against the club's own source copy.

     node tools/diff-source.mjs        exit 0 = no unexplained drift

   Reads D:/Projects/panda-studio-site-original read-only — it never writes
   there (another session edits that project). Two exit codes matter:

     1  copy drifted from the source in a way not listed in ACCEPTED
     2  the source could not be read or parsed at all — that is this script
        going stale, not the copy going wrong, and it must not be reported as
        the same kind of failure.

   ACCEPTED is the point of the file: every deliberate rewrite is written down
   with its reason, so "I simplified the wording" is a decision someone can
   read and reverse, not a rumour.
--------------------------------------------------------------------------- */
import { readFileSync, existsSync } from 'node:fs';
import { BLOCKS, SITE } from '../data.js';

const SRC = 'D:/Projects/panda-studio-site-original';
const UI_ONLY = /^copy\.|^theme\.|^ui\./;

/* Rewrites we are standing behind. Written down so "I simplified the wording"
   is a decision someone can read, argue with, and reverse — not a rumour.
   The card summaries are all of these: the source's run 20–30 characters and
   do not fit the single line a tile has, so every one was rewritten shorter
   while titles, bodies and gallery captions stayed verbatim. */
const ACCEPTED = [
  '16 条卡片摘要重写为更短的一句（源 20–30 字 → 12–18 字）；标题、正文、图集说明均为原文',
  '「PANDA社团」写作「PANDA 社团」：中英之间补一个半角空格',
  'data.js 仍带一层英文文案，但界面没有任何入口能显示它（客户要求只做中文）',
];

/** The text of the { … } block starting at or after `from`, quote-aware. */
function objectAt(text, from) {
  const open = text.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

const unq = (s) => s.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\'/g, "'");

/** Where two strings first part company, with enough context to read. Printing
    only a prefix made two bodies that differ at character 300 look identical. */
function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const show = (s) => JSON.stringify(s.slice(Math.max(0, i - 12), i + 24)).replace(/\\n/g, '⏎');
  const len = `（长度 ${a.length} vs ${b.length}）`;
  if (i >= Math.min(a.length, b.length)) return `一边在这里就结束了 ${len}：我 ${show(a)} / 源 ${show(b)}`;
  return `第 ${i} 字起不同 ${len}：\n      我: …${show(a)}\n      源: …${show(b)}`;
}

function fields(body) {
  const out = {};
  for (const m of body.matchAll(/(?:^|[,{\s])(title|summary|body|group|label|note|status|galleryMode):\s*'((?:[^'\\]|\\.)*)'/gm)) {
    out[m[1]] = unq(m[2]);
  }
  for (const m of body.matchAll(/(?:^|[,{\s])(items|meta):\s*\[/gm)) {
    const inner = objectAt('[' + body.slice(m.index + m[0].length - 1), 0);
    out[m[2]] = inner ? [...inner.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => unq(x[1])) : [];
  }
  const gal = /(?:^|[,{\s])gallery:\s*\[([\s\S]*?)\]/m.exec(body);
  if (gal) out.galleryCount = (gal[1].match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).length;
  if (/(?:^|[,{\s])image:\s*\w/.test(body)) out.hasImage = true;
  return out;
}

function section(ts, declName, locale = 'zh') {
  const at = ts.indexOf(declName);
  if (at < 0) return null;
  const container = objectAt(ts, at);
  if (!container) return null;
  const localeAt = container.search(new RegExp(`(^|[,{\\s])${locale}:\\s*\\{`, 'm'));
  if (localeAt < 0) return null;
  /* Exactly the locale's own object — slicing to the end of the container also
     reads `en:`, and since both locales key the same ids the English copy
     overwrote the Chinese and every title came back in English. */
  const body = objectAt(container, container.indexOf('{', localeAt));
  if (!body) return null;
  const out = {};
  for (const m of body.matchAll(/'([a-z0-9-]+)':\s*\{/g)) {
    const inner = objectAt(body, m.index + m[0].length - 1);
    if (inner) out[m[1]] = fields(inner);
  }
  return out;
}

function base(ts, declName) {
  const at = ts.indexOf(declName);
  if (at < 0) return {};
  const chunk = ts.slice(at, at + 8000);
  const out = {};
  for (const m of chunk.matchAll(/id:\s*'([a-z0-9-]+)'/g)) {
    const inner = objectAt(chunk, chunk.lastIndexOf('{', m.index));
    if (inner) out[m[1]] = fields(inner);
  }
  return out;
}

const paths = {
  ts: `${SRC}/content/studio.ts`,
  ov: `${SRC}/public/content-overrides.json`,
};
for (const [name, p] of Object.entries(paths)) {
  if (!existsSync(p)) {
    console.log(`无法读取源项目的 ${name}（${p}）—— 这是本脚本要更新，不是文案出错`);
    process.exitCode = 2;
    break;
  }
}
if (process.exitCode === 2) throw new Error('source unreadable');

const ts = readFileSync(paths.ts, 'utf8');
const overrides = JSON.parse(readFileSync(paths.ov, 'utf8')).locales?.zh ?? {};

const copy = { ...section(ts, 'const introCopy'), ...section(ts, 'const recordsCopy') };
const media = { ...base(ts, 'const introBase'), ...base(ts, 'const recordsBase') };
if (!copy || Object.keys(copy).length < 10) {
  console.log('源项目 studio.ts 的结构和这个脚本预期不一致，读不出方块文案 —— 需要更新脚本，不能判定为文案漂移');
  process.exitCode = 2;
  throw new Error('source schema changed');
}

const drift = [];
const accepted = [];
let rewritten = 0;
/* Known gaps, kept visible instead of being argued away. The number of images
   per block is the one thing here nobody has decided yet: the source has more
   material than this build shows, and whether the club wants the detail sheets
   longer is an editorial call, not a typo. Listed every run so it cannot be
   forgotten, and it does not fail the check. */
const gaps = [];
for (const mine of BLOCKS) {
  const theirs = copy[mine.id];
  const theirsMedia = media[mine.id] ?? {};
  if (!theirs) { drift.push(`${mine.id}：源项目里找不到这个方块`); continue; }
  if (theirs.title && theirs.title !== mine.title.zh) {
    drift.push(`${mine.id} 标题：我「${mine.title.zh}」/ 源「${theirs.title}」`);
  }
  if (theirs.summary && theirs.summary !== mine.summary.zh) {
    /* Every card summary in this build was rewritten shorter, so a summary
       difference is expected and comparing it would only produce 16 lines of
       noise. Counted once, below, rather than per block. */
    rewritten += 1;
  }
  if (theirs.body && mine.body?.zh && theirs.body !== mine.body.zh) {
    const flat = (s) => s.replace(/\s+/g, '');
    if (flat(mine.body.zh) === flat(theirs.body)) {
      const breaks = (s) => s.split('\n').map((p) => p.length).join('+');
      accepted.push(`${mine.id} 正文：字句完全一致，只是断段位置不同（各段长度 我 ${breaks(mine.body.zh)} / 源 ${breaks(theirs.body)}）`);
    } else {
      drift.push(`${mine.id} 正文与源不一致：${firstDiff(mine.body.zh, theirs.body)}`);
    }
  }
  const srcShots = (theirsMedia.galleryCount ?? 0) + (theirsMedia.hasImage ? 1 : 0);
  const myShots = 1 + (mine.gallery?.length ?? 0);
  if (srcShots && srcShots !== myShots) {
    gaps.push(`${mine.id}「${mine.title.zh}」：这版 ${myShots} 张 / 源 ${srcShots} 张`);
  }
}

const srcCaps = [...(/capabilities[^=]*=\s*\{\s*zh:\s*\[([\s\S]*?)\]/.exec(ts)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
if (srcCaps.join('|') !== SITE.zh.capabilities.join('|')) {
  drift.push(`能力标签：我 ${SITE.zh.capabilities.join(' / ')} / 源 ${srcCaps.join(' / ')}`);
}

/* The owner edits copy in the page; those strings win over everything else. */
const hay = BLOCKS.map((b) => `${b.title.zh}\n${b.summary.zh}\n${b.body.zh}\n${(b.items?.zh ?? []).join('\n')}`).join('\n')
  + `\n${SITE.zh.eyebrow}\n${SITE.zh.description}\n`
  + Object.values(SITE.zh.sections ?? {}).map((s) => `${s.label}\n${s.title}\n${s.hint ?? ''}`).join('\n');
const ownerMissing = [];
for (const [path, value] of Object.entries(overrides)) {
  if (UI_ONLY.test(path)) continue;
  const probe = String(value).replace(/\\n/g, '\n').slice(0, 22).trim();
  if (!probe || hay.includes(probe)) continue;
  /* The section/group descriptions belong to the source's three-part index,
     which this layout folded into two bands — record once, not per block. */
  ownerMissing.push(`${path} = ${String(value).slice(0, 30)}…`);
}
if (ownerMissing.length) {
  gaps.push(`用户在页面里改的 ${ownerMissing.length} 条分组/段落文案，这版双段布局没有对应的位置：${ownerMissing.map((m) => '\n     - ' + m).join('')}`);
}

console.log('=== 与源项目文案的比对 ===');
if (rewritten) accepted.push(`${rewritten} 条卡片摘要全部重写为更短的一句（源里 20–30 字，这里 12–18 字），因为方块墙一行放不下；正文、标题、图集说明仍按原文`);
if (gaps.length) console.log(`素材尚未搬全（等作者定夺，不算漂移）：\n  - ${gaps.join('\n  - ')}\n`);
if (accepted.length) console.log('已记录、有意为之：\n  - ' + accepted.join('\n  - ') + '\n');
if (drift.length) {
  console.log('未解释的漂移：');
  drift.forEach((d) => console.log('  ! ' + d));
  process.exitCode = 1;
} else {
  console.log('没有发现未记录的文案漂移。');
}
