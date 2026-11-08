// Squire — printable shelf / bin labels with QR codes.
// Each QR opens the item in Squire (#/sku/<SKU>); the in-app scanner understands the same codes.
import { qrSvg } from './qr.js';
import { esc } from './util.js';

export const PUBLIC_APP_URL = 'https://sirgijoe.github.io/squire-sack/';

export const LABEL_SIZES = {
  small: { name: 'Address labels — 30 per sheet (Avery 5160, 2⅝″ × 1″)', w: 2.625, h: 1, cols: 3, rows: 10, gapX: 0.125, top: 0.5, left: 0.1875, qr: 0.86 },
  medium: { name: 'Shipping labels — 10 per sheet (Avery 5163, 4″ × 2″)', w: 4, h: 2, cols: 2, rows: 5, gapX: 0.1875, top: 0.5, left: 0.15625, qr: 1.7 },
  large: { name: 'Bin cards — 4 per sheet (4″ × 5″)', w: 4, h: 5, cols: 2, rows: 2, gapX: 0.25, top: 0.375, left: 0.125, qr: 3.2 },
};

// The text stored in an item's QR code.
export function labelCode(item, appUrl = PUBLIC_APP_URL) {
  const base = /^https?:/.test(appUrl) ? appUrl.replace(/#.*$/, '') : PUBLIC_APP_URL;
  return `${base}#/sku/${encodeURIComponent(item.sku || item.id)}`;
}

// Pull a SKU (or item id) out of anything a scanner hands us: a Squire label URL or a bare SKU.
export function parseLabelCode(text) {
  const s = String(text || '').trim();
  const m = s.match(/#\/sku\/([^?&#\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (/^https?:\/\//i.test(s)) return '';
  return s;
}

export function labelSheet(items, { size = 'small', appUrl = PUBLIC_APP_URL, title = 'Squire labels', showPrice = false } = {}) {
  const L = LABEL_SIZES[size] || LABEL_SIZES.small;
  const cells = items.map((it) => {
    const svg = qrSvg(labelCode(it, appUrl), { px: 2 }).replace(/width="\d+" height="\d+"/, `width="${L.qr}in" height="${L.qr}in"`);
    const lines = [
      `<div class="nm">${esc(it.name)}</div>`,
      it.sku ? `<div class="sku">${esc(it.sku)}</div>` : '',
      it.location ? `<div class="sm">📍 ${esc(it.location)}</div>` : '',
      it.collection ? `<div class="sm">${esc(it.collection)}</div>` : '',
      showPrice && it.price !== '' && it.price != null ? `<div class="sm">$${Number(it.price).toFixed(2)}</div>` : '',
    ].join('');
    return `<div class="lbl">${svg}<div class="txt">${lines}</div></div>`;
  });
  const perPage = L.cols * L.rows;
  const pages = [];
  for (let i = 0; i < cells.length; i += perPage) pages.push(`<div class="page">${cells.slice(i, i + perPage).join('')}</div>`);
  const big = size !== 'small';
  return new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page{size:letter;margin:0} *{box-sizing:border-box} body{margin:0;font-family:system-ui,sans-serif;color:#000}
    .bar{padding:10px;background:#f3f3f3;font-size:14px} .bar button{font-size:16px;padding:6px 14px}
    .page{width:8.5in;height:11in;padding:${L.top}in 0 0 ${L.left}in;display:grid;grid-template-columns:repeat(${L.cols},${L.w}in);grid-auto-rows:${L.h}in;column-gap:${L.gapX}in;page-break-after:always;overflow:hidden}
    .lbl{display:flex;align-items:center;gap:${big ? 0.15 : 0.06}in;padding:0.05in 0.08in;overflow:hidden;${size === 'large' ? 'flex-direction:column;justify-content:center;text-align:center' : ''}}
    .lbl svg{flex:none}
    .txt{min-width:0;overflow:hidden}
    .nm{font-weight:700;font-size:${big ? 14 : 9}pt;line-height:1.15;max-height:3.45em;overflow:hidden}
    .sku{font:${big ? 13 : 9}pt ui-monospace,monospace;margin-top:2px}
    .sm{font-size:${big ? 10 : 7}pt;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    @media print{.bar{display:none}}
  </style></head><body><div class="bar"><button onclick="print()">🖨 Print</button> ${items.length} label${items.length === 1 ? '' : 's'} · ${esc(L.name)} · In the print dialog set margins to <b>None</b> and scale to <b>100%</b>.</div>${pages.join('')}</body></html>`], { type: 'text/html' });
}
