import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCsv, csv } from '../src/js/util.js';
import { autoMap, rowsToItems, planImport, parseNumber } from '../src/js/csvimport.js';
import { BUILTIN_TEMPLATES } from '../src/js/templates.js';
import { recordPrice, collectionValueSeries } from '../src/js/value.js';
import { labelCode, parseLabelCode } from '../src/js/labels.js';
import { qrEncode } from '../src/js/qr.js';

const molds = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl-molds');

test('CSV round trip keeps commas, quotes and newlines', () => {
  const rows = [['a', 'b, c', 'say "hi"'], ['line\nbreak', '', '3']];
  assert.deepEqual(parseCsv(csv(rows)), rows);
});

test('autoMap recognises base columns and template fields; skips unknown and duplicates', () => {
  const header = ['Item Name', 'Qty', 'Brand / Maker', 'Mold #', 'Price', 'Mystery', 'price'];
  assert.deepEqual(autoMap(header, molds), ['name', 'quantity', 'fl:Brand / Maker', 'fl:Mold #', 'price', '', '']);
});

test('rowsToItems converts numbers, yes/no, tags and builds names', () => {
  const header = ['Brand / Maker', 'Mold #', '# of parts', 'Can pour to order', 'Price', 'Tags', 'Condition', 'SKU'];
  const rows = [
    ['Duncan', 'X-12', '3', 'yes', '$1,250.50', 'xmas; vintage', 'very good', 'MOLD-0007'],
    ['', '', '', '', '', '', '', ''],
  ];
  const { items, skipped } = rowsToItems(rows, autoMap(header, molds), molds);
  assert.equal(skipped, 1);
  assert.equal(items.length, 1);
  const it = items[0];
  assert.equal(it.name, 'Duncan X-12 3');
  assert.equal(it.fields.parts, 3);
  assert.equal(it.fields.canPour, true);
  assert.equal(it.price, 1250.5);
  assert.deepEqual(it.tags, ['xmas', 'vintage']);
  assert.equal(it.condition, 'Very Good');
  assert.equal(it.sku, 'MOLD-0007');
});

test('a Squire CSV export imports back, using the Template column', () => {
  const coins = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl-coins');
  const header = ['Template', 'Name', 'SKU', 'Quantity', coins.fields[0].label];
  const rows = [[coins.name, 'Penny', 'COIN-0001', '2', 'USA'], [molds.name, 'Bell', 'MOLD-0001', '1', '']];
  const { items } = rowsToItems(rows, autoMap(header, molds, BUILTIN_TEMPLATES), molds, BUILTIN_TEMPLATES);
  assert.equal(items[0].templateId, 'tpl-coins');
  assert.equal(items[0].fields[coins.fields[0].key], 'USA');
  assert.equal(items[1].templateId, 'tpl-molds');
});

test('planImport updates by SKU and keeps fields that were not imported', () => {
  const existing = [{ id: 'e1', sku: 'MOLD-0007', name: 'Old', price: 5, fields: { brand: 'Duncan', year: 1970 }, templateId: 'tpl-molds' }];
  const { creates, updates } = planImport([{ sku: 'mold-0007', price: 9, fields: { brand: 'Gare' }, templateId: 'tpl-molds' }, { name: 'New', fields: {}, templateId: 'tpl-molds' }], existing);
  assert.equal(creates.length, 1);
  assert.equal(updates[0].id, 'e1');
  assert.equal(updates[0].price, 9);
  assert.equal(updates[0].name, 'Old');
  assert.deepEqual(updates[0].fields, { brand: 'Gare', year: 1970 });
  assert.equal(parseNumber('€ 3.10'), 3.1);
});

test('value history records changes only, and the collection total follows them', () => {
  const a = { price: 10, quantity: 2, createdAt: 100 };
  recordPrice(a, '', 100);
  recordPrice(a, 10, 150);
  assert.equal(a.priceHistory.length, 1);
  a.price = 15; recordPrice(a, 10, 200);
  assert.deepEqual(a.priceHistory.map((h) => h.price), [10, 15]);
  const legacy = { price: 4, quantity: 1, createdAt: 50, updatedAt: 120 };
  legacy.price = 6; recordPrice(legacy, 4, 300);
  assert.deepEqual(legacy.priceHistory, [{ at: 120, price: 4 }, { at: 300, price: 6 }]);
  const series = collectionValueSeries([a, legacy]);
  assert.deepEqual(series.map((p) => p.total), [20, 24, 34, 36]);
});

test('label codes round trip', () => {
  const code = labelCode({ sku: 'MOLD-0001' }, 'https://sirgijoe.github.io/squire-sack/#/item/x');
  assert.equal(code, 'https://sirgijoe.github.io/squire-sack/#/sku/MOLD-0001');
  assert.equal(parseLabelCode(code), 'MOLD-0001');
  assert.equal(parseLabelCode('COIN-0042'), 'COIN-0042');
  assert.equal(parseLabelCode('https://example.com/'), '');
  assert.match(labelCode({ sku: 'X' }, 'tauri://localhost/'), /^https:\/\/sirgijoe\.github\.io/);
});

test('QR codes decode (checked with OpenCV when it is installed)', (t) => {
  const texts = ['MOLD-0001', 'https://sirgijoe.github.io/squire-sack/#/sku/MOLD-0001', 'http://192.168.1.20:7878/#/pair?code=042917', 'x'.repeat(400)];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'squire-qr-'));
  const file = path.join(dir, 'qr.json');
  fs.writeFileSync(file, JSON.stringify(texts.map((s) => ({ s, rows: qrEncode(s).modules.map((r) => r.map((b) => (b ? 1 : 0)).join('')) }))));
  const py = `
import json, sys
try:
    import numpy as np, cv2
except ImportError:
    print('SKIP'); sys.exit(0)
for c in json.load(open(sys.argv[1])):
    m = np.pad(np.array([[0 if ch == '1' else 255 for ch in r] for r in c['rows']], dtype=np.uint8), 4, constant_values=255)
    img = cv2.resize(m, None, fx=6, fy=6, interpolation=cv2.INTER_NEAREST)
    if cv2.QRCodeDetector().detectAndDecode(img)[0] != c['s']: print('FAIL', c['s'][:30]); sys.exit(1)
print('OK')`;
  let out;
  try { out = execFileSync('python3', ['-c', py, file]).toString().trim(); } catch (e) { out = e.stdout ? e.stdout.toString() : 'NOPY'; }
  if (out === 'SKIP' || out === 'NOPY') return t.skip('python3 + opencv not available');
  assert.equal(out, 'OK');
});
