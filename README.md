<p align="center"><img src="assets/icon-1024.png" width="128" alt="Squire icon"></p>

# Squire: Knick Knack Sack

*Keeper of your armor, shield, sword — and all your knick knacks.*

Squire is a **free, open-source inventory and collection manager**. Catalog anything with photos, custom details and descriptions, browse it like a photo album, and export it straight into an online shop, a spreadsheet or a printable list.

It started as a way to catalog 3,000+ ceramic slip-casting molds for [Blooming Lotus Pottery](https://bloominglotusstudio.com), and grew into a tool for any collection: trading cards, coins, stamps, dolls, comics, vinyl, die-cast, books, antiques, jewelry, shop stock, and anything else you build a template for.

**Try it now:** https://sirgijoe.github.io/squire-sack/ (open on your phone, then *Add to Home Screen*)

## Features

- **Templates**: 12 built-in (Ceramic Molds, Trading Cards, Coins, Stamps, Dolls & Figures, Comics, Vinyl & Media, Toys & Die-cast, Books, Antiques & Art, Jewelry & Watches, General Inventory), plus a builder for your own. Field types: text, long text, number, money, date, dropdown, yes/no, 1–5 rating, link. Templates export and import as files, so they can be shared.
- **Photos**: as many as you need per item, taken with the camera or picked from the gallery. Includes a cover photo, captions, reordering, and a full-screen viewer with swipe and pinch-to-zoom. Photos are resized on save, so they stay sharp but small.
- **Description blocks** with simple formatting: `**bold**`, `*italic*`, and `-` lists.
- **The Sack (album view)** has grid, list and card layouts. You can sort by name, date, price, condition, location, SKU or any template field. Filters stack, grouping uses collapsible sections, and the search covers every field. Nested collections (`Molds/Christmas/Ornaments`) work like folders.
- **Fast entry**: *Save + add next* carries the template, location, collection, condition and tags over to the next item. SKUs are created automatically (`MOLD-0001`). Leave the name blank and it is built from the details.
- **Exports**
  - **WooCommerce**: a `products.csv` for *Products → Import*, with template details as product attributes, categories and tags. It comes with an images bundle and step-by-step instructions, and SKU matching means re-imports update existing products.
  - **Spreadsheet CSV** for Excel, Google Sheets, eBay, Shopify and others.
  - **Printable list / PDF** with thumbnails and a total value.
  - **Full backup (.zip)** with every item, template and full-size photo. Restore by merging (the newest edit wins) or replacing.
- **Works offline** and installs to the home screen. There are no accounts, no cloud and no tracking, and your data stays on your device.
- Phone-first layout that scales up to tablet and desktop, with light and dark mode.

## Roadmap

| Phase | What |
|---|---|
| **0.1 (now)** | Web app: templates, items, photos, album, exports, backup |
| 0.2 | Native desktop app (Windows / macOS / Linux) via Tauri 2, with real file saving |
| 0.3 | **Desktop ↔ phone sync** over home Wi-Fi with QR-code pairing. Full-size photos move to the desktop "home base" and the phone keeps thumbnails |
| 0.4 | Android and iOS apps via Tauri 2 |
| Later | CSV import, barcode/QR labels for shelves, value history, WooCommerce direct upload |

## Run it

The app in `src/` is plain HTML, CSS and JavaScript with **no dependencies and no build step**.

```bash
# any static web server works, e.g.
npx http-server src -p 8080      # or: python3 -m http.server 8080 -d src
```

Then open http://localhost:8080. A web server is needed because the app uses ES modules, so opening `index.html` directly from the file system won't work.

### Desktop & mobile (Tauri 2)

Prerequisites: [Rust](https://rustup.rs) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS. Android needs Android Studio, and iOS needs a Mac with Xcode.

```bash
npm install
npm run desktop:dev        # run the desktop app
npm run desktop:build      # build installers
npm run android:init && npm run android:dev
npm run ios:init && npm run ios:dev     # macOS only
```

## Project layout

```
src/                  web app (also the Tauri frontend)
  js/app.js           UI, routing, album, editor, viewer
  js/db.js            IndexedDB storage
  js/templates.js     built-in templates
  js/export.js        WooCommerce / CSV / print / backup
  js/photos.js        photo resizing + thumbnails
  js/zip.js           tiny dependency-free zip reader/writer
src-tauri/            desktop & mobile wrapper (Rust)
assets/               source artwork
```

## License

Copyright © 2026 sirgijoe. Licensed under the **GNU General Public License v3.0**; see [LICENSE](LICENSE).
You are free to use, study, share and change Squire. If you share a changed version, it must stay free and open under the same license.

More projects at [sirgijoe.com](https://sirgijoe.com).
