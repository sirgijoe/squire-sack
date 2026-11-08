import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHomeBase } from '../tools/home-base.mjs';
import { createSync } from '../src/js/sync.js';
import { memDb } from './memdb.mjs';

async function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squire-hb-'));
  const hb = createHomeBase({ dataDir, name: 'Test PC' });
  await new Promise((r) => hb.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${hb.server.address().port}`;
  const phoneDb = memDb(), deskDb = memDb();
  const phone = createSync({ db: phoneDb, now: () => phoneDb.tick() });
  const desk = createSync({ db: deskDb, now: () => deskDb.tick() });
  return { hb, url, phoneDb, deskDb, phone, desk, close: () => new Promise((r) => hb.server.close(r)) };
}
const jpeg = (s) => new Blob([Buffer.from('\xff\xd8' + s, 'latin1')], { type: 'image/jpeg' });

test('pairing: wrong code refused, right code works once', async () => {
  const t = await setup();
  try {
    const hello = await t.phone.hello(t.url);
    assert.equal(hello.app, 'squire');
    const code = t.hb.newPairCode();
    await assert.rejects(t.phone.pair(t.url, '000000' === code ? '111111' : '000000', 'Phone'), /wrong or has expired/);
    const cfg = await t.phone.pair(t.url, code, 'Phone');
    assert.ok(cfg.token);
    await assert.rejects(t.desk.pair(t.url, code, 'Again'), /wrong or has expired/);
  } finally { await t.close(); }
});

test('unpaired token gets a clear 401 error', async () => {
  const t = await setup();
  try {
    await t.phone.setConfig({ url: t.url, token: 'nope', lastSeq: 0, lastPush: 0 });
    await assert.rejects(t.phone.syncNow(), /no longer paired/);
  } finally { await t.close(); }
});

test('phone -> home base -> desktop: items, photos, offload, conflicts, deletes, SKU counters', async () => {
  const t = await setup();
  try {
    await t.phone.pair(t.url, t.hb.newPairCode(), 'Phone', { offload: true });
    await t.desk.pair(t.url, t.hb.newPairCode(), 'Desk');
    const dcfg = await t.desk.getConfig(); await t.desk.setConfig({ ...dcfg, keepFull: true, offload: false });

    // phone catalogs an item with a photo
    await t.phoneDb.put('items', { id: 'i1', name: 'Bell mold', price: 10, photoIds: ['p1'], createdAt: 1 });
    await t.phoneDb.put('photos', { id: 'p1', itemId: 'i1', full: jpeg('FULL'), thumb: jpeg('THUMB'), caption: 'front' });
    await t.phoneDb.setMeta('sku:MOLD', 3);
    await t.phoneDb.setMeta('sync:secret', 'local only');
    const s1 = await t.phone.syncNow();
    assert.equal(s1.uploaded, 1);
    assert.equal(s1.offloaded, 1, 'full photo dropped from phone once home base has it');
    const pp = await t.phoneDb.get('photos', 'p1');
    assert.equal(pp.full, null); assert.ok(pp.thumb); assert.equal(pp.offloaded, true);
    assert.equal(Object.keys(t.hb.state().records).some((k) => k.includes('sync:')), false, 'sync: meta never leaves the device');

    // desktop pulls everything including the full photo
    await t.deskDb.setMeta('sku:MOLD', 5);
    const s2 = await t.desk.syncNow();
    assert.ok(s2.received >= 2);
    const di = await t.deskDb.get('items', 'i1');
    assert.equal(di.name, 'Bell mold');
    const dp = await t.deskDb.get('photos', 'p1');
    assert.equal(Buffer.from(await dp.full.arrayBuffer()).toString('latin1'), '\xff\xd8FULL');
    assert.equal(dp.caption, 'front');
    assert.equal(await t.deskDb.getMeta('sku:MOLD'), 5, 'SKU counter keeps the larger value');

    // both edit; the newer edit wins everywhere
    t.phoneDb.tick(10); await t.phoneDb.put('items', { ...(await t.phoneDb.get('items', 'i1')), name: 'Phone name' });
    t.deskDb.tick(50000); await t.deskDb.put('items', { ...(await t.deskDb.get('items', 'i1')), name: 'Desk name' });
    await t.phone.syncNow(); await t.desk.syncNow(); await t.phone.syncNow();
    assert.equal((await t.phoneDb.get('items', 'i1')).name, 'Desk name');
    assert.equal((await t.deskDb.get('items', 'i1')).name, 'Desk name');
    assert.equal(await t.phoneDb.getMeta('sku:MOLD'), 5);

    // delete on desktop reaches the phone as a tombstone
    t.deskDb.tick(100000);
    await t.deskDb.put('items', { id: 'i1', deleted: true });
    await t.desk.syncNow(); await t.phone.syncNow();
    assert.equal((await t.phoneDb.get('items', 'i1')).deleted, true);

    // offloaded photo can still be fetched for exports
    const blob = await t.phone.fullBlob(await t.phoneDb.get('photos', 'p1'));
    assert.equal(Buffer.from(await blob.arrayBuffer()).toString('latin1'), '\xff\xd8FULL');
  } finally { await t.close(); }
});

test('home base survives restart (state saved to disk)', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squire-hb-'));
  const a = createHomeBase({ dataDir, name: 'A' });
  const code = a.newPairCode();
  await new Promise((r) => a.server.listen(0, '127.0.0.1', r));
  const db = memDb(); const c = createSync({ db, now: () => db.tick() });
  const url = `http://127.0.0.1:${a.server.address().port}`;
  await c.pair(url, code, 'P');
  await db.put('items', { id: 'x', name: 'Coin' });
  await c.syncNow();
  await new Promise((r) => a.server.close(r));
  const b = createHomeBase({ dataDir, name: 'A' });
  assert.equal(b.state().records['items/x'].rec.name, 'Coin');
  assert.equal(b.state().devices.length, 1);
});
