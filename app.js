/* ---------------------------------------------------------------------------
   Panda Studio — block index interaction.

   Two states, both driven by body[data-mode]:
     wall   — every block sits in a grid.
     focus  — an overlay sheet covers the wall and shows one block enlarged.
              The wall is never unmounted, so the reader's position in it
              survives a round trip.

   Where the other blocks go differs by width: at >=900px they stay as a
   sticky left column beside the stage; below that they live in a list drawer
   that rises from the bottom, and the sheet ends in a sticky bar offering the
   previous block, the next block by name, and the drawer.
--------------------------------------------------------------------------- */

import { BLOCKS, SITE, groupLabel } from './data.js';

const SPEED = 460;

/* Chinese only. The block data still carries its English strings, but nothing
   reads them and there is no way to switch — see data.js if that copy is ever
   wanted back. */
const state = {
  activeId: null,
  lightbox: null,
};

const root = document.getElementById('app');

const t = (key) => SITE.zh[key];
const pick = (field) => (typeof field === 'object' ? field.zh : field);
const group = (section) => groupLabel(section, 'zh');
const img = (slug, kind = 'lg') => `assets/${slug}${kind === 'sm' ? '.thumb' : ''}.webp`;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const byId = (id) => BLOCKS.find((block) => block.id === id);

/* ------------------------------------------------------------------ markup */

function tileMarkup(block) {
  return `
    <button class="tile" type="button" data-open="${block.id}"
            aria-label="${t('ui').expand(pick(block.title))}">
      <span class="tile-bar">
        <b>${pick(block.code)}</b>
        <span class="tile-x" aria-hidden="true">✕</span>
      </span>
      <span class="tile-media">
        <img src="${img(block.img, 'sm')}" alt="" loading="lazy" decoding="async" />
        <span class="tile-plus" aria-hidden="true">＋</span>
      </span>
      <span class="tile-body">
        <span class="tile-title">${pick(block.title)}</span>
        <span class="tile-summary">${pick(block.summary)}</span>
        <span class="tile-foot">
          <span>${group(block.section)}</span>
          <em>${t('ui').open} →</em>
        </span>
      </span>
    </button>`;
}

const MARKS = '<span></span><span></span><span></span><span></span>';

function wallMarkup() {
  const sections = [
    /* Nine index blocks tile perfectly into three columns; seven records fill
       four, so neither band ends with an orphan. */
    ['index', BLOCKS.filter((b) => b.group === 'index'), '3'],
    ['record', BLOCKS.filter((b) => b.group === 'record'), '4'],
  ];

  return sections
    .map(([key, blocks, cols]) => {
      const section = t('sections')[key === 'index' ? 'index' : 'record'];
      return `
        <section class="section" id="${key === 'index' ? 'intro' : 'records'}"
                 aria-labelledby="section-${key}">
          <div class="marks" aria-hidden="true">${MARKS}</div>
          <div class="section-bar">
            <span>${section.label}</span>
            <span>${String(blocks.length).padStart(2, '0')} ${t('ui').blockUnit}</span>
          </div>
          <div class="shell">
            <div class="section-head">
              <h2 id="section-${key}">${section.title}</h2>
              <p class="hint">${section.hint}</p>
            </div>
            <div class="grid" data-cols="${cols}" role="group" aria-label="${t('ui').grid}">
              ${blocks.map(tileMarkup).join('')}
            </div>
          </div>
        </section>`;
    })
    .join('');
}

function railMarkup(activeId) {
  let lastSection = null;
  return BLOCKS.map((block) => {
    const isCurrent = block.id === activeId;
    const rule =
      block.section !== lastSection
        ? `<p class="rail-rule">${group(block.section)}</p>`
        : '';
    lastSection = block.section;
    return `
      ${rule}
      <button class="rail-item" type="button" data-open="${block.id}"
              ${isCurrent ? 'aria-current="true"' : ''} title="${pick(block.title)}">
        <span class="rail-num">${block.num}</span>
        <span class="rail-title">${pick(block.title)}</span>
      </button>`;
  }).join('');
}

function paragraphs(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
    .join('');
}

function galleryMarkup(block) {
  const shots = [block.img, ...block.gallery];
  if (shots.length < 2) return '';
  const ui = t('ui');
  return `
    <div class="gallery">
      <div class="gallery-head">
        <p class="mono">${ui.gallery}</p>
        <p class="mono">${ui.galleryCount(shots.length)}</p>
      </div>
      <div class="gallery-grid">
        ${shots
          .map(
            (slug, index) => `
          <button class="gallery-item" type="button" data-shot="${index}"
                  aria-label="${ui.openImage(pick(block.title), index + 1)}">
            <img src="${img(slug, 'sm')}" alt="${ui.imageAlt(pick(block.title), index + 1)}"
                 loading="lazy" decoding="async" />
          </button>`,
          )
          .join('')}
      </div>
    </div>`;
}

function stageMarkup(block) {
  const ui = t('ui');
  const index = BLOCKS.indexOf(block);
  const prev = BLOCKS[index - 1];
  const next = BLOCKS[index + 1];
  const chips = [
    group(block.section),
    block.meta ? pick(block.meta) : '',
    block.year || '',
  ].filter(Boolean);

  const items = pick(block.items) || [];

  return `
    <section class="stage" tabindex="-1" aria-label="${ui.detail}: ${pick(block.title)}">
      <div class="stage-bar">
        <button class="ghost" type="button" data-close>
          <span aria-hidden="true">←</span>${ui.back}
        </button>
        <span class="mono">${block.num} / ${String(BLOCKS.length).padStart(2, '0')}</span>
        <span class="stage-nav">
          <button class="stage-btn" type="button" data-step="-1"
                  aria-label="${prev ? ui.prevTo(pick(prev.title)) : ui.previous}"
                  ${prev ? '' : 'disabled'}>‹</button>
          <button class="stage-btn" type="button" data-step="1"
                  aria-label="${next ? ui.nextTo(pick(next.title)) : ui.next}"
                  ${next ? '' : 'disabled'}>›</button>
          <button class="stage-btn" type="button" data-close aria-label="${ui.close}">✕</button>
        </span>
      </div>

      <div class="stage-frame">
        <div class="stage-grid">
          <figure class="stage-media" data-stage-media>
            <img src="${img(block.img)}" alt="${pick(block.title)}" decoding="async" />
          </figure>
          <div class="stage-body">
            <p class="mono">${pick(block.code)}</p>
            <h2 class="stage-title">${pick(block.title)}</h2>
            ${chips.length ? `<ul class="chips">${chips.map((c) => `<li>${c}</li>`).join('')}</ul>` : ''}
            <div class="prose">${paragraphs(pick(block.body))}</div>
            ${
              items.length
                ? `<div class="items">
                     <p class="mono">${ui.highlights}</p>
                     <ol>${items.map((item) => `<li>${item}</li>`).join('')}</ol>
                   </div>`
                : ''
            }
          </div>
        </div>

        ${galleryMarkup(block)}
      </div>
    </section>`;
}

/* The phone-only thumb-zone bar. It names the block each button leads to, so
   moving on never requires going back to the wall first. */
function sheetBarMarkup(block) {
  const ui = t('ui');
  const index = BLOCKS.indexOf(block);
  const prev = BLOCKS[index - 1];
  const next = BLOCKS[index + 1];

  const prevCell = prev
    ? `<button class="bar-cell bar-prev" type="button" data-open="${prev.id}" data-prev
               aria-label="${ui.prevTo(pick(prev.title))}" title="${pick(prev.title)}">
         <span aria-hidden="true">‹</span><span>${prev.num}</span>
       </button>`
    /* A disabled button, not an empty span: a bordered 44px box that does
       nothing reads as a broken control. */
    : `<span class="bar-cell bar-prev bar-prev--off" aria-hidden="true">‹</span>`;

  /* No wrapping at the end: silently looping sixteen blocks hides the fact
     that the reader has reached the bottom of the archive. */
  const mainCell = next
    ? `<button class="bar-cell bar-next" type="button" data-open="${next.id}" data-next
               title="${pick(next.title)}" aria-label="${ui.nextTo(pick(next.title))}">
         <span class="bar-kicker">${ui.nextWord}</span>
         <span class="bar-title">${pick(next.title)}</span>
         <span class="bar-arrow" aria-hidden="true">›</span>
       </button>`
    : `<button class="bar-cell bar-next" type="button" data-end="wall">
         <span class="bar-kicker">${index + 1} / ${BLOCKS.length}</span>
         <span class="bar-title">${ui.backToWallShort}</span>
         <span class="bar-arrow" aria-hidden="true">↩</span>
       </button>`;

  return `
    <nav class="sheet-bar" aria-label="${ui.rail}">
      <div class="shell sheet-bar-inner">
        ${prevCell}
        ${mainCell}
        <button class="bar-cell bar-list" type="button" data-open-list
                aria-controls="rail-list" aria-expanded="false">${ui.listAll}</button>
      </div>
    </nav>`;
}

function railHeadMarkup() {
  const ui = t('ui');
  return `
    <div class="rail-head">
      <div>
        <p class="mono">${ui.listAll}</p>
        <p class="rail-hint">${ui.hintFocus}</p>
      </div>
      <button class="rail-done" type="button" data-list-close>${ui.listClose}</button>
    </div>`;
}

function renderFocus() {
  const block = byId(state.activeId);
  if (!block) return;
  const ui = t('ui');
  const sheet = root.querySelector('.focus');
  /* Stage first in the DOM so Tab runs content → list; on desktop the grid
     places them the other way round visually, leaving that layout untouched. */
  sheet.innerHTML = `
    <p class="sr-only" role="status" aria-live="polite" data-announce></p>
    <div class="shell">
      <div class="focus-inner">
        <div data-stage-slot>${stageMarkup(block)}</div>
        <nav class="rail" id="rail-list" aria-label="${ui.rail}">
          ${railHeadMarkup()}${railMarkup(block.id)}
        </nav>
      </div>
    </div>
    ${sheetBarMarkup(block)}
    <button class="list-backdrop" type="button" data-list-close
            tabindex="-1" aria-label="${ui.listClose}"></button>`;
  centreRail();
}

/* Swapping a block must not rebuild the list: re-creating it would throw away
   the reader's place and re-trigger every entrance transition. */
function renderStageOnly(block) {
  const slot = root.querySelector('[data-stage-slot]');
  if (slot) slot.innerHTML = stageMarkup(block);
}

function updateSheetBar(block) {
  const bar = root.querySelector('.sheet-bar');
  if (bar) bar.outerHTML = sheetBarMarkup(block);
}

function syncRail(id) {
  root.querySelectorAll('.rail-item[aria-current]').forEach((el) => el.removeAttribute('aria-current'));
  root.querySelector(`.rail-item[data-open="${id}"]`)?.setAttribute('aria-current', 'true');
  centreRail();
}

/* Scrolls the list itself rather than calling scrollIntoView, which would also
   scroll every scrollable ancestor and jump the reader's place. */
function centreRail() {
  const rail = root.querySelector('.rail');
  const current = rail?.querySelector('.rail-item[aria-current="true"]');
  if (!current) return;
  const style = getComputedStyle(rail);
  const vertical = style.display === 'grid' || style.flexDirection === 'column';
  if (vertical) {
    rail.scrollTop = Math.max(0, current.offsetTop - rail.clientHeight / 2 + current.offsetHeight / 2);
  } else {
    rail.scrollLeft = Math.max(0, current.offsetLeft - rail.clientWidth / 2 + current.offsetWidth / 2);
  }
}

let listOpener = null;

function openList() {
  if (!state.activeId || document.body.dataset.list === 'open') return;
  listOpener = document.activeElement;
  document.body.dataset.list = 'open';
  centreRail();
  root.querySelector('[data-open-list]')?.setAttribute('aria-expanded', 'true');
  /* Making the stage inert keeps Tab inside the drawer without a hand-rolled
     focus trap. */
  root.querySelector('.stage')?.setAttribute('inert', '');
  root.querySelector('.rail-done')?.focus({ preventScroll: true });
}

function closeList() {
  if (document.body.dataset.list !== 'open') return;
  delete document.body.dataset.list;
  root.querySelector('.stage')?.removeAttribute('inert');
  root.querySelector('[data-open-list]')?.setAttribute('aria-expanded', 'false');
  const back = listOpener?.isConnected ? listOpener : root.querySelector('[data-open-list]');
  back?.focus({ preventScroll: true });
  listOpener = null;
}

function renderChrome() {
  const site = SITE.zh;
  const ui = site.ui;

  root.innerHTML = `
    <header class="site-header">
      <div class="shell">
        <a class="brand" href="#top" aria-label="${ui.brandHome}">
          <img src="assets/brand-icon.webp" alt="" />
          <span class="brand-name">panda studio</span>
        </a>
        <div class="header-tools">
          <a href="#intro">${site.nav.index}</a>
          <a href="#records">${site.nav.record}</a>
        </div>
      </div>
    </header>

    <main id="top">
      <section class="hero">
        <canvas class="hero-cloud" aria-hidden="true"></canvas>
        <div class="shell">
          <div class="hero-copy">
            <p class="mono">${site.eyebrow}</p>
            <h1>${site.title.map((line) => `<span>${line}</span>`).join('')}</h1>
          </div>
          <div class="hero-notes">
            <p>${site.description}</p>
            <ul class="caps" aria-label="共同能力">
              ${site.capabilities.map((cap) => `<li>${cap}</li>`).join('')}
            </ul>
          </div>
          <p class="hero-hint mono">${ui.hintOpen} ↓</p>
        </div>
      </section>

      <div class="wall">${wallMarkup()}</div>

      <div class="focus"></div>
    </main>

    <footer class="site-footer">
      <div class="shell">
        <p class="footer-mark">panda studio</p>
        <div class="footer-row">
          <p>${site.footer.tagline}</p>
          <p>© 2026 PANDA STUDIO</p>
          <a href="#top">${site.footer.backToTop}</a>
        </div>
      </div>
    </footer>`;

  paintCloud();
}

/* ------------------------------------------------------------------ dither */

/* typesafe.ai runs its hero photography through a coarse ordered dither.
   Reproduced here on a canvas so the field is generated rather than copied. */
const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

/* Neutral ramp: the same luminance shape as the original band, with the hue
   removed so nothing on the page is coloured. */
const CLOUD_STOPS = [
  [0, [253, 253, 253]],
  [0.32, [231, 231, 231]],
  [0.56, [138, 138, 138]],
  [0.78, [176, 176, 176]],
  [1, [253, 253, 253]],
];

function paintCloud() {
  const canvas = root.querySelector('.hero-cloud');
  if (!canvas) return;

  /* Low internal resolution: the chunky cells are the point. */
  const scale = 5;
  const width = Math.max(120, Math.round(canvas.clientWidth / scale));
  const height = Math.max(40, Math.round(canvas.clientHeight / scale));
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  for (const [offset, [r, g, b]] of CLOUD_STOPS) {
    gradient.addColorStop(offset, `rgb(${r},${g},${b})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  /* Break the ramp up with a couple of soft lobes before dithering. */
  for (const [cx, cy, radius, tint] of [
    [0.26, 0.42, 0.42, 'rgba(40,40,40,0.55)'],
    [0.68, 0.58, 0.36, 'rgba(255,255,255,0.6)'],
    [0.48, 0.2, 0.3, 'rgba(90,90,90,0.35)'],
  ]) {
    const blob = ctx.createRadialGradient(
      cx * width, cy * height, 0,
      cx * width, cy * height, radius * width,
    );
    blob.addColorStop(0, tint);
    blob.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = blob;
    ctx.fillRect(0, 0, width, height);
  }

  const frame = ctx.getImageData(0, 0, width, height);
  const pixels = frame.data;
  const levels = 5;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      /* Ordered dithering: shift each channel by the Bayer threshold, then
         snap it to one of a few flat levels. */
      const threshold = ((BAYER[y % 8][x % 8] / 64) - 0.5) * (255 / levels);
      for (let c = 0; c < 3; c += 1) {
        const value = pixels[i + c] + threshold;
        pixels[i + c] = Math.round(Math.min(255, Math.max(0, value)) / (255 / levels)) * (255 / levels);
      }
    }
  }

  ctx.putImageData(frame, 0, 0);
}

/* --------------------------------------------------------------- animation */

function rectOf(element) {
  return element.getBoundingClientRect();
}

/** Fly a copy of the block image between two rectangles. */
function fly(from, to, src) {
  if (reduced() || !from || !to || from.width === 0 || to.width === 0) {
    return Promise.resolve();
  }

  const ghost = document.createElement('div');
  ghost.className = 'fly';
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  ghost.style.width = `${from.width}px`;
  ghost.style.height = `${from.height}px`;
  ghost.innerHTML = `<img src="${src}" alt="" />`;
  document.body.appendChild(ghost);

  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  ghost.style.transformOrigin = 'top left';

  return new Promise((resolve) => {
    /* Force a layout flush so the start geometry is committed, then set the
       end transform. This avoids depending on a frame arriving, which does not
       happen while the tab is hidden. */
    void ghost.offsetWidth;
    ghost.style.transition = `transform ${SPEED}ms cubic-bezier(.22,.61,.36,1)`;
    ghost.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;

    const finish = () => {
      ghost.remove();
      resolve();
    };
    ghost.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, SPEED + 120);
  });
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/* requestAnimationFrame stalls while the tab is hidden, so every frame wait
   also has a timer fallback. The interaction must never depend on a frame
   arriving — the animation is decoration, the state change is not. */
const nextFrame = () =>
  new Promise((done) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      done();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 90);
  });

/* ------------------------------------------------------------- state changes */

let busy = false;

/** Can a ghost actually be seen travelling to this box? */
function onScreen(rect) {
  return Boolean(
    rect
    && rect.width > 0
    && rect.bottom > 0
    && rect.top < window.innerHeight
    && rect.right > 0
    && rect.left < window.innerWidth,
  );
}

/* Tear down every transient layer above the sheet. closeBlock used to null the
   lightbox state without removing its node, which left an opaque full-screen
   z-120 sheet over the wall with no way to dismiss it. */
function dismissOverlays() {
  root.querySelector('.lightbox')?.remove();
  delete document.body.dataset.lightbox;
  state.lightbox = null;
  closeList();
  root.querySelector('.focus')?.removeAttribute('inert');
  root.querySelector('.stage')?.removeAttribute('inert');
}

/* Whether the sheet currently owns a history entry. Only then may closing it
   call history.back() — a block opened from a deep link has no in-site entry
   behind it, and going back would leave the site. */
let ownsHistoryEntry = false;

/* The detail sheet is an overlay, not a page swap: the wall stays exactly
   where it was, so no scroll position is ever lost and both ends of the fly
   animation hold still while it runs. */
async function openBlock(id, opener, { push = true } = {}) {
  const block = byId(id);
  if (!block || busy) return;

  const sourceMedia = opener?.closest('.tile')?.querySelector('.tile-media') ?? null;
  const from = sourceMedia ? rectOf(sourceMedia) : null;

  busy = true;
  try {
    dismissOverlays();
    state.activeId = id;
    document.body.dataset.mode = 'focus';
    renderFocus();
    /* A click stacks an entry so Back closes; a deep link or popstate fills the
       entry it already owns. */
    ownsHistoryEntry = push;
    if (push) history.pushState({ pandaBlock: id }, '', `#/b/${id}`);
    else history.replaceState({ pandaBlock: id }, '', `#/b/${id}`);

    const stageMedia = root.querySelector('[data-stage-media]');
    const stageImage = stageMedia?.querySelector('img');
    if (stageImage) stageImage.style.opacity = '0';

    try {
      await nextFrame();
      if (from && stageMedia) await fly(from, rectOf(stageMedia), img(block.img));
      const sheet = root.querySelector('.focus');
      if (sheet) sheet.scrollTop = 0;
      root.querySelector('.stage')?.focus({ preventScroll: true });
    } finally {
      if (stageImage) stageImage.style.opacity = '';
    }
  } finally {
    busy = false;
  }
}

async function closeBlock({ keepHistory = false } = {}) {
  if (busy || !state.activeId) return;
  const block = byId(state.activeId);
  busy = true;

  try {
    const stageMedia = root.querySelector('[data-stage-media]');
    const from = stageMedia ? rectOf(stageMedia) : null;

    dismissOverlays();
    state.activeId = null;
    document.body.dataset.mode = 'wall';
    resume.clear();
    ownsHistoryEntry = false;
    root.querySelector('.focus').innerHTML = '';
    if (!keepHistory) history.replaceState(null, '', location.pathname + location.search);

    /* The wall never moved, so the tile is still where the reader left it.
       Only fly back when that spot is genuinely on screen. */
    const tile = root.querySelector(`.tile[data-open="${block.id}"]`);
    const targetMedia = tile?.querySelector('.tile-media') ?? null;
    const to = targetMedia ? rectOf(targetMedia) : null;
    const canFly = Boolean(from) && onScreen(to);
    const targetImage = targetMedia?.querySelector('img');
    if (canFly && targetImage) targetImage.style.opacity = '0';

    if (canFly) await fly(from, to, img(block.img));
    if (targetImage) targetImage.style.opacity = '';
    tile?.focus({ preventScroll: true });
  } finally {
    busy = false;
  }
}

/** The ✕ and the browser Back button share one path so the history stack stays
   honest — pressing back on a phone closes the block instead of leaving.
   It asks whether this sheet pushed the entry rather than testing the state
   object: a block opened from a deep link carries state but has no in-site
   entry behind it, and going back there leaves the site. */
function requestClose() {
  if (!state.activeId) return;
  if (ownsHistoryEntry) history.back();
  else closeBlock();
}

function step(delta) {
  if (!state.activeId) return;
  const index = BLOCKS.indexOf(byId(state.activeId));
  const next = index + delta;
  if (next < 0 || next >= BLOCKS.length) return;
  switchBlock(BLOCKS[next].id);
}

/* Where the reader stopped on each block, for this visit only. Carrying one
   block's offset straight across would drop a reader past the end of a shorter
   block, so this is a per-block memory rather than a shared scroll value. */
const resume = new Map();

async function switchBlock(id) {
  if (busy || !state.activeId || id === state.activeId) return;
  const block = byId(id);
  if (!block) return;

  const sheet = root.querySelector('.focus');
  if (sheet && sheet.scrollTop > 0) resume.set(state.activeId, sheet.scrollTop);

  /* Without this guard a throw anywhere below latches busy forever, and every
     open/close/switch then returns early — a locked, unclosable overlay. */
  busy = true;
  try {
    state.activeId = id;
    root.querySelector('.lightbox')?.remove();
    delete document.body.dataset.lightbox;
    state.lightbox = null;
    closeList();
    renderStageOnly(block);
    updateSheetBar(block);
    syncRail(id);
    /* Replacing rather than pushing keeps Back leaving the sheet instead of
       walking back through every block visited. */
    history.replaceState({ pandaBlock: id }, '', `#/b/${id}`);

  if (sheet) {
    const limit = Math.max(0, sheet.scrollHeight - sheet.clientHeight);
    sheet.scrollTop = Math.min(resume.get(id) ?? 0, limit);
  }

    const stage = root.querySelector('.stage');
    stage?.focus({ preventScroll: true });
    const announce = root.querySelector('[data-announce]');
    if (announce) announce.textContent = t('ui').announced(block.num, BLOCKS.length, pick(block.title));

    await wait(40);
  } finally {
    busy = false;
  }
}

let lightboxTrigger = null;

function openLightbox(index, trigger = null) {
  const block = byId(state.activeId);
  if (!block) return;

  const shots = [block.img, ...block.gallery];
  const ui = t('ui');
  const total = shots.length;
  /* Clamp first: assigning the raw index let repeated ArrowRight overshoot
     silently, so N wasted presses cost N dead presses on the way back. */
  const clamped = Math.max(0, Math.min(index, total - 1));
  state.lightbox = clamped;
  document.body.dataset.lightbox = 'on';
  if (trigger) lightboxTrigger = trigger;

  let overlay = root.querySelector('.lightbox');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    root.appendChild(overlay);
  }
  overlay.setAttribute('aria-label', `${ui.gallery}: ${pick(block.title)}`);
  /* The lightbox lives on #app, outside .focus, so making the sheet inert
     traps Tab here without a hand-written key handler. */
  root.querySelector('.focus')?.setAttribute('inert', '');
  overlay.innerHTML = `
    <div class="lightbox-bar">
      <span class="mono">${pick(block.title)}</span>
      /* Addressed by name in the tests: nth-child broke the moment a element was
         added to the bar. */
      <span class="mono" data-lb-count>${String(clamped + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span>
      <button class="ghost" type="button" data-lb-close aria-label="${ui.close}">✕</button>
    </div>
    <div class="lightbox-stage">
      <button class="arrow" type="button" data-lb="-1" aria-label="${ui.previous}"
              ${clamped === 0 ? 'disabled' : ''}>←</button>
      <img src="${img(shots[clamped])}"
           alt="${ui.imageAlt(pick(block.title), clamped + 1)}" />
      <button class="arrow" type="button" data-lb="1" aria-label="${ui.next}"
              ${clamped === total - 1 ? 'disabled' : ''}>→</button>
    </div>`;
  overlay.querySelector('[data-lb-close]').focus();
}

function closeLightbox() {
  if (state.lightbox === null) return;
  state.lightbox = null;
  delete document.body.dataset.lightbox;
  root.querySelector('.lightbox')?.remove();
  root.querySelector('.focus')?.removeAttribute('inert');
  /* Return to the thumbnail that was opened, not always the first one. */
  const back = lightboxTrigger?.isConnected ? lightboxTrigger : root.querySelector('.gallery-item');
  back?.focus({ preventScroll: true });
  lightboxTrigger = null;
}

/* -------------------------------------------------------------- event wiring */

root.addEventListener('click', (event) => {
  if (event.target.closest('[data-list-close]')) return closeList();
  if (event.target.closest('[data-close]')) return requestClose();
  if (event.target.closest('[data-open-list]')) return openList();
  if (event.target.closest('[data-end]')) return requestClose();

  /* Step buttons live here as well as on the bottom bar; both route through
     step(), which is the only place the range is checked. */
  const stepper = event.target.closest('[data-step]');
  if (stepper) return step(Number(stepper.dataset.step));

  const shot = event.target.closest('[data-shot]');
  if (shot) return openLightbox(Number(shot.dataset.shot), shot);

  const lb = event.target.closest('[data-lb]');
  if (lb) return openLightbox(state.lightbox + Number(lb.dataset.lb));
  if (event.target.closest('[data-lb-close]')) return closeLightbox();
  /* The bar and the stage fill the flex column, so the .lightbox element
     itself never receives a click — the empty area to dismiss is the stage. */
  if (event.target.closest('.lightbox') && event.target.classList.contains('lightbox-stage')) {
    return closeLightbox();
  }

  const opener = event.target.closest('[data-open]');
  if (!opener) return;

  const id = opener.dataset.open;
  if (document.body.dataset.mode === 'focus') {
    /* Tapping the block you are already on dismisses the list — it must not
       close the whole detail sheet out from under a thumb. */
    if (id === state.activeId) closeList();
    else switchBlock(id);
  } else {
    openBlock(id, opener);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.lightbox !== null) closeLightbox();
    else if (document.body.dataset.list === 'open') closeList();
    else if (state.activeId) requestClose();
    return;
  }

  if (state.lightbox !== null) {
    if (event.key === 'ArrowRight') openLightbox(state.lightbox + 1);
    if (event.key === 'ArrowLeft') openLightbox(state.lightbox - 1);
    return;
  }

  if (state.activeId) {
    /* While the list is open the arrow keys belong to the list's own scroll. */
    if (document.body.dataset.list === 'open') return;
    /* Stepping is horizontal — the list reads left to right — which frees
       ArrowUp/ArrowDown for native scrolling, as they were before. */
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    }
    return;
  }

  /* Roving focus, scoped to the grid the tile is in — otherwise ArrowDown on
     the last index block walks into the records band. */
  const tile = event.target.closest?.('.tile');
  if (!tile || !event.key.startsWith('Arrow')) return;
  const grid = tile.parentElement;
  const tiles = [...grid.querySelectorAll('.tile')];
  const index = tiles.indexOf(tile);
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1;
  const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
  const delta = moves[event.key];
  if (delta === undefined) return;
  const next = index + delta;
  if (next < 0 || next >= tiles.length) return;
  event.preventDefault();
  tiles[next].focus();
});

/* Deep links and Back: #/b/<id> is the single source of truth for the sheet. */
function applyHash() {
  const match = /^#\/b\/(.+)$/.exec(location.hash);
  const id = match ? match[1] : null;
  if (id && byId(id)) {
    if (id !== state.activeId) openBlock(id, null, { push: false });
    return;
  }
  /* A block link for a block that does not exist — a typo, or a block renamed
     after someone bookmarked it — falls back to the wall. Clean the address
     out while doing so: leaving it in place means the dead hash gets shared on,
     bookmarked again, and survives every Back press in the session. */
  if (id) history.replaceState(null, '', location.pathname + location.search);
  if (state.activeId) closeBlock({ keepHistory: true });
}

window.addEventListener('popstate', applyHash);

/* --------------------------------------------------------------- boot */

document.documentElement.lang = 'zh-CN';
renderChrome();
applyHash();

/* The dither is rasterised at a fixed low resolution, so it has to be redrawn
   when the hero changes width. Crossing the 900px line also has to drop the
   drawer: at desktop widths every way out of it (完成, backdrop, 全部方块) is
   display:none, so an open list would leave the stage inert and the title-bar
   controls dead until Escape. */
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (window.innerWidth >= 900 && document.body.dataset.list === 'open') closeList();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(paintCloud, 180);
});
