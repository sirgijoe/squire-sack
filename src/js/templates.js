// Built-in templates. Every item also has the shared base fields:
// name, sku, quantity, location, condition, cost, price, tags, collection, description, photos.
// Field types: text, longtext, number, currency, date, select, yesno, rating, url

export const FIELD_TYPES = [
  ['text', 'Text'], ['longtext', 'Long text'], ['number', 'Number'], ['currency', 'Money'],
  ['date', 'Date'], ['select', 'Dropdown'], ['yesno', 'Yes / No'], ['rating', 'Rating (1–5)'], ['url', 'Link'],
];

export const CONDITIONS = ['New', 'Mint', 'Excellent', 'Very Good', 'Good', 'Fair', 'Poor', 'Damaged'];

const f = (key, label, type = 'text', options) => (options ? { key, label, type, options } : { key, label, type });

export const BUILTIN_TEMPLATES = [
  {
    id: 'tpl-molds', name: 'Ceramic Molds', icon: '🏺', skuPrefix: 'MOLD',
    fields: [
      f('brand', 'Brand / Maker'), f('moldNumber', 'Mold #'), f('pieceType', 'Makes (piece type)'),
      f('parts', '# of parts', 'number'), f('pourWeight', 'Slip to fill (lbs)', 'number'),
      f('dimensions', 'Finished size'), f('year', 'Year', 'number'),
      f('canPour', 'Can pour to order', 'yesno'),
    ],
  },
  {
    id: 'tpl-cards', name: 'Trading Cards', icon: '🃏', skuPrefix: 'CARD',
    fields: [
      f('game', 'Game / Sport'), f('set', 'Set'), f('cardNumber', 'Card #'), f('year', 'Year', 'number'),
      f('player', 'Player / Character'),
      f('rarity', 'Rarity', 'select', ['Common', 'Uncommon', 'Rare', 'Holo', 'Ultra Rare', 'Secret Rare', 'Promo']),
      f('graded', 'Graded', 'yesno'), f('grader', 'Grading company', 'select', ['PSA', 'BGS', 'CGC', 'SGC', 'Other']),
      f('grade', 'Grade'), f('foil', 'Foil / Parallel', 'yesno'),
    ],
  },
  {
    id: 'tpl-coins', name: 'Coins', icon: '🪙', skuPrefix: 'COIN',
    fields: [
      f('country', 'Country'), f('year', 'Year', 'number'), f('mintMark', 'Mint mark'),
      f('denomination', 'Denomination'), f('metal', 'Metal', 'select', ['Gold', 'Silver', 'Copper', 'Nickel', 'Clad', 'Bronze', 'Platinum', 'Other']),
      f('grade', 'Grade (e.g. MS-65)'), f('certified', 'Certified (PCGS/NGC)', 'yesno'), f('certNumber', 'Cert #'),
    ],
  },
  {
    id: 'tpl-stamps', name: 'Stamps', icon: '✉️', skuPrefix: 'STMP',
    fields: [
      f('country', 'Country'), f('year', 'Year', 'number'), f('catalogNumber', 'Catalog # (Scott, etc.)'),
      f('denomination', 'Denomination'), f('perforation', 'Perforation'),
      f('gum', 'Gum', 'select', ['Mint never hinged', 'Mint hinged', 'Used', 'No gum']),
    ],
  },
  {
    id: 'tpl-dolls', name: 'Dolls & Figures', icon: '🧸', skuPrefix: 'DOLL',
    fields: [
      f('maker', 'Maker'), f('line', 'Line / Series'), f('character', 'Character'), f('year', 'Year', 'number'),
      f('scale', 'Size / Scale'), f('packaging', 'Packaging', 'select', ['Sealed in box', 'Opened, with box', 'Loose', 'Loose, complete']),
      f('accessories', 'Accessories'),
    ],
  },
  {
    id: 'tpl-comics', name: 'Comics', icon: '💥', skuPrefix: 'COMC',
    fields: [
      f('publisher', 'Publisher'), f('title', 'Series title'), f('issue', 'Issue #'), f('variant', 'Variant / Cover'),
      f('year', 'Year', 'number'), f('graded', 'Graded', 'yesno'), f('grade', 'Grade (e.g. CGC 9.8)'), f('keyIssue', 'Key issue', 'yesno'),
    ],
  },
  {
    id: 'tpl-media', name: 'Vinyl & Media', icon: '💿', skuPrefix: 'MEDA',
    fields: [
      f('artist', 'Artist'), f('title', 'Title'),
      f('format', 'Format', 'select', ['LP', '45', '78', 'CD', 'Cassette', '8-Track', 'DVD', 'Blu-ray', 'VHS', 'Game']),
      f('label', 'Label'), f('catalogNumber', 'Catalog #'), f('pressing', 'Pressing / Year'),
      f('sleeveCondition', 'Sleeve / case condition', 'select', ['Mint', 'Near Mint', 'Very Good+', 'Very Good', 'Good', 'Poor']),
    ],
  },
  {
    id: 'tpl-toys', name: 'Toys & Die-cast', icon: '🚗', skuPrefix: 'TOY',
    fields: [
      f('brand', 'Brand'), f('series', 'Series'), f('modelNumber', 'Model #'), f('scale', 'Scale'),
      f('year', 'Year', 'number'), f('packaging', 'Packaging', 'select', ['Carded / Sealed', 'Boxed', 'Loose']),
    ],
  },
  {
    id: 'tpl-books', name: 'Books', icon: '📚', skuPrefix: 'BOOK',
    fields: [
      f('author', 'Author'), f('isbn', 'ISBN'), f('publisher', 'Publisher'), f('year', 'Year', 'number'),
      f('edition', 'Edition'), f('printing', 'Printing'), f('signed', 'Signed', 'yesno'),
      f('binding', 'Binding', 'select', ['Hardcover', 'Paperback', 'Leather', 'Other']),
    ],
  },
  {
    id: 'tpl-antiques', name: 'Antiques & Art', icon: '🖼️', skuPrefix: 'ANTQ',
    fields: [
      f('maker', 'Maker / Artist'), f('era', 'Era / Period'), f('medium', 'Medium / Material'),
      f('dimensions', 'Dimensions'), f('marks', 'Marks / Signature'), f('provenance', 'Provenance', 'longtext'),
      f('appraisedValue', 'Appraised value', 'currency'), f('appraisalDate', 'Appraisal date', 'date'),
    ],
  },
  {
    id: 'tpl-jewelry', name: 'Jewelry & Watches', icon: '💍', skuPrefix: 'JWLY',
    fields: [
      f('maker', 'Maker / Brand'), f('material', 'Metal / Material'), f('gemstones', 'Gemstones'),
      f('size', 'Size'), f('weight', 'Weight (g)', 'number'), f('serial', 'Serial #'),
      f('appraisedValue', 'Appraised value', 'currency'),
    ],
  },
  {
    id: 'tpl-general', name: 'General Inventory', icon: '📦', skuPrefix: 'INV',
    fields: [
      f('supplier', 'Supplier'), f('supplierSku', 'Supplier SKU'), f('reorderLevel', 'Reorder at (qty)', 'number'),
      f('unit', 'Unit (each, lb, box)'), f('weight', 'Shipping weight (lbs)', 'number'),
    ],
  },
].map((t) => ({ ...t, builtin: true }));

export function slugKey(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
}
