// Exports & imports: WooCommerce CSV (+ image bundle), spreadsheet CSV, full backup, printable list, template sharing.
import * as db from './db.js';
import { makeZip, readZip } from './zip.js';
import { csv, renderMarkdown, slugify, today, esc, money } from './util.js';

// How to get a full-size photo when this device only keeps the thumbnail (synced phones).
// app.js points this at the home base; by default fall back to the thumbnail.
let resolveFull = async (p) => p.full || p.thumb;
export function setFullPhotoResolver(fn) { resolveFull = fn; }

const fmtVal = (field, v) => {
  if (v == null || v === '') return '';
  if (field.type === 'yesno') return v ? 'Yes' : 'No';
  return v;
};

async function photosFor(item) {
  const out = [];
  for (const pid of item.photoIds || []) {
    const p = await db.get('photos', pid);
    if (p) out.push(p);
  }
  return out;
}

function imageName(item, i) {
  return `${slugify(item.sku || item.name)}-${i + 1}.jpg`;
}

// ---------- WooCommerce ----------
// opts: { category, imageBaseUrl, published, onlyListed, includeImages }
export async function exportWoo(items, templatesById, opts) {
  if (opts.onlyListed) items = items.filter((i) => i.listOnline !== false);
  const maxAttrs = Math.max(0, ...items.map((i) => (templatesById[i.templateId]?.fields || []).length));
  const header = [
    'Type', 'SKU', 'Name', 'Published', 'Is featured?', 'Visibility in catalog', 'Short description', 'Description',
    'Tax status', 'In stock?', 'Stock', 'Regular price', 'Weight (lbs)', 'Categories', 'Tags', 'Images',
  ];
  for (let a = 1; a <= maxAttrs; a++) header.push(`Attribute ${a} name`, `Attribute ${a} value(s)`, `Attribute ${a} visible`, `Attribute ${a} global`);

  const rows = [header];
  const files = [];
  const base = (opts.imageBaseUrl || '').replace(/\/?$/, '/');

  for (const item of items) {
    const tpl = templatesById[item.templateId] || { fields: [] };
    const photos = await photosFor(item);
    const imgNames = photos.map((_, i) => imageName(item, i));
    if (opts.includeImages) for (let i = 0; i < photos.length; i++) files.push({ name: 'images/' + imgNames[i], data: await resolveFull(photos[i]) });

    const attrs = [];
    for (const fld of tpl.fields) {
      const v = fmtVal(fld, item.fields?.[fld.key]);
      if (v === '' || fld.type === 'longtext') continue;
      attrs.push([fld.label, String(v).replace(/\|/g, '/'), 1, 0]);
    }
    const qty = Number(item.quantity ?? 1);
    const weight = item.fields?.weight ?? item.fields?.shippingWeight ?? '';
    const shortDesc = [item.condition ? `Condition: ${item.condition}` : ''].filter(Boolean).join(' ');
    const row = [
      'simple', item.sku || '', item.name, opts.published ? 1 : 0, 0, 'visible',
      shortDesc, renderMarkdown(item.description || ''),
      'taxable', qty > 0 ? 1 : 0, qty, item.price ?? '', weight,
      item.wooCategory || opts.category || '', (item.tags || []).join(', '),
      base && imgNames.length ? imgNames.map((n) => base + n).join(', ') : '',
    ];
    for (let a = 0; a < maxAttrs; a++) row.push(...(attrs[a] || ['', '', '', '']));
    rows.push(row);
  }

  const csvText = csv(rows);
  if (!opts.includeImages) return { blob: new Blob([csvText], { type: 'text/csv' }), filename: `squire-woocommerce-${today()}.csv` };
  files.unshift({ name: 'products.csv', data: csvText }, { name: 'HOW-TO-IMPORT.txt', data: WOO_HOWTO(base) });
  return { blob: await makeZip(files), filename: `squire-woocommerce-${today()}.zip` };
}

const WOO_HOWTO = (base) => `Squire -> WooCommerce import
=============================
1. Upload everything in the "images" folder to your web host so each file is reachable at:
   ${base || '(the Image base URL you set in Squire)'}<file name>
   (Hostinger: File Manager -> public_html/wp-content/uploads/squire/)
2. In WordPress: Products -> Import -> choose products.csv -> Run the importer.
   Tick "Update existing products" to update items that already exist (matched by SKU).
3. WooCommerce downloads each image from the URL and adds it to your Media Library.
`;

// ---------- Spreadsheet CSV ----------
export async function exportCsv(items, templatesById) {
  const fieldCols = [];
  const seen = new Set();
  for (const item of items) {
    for (const fld of templatesById[item.templateId]?.fields || []) {
      const k = fld.label;
      if (!seen.has(k)) { seen.add(k); fieldCols.push(k); }
    }
  }
  const header = ['Template', 'Name', 'SKU', 'Quantity', 'Condition', 'Location', 'Collection', 'Cost', 'Price', 'Tags', 'List in shop', 'Description', 'Photos', 'Added', ...fieldCols];
  const rows = [header];
  for (const item of items) {
    const tpl = templatesById[item.templateId] || { name: '', fields: [] };
    const byLabel = {};
    for (const fld of tpl.fields) byLabel[fld.label] = fmtVal(fld, item.fields?.[fld.key]);
    rows.push([
      tpl.name, item.name, item.sku, item.quantity, item.condition, item.location, item.collection,
      item.cost, item.price, (item.tags || []).join(', '), item.listOnline === false ? 'No' : 'Yes',
      item.description, (item.photoIds || []).length, new Date(item.createdAt).toISOString().slice(0, 10),
      ...fieldCols.map((c) => byLabel[c] ?? ''),
    ]);
  }
  return { blob: new Blob([csv(rows)], { type: 'text/csv' }), filename: `squire-inventory-${today()}.csv` };
}

// ---------- Full backup / restore ----------
export async function exportBackup() {
  const [templates, items, allPhotos, allMeta] = await Promise.all(['templates', 'items', 'photos', 'meta'].map((n) => db.getAll(n)));
  const meta = allMeta.filter((m) => !String(m.key).startsWith('sync:'));
  const photos = allPhotos.filter((p) => !p.deleted && (p.full || p.thumb));
  const files = [];
  const photoMeta = [];
  for (const p of photos) {
    const full = await resolveFull(p);
    files.push({ name: `photos/${p.id}.jpg`, data: full }, { name: `thumbs/${p.id}.jpg`, data: p.thumb || full });
    photoMeta.push({ id: p.id, itemId: p.itemId, caption: p.caption || '', createdAt: p.createdAt, updatedAt: p.updatedAt });
  }
  const data = { app: 'squire', format: 1, exportedAt: new Date().toISOString(), templates, items, photos: photoMeta, meta };
  files.unshift({ name: 'squire.json', data: JSON.stringify(data) });
  return { blob: await makeZip(files), filename: `squire-backup-${today()}.zip` };
}

// mode: 'merge' (newer record wins) or 'replace' (wipe first)
export async function importBackup(file, mode = 'merge') {
  const zip = await readZip(file);
  const json = zip.get('squire.json');
  if (!json) throw new Error('This is not a Squire backup (squire.json missing).');
  const data = JSON.parse(new TextDecoder().decode(json));
  if (data.app !== 'squire') throw new Error('This is not a Squire backup.');
  if (mode === 'replace') await db.clearAll();

  let added = 0, updated = 0;
  const keepNewer = async (store, rec) => {
    const cur = await db.get(store, rec.id ?? rec.key);
    if (cur && (cur.updatedAt || 0) >= (rec.updatedAt || 0)) return;
    await db.putRaw(store, rec);
    cur ? updated++ : added++;
  };
  for (const t of data.templates || []) await keepNewer('templates', t);
  for (const it of data.items || []) await keepNewer('items', it);
  for (const m of data.meta || []) {
    if (String(m.key).startsWith('sync:')) continue;
    if (mode === 'replace' || !(await db.get('meta', m.key))) await db.put('meta', m);
  }
  for (const pm of data.photos || []) {
    const full = zip.get(`photos/${pm.id}.jpg`);
    const thumb = zip.get(`thumbs/${pm.id}.jpg`);
    if (!full) continue;
    const cur = await db.get('photos', pm.id);
    if (cur && (cur.full || cur.deleted)) continue;
    await db.putRaw('photos', { ...pm, full: new Blob([full], { type: 'image/jpeg' }), thumb: new Blob([thumb || full], { type: 'image/jpeg' }) });
  }
  return { added, updated, items: (data.items || []).length };
}

// ---------- Template sharing ----------
export function exportTemplate(tpl) {
  const { id, name, icon, skuPrefix, fields } = tpl;
  const data = { app: 'squire', kind: 'template', format: 1, template: { id, name, icon, skuPrefix, fields } };
  return { blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename: `squire-template-${slugify(name)}.json` };
}

export async function parseTemplateFile(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'squire' || data.kind !== 'template' || !data.template?.fields) throw new Error('Not a Squire template file.');
  return data.template;
}

// ---------- Printable list ----------
export async function printList(items, templatesById, title = 'Squire inventory') {
  const rows = [];
  let total = 0;
  for (const item of items) {
    const tpl = templatesById[item.templateId] || { fields: [], name: '' };
    const photo = item.photoIds?.[0] ? await db.get('photos', item.photoIds[0]) : null;
    const img = photo?.thumb ? await blobToDataUrl(photo.thumb) : '';
    const details = tpl.fields.map((f) => [f.label, fmtVal(f, item.fields?.[f.key])]).filter(([, v]) => v !== '' && v != null)
      .map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join(' · ');
    const value = Number(item.price || 0) * Number(item.quantity ?? 1);
    total += value || 0;
    rows.push(`<tr><td>${img ? `<img src="${img}">` : ''}</td><td><b>${esc(item.name)}</b><br><small>${esc(item.sku || '')} ${esc(tpl.name)}</small><br><small>${details}</small></td>
      <td>${esc(item.condition || '')}</td><td>${esc(item.location || '')}</td><td>${esc(item.quantity ?? 1)}</td><td>${money(item.price)}</td></tr>`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font:12px system-ui,sans-serif;margin:24px;color:#222} h1{font-size:18px;margin:0 0 4px}
    table{border-collapse:collapse;width:100%} td,th{border-bottom:1px solid #ddd;padding:6px;vertical-align:top;text-align:left}
    img{width:64px;height:64px;object-fit:cover;border-radius:4px} small{color:#555} tfoot td{font-weight:bold}
    @media print{button{display:none}}</style></head><body>
    <button onclick="print()">Print / Save as PDF</button>
    <h1>${esc(title)}</h1><p>${items.length} items · printed ${new Date().toLocaleDateString()}</p>
    <table><thead><tr><th></th><th>Item</th><th>Condition</th><th>Location</th><th>Qty</th><th>Price</th></tr></thead>
    <tbody>${rows.join('')}</tbody><tfoot><tr><td></td><td colspan="4">Total listed value</td><td>${money(total)}</td></tr></tfoot></table></body></html>`;
  return new Blob([html], { type: 'text/html' });
}

function blobToDataUrl(blob) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}
