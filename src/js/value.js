// Squire — value history: remembers each price an item has had, and the collection's total over time.
import { esc, money } from './util.js';

const isNum = (v) => v !== '' && v != null && !isNaN(v);

// Call when an item is saved. origPrice is the price it had when editing started ('' for new items).
export function recordPrice(item, origPrice, now = Date.now()) {
  const hist = Array.isArray(item.priceHistory) ? item.priceHistory.slice() : [];
  item.priceHistory = hist;
  if (!isNum(item.price)) return item;
  const p = Number(item.price);
  if (!hist.length && isNum(origPrice)) {
    if (Number(origPrice) === p) return item; // unchanged, nothing to record yet
    hist.push({ at: item.updatedAt || item.createdAt || now, price: Number(origPrice) });
  }
  if (!hist.length || Number(hist[hist.length - 1].price) !== p) hist.push({ at: now, price: p });
  return item;
}

// Total value (price × quantity) of the collection at every moment a price changed.
export function collectionValueSeries(items) {
  const events = [];
  for (const it of items) {
    const qty = Number(it.quantity ?? 1) || 0;
    const hist = (it.priceHistory && it.priceHistory.length) ? it.priceHistory
      : isNum(it.price) ? [{ at: it.createdAt || 0, price: Number(it.price) }] : [];
    let prev = 0;
    for (const h of hist) { events.push({ at: h.at, delta: (Number(h.price) - prev) * qty }); prev = Number(h.price); }
  }
  events.sort((a, b) => a.at - b.at);
  const out = [];
  let total = 0;
  for (const e of events) {
    total += e.delta;
    const v = Math.round(total * 100) / 100;
    if (out.length && out[out.length - 1].at === e.at) out[out.length - 1].total = v;
    else out.push({ at: e.at, total: v });
  }
  return out;
}

export function sparkline(points, { w = 280, h = 56 } = {}) {
  if (points.length < 2) return '';
  const xs = points.map((p) => p.at), ys = points.map((p) => p.v);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (x) => (x1 === x0 ? w / 2 : ((x - x0) / (x1 - x0)) * (w - 8) + 4);
  const sy = (y) => (y1 === y0 ? h / 2 : h - 4 - ((y - y0) / (y1 - y0)) * (h - 8));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.at).toFixed(1)},${sy(p.v).toFixed(1)}`).join('');
  const lastP = points[points.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <circle cx="${sx(lastP.at).toFixed(1)}" cy="${sy(lastP.v).toFixed(1)}" r="3" fill="currentColor"/></svg>`;
}

export function historyHtml(item) {
  const hist = item.priceHistory || [];
  if (hist.length < 2) return '';
  const rows = hist.slice().reverse().map((h, i, arr) => {
    const prev = arr[i + 1];
    const diff = prev ? Number(h.price) - Number(prev.price) : 0;
    const chg = prev && diff ? `<span class="${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} ${esc(money(Math.abs(diff)))}</span>` : '';
    return `<dt>${esc(new Date(h.at).toLocaleDateString())}</dt><dd>${esc(money(h.price))} ${chg}</dd>`;
  }).join('');
  return `<div class="card value"><h2>📈 Value history</h2>${sparkline(hist.map((x) => ({ at: x.at, v: Number(x.price) })))}<dl class="kv">${rows}</dl></div>`;
}
