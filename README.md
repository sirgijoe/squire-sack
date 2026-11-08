<p align="center"><img src="assets/icon-1024.png" width="128" alt="Squire icon"></p>

# Squire: Knick Knack Sack

*Keeper of your armor, shield, sword — and all your knick knacks.*

> **🧪 Beta.** Squire is free to use and works today, but it's still growing. Your data stays on your device unless you sync it with your own computer, so **make a backup now and then** from *More → Backup*. Found a bug or have an idea? [Open an issue](https://github.com/sirgijoe/squire-sack/issues/new/choose).

Squire is a **free, open-source inventory and collection manager**. Catalog anything with photos, custom details and descriptions, browse it like a photo album, and export it straight into an online shop, a spreadsheet or a printable list.

It started as a way to catalog 3,000+ ceramic slip-casting molds for [Blooming Lotus Pottery](https://bloominglotusstudio.com), and grew into a tool for any collection: trading cards, coins, stamps, dolls, comics, vinyl, die-cast, books, antiques, jewelry, shop stock, and anything else you build a template for.

## Get Squire

📖 **Step-by-step install guide for every device: [INSTALL.md](INSTALL.md)**

**Easiest — any phone, tablet or computer:** open **https://sirgijoe.github.io/squire-sack/**. On a phone, tap *Share → Add to Home Screen* (iPhone) or *⋮ → Install app* (Android). It works offline and costs nothing.

**Apps** (free, from the [latest release](https://github.com/sirgijoe/squire-sack/releases)):

| Device | Download | First launch |
|---|---|---|
| Windows | `Squire_…_x64-setup.exe` | If SmartScreen appears: *More info → Run anyway* |
| Mac (Apple chip: M1, M2, …) | `Squire_…_aarch64.dmg` | Drag to Applications. If macOS blocks it: *System Settings → Privacy & Security → Open Anyway* |
| Mac (Intel) | `Squire_…_x64.dmg` | Same as above |
| Linux | `.AppImage` or `.deb` | — |
| Android | `Squire_…_android.apk` | Allow "Install unknown apps" when asked |
| iPhone / iPad | Use the web link above | An App Store version is planned |

**Sync between your phone and computer** works with the desktop app plus the Android app (*More → Home base → Pair a phone*). iPhone sync is coming.

## Features

- **Templates**: 12 built-in (Ceramic Molds, Trading Cards, Coins, Stamps, Dolls & Figures, Comics, Vinyl & Media, Toys & Die-cast, Books, Antiques & Art, Jewelry & Watches, General Inventory), plus a builder for your own. Field types: text, long text, number, money, date, dropdown, yes/no, 1–5 rating, link. Templates export and import as files, so they can be shared.
- **Photos**: as many as you need per item, taken with the camera or picked from the gallery. Includes a cover photo, captions, reordering, and a full-screen viewer with swipe and pinch-to-zoom. Photos are resized on save, so they stay sharp but small.
- **Description blocks** with simple formatting: `**bold**`, `*italic*`, and `-` lists.
- **Multiple Sacks**: keep separate collections (e.g. *Miranda's Molds* and *Joe's Coins*), each with its own album and exports. Tap the title to switch, or view *All Sacks* at once. Items can move between Sacks.
- **The Sack (album view)** has grid, list and card layouts. You can sort by name, date, price, condition, location, SKU or any template field. Filters stack, grouping uses collapsible sections, and the search covers every field. Nested collections (`Molds/Christmas/Ornaments`) work like folders.
- **Fast entry**: *Save + add next* carries the template, location, collection, condition and tags over to the next item. SKUs are created automatically (`MOLD-0001`). Leave the name blank and it is built from the details.
- **Value history**: every price change is remembered. Each item shows its price history, and *More* shows the collection's total value over time.
- **Shelf labels with QR codes**: print labels for Avery 5160 (30 per sheet), Avery 5163 (10 per sheet) or 4″ × 5″ bin cards. Scan one with the 📷 button on the Sack (or the phone's camera) to jump to that item.
- **CSV import** from Excel, Google Sheets, other apps or a Squire export. You choose which column goes where; rows with a matching SKU update the existing item.
- **Home base sync** (desktop app): your computer becomes the home base for the Sack. Phones on the same Wi-Fi pair by scanning a QR code or typing a 6-digit code, and then sync both ways (the newest edit wins). Full-size photos move to the computer and phones keep small copies. Full-size photos still load from the computer when you're home, and exports fetch them from there.
- **Desktop app** (Windows, macOS, Linux) with real *Save as…* dialogs for exports and backups.
- **Exports**
  - **WooCommerce**: a `products.csv` for *Products → Import*, with template details as product attributes, categories and tags. It comes with an images bundle and step-by-step instructions, and SKU matching means re-imports update existing products.
  - **Spreadsheet CSV** for Excel, Google Sheets, eBay, Shopify and others.
  - **Printable list / PDF** with thumbnails and a total value.
  - **Full backup (.zip)** with every item, template and full-size photo. Restore by merging (the newest edit wins) or replacing.
- **Works offline** and installs to the home screen. There are no accounts, no cloud and no tracking. Your data stays on your devices and your own computer.
- Phone-first layout that scales up to tablet and desktop, with light and dark mode.

## Roadmap

| Phase | What |
|---|---|
| 0.1 | Web app: templates, items, photos, album, exports, backup |
| 0.2 | Multiple Sacks (separate collections) |
| **0.3 (now)** | Desktop app (Windows / macOS / Linux) with real file saving · **desktop ↔ phone sync** over home Wi-Fi with QR-code pairing and photo offload · Android app · CSV import · QR shelf labels · value history |
| Next | iOS app in the App Store (needs an Apple developer account) · direct upload to WooCommerce |

## Run it

The app in `src/` is plain HTML, CSS and JavaScript with **no dependencies and no build step**.

```bash
# any static web server works, e.g.
npx http-server src -p 8080      # or: python3 -m http.server 8080 -d src
```

Then open http://localhost:8080. A web server is needed because the app uses ES modules, so opening `index.html` directly from the file system won't work.

### Try phone sync without building anything

```bash
node tools/home-base.mjs            # needs Node 18+; no npm install
```

This runs the same home base as the desktop app. It serves Squire on your network and prints an address like `http://192.168.1.20:7878/` and a pairing code. Open that address on your phone, then go to *More → Sync with your computer → Pair*.

> Browsers block a secure (`https://`) page from talking to a computer on your Wi-Fi, so the GitHub Pages copy of the web app can't sync. Use the copy that the home base serves, or the Android app.

### Desktop & mobile apps (Tauri 2)

Prerequisites: [Rust](https://rustup.rs) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS. Android needs Android Studio, and iOS needs a Mac with Xcode.

```bash
npm install
npm run desktop:dev        # run the desktop app
npm run desktop:build      # build installers
npm run android:init && node tools/android-cleartext.mjs && npm run android:dev
npm run ios:init && npm run ios:dev     # macOS only
```

`tools/android-cleartext.mjs` lets the Android app use plain HTTP to reach the home base on your Wi-Fi. On iOS, `src-tauri/Info.ios.plist` does the same job.

In the desktop app, open *More → Home base → Start the home base*, then *Pair a phone*. Your computer may ask whether Squire can accept connections on private networks; allow it.

### Tests

```bash
npm test                         # web app + sync protocol (Node 18+; QR check uses Python + OpenCV if present)
cd src-tauri && cargo test       # Rust home base
```

### Releases

Push a tag that matches the version in `src-tauri/tauri.conf.json`:

```bash
git tag v0.3.0 && git push --tags
```

GitHub Actions then builds the Windows, macOS, Linux and Android installers and attaches them to a draft release for you to publish. See `.github/workflows/release.yml` if you want a signed Android build.

## Project layout

```
src/                  web app (also the Tauri frontend)
  js/app.js           UI, routing, album, editor, viewer
  js/db.js            IndexedDB storage
  js/templates.js     built-in templates
  js/export.js        WooCommerce / CSV / print / backup
  js/csvimport.js     CSV column mapping + import
  js/sync.js          home base sync client (protocol documented here)
  js/labels.js        QR shelf labels      js/qr.js   QR code generator
  js/value.js         price / collection value history
  js/platform.js      browser vs. desktop/mobile app (native Save as…)
  js/photos.js        photo resizing + thumbnails
  js/zip.js           tiny dependency-free zip reader/writer
src-tauri/            desktop & mobile app (Rust): src/home_base.rs is the sync server
tools/home-base.mjs   the same home base in plain Node
test/                 npm test
assets/               source artwork
```

## License

Copyright © 2026 sirgijoe. Licensed under the **GNU General Public License v3.0**; see [LICENSE](LICENSE).
You are free to use, study, share and change Squire. If you share a changed version, it must stay free and open under the same license.

More projects at [sirgijoe.com](https://sirgijoe.com).
