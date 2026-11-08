// Squire — CSV import: turn a spreadsheet (or a Squire CSV export) into items.
// Pure functions (no DOM, no database) so they can be tested with plain Node.
import { CONDITIONS } from './templates.js';

// Built-in item properties a column can map to, with header names we recognise.
export const BASE_TARGETS = [
  ['name', 'Name', ['name', 'title', 'item', 'item name', 'product name', 'product']],
  ['sku', 'SKU', ['sku', 'item #', 'item number', 'code', 'stock number', 'id']],
  ['quantity', 'Quantity', ['quantity', 'qty', 'stock', 'count', 'on hand', 'in stock']],
  ['condition', 'Condition', ['condition', 'grade', 'state']],
  ['location', 'Location', ['location', 'shelf', 'bin', 'box', 'where']],
  ['collection', 'Collection', ['collection', 'folder', 'series', 'group']],
  ['cost', 'Cost', ['cost', 'paid', 'purchase price', 'cost price']],
  ['price', 'Price', ['price', 'regular price', 'value', 'sale price', 'asking price', 'retail price']],
  ['tags', 'Tags', ['tags', 'keywords', 'labels']],
  ['listOnline', 'List in shop', ['list in shop', 'listed', 'published', 'list online']],
  ['wooCategory', 'Shop category', ['shop category', 'categories', 'category']],
  ['description', 'Description', ['description', 'notes', 'details', 'comments', 'desc']],
];

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

// Suggest a target for every column. Targets: 'name', 'sku', … , 'fl:<field label>', '_template', or '' (skip).
// Columns named after a field of any other template are kept too (for files with a "Template" column).
export function autoMap(header, template, allTemplates = []) {
  const used = new Set();
  return header.map((h) => {
    const n = norm(h);
    if (!n) return '';
    let target = '';
    if (n === 'template') target = '_template';
    const fld = (template?.fields || []).find((f) => norm(f.label) === n || norm(f.key) === n);
    if (!target && fld) target = 'fl:' + fld.label;
    if (!target) {
      const hit = BASE_TARGETS.find(([, label, names]) => norm(label) === n || names.includes(n));
      if (hit) target = hit[0];
    }
    if (!target) {
      const other = allTemplates.flatMap((t) => t.fields).find((f) => norm(f.label) === n);
      if (other) target = 'fl:' + other.label;
    }
    if (!target || used.has(target)) return '';
    used.add(target);
    return target;
  });
}

export function parseNumber(v) {
  if (v == null) return '';
  const s = String(v).replace(/[$£€¥,\s]/g, '');
  if (s === '') return '';
  const n = Number(s);
  return Number.isFinite(n) ? n : '';
}

export function parseYesNo(v) {
  const s = norm(v);
  return ['yes', 'y', 'true', '1', 'x', 'on', 'published'].includes(s);
}

function matchCondition(v) {
  const s = norm(v);
  if (!s) return '';
  return CONDITIONS.find((c) => norm(c) === s) || String(v).trim();
}

function convert(field, raw) {
  const v = String(raw ?? '').trim();
  if (v === '') return undefined;
  switch (field.type) {
    case 'number': case 'currency': { const n = parseNumber(v); return n === '' ? undefined : n; }
    case 'rating': { const n = Math.round(Number(parseNumber(v))); return n >= 1 && n <= 5 ? n : undefined; }
    case 'yesno': return parseYesNo(v) || undefined;
    case 'select': return (field.options || []).find((o) => norm(o) === norm(v)) || v;
    default: return v;
  }
}

// rows: CSV rows WITHOUT the header. mapping: from autoMap (possibly edited by the user).
// template: the default template; templates: all templates (for a "Template" column).
// Returns { items: [partial items], skipped }.
export function rowsToItems(rows, mapping, template, templates = [template]) {
  const byName = new Map(templates.map((t) => [norm(t.name), t]));
  const items = [];
  let skipped = 0;
  for (const row of rows) {
    if (!row.some((c) => String(c ?? '').trim() !== '')) { skipped++; continue; }
    const tcol = mapping.indexOf('_template');
    const tpl = (tcol >= 0 && byName.get(norm(row[tcol]))) || template;
    const it = { templateId: tpl.id, fields: {} };
    mapping.forEach((target, col) => {
      if (!target || target === '_template') return;
      const raw = row[col];
      const v = String(raw ?? '').trim();
      if (target.startsWith('fl:')) {
        const fld = tpl.fields.find((f) => norm(f.label) === norm(target.slice(3)));
        if (!fld) return;
        const cv = convert(fld, v);
        if (cv !== undefined) it.fields[fld.key] = cv;
        return;
      }
      if (v === '') return;
      switch (target) {
        case 'quantity': { const n = parseNumber(v); if (n !== '') it.quantity = n; break; }
        case 'cost': case 'price': { const n = parseNumber(v); if (n !== '') it[target] = n; break; }
        case 'tags': it.tags = v.split(/[,;|]/).map((s) => s.trim()).filter(Boolean); break;
        case 'listOnline': it.listOnline = parseYesNo(v); break;
        case 'condition': it.condition = matchCondition(v); break;
        case 'collection': it.collection = v.replace(/\s*\/\s*/g, '/').replace(/^\/|\/$/g, ''); break;
        default: it[target] = v;
      }
    });
    if (!it.name) {
      const parts = tpl.fields.filter((f) => ['text', 'number', 'select'].includes(f.type)).map((f) => it.fields[f.key]).filter((x) => x !== undefined && x !== '').slice(0, 3);
      it.name = parts.join(' ') || it.sku || '';
    }
    if (!it.name) { skipped++; continue; }
    items.push(it);
  }
  return { items, skipped };
}

// Decide what each imported row does. With updateBySku, a row whose SKU matches an existing item
// updates that item (only the columns that were mapped); otherwise every row becomes a new item.
export function planImport(imported, existing, { updateBySku = true } = {}) {
  const bySku = new Map();
  if (updateBySku) for (const e of existing) if (e.sku && !e.deleted) bySku.set(norm(e.sku), e);
  const creates = [], updates = [];
  for (const it of imported) {
    const match = it.sku ? bySku.get(norm(it.sku)) : null;
    if (match) {
      const merged = { ...match, ...it, fields: { ...(match.fields || {}), ...it.fields } };
      if (match.templateId !== it.templateId && !Object.keys(it.fields).length) merged.templateId = match.templateId;
      updates.push(merged);
    } else creates.push(it);
  }
  return { creates, updates };
}
