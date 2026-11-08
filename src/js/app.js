// Squire — Knick Knack Sack
// Copyright (C) 2026 sirgijoe — GPL-3.0-only. See LICENSE.
import * as db from './db.js';
import { BUILTIN_TEMPLATES, CONDITIONS, FIELD_TYPES, slugKey } from './templates.js';
import { processPhoto, blobUrl, forgetUrl } from './photos.js';
import { esc, renderMarkdown, money, debounce, parseCsv } from './util.js';
import * as ex from './export.js';
import { saveFile, openHtml, isTauri, isDesktopApp, invoke } from './platform.js';
import { createSync } from './sync.js';
import { recordPrice, historyHtml, collectionValueSeries, sparkline } from './value.js';
import { labelSheet, LABEL_SIZES, parseLabelCode } from './labels.js';
import { autoMap, rowsToItems, planImport, BASE_TARGETS } from './csvimport.js';
import { qrSvg } from './qr.js';

export const VERSION = '0.3.0';
const ISSUES = 'https://github.com/sirgijoe/squire-sack/issues/new/choose';

// ---------------------------------------------------------------- state
const S = {
  templates: [], tplById: {}, items: [], q: '', limit: 150, visible: [],
  prefs: loadPrefs(),
};
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');

function loadPrefs() {
  const def = { layout: 'grid', sort: 'newest', group: 'none', f: { tpl: '', cond: '', loc: '', tag: '', listed: '', fk: '', fv: '' }, path: '', collapsed: {} };
  try { return { ...def, ...JSON.parse(localStorage.getItem('squire.prefs') || '{}') }; } catch { return def; }
}
function savePrefs() { try { localStorage.setItem('squire.prefs', JSON.stringify(S.prefs)); } catch { /* private mode */ } }

async function loadTemplates() {
  const custom = await db.getAll('templates');
  S.templates = [...BUILTIN_TEMPLATES, ...custom.filter((t) => !t.deleted).sort((a, b) => a.name.localeCompare(b.name))];
  S.tplById = Object.fromEntries(S.templates.map((t) => [t.id, t]));
}
async function loadItems() { S.items = (await db.getAll('items')).filter((i) => !i.deleted); await ensureSacks(); }

// ---------------------------------------------------------------- Sacks (separate collections)
const DEFAULT_SACK = 'sack-default';
async function ensureSacks() {
  let sacks = await db.getMeta('sacks', null);
  let changed = false;
  if (!Array.isArray(sacks) || !sacks.length) { sacks = [{ id: DEFAULT_SACK, name: 'My Sack', icon: '👜' }]; changed = true; }
  // any item pointing at an unknown Sack (e.g. after restoring a backup) gets a Sack so it never disappears
  for (const it of S.items) {
    if (!it.sackId) it.sackId = DEFAULT_SACK;
    if (!sacks.some((k) => k.id === it.sackId)) {
      sacks.push({ id: it.sackId, name: it.sackId === DEFAULT_SACK ? 'My Sack' : 'Restored Sack', icon: '👜' }); changed = true;
    }
  }
  if (changed) await db.setMeta('sacks', sacks);
  S.sacks = sacks;
  if (S.prefs.sack && !sacks.some((k) => k.id === S.prefs.sack)) { S.prefs.sack = ''; savePrefs(); }
}
const sackOf = (id) => S.sacks.find((k) => k.id === (id || DEFAULT_SACK)) || S.sacks[0];
const currentSack = () => (S.prefs.sack ? sackOf(S.prefs.sack) : null);
const sackCount = (id) => S.items.filter((i) => (i.sackId || DEFAULT_SACK) === id).length;

function openSackSwitcher() {
  const cur = S.prefs.sack;
  const p = openSheet(`<h2>Your Sacks</h2>
    <div class="tpl-list">
      <a class="tile ${!cur ? 'on' : ''}" data-s=""><span class="ico">🎒</span><div class="grow"><div class="nm">All Sacks</div><div class="sub">${S.items.length} item${S.items.length === 1 ? '' : 's'}</div></div>${!cur ? '<span>✓</span>' : ''}</a>
      ${S.sacks.map((k) => `<div class="tile" data-s="${esc(k.id)}"><span class="ico">${esc(k.icon || '👜')}</span>
        <div class="grow"><div class="nm">${esc(k.name)}</div><div class="sub">${sackCount(k.id)} item${sackCount(k.id) === 1 ? '' : 's'}</div></div>
        ${k.id === cur ? '<span>✓</span>' : ''}<button class="icon-btn" data-edit="${esc(k.id)}" aria-label="Edit ${esc(k.name)}" style="color:var(--muted)">✏️</button></div>`).join('')}
    </div>
    <button class="btn primary block" id="newSack">＋ New Sack</button>`);
  p.onclick = (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { e.stopPropagation(); editSack(ed.dataset.edit); return; }
    const t = e.target.closest('[data-s]');
    if (t) { S.prefs.sack = t.dataset.s; S.prefs.path = ''; S.limit = 150; savePrefs(); closeSheet(); location.hash === '#/' || !location.hash ? renderSack() : (location.hash = '#/'); }
  };
  $('#newSack', p).onclick = () => editSack(null);
}

function editSack(id) {
  const k = id ? sackOf(id) : { id: db.uid(), name: '', icon: '👜' };
  const n = id ? sackCount(id) : 0;
  const others = S.sacks.filter((x) => x.id !== k.id);
  const p = openSheet(`<h2>${id ? 'Edit Sack' : 'New Sack'}</h2>
    <div class="row"><label class="field" style="width:84px"><span>Icon</span><input type="text" id="sIcon" value="${esc(k.icon)}" maxlength="4" style="text-align:center;font-size:22px"></label>
    <label class="field grow"><span>Name</span><input type="text" id="sName" value="${esc(k.name)}" placeholder="e.g. Miranda's Molds"></label></div>
    <div class="row"><button class="btn grow" id="sCancel">Cancel</button><button class="btn primary grow" id="sSave">Save</button></div>
    ${id && others.length ? `<hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      ${n ? `<label class="field"><span>Move its ${n} item${n > 1 ? 's' : ''} to</span><select id="sMoveTo">${others.map((o) => `<option value="${esc(o.id)}">${esc(o.icon)} ${esc(o.name)}</option>`).join('')}</select></label>` : ''}
      <button class="btn danger block" id="sDel">🗑 Delete this Sack${n ? ' (items are moved, not deleted)' : ''}</button>` : ''}`);
  $('#sName', p).focus();
  $('#sCancel', p).onclick = openSackSwitcher;
  $('#sSave', p).onclick = async () => {
    k.name = $('#sName', p).value.trim(); k.icon = $('#sIcon', p).value.trim() || '👜';
    if (!k.name) { toast('Give the Sack a name'); return; }
    const list = id ? S.sacks.map((x) => (x.id === k.id ? k : x)) : [...S.sacks, k];
    await db.setMeta('sacks', list); S.sacks = list; queueSync();
    if (!id) { S.prefs.sack = k.id; S.prefs.path = ''; savePrefs(); }
    closeSheet(); toast(id ? 'Sack saved' : `“${k.name}” created`);
    route();
  };
  $('#sDel', p)?.addEventListener('click', async () => {
    const to = $('#sMoveTo', p)?.value;
    if (!(await confirmSheet(`Delete Sack “${k.name}”?${n ? ` Its ${n} item(s) move to “${sackOf(to).name}”.` : ''}`, 'Delete Sack', true))) return;
    for (const it of S.items.filter((i) => (i.sackId || DEFAULT_SACK) === k.id)) { it.sackId = to; await db.put('items', it); }
    const list = S.sacks.filter((x) => x.id !== k.id);
    await db.setMeta('sacks', list); S.sacks = list;
    if (S.prefs.sack === k.id) { S.prefs.sack = ''; savePrefs(); }
    await loadItems(); toast('Sack deleted'); route();
  });
}
const tplOf = (item) => S.tplById[item.templateId] || { id: item.templateId, name: 'Unknown template', icon: '❔', fields: [] };

// ---------------------------------------------------------------- chrome helpers
function chrome({ title, back = false, nav = '', actions = [], switcher = false }) {
  const tEl = $('#title');
  tEl.innerHTML = (switcher ? `<button class="title-btn" id="sackBtn">${esc(title)} <span class="caret">▾</span></button>` : esc(title)) + (switcher ? ' <span class="beta-pill">BETA</span>' : '');
  if (switcher) $('#sackBtn').onclick = openSackSwitcher;
  $('#backBtn').hidden = !back;
  const box = $('#topActions');
  box.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'icon-btn'; b.textContent = a.icon; b.title = a.label; b.setAttribute('aria-label', a.label);
    b.onclick = a.onClick;
    box.appendChild(b);
  }
  $$('.bottomnav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
  document.title = `${title} · Squire`;
}
$('#backBtn').onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/'));

let toastTimer;
export function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function openSheet(html) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="panel" role="dialog" aria-modal="true">${html}</div>`;
  sh.hidden = false;
  sh.onclick = (e) => { if (e.target === sh) closeSheet(); };
  return $('.panel', sh);
}
function closeSheet() { const sh = $('#sheet'); sh.hidden = true; sh.innerHTML = ''; }

function confirmSheet(message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    const p = openSheet(`<p>${esc(message)}</p><div class="row"><button class="btn grow" data-x="no">Cancel</button>
      <button class="btn grow ${danger ? 'danger' : 'primary'}" data-x="yes">${esc(okLabel)}</button></div>`);
    p.onclick = (e) => { const x = e.target.dataset.x; if (x) { closeSheet(); resolve(x === 'yes'); } };
  });
}

function pickFile(accept, { multiple = false, capture = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    if (capture) inp.setAttribute('capture', 'environment');
    inp.onchange = () => resolve([...inp.files]);
    inp.click();
  });
}

// ---------------------------------------------------------------- router
async function route() {
  closeSheet(); closeViewer();
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const parts = path.split('/').filter(Boolean);
  const query = new URLSearchParams(qs || '');
  view.innerHTML = '';
  window.scrollTo(0, 0);
  try {
    switch (parts[0]) {
      case undefined: return renderSack();
      case 'item': return renderItem(parts[1]);
      case 'edit': return renderEdit(parts[1]);
      case 'new': return query.get('tpl') || query.get('from') ? renderEdit(null, query) : renderPickTemplate();
      case 'templates': return renderTemplates();
      case 'template': return renderTemplateEditor(parts[1]);
      case 'more': return renderMore();
      case 'sku': return openBySku(decodeURIComponent(parts.slice(1).join('/')));
      case 'pair': return renderPair(query);
      case 'import': return renderImport();
      case 'sync': return renderSync();
      default: location.hash = '#/';
    }
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(err.message)}</p></div>`;
  }
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- the Sack (album)
const SORTS = [
  ['newest', 'Newest first'], ['oldest', 'Oldest first'], ['name', 'Name A–Z'], ['name-desc', 'Name Z–A'],
  ['price-desc', 'Price high–low'], ['price', 'Price low–high'], ['qty-desc', 'Quantity'], ['condition', 'Condition'],
  ['location', 'Location'], ['sku', 'SKU'],
];
const GROUPS = [['none', 'No grouping'], ['template', 'Group: template'], ['condition', 'Group: condition'], ['location', 'Group: location'], ['collection', 'Group: collection'], ['tag', 'Group: tag']];

function fieldVal(item, key) {
  if (key.startsWith('f:')) return item.fields?.[key.slice(2)];
  return item[key];
}

function computeVisible() {
  const { f, path } = S.prefs;
  const q = S.q.trim().toLowerCase();
  const words = q ? q.split(/\s+/) : [];
  let list = S.items.filter((it) => {
    if (S.prefs.sack && (it.sackId || DEFAULT_SACK) !== S.prefs.sack) return false;
    if (f.tpl && it.templateId !== f.tpl) return false;
    if (f.cond && it.condition !== f.cond) return false;
    if (f.loc && (it.location || '') !== f.loc) return false;
    if (f.tag && !(it.tags || []).includes(f.tag)) return false;
    if (f.listed === 'yes' && it.listOnline === false) return false;
    if (f.listed === 'no' && it.listOnline !== false) return false;
    if (f.tpl && f.fk && f.fv) {
      const v = String(it.fields?.[f.fk] ?? '').toLowerCase();
      if (!v.includes(f.fv.toLowerCase())) return false;
    }
    if (path) {
      const c = it.collection || '';
      if (c !== path && !c.startsWith(path + '/')) return false;
    }
    if (words.length) {
      const hay = [it.name, it.sku, it.description, it.location, it.collection, it.condition, ...(it.tags || []),
        ...Object.values(it.fields || {}), tplOf(it).name].join(' ').toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });

  const s = S.prefs.sort;
  const num = (v) => (v === '' || v == null || isNaN(v) ? -Infinity : Number(v));
  const str = (v) => String(v ?? '').toLowerCase();
  const cmp = {
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    name: (a, b) => str(a.name).localeCompare(str(b.name), undefined, { numeric: true }),
    'name-desc': (a, b) => str(b.name).localeCompare(str(a.name), undefined, { numeric: true }),
    'price-desc': (a, b) => num(b.price) - num(a.price),
    price: (a, b) => num(a.price) - num(b.price),
    'qty-desc': (a, b) => num(b.quantity) - num(a.quantity),
    condition: (a, b) => CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition),
    location: (a, b) => str(a.location).localeCompare(str(b.location), undefined, { numeric: true }),
    sku: (a, b) => str(a.sku).localeCompare(str(b.sku), undefined, { numeric: true }),
  }[s] || ((a, b) => {
    const va = fieldVal(a, s), vb = fieldVal(b, s);
    if (!isNaN(va) && !isNaN(vb) && va !== '' && vb !== '') return Number(va) - Number(vb);
    return str(va).localeCompare(str(vb), undefined, { numeric: true });
  });
  list.sort(cmp);
  return list;
}

function groupKey(item) {
  const g = S.prefs.group;
  if (g === 'template') { const t = tplOf(item); return `${t.icon} ${t.name}`; }
  if (g === 'condition') return item.condition || 'No condition set';
  if (g === 'location') return item.location || 'No location';
  if (g === 'collection') return item.collection || 'Not in a collection';
  if (g === 'tag') return (item.tags || [])[0] || 'No tags';
  if (g.startsWith('f:')) { const v = fieldVal(item, g); return v === '' || v == null ? '—' : (v === true ? 'Yes' : v === false ? 'No' : String(v)); }
  return '';
}

function distinct(key) {
  const set = new Set();
  for (const it of S.items) {
    if (key === 'tags') (it.tags || []).forEach((t) => set.add(t));
    else if (it[key]) set.add(it[key]);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function activeFilterCount() {
  const f = S.prefs.f;
  return ['tpl', 'cond', 'loc', 'tag', 'listed'].filter((k) => f[k]).length + (f.fk && f.fv ? 1 : 0);
}

function renderSack() {
  const cs = currentSack();
  chrome({ title: cs ? `${cs.icon} ${cs.name}` : (S.sacks.length > 1 ? '🎒 All Sacks' : 'The Sack'), nav: 'sack', switcher: true,
    actions: [{ icon: '📷', label: 'Scan a label', onClick: openScanner }, { icon: '⬇️', label: 'Export', onClick: () => (location.hash = '#/more') }] });
  const p = S.prefs;
  const tpl = p.f.tpl ? S.tplById[p.f.tpl] : null;
  const fieldSorts = tpl ? tpl.fields.map((f) => [`f:${f.key}`, `Sort: ${f.label}`]) : [];
  const fieldGroups = tpl ? tpl.fields.filter((f) => f.type !== 'longtext').map((f) => [`f:${f.key}`, `Group: ${f.label}`]) : [];
  if (![...SORTS, ...fieldSorts].some(([k]) => k === p.sort)) p.sort = 'newest';
  if (![...GROUPS, ...fieldGroups].some(([k]) => k === p.group)) p.group = 'none';
  const nf = activeFilterCount();
  const layoutIcon = { grid: '▦ Grid', list: '☰ List', cards: '▤ Cards' }[p.layout];

  view.innerHTML = `
    <div class="searchbar"><input type="search" id="q" placeholder="Search the Sack…" value="${esc(S.q)}" autocomplete="off"></div>
    <div class="controls">
      <button class="chip ${nf ? 'on' : ''}" id="filterBtn">⛃ Filter${nf ? ` (${nf})` : ''}</button>
      <select id="sortSel" aria-label="Sort">${[...SORTS, ...fieldSorts].map(([k, l]) => `<option value="${k}" ${k === p.sort ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <select id="groupSel" aria-label="Group">${[...GROUPS, ...fieldGroups].map(([k, l]) => `<option value="${k}" ${k === p.group ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <button class="chip" id="layoutBtn">${layoutIcon}</button>
    </div>
    ${S.prefs.betaSeen ? '' : `<div class="beta-note"><b>Squire is in beta.</b> Your Sack lives on this device unless you sync it with the desktop home base, so make a backup now and then (More → Backup).
      <a href="${ISSUES}" target="_blank" rel="noopener">Report a bug</a><button class="icon-btn" id="betaX" aria-label="Dismiss">✕</button></div>`}
    <div class="crumbs" id="crumbs"></div>
    <div class="count" id="count"></div>
    <div id="album"></div>`;

  $('#q').oninput = debounce((e) => { S.q = e.target.value; S.limit = 150; renderAlbum(); }, 150);
  $('#sortSel').onchange = (e) => { p.sort = e.target.value; savePrefs(); renderAlbum(); };
  $('#groupSel').onchange = (e) => { p.group = e.target.value; savePrefs(); renderAlbum(); };
  $('#layoutBtn').onclick = () => {
    p.layout = { grid: 'list', list: 'cards', cards: 'grid' }[p.layout]; savePrefs(); renderSack();
  };
  $('#filterBtn').onclick = openFilterSheet;
  $('#betaX')?.addEventListener('click', () => { S.prefs.betaSeen = true; savePrefs(); $('.beta-note')?.remove(); });
  renderAlbum();
}

function renderCrumbs() {
  const path = S.prefs.path;
  const box = $('#crumbs');
  if (!box) return;
  const all = distinct('collection');
  const children = new Set();
  for (const c of all) {
    if (path && !c.startsWith(path + '/')) continue;
    const rest = path ? c.slice(path.length + 1) : c;
    if (rest) children.add(rest.split('/')[0]);
  }
  if (!all.length) { box.innerHTML = ''; return; }
  const segs = path ? path.split('/') : [];
  let html = `<a class="chip ${!path ? 'on' : ''}" data-path="">👜 All</a>`;
  segs.forEach((s, i) => { const pth = segs.slice(0, i + 1).join('/'); html += `<a class="chip ${pth === path ? 'on' : ''}" data-path="${esc(pth)}">› ${esc(s)}</a>`; });
  [...children].sort().forEach((c) => { html += `<a class="chip" data-path="${esc(path ? path + '/' + c : c)}">📁 ${esc(c)}</a>`; });
  box.innerHTML = html;
  box.onclick = (e) => {
    const a = e.target.closest('[data-path]');
    if (!a) return;
    S.prefs.path = a.dataset.path; S.limit = 150; savePrefs(); renderAlbum();
  };
}

let thumbObserver, moreObserver;
function renderAlbum() {
  renderCrumbs();
  const list = computeVisible();
  S.visible = list;
  const album = $('#album');
  const inSack = S.prefs.sack ? sackCount(S.prefs.sack) : S.items.length;
  $('#count').textContent = `${list.length} of ${inSack} item${inSack === 1 ? '' : 's'}`;

  if (!S.items.length || (S.prefs.sack && !sackCount(S.prefs.sack))) {
    album.innerHTML = `<div class="empty"><div class="big">👜</div><h2>${esc(currentSack()?.name || 'Your Sack')} is empty</h2>
      <p>Tap <b>＋ Add</b> to catalog your first item.<br>Pick a template like Ceramic Molds, Coins or Trading Cards.</p>
      <a class="btn primary" href="#/new">＋ Add first item</a></div>`;
    return;
  }
  if (!list.length) { album.innerHTML = `<div class="empty"><div class="big">🔍</div><p>Nothing matches. Try clearing the search or filters.</p></div>`; return; }

  const shown = list.slice(0, S.limit);
  const groups = new Map();
  for (const it of shown) {
    const k = groupKey(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const totals = new Map();
  if (S.prefs.group !== 'none') for (const it of list) { const k = groupKey(it); totals.set(k, (totals.get(k) || 0) + 1); }

  let html = '';
  for (const [k, items] of groups) {
    const collapsed = S.prefs.collapsed[k];
    html += `<section class="group ${collapsed ? 'collapsed' : ''}">`;
    if (S.prefs.group !== 'none') html += `<h3 class="group-title" data-g="${esc(k)}"><span>${collapsed ? '▸' : '▾'} ${esc(k)}</span><span class="n">${totals.get(k)}</span></h3>`;
    html += `<div class="items ${S.prefs.layout}">${items.map(tileHtml).join('')}</div></section>`;
  }
  if (list.length > S.limit) html += `<div class="sentinel" id="more"></div><p class="muted small" style="text-align:center">Loading more…</p>`;
  album.innerHTML = html;

  album.onclick = (e) => {
    const g = e.target.closest('.group-title');
    if (g) { const k = g.dataset.g; S.prefs.collapsed[k] = !S.prefs.collapsed[k]; savePrefs(); renderAlbum(); }
  };

  // lazy thumbnails
  thumbObserver?.disconnect();
  thumbObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const img = en.target; thumbObserver.unobserve(img);
      db.get('photos', img.dataset.pid).then((p) => { if (p && (p.thumb || p.full)) img.src = blobUrl('t:' + p.id, p.thumb || p.full); });
    }
  }, { rootMargin: '400px' });
  $$('img[data-pid]', album).forEach((i) => thumbObserver.observe(i));

  moreObserver?.disconnect();
  const sent = $('#more');
  if (sent) {
    moreObserver = new IntersectionObserver((en) => { if (en[0].isIntersecting) { S.limit += 150; renderAlbum(); } }, { rootMargin: '600px' });
    moreObserver.observe(sent);
  }
}

function tileHtml(it) {
  const t = tplOf(it);
  const pid = it.photoIds?.[0];
  const ph = pid ? `<img data-pid="${esc(pid)}" alt="">` : `<span>${t.icon || '📦'}</span>`;
  const qty = Number(it.quantity ?? 1);
  const sub = [it.sku, it.condition].filter(Boolean).join(' · ');
  const price = it.price !== '' && it.price != null ? `<span class="price">${money(it.price)}</span>` : '';
  if (S.prefs.layout === 'list') {
    return `<a class="tile" href="#/item/${it.id}"><div class="ph">${ph}</div><div class="meta">
      <div class="nm">${esc(it.name)}</div><div class="sub">${esc(t.name)}${it.location ? ' · 📍' + esc(it.location) : ''}</div>
      <div class="sub">${esc(sub)} ${qty !== 1 ? `· ×${qty}` : ''} ${price}</div></div></a>`;
  }
  if (S.prefs.layout === 'cards') {
    const kv = t.fields.map((f) => [f.label, it.fields?.[f.key], f]).filter(([, v, f]) => v !== '' && v != null && f.type !== 'longtext').slice(0, 4)
      .map(([l, v, f]) => `<div><b>${esc(l)}:</b> ${esc(f.type === 'yesno' ? (v ? 'Yes' : 'No') : v)}</div>`).join('');
    return `<a class="tile" href="#/item/${it.id}"><div class="ph">${ph}</div><div class="meta">
      <div class="nm">${esc(it.name)}</div><div class="sub">${t.icon} ${esc(t.name)} ${sub ? '· ' + esc(sub) : ''}</div>
      <div class="kv">${kv}</div><div class="row" style="margin-top:6px">${price}<span class="grow"></span>${qty !== 1 ? `<span class="badge">×${qty}</span>` : ''}${it.location ? `<span class="badge">📍${esc(it.location)}</span>` : ''}</div></div></a>`;
  }
  return `<a class="tile" href="#/item/${it.id}"><div class="ph">${ph}</div><div class="meta">
    <div class="nm">${esc(it.name)}</div><div class="sub">${price || esc(sub) || '&nbsp;'}</div></div></a>`;
}

function openFilterSheet() {
  const f = S.prefs.f;
  const tpl = f.tpl ? S.tplById[f.tpl] : null;
  const opt = (vals, cur, all = 'Any') => `<option value="">${all}</option>` + vals.map((v) => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const usedTpls = S.templates.filter((t) => S.items.some((i) => i.templateId === t.id));
  const p = openSheet(`<h2>Filter</h2>
    <label class="field"><span>Template</span><select id="fTpl"><option value="">Any</option>${usedTpls.map((t) => `<option value="${t.id}" ${t.id === f.tpl ? 'selected' : ''}>${t.icon} ${esc(t.name)}</option>`).join('')}</select></label>
    ${tpl ? `<div class="grid2"><label class="field"><span>${esc(tpl.name)} field</span><select id="fFk"><option value="">—</option>${tpl.fields.map((x) => `<option value="${x.key}" ${x.key === f.fk ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
      <label class="field"><span>contains</span><input type="text" id="fFv" value="${esc(f.fv)}"></label></div>` : ''}
    <div class="grid2">
      <label class="field"><span>Condition</span><select id="fCond">${opt(CONDITIONS, f.cond)}</select></label>
      <label class="field"><span>Location</span><select id="fLoc">${opt(distinct('location'), f.loc)}</select></label>
      <label class="field"><span>Tag</span><select id="fTag">${opt(distinct('tags'), f.tag)}</select></label>
      <label class="field"><span>Listed in shop</span><select id="fListed"><option value="">Any</option><option value="yes" ${f.listed === 'yes' ? 'selected' : ''}>Yes</option><option value="no" ${f.listed === 'no' ? 'selected' : ''}>No</option></select></label>
    </div>
    <div class="row"><button class="btn grow" id="fClear">Clear all</button><button class="btn primary grow" id="fApply">Show results</button></div>`);
  $('#fTpl', p).onchange = (e) => { f.tpl = e.target.value; f.fk = ''; f.fv = ''; savePrefs(); openFilterSheet(); };
  $('#fClear', p).onclick = () => { S.prefs.f = { tpl: '', cond: '', loc: '', tag: '', listed: '', fk: '', fv: '' }; savePrefs(); closeSheet(); renderSack(); };
  $('#fApply', p).onclick = () => {
    f.cond = $('#fCond', p).value; f.loc = $('#fLoc', p).value; f.tag = $('#fTag', p).value; f.listed = $('#fListed', p).value;
    if (tpl) { f.fk = $('#fFk', p).value; f.fv = $('#fFv', p).value.trim(); }
    S.limit = 150; savePrefs(); closeSheet(); renderSack();
  };
}

// ---------------------------------------------------------------- item detail
async function renderItem(id) {
  const it = await db.get('items', id);
  if (!it || it.deleted) { toast('Item not found'); location.hash = '#/'; return; }
  const t = tplOf(it);
  chrome({
    title: it.name, back: true, nav: 'sack',
    actions: [{ icon: '✏️', label: 'Edit', onClick: () => (location.hash = `#/edit/${id}`) }],
  });
  const photos = (await Promise.all((it.photoIds || []).map((pid) => db.get('photos', pid)))).filter((p) => p && !p.deleted && (p.full || p.thumb));

  const fmt = (f, v) => (f.type === 'yesno' ? (v ? 'Yes' : 'No') : f.type === 'currency' ? money(v) : f.type === 'rating' ? '★'.repeat(Number(v) || 0) : f.type === 'url' ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(v));
  const tplRows = t.fields.filter((f) => it.fields?.[f.key] !== '' && it.fields?.[f.key] != null)
    .map((f) => `<dt>${esc(f.label)}</dt><dd>${f.type === 'longtext' ? renderMarkdown(it.fields[f.key]) : fmt(f, it.fields[f.key])}</dd>`).join('');
  const base = [
    ...(S.sacks.length > 1 ? [['Sack', `${esc(sackOf(it.sackId).icon)} ${esc(sackOf(it.sackId).name)}`]] : []),
    ['SKU', esc(it.sku)], ['Quantity', esc(it.quantity ?? 1)], ['Condition', esc(it.condition)], ['Location', esc(it.location)],
    ['Collection', esc(it.collection)], ['Cost', money(it.cost)], ['Price', money(it.price)],
    ['Tags', (it.tags || []).map((x) => `<span class="badge">${esc(x)}</span>`).join('')],
    ['List in shop', it.listOnline === false ? 'No' : 'Yes'], ['Shop category', esc(it.wooCategory)],
  ].filter(([, v]) => v !== '' && v != null).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  view.innerHTML = `
    ${photos.length ? `<div class="gallery"><div class="track">${photos.map((p, i) => `<div class="slide" data-i="${i}">${photoImg(p, it.name)}</div>`).join('')}</div>
      ${photos.length > 1 ? `<div class="dots">${photos.map((_, i) => `<span class="${i ? '' : 'on'}"></span>`).join('')}</div>` : ''}</div>
      <div class="caption" id="cap">${esc(photos[0].caption || '')}</div>` : ''}
    <div class="card"><h2>${esc(it.name)}</h2><p class="muted small" style="margin:-4px 0 10px">${t.icon} ${esc(t.name)}</p>
      <dl class="kv">${tplRows}</dl></div>
    ${it.description ? `<div class="card desc"><h2>Description</h2>${renderMarkdown(it.description)}</div>` : ''}
    ${historyHtml(it)}
    <div class="card"><dl class="kv">${base}</dl>
      <p class="muted small" style="margin:10px 0 0">Added ${new Date(it.createdAt).toLocaleDateString()} · Updated ${new Date(it.updatedAt).toLocaleDateString()}</p></div>
    <div class="row" style="margin-bottom:16px">
      <a class="btn primary grow" href="#/edit/${id}">✏️ Edit</a>
      <a class="btn grow" href="#/new?from=${id}">⧉ Add similar</a>
      <button class="btn" id="lblBtn" title="Print a QR label">🏷</button>
      <button class="btn danger" id="delBtn">🗑 Delete</button>
    </div>`;

  const track = $('.track', view);
  if (track) {
    track.addEventListener('scroll', debounce(() => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      $$('.dots span', view).forEach((d, j) => d.classList.toggle('on', j === i));
      $('#cap').textContent = photos[i]?.caption || '';
    }, 60));
    track.onclick = (e) => { const s = e.target.closest('.slide'); if (s) openViewer(photos, +s.dataset.i); };
  }
  $('#lblBtn').onclick = () => openLabelSheet([it]);
  $('#delBtn').onclick = async () => {
    if (!(await confirmSheet(`Delete “${it.name}” and its ${photos.length} photo(s)? This can't be undone.`, 'Delete', true))) return;
    await deleteItem(it);
    toast('Deleted');
    location.hash = '#/';
  };
}

async function deleteItem(it) {
  // tombstones (not hard deletes) so synced devices learn about the delete too
  for (const pid of it.photoIds || []) { await db.softDelete('photos', pid, { itemId: it.id }); forgetUrl('t:' + pid); forgetUrl('f:' + pid); }
  await db.softDelete('items', it.id, { sackId: it.sackId, templateId: it.templateId, createdAt: it.createdAt });
  await loadItems();
  queueSync();
}

// ---------------------------------------------------------------- template picker for new items
function renderPickTemplate() {
  chrome({ title: 'Add to the Sack', nav: 'new' });
  const recent = S.prefs.lastTpl ? S.tplById[S.prefs.lastTpl] : null;
  view.innerHTML = `
    ${recent ? `<a class="btn accent block" style="margin-bottom:12px" href="#/new?tpl=${recent.id}">${recent.icon} Add another ${esc(recent.name)} item</a>` : ''}
    <p class="muted">What are you adding?</p>
    <div class="tpl-list">${S.templates.map((t) => `<a class="tile" href="#/new?tpl=${t.id}"><span class="ico">${t.icon || '📦'}</span>
      <div class="grow"><div class="nm">${esc(t.name)}</div><div class="sub">${t.fields.slice(0, 4).map((f) => esc(f.label)).join(' · ')}</div></div><span>›</span></a>`).join('')}</div>
    <a class="btn block" href="#/template/new">＋ Make a custom template</a>`;
}

// ---------------------------------------------------------------- add / edit item
async function renderEdit(id, query = new URLSearchParams()) {
  let item;
  const isNew = !id;
  if (isNew) {
    const from = query.get('from') ? await db.get('items', query.get('from')) : null;
    let carry = {};
    try { carry = query.get('next') ? JSON.parse(sessionStorage.getItem('squire.carry') || '{}') : {}; } catch { /* ignore */ }
    const tplId = query.get('tpl') || from?.templateId;
    item = {
      id: db.uid(), sackId: S.prefs.sack || S.sacks[0]?.id || DEFAULT_SACK, templateId: tplId, name: '', sku: '', quantity: 1, condition: '', location: '', collection: '', cost: '', price: '',
      tags: [], listOnline: true, wooCategory: '', description: '', fields: {}, photoIds: [], createdAt: Date.now(),
      ...(from ? { ...structuredClone(from), id: db.uid(), name: from.name + ' (copy)', sku: '', photoIds: [], priceHistory: [], createdAt: Date.now() } : {}),
      ...carry,
    };
  } else {
    item = await db.get('items', id);
    if (!item) { location.hash = '#/'; return; }
  }

  // photos being edited: { id, rec (new, unsaved) | null, thumbUrl, caption }
  const photos = [];
  for (const pid of item.photoIds || []) {
    const p = await db.get('photos', pid);
    if (p && !p.deleted) photos.push({ id: p.id, rec: null, thumbUrl: blobUrl('t:' + p.id, p.thumb || p.full), caption: p.caption || '', origCaption: p.caption || '' });
  }
  const removed = [];
  const origPrice = isNew ? '' : item.price;
  let dirty = false;

  chrome({ title: isNew ? 'New item' : 'Edit item', back: true, nav: isNew ? 'new' : 'sack' });

  const draw = () => {
    const t = tplOf(item);
    view.innerHTML = `
      <form id="itemForm" autocomplete="off">
      <div class="edit-layout"><div>
        <div class="card"><h2>📷 Photos</h2>
          <div class="photostrip" id="strip"></div>
          <div class="row"><button type="button" class="btn primary grow" id="camBtn">📷 Take photo</button><button type="button" class="btn grow" id="galBtn">🖼 From gallery</button></div>
          <p class="muted small" style="margin:8px 0 0">First photo is the cover. Use ◀ ▶ to reorder.</p>
        </div>
        <div class="card">
          ${S.sacks.length > 1 ? `<label class="field"><span>Sack</span><select name="sackId">${S.sacks.map((k) => `<option value="${esc(k.id)}" ${k.id === (item.sackId || DEFAULT_SACK) ? 'selected' : ''}>${esc(k.icon)} ${esc(k.name)}</option>`).join('')}</select></label>` : ''}
          <label class="field"><span>Template</span><select id="tplSel">${S.templates.map((x) => `<option value="${x.id}" ${x.id === item.templateId ? 'selected' : ''}>${x.icon} ${esc(x.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Name</span><input type="text" name="name" value="${esc(item.name)}" placeholder="Leave blank to build from the details below"></label>
        </div>
        <div class="card"><h2>${t.icon} ${esc(t.name)} details</h2>${t.fields.map((f) => fieldInput(f, item.fields?.[f.key])).join('') || '<p class="muted">This template has no extra fields.</p>'}</div>
      </div><div>
        <div class="card"><h2>📦 Inventory</h2>
          <div class="grid2">
            <label class="field"><span>Quantity</span><input type="number" name="quantity" min="0" step="1" inputmode="numeric" value="${esc(item.quantity ?? 1)}"></label>
            <label class="field"><span>Condition</span><select name="condition"><option value=""></option>${CONDITIONS.map((c) => `<option ${c === item.condition ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
            <label class="field"><span>Cost</span><input type="number" name="cost" min="0" step="0.01" inputmode="decimal" value="${esc(item.cost)}"></label>
            <label class="field"><span>Price</span><input type="number" name="price" min="0" step="0.01" inputmode="decimal" value="${esc(item.price)}"></label>
          </div>
          <label class="field"><span>Location (shelf, bin, box)</span><input type="text" name="location" list="dlLoc" value="${esc(item.location)}" placeholder="e.g. Barn · Shelf B3"></label>
          <label class="field"><span>Collection (use / for sub-folders)</span><input type="text" name="collection" list="dlCol" value="${esc(item.collection)}" placeholder="e.g. Molds/Christmas/Ornaments"></label>
          <label class="field"><span>Tags (comma separated)</span><input type="text" name="tags" value="${esc((item.tags || []).join(', '))}" placeholder="christmas, ornament, vintage"></label>
          <label class="field"><span>SKU</span><input type="text" name="sku" value="${esc(item.sku)}" placeholder="Auto: ${esc(t.skuPrefix || 'ITEM')}-0001"></label>
        </div>
        <div class="card"><h2>🛒 Shop</h2>
          <label class="switch"><input type="checkbox" name="listOnline" ${item.listOnline !== false ? 'checked' : ''}> List in online shop exports</label>
          <label class="field"><span>Shop category (optional — overrides export default)</span><input type="text" name="wooCategory" list="dlCat" value="${esc(item.wooCategory)}" placeholder="e.g. Bisqueware > Molds"></label>
        </div>
        <div class="card"><h2>📝 Description</h2>
          <div class="md-toolbar"><button type="button" data-md="**">B</button><button type="button" data-md="*"><i>I</i></button><button type="button" data-md="- ">• List</button></div>
          <textarea name="description" id="desc" placeholder="History, flaws, story… **bold**, *italic*, - lists">${esc(item.description)}</textarea>
        </div>
      </div></div>
      <div class="savebar">
        ${isNew ? '<button type="button" class="btn" id="saveNext">Save + add next</button>' : ''}
        <button type="submit" class="btn primary">Save</button>
      </div>
      <datalist id="dlLoc">${distinct('location').map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
      <datalist id="dlCol">${distinct('collection').map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
      <datalist id="dlCat">${distinct('wooCategory').map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
      </form>`;
    drawStrip();
    wire();
  };

  const drawStrip = () => {
    const strip = $('#strip');
    strip.innerHTML = photos.map((p, i) => `<div><div class="pthumb" data-i="${i}">
        <img src="${p.thumbUrl}" alt="">${i === 0 ? '<span class="cover">Cover</span>' : ''}
        <div class="pbar"><button type="button" data-a="left" ${i === 0 ? 'disabled' : ''} aria-label="Move left">◀</button>
        <button type="button" data-a="del" aria-label="Remove">✕</button>
        <button type="button" data-a="right" ${i === photos.length - 1 ? 'disabled' : ''} aria-label="Move right">▶</button></div></div>
        <input type="text" class="pcap" data-cap="${i}" value="${esc(p.caption)}" placeholder="Caption"></div>`).join('')
      || '<p class="muted small" style="grid-column:1/-1;margin:0">No photos yet.</p>';
    strip.onclick = (e) => {
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      const i = +b.closest('.pthumb').dataset.i;
      if (b.dataset.a === 'left' && i > 0) [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]];
      if (b.dataset.a === 'right' && i < photos.length - 1) [photos[i + 1], photos[i]] = [photos[i], photos[i + 1]];
      if (b.dataset.a === 'del') { const [p] = photos.splice(i, 1); if (!p.rec) removed.push(p.id); }
      dirty = true; drawStrip();
    };
    strip.oninput = (e) => { const i = e.target.dataset.cap; if (i != null) { photos[+i].caption = e.target.value; dirty = true; } };
    // drag to reorder on desktop
    $$('.pthumb', strip).forEach((el) => {
      el.draggable = true;
      el.ondragstart = (e) => { e.dataTransfer.setData('text/plain', el.dataset.i); el.classList.add('dragging'); };
      el.ondragend = () => el.classList.remove('dragging');
      el.ondragover = (e) => e.preventDefault();
      el.ondrop = (e) => {
        e.preventDefault();
        const from = +e.dataTransfer.getData('text/plain'), to = +el.dataset.i;
        if (from === to || isNaN(from)) return;
        const [p] = photos.splice(from, 1); photos.splice(to, 0, p); dirty = true; drawStrip();
      };
    });
  };

  const addFiles = async (files) => {
    if (!files.length) return;
    toast(`Adding ${files.length} photo${files.length > 1 ? 's' : ''}…`, 8000);
    for (const file of files) {
      try {
        const rec = await processPhoto(file, item.id);
        photos.push({ id: rec.id, rec, thumbUrl: blobUrl('t:' + rec.id, rec.thumb), caption: '' });
        dirty = true; drawStrip();
      } catch (err) { console.error(err); toast('Could not read one of the photos'); }
    }
    toast('Photos added');
  };

  const collect = () => {
    const form = $('#itemForm');
    const fd = new FormData(form);
    const t = tplOf(item);
    item.name = (fd.get('name') || '').trim();
    item.quantity = fd.get('quantity') === '' ? 1 : Number(fd.get('quantity'));
    item.condition = fd.get('condition') || '';
    item.cost = fd.get('cost') === '' ? '' : Number(fd.get('cost'));
    item.price = fd.get('price') === '' ? '' : Number(fd.get('price'));
    item.location = (fd.get('location') || '').trim();
    item.collection = (fd.get('collection') || '').trim().replace(/\s*\/\s*/g, '/').replace(/^\/|\/$/g, '');
    item.tags = (fd.get('tags') || '').split(',').map((s) => s.trim()).filter(Boolean);
    item.sku = (fd.get('sku') || '').trim();
    item.listOnline = fd.get('listOnline') === 'on';
    item.wooCategory = (fd.get('wooCategory') || '').trim();
    item.description = fd.get('description') || '';
    if (fd.get('sackId')) item.sackId = fd.get('sackId');
    if (!item.sackId) item.sackId = DEFAULT_SACK;
    const fields = {};
    for (const f of t.fields) {
      const el = form.querySelector(`[data-key="${f.key}"]`);
      if (!el) continue;
      let v = f.type === 'yesno' ? el.checked : el.value;
      if ((f.type === 'number' || f.type === 'currency' || f.type === 'rating') && v !== '') v = Number(v);
      if (v !== '' && v !== false) fields[f.key] = v;
    }
    item.fields = fields;
    if (!item.name) {
      const parts = t.fields.filter((f) => ['text', 'number', 'select'].includes(f.type)).map((f) => fields[f.key]).filter((v) => v !== undefined && v !== '').slice(0, 3);
      item.name = parts.join(' ') || `${t.name} item`;
    }
  };

  const save = async (next = false) => {
    collect();
    const t = tplOf(item);
    if (!item.sku) item.sku = await db.nextSku(t.skuPrefix || 'ITEM');
    for (const pid of removed) { await db.softDelete('photos', pid, { itemId: item.id }); forgetUrl('t:' + pid); forgetUrl('f:' + pid); }
    for (const p of photos) {
      if (p.rec) { p.rec.caption = p.caption; await db.put('photos', p.rec); }
      else if (p.caption !== p.origCaption) { const r = await db.get('photos', p.id); if (r) { r.caption = p.caption; await db.put('photos', r); } }
    }
    item.photoIds = photos.map((p) => p.id);
    recordPrice(item, origPrice);
    await db.put('items', item);
    await loadItems();
    queueSync();
    S.prefs.lastTpl = item.templateId; savePrefs();
    dirty = false;
    if (next) {
      const carry = { sackId: item.sackId, templateId: item.templateId, location: item.location, collection: item.collection, condition: item.condition, tags: item.tags, wooCategory: item.wooCategory, listOnline: item.listOnline };
      try { sessionStorage.setItem('squire.carry', JSON.stringify(carry)); } catch { /* ignore */ }
      toast(`Saved ${item.sku}. Ready for the next one.`);
      location.hash = `#/new?tpl=${item.templateId}&next=1&t=${Date.now()}`;
    } else {
      toast('Saved');
      location.replace(`#/item/${item.id}`);
    }
  };

  const wire = () => {
    $('#camBtn').onclick = async () => addFiles(await pickFile('image/*', { capture: true }));
    $('#galBtn').onclick = async () => addFiles(await pickFile('image/*', { multiple: true }));
    $('#tplSel').onchange = (e) => { collect(); item.templateId = e.target.value; draw(); };
    $('#itemForm').onsubmit = (e) => { e.preventDefault(); save(false); };
    $('#saveNext')?.addEventListener('click', () => save(true));
    $('#itemForm').oninput = () => { dirty = true; };
    $$('.md-toolbar button').forEach((b) => (b.onclick = () => mdWrap($('#desc'), b.dataset.md)));
    $$('.stars').forEach((st) => {
      st.onclick = (e) => {
        const b = e.target.closest('button'); if (!b) return;
        const inp = st.querySelector('input'); const n = +b.dataset.n;
        inp.value = inp.value == n ? '' : n;
        $$('button', st).forEach((x) => x.classList.toggle('on', +x.dataset.n <= Number(inp.value || 0)));
      };
    });
  };

  draw();
  window.onbeforeunload = () => (dirty ? true : undefined);
}

function fieldInput(f, v) {
  const val = v ?? '';
  const k = esc(f.key);
  const lab = esc(f.label);
  switch (f.type) {
    case 'longtext': return `<label class="field"><span>${lab}</span><textarea data-key="${k}">${esc(val)}</textarea></label>`;
    case 'number': return `<label class="field"><span>${lab}</span><input type="number" step="any" inputmode="decimal" data-key="${k}" value="${esc(val)}"></label>`;
    case 'currency': return `<label class="field"><span>${lab}</span><input type="number" step="0.01" min="0" inputmode="decimal" data-key="${k}" value="${esc(val)}"></label>`;
    case 'date': return `<label class="field"><span>${lab}</span><input type="date" data-key="${k}" value="${esc(val)}"></label>`;
    case 'url': return `<label class="field"><span>${lab}</span><input type="url" data-key="${k}" value="${esc(val)}" placeholder="https://"></label>`;
    case 'yesno': return `<label class="switch"><input type="checkbox" data-key="${k}" ${val ? 'checked' : ''}> ${lab}</label>`;
    case 'select': return `<label class="field"><span>${lab}</span><select data-key="${k}"><option value=""></option>${(f.options || []).map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    case 'rating': return `<div class="field"><span class="muted small">${lab}</span><div class="stars"><input type="hidden" data-key="${k}" value="${esc(val)}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" class="${n <= Number(val || 0) ? 'on' : ''}">★</button>`).join('')}</div></div>`;
    default: return `<label class="field"><span>${lab}</span><input type="text" data-key="${k}" value="${esc(val)}"></label>`;
  }
}

function mdWrap(ta, mark) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  if (mark === '- ') {
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    ta.value = value.slice(0, lineStart) + '- ' + value.slice(lineStart);
    ta.setSelectionRange(e + 2, e + 2);
  } else {
    const sel = value.slice(s, e) || 'text';
    ta.value = value.slice(0, s) + mark + sel + mark + value.slice(e);
    ta.setSelectionRange(s + mark.length, s + mark.length + sel.length);
  }
  ta.focus();
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------------------------------------------------------------- templates
function renderTemplates() {
  chrome({ title: 'Templates', nav: 'templates' });
  const count = (t) => S.items.filter((i) => i.templateId === t.id).length;
  const row = (t) => `<a class="tile" href="#/template/${t.id}"><span class="ico">${t.icon || '📦'}</span>
    <div class="grow"><div class="nm">${esc(t.name)}</div><div class="sub">${t.fields.length} fields · ${count(t)} items${t.builtin ? '' : ' · custom'}</div></div><span>›</span></a>`;
  const custom = S.templates.filter((t) => !t.builtin);
  view.innerHTML = `
    <div class="row" style="margin-bottom:12px"><a class="btn primary grow" href="#/template/new">＋ New template</a><button class="btn grow" id="impTpl">⬆ Import template</button></div>
    ${custom.length ? `<h3>Your templates</h3><div class="tpl-list">${custom.map(row).join('')}</div>` : ''}
    <h3>Built-in</h3><div class="tpl-list">${S.templates.filter((t) => t.builtin).map(row).join('')}</div>`;
  $('#impTpl').onclick = async () => {
    const [file] = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const t = await ex.parseTemplateFile(file);
      const rec = { ...t, id: S.tplById[t.id] ? db.uid() : t.id || db.uid(), builtin: false };
      if (rec.id.startsWith('tpl-') && S.tplById[rec.id]) rec.id = db.uid();
      await db.put('templates', rec);
      await loadTemplates();
      toast(`Imported “${rec.name}”`);
      renderTemplates();
    } catch (err) { toast(err.message); }
  };
}

async function renderTemplateEditor(id) {
  const isNew = id === 'new';
  const src = isNew ? null : S.tplById[id];
  if (!isNew && !src) { location.hash = '#/templates'; return; }

  if (src?.builtin) {
    chrome({ title: src.name, back: true, nav: 'templates', actions: [{ icon: '⬇️', label: 'Export template', onClick: () => { const r = ex.exportTemplate(src); saveFile(r.blob, r.filename); } }] });
    view.innerHTML = `<div class="card"><h2>${src.icon} ${esc(src.name)}</h2><p class="muted small">Built-in template · SKU prefix ${esc(src.skuPrefix)}</p>
      <dl class="kv">${src.fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(FIELD_TYPES.find(([k]) => k === f.type)?.[1] || f.type)}${f.options ? ` <span class="muted small">(${esc(f.options.join(', '))})</span>` : ''}</dd>`).join('')}</dl></div>
      <p class="muted">Built-in templates can't be changed, but you can make your own copy and edit that.</p>
      <div class="row"><a class="btn primary grow" href="#/new?tpl=${src.id}">＋ Add item</a><button class="btn grow" id="copyBtn">⧉ Make a custom copy</button></div>`;
    $('#copyBtn').onclick = async () => {
      const copy = { ...structuredClone(src), id: db.uid(), name: src.name + ' (custom)', builtin: false };
      await db.put('templates', copy); await loadTemplates();
      location.hash = `#/template/${copy.id}`;
    };
    return;
  }

  const t = src ? structuredClone(src) : { id: db.uid(), name: '', icon: '📦', skuPrefix: '', fields: [], builtin: false };
  chrome({ title: isNew ? 'New template' : 'Edit template', back: true, nav: 'templates' });

  const draw = () => {
    view.innerHTML = `
      <div class="card">
        <div class="row"><label class="field" style="width:84px"><span>Icon</span><input type="text" id="tIcon" value="${esc(t.icon)}" maxlength="4" style="text-align:center;font-size:22px"></label>
        <label class="field grow"><span>Template name</span><input type="text" id="tName" value="${esc(t.name)}" placeholder="e.g. Hot Wheels"></label></div>
        <label class="field"><span>SKU prefix</span><input type="text" id="tPrefix" value="${esc(t.skuPrefix)}" placeholder="e.g. HW" maxlength="8"></label>
        <p class="muted small" style="margin:0">Every item already gets: name, photos, quantity, condition, location, collection, cost, price, tags, SKU and description. Add the extra details this kind of thing needs.</p>
      </div>
      <div id="fields">${t.fields.map((f, i) => `<div class="fieldrow" data-i="${i}">
        <div class="row"><input type="text" class="grow" data-p="label" value="${esc(f.label)}" placeholder="Field name" style="min-width:140px;flex:1">
        <select data-p="type">${FIELD_TYPES.map(([k, l]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        ${f.type === 'select' ? `<label class="field" style="margin:8px 0 0"><span>Choices (comma separated)</span><input type="text" data-p="options" value="${esc((f.options || []).join(', '))}"></label>` : ''}
        <div class="row" style="margin-top:8px"><button type="button" class="btn" data-a="up" ${i === 0 ? 'disabled' : ''}>▲</button><button type="button" class="btn" data-a="down" ${i === t.fields.length - 1 ? 'disabled' : ''}>▼</button><span class="grow"></span><button type="button" class="btn danger" data-a="del">Remove</button></div>
      </div>`).join('')}</div>
      <button class="btn block" id="addField" style="margin-bottom:12px">＋ Add field</button>
      <div class="row" style="margin-bottom:16px">
        ${!isNew ? '<button class="btn danger" id="tDel">🗑 Delete</button><button class="btn" id="tExp">⬇ Export</button>' : ''}
        <button class="btn primary grow" id="tSave">Save template</button></div>`;

    const sync = () => {
      t.icon = $('#tIcon').value.trim() || '📦'; t.name = $('#tName').value.trim(); t.skuPrefix = $('#tPrefix').value.trim().toUpperCase();
      $$('.fieldrow').forEach((row) => {
        const f = t.fields[+row.dataset.i];
        f.label = $('[data-p=label]', row).value.trim();
        f.type = $('[data-p=type]', row).value;
        const o = $('[data-p=options]', row);
        if (o) f.options = o.value.split(',').map((s) => s.trim()).filter(Boolean);
      });
    };
    $('#fields').onchange = (e) => { if (e.target.dataset.p === 'type') { sync(); draw(); } };
    $('#fields').onclick = (e) => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      sync();
      const i = +b.closest('.fieldrow').dataset.i;
      if (b.dataset.a === 'up') [t.fields[i - 1], t.fields[i]] = [t.fields[i], t.fields[i - 1]];
      if (b.dataset.a === 'down') [t.fields[i + 1], t.fields[i]] = [t.fields[i], t.fields[i + 1]];
      if (b.dataset.a === 'del') t.fields.splice(i, 1);
      draw();
    };
    $('#addField').onclick = () => { sync(); t.fields.push({ key: '', label: '', type: 'text' }); draw(); $$('.fieldrow [data-p=label]').pop()?.focus(); };
    $('#tSave').onclick = async () => {
      sync();
      if (!t.name) { toast('Give the template a name'); return; }
      t.fields = t.fields.filter((f) => f.label);
      const used = new Set();
      for (const f of t.fields) {
        if (!f.key) { let k = slugKey(f.label), n = 2; while (used.has(k)) k = slugKey(f.label) + '_' + n++; f.key = k; }
        used.add(f.key);
        if (f.type !== 'select') delete f.options;
      }
      if (!t.skuPrefix) t.skuPrefix = t.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'ITEM';
      await db.put('templates', t); await loadTemplates(); queueSync();
      toast('Template saved');
      location.replace('#/templates');
    };
    $('#tExp')?.addEventListener('click', () => { sync(); const r = ex.exportTemplate(t); saveFile(r.blob, r.filename); });
    $('#tDel')?.addEventListener('click', async () => {
      const n = S.items.filter((i) => i.templateId === t.id).length;
      if (n) { toast(`${n} item(s) still use this template. Move or delete them first.`, 3500); return; }
      if (!(await confirmSheet(`Delete template “${t.name}”?`, 'Delete', true))) return;
      await db.softDelete('templates', t.id); await loadTemplates(); queueSync();
      location.replace('#/templates');
    });
  };
  draw();
}

// ---------------------------------------------------------------- More: export / import / storage / about
async function renderMore() {
  chrome({ title: 'More', nav: 'more' });
  const est = await db.storageEstimate();
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const photoCount = S.items.reduce((n, i) => n + (i.photoIds?.length || 0), 0);
  S.visible = computeVisible();
  const filtered = S.visible.length !== S.items.length;
  const viewName = currentSack() ? `${currentSack().name}${activeFilterCount() || S.q || S.prefs.path ? ' (filtered)' : ''}` : 'Current Sack view';
  const mb = (b) => (b / 1048576).toFixed(1) + ' MB';

  view.innerHTML = `
    <div class="card"><h2>⬇ Export</h2>
      ${filtered ? `<label class="field"><span>What to export</span><select id="scope"><option value="view">${esc(viewName)} (${S.visible.length} items)</option><option value="all">Everything (${S.items.length} items)</option></select></label>` : `<p class="muted small">Exports all ${S.items.length} items. Filter the Sack first to export just part of it.</p>`}
      <div style="display:grid;gap:8px">
        <button class="btn primary" id="xWoo">🛒 WooCommerce (shop import)</button>
        <button class="btn" id="xCsv">📊 Spreadsheet (CSV — Excel, Google Sheets, eBay, Shopify)</button>
        <button class="btn" id="xPrint">🖨 Printable list / PDF</button>
        <button class="btn" id="xLabels">🏷 Shelf labels with QR codes</button>
      </div></div>
    <div class="card"><h2>⬆ Import</h2>
      <p class="muted small">Bring in a spreadsheet (.csv) — from Excel, Google Sheets, another app, or a Squire export. You choose which column goes where.</p>
      <a class="btn block" href="#/import">📊 Import from CSV</a></div>
    <div class="card"><h2>🔄 ${isDesktopApp() ? 'Home base' : 'Sync with your computer'}</h2>${syncCardHtml()}</div>
    ${valueCardHtml()}
    <div class="card"><h2>💾 Backup</h2>
      <p class="muted small">A backup holds every item, template and full-size photo in one .zip. Keep a copy off your phone.</p>
      <div style="display:grid;gap:8px"><button class="btn primary" id="xBak">💾 Make a backup</button><button class="btn" id="iBak">♻ Restore from backup</button></div></div>
    <div class="card"><h2>📱 Storage</h2>
      <dl class="kv"><dt>Items</dt><dd>${S.items.length}</dd><dt>Photos</dt><dd>${photoCount}</dd>
      ${est ? `<dt>Space used</dt><dd>${mb(est.usage || 0)}${est.quota ? ` of ~${mb(est.quota)}` : ''}</dd>` : ''}
      <dt>Protected from cleanup</dt><dd>${persisted ? 'Yes' : 'No — install the app to protect your data'}</dd></dl></div>
    <div class="card"><h2>🛡 About Squire</h2>
      <p><b>Squire: Knick Knack Sack</b> v${VERSION} <span class="beta-pill dark">BETA</span><br>Keeper of your armor, shield, sword — and all your knick knacks.</p>
      <p class="small">Free and open source under the GNU GPL v3. Made by sirgijoe.<br>
      <a href="https://github.com/sirgijoe/squire-sack" target="_blank" rel="noopener">github.com/sirgijoe/squire-sack</a> · <a href="https://sirgijoe.com" target="_blank" rel="noopener">sirgijoe.com</a></p>
      <a class="btn block" href="${ISSUES}" target="_blank" rel="noopener">🐞 Report a bug / 💡 Suggest a feature</a></div>`;

  const scoped = () => ($('#scope')?.value === 'view' ? S.visible : S.items);

  $('#xWoo').onclick = async () => {
    const items = scoped();
    const saved = (await db.getMeta('wooOpts')) || { category: '', imageBaseUrl: '', published: true, onlyListed: true, includeImages: true };
    const p = openSheet(`<h2>🛒 WooCommerce export</h2>
      <p class="muted small">${items.length} items. Makes a products.csv for <b>Products → Import</b> in WordPress. Template details become product attributes; SKU is the match key, so re-importing updates existing products.</p>
      <label class="field"><span>Default category (use &gt; for sub-categories)</span><input type="text" id="wCat" value="${esc(saved.category)}" placeholder="e.g. Bisqueware > Molds"></label>
      <label class="field"><span>Image base URL (where you'll upload the images folder)</span><input type="url" id="wBase" value="${esc(saved.imageBaseUrl)}" placeholder="https://yoursite.com/wp-content/uploads/squire/"></label>
      <label class="switch"><input type="checkbox" id="wImg" ${saved.includeImages ? 'checked' : ''}> Include full-size images (.zip)</label>
      <label class="switch"><input type="checkbox" id="wListed" ${saved.onlyListed ? 'checked' : ''}> Only items marked “List in shop”</label>
      <label class="switch"><input type="checkbox" id="wPub" ${saved.published ? 'checked' : ''}> Publish immediately (off = drafts)</label>
      <div class="row"><button class="btn grow" id="wCancel">Cancel</button><button class="btn primary grow" id="wGo">Export</button></div>`);
    $('#wCancel', p).onclick = closeSheet;
    $('#wGo', p).onclick = async () => {
      const opts = { category: $('#wCat', p).value.trim(), imageBaseUrl: $('#wBase', p).value.trim(), includeImages: $('#wImg', p).checked, onlyListed: $('#wListed', p).checked, published: $('#wPub', p).checked };
      await db.setMeta('wooOpts', opts);
      closeSheet(); toast('Building export…', 10000);
      const r = await ex.exportWoo(items, S.tplById, opts);
      await saveFile(r.blob, r.filename); toast('Export ready');
    };
  };
  $('#xCsv').onclick = async () => { const r = await ex.exportCsv(scoped(), S.tplById); await saveFile(r.blob, r.filename); };
  $('#xPrint').onclick = async () => {
    toast('Preparing list…');
    const blob = await ex.printList(scoped(), S.tplById, currentSack()?.name || 'Squire inventory');
    await openHtml(blob, 'squire-inventory.html');
  };
  $('#xLabels').onclick = () => openLabelSheet(scoped());
  $('#syncGo')?.addEventListener('click', () => (location.hash = '#/sync'));
  $('#xBak').onclick = async () => { toast('Packing backup…', 10000); const r = await ex.exportBackup(); await saveFile(r.blob, r.filename); toast('Backup ready'); };
  $('#iBak').onclick = async () => {
    const [file] = await pickFile('.zip,application/zip');
    if (!file) return;
    const p = openSheet(`<h2>Restore backup</h2><p><b>${esc(file.name)}</b></p>
      <p class="muted small"><b>Merge</b> adds new items and keeps whichever copy of an item was edited most recently. <b>Replace</b> wipes this device first.</p>
      <div class="row"><button class="btn grow" data-m="merge">Merge</button><button class="btn danger grow" data-m="replace">Replace everything</button></div>`);
    p.onclick = async (e) => {
      const m = e.target.dataset.m; if (!m) return;
      closeSheet(); toast('Restoring…', 15000);
      try {
        const r = await ex.importBackup(file, m);
        await loadTemplates(); await loadItems(); queueSync();
        toast(`Restored: ${r.added} added, ${r.updated} updated`);
        renderMore();
      } catch (err) { console.error(err); toast(err.message, 4000); }
    };
  };
}

// ---------------------------------------------------------------- photos that may live on the home base
function fullSrc(p) {
  if (p.full) return blobUrl('f:' + p.id, p.full);
  if (S.syncCfg?.token) return `${S.syncCfg.url}/api/photo/${encodeURIComponent(p.id)}/full?t=${encodeURIComponent(S.syncCfg.token)}`;
  return blobUrl('t:' + p.id, p.thumb);
}
function photoImg(p, alt) {
  const thumb = p.thumb ? blobUrl('t:' + p.id, p.thumb) : '';
  return `<img src="${esc(fullSrc(p))}" alt="${esc(p.caption || alt)}"${thumb ? ` data-fallback="${esc(thumb)}" onerror="this.onerror=null;this.src=this.dataset.fallback"` : ''}>`;
}

// ---------------------------------------------------------------- sync with the desktop home base
const syncer = createSync({ db });
ex.setFullPhotoResolver((p) => syncer.fullBlob(p));
S.sync = { state: 'idle', msg: '', last: null };

async function refreshSyncCfg() { S.syncCfg = await syncer.getConfig(); return S.syncCfg; }

let syncTimer = null;
function queueSync(ms = 4000) {
  if (!S.syncCfg?.token) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync({ quiet: true }), ms);
}

async function runSync({ quiet = false } = {}) {
  if (!S.syncCfg?.token) return null;
  S.sync = { ...S.sync, state: 'running', msg: 'Syncing…' };
  paintSyncStatus();
  try {
    const r = await syncer.syncNow((m) => { S.sync.msg = m; paintSyncStatus(); });
    await refreshSyncCfg();
    S.sync = { state: 'ok', msg: '', last: r };
    if (r.received || r.downloaded) {
      await loadTemplates(); await loadItems();
      const h = location.hash || '#/';
      if (h === '#/' || h === '#') renderSack();
    }
    if (!quiet) toast(`Synced · ${r.received} received${r.uploaded ? ` · ${r.uploaded} photos sent` : ''}${r.offloaded ? ` · ${r.offloaded} freed` : ''}`);
    return r;
  } catch (err) {
    console.warn('Sync failed', err);
    S.sync = { ...S.sync, state: 'error', msg: err.message };
    if (!quiet) toast(err.message, 4000);
    return null;
  } finally { paintSyncStatus(); }
}

function syncStatusText() {
  const c = S.syncCfg;
  if (S.sync.state === 'running') return S.sync.msg || 'Syncing…';
  if (S.sync.state === 'error') return '⚠️ ' + S.sync.msg;
  if (c?.lastSync) return `Last synced ${new Date(c.lastSync).toLocaleString()}`;
  return 'Not synced yet';
}
function paintSyncStatus() { $$('[data-sync-status]').forEach((el) => { el.textContent = syncStatusText(); }); }

function syncCardHtml() {
  if (isDesktopApp()) {
    return S.homeBase
      ? `<p class="small">Running as <b>${esc(S.homeBase.name)}</b>. ${S.homeBase.devices.length} phone${S.homeBase.devices.length === 1 ? '' : 's'} paired.</p>
         <p class="muted small" data-sync-status>${esc(syncStatusText())}</p><button class="btn primary block" id="syncGo">🛡 Manage home base</button>`
      : `<p class="muted small">Make this computer the home base for your Sack: phones on the same Wi-Fi sync to it, and full-size photos move here so phones keep only small copies.</p>
         <button class="btn primary block" id="syncGo">🛡 Set up home base</button>`;
  }
  return S.syncCfg?.token
    ? `<p class="small">Paired with <b>${esc(S.syncCfg.serverName || 'home base')}</b>.</p><p class="muted small" data-sync-status>${esc(syncStatusText())}</p>
       <button class="btn primary block" id="syncGo">🔄 Sync settings</button>`
    : `<p class="muted small">Pair this device with the Squire desktop app on your home Wi-Fi to share one Sack and move full-size photos off your phone.</p>
       <button class="btn primary block" id="syncGo">🔗 Pair with home base</button>`;
}

function valueCardHtml() {
  const items = S.prefs.sack ? S.items.filter((i) => (i.sackId || DEFAULT_SACK) === S.prefs.sack) : S.items;
  const series = collectionValueSeries(items);
  if (!series.length) return '';
  const now = series[series.length - 1].total;
  const first = series[0];
  return `<div class="card value"><h2>📈 Collection value</h2>
    <p><b style="font-size:20px">${money(now)}</b> <span class="muted small">${esc(currentSack()?.name || 'all Sacks')} · price × quantity</span></p>
    ${sparkline(series.map((p) => ({ at: p.at, v: p.total })))}
    ${series.length > 1 ? `<p class="muted small" style="margin:6px 0 0">Since ${new Date(first.at).toLocaleDateString()}: ${now >= first.total ? '▲' : '▼'} ${money(Math.abs(now - first.total))}</p>` : ''}</div>`;
}

// Desktop app: run the home base and keep this window synced with it.
async function startHomeBase() {
  const info = await invoke('home_base_start', {});
  S.homeBase = info;
  await syncer.connectLocal(info.localUrl, info.localToken, info.serverId, info.name);
  await refreshSyncCfg();
  await db.setMeta('homeBase:on', true);
  return info;
}

async function renderSync() {
  chrome({ title: isDesktopApp() ? 'Home base' : 'Sync', back: true, nav: 'more' });
  if (isDesktopApp()) return renderHomeBase();
  const c = await refreshSyncCfg();
  if (!c?.token) return renderPair(new URLSearchParams());
  view.innerHTML = `<div class="card"><h2>🔄 Synced with ${esc(c.serverName || 'home base')}</h2>
      <dl class="kv"><dt>Address</dt><dd>${esc(c.url)}</dd><dt>This device</dt><dd>${esc(c.deviceName || '')}</dd><dt>Status</dt><dd data-sync-status>${esc(syncStatusText())}</dd></dl>
      <button class="btn primary block" id="sNow" style="margin-top:10px">🔄 Sync now</button></div>
    <div class="card"><h2>📷 Photos</h2>
      <label class="switch"><input type="checkbox" id="sOff" ${c.offload ? 'checked' : ''}> Move full-size photos to the home base</label>
      <p class="muted small" style="margin:6px 0 0">When on, this device keeps small copies after the home base has the originals. Full-size photos load from the home base when you're on the same Wi-Fi, and exports fetch them from there.</p></div>
    <button class="btn danger block" id="sUnpair">Unpair this device</button>`;
  $('#sNow').onclick = () => runSync();
  $('#sOff').onchange = async (e) => { await syncer.setConfig({ ...(await syncer.getConfig()), offload: e.target.checked }); await refreshSyncCfg(); toast(e.target.checked ? 'Photos will move on the next sync' : 'Full-size photos stay on this device'); };
  $('#sUnpair').onclick = async () => {
    if (!(await confirmSheet('Unpair from the home base? Your items stay on this device. Photos that were moved off it stay on the home base.', 'Unpair', true))) return;
    await syncer.unpair(); await refreshSyncCfg(); toast('Unpaired'); location.hash = '#/more';
  };
}

async function renderHomeBase() {
  const on = await db.getMeta('homeBase:on', false);
  if (!S.homeBase && on) { try { await startHomeBase(); } catch (err) { toast(err.message, 4000); } }
  if (!S.homeBase) {
    view.innerHTML = `<div class="card"><h2>🛡 Make this computer the home base</h2>
      <p>Phones and tablets on your home Wi-Fi pair with this computer and sync the Sack with it. Full-size photos are kept here, in Squire's app data folder, so phones only need small copies.</p>
      <p class="muted small">Squire will listen on your home network (port 7878). Your computer may ask whether to allow that — say yes for private/home networks. Nothing goes to the internet.</p>
      <button class="btn primary block" id="hbOn">Start the home base</button></div>`;
    $('#hbOn').onclick = async () => { try { await startHomeBase(); await runSync({ quiet: true }); renderHomeBase(); } catch (err) { toast(err.message, 5000); } };
    return;
  }
  const hb = S.homeBase = (await invoke('home_base_info')) || S.homeBase;
  const addr = hb.urls[0] || '';
  view.innerHTML = `<div class="card"><h2>🛡 ${esc(hb.name)} <span class="badge">running</span></h2>
      <dl class="kv"><dt>Phones open</dt><dd>${addr ? esc(addr) : '<span class="muted">No network found — connect to Wi-Fi</span>'}</dd>
      <dt>Photos kept in</dt><dd class="small">${esc(hb.dataDir)}</dd><dt>This window</dt><dd data-sync-status>${esc(syncStatusText())}</dd></dl>
      <div class="row" style="margin-top:10px"><button class="btn primary grow" id="hbPair">📱 Pair a phone</button><button class="btn grow" id="hbSync">🔄 Sync now</button></div></div>
    <div class="card"><h2>📱 Paired devices</h2>${hb.devices.length ? `<div class="tpl-list">${hb.devices.map((d) => `<div class="tile"><span class="ico">📱</span>
      <div class="grow"><div class="nm">${esc(d.name)}</div><div class="sub">Last seen ${new Date(d.lastSeen).toLocaleString()}</div></div>
      <button class="btn" data-forget="${esc(d.id)}">Forget</button></div>`).join('')}</div>` : '<p class="muted small">None yet. Tap “Pair a phone”.</p>'}</div>
    <div class="card"><h2>⚙️ Settings</h2>
      <label class="field"><span>Home base name</span><input type="text" id="hbName" value="${esc(hb.name)}"></label>
      <button class="btn danger block" id="hbOff">Stop the home base</button></div>`;
  $('#hbSync').onclick = () => runSync();
  $('#hbName').onchange = async (e) => { await invoke('home_base_rename', { name: e.target.value }); S.homeBase = await invoke('home_base_info'); toast('Renamed'); };
  $('#hbOff').onclick = async () => { await invoke('home_base_stop'); await db.setMeta('homeBase:on', false); S.homeBase = null; toast('Home base stopped'); renderHomeBase(); };
  view.onclick = async (e) => {
    const f = e.target.closest('[data-forget]');
    if (!f) return;
    if (!(await confirmSheet('Forget this device? It will need to pair again to sync.', 'Forget', true))) return;
    await invoke('home_base_forget', { id: f.dataset.forget }); renderHomeBase();
  };
  $('#hbPair').onclick = async () => {
    const code = await invoke('home_base_pair_code');
    const link = addr ? `${addr}/#/pair?code=${code}` : '';
    const p = openSheet(`<h2>📱 Pair a phone</h2>
      <p>On the phone (same Wi-Fi), point the camera at this code:</p>
      ${link ? `<div class="qrbox">${qrSvg(link, { px: 5 })}</div>` : ''}
      <p class="muted small">Or open <b>${esc(addr || 'this computer’s address')}</b> in the phone's browser — or in the Squire app tap More → Sync → Pair — and enter:</p>
      <p class="paircode">${code.slice(0, 3)} ${code.slice(3)}</p>
      <p class="muted small">The code works once, for 10 minutes.</p>
      <button class="btn block" id="pDone">Done</button>`);
    $('#pDone', p).onclick = () => { closeSheet(); renderHomeBase(); };
    // refresh the device list when the phone pairs
    const before = hb.devices.length;
    const poll = setInterval(async () => {
      if ($('#sheet').hidden) { clearInterval(poll); return; }
      const now = await invoke('home_base_info').catch(() => null);
      if (now && now.devices.length > before) { clearInterval(poll); closeSheet(); toast(`Paired “${now.devices[now.devices.length - 1].name}”`); renderHomeBase(); }
    }, 2000);
  };
}

async function renderPair(query) {
  chrome({ title: 'Pair with home base', back: true, nav: 'more' });
  if (isDesktopApp()) { location.replace('#/sync'); return; }
  let server = query.get('server') || '';
  // opened from the home base itself (http://<computer>:7878/#/pair?code=…)
  if (!server && /^http:/.test(location.protocol)) { try { await syncer.hello(location.origin); server = location.origin; } catch { /* not a home base */ } }
  const code = query.get('code') || '';
  const mixed = location.protocol === 'https:' && /^http:/.test(server || 'http:') && !/^http:\/\/(localhost|127\.)/.test(server);
  const guessName = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'This device';
  view.innerHTML = `<div class="card"><h2>🔗 Pair with your home base</h2>
      <p class="small">On your computer, open the Squire desktop app → More → Home base → <b>Pair a phone</b>.</p>
      ${'BarcodeDetector' in window ? '<button class="btn primary block" id="pScan" style="margin-bottom:12px">📷 Scan the code on the computer</button>' : ''}
      <label class="field"><span>Home base address</span><input type="url" id="pUrl" value="${esc(server)}" placeholder="http://192.168.1.20:7878" inputmode="url"></label>
      <label class="field"><span>Pairing code</span><input type="text" id="pCode" value="${esc(code)}" inputmode="numeric" maxlength="7" placeholder="123 456"></label>
      <label class="field"><span>Name for this device</span><input type="text" id="pName" value="${esc(guessName)}"></label>
      <label class="switch"><input type="checkbox" id="pOff" checked> Move full-size photos to the home base</label>
      <button class="btn primary block" id="pGo" style="margin-top:10px">Pair</button></div>
    ${mixed ? `<div class="card"><p class="small">⚠️ Browsers don't let a secure (https) page talk to a computer on your Wi-Fi. If pairing fails, open <b>${esc(server || 'the home base address')}</b> in this phone's browser instead — it's the same Squire app, served by your computer — and pair from there.</p></div>` : ''}`;
  $('#pScan')?.addEventListener('click', openScanner);
  $('#pGo').onclick = async () => {
    const url = $('#pUrl').value.trim(), c = $('#pCode').value.trim();
    if (!url || !c) { toast('Enter the address and the code'); return; }
    $('#pGo').disabled = true; $('#pGo').textContent = 'Pairing…';
    try {
      await syncer.hello(url);
      await syncer.pair(url, c, $('#pName').value.trim() || guessName, { offload: $('#pOff').checked });
      await refreshSyncCfg();
      toast('Paired! Syncing…');
      location.replace('#/sync');
      await runSync();
    } catch (err) {
      toast(err.message, 5000);
      $('#pGo').disabled = false; $('#pGo').textContent = 'Pair';
    }
  };
  if (server && code && query.get('auto') !== '0') $('#pCode').focus();
}

// ---------------------------------------------------------------- QR labels + scanner
function openLabelSheet(items) {
  if (!items.length) { toast('Nothing to label'); return; }
  const noSku = items.filter((i) => !i.sku).length;
  const p = openSheet(`<h2>🏷 Shelf labels</h2>
    <p class="muted small">${items.length} label${items.length === 1 ? '' : 's'}. Each QR code opens the item in Squire — scan it with the 📷 button on the Sack, or the phone's camera.${noSku ? ` ${noSku} item(s) have no SKU and will use their internal id.` : ''}</p>
    <label class="field"><span>Label size</span><select id="lSize">${Object.entries(LABEL_SIZES).map(([k, v]) => `<option value="${k}" ${k === (S.prefs.labelSize || 'small') ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
    <label class="switch"><input type="checkbox" id="lPrice" ${S.prefs.labelPrice ? 'checked' : ''}> Show price</label>
    <div class="row"><button class="btn grow" id="lCancel">Cancel</button><button class="btn primary grow" id="lGo">Make labels</button></div>`);
  $('#lCancel', p).onclick = closeSheet;
  $('#lGo', p).onclick = async () => {
    S.prefs.labelSize = $('#lSize', p).value; S.prefs.labelPrice = $('#lPrice', p).checked; savePrefs();
    closeSheet();
    const blob = labelSheet(items, { size: S.prefs.labelSize, showPrice: S.prefs.labelPrice, appUrl: location.href, title: `${currentSack()?.name || 'Squire'} labels` });
    await openHtml(blob, 'squire-labels.html');
  };
}

function handleScanned(text) {
  const t = String(text || '').trim();
  const pair = t.match(/^(https?:\/\/[^/#?]+)\/?#\/pair\?(.*)$/);
  if (pair) { const q = new URLSearchParams(pair[2]); q.set('server', pair[1]); location.hash = '#/pair?' + q.toString(); return; }
  const sku = parseLabelCode(t);
  if (sku) location.hash = '#/sku/' + encodeURIComponent(sku);
  else toast("That code isn't a Squire label");
}

async function openScanner() {
  const canDetect = 'BarcodeDetector' in window;
  const p = openSheet(`<h2>📷 Scan a label</h2>
    ${canDetect ? '<video id="scanVid" playsinline muted style="width:100%;border-radius:12px;background:#000;aspect-ratio:4/3;object-fit:cover"></video>' : '<p class="muted small">This browser can’t scan codes itself. Use the phone’s camera app on the label — it opens Squire — or type the SKU:</p>'}
    <div class="row" style="margin-top:10px"><input type="text" id="scanSku" class="grow" placeholder="Type a SKU, e.g. MOLD-0001" style="flex:1"><button class="btn primary" id="scanGo">Go</button></div>
    <button class="btn block" id="scanClose" style="margin-top:10px">Close</button>`);
  let stream = null, timer = null;
  const stop = () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  const done = (text) => { stop(); closeSheet(); handleScanned(text); };
  $('#scanClose', p).onclick = () => { stop(); closeSheet(); };
  $('#scanGo', p).onclick = () => { const v = $('#scanSku', p).value.trim(); if (v) done(v); };
  $('#scanSku', p).onkeydown = (e) => { if (e.key === 'Enter') $('#scanGo', p).click(); };
  const sheet = $('#sheet');
  const prevClick = sheet.onclick;
  sheet.onclick = (e) => { if (e.target === sheet) stop(); prevClick?.(e); };
  if (!canDetect) return;
  try {
    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const vid = $('#scanVid', p);
    if (!vid) { stop(); return; }
    vid.srcObject = stream; await vid.play();
    timer = setInterval(async () => {
      if ($('#sheet').hidden) { stop(); return; }
      try { const [hit] = await det.detect(vid); if (hit?.rawValue) done(hit.rawValue); } catch { /* keep trying */ }
    }, 300);
  } catch (err) {
    console.warn(err);
    const vid = $('#scanVid', p); if (vid) vid.replaceWith(Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'Camera not available. Type the SKU instead.' }));
  }
}

async function openBySku(code) {
  const c = String(code || '').trim().toLowerCase();
  const it = S.items.find((i) => (i.sku || '').toLowerCase() === c) || S.items.find((i) => i.id === code);
  if (it) { location.replace(`#/item/${it.id}`); return; }
  chrome({ title: 'Not found', back: true, nav: 'sack' });
  view.innerHTML = `<div class="empty"><div class="big">🔍</div><h2>${esc(code)}</h2><p>No item with that SKU on this device.${S.syncCfg?.token ? ' Try syncing first.' : ''}</p>
    ${S.syncCfg?.token ? '<button class="btn primary" id="nfSync">🔄 Sync now</button>' : ''} <a class="btn" href="#/">Back to the Sack</a></div>`;
  $('#nfSync')?.addEventListener('click', async () => { await runSync(); openBySku(code); });
}

// ---------------------------------------------------------------- CSV import
async function renderImport() {
  chrome({ title: 'Import CSV', back: true, nav: 'more' });
  view.innerHTML = `<div class="card"><h2>📊 Import from a spreadsheet</h2>
    <p class="small">Save your spreadsheet as <b>CSV</b> (Excel: File → Save As → CSV; Google Sheets: File → Download → CSV), then pick it here. The first row should be column names.</p>
    <button class="btn primary block" id="iPick">Choose a .csv file</button></div>`;
  $('#iPick').onclick = async () => {
    const [file] = await pickFile('.csv,text/csv,text/plain');
    if (!file) return;
    const rows = parseCsv(await file.text());
    if (rows.length < 2) { toast('That file has no rows to import'); return; }
    renderImportMapping(file.name, rows);
  };
}

function renderImportMapping(fileName, rows) {
  const [header, ...body] = rows;
  // pick the template whose fields match the most column names
  const norm = (x) => String(x).trim().toLowerCase();
  const score = (t) => header.filter((h) => t.fields.some((f) => norm(f.label) === norm(h))).length;
  let tpl = S.templates.slice().sort((a, b) => score(b) - score(a))[0];
  if (!score(tpl)) tpl = S.tplById[S.prefs.lastTpl] || S.templates.find((t) => t.id === 'tpl-general') || S.templates[0];
  let mapping = autoMap(header, tpl, S.templates);
  const sackId = S.prefs.sack || S.sacks[0]?.id || DEFAULT_SACK;

  const draw = () => {
    const targets = [['', '— skip —'], ['_template', 'Template (by name)'], ...BASE_TARGETS.map(([k, l]) => [k, l]), ...tpl.fields.map((f) => ['fl:' + f.label, `${tpl.icon} ${f.label}`]),
      ...mapping.filter((m) => m.startsWith('fl:') && !tpl.fields.some((f) => 'fl:' + f.label === m)).map((m) => [m, `${m.slice(3)} (other template)`])];
    const sample = (i) => body.slice(0, 3).map((r) => r[i]).filter(Boolean).join(' · ');
    view.innerHTML = `<div class="card"><h2>📊 ${esc(fileName)}</h2><p class="muted small">${body.length} rows</p>
        <label class="field"><span>Template for these items</span><select id="iTpl">${S.templates.map((t) => `<option value="${t.id}" ${t.id === tpl.id ? 'selected' : ''}>${t.icon} ${esc(t.name)}</option>`).join('')}</select></label>
        ${S.sacks.length > 1 ? `<label class="field"><span>Put them in</span><select id="iSack">${S.sacks.map((k) => `<option value="${esc(k.id)}" ${k.id === sackId ? 'selected' : ''}>${esc(k.icon)} ${esc(k.name)}</option>`).join('')}</select></label>` : ''}
        <label class="switch"><input type="checkbox" id="iUpd" checked> Update items that already have the same SKU</label></div>
      <div class="card"><h2>Columns</h2><p class="muted small" style="margin-top:-4px">Choose where each column goes.</p>
        ${header.map((h, i) => `<div class="maprow"><div class="grow"><div class="nm">${esc(h || `Column ${i + 1}`)}</div><div class="sub muted small">${esc(sample(i).slice(0, 80))}</div></div>
          <select data-col="${i}">${targets.map(([k, l]) => `<option value="${esc(k)}" ${k === mapping[i] ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`).join('')}</div>
      <div class="savebar"><a class="btn" href="#/more">Cancel</a><button class="btn primary" id="iGo">Import ${body.length} rows</button></div>`;
    $('#iTpl').onchange = (e) => { tpl = S.tplById[e.target.value]; mapping = autoMap(header, tpl, S.templates).map((m, i) => (m || (mapping[i] && !mapping[i].startsWith('fl:') ? mapping[i] : ''))); draw(); };
    $$('[data-col]').forEach((sel) => (sel.onchange = () => { mapping[+sel.dataset.col] = sel.value; }));
    $('#iGo').onclick = async () => {
      if (!mapping.some(Boolean)) { toast('Choose at least one column to import'); return; }
      const target = $('#iSack')?.value || sackId;
      const { items, skipped } = rowsToItems(body, mapping, tpl, S.templates);
      const { creates, updates } = planImport(items, S.items, { updateBySku: $('#iUpd').checked });
      $('#iGo').disabled = true; $('#iGo').textContent = 'Importing…';
      for (const u of updates) { await db.put('items', u); }
      for (const c of creates) {
        const t = S.tplById[c.templateId] || tpl;
        const rec = { id: db.uid(), sackId: target, name: '', sku: '', quantity: 1, condition: '', location: '', collection: '', cost: '', price: '', tags: [], listOnline: true, wooCategory: '', description: '', photoIds: [], createdAt: Date.now(), ...c };
        if (!rec.sku) rec.sku = await db.nextSku(t.skuPrefix || 'ITEM');
        recordPrice(rec, '');
        await db.put('items', rec);
      }
      await loadItems(); queueSync(1000);
      toast(`Imported: ${creates.length} new, ${updates.length} updated${skipped ? `, ${skipped} empty rows skipped` : ''}`, 4000);
      location.hash = '#/';
    };
  };
  draw();
}

// ---------------------------------------------------------------- fullscreen photo viewer (swipe + pinch zoom)
let viewerState = null;
function openViewer(photos, index) {
  const v = $('#viewer');
  v.hidden = false;
  v.innerHTML = `<img alt=""><button class="vbtn vclose" aria-label="Close">✕</button>
    ${photos.length > 1 ? '<button class="vbtn vprev" aria-label="Previous">‹</button><button class="vbtn vnext" aria-label="Next">›</button>' : ''}<div class="vcap"></div>`;
  const img = $('img', v);
  const st = viewerState = { i: index, scale: 1, x: 0, y: 0, pts: new Map(), startDist: 0, startScale: 1, swipeX: 0, lastTap: 0 };
  const apply = () => { img.style.transform = `translate(calc(-50% + ${st.x + st.swipeX}px), calc(-50% + ${st.y}px)) scale(${st.scale})`; };
  const show = (i) => {
    st.i = (i + photos.length) % photos.length; st.scale = 1; st.x = st.y = st.swipeX = 0;
    const p = photos[st.i];
    img.src = fullSrc(p);
    img.onerror = () => { img.onerror = null; if (p.thumb) img.src = blobUrl('t:' + p.id, p.thumb); };
    $('.vcap', v).textContent = `${p.caption || ''}${photos.length > 1 ? `  (${st.i + 1}/${photos.length})` : ''}`;
    apply();
  };
  show(index);
  $('.vclose', v).onclick = closeViewer;
  $('.vprev', v)?.addEventListener('click', () => show(st.i - 1));
  $('.vnext', v)?.addEventListener('click', () => show(st.i + 1));

  v.onpointerdown = (e) => {
    if (e.target.closest('.vbtn')) return;
    v.setPointerCapture(e.pointerId);
    st.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (st.pts.size === 2) {
      const [a, b] = [...st.pts.values()];
      st.startDist = Math.hypot(a.x - b.x, a.y - b.y); st.startScale = st.scale;
    }
    const now = Date.now();
    if (st.pts.size === 1 && now - st.lastTap < 300) { st.scale = st.scale > 1 ? 1 : 2.5; st.x = st.y = 0; apply(); }
    st.lastTap = now;
  };
  v.onpointermove = (e) => {
    const p = st.pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (st.pts.size === 2) {
      const [a, b] = [...st.pts.values()];
      st.scale = Math.min(6, Math.max(1, st.startScale * Math.hypot(a.x - b.x, a.y - b.y) / (st.startDist || 1)));
      if (st.scale === 1) st.x = st.y = 0;
    } else if (st.scale > 1) { st.x += dx; st.y += dy; }
    else { st.swipeX = e.clientX - p.sx; }
    apply();
  };
  const up = (e) => {
    const p = st.pts.get(e.pointerId); if (!p) return;
    st.pts.delete(e.pointerId);
    if (st.scale === 1 && st.pts.size === 0) {
      const dx = e.clientX - p.sx, dy = e.clientY - p.sy;
      st.swipeX = 0;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && photos.length > 1) show(st.i + (dx < 0 ? 1 : -1));
      else if (dy > 120) closeViewer();
      else apply();
    }
  };
  v.onpointerup = up; v.onpointercancel = up;
  v.onwheel = (e) => { e.preventDefault(); st.scale = Math.min(6, Math.max(1, st.scale * (e.deltaY < 0 ? 1.15 : 0.87))); if (st.scale === 1) st.x = st.y = 0; apply(); };
  st.key = (e) => { if (e.key === 'Escape') closeViewer(); if (e.key === 'ArrowRight') show(st.i + 1); if (e.key === 'ArrowLeft') show(st.i - 1); };
  document.addEventListener('keydown', st.key);
}
function closeViewer() {
  const v = $('#viewer');
  if (v.hidden) return;
  v.hidden = true; v.innerHTML = '';
  if (viewerState?.key) document.removeEventListener('keydown', viewerState.key);
  viewerState = null;
}

// ---------------------------------------------------------------- boot
async function boot() {
  await loadTemplates();
  await loadItems();
  await refreshSyncCfg();
  db.requestPersistence();
  window.addEventListener('hashchange', () => { window.onbeforeunload = null; });
  if ('serviceWorker' in navigator && !isTauri() && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW not registered', e));
  }
  route();
  if (isDesktopApp() && (await db.getMeta('homeBase:on', false))) {
    try { await startHomeBase(); } catch (err) { console.warn('Home base did not start', err); }
  }
  if (S.syncCfg?.token) runSync({ quiet: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') queueSync(1500); });
}
boot();
