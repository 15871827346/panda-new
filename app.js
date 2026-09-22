/* ---------------------------------------------------------------------------
   Panda Studio — block index interaction.

   Two states:
     wall   — every block sits in a grid.
     focus  — the chosen block is enlarged in the main stage; every other
              block shrinks into a single vertical column on the left.
--------------------------------------------------------------------------- */

import { BLOCKS, SITE, groupLabel } from './data.js';

const LOCALE_KEY = 'panda.locale';
const SPEED = 460;

const state = {
  locale: localStorage.getItem(LOCALE_KEY) === 'en' ? 'en' : 'zh',
  activeId: null,
  lightbox: null,
};

const root = document.getElementById('app');

/* ?lang=en is a convenience for screenshots and for linking a specific
   language; a stored preference still wins on the next visit. */
const urlLang = new URLSearchParams(location.search).get('lang');
state.locale = urlLang === 'en' || urlLang === 'zh' ? urlLang : state.locale;
const t = (key) => SITE[state.locale][key];
const pick = (field) => (typeof field === 'object' ? field[state.locale] : field);
const img = (slug, kind = 'lg') => `assets/${slug}${kind === 'sm' ? '.thumb' : ''}.webp`;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const byId = (id) => BLOCKS.find((block) => block.id === id);

/* ------------------------------------------------------------------ markup */

function tileMarkup(block) {
  const group = groupLabel(block.section, state.locale);
  return `
    <button class="tile" type="button" data-open="${block.id}"
            aria-label="${t('ui').expand(pick(block.title))}">
      <span class="tile-media">
        <img src="${img(block.img, 'sm')}" alt="" loading="lazy" decoding="async" />
        <span class="tile-plus" aria-hidden="true">＋</span>
      </span>
      <span class="tile-body">
        <span class="tile-top">
          <span>${block.num}</span>
          <span>${group}</span>
        </span>
        <span class="tile-title">${pick(block.title)}</span>
        <span class="tile-summary">${pick(block.summary)}</span>
      </span>
    </button>`;
}

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
          <div class="shell">
            <div class="section-head">
              <div>
                <p class="mono">${section.label}</p>
                <h2 id="section-${key}">${section.title}</h2>
              </div>
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
  return BLOCKS.map((block) => {
    const isCurrent = block.id === activeId;
    return `
      <button class="rail-item" type="button" data-open="${block.id}"
              aria-current="${isCurrent}" title="${pick(block.title)}">
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
  const chips = [
    pick(block.title) ? groupLabel(block.section, state.locale) : '',
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
          <button class="ghost" type="button" data-step="-1" aria-label="${ui.previous}"
                  ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="ghost" type="button" data-step="1" aria-label="${ui.next}"
                  ${index === BLOCKS.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="ghost" type="button" data-close aria-label="${ui.close}">✕</button>
        </span>
      </div>

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
    </section>`;
}

function renderFocus() {
  const block = byId(state.activeId);
  if (!block) return;
  const ui = t('ui');
  root.querySelector('.focus').innerHTML = `
    <div class="shell">
      <div class="focus-inner">
        <nav class="rail" aria-label="${ui.rail}">${railMarkup(block.id)}</nav>
        <div data-stage-slot>${stageMarkup(block)}</div>
      </div>
    </div>`;
}

function renderChrome() {
  const site = SITE[state.locale];
  const ui = site.ui;

  root.innerHTML = `
    <header class="site-header">
      <div class="shell">
        <a class="brand" href="#top" aria-label="${ui.brandHome}">
          <img src="assets/brand-icon.webp" alt="" />
          <span class="brand-name">panda <span>studio</span></span>
        </a>
        <div class="lang" role="group" aria-label="${state.locale === 'zh' ? '切换语言' : 'Switch language'}">
          <button type="button" data-lang="zh" aria-pressed="${state.locale === 'zh'}">中</button>
          <button type="button" data-lang="en" aria-pressed="${state.locale === 'en'}">EN</button>
        </div>
      </div>
    </header>

    <main id="top">
      <section class="hero">
        <div class="shell">
          <p class="mono">${site.eyebrow}</p>
          <h1>${site.title.map((line) => `<span>${line}</span>`).join('')}</h1>
          <div class="hero-notes">
            <p>${site.description}</p>
            <ul class="caps" aria-label="${state.locale === 'zh' ? '共同能力' : 'Shared capabilities'}">
              ${site.capabilities.map((cap) => `<li>${cap}</li>`).join('')}
            </ul>
          </div>
        </div>
      </section>

      <div class="wall">${wallMarkup()}</div>

      <div class="focus"></div>
    </main>

    <footer class="site-footer">
      <div class="shell">
        <p>${site.footer.tagline}</p>
        <p class="mono">© 2026 PANDA STUDIO</p>
        <a href="#top">${site.footer.backToTop}</a>
      </div>
    </footer>`;
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

async function openBlock(id, opener) {
  const block = byId(id);
  if (!block || busy) return;

  const sourceMedia = opener?.closest('.tile')?.querySelector('.tile-media') ?? null;
  const from = sourceMedia ? rectOf(sourceMedia) : null;

  busy = true;
  state.activeId = id;
  state.lightbox = null;
  document.body.dataset.mode = 'focus';
  renderFocus();
  history.replaceState(null, '', `#/b/${id}`);

  const stageMedia = root.querySelector('[data-stage-media]');
  const stageImage = stageMedia?.querySelector('img');
  if (stageImage) stageImage.style.opacity = '0';

  try {
    await nextFrame();
    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    await nextFrame();
    if (from && stageMedia) await fly(from, rectOf(stageMedia), img(block.img));
    root.querySelector('.stage')?.focus({ preventScroll: true });
  } finally {
    if (stageImage) stageImage.style.opacity = '';
    busy = false;
  }
}

async function closeBlock() {
  if (busy || !state.activeId) return;
  const block = byId(state.activeId);
  busy = true;

  try {
    const stageMedia = root.querySelector('[data-stage-media]');
    const from = stageMedia ? rectOf(stageMedia) : null;

    state.activeId = null;
    state.lightbox = null;
    document.body.dataset.mode = 'wall';
    root.querySelector('.focus').innerHTML = '';
    history.replaceState(null, '', location.pathname + location.search);

    /* The tile we came from may be off-screen; bring it into view first so the
       ghost image flies to a rectangle that is actually visible. */
    const tile = root.querySelector(`.tile[data-open="${block.id}"]`);
    if (tile) tile.scrollIntoView({ block: 'center', behavior: 'auto' });
    await nextFrame();

    const targetMedia = tile?.querySelector('.tile-media') ?? null;
    const targetImage = targetMedia?.querySelector('img');
    if (targetImage) targetImage.style.opacity = '0';

    if (from && targetMedia) await fly(from, rectOf(targetMedia), img(block.img));
    tile?.focus({ preventScroll: true });
  } finally {
    busy = false;
  }
}

function step(delta) {
  if (!state.activeId) return;
  const index = BLOCKS.indexOf(byId(state.activeId));
  const next = index + delta;
  if (next < 0 || next >= BLOCKS.length) return;
  openFromRail(BLOCKS[next].id);
}

async function openFromRail(id) {
  if (busy || id === state.activeId) return;
  busy = true;
  state.activeId = id;
  state.lightbox = null;
  renderFocus();
  history.replaceState(null, '', `#/b/${id}`);
  const stage = root.querySelector('.stage');
  stage?.focus({ preventScroll: true });
  await wait(40);
  busy = false;
}

function openLightbox(index) {
  const block = byId(state.activeId);
  if (!block) return;
  state.lightbox = index;
  document.body.dataset.lightbox = 'on';

  const shots = [block.img, ...block.gallery];
  const ui = t('ui');
  const total = shots.length;
  const clamped = Math.max(0, Math.min(index, total - 1));

  let overlay = root.querySelector('.lightbox');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    root.appendChild(overlay);
  }
  overlay.setAttribute('aria-label', `${ui.gallery}: ${pick(block.title)}`);
  overlay.innerHTML = `
    <div class="lightbox-bar">
      <span class="mono">${pick(block.title)}</span>
      <span class="mono">${String(clamped + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span>
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
  root.querySelector('.gallery-item')?.focus({ preventScroll: true });
}

/* -------------------------------------------------------------- event wiring */

root.addEventListener('click', (event) => {
  const lang = event.target.closest('[data-lang]');
  if (lang) {
    state.locale = lang.dataset.lang;
    localStorage.setItem(LOCALE_KEY, state.locale);
    renderChrome();
    if (state.activeId) {
      document.body.dataset.mode = 'focus';
      renderFocus();
    }
    return;
  }

  if (event.target.closest('[data-close]')) return closeBlock();

  const shot = event.target.closest('[data-shot]');
  if (shot) return openLightbox(Number(shot.dataset.shot));

  const lb = event.target.closest('[data-lb]');
  if (lb) return openLightbox(state.lightbox + Number(lb.dataset.lb));
  if (event.target.closest('[data-lb-close]')) return closeLightbox();
  if (event.target === root.querySelector('.lightbox')) return closeLightbox();

  const opener = event.target.closest('[data-open]');
  if (!opener) return;

  const id = opener.dataset.open;
  if (document.body.dataset.mode === 'focus') {
    if (id === state.activeId) closeBlock();
    else openFromRail(id);
  } else {
    openBlock(id, opener);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.lightbox !== null) closeLightbox();
    else if (state.activeId) closeBlock();
    return;
  }

  if (state.lightbox !== null) {
    if (event.key === 'ArrowRight') openLightbox(state.lightbox + 1);
    if (event.key === 'ArrowLeft') openLightbox(state.lightbox - 1);
    return;
  }

  if (state.activeId) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      step(1);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      step(-1);
    }
    return;
  }

  /* Roving focus across the wall using the rendered column count. */
  const tile = event.target.closest?.('.tile');
  if (!tile || !event.key.startsWith('Arrow')) return;
  const tiles = [...root.querySelectorAll('.grid .tile')];
  const index = tiles.indexOf(tile);
  const grid = tile.parentElement;
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1;
  const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
  const delta = moves[event.key];
  if (delta === undefined) return;
  const next = index + delta;
  if (next < 0 || next >= tiles.length) return;
  event.preventDefault();
  tiles[next].focus();
});

/* Deep links: #/b/<id> opens that block on load and keeps Back working. */
function syncFromHash() {
  const match = /^#\/b\/(.+)$/.exec(location.hash);
  const id = match ? match[1] : null;
  if (!byId(id)) return;
  if (id === state.activeId) return;
  state.activeId = id;
  document.body.dataset.mode = 'focus';
  renderFocus();
}

window.addEventListener('hashchange', () => {
  const match = /^#\/b\/(.+)$/.exec(location.hash);
  if (!match) {
    if (state.activeId) {
      state.activeId = null;
      document.body.dataset.mode = 'wall';
      root.querySelector('.focus').innerHTML = '';
    }
    return;
  }
  syncFromHash();
});

/* --------------------------------------------------------------- boot */

document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : 'en';
renderChrome();
syncFromHash();
